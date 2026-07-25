const SECRETS = new Set<string>();
const BASE64_TOKEN_RE = /[A-Za-z0-9+/=]{12,}/g;

// A secret shorter than this is replaced only where it stands alone (delimited by
// non-alphanumerics or the string edges), never as a bare substring. Blind substring
// replacement on a very short secret shreds unrelated output: with PROXMOX_TOKEN_SECRET
// set to "s", a gate error came back as
//   "proxmox_REDACTEDnapREDACTEDhot_reREDACTEDource iREDACTED a write operation"
// which hides the real message exactly when the operator needs to read it.
//
// Short secrets are still registered and still redacted. Dropping them from the set
// instead would be a real downgrade, because registerSecret also takes user-supplied
// guest credentials (proxmox_create_vm cipassword, proxmox_create_container password)
// and those are legitimately short. The residual gap is a short secret embedded inside
// a longer alphanumeric run ("abc123" inside "xabc123y"), which stays visible; that is
// an acceptable trade against mangling every message.
const MIN_SUBSTRING_LENGTH = 8;

let warnedShortSecret = false;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function registerSecret(s: string): void {
  if (!s || s.length === 0) return;
  SECRETS.add(s);
  if (s.length < MIN_SUBSTRING_LENGTH && !warnedShortSecret) {
    warnedShortSecret = true;
    // stderr only: stdout is the MCP protocol channel.
    console.error(
      `proxmox-mcp: a registered secret is shorter than ${MIN_SUBSTRING_LENGTH} characters. ` +
        "It is still redacted, but only where it appears as a standalone value. " +
        "If this is PROXMOX_TOKEN_SECRET, check that it was not truncated.",
    );
  }
}

function maskString(s: string): string {
  let out = s;
  for (const secret of SECRETS) {
    if (!out.includes(secret)) continue;
    if (secret.length >= MIN_SUBSTRING_LENGTH) {
      out = out.split(secret).join("REDACTED");
    } else {
      // Keep the left delimiter and look ahead at the right one, so back-to-back
      // occurrences ("s s s") all get replaced.
      out = out.replace(
        new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(secret)}(?=[^A-Za-z0-9]|$)`, "g"),
        (_match, left: string) => `${left}REDACTED`,
      );
    }
  }
  out = out.replace(BASE64_TOKEN_RE, (token) => {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      for (const secret of SECRETS) {
        // Only long secrets qualify here: "decoded contains 's'" matches nearly every
        // base64 blob, which would redact unrelated encoded payloads wholesale.
        if (secret.length >= MIN_SUBSTRING_LENGTH && decoded.includes(secret)) return "REDACTED";
      }
    } catch {}
    return token;
  });
  return out;
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

export function _resetForTests(): void {
  SECRETS.clear();
  warnedShortSecret = false;
}
