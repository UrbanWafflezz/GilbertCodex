import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import { createFilesAppendTool } from "./filesAppend";
import { createFilesApplyPatchTool } from "./filesApplyPatch";
import { createFilesCopyTool } from "./filesCopy";
import { createFilesCreateDirectoryTool } from "./filesCreateDirectory";
import { createFilesEditManyTool } from "./filesEditMany";
import { createFilesExactReplaceTool } from "./filesExactReplace";
import { createFilesInsertAtLineTool } from "./filesInsertAtLine";
import { createFilesMoveTool } from "./filesMove";
import { createFilesReplaceRangeTool } from "./filesReplaceRange";
import { createFilesReplaceSpanTool } from "./filesReplaceSpan";
import { createFilesWriteTool } from "./filesWrite";
import { createFilesWriteManyTool } from "./filesWriteMany";

export { type EditingBackend, defaultEditingBackend } from "./backend";
export { createFilesAppendTool } from "./filesAppend";
export { createFilesApplyPatchTool } from "./filesApplyPatch";
export { createFilesCopyTool } from "./filesCopy";
export { createFilesCreateDirectoryTool } from "./filesCreateDirectory";
export { createFilesEditManyTool } from "./filesEditMany";
export { createFilesExactReplaceTool } from "./filesExactReplace";
export { createFilesInsertAtLineTool } from "./filesInsertAtLine";
export { createFilesMoveTool } from "./filesMove";
export { createFilesReplaceRangeTool } from "./filesReplaceRange";
export { createFilesReplaceSpanTool } from "./filesReplaceSpan";
export { createFilesWriteTool } from "./filesWrite";
export { createFilesWriteManyTool } from "./filesWriteMany";

export function createEditingTools(backend: EditingBackend = defaultEditingBackend): ToolDefinition[] {
  return [
    createFilesExactReplaceTool(backend),
    createFilesInsertAtLineTool(backend),
    createFilesReplaceRangeTool(backend),
    createFilesReplaceSpanTool(backend),
    createFilesAppendTool(backend),
    createFilesApplyPatchTool(backend),
    createFilesWriteTool(backend),
    createFilesWriteManyTool(backend),
    createFilesEditManyTool(backend),
    createFilesCopyTool(backend),
    createFilesCreateDirectoryTool(backend),
    createFilesMoveTool(backend),
  ];
}

export const editingTools: ToolDefinition[] = createEditingTools();
