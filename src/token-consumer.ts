import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, open, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";

// This path is operator configuration, never a model-controlled tool argument.
export async function resolveTokenConsumer(): Promise<FileHandle> {
  if (process.platform !== "linux") throw new Error("PROXMOX_TOKEN_CONSUMER requires Linux with /proc mounted");
  const path = process.env.PROXMOX_TOKEN_CONSUMER;
  if (!path || !isAbsolute(path)) throw new Error("A protected absolute PROXMOX_TOKEN_CONSUMER executable is required");
  let handle: FileHandle | undefined;
  try {
    // Validate the opened inode, never re-resolve the configured path at execution.
    // NONBLOCK also prevents an unsafe FIFO from hanging preflight.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid() && stat.uid !== 0)) {
      throw new Error("unsafe consumer");
    }
    await access(`/proc/self/fd/${handle.fd}`, constants.X_OK);
    return handle;
  } catch {
    await handle?.close();
    throw new Error("PROXMOX_TOKEN_CONSUMER must be an executable regular file owned by this user or root, without group or other write access");
  }
}

export async function deliverToken(consumer: FileHandle, credential: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    // No shell, command-line secret, stdout, stderr, or intermediate file.
    // fd 3 stays inherited so shebang interpreters can open the same pinned inode.
    const child = spawn("/proc/self/fd/3", [], { stdio: ["pipe", "ignore", "ignore", consumer.fd] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(); }, 10_000);
    function fail() {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error("Token created but credential delivery failed. Revoke the token before retrying provisioning."));
    }
    child.on("error", fail);
    if (!child.stdin) { fail(); return; }
    child.stdin.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else fail();
    });
    child.stdin.end(JSON.stringify(credential));
  });
}
