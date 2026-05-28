import type { ChatToolCall } from "../../types/chat";
import type { ToolBridgeExecutionBatch } from "../types";
import { stableHash } from "./scope";
import type {
  ProjectToolMemoryEntry,
  ProjectToolMemoryFailureKind,
  ProjectToolMemoryLearnOptions,
  ProjectToolMemoryState,
} from "./types";

interface ToolMemoryObservation {
  argsSummary?: string;
  error?: string;
  failureKind?: ProjectToolMemoryFailureKind;
  ok: boolean;
  promptHint?: string;
  resultSummary?: string;
  targetHint?: string;
  toolFamily?: string;
  toolId: string;
}

export function learnProjectToolMemoryFromBridgeRun(
  state: ProjectToolMemoryState,
  run: ToolBridgeExecutionBatch,
  options: ProjectToolMemoryLearnOptions = {},
): ProjectToolMemoryState {
  const observations: ToolMemoryObservation[] = run.steps.map((step) => {
    const toolId = step.chatToolCall.toolId || step.call.name;
    const error = step.result.error || step.result.skippedReason || (!step.result.ok ? step.result.content : undefined);
    const args = isRecord(step.call.arguments) ? step.call.arguments : undefined;

    return {
      argsSummary: summarizeArgs(args),
      error: sanitizeMemoryText(error),
      failureKind: classifyToolFailure(error),
      ok: step.result.ok && !step.result.skippedReason,
      promptHint: summarizePrompt(options.prompt),
      resultSummary: sanitizeMemoryText(step.result.content),
      targetHint: extractTargetHint(args, step.result.content),
      toolFamily: step.chatToolCall.toolId ? inferToolFamily(step.chatToolCall.toolId) : inferToolFamily(step.call.name),
      toolId,
    };
  });

  return learnProjectToolMemoryFromObservations(state, observations, options);
}

export function learnProjectToolMemoryFromChatToolCalls(
  state: ProjectToolMemoryState,
  toolCalls: ChatToolCall[],
  options: ProjectToolMemoryLearnOptions = {},
): ProjectToolMemoryState {
  const observations = toolCalls.map((toolCall) => {
    const args = parseToolCallInput(toolCall.input);
    const error = toolCall.status === "error" || toolCall.status === "skipped"
      ? toolCall.detail || toolCall.output
      : undefined;

    return {
      argsSummary: summarizeArgs(args),
      error: sanitizeMemoryText(error),
      failureKind: classifyToolFailure(error || toolCall.output),
      ok: toolCall.status === "complete",
      promptHint: summarizePrompt(options.prompt),
      resultSummary: sanitizeMemoryText(toolCall.output),
      targetHint: extractTargetHint(args, toolCall.output),
      toolFamily: inferToolFamily(toolCall.toolId || toolCall.label),
      toolId: toolCall.toolId || normalizeToolLabel(toolCall.label),
    } satisfies ToolMemoryObservation;
  });

  return learnProjectToolMemoryFromObservations(state, observations, options);
}

function learnProjectToolMemoryFromObservations(
  state: ProjectToolMemoryState,
  observations: ToolMemoryObservation[],
  options: ProjectToolMemoryLearnOptions,
) {
  const actionableObservations = observations.filter((observation) => observation.toolId && (observation.ok || isActionableFailure(observation)));

  if (actionableObservations.length === 0) {
    return state;
  }

  const now = options.now ?? new Date().toISOString();
  let entries = [...state.entries];
  let changed = false;

  for (const observation of actionableObservations) {
    if (!observation.ok) {
      const next = upsertFailure(entries, state.projectKey, observation, now);
      entries = next.entries;
      changed = changed || next.changed;
      continue;
    }

    const next = resolveRelatedFailures(entries, observation, now);
    entries = next.entries;
    changed = changed || next.changed;
  }

  if (!changed) {
    return state;
  }

  return {
    ...state,
    entries: sortMemoryEntries(entries),
    updatedAt: now,
  };
}

