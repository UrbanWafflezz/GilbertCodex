import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import { createExactTextReplacement } from "./filesExactReplace";
import {
  booleanArg,
  createErrorResult,
  createStaleLineRangeError,
  joinEditableLines,
  normalizeResolvedPathKey,
  optionalStringArg,
  parseJsonArrayArg,
  positiveIntegerArg,
  replaceTextSpanByLineColumn,
  runBatchWorkers,
  splitEditableLines,
  splitReplacementLines,
  stringArg,
  stringArrayArg,
  writePreparedText,
  type PreparedTextWrite,
} from "./editUtils";

const MAX_CONCURRENT_BATCH_EDIT_FILES = 8;
const BATCH_EDIT_OPERATION_VALUES = ["append", "exact_replace", "insert_at_line", "replace_range", "replace_span"] as const;
const BROAD_BATCH_EDIT_MAX_REPLACED_LINES = 200;
const BROAD_BATCH_EDIT_RATIO_MIN_LINES = 40;
const BROAD_BATCH_EDIT_MAX_REPLACED_RATIO = 0.6;
const BROAD_BATCH_EDIT_MAX_REPLACED_CHARS = 30_000;
const BROAD_BATCH_EDIT_CHAR_RATIO_MIN_CHARS = 12_000;
const BROAD_BATCH_EDIT_MAX_REPLACED_CHAR_RATIO = 0.5;

type BatchEditOperation = typeof BATCH_EDIT_OPERATION_VALUES[number];

interface BatchEditItem {
  content?: string;
  endColumn?: number;
  endLine?: number;
  ensureNewline?: boolean;
  expectedSha256?: string;
  index: number;
  line?: number;
  newText?: string;
  oldText?: string;
  operation: BatchEditOperation;
  path: string;
  replaceAll?: boolean;
  resolvedPath: string;
  startColumn?: number;
  startLine?: number;
}

interface BatchEditItemResult {
  error?: string;
  ok: boolean;
  operation: BatchEditOperation;
  path?: string;
  requestedPath: string;
}

interface BatchEditFileResult {
  editIndexes: number[];
  error?: string;
  fileChanges?: unknown[];
  ok: boolean;
  path: string;
}

