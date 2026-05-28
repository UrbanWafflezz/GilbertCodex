import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  prepareExistingFileWrite,
  stringArg,
  writePreparedText,
} from "./editUtils";

export function createFilesExactReplaceTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Safely edit a text file by replacing exact text inside a workspace root. " +
      "Use this for precise code edits after reading the relevant range. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const oldText = stringArg(args.oldText);
      const newText = stringArg(args.newText);
      const replaceAll = booleanArg(args.replaceAll);
      const dryRun = booleanArg(args.dryRun);

      if (!oldText) {
        return createErrorResult("files_exact_replace requires non-empty oldText.");
      }

      const prepared = await prepareExistingFileWrite(backend, context, args.path, (content) => {
        const replacement = createExactTextReplacement(content, oldText, newText, replaceAll);

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
        summary: `${dryRun ? "Previewed" : "Applied"} exact replacement in \`${prepared.path}\`.`,
      });
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_exact_replace",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: {
          description: "Preview the change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        expectedSha256: {
          description: "Optional SHA-256 from the last read. Exact replacements re-read current content and anchor on oldText, so stale values do not block when the exact current text still matches.",
          minLength: 1,
          type: "string",
        },
        newText: {
          description: "Replacement text.",
          type: "string",
        },
        oldText: {
          description: "Exact text to replace.",
          minLength: 1,
          type: "string",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        replaceAll: {
          description: "Replace every exact match. Defaults to false, which requires exactly one match.",
          type: "boolean",
        },
      },
      required: ["path", "oldText", "newText"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Edit file by exact replace",
  };
}

export function createExactTextReplacement(content: string, oldText: string, newText: string, replaceAll: boolean) {
  const exactMatchCount = countOccurrences(content, oldText);

  if (exactMatchCount > 0) {
    if (!replaceAll && exactMatchCount > 1) {
      return createErrorResult(`Exact text matched ${exactMatchCount} times. Set replaceAll true or make oldText more specific.`);
    }

    return {
      content: replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText),
      ok: true as const,
    };
  }

  const normalizedContent = content.replace(/\r\n/g, "\n");
  const normalizedOldText = oldText.replace(/\r\n/g, "\n");
  const normalizedNewText = newText.replace(/\r\n/g, "\n");
  const normalizedMatchCount = countOccurrences(normalizedContent, normalizedOldText);

  if (normalizedMatchCount === 0) {
    return createErrorResult("Exact text was not found. Use files_read_range to inspect the current content before retrying, or use files_write for a reviewed whole-file replacement.");
  }

  if (!replaceAll && normalizedMatchCount > 1) {
    return createErrorResult(`Exact text matched ${normalizedMatchCount} times after normalizing line endings. Set replaceAll true or make oldText more specific.`);
  }

  const replaced = replaceAll
    ? normalizedContent.split(normalizedOldText).join(normalizedNewText)
    : normalizedContent.replace(normalizedOldText, normalizedNewText);

  return {
    content: content.includes("\r\n") ? replaced.replace(/\n/g, "\r\n") : replaced,
    ok: true as const,
  };
}

function countOccurrences(content: string, needle: string) {
  let count = 0;
  let index = content.indexOf(needle);

  while (index >= 0) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }

  return count;
}