function upsertFailure(
  entries: ProjectToolMemoryEntry[],
  projectKey: string,
  observation: ToolMemoryObservation,
  now: string,
) {
  const failureKind = observation.failureKind ?? "execution";
  const fingerprint = createFailureFingerprint(observation, failureKind);
  const existingIndex = entries.findIndex((entry) => entry.fingerprint === fingerprint);
  const retryHint = createRetryHint(failureKind, observation);
  const failureSummary = createFailureSummary(failureKind, observation);

  if (existingIndex >= 0) {
    const current = entries[existingIndex]!;
    const updated: ProjectToolMemoryEntry = {
      ...current,
      confidence: Math.min(0.9, current.confidence + 0.05),
      failureCount: current.failureCount + 1,
      failureSummary,
      lastArgsSummary: observation.argsSummary ?? current.lastArgsSummary,
      lastFailureAt: now,
      promptHint: observation.promptHint ?? current.promptHint,
      retryHint,
      status: "open",
      targetHint: observation.targetHint ?? current.targetHint,
      updatedAt: now,
    };

    return {
      changed: true,
      entries: replaceEntry(entries, existingIndex, updated),
    };
  }

  const entry: ProjectToolMemoryEntry = {
    confidence: 0.35,
    createdAt: now,
    failureCount: 1,
    failureKind,
    failureSummary,
    fingerprint,
    id: `tool-memory-${stableHash(`${projectKey}:${fingerprint}`)}`,
    lastArgsSummary: observation.argsSummary,
    lastFailureAt: now,
    projectKey,
    promptHint: observation.promptHint,
    retryHint,
    status: "open",
    successCount: 0,
    targetHint: observation.targetHint,
    toolFamily: observation.toolFamily,
    toolId: observation.toolId,
    updatedAt: now,
  };

  return {
    changed: true,
    entries: [...entries, entry],
  };
}

function resolveRelatedFailures(entries: ProjectToolMemoryEntry[], observation: ToolMemoryObservation, now: string) {
  let changed = false;
  let resolutions = 0;
  const updatedEntries = entries.map((entry) => {
    if (entry.status !== "open" || resolutions >= 2 || !isRelatedSuccess(entry, observation)) {
      return entry;
    }

    resolutions += 1;
    changed = true;
    const successSummary = createSuccessSummary(observation);

    return {
      ...entry,
      confidence: Math.min(0.95, Math.max(entry.confidence, 0.55) + 0.1),
      lastArgsSummary: observation.argsSummary ?? entry.lastArgsSummary,
      lastSuccessAt: now,
      lesson: createResolutionLesson(entry, observation, successSummary),
      retryHint: createResolvedRetryHint(entry, observation),
      status: "resolved" as const,
      successCount: entry.successCount + 1,
      successSummary,
      targetHint: observation.targetHint ?? entry.targetHint,
      updatedAt: now,
    };
  });

  return { changed, entries: updatedEntries };
}

function isRelatedSuccess(entry: ProjectToolMemoryEntry, observation: ToolMemoryObservation) {
  if (entry.toolId === observation.toolId || entry.toolFamily === observation.toolFamily) {
    return true;
  }

  if (entry.targetHint && observation.targetHint) {
    return normalizeMemoryText(entry.targetHint) === normalizeMemoryText(observation.targetHint);
  }

  return false;
}

function isActionableFailure(observation: ToolMemoryObservation) {
  const error = observation.error ?? "";

  if (!error.trim()) {
    return false;
  }

  return !/\b(?:approval denied|awaiting approval|requires approval|duplicate tool call id)\b/i.test(error);
}

function createFailureFingerprint(observation: ToolMemoryObservation, failureKind: ProjectToolMemoryFailureKind) {
  const target = observation.targetHint ? normalizeMemoryText(observation.targetHint).slice(0, 160) : "";
  const errorShape = normalizeFailureShape(observation.error ?? "");

  return `${observation.toolId}:${failureKind}:${stableHash(`${target}:${errorShape}`)}`;
}