export function createFilesEditManyTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Batch precise edits across workspace text files. Use this for one or many same-pass edits; same-file edits run in order and each file is written once. " +
      "Prefer this over files_write_many for normal existing-file changes so localized edits stay small, reviewable, and batchable. " +
      "Supports exact_replace, replace_range, replace_span, insert_at_line, append, and dryRun previews.",
    execute: async (args, context) => {
      const dryRun = booleanArg(args.dryRun);
      const parsed = parseBatchEditItems(args, context);

      if (!("items" in parsed)) {
        return parsed;
      }

      const itemResults = new Array<BatchEditItemResult>(parsed.items.length);
      const groups = groupEditsByPath(parsed.items);
      const fileResults: BatchEditFileResult[] = [];
      const reportProgress = () => emitBatchEditProgress(context, fileResults, groups.length, dryRun);

      await runBatchWorkers(groups, MAX_CONCURRENT_BATCH_EDIT_FILES, async (group) => {
        const fileResult = await executeEditGroup(backend, context, group, dryRun);
        fileResults.push(fileResult);

        for (const item of group.items) {
          itemResults[item.index] = {
            error: fileResult.error,
            ok: fileResult.ok,
            operation: item.operation,
            path: fileResult.path,
            requestedPath: item.path,
          };
        }
        reportProgress();
      });

      return createBatchEditResult(itemResults, fileResults, dryRun);
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_edit_many",
    inputSchema: {
      additionalProperties: false,
      properties: {
        dryRun: {
          description: "Preview every file change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        edits: {
          description: "Ordered edit operations. Edits targeting the same path are applied in this array order.",
          items: {
            additionalProperties: false,
            properties: {
              content: {
                description: "Text for append, insert_at_line, replace_range, or replace_span. Empty text deletes a range/span.",
                type: "string",
              },
              endColumn: {
                description: "1-based exclusive ending column for replace_span.",
                minimum: 1,
                type: "integer",
              },
              endChar: {
                description: "Alias for endColumn.",
                minimum: 1,
                type: "integer",
              },
              end_char: {
                description: "Snake-case alias for endColumn.",
                minimum: 1,
                type: "integer",
              },
              end_column: {
                description: "Snake-case exclusive ending column for replace_span.",
                minimum: 1,
                type: "integer",
              },
              endLine: {
                description: "1-based ending line number for replace_range or replace_span. Defaults to startLine for replace_span.",
                minimum: 1,
                type: "integer",
              },
              end_line: {
                description: "Snake-case ending line number for replace_range.",
                minimum: 1,
                type: "integer",
              },
              ensureNewline: {
                description: "For append, insert a line break before content when needed. Defaults to true.",
                type: "boolean",
              },
              ensure_newline: {
                description: "Snake-case append newline option.",
                type: "boolean",
              },
              expectedSha256: {
                description: "Optional SHA-256 from the last read. Location-based edits refuse stale hashes; append and exact_replace re-anchor to current content.",
                minLength: 1,
                type: "string",
              },
              expected_sha256: {
                description: "Snake-case expected SHA-256.",
                minLength: 1,
                type: "string",
              },
              line: {
                description: "1-based insertion line for insert_at_line.",
                minimum: 1,
                type: "integer",
              },
              newText: {
                description: "Replacement text for exact_replace.",
                type: "string",
              },
              new_text: {
                description: "Snake-case replacement text for exact_replace.",
                type: "string",
              },
              oldText: {
                description: "Exact text to replace for exact_replace.",
                minLength: 1,
                type: "string",
              },
              old_text: {
                description: "Snake-case exact text to replace for exact_replace.",
                minLength: 1,
                type: "string",
              },
              operation: {
                description: "Edit operation to apply.",
                enum: [...BATCH_EDIT_OPERATION_VALUES],
                type: "string",
              },
              path: {
                description: "Absolute path or path relative to the first workspace root.",
                minLength: 1,
                type: "string",
              },
              replaceAll: {
                description: "For exact_replace, replace every exact match. Defaults to false.",
                type: "boolean",
              },
              replace_all: {
                description: "Snake-case replaceAll option.",
                type: "boolean",
              },
              startLine: {
                description: "1-based starting line number for replace_range.",
                minimum: 1,
                type: "integer",
              },
              start_line: {
                description: "Snake-case starting line number for replace_range.",
                minimum: 1,
                type: "integer",
              },
              startColumn: {
                description: "1-based inclusive starting column for replace_span.",
                minimum: 1,
                type: "integer",
              },
              startChar: {
                description: "Alias for startColumn.",
                minimum: 1,
                type: "integer",
              },
              start_char: {
                description: "Snake-case alias for startColumn.",
                minimum: 1,
                type: "integer",
              },
              start_column: {
                description: "Snake-case inclusive starting column for replace_span.",
                minimum: 1,
                type: "integer",
              },
              type: {
                description: "Operation alias. Prefer operation.",
                enum: [...BATCH_EDIT_OPERATION_VALUES],
                type: "string",
              },
            },
            required: ["path"],
            type: "object",
          },
          minItems: 1,
          type: "array",
        },
        editsJson: {
          description: "JSON array fallback for edits. Prefer edits when using native tool calls.",
          minLength: 1,
          type: "string",
        },
        edits_json: {
          description: "Snake-case JSON array fallback for edits.",
          minLength: 1,
          type: "string",
        },
        newText: {
          description: "Broadcast exact_replace replacement text when paths is used.",
          type: "string",
        },
        newTexts: {
          description: "Replacement texts matching paths when paths is used.",
          items: { type: "string" },
          type: "array",
        },
        new_text: {
          description: "Snake-case broadcast replacement text when paths is used.",
          type: "string",
        },
        new_texts: {
          description: "Snake-case replacement texts matching paths when paths is used.",
          items: { type: "string" },
          type: "array",
        },
        content: {
          description: "Single-edit shorthand content for append, insert_at_line, replace_range, or replace_span when path is used.",
          type: "string",
        },
        endColumn: {
          description: "Single-edit shorthand 1-based exclusive ending column for replace_span.",
          minimum: 1,
          type: "integer",
        },
        endChar: {
          description: "Single-edit shorthand alias for endColumn.",
          minimum: 1,
          type: "integer",
        },
        end_char: {
          description: "Snake-case single-edit shorthand alias for endColumn.",
          minimum: 1,
          type: "integer",
        },
        end_column: {
          description: "Snake-case single-edit shorthand exclusive ending column.",
          minimum: 1,
          type: "integer",
        },
        endLine: {
          description: "Single-edit shorthand 1-based ending line number for replace_range or replace_span when path is used.",
          minimum: 1,
          type: "integer",
        },
        end_line: {
          description: "Snake-case single-edit shorthand ending line number.",
          minimum: 1,
          type: "integer",
        },
        expectedSha256: {
          description: "Single-edit shorthand expected SHA-256. Location-based edits refuse stale hashes; append and exact_replace re-anchor to current content.",
          minLength: 1,
          type: "string",
        },
        expected_sha256: {
          description: "Snake-case single-edit shorthand expected SHA-256.",
          minLength: 1,
          type: "string",
        },
        line: {
          description: "Single-edit shorthand 1-based insertion line for insert_at_line when path is used.",
          minimum: 1,
          type: "integer",
        },
        oldText: {
          description: "Broadcast exact text when paths is used.",
          minLength: 1,
          type: "string",
        },
        oldTexts: {
          description: "Exact texts matching paths when paths is used.",
          items: { type: "string" },
          type: "array",
        },
        old_text: {
          description: "Snake-case broadcast exact text when paths is used.",
          minLength: 1,
          type: "string",
        },
        old_texts: {
          description: "Snake-case exact texts matching paths when paths is used.",
          items: { type: "string" },
          type: "array",
        },
        paths: {
          description: "Legacy shorthand paths for exact_replace batches. Prefer edits.",
          items: {
            minLength: 1,
            type: "string",
          },
          minItems: 1,
          type: "array",
        },
        path: {
          description: "Single-edit shorthand path. Prefer edits for new callers.",
          minLength: 1,
          type: "string",
        },
        operation: {
          description: "Single-edit shorthand operation when path is used.",
          enum: [...BATCH_EDIT_OPERATION_VALUES],
          type: "string",
        },
        replaceAll: {
          description: "Broadcast replaceAll for paths shorthand.",
          type: "boolean",
        },
        replace_all: {
          description: "Snake-case broadcast replaceAll for paths shorthand.",
          type: "boolean",
        },
        startLine: {
          description: "Single-edit shorthand 1-based starting line number for replace_range when path is used.",
          minimum: 1,
          type: "integer",
        },
        start_line: {
          description: "Snake-case single-edit shorthand starting line number.",
          minimum: 1,
          type: "integer",
        },
        startColumn: {
          description: "Single-edit shorthand 1-based inclusive starting column for replace_span.",
          minimum: 1,
          type: "integer",
        },
        startChar: {
          description: "Single-edit shorthand alias for startColumn.",
          minimum: 1,
          type: "integer",
        },
        start_char: {
          description: "Snake-case single-edit shorthand alias for startColumn.",
          minimum: 1,
          type: "integer",
        },
        start_column: {
          description: "Snake-case single-edit shorthand inclusive starting column.",
          minimum: 1,
          type: "integer",
        },
        type: {
          description: "Single-edit shorthand operation alias. Prefer operation.",
          enum: [...BATCH_EDIT_OPERATION_VALUES],
          type: "string",
        },
      },
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Edit many workspace files",
  };
}

