# proxmox-mcp v0.4 Design - In-Container Execution

Extends v0.3 with three tools that let an MCP client run commands and manage files inside LXC containers and QEMU VMs, the same way an operator would `ssh root@proxmox-host` and `pct exec 109 -- ...` or SSH directly into a VM like `dani`.

## Motivation

Today the MCP wraps the Proxmox REST API: list, start, stop, snapshot, create, destroy. None of that lets an agent actually do work *inside* a container. Anything past lifecycle operations (edit a config, restart a service, inspect a log, deploy a script) requires the operator to drop to a shell. v0.4 closes that gap.

## What's added

### Tier 1 read (1)

| Tool | Description | Transport |
|---|---|---|
| `proxmox_read_file` | Read a file from inside an LXC or QEMU VM | `pct exec` for LXC, direct SSH for QEMU |

### Tier 2 safe-writes (2)

| Tool | Description | Transport |
|---|---|---|
| `proxmox_exec` | Run a shell command inside an LXC or QEMU VM, return stdout/stderr/exit | `pct exec` for LXC, direct SSH for QEMU |
| `proxmox_write_file` | Write a text file to a path inside an LXC or QEMU VM | `pct exec` for LXC, direct SSH for QEMU |

No tier-3 destructive tools in this slice. Operators can `rm -rf` via `proxmox_exec` if they want; the confirm gate is the line.

## Architecture

Three new source files. The SSH transport is isolated in its own module and the tools depend on it through a factory the same way they depend on `ProxmoxClient` today.

```
src/
  ssh-executor.ts          (new) SSH transport, no Proxmox knowledge
  config.ts                (edit) read new SSH env vars
  tools/
    proxmox_exec.ts        (new)
    proxmox_read_file.ts   (new)
    proxmox_write_file.ts  (new)
    index.ts               (edit) export the 3 new factories
mcp-server.ts              (edit) wire 3 new tools, build SshExecutor factory
```

The SSH executor knows nothing about tools, vmids, or PVE; it just opens an SSH connection and runs a command. Tools layer Proxmox semantics (resolve vmid -> node/type, pick LXC vs QEMU transport, resolve VM IP via guest agent) on top.

## SSH transport (`src/ssh-executor.ts`)

Uses the `ssh2` npm package (new dep). Two exported functions plus shared types.

```ts
export interface SshHostConfig {
  host: string;
  port: number;
  user: string;
  keyPath: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SshExecError extends Error {
  constructor(public phase: "connect" | "exec" | "timeout", message: string);
}

export async function execInLxc(
  hostCfg: SshHostConfig,
  vmid: number,
  command: string,
  timeoutMs: number,
): Promise<ExecResult>;

export async function execViaDirectSsh(
  targetCfg: SshHostConfig,
  command: string,
  timeoutMs: number,
): Promise<ExecResult>;
```

### Command encoding

Both functions base64-encode the user command before embedding it in a remote shell, so neither the SSH layer nor `pct exec` ever has to escape user content. The wrapper executed on the remote side is:

```
bash -c "$(echo <BASE64> | base64 -d)"
```

For LXC the full remote command is:

```
sudo pct exec <vmid> -- bash -c "$(echo <BASE64> | base64 -d)"
```

For direct SSH it's the same wrapper without `sudo pct exec`. The base64 string contains only `[A-Za-z0-9+/=]` so it survives any shell parser without quoting.

### Connection model

Each call opens a fresh SSH connection, runs one command, and closes. No connection pooling in v0.4 - the per-call latency is acceptable for an MCP tool and a pool adds enough complexity (key reload, idle timeout, error recovery) that it deserves its own slice. The `Client` from `ssh2` is awaited via `ready` / `error` events and wrapped in a `Promise` that resolves to `ExecResult` or rejects with `SshExecError`.

stdout and stderr are accumulated separately. Exit code comes from the `exit` event on the channel. Timeouts fire from a `setTimeout` that destroys the connection and rejects with `SshExecError("timeout", ...)`. Default timeout 30s; tools accept a per-call override.

### Key resolution

`keyPath` is expanded for `~` to `os.homedir()` and read once per call (acceptable; files are small and the OS will cache). If the file is missing the error is wrapped as `SshExecError("connect", "key file not found: ...")` rather than letting `ssh2` bubble a raw ENOENT.

### Stdout/stderr size

No internal limits in v0.4. If an agent runs `cat /var/log/syslog` and pulls 200 MB, the MCP returns 200 MB. Reasonable for the use case; if it becomes a problem we add a `max_bytes` arg and stream cut later.