function classifyToolFailure(message: unknown): ProjectToolMemoryFailureKind {
  const text = typeof message === "string" ? message : "";

  if (!text.trim()) {
    return "execution";
  }

  if (/invalid json|could not parse .*json|unterminated string|bad control character/i.test(text)) {
    return "invalid-json";
  }

  if (/\b(arguments?|schema|maxBytes|offset|replaceAll|path|cwd|command)\b[\s\S]{0,160}\b(?:must be|is not allowed|required|invalid|expected)\b/i.test(text)) {
    return "validation";
  }

  if (/\b(outside the workspace|external path|workspace roots?)\b/i.test(text)) {
    return "workspace-boundary";
  }

  if (/\b(cannot find|could not read|file not found|path not found|no such file|directory named|try files_read|try files_search)\b/i.test(text)) {
    return "path";
  }

  if (/\b(rmdir \/s|del \/q|2>nul|cmdlet|powershell|is not recognized|parameter cannot be found|positional parameter)\b/i.test(text)) {
    return "shell-dialect";
  }

  if (/\b(timed out|timeout|exceeded its timeout|hard timeout|killed after)\b/i.test(text)) {
    return "timeout";
  }

  if (/\b(permission|access is denied|unauthorized|forbidden|not allowed)\b/i.test(text)) {
    return "permission";
  }

  return "execution";
}

function createFailureSummary(kind: ProjectToolMemoryFailureKind, observation: ToolMemoryObservation) {
  const target = observation.targetHint ? ` on ${observation.targetHint}` : "";
  const base = `${observation.toolId}${target} failed`;

  if (kind === "invalid-json") return `${base} because the model emitted malformed JSON arguments.`;
  if (kind === "validation") return `${base} because the arguments did not match the tool schema.`;
  if (kind === "path") return `${base} because the requested path could not be resolved.`;
  if (kind === "workspace-boundary") return `${base} because the request crossed the selected workspace boundary.`;
  if (kind === "shell-dialect") return `${base} because the command did not match the active shell dialect.`;
  if (kind === "timeout") return `${base} because the action timed out.`;
  if (kind === "permission") return `${base} because local permissions blocked it.`;

  return `${base}.`;
}

function createRetryHint(kind: ProjectToolMemoryFailureKind, observation: ToolMemoryObservation) {
  if (kind === "invalid-json") {
    return "Retry with one valid JSON object and escaped newlines, quotes, and backslashes inside string values.";
  }

  if (kind === "validation") {
    return "Retry the same intent using only schema-supported keys and the expected primitive types.";
  }

  if (kind === "path") {
    return "Do not repeat the stale path. Search by filename or use the candidate path from the error before reading or editing.";
  }

  if (kind === "workspace-boundary") {
    return "Stay inside the selected workspace roots, or ask the user to add the needed folder before retrying.";
  }

  if (kind === "shell-dialect") {
    return "Use commands for the active shell, or explicitly wrap a different dialect with the correct shell executable.";
  }

  if (kind === "timeout") {
    return "Use a narrower command, a longer timeout when appropriate, or an existing project script instead of a broad recursive shell one-liner.";
  }

  if (kind === "permission") {
    return "Check the current permission mode and request approval instead of retrying the same blocked action.";
  }

  return observation.error ? `Avoid repeating this exact failure: ${truncateText(observation.error, 240)}` : "Retry with a narrower, validated tool call.";
}

function createResolvedRetryHint(entry: ProjectToolMemoryEntry, observation: ToolMemoryObservation) {
  const success = observation.argsSummary ? ` Working pattern: ${observation.toolId} ${observation.argsSummary}.` : ` Working tool: ${observation.toolId}.`;
  return `${entry.retryHint}${success}`;
}

function createResolutionLesson(entry: ProjectToolMemoryEntry, observation: ToolMemoryObservation, successSummary: string) {
  const target = observation.targetHint ? ` for ${observation.targetHint}` : "";

  if (entry.failureKind === "path") {
    return `When ${entry.toolId} cannot resolve a project path, pivot to the discovered path or search first. ${successSummary}${target}.`;
  }

  if (entry.failureKind === "timeout") {
    return `When a command times out in this project, narrow the command or use the successful follow-up pattern. ${successSummary}.`;
  }

  if (entry.failureKind === "shell-dialect") {
    return `Use the shell syntax that matched the successful follow-up in this project. ${successSummary}.`;
  }

  if (entry.failureKind === "validation" || entry.failureKind === "invalid-json") {
    return `Correct the tool argument shape before retrying. ${successSummary}.`;
  }

  return `If this failure appears again, use the later successful pattern. ${successSummary}.`;
}