async function executeEditGroup(
  backend: EditingBackend,
  context: ToolExecutionContext,
  group: { items: BatchEditItem[]; path: string },
  dryRun: boolean,
): Promise<BatchEditFileResult> {
  let file;

  try {
    file = await backend.readTextFile(group.path);
  } catch (error) {
    return {
      editIndexes: group.items.map((item) => item.index),
      error: error instanceof Error ? error.message : "Could not read file before editing.",
      ok: false,
      path: group.path,
    };
  }

  let nextContent = file.content;

  for (const item of group.items) {
    if (item.expectedSha256 && file.sha256 && item.expectedSha256.toLowerCase() !== file.sha256.toLowerCase() && requiresFreshShaForBatchEdit(item.operation)) {
      return {
        editIndexes: group.items.map((edit) => edit.index),
        error: [
          `Refusing to edit because \`${file.path}\` changed since it was last read.`,
          "This operation uses line or column positions that may be stale. Re-read the current file section, then retry with fresh coordinates or exact_replace anchored to current text.",
        ].join(" "),
        ok: false,
        path: file.path,
      };
    }

    const applied = applyBatchEditOperation(nextContent, item);

    if (!applied.ok) {
      return {
        editIndexes: group.items.map((edit) => edit.index),
        error: applied.error ?? applied.content,
        ok: false,
        path: file.path,
      };
    }

    nextContent = applied.content;
  }

  const prepared: PreparedTextWrite = {
    after: nextContent,
    before: file.content,
    created: false,
    expectedSha256: file.sha256,
    path: file.path,
  };
  const result = await writePreparedText(backend, context, prepared, {
    dryRun,
    kind: "update",
    overwrite: true,
    summary: `${dryRun ? "Previewed" : "Applied"} ${group.items.length} edit${group.items.length === 1 ? "" : "s"} in \`${file.path}\`.`,
  });

  if (!result.ok) {
    return {
      editIndexes: group.items.map((item) => item.index),
      error: result.error ?? result.content,
      ok: false,
      path: file.path,
    };
  }

  const data = result.data as { fileChanges?: unknown[] } | undefined;
  return {
    editIndexes: group.items.map((item) => item.index),
    fileChanges: Array.isArray(data?.fileChanges) ? data.fileChanges : [],
    ok: true,
    path: file.path,
  };
}

