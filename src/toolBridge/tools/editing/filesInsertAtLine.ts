import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  joinEditableLines,
  optionalStringArg,
  positiveIntegerArg,
  prepareExistingFileWrite,
  splitEditableLines,
  splitReplacementLines,
  stringArg,
  writePreparedText,
} from "./editUtils";

export function createFilesInsertAtLineTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Insert text before a precise 1-based line in a workspace text file. " +
      "Use this after files_read_range when the model knows the exact insertion point. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const line = positiveIntegerArg(args.line);
      const content = stringArg(args.content);
      const dryRun = booleanArg(args.dryRun);
      const expectedSha256 = optionalStringArg(args.expectedSha256);

      if (line === undefined) {
        return createErrorResult("files_insert_at_line requires a positive integer line.");
      }

      if (!content) {
        return createErrorResult("files_insert_at_line requires non-empty content.");
      }

      const prepared = await prepareExistingFileWrite(backend, context, args.path, (currentContent, currentSha256) => {
        if (expectedSha256 && currentSha256 && expectedSha256.toLowerCase() !== currentSha256.toLowerCase()) {
          return createErrorResult(`Refusing to edit because ${args.path} changed since it was last read. Re-read the current file section, then retry with a fresh insertion line.`);
        }

        const editable = splitEditableLines(currentContent);
        const insertLines = splitReplacementLines(content);
        const maxLine = editable.lines.length + 1;

        if (line > maxLine) {
          return createErrorResult(`Cannot insert at line ${line}; ${args.path} has ${editable.lines.length} line${editable.lines.length === 1 ? "" : "s"}.`);
        }

        const nextLines = [...editable.lines];
        nextLines.splice(line - 1, 0, ...insertLines);

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
        summary: `${dryRun ? "Previewed" : "Inserted"} text at line ${line} in \`${prepared.path}\`.`,
      });
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_insert_at_line",
    inputSchema: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Text to insert. A trailing newline is not required.",
          minLength: 1,
          type: "string",
        },
        dryRun: {
          description: "Preview the change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        expectedSha256: {
          description: "Optional SHA-256 from the last read. The edit is refused if the file changed.",
          minLength: 1,
          type: "string",
        },
        line: {
          description: "1-based line to insert before. Use totalLines + 1 to append at end of file.",
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["path", "line", "content"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Insert text at line",
  };
}
