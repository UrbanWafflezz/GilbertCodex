import type { ProjectToolMemoryEntry, ProjectToolMemoryScope, ProjectToolMemoryState, ProjectToolMemoryStorage } from "./types";

const TOOL_MEMORY_STORAGE_PREFIX = "gilbert-codex.project-tool-memory.v1";

export function createEmptyProjectToolMemoryState(scope: ProjectToolMemoryScope, now = new Date().toISOString()): ProjectToolMemoryState {
  return {
    createdAt: now,
    entries: [],
    projectKey: scope.key,
    projectName: scope.projectName,
    updatedAt: now,
    version: 1,
    workspaceRoots: scope.workspaceRoots,
  };
}

export function projectToolMemoryStorageKey(scope: ProjectToolMemoryScope) {
  return `${TOOL_MEMORY_STORAGE_PREFIX}.${scope.key}`;
}

export function loadProjectToolMemoryState(scope: ProjectToolMemoryScope, storage: ProjectToolMemoryStorage): ProjectToolMemoryState {
  const rawValue = storage.read(projectToolMemoryStorageKey(scope));

  if (!rawValue) {
    return createEmptyProjectToolMemoryState(scope);
  }

  try {
    return normalizeProjectToolMemoryState(JSON.parse(rawValue), scope);
  } catch {
    return createEmptyProjectToolMemoryState(scope);
  }
}

export function saveProjectToolMemoryState(state: ProjectToolMemoryState, storage: ProjectToolMemoryStorage) {
  storage.write(projectToolMemoryStorageKey({
    key: state.projectKey,
    label: state.workspaceRoots.length > 0 ? state.workspaceRoots.join(" | ") : state.projectName,
    projectName: state.projectName,
    workspaceRoots: state.workspaceRoots,
  }), JSON.stringify(normalizeProjectToolMemoryState(state, {
    key: state.projectKey,
    label: state.workspaceRoots.length > 0 ? state.workspaceRoots.join(" | ") : state.projectName,
    projectName: state.projectName,
    workspaceRoots: state.workspaceRoots,
  })));
}

function normalizeProjectToolMemoryState(value: unknown, scope: ProjectToolMemoryScope): ProjectToolMemoryState {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ProjectToolMemoryState> : {};
  const now = new Date().toISOString();
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap((entry) => {
        const normalized = normalizeProjectToolMemoryEntry(entry, scope.key);
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : now,
    entries,
    projectKey: scope.key,
    projectName: scope.projectName,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : now,
    version: 1,
    workspaceRoots: scope.workspaceRoots,
  };
}

function normalizeProjectToolMemoryEntry(value: unknown, projectKey: string): ProjectToolMemoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry = value as Partial<ProjectToolMemoryEntry>;
  const toolId = normalizeShortText(entry.toolId, "");
  const failureSummary = normalizeShortText(entry.failureSummary, "");
  const retryHint = normalizeShortText(entry.retryHint, "");
  const fingerprint = normalizeShortText(entry.fingerprint, "");

  if (!toolId || !failureSummary || !retryHint || !fingerprint) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    confidence: normalizeNumber(entry.confidence, 0.35, 0, 1),
    createdAt: normalizeDateText(entry.createdAt, now),
    failureCount: normalizeInteger(entry.failureCount, 1),
    failureKind: normalizeFailureKind(entry.failureKind),
    failureSummary,
    fingerprint,
    id: normalizeShortText(entry.id, `memory-${fingerprint}`),
    lastArgsSummary: normalizeOptionalText(entry.lastArgsSummary),
    lastFailureAt: normalizeDateText(entry.lastFailureAt, now),
    lastSuccessAt: normalizeOptionalText(entry.lastSuccessAt),
    lesson: normalizeOptionalText(entry.lesson),
    projectKey,
    promptHint: normalizeOptionalText(entry.promptHint),
    retryHint,
    status: entry.status === "resolved" ? "resolved" : "open",
    successCount: normalizeInteger(entry.successCount, 0),
    successSummary: normalizeOptionalText(entry.successSummary),
    targetHint: normalizeOptionalText(entry.targetHint),
    toolFamily: normalizeOptionalText(entry.toolFamily),
    toolId,
    updatedAt: normalizeDateText(entry.updatedAt, now),
  };
}

function normalizeFailureKind(value: unknown): ProjectToolMemoryEntry["failureKind"] {
  return value === "invalid-json" ||
    value === "validation" ||
    value === "path" ||
    value === "workspace-boundary" ||
    value === "shell-dialect" ||
    value === "timeout" ||
    value === "permission" ||
    value === "execution"
    ? value
    : "execution";
}

function normalizeDateText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeShortText(value, "");
  return normalized || undefined;
}

function normalizeShortText(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 1200);
}

function normalizeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}
