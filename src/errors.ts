import { WriteGateError } from "./gates.ts";
import { ProxmoxClientError, ProxmoxUnreachableError } from "./proxmox-client.ts";
import { SshExecError } from "./ssh-executor.ts";
import { ToolInputError } from "./tools/_util.ts";
import { redact } from "./security.ts";

export interface ToolErrorPayload {
  error: string;
  code: string;
  name: string;
  status?: number;
}

// Upstream error bodies are not under our control (a proxy can answer with a full HTML
// page), so the text handed back to the model is bounded.
export const MAX_ERROR_MESSAGE_CHARS = 2_000;

// Secrets are masked before the cut so a boundary cannot leave a fragment of one behind.
export function boundErrorMessage(raw: string): string {
  const message = redact(raw) as string;
  if (message.length <= MAX_ERROR_MESSAGE_CHARS) return message;
  return `${message.slice(0, MAX_ERROR_MESSAGE_CHARS)}... [truncated ${message.length - MAX_ERROR_MESSAGE_CHARS} chars]`;
}

export function classifyToolError(error: unknown): ToolErrorPayload {
  const payload = classifyUnbounded(error);
  return { ...payload, error: boundErrorMessage(payload.error) };
}

function classifyUnbounded(error: unknown): ToolErrorPayload {
  const err = error instanceof Error ? error : new Error(String(error));
  if (err instanceof ToolInputError) {
    return { error: err.message, code: "TOOL_INPUT_INVALID", name: err.name };
  }
  if (err instanceof WriteGateError) {
    const code = err.message.includes("requires env flag")
      ? "DESTRUCTIVE_ENV_REQUIRED"
      : err.message.includes("destructive operation")
        ? "DESTRUCTIVE_CONFIRMATION_REQUIRED"
        : "WRITE_CONFIRMATION_REQUIRED";
    return { error: err.message, code, name: err.name };
  }
  if (err instanceof ProxmoxClientError) {
    return { error: err.message, code: `PROXMOX_HTTP_${err.status}`, name: err.name, status: err.status };
  }
  if (err instanceof ProxmoxUnreachableError) {
    return { error: err.message, code: "PROXMOX_UNREACHABLE", name: err.name };
  }
  if (err instanceof SshExecError) {
    return { error: err.message, code: `SSH_${err.phase.toUpperCase()}_FAILED`, name: err.name };
  }
  if (/vmid \d+ not found in cluster resources/.test(err.message)) {
    return { error: err.message, code: "VMID_NOT_FOUND", name: err.name };
  }
  if (/invalid UPID format/.test(err.message)) {
    return { error: err.message, code: "TASK_UPID_INVALID", name: err.name };
  }
  if (/task did not finish OK/i.test(err.message) || /task failed/i.test(err.message)) {
    return { error: err.message, code: "TASK_FAILED", name: err.name };
  }
  return { error: err.message, code: "TOOL_ERROR", name: err.name };
}