function applyBatchEditOperation(content: string, item: BatchEditItem): { content: string; ok: true } | ToolExecutionResult {
  if (item.operation === "exact_replace") {
    const oldText = item.oldText ?? "";

    if (!oldText) {
      return createErrorResult("files_edit_many exact_replace requires non-empty oldText.");
    }

    const broadEditError = createBroadBatchEditGuardError(content, item, oldText);
    if (broadEditError) {
      return broadEditError;
    }

    return createExactTextReplacement(content, oldText, item.newText ?? "", item.replaceAll === true);
  }

  if (item.operation === "insert_at_line") {
    if (item.line === undefined) {
      return createErrorResult("files_edit_many insert_at_line requires a positive integer line.");
    }
    if (!item.content) {
      return createErrorResult("files_edit_many insert_at_line requires non-empty content.");
    }

    const editable = splitEditableLines(content);
    const insertLines = splitReplacementLines(item.content);
    const maxLine = editable.lines.length + 1;

    if (item.line > maxLine) {
      return createErrorResult(`Cannot insert at line ${item.line}; file has ${editable.lines.length} line${editable.lines.length === 1 ? "" : "s"}.`);
    }

    const nextLines = [...editable.lines];
    nextLines.splice(item.line - 1, 0, ...insertLines);
    return {
      content: joinEditableLines({ ...editable, lines: nextLines }),
      ok: true,
    };
  }

  if (item.operation === "replace_range") {
    if (item.startLine === undefined || item.endLine === undefined) {
      return createErrorResult("files_edit_many replace_range requires positive integer startLine and endLine values.");
    }
    if (item.endLine < item.startLine) {
      return createErrorResult("files_edit_many replace_range endLine must be greater than or equal to startLine.");
    }

    const editable = splitEditableLines(content);

    if (item.startLine > editable.lines.length || item.endLine > editable.lines.length) {
      return createErrorResult(createStaleLineRangeError({
        editIndex: item.index,
        endLine: item.endLine,
        lineCount: editable.lines.length,
        path: item.path,
        startLine: item.startLine,
        toolId: "files_edit_many",
      }));
    }

    const replacedLines = editable.lines.slice(item.startLine - 1, item.endLine).join(editable.eol);
    const broadEditError = createBroadBatchEditGuardError(content, item, replacedLines, item.endLine - item.startLine + 1);
    if (broadEditError) {
      return broadEditError;
    }

    const replacementLines = splitReplacementLines(item.content ?? "");
    const nextLines = [...editable.lines];
    nextLines.splice(item.startLine - 1, item.endLine - item.startLine + 1, ...replacementLines);
    return {
      content: joinEditableLines({ ...editable, lines: nextLines }),
      ok: true,
    };
  }

  if (item.operation === "replace_span") {
    const endLine = item.endLine ?? item.startLine;

    if (item.startLine === undefined || endLine === undefined) {
      return createErrorResult("files_edit_many replace_span requires a positive integer startLine. endLine is optional and defaults to startLine.");
    }
    if (item.startColumn === undefined || item.endColumn === undefined) {
      return createErrorResult("files_edit_many replace_span requires positive integer startColumn and endColumn values.");
    }

    const editable = splitEditableLines(content);
    if (item.startLine <= editable.lines.length && endLine <= editable.lines.length) {
      const broadEditError = createBroadBatchEditGuardError(content, item, "", Math.max(1, endLine - item.startLine + 1));
      if (broadEditError) {
        return broadEditError;
      }
    }

    return replaceTextSpanByLineColumn(content, {
      content: item.content ?? item.newText ?? "",
      editIndex: item.index,
      endColumn: item.endColumn,
      endLine,
      path: item.path,
      startColumn: item.startColumn,
      startLine: item.startLine,
      toolId: "files_edit_many",
    });
  }

  if (!item.content) {
    return createErrorResult("files_edit_many append requires non-empty content.");
  }

  const eol = splitEditableLines(content).eol;
  const ensureNewline = item.ensureNewline !== false;
  const separator = ensureNewline && content && !content.endsWith("\n") && !item.content.startsWith("\n") && !item.content.startsWith("\r\n")
    ? eol
    : "";

  return {
    content: `${content}${separator}${item.content}`,
    ok: true,
  };
}

