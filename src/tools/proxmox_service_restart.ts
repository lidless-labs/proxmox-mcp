import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { createServiceActionTool } from "./service-action.ts";
import type { VmSshDefaults } from "./ssh-target.ts";

export function createProxmoxServiceRestartTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return createServiceActionTool("restart", getClient, getSsh, vmDefaults);
}
