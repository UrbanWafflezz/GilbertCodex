import type { ProjectToolMemoryContextOptions, ProjectToolMemoryEntry, ProjectToolMemoryState } from "./types";

const DEFAULT_CONTEXT_ENTRY_COUNT = 6;
const DEFAULT_CONTEXT_MAX_CHARS = 3_600;

export function createProjectToolMemoryContext(
  state: ProjectToolMemoryState,
  options: ProjectToolMemoryContextOptions = {},
) {
  if (state.entries.length === 0) {
    return "";
  }

  const maxEntries = Math.max(1, Math.round(options.maxEntries ?? DEFAULT_CONTEXT_ENTRY_COUNT));
  const maxChars = Math.max(800, Math.round(options.maxChars ?? DEFAULT_CONTEXT_MAX_CHARS));
  const rankedEntries = rankToolMemoryEntries(state.entries, options.prompt).slice(0, maxEntries);

  if (rankedEntries.length === 0) {
    return "";
  }

  const header = [
    "PROJECT TOOL MEMORY",
    `Project: ${state.projectName}`,
    state.workspaceRoots.length > 0 ? `Workspace roots: ${state.workspaceRoots.join(" | ")}` : "Workspace roots: none",
    "These are project-specific tool lessons from previous failed and recovered tool calls. Use them silently to choose better tools, arguments, commands, and retries. Do not mention this memory unless the user asks.",
  ].join("\n");
  const lines: string[] = [header];

  for (const entry of rankedEntries) {
    const line = formatMemoryEntry(entry);
    const nextContent = [...lines, line].join("\n");

    if (nextContent.length > maxChars) {
      break;
    }

    lines.push(line);
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

function rankToolMemoryEntries(entries: ProjectToolMemoryEntry[], prompt: string | undefined) {
  const promptText = normalizeText(prompt ?? "");

  return [...entries]
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, promptText),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.entry.updatedAt) - Date.parse(left.entry.updatedAt))
    .map((item) => item.entry);
}

function scoreEntry(entry: ProjectToolMemoryEntry, promptText: string) {
  let score = entry.status === "open" ? 6 : 3;

  if (entry.successCount > 0) {
    score += 2;
  }

  if (entry.failureCount > 1) {
    score += Math.min(3, entry.failureCount - 1);
  }

  if (promptText) {
    const haystack = normalizeText([
      entry.toolId,
      entry.toolFamily,
      entry.failureKind,
      entry.failureSummary,
      entry.lesson,
      entry.retryHint,
      entry.targetHint,
    ].filter(Boolean).join(" "));

    for (const token of promptText.split(/\s+/).filter((token) => token.length >= 4).slice(0, 24)) {
      if (haystack.includes(token)) {
        score += 1;
      }
    }
  }

  return score;
}

function formatMemoryEntry(entry: ProjectToolMemoryEntry) {
  const status = entry.status === "resolved" ? "learned fix" : "known failure";
  const lesson = entry.lesson || entry.retryHint;
  const target = entry.targetHint ? ` Target: ${entry.targetHint}.` : "";
  const success = entry.successSummary ? ` Last success: ${entry.successSummary}.` : "";
  const args = !entry.successSummary && entry.lastArgsSummary ? ` Last args: ${entry.lastArgsSummary}.` : "";

  return `- ${entry.toolId} (${entry.failureKind}, ${status}): ${entry.failureSummary} ${lesson}${target}${success}${args}`.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return value.replace(/[^a-zA-Z0-9_./\\:-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