function createBroadBatchEditGuardError(content: string, item: BatchEditItem, replacedText: string, replacedLineCount?: number) {
  const editable = splitEditableLines(content);
  const totalLines = Math.max(editable.lines.length, 1);
  const replacedLines = Math.max(1, replacedLineCount ?? splitReplacementLines(replacedText).length);
  const replacedLineRatio = replacedLines / totalLines;
  const totalChars = Math.max(content.length, 1);
  const replacedChars = Math.max(0, replacedText.length);
  const replacedCharRatio = replacedChars / totalChars;
  const lineReason = replacedLines >= BROAD_BATCH_EDIT_MAX_REPLACED_LINES ||
    (replacedLines >= BROAD_BATCH_EDIT_RATIO_MIN_LINES && replacedLineRatio >= BROAD_BATCH_EDIT_MAX_REPLACED_RATIO);
  const charReason = replacedChars >= BROAD_BATCH_EDIT_MAX_REPLACED_CHARS ||
    (replacedChars >= BROAD_BATCH_EDIT_CHAR_RATIO_MIN_CHARS && replacedCharRatio >= BROAD_BATCH_EDIT_MAX_REPLACED_CHAR_RATIO);

  if (!lineReason && !charReason) {
    return undefined;
  }

  const reason = lineReason
    ? `${replacedLines.toLocaleString("en-US")} of ${totalLines.toLocaleString("en-US")} lines`
    : `${replacedChars.toLocaleString("en-US")} of ${totalChars.toLocaleString("en-US")} characters`;

  return createErrorResult([
    `Refusing broad edit in \`${item.path}\` edits[${item.index}]: ${item.operation} would replace ${reason}.`,
    "files_edit_many is for narrow anchored edits, not near whole-file rewrites.",
    "Re-read the intended section and retry with a smaller unique oldText, replace_span, replace_range, or files_apply_patch anchored to the target block.",
    "Use files_write or files_write_many with allowWholeFileReplacement:true only for an intentional reviewed full-file rewrite.",
  ].join(" "));
}

function createBatchEditResult(
  itemResults: BatchEditItemResult[],
  fileResults: BatchEditFileResult[],
  dryRun: boolean,
): ToolExecutionResult {
  const successCount = itemResults.filter((result) => result?.ok).length;
  const failureCount = itemResults.filter((result) => result && !result.ok).length;
  const changedFileCount = fileResults.filter((result) => result.ok).length;
  const failedFileCount = fileResults.filter((result) => !result.ok).length;
  const fileChanges = fileResults.flatMap((result) => result.fileChanges ?? []);
  const errorSummary = fileResults
    .filter((result) => !result.ok)
    .map((result) => `${result.path}: ${result.error ?? "Could not edit file."}`)
    .join("\n");
  const lines = [
    `${dryRun ? "Dry run: previewed" : "Applied"} ${successCount} of ${itemResults.length} requested edit${itemResults.length === 1 ? "" : "s"} across ${changedFileCount} file${changedFileCount === 1 ? "" : "s"}${failureCount > 0 ? ` (${failureCount} failed)` : ""}.`,
  ];

  for (const fileResult of fileResults.sort((left, right) => left.path.localeCompare(right.path))) {
    if (fileResult.ok) {
      lines.push(`--- \`${fileResult.path}\`\n[OK] ${dryRun ? "Previewed" : "Updated"} ${fileResult.editIndexes.length} edit${fileResult.editIndexes.length === 1 ? "" : "s"}.`);
    } else {
      lines.push(`--- \`${fileResult.path}\`\n[ERROR] ${fileResult.error ?? "Could not edit file."}`);
    }
  }

  return {
    content: lines.join("\n\n"),
    data: {
      dryRun,
      failureCount,
      fileChanges,
      files: fileResults,
      batchSummary: {
        failureCount: failedFileCount,
        fileCount: fileResults.length,
        operation: "edit",
        requestedCount: fileResults.length,
        skippedCount: 0,
        successCount: changedFileCount,
      },
      requestedCount: itemResults.length,
      successCount,
    } as unknown as JsonValue,
    error: successCount === 0 && errorSummary ? errorSummary : undefined,
    ok: successCount > 0,
  };
}

