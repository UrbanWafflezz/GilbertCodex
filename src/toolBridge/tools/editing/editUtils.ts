import type { JsonValue, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import type { EditingBackend } from "./backend";
import { createTextChangePreview, formatFileChangeSummary } from "./diffPreview";

export interface PreparedTextWrite {
  after: string;
  before: string;
  created: boolean;
  expectedSha256?: string;
  path: string;
}

export interface EditableLines {
  eol: "\n" | "\r\n";
  hasTrailingNewline: boolean;
  lines: string[];
}

export function booleanArg(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function stringArg(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function optionalStringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringArrayArg(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function positiveIntegerArg(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

export function splitEditableLines(content: string): EditableLines {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  const hasTrailingNewline = content.endsWith("\n") || content.endsWith("\r\n");

  if (!normalized) {
    return {
      eol,
      hasTrailingNewline,
      lines: [],
    };
  }

  const lines = normalized.split("\n");
  return {
    eol,
    hasTrailingNewline,
    lines: hasTrailingNewline ? lines.slice(0, -1) : lines,
  };
}

export function splitReplacementLines(content: string) {
  if (!content) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  return normalized.endsWith("\n") ? lines.slice(0, -1) : lines;
}

export function normalizeForceEol(value: unknown): "crlf" | "lf" | undefined {
  return value === "crlf" || value === "lf" ? value : undefined;
}

export function normalizeResolvedPathKey(path: string) {
  return path.replace(/\\/g, "/");
}

export function parseJsonArrayArg(value: unknown, propertyName: string) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      const nested = (parsed as Record<string, unknown>)[propertyName];
      return Array.isArray(nested) ? nested : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function runBatchWorkers<T>(
  items: T[],
  maxConcurrency: number,
  work: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await work(items[currentIndex]!);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function readOptionalExistingFile(
  backend: EditingBackend,
  path: string,
): Promise<
  | {
      content: string;
      ok: true;
      path: string;
      sha256?: string;
    }
  | ToolExecutionResult
> {
  try {
    const file = await backend.readTextFile(path);
    return {
      content: file.content,
      ok: true,
      path: file.path,
      sha256: file.sha256,
    };
  } catch (error) {
    const errorMessage = readErrorMessage(error, "Could not inspect target file.");
    const message = errorMessage.toLowerCase();

    if (isMissingFileError(message)) {
      return { content: "", ok: false };
    }

    return {
      content: errorMessage,
      error: errorMessage,
      ok: false,
    };
  }
}

export function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

export function isMissingFileError(message: string) {
  return (
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("cannot find") ||
    message.includes("no such file") ||
    message.includes("os error 2") ||
    message.includes("os error 3")
  );
}

export function joinEditableLines(value: EditableLines) {
  const content = value.lines.join(value.eol);
  return value.hasTrailingNewline && value.lines.length > 0 ? `${content}${value.eol}` : content;
}

export async function prepareExistingFileWrite(
  backend: EditingBackend,
  context: ToolExecutionContext,
  pathArg: unknown,
  nextContent: (currentContent: string, currentSha256?: string) => string | ToolExecutionResult,
): Promise<PreparedTextWrite | ToolExecutionResult> {
  const resolution = tryResolveAllowedPath(context, pathArg);

  if (!resolution.ok) {
    return resolutionToResult(resolution.error);
  }

  try {
    const file = await backend.readTextFile(resolution.path.resolved);
    const content = nextContent(file.content, file.sha256);

    if (isToolResult(content)) {
      return content;
    }

    return {
      after: content,
      before: file.content,
      created: false,
      expectedSha256: file.sha256,
      path: file.path,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file before editing.";
    return {
      content: message,
      error: message,
      ok: false,
    };
  }
}

export async function writePreparedText(
  backend: EditingBackend,
  context: ToolExecutionContext,
  prepared: PreparedTextWrite,
  options: {
    allowWholeFileReplacement?: boolean;
    broadWriteGuard?: boolean;
    createParentDirs?: boolean;
    dryRun: boolean;
    forceEol?: "crlf" | "lf";
    kind?: "create" | "update";
    overwrite?: boolean;
    summary: string;
  },
): Promise<ToolExecutionResult> {
  const preview = createTextChangePreview(prepared.path, prepared.before, prepared.after, options.kind ?? (prepared.created ? "create" : "update"));
  const roots = context.workspaceRoots ?? [];

  if (!prepared.created && options.broadWriteGuard === true && !options.dryRun && options.allowWholeFileReplacement !== true) {
    const guardReason = getPreciseEditGuardReason(prepared.before, prepared.after);

    if (guardReason) {
      return createErrorResult(
        [
          `Refusing broad write to \`${prepared.path}\`: ${guardReason}`,
          "Use files_exact_replace, files_replace_range, files_apply_patch, or files_edit_many for this edit. Set allowWholeFileReplacement true only when the user explicitly wants a reviewed full-file rewrite.",
        ].join(" "),
      );
    }
  }

  if (options.dryRun) {
    return createWriteResult({
      content: [
        `Dry run: ${options.summary}`,
        formatFileChangeSummary(preview.change, true),
        "",
        preview.previewText,
      ].join("\n"),
      dryRun: true,
      fileChanges: [preview.change],
      path: prepared.path,
    });
  }

  try {
    const result = await backend.writeTextFile(prepared.path, prepared.after, roots, {
      createParentDirs: options.createParentDirs,
      expectedSha256: prepared.expectedSha256,
      forceEol: options.forceEol,
      overwrite: options.overwrite,
    });

    return createWriteResult({
      content: [
        `${options.summary}`,
        formatFileChangeSummary(preview.change, false),
        `Wrote ${result.bytesWritten.toLocaleString("en-US")} bytes${result.eol ? ` using ${result.eol.toUpperCase()} line endings` : ""}.`,
        "",
        preview.previewText,
      ].join("\n"),
      dryRun: false,
      fileChanges: [preview.change],
      path: result.path,
      writeResult: result as unknown as JsonValue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not write file.";
    return {
      content: message,
      error: message,
      ok: false,
    };
  }
}

export function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

export function createStaleLineRangeError({
  editIndex,
  endLine,
  lineCount,
  path,
  startLine,
  toolId,
}: {
  editIndex?: number;
  endLine: number;
  lineCount: number;
  path?: string;
  startLine: number;
  toolId: string;
}) {
  const target = path ? ` in ${path}` : "";
  const editLabel = editIndex === undefined ? "" : ` edits[${editIndex}]`;

  return [
    `${toolId}${editLabel} cannot replace lines ${startLine}-${endLine}${target}; file has ${lineCount} line${lineCount === 1 ? "" : "s"}.`,
    "The line range is stale or belongs to a different file revision. No edit was applied for this file.",
    "Re-read the current target with files_read_range or files_read, then retry with exact_replace or files_apply_patch anchored to current text; only use replace_range again with fresh line numbers from that read.",
  ].join(" ");
}

export function replaceTextSpanByLineColumn(
  content: string,
  request: {
    content: string;
    editIndex?: number;
    endColumn: number;
    endLine: number;
    path?: string;
    startColumn: number;
    startLine: number;
    toolId: string;
  },
): { content: string; ok: true } | ToolExecutionResult {
  const editable = splitEditableLines(content);

  if (request.endLine < request.startLine) {
    return createErrorResult(`${request.toolId} replace_span endLine must be greater than or equal to startLine.`);
  }

  if (request.startLine > editable.lines.length || request.endLine > editable.lines.length) {
    return createErrorResult(createStaleLineRangeError({
      editIndex: request.editIndex,
      endLine: request.endLine,
      lineCount: editable.lines.length,
      path: request.path,
      startLine: request.startLine,
      toolId: request.toolId,
    }));
  }

  const startLineText = editable.lines[request.startLine - 1] ?? "";
  const endLineText = editable.lines[request.endLine - 1] ?? "";
  const startMaxColumn = startLineText.length + 1;
  const endMaxColumn = endLineText.length + 1;

  if (request.startColumn > startMaxColumn) {
    return createErrorResult(createStaleColumnRangeError({
      column: request.startColumn,
      editIndex: request.editIndex,
      line: request.startLine,
      maxColumn: startMaxColumn,
      path: request.path,
      positionName: "startColumn",
      toolId: request.toolId,
    }));
  }

  if (request.endColumn > endMaxColumn) {
    return createErrorResult(createStaleColumnRangeError({
      column: request.endColumn,
      editIndex: request.editIndex,
      line: request.endLine,
      maxColumn: endMaxColumn,
      path: request.path,
      positionName: "endColumn",
      toolId: request.toolId,
    }));
  }

  if (request.startLine === request.endLine && request.endColumn < request.startColumn) {
    return createErrorResult(`${request.toolId} replace_span endColumn must be greater than or equal to startColumn when startLine and endLine are the same.`);
  }

  const normalizedContent = normalizeEditableContent(editable);
  const startOffset = normalizedOffsetForLineColumn(editable.lines, request.startLine, request.startColumn);
  const endOffset = normalizedOffsetForLineColumn(editable.lines, request.endLine, request.endColumn);
  const normalizedReplacement = request.content.replace(/\r\n/g, "\n");
  const nextContent = `${normalizedContent.slice(0, startOffset)}${normalizedReplacement}${normalizedContent.slice(endOffset)}`;

  return {
    content: editable.eol === "\r\n" ? nextContent.replace(/\n/g, "\r\n") : nextContent,
    ok: true,
  };
}

function normalizeEditableContent(value: EditableLines) {
  const content = value.lines.join("\n");
  return value.hasTrailingNewline && value.lines.length > 0 ? `${content}\n` : content;
}

function normalizedOffsetForLineColumn(lines: string[], line: number, column: number) {
  let offset = 0;

  for (let index = 0; index < line - 1; index += 1) {
    offset += (lines[index] ?? "").length + 1;
  }

  return offset + column - 1;
}

function createStaleColumnRangeError({
  column,
  editIndex,
  line,
  maxColumn,
  path,
  positionName,
  toolId,
}: {
  column: number;
  editIndex?: number;
  line: number;
  maxColumn: number;
  path?: string;
  positionName: "endColumn" | "startColumn";
  toolId: string;
}) {
  const target = path ? ` in ${path}` : "";
  const editLabel = editIndex === undefined ? "" : ` edits[${editIndex}]`;

  return [
    `${toolId}${editLabel} cannot replace span${target}; ${positionName} ${column} is outside line ${line}'s current 1-${maxColumn} boundary.`,
    "The column range is stale or belongs to a different file revision. No edit was applied for this file.",
    "Re-read the current target with files_read_range, then retry with exact_replace or replace_span using current line and column numbers.",
  ].join(" ");
}

function createWriteResult({
  content,
  dryRun,
  fileChanges,
  path,
  writeResult,
}: {
  content: string;
  dryRun: boolean;
  fileChanges: ReturnType<typeof createTextChangePreview>["change"][];
  path: string;
  writeResult?: JsonValue;
}): ToolExecutionResult {
  return {
    content,
    data: {
      dryRun,
      fileChanges,
      path,
      writeResult: writeResult ?? null,
    } as unknown as JsonValue,
    ok: true,
  };
}

function isToolResult(value: string | ToolExecutionResult): value is ToolExecutionResult {
  return typeof value === "object";
}

function getPreciseEditGuardReason(before: string, after: string) {
  if (before === after) {
    return undefined;
  }

  const beforeLines = splitEditableLines(before).lines;
  const afterLines = splitEditableLines(after).lines;
  const prefixLength = commonPrefixLength(beforeLines, afterLines);
  const suffixLength = commonSuffixLength(beforeLines, afterLines, prefixLength);
  const changedBeforeLines = Math.max(0, beforeLines.length - prefixLength - suffixLength);
  const changedAfterLines = Math.max(0, afterLines.length - prefixLength - suffixLength);
  const changedLines = Math.max(changedBeforeLines, changedAfterLines);
  const totalLines = Math.max(beforeLines.length, afterLines.length, 1);
  const changedLineRatio = changedLines / totalLines;
  const largestSize = Math.max(before.length, after.length);
  const looksLikeLocalizedEdit = changedLines > 0 && changedLines <= 80 && changedLineRatio <= 0.5;
  const looksLikeLargeFileLocalizedEdit = largestSize >= 12_000 && changedLines > 0 && changedLineRatio <= 0.2;

  if (looksLikeLocalizedEdit || looksLikeLargeFileLocalizedEdit) {
    return `this looks like a small edit to an existing ${largestSize.toLocaleString("en-US")}-character file (${changedLines.toLocaleString("en-US")} changed line${changedLines === 1 ? "" : "s"}).`;
  }

  return undefined;
}

function commonPrefixLength(left: string[], right: string[]) {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function commonSuffixLength(left: string[], right: string[], prefixLength: number) {
  const limit = Math.min(left.length, right.length) - prefixLength;
  let index = 0;

  while (index < limit && left[left.length - 1 - index] === right[right.length - 1 - index]) {
    index += 1;
  }

  return index;
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
