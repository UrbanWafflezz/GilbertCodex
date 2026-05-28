import type { ChatToolFileChange, ChatToolFileChangeLine } from "../../../types/chat";

const MAX_DIFF_PREVIEW_LINES = 80;
const CONTEXT_LINES = 3;

export interface TextChangePreview {
  change: ChatToolFileChange;
  previewText: string;
}

export function createTextChangePreview(path: string, before: string, after: string, kind: ChatToolFileChange["kind"] = "update"): TextChangePreview {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const prefixLength = commonPrefixLength(beforeLines, afterLines);
  const suffixLength = commonSuffixLength(beforeLines, afterLines, prefixLength);
  const removed = beforeLines.slice(prefixLength, beforeLines.length - suffixLength);
  const added = afterLines.slice(prefixLength, afterLines.length - suffixLength);
  const hunkStartOld = Math.max(prefixLength - CONTEXT_LINES, 0);
  const hunkStartNew = Math.max(prefixLength - CONTEXT_LINES, 0);
  const hunkEndOld = Math.min(beforeLines.length, beforeLines.length - suffixLength + CONTEXT_LINES);
  const hunkEndNew = Math.min(afterLines.length, afterLines.length - suffixLength + CONTEXT_LINES);
  const leadingContext = beforeLines.slice(hunkStartOld, prefixLength);
  const trailingContext = beforeLines.slice(beforeLines.length - suffixLength, hunkEndOld);
  const previewLines: ChatToolFileChangeLine[] = [
    { content: `--- ${path}`, kind: "meta" },
    { content: `+++ ${path}`, kind: "meta" },
    {
      content: `@@ -${hunkStartOld + 1},${Math.max(hunkEndOld - hunkStartOld, 0)} +${hunkStartNew + 1},${Math.max(hunkEndNew - hunkStartNew, 0)} @@`,
      kind: "hunk",
    },
    ...leadingContext.map((line, index) => ({
      content: line,
      kind: "context" as const,
      newLine: hunkStartNew + index + 1,
      oldLine: hunkStartOld + index + 1,
    })),
    ...removed.map((line, index) => ({
      content: line,
      kind: "remove" as const,
      oldLine: prefixLength + index + 1,
    })),
    ...added.map((line, index) => ({
      content: line,
      kind: "add" as const,
      newLine: prefixLength + index + 1,
    })),
    ...trailingContext.map((line, index) => ({
      content: line,
      kind: "context" as const,
      newLine: afterLines.length - suffixLength + index + 1,
      oldLine: beforeLines.length - suffixLength + index + 1,
    })),
  ];
  const diffTruncated = previewLines.length > MAX_DIFF_PREVIEW_LINES;
  const visiblePreview = diffTruncated ? previewLines.slice(0, MAX_DIFF_PREVIEW_LINES) : previewLines;
  const change: ChatToolFileChange = {
    additions: added.length,
    deletions: removed.length,
    diffPreview: visiblePreview,
    diffTruncated,
    kind,
    path,
  };

  return {
    change,
    previewText: formatDiffPreviewText(visiblePreview, diffTruncated),
  };
}

export function formatFileChangeSummary(change: ChatToolFileChange, dryRun: boolean) {
  const action = dryRun ? "Previewed" : change.kind === "create" ? "Created" : "Updated";
  return `${action} ${change.path}: +${change.additions} -${change.deletions}`;
}

function formatDiffPreviewText(lines: ChatToolFileChangeLine[], truncated: boolean) {
  const body = lines
    .map((line) => `${markerForLine(line.kind)}${line.content}`)
    .join("\n");

  return truncated ? `${body}\n[Diff preview trimmed; full tool output remains available.]` : body;
}

function markerForLine(kind: ChatToolFileChangeLine["kind"]) {
  if (kind === "add") {
    return "+";
  }

  if (kind === "remove") {
    return "-";
  }

  if (kind === "context") {
    return " ";
  }

  return "";
}

function splitLines(content: string) {
  if (!content) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  return content.endsWith("\n") || content.endsWith("\r\n") ? lines.slice(0, -1) : lines;
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
