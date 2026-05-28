export type ProjectToolMemoryStatus = "open" | "resolved";

export type ProjectToolMemoryFailureKind =
  | "invalid-json"
  | "validation"
  | "path"
  | "workspace-boundary"
  | "shell-dialect"
  | "timeout"
  | "permission"
  | "execution";

export interface ProjectToolMemoryScope {
  key: string;
  label: string;
  projectName: string;
  workspaceRoots: string[];
}

export interface ProjectToolMemoryEntry {
  confidence: number;
  createdAt: string;
  failureCount: number;
  failureKind: ProjectToolMemoryFailureKind;
  failureSummary: string;
  fingerprint: string;
  id: string;
  lastArgsSummary?: string;
  lastFailureAt: string;
  lastSuccessAt?: string;
  lesson?: string;
  projectKey: string;
  promptHint?: string;
  retryHint: string;
  status: ProjectToolMemoryStatus;
  successCount: number;
  successSummary?: string;
  targetHint?: string;
  toolFamily?: string;
  toolId: string;
  updatedAt: string;
}

export interface ProjectToolMemoryState {
  createdAt: string;
  entries: ProjectToolMemoryEntry[];
  projectKey: string;
  projectName: string;
  updatedAt: string;
  version: 1;
  workspaceRoots: string[];
}

export interface ProjectToolMemoryStorage {
  read: (key: string) => string | null | undefined;
  write: (key: string, value: string) => void;
}

export interface ProjectToolMemoryLearnOptions {
  now?: string;
  prompt?: string;
}

export interface ProjectToolMemoryContextOptions {
  maxChars?: number;
  maxEntries?: number;
  prompt?: string;
}
