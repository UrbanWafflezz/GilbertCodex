import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  prepareExistingFileWrite,
  splitEditableLines,
  stringArg,
  writePreparedText,
} from "./editUtils";

export function createFilesAppendTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Append text to the end of an existing workspace text file. " +
      "Use this for small additions such as exports, notes, or config entries. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const content = stringArg(args.content);
      const dryRun = booleanArg(args.dryRun);
      const ensureNewline = args.ensureNewline !== false;

      if (!content) {
        return createErrorResult("files_append requires non-empty content.");
      }

      const prepared = await prepareExistingFileWrite(backend, context, args.path, (currentContent) => {
        const eol = splitEditableLines(currentContent).eol;
        const separator = ensureNewline && currentContent && !currentContent.endsWith("\n") && !content.startsWith("\n") && !content.startsWith("\r\n")
          ? eol
          : "";

        return `${currentContent}${separator}${content}`;
      });

      if ("ok" in prepared) {
        return prepared;
      }

      return await writePreparedText(backend, context, prepared, {
        dryRun,
        kind: "update",
        overwrite: true,
        summary: `${dryRun ? "Previewed" : "Appended"} text to \`${prepared.path}\`.`,
      });
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_append",
    inputSchema: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Text to append.",
          minLength: 1,
          type: "string",
        },
        dryRun: {
          description: "Preview the change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        ensureNewline: {
          description: "When true, insert one line break before appended content if the file does not already end with one. Defaults to true.",
          type: "boolean",
        },
        expectedSha256: {
          description: "Optional SHA-256 from the last read. Appends re-read the latest file before writing, so stale values do not block safe append-only changes.",
          minLength: 1,
          type: "string",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["path", "content"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Append to workspace file",
  };
}
