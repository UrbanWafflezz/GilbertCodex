import type { ToolDefinition } from "../../types";
import { defaultTerminalBackend, type TerminalBackend } from "./backend";
import { createTerminalDevServerStatusTool, createTerminalListSessionsTool, createTerminalReadSessionTool } from "./terminalDiagnostics";
import { createTerminalRunTool } from "./terminalRun";

export { defaultTerminalBackend, type TerminalBackend } from "./backend";
export { createTerminalDevServerStatusTool, createTerminalListSessionsTool, createTerminalReadSessionTool } from "./terminalDiagnostics";
export { createTerminalRunTool } from "./terminalRun";

export function createTerminalTools(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition[] {
  return [
    createTerminalListSessionsTool(backend),
    createTerminalReadSessionTool(backend),
    createTerminalDevServerStatusTool(backend),
    createTerminalRunTool(backend),
  ];
}

export const terminalTools: ToolDefinition[] = createTerminalTools();
