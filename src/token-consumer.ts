import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";

// This path is operator configuration, never a model-controlled tool argument.
export async function resolveTokenConsumer(): Promise<string> {
  const path = process.env.PROXMOX_TOKEN_CONSUMER;
  if (!path || !isAbsolute(path)) throw new Error("A protected absolute PROXMOX_TOKEN_CONSUMER executable is required");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || (stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid() && stat.uid !== 0)) {
      throw new Error("unsafe consumer");
    }
    await access(path, constants.X_OK);
  } catch {
    throw new Error("PROXMOX_TOKEN_CONSUMER must be an executable regular file owned by this user or root, without group or other write access");
  }
  return path;
}

export async function deliverToken(consumer: string, credential: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    // No shell, command-line secret, stdout, stderr, or intermediate file.
    const child = spawn(consumer, [], { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(); }, 10_000);
    function fail() {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error("Token created but credential delivery failed. Revoke the token before retrying provisioning."));
    }
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else fail();
    });
    child.stdin.end(JSON.stringify(credential));
  });
}