## Config additions (`src/config.ts`)

Six new optional env vars. All have defaults so existing v0.3 deployments keep working without setting any of them.

| Env var | Default | Purpose |
|---|---|---|
| `PROXMOX_SSH_HOST` | hostname extracted from `PROXMOX_URL` | Proxmox host for `pct exec` |
| `PROXMOX_SSH_PORT` | `22` | SSH port |
| `PROXMOX_SSH_USER` | `root` | SSH user on Proxmox host |
| `PROXMOX_SSH_KEY` | `~/.ssh/id_ed25519` | Key for Proxmox host SSH |
| `PROXMOX_VM_SSH_USER` | falls back to `PROXMOX_SSH_USER` | Default user for direct VM SSH |
| `PROXMOX_VM_SSH_KEY` | falls back to `PROXMOX_SSH_KEY` | Default key for direct VM SSH |

Per-VM overrides (read on demand at tool-execute time, not at config-resolve time):

- `PROXMOX_VM_<vmid>_SSH_HOST` - pin a VM's IP, bypasses guest-agent lookup
- `PROXMOX_VM_<vmid>_SSH_USER` - per-VM user override
- `PROXMOX_VM_<vmid>_SSH_KEY` - per-VM key override

`ProxmoxConfig` grows an optional `ssh` sub-object with the host SSH defaults and VM SSH defaults. The existing `url`/`tokenId`/`tokenSecret` shape is unchanged. Per-VM overrides are resolved from `process.env` directly by the tools, not stored on `ProxmoxConfig`, so adding a new VM doesn't require restarting the MCP.

## Tools

### `proxmox_exec` (Tier-2 safe-write)

```
{
  "vmid": integer,           // container or VM id, required
  "command": string,         // shell command to run, required
  "timeout": integer?,       // seconds, default 30
  "confirm": true            // tier-2 gate, required
}
```

Flow:
1. `assertConfirmedWrite(raw, NAME)` - tier-2 gate.
2. `resolveResource(client, vmid)` -> `{ node, type }`.
3. If `type === "lxc"`: `execInLxc(hostCfg, vmid, command, timeoutMs)`.
4. If `type === "qemu"`: resolve target IP (see below), then `execViaDirectSsh(targetCfg, command, timeoutMs)`.

Returns:
```json
{
  "vmid": 109,
  "type": "lxc",
  "stdout": "...",
  "stderr": "...",
  "exit_code": 0
}
```

Non-zero exit codes are NOT thrown - they're returned in the payload. SSH-level failures (can't connect, timeout) throw `SshExecError` which the MCP converts to `isError: true`.

### `proxmox_read_file` (Tier-1 read)

```
{
  "vmid": integer,           // required
  "path": string             // absolute path inside the container, required
}
```

Implementation: same vmid resolution, then `exec(... "cat -- <quoted path>" ...)`. The path is shell-quoted (single-quote wrapping with `'\''` escape) before it goes into the base64 envelope, so paths with spaces or special chars work.

Returns `{ vmid, path, content }` on success. If exit code is non-zero, throws an error with the captured stderr trimmed - typical case is "file not found" or "permission denied" and the agent gets a clean message rather than parsing exec output.

No confirm gate. Consistent with other Tier-1 tools (`proxmox_get_resource`, `proxmox_list_containers`).

### `proxmox_write_file` (Tier-2 safe-write)

```
{
  "vmid": integer,           // required
  "path": string,            // destination, required
  "content": string,         // file content, required
  "confirm": true            // tier-2 gate, required
}
```

Flow:
1. `assertConfirmedWrite(raw, NAME)`.
2. Resolve vmid as above.
3. Run two commands in sequence via the same SSH session pattern:
   - `mkdir -p <dirname>` (with `dirname` derived from path)
   - `cat > <path>` with `content` piped over the channel's stdin

The content is sent as raw bytes on the stdin stream of the `cat > path` command - no base64 round-trip on the data payload itself, only on the wrapper command. This keeps file write throughput reasonable and avoids tripling memory use for large files.

Returns `{ vmid, path, bytes_written }`.

The two-step (mkdir then cat) is implemented as two separate SSH connections for v0.4 (matching the one-call-one-connection model). Optimizing to one connection is a v0.5 concern.

### VM IP resolution (QEMU only)

When `type === "qemu"`, the tool needs to know what IP to SSH to. Resolution order:

