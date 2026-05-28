import type { ToolDefinition } from "../../types";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import { createFilesCountLinesTool } from "./filesCountLines";
import { createFilesListTool } from "./filesList";
import { createFilesReadTool } from "./filesRead";
import { createFilesReadManyTool } from "./filesReadMany";
import { createFilesReadRangeTool } from "./filesReadRange";
import { createFilesSearchTool } from "./filesSearch";
import { createFilesStatTool } from "./filesStat";
import { createFilesTreeSummaryTool } from "./filesTreeSummary";

export { type FilesBackend, defaultFilesBackend } from "./backend";
export { createFilesCountLinesTool } from "./filesCountLines";
export { createFilesListTool } from "./filesList";
export { createFilesReadTool } from "./filesRead";
export { createFilesReadManyTool } from "./filesReadMany";
export { createFilesReadRangeTool } from "./filesReadRange";
export { createFilesSearchTool } from "./filesSearch";
export { createFilesStatTool } from "./filesStat";
export { createFilesTreeSummaryTool } from "./filesTreeSummary";

// Factory for read-only file tools with injectable backend support for tests and hardening.
export function createFilesTools(backend: FilesBackend = defaultFilesBackend): ToolDefinition[] {
  return [
    createFilesReadTool(backend),
    createFilesReadManyTool(backend),
    createFilesReadRangeTool(backend),
    createFilesListTool(backend),
    createFilesTreeSummaryTool(backend),
    createFilesSearchTool(backend),
    createFilesStatTool(backend),
    createFilesCountLinesTool(backend),
  ];
}

// Default-backed tool array consumed by the central ToolRegistry.
export const fileTools: ToolDefinition[] = createFilesTools();