function emitBatchEditProgress(
  context: ToolExecutionContext,
  fileResults: BatchEditFileResult[],
  fileCount: number,
  dryRun: boolean,
) {
  if (!context.reportProgress || fileResults.length === 0) {
    return;
  }

  const successCount = fileResults.filter((result) => result.ok).length;
  const failureCount = fileResults.filter((result) => !result.ok).length;
  const fileChanges = fileResults.flatMap((result) => result.fileChanges ?? []);
  const processedCount = successCount + failureCount;

  try {
    context.reportProgress({
      content: `${dryRun ? "Previewed" : "Processed"} ${processedCount} of ${fileCount} file${fileCount === 1 ? "" : "s"}.`,
      data: {
        dryRun,
        failureCount,
        fileChanges,
        files: fileResults,
        batchSummary: {
          failureCount,
          fileCount,
          operation: "edit",
          requestedCount: fileCount,
          skippedCount: 0,
          successCount,
        },
        requestedCount: fileCount,
        skippedCount: 0,
        successCount,
      } as unknown as JsonValue,
      ok: successCount > 0 || failureCount === 0,
    });
  } catch {
    // Progress observers are best-effort; the edit itself should keep going.
  }
}

function parseBatchEditItems(args: Record<string, unknown>, context: ToolExecutionContext): { items: BatchEditItem[]; ok: true } | ToolExecutionResult {
  const rawItems = readRawEditItems(args);

  if (!Array.isArray(rawItems)) {
    return createErrorResult("files_edit_many requires edits, editsJson, or paths with oldText/newText.");
  }

  if (rawItems.length === 0) {
    return createErrorResult("files_edit_many requires at least one edit item.");
  }

  const items: BatchEditItem[] = [];

  for (const [index, rawItem] of rawItems.entries()) {
    const parsed = parseBatchEditItem(rawItem, index, context);

    if (!("item" in parsed)) {
      return parsed;
    }

    items.push(parsed.item);
  }

  return { items, ok: true };
}

function readRawEditItems(args: Record<string, unknown>) {
  if (Array.isArray(args.edits)) {
    return args.edits;
  }

  const editsJson = parseJsonArrayArg(args.editsJson ?? args.edits_json, "edits");
  if (editsJson) {
    return editsJson;
  }

  const singlePath = stringArg(args.path);
  if (singlePath) {
    return [{
      content: typeof args.content === "string" ? args.content : undefined,
      endColumn: args.endColumn ?? args.end_column ?? args.endChar ?? args.end_char,
      endLine: args.endLine ?? args.end_line,
      ensureNewline: args.ensureNewline ?? args.ensure_newline ?? args.insertNewlineBeforeContent,
      expectedSha256: args.expectedSha256 ?? args.expected_sha256,
      line: args.line,
      newText: typeof (args.newText ?? args.new_text) === "string" ? String(args.newText ?? args.new_text) : undefined,
      oldText: optionalStringArg(args.oldText ?? args.old_text),
      operation: args.operation ?? args.type,
      path: singlePath,
      replaceAll: args.replaceAll ?? args.replace_all,
      startColumn: args.startColumn ?? args.start_column ?? args.startChar ?? args.start_char,
      startLine: args.startLine ?? args.start_line,
    }];
  }

  const paths = stringArrayArg(args.paths);
  if (paths.length === 0) {
    return undefined;
  }

  const oldTexts = stringArrayArg(args.oldTexts ?? args.old_texts);
  const newTexts = stringArrayArg(args.newTexts ?? args.new_texts);
  const oldText = optionalStringArg(args.oldText ?? args.old_text);
  const newText = typeof (args.newText ?? args.new_text) === "string" ? String(args.newText ?? args.new_text) : undefined;
  const replaceAll = booleanArg(args.replaceAll ?? args.replace_all);

  return paths.map((path, index) => ({
    newText: newTexts[index] ?? newText ?? "",
    oldText: oldTexts[index] ?? oldText ?? "",
    operation: "exact_replace",
    path,
    replaceAll,
  }));
}

