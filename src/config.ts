export interface ProxmoxSshConfig {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  hostFingerprint?: string;
  vmUser: string;
  vmKeyPath: string;
}

export interface ProxmoxConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
  tlsInsecure: boolean;
  ssh: ProxmoxSshConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.toLowerCase());
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// The URL may carry credentials, so the message never repeats it.
function assertHttpUrl(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new ConfigError("PROXMOX_URL must be an absolute http(s) URL");
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new ConfigError("PROXMOX_URL must use the http or https scheme");
  }
}

function parsePort(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new ConfigError(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

export function resolveConfig(env: Record<string, string | undefined>): ProxmoxConfig {
  const url = env.PROXMOX_URL;
  const tokenId = env.PROXMOX_TOKEN_ID;
  const tokenSecret = env.PROXMOX_TOKEN_SECRET;
  if (!url) throw new ConfigError("PROXMOX_URL is required");
  if (!tokenId) throw new ConfigError("PROXMOX_TOKEN_ID is required");
  if (!tokenSecret) throw new ConfigError("PROXMOX_TOKEN_SECRET is required");
  const trimmedUrl = url.replace(/\/+$/, "");
  assertHttpUrl(trimmedUrl);
  const sshHost = env.PROXMOX_SSH_HOST ?? hostnameFromUrl(trimmedUrl);
  const sshPort = parsePort(env.PROXMOX_SSH_PORT, "PROXMOX_SSH_PORT", 22);
  const sshUser = env.PROXMOX_SSH_USER ?? "root";
  const sshKey = env.PROXMOX_SSH_KEY ?? "~/.ssh/id_ed25519";
  return {
    url: trimmedUrl,
    tokenId,
    tokenSecret,
    tlsInsecure: isTruthy(env.PROXMOX_TLS_INSECURE),
    ssh: {
      host: sshHost,
      port: sshPort,
      user: sshUser,
      keyPath: sshKey,
      hostFingerprint: env.PROXMOX_SSH_HOST_FINGERPRINT,
      vmUser: env.PROXMOX_VM_SSH_USER ?? sshUser,
      vmKeyPath: env.PROXMOX_VM_SSH_KEY ?? sshKey,
    },
  };
}