1. Env override: `process.env["PROXMOX_VM_" + vmid + "_SSH_HOST"]`. If set, use it.
2. Guest agent: `GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces`. Find the first interface whose name is not `lo` and whose `ip-addresses` includes an IPv4 that is not in `127.0.0.0/8`. Use that IP.
3. If both fail, throw a clear error: `"vmid 109 is QEMU and has no PROXMOX_VM_109_SSH_HOST set and guest agent did not return a usable IP. Install qemu-guest-agent in the VM or pin the IP via env."`

Per-VM user/key resolution:
1. `process.env["PROXMOX_VM_" + vmid + "_SSH_USER"]` or fall through to `PROXMOX_VM_SSH_USER` or `PROXMOX_SSH_USER`.
2. Same fallthrough for key path.

## `mcp-server.ts` changes

Build a single `SshExecutor` factory using the resolved config:

```ts
const sshExecutor = makeSshExecutor(cfg);
```

`makeSshExecutor` returns an object with `execInLxc(vmid, command, timeoutMs)` and `execViaDirectSsh(targetCfg, command, timeoutMs)` bound to the host config. Tools take `(getClient, sshExecutor)` in their factories.

Three new lines in the `tools` array. The `proxmox-mcp` version bumps to `0.4.0`.

## Tests (`tests/`)

Per-tool test files in `tests/tools/`:

- `exec.test.ts`: happy path (LXC), happy path (QEMU with mocked guest-agent IP), confirm gate refusal, SSH connect failure -> error path, non-zero exit code captured in payload (not thrown), timeout refusal.
- `read_file.test.ts`: happy path, file-not-found (non-zero exit -> error), path with special chars (verify quoting).
- `write_file.test.ts`: happy path, confirm gate refusal, mkdir-then-cat sequence (verify two calls in order), bytes_written count.

A new `tests/ssh-executor.test.ts` tests the transport in isolation. The `ssh2` package itself is mocked (a fake `Client` that emits `ready`/`exit` events on a script we control); we don't spin up a real sshd in CI.

`tests/integration.test.ts` updates: 24 tools register at startup.

Target: ~85 tests total (70 from v0.3 + ~15 new).

## Acceptance criteria

1. `npm test` ~85 tests green.
2. All 24 tools register at startup.
3. `proxmox_exec` against an LXC container returns stdout/stderr/exit_code.
4. `proxmox_exec` against a QEMU VM with guest agent returns stdout/stderr/exit_code via direct SSH.
5. `proxmox_exec` against a QEMU VM with no guest agent and no env override throws a clear error naming the env var to set.
6. `proxmox_read_file` returns file content for an existing file; throws a non-MCP-success error for a missing file with stderr trimmed into the message.
7. `proxmox_write_file` creates parent directories and writes content; rejects without `confirm: true`.
8. Existing v0.3 tools and tests are unchanged (no regressions).
9. README updated with the 3 new tools and the SSH env var section.

## Operator follow-up

PR ships code + docs + tests + version bump. Operator owns:

1. Add SSH env vars to `.env`:
   ```
   PROXMOX_SSH_HOST=192.0.2.10
   PROXMOX_SSH_USER=claude
   PROXMOX_SSH_KEY=~/.ssh/id_ed25519_proxmox
   ```
2. Confirm the SSH key is authorized on the Proxmox host for the user (already true for `claude@proxmox-host`).
3. For any QEMU VM the agent should reach: install `qemu-guest-agent` in the VM and enable the agent on the VM config (`qm set <vmid> --agent 1`), OR pin `PROXMOX_VM_<vmid>_SSH_HOST` in `.env`.
4. For QEMU VMs: ensure the SSH key in `PROXMOX_VM_SSH_KEY` is authorized in the VM's `~/.ssh/authorized_keys`.

## Out of scope (deferred)

- SSH connection pooling (one connection per call in v0.4).
- Streaming output to the MCP client during long-running commands (currently buffered until exit).
- Binary file transfer (`proxmox_write_file` takes a string; binary needs base64 in the payload, deferred).
- Interactive sessions / pty allocation.
- SFTP-based file transfer (we use `cat` over the exec channel; works for any size text file but is less efficient than SFTP for very large files).
- Per-tool destructive gate on `proxmox_exec` (the user can run destructive shell commands but the tool itself is Tier-2; if we add a tier-3 variant that allows it with the env flag, that's a v0.5 design).
- Caching guest-agent IP lookups (currently re-queried each call).
