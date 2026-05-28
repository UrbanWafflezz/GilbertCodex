import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  createStaleLineRangeError,
  joinEditableLines,
  optionalStringArg,
  positiveIntegerArg,
  prepareExistingFileWrite,
  splitEditableLines,
  splitReplacementLines,
  stringArg,
  writePreparedText,
} from "./editUtils";

export function createFilesReplaceRangeTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Replace an inclusive 1-based line range in a workspace text file. " +
      "Use this after files_read_range when replacing whole lines is cleaner than exact text replacement. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const startLine = positiveIntegerArg(args.startLine);
      const endLine = positiveIntegerArg(args.endLine);
      const content = stringArg(args.content);
      const dryRun = booleanArg(args.dryRun);
      const expectedSha256 = optionalStringArg(args.expectedSha256);

      if (startLine === undefined || endLine === undefined) {
        return createErrorResult("files_replace_range requires positive integer startLine and endLine values.");
      }

      if (endLine < startLine) {
        return createErrorResult("files_replace_range endLine must be greater than or equal to startLine.");
      }

      const prepared = await prepareExistingFileWrite(backend, context, args.path, (currentContent, currentSha256) => {
        if (expectedSha256 && currentSha256 && expectedSha256.toLowerCase() !== currentSha256.toLowerCase()) {
          return createErrorResult(`Refusing to edit because ${args.path} changed since it was last read. Re-read the current file section, then retry with a fresh line range or exact_replace anchored to current text.`);
        }

        const editable = splitEditableLines(currentContent);

        if (startLine > editable.lines.length || endLine > editable.lines.length) {
          return createErrorResult(createStaleLineRangeError({
            endLine,
            lineCount: editable.lines.length,
            path: stringArg(args.path),
            startLine,
            toolId: "files_replace_range",
          }));
        }

        const replacementLines = splitReplacementLines(content);
        const nextLines = [...editable.lines];
        nextLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);

        return joinEditableLines({
          ...editable,
          lines: nextLines,
        });
      });

      if ("ok" in prepared) {
        return prepared;
      }

      return await writePreparedText(backend, context, prepared, {
        dryRun,
        kind: "update",
        overwrite: true,
        summary: `${dryRun ? "Previewed" : "Replaced"} lines ${startLine}-${endLine} in \`${prepared.path}\`.`,
      });
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_replace_range",
    inputSchema: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Replacement text. Empty text deletes the selected line range.",
          type: "string",
        },
        dryRun: {
          description: "Preview the change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        endLine: {
          description: "1-based ending line number, inclusive.",
          minimum: 1,
          type: "integer",
        },
        expectedSha256: {
          description: "Optional SHA-256 from the last read. The edit is refused if the file changed.",
          minLength: 1,
          type: "string",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        startLine: {
          description: "1-based starting line number, inclusive.",
          minimum: 1,
          type: "integer",
        },
      },
      required: ["path", "startLine", "endLine", "content"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Replace file line range",
  };
}