function parseBatchEditItem(rawItem: unknown, index: number, context: ToolExecutionContext): { item: BatchEditItem; ok: true } | ToolExecutionResult {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    return createErrorResult(`files_edit_many edits[${index}] must be an object.`);
  }

  const record = rawItem as Record<string, unknown>;
  const path = stringArg(record.path);

  if (!path) {
    return createErrorResult(`files_edit_many edits[${index}] requires path.`);
  }

  const operation = normalizeOperation(record.operation ?? record.type, record);

  if (!operation) {
    return createErrorResult(`files_edit_many edits[${index}] requires a supported operation.`);
  }

  const resolution = tryResolveAllowedPath(context, path);

  if (!resolution.ok) {
    return {
      content: resolution.error.message,
      error: resolution.error.message,
      ok: false,
    };
  }

  return {
    item: {
      content: typeof record.content === "string" ? record.content : undefined,
      endColumn: positiveIntegerArg(record.endColumn ?? record.end_column ?? record.endChar ?? record.end_char),
      endLine: positiveIntegerArg(record.endLine ?? record.end_line),
      ensureNewline: typeof (record.ensureNewline ?? record.ensure_newline ?? record.insertNewlineBeforeContent) === "boolean" ? Boolean(record.ensureNewline ?? record.ensure_newline ?? record.insertNewlineBeforeContent) : undefined,
      expectedSha256: optionalStringArg(record.expectedSha256 ?? record.expected_sha256),
      index,
      line: positiveIntegerArg(record.line),
      newText: typeof (record.newText ?? record.new_text) === "string" ? String(record.newText ?? record.new_text) : undefined,
      oldText: optionalStringArg(record.oldText ?? record.old_text),
      operation,
      path,
      replaceAll: booleanArg(record.replaceAll ?? record.replace_all),
      resolvedPath: resolution.path.resolved,
      startColumn: positiveIntegerArg(record.startColumn ?? record.start_column ?? record.startChar ?? record.start_char),
      startLine: positiveIntegerArg(record.startLine ?? record.start_line),
    },
    ok: true,
  };
}

function normalizeOperation(value: unknown, record: Record<string, unknown>): BatchEditOperation | undefined {
  const operation = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (operation === "exact_replace" || operation === "replace" || operation === "search_replace" || operation === "text_replace") {
    return "exact_replace";
  }
  if (operation === "replace_range" || operation === "line_range" || operation === "range") {
    return "replace_range";
  }
  if (operation === "replace_span" || operation === "span_replace" || operation === "line_column_span" || operation === "column_range" || operation === "char_range" || operation === "replace_chars") {
    return "replace_span";
  }
  if (operation === "insert_at_line" || operation === "insert" || operation === "insert_line") {
    return "insert_at_line";
  }
  if (operation === "append" || operation === "append_file") {
    return "append";
  }

  if ((record.oldText ?? record.old_text) !== undefined) {
    return "exact_replace";
  }
  if (
    (record.startColumn ?? record.start_column ?? record.startChar ?? record.start_char) !== undefined ||
    (record.endColumn ?? record.end_column ?? record.endChar ?? record.end_char) !== undefined
  ) {
    return "replace_span";
  }
  if ((record.startLine ?? record.start_line) !== undefined || (record.endLine ?? record.end_line) !== undefined) {
    return "replace_range";
  }
  if (record.line !== undefined) {
    return "insert_at_line";
  }
  if (record.content !== undefined) {
    return "append";
  }

  return undefined;
}

function requiresFreshShaForBatchEdit(operation: BatchEditOperation) {
  return operation === "insert_at_line" || operation === "replace_range" || operation === "replace_span";
}

function groupEditsByPath(items: BatchEditItem[]) {
  const groups = new Map<string, { items: BatchEditItem[]; path: string }>();

  for (const item of items) {
    const key = normalizeResolvedPathKey(item.resolvedPath);
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { items: [item], path: item.resolvedPath });
    }
  }

  return [...groups.values()];
}