function createSuccessSummary(observation: ToolMemoryObservation) {
  const args = observation.argsSummary ? ` with ${observation.argsSummary}` : "";
  return `${observation.toolId} succeeded${args}`;
}

function inferToolFamily(toolId: string) {
  const normalized = normalizeToolLabel(toolId);

  if (normalized.startsWith("files_")) return "files";
  if (normalized.startsWith("git_") || normalized.startsWith("github_")) return "git";
  if (normalized.startsWith("terminal_") || normalized.includes("terminal") || normalized.includes("shell")) return "terminal";
  if (normalized.startsWith("browser_")) return "browser";
  if (normalized.startsWith("web_")) return "web";
  if (normalized.startsWith("mcp_")) return "mcp";
  if (normalized.startsWith("bridge_") || normalized.includes("diagnostic")) return "diagnostic";

  return normalized.split("_")[0] || "tool";
}

function normalizeToolLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function parseToolCallInput(input: string | undefined): Record<string, unknown> | undefined {
  if (!input) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function summarizeArgs(args: Record<string, unknown> | undefined) {
  if (!args) {
    return undefined;
  }

  const summary: Record<string, string | number | boolean | null | string[]> = {};
  const priorityKeys = ["path", "paths", "cwd", "workingDirectory", "command", "query", "url", "fromPath", "toPath", "maxBytes", "timeoutMs", "timeout"];

  for (const key of priorityKeys) {
    if (!(key in args)) {
      continue;
    }

    const value = sanitizeArgValue(args[key]);
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  const rendered = JSON.stringify(summary);
  return rendered && rendered !== "{}" ? truncateText(rendered, 500) : undefined;
}

function sanitizeArgValue(value: unknown): string | number | boolean | null | string[] | undefined {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeMemoryText(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => typeof item === "string" ? [sanitizeMemoryText(item)] : []).slice(0, 6);
  }

  return undefined;
}

function extractTargetHint(args: Record<string, unknown> | undefined, resultText: unknown) {
  const pathValue = stringArg(args, "path") || stringArg(args, "cwd") || stringArg(args, "workingDirectory") || stringArg(args, "url") || stringArg(args, "query");
  const command = stringArg(args, "command");

  if (pathValue) {
    return truncateText(sanitizeMemoryText(pathValue), 220);
  }

  if (command) {
    return truncateText(sanitizeMemoryText(command), 220);
  }

  const text = typeof resultText === "string" ? resultText : "";
  const suggestedPath = text.match(/\bTry\s+(?:files_read|files_read_range)\s+on\s+one\s+of:\s*([^\n]+)/i)?.[1];
  return suggestedPath ? truncateText(sanitizeMemoryText(suggestedPath), 220) : undefined;
}

function stringArg(args: Record<string, unknown> | undefined, key: string) {
  return typeof args?.[key] === "string" ? args[key].trim() : "";
}

function summarizePrompt(prompt: string | undefined) {
  return prompt ? truncateText(sanitizeMemoryText(prompt), 220) : undefined;
}

function normalizeFailureShape(error: string) {
  return normalizeMemoryText(error)
    .replace(/[a-z]:[\\/][^\s'"`]+/gi, "<path>")
    .replace(/\d+/g, "<n>")
    .slice(0, 260);
}

export function sanitizeMemoryText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return truncateText(value
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, "<secret>")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "<long-token>")
    .replace(/\s+/g, " ")
    .trim(), 1200);
}

function normalizeMemoryText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1)).trim()}...` : value;
}

function replaceEntry(entries: ProjectToolMemoryEntry[], index: number, entry: ProjectToolMemoryEntry) {
  return entries.map((current, currentIndex) => currentIndex === index ? entry : current);
}

function sortMemoryEntries(entries: ProjectToolMemoryEntry[]) {
  return [...entries].sort((left, right) => {
    const statusScore = statusRank(right.status) - statusRank(left.status);
    if (statusScore !== 0) {
      return statusScore;
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function statusRank(status: ProjectToolMemoryEntry["status"]) {
  return status === "open" ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
