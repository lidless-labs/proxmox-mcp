import { request as httpsRequest } from "node:https";

export interface ProxmoxClientOptions {
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export class ProxmoxClientError extends Error {
  constructor(public status: number, message: string) {
    super(`Proxmox ${status}: ${message}`);
    this.name = "ProxmoxClientError";
  }
}

export class ProxmoxUnreachableError extends Error {
  constructor(cause: string) {
    super(`Proxmox unreachable: ${cause}`);
    this.name = "ProxmoxUnreachableError";
  }
}

export interface ClientInstanceConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
  tlsInsecure: boolean;
}

export class ProxmoxClient {
  private authHeader: string;
  private retryDelayMs: number;
  private requestTimeoutMs: number;
  private maxResponseBytes: number;
  usesInsecureTls: boolean;

  constructor(private cfg: ClientInstanceConfig, opts: ProxmoxClientOptions = {}) {
    this.authHeader = `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 2 * 1024 * 1024;
    for (const value of [this.requestTimeoutMs, this.maxResponseBytes]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("HTTP limits must be positive safe integers");
    }
    this.usesInsecureTls = cfg.tlsInsecure && cfg.url.startsWith("https://");
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.cfg.url + "/api2/json" + path;
    const headers: Record<string, string> = { authorization: this.authHeader };
    let bodyStr: string | undefined;
    if (body !== undefined) {
      // PVE API rejects application/json on POST/PUT - it requires form-encoded bodies.
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          if (v === undefined || v === null) continue;
          // PVE encodes array params as repeated keys (e.g. guest-agent exec
          // `command`), not a single JSON blob.
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item === undefined || item === null) continue;
              form.append(k, typeof item === "object" ? JSON.stringify(item) : String(item));
            }
            continue;
          }
          form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
        headers["content-type"] = "application/x-www-form-urlencoded";
        bodyStr = form.toString();
      } else {
        headers["content-type"] = "application/json";
        bodyStr = JSON.stringify(body);
      }
    }
    let lastErr: unknown;
    const attempts = method === "GET" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await this.fetchUrl(url, method, headers, bodyStr);
        if (res.status >= 200 && res.status < 300) {
          const text = await res.text();
          if (!text) return undefined as T;
          const parsed = JSON.parse(text);
          return (parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed) as T;
        }
        if ([502, 503, 504].includes(res.status)) {
          lastErr = new ProxmoxUnreachableError(`HTTP ${res.status}`);
          if (attempt + 1 < attempts) await sleep(this.retryDelayMs);
          continue;
        }
        const errText = await res.text();
        let msg = errText;
        try { msg = (JSON.parse(errText) as { message?: string }).message ?? errText; } catch {}
        throw new ProxmoxClientError(res.status, msg);
      } catch (e) {
        if (e instanceof ProxmoxClientError) throw e;
        if (e instanceof ResponseLimitError) throw new ProxmoxUnreachableError(e.message);
        lastErr = new ProxmoxUnreachableError((e as Error).message);
        if (attempt + 1 < attempts) await sleep(this.retryDelayMs);
      }
    }
    throw lastErr ?? new ProxmoxUnreachableError("unknown");
  }

  private async fetchUrl(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; text(): Promise<string> }> {
    if (this.usesInsecureTls) {
      return nodeRequest(url, method, headers, body, false, this.requestTimeoutMs, this.maxResponseBytes);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "error" });
      const length = Number(response.headers.get("content-length"));
      if (length > this.maxResponseBytes) {
        await response.body?.cancel();
        throw new ResponseLimitError(this.maxResponseBytes);
      }
      reader = response.body?.getReader();
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.maxResponseBytes) {
          void reader.cancel().catch(() => {});
          throw new ResponseLimitError(this.maxResponseBytes);
        }
        chunks.push(Buffer.from(value));
      }
      const text = Buffer.concat(chunks).toString("utf8");
      return { status: response.status, text: async () => text };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`request timed out after ${this.requestTimeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
      reader?.releaseLock();
    }
  }
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

class ResponseLimitError extends Error {
  constructor(maxBytes: number) { super(`response exceeded ${maxBytes} bytes`); }
}

function nodeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  rejectUnauthorized: boolean,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requestHeaders = { ...headers };
    if (body !== undefined && requestHeaders["content-length"] === undefined) {
      requestHeaders["content-length"] = String(Buffer.byteLength(body, "utf8"));
    }
    const req = httpsRequest(parsed, { method, headers: requestHeaders, rejectUnauthorized }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("error", fail);
      res.on("aborted", () => fail(new Error("upstream response aborted")));
      if (Number(res.headers["content-length"]) > maxBytes) {
        fail(new ResponseLimitError(maxBytes));
        res.destroy();
        return;
      }
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          fail(new ResponseLimitError(maxBytes));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, text: async () => text });
      });
    });
    const timer = setTimeout(() => fail(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
    function fail(error: Error) {
      clearTimeout(timer);
      reject(error);
      req.destroy();
    }
    req.on("error", fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
