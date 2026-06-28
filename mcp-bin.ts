import { startServer } from "./mcp-server.ts";

startServer().catch((error: unknown) => {
  console.error(`proxmox-mcp fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
