import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { startServer } from "./src/server.ts";

export { startServer } from "./src/server.ts";

// True when this module is the process entrypoint (symlink-safe).
const isEntrypoint = (() => {
  const arg = process.argv[1];
  if (typeof arg !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  startServer().catch((error: unknown) => {
    console.error(`proxmox-mcp fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
