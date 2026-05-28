import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  optionalStringArg,
  positiveIntegerArg,
  prepareExistingFileWrite,
  replaceTextSpanByLineColumn,
  stringArg,
  writePreparedText,
} from "./editUtils";

export function createFilesReplaceSpanTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Replace a precise 1-based line/column span in a workspace text file. " +
      "Use this after files_read_range when changing a single character, word, expression, or partial line is cleaner than replacing whole lines. " +
      "endColumn is exclusive; for one character at column N, use startColumn N and endColumn N+1. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const startLine = positiveIntegerArg(args.startLine);
      const endLine = positiveIntegerArg(args.endLine) ?? startLine;
      const startColumn = positiveIntegerArg(args.startColumn);
      const endColumn = positiveIntegerArg(args.endColumn);
      const content = typeof args.content === "string" ? args.content : undefined;
      const dryRun = booleanArg(args.dryRun);
      const expectedSha256 = optionalStringArg(args.expectedSha256);

      if (startLine === undefined || endLine === undefined) {
        return createErrorResult("files_replace_span requires a positive integer startLine. endLine is optional and defaults to startLine.");
      }

      if (startColumn === undefined || endColumn === undefined) {
        return createErrorResult("files_replace_span requires positive integer startColumn and endColumn values.");
      }

      if (content === undefined) {
        return createErrorResult("files_replace_span requires content. Use an empty string to delete the selected span.");
      }

      const path = stringArg(args.path);
      const prepared = await prepareExistingFileWrite(backend, context, args.path, (currentContent, currentSha256) => {
        if (expectedSha256 && currentSha256 && expectedSha256.toLowerCase() !== currentSha256.toLowerCase()) {
          return createErrorResult(`Refusing to edit because ${path || args.path} changed since it was last read. Re-read the current file section, then retry with fresh line and column coordinates.`);
        }

        const replacement = replaceTextSpanByLineColumn(currentContent, {
          content,
          endColumn,
          endLine,
          path,
          startColumn,
          startLine,
          toolId: "files_replace_span",
        });

        if (!replacement.ok) {
          return replacement;
        }

        return replacement.content;
      });

      if ("ok" in prepared) {
        return prepared;
      }

      return await writePreparedText(backend, context, prepared, {
        dryRun,
        kind: "update",
        overwrite: true,
        summary: `${dryRun ? "Previewed" : "Replaced"} span ${startLine}:${startColumn}-${endLine}:${endColumn} in \`${prepared.path}\`.`,
      });
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_replace_span",
    inputSchema: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Replacement text. Empty text deletes the selected span.",
          type: "string",
        },
        dryRun: {
          description: "Preview the change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        endColumn: {
          description: "1-based ending column, exclusive.",
          minimum: 1,
          type: "integer",
        },
        endLine: {
          description: "1-based ending line. Defaults to startLine for single-line edits.",
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
        startColumn: {
          description: "1-based starting column, inclusive.",
          minimum: 1,
          type: "integer",
        },
        startLine: {
          description: "1-based starting line.",
          minimum: 1,
          type: "integer",
        },
      },
      required: ["path", "startLine", "startColumn", "endColumn", "content"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Replace file text span",
  };
}
