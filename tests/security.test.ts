import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { redact, registerSecret, _resetForTests } from "../src/security.ts";

describe("redact", () => {
  it("masks registered secrets in strings", () => {
    registerSecret("super-secret-uuid");
    expect(redact("token: super-secret-uuid")).toContain("REDACTED");
  });

  it("walks objects + arrays deeply", () => {
    registerSecret("hidden-uuid");
    const out = redact({ headers: { authorization: "PVEAPIToken=u@pam!t=hidden-uuid" }, ok: true });
    expect(JSON.stringify(out)).not.toContain("hidden-uuid");
  });

  it("passes non-strings through unchanged", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });

  it("ignores empty secret registrations", () => {
    registerSecret("");
    expect(redact("anything")).toBe("anything");
  });
});

// A one-character PROXMOX_TOKEN_SECRET used to make every message unreadable, because
// each secret was replaced as a bare substring regardless of length.
describe("short secrets do not shred unrelated output", () => {
  beforeEach(() => _resetForTests());
  afterEach(() => {
    _resetForTests();
    vi.restoreAllMocks();
  });

  it("leaves words containing the secret intact", () => {
    registerSecret("s");
    expect(redact("proxmox_snapshot_resource is a write operation")).toBe(
      "proxmox_snapshot_resource is a write operation",
    );
  });

  it("still redacts a short secret where it stands alone", () => {
    registerSecret("s");
    expect(redact("token: s")).toBe("token: REDACTED");
    expect(redact("s")).toBe("REDACTED");
    expect(redact("secret=s&other=1")).toBe("secret=REDACTED&other=1");
  });

  it("redacts back-to-back standalone occurrences", () => {
    registerSecret("s");
    expect(redact("s s s")).toBe("REDACTED REDACTED REDACTED");
  });

  it("still redacts a short guest password, which is why short secrets stay registered", () => {
    registerSecret("hunter2");
    expect(redact('{"password":"hunter2"}')).toBe('{"password":"REDACTED"}');
  });

  it("does not treat a short secret as a reason to redact every base64 blob", () => {
    registerSecret("s");
    // Decodes to bytes containing "s"; under the old rule this whole token vanished.
    const blob = Buffer.from("some unrelated payload").toString("base64");
    expect(redact(`data: ${blob}`)).toBe(`data: ${blob}`);
  });

  it("keeps full substring redaction for normal-length secrets", () => {
    registerSecret("super-secret-uuid-value");
    expect(redact("x=super-secret-uuid-valuey")).toBe("x=REDACTEDy");
  });

  it("escapes regex metacharacters in a short secret", () => {
    registerSecret("a.c");
    expect(redact("token: a.c")).toBe("token: REDACTED");
    expect(redact("token: abc")).toBe("token: abc");
  });

  it("warns once on stderr when a short secret is registered", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    registerSecret("s");
    registerSecret("t");
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/shorter than 8 characters/);
  });
});
