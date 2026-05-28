import type { ProjectToolMemoryScope } from "./types";

export interface CreateProjectToolMemoryScopeOptions {
  projectName: string;
  workspaceRoots?: string[];
}

export function createProjectToolMemoryScope(options: CreateProjectToolMemoryScopeOptions): ProjectToolMemoryScope {
  const projectName = normalizeProjectNameForMemory(options.projectName);
  const workspaceRoots = normalizeWorkspaceRoots(options.workspaceRoots ?? []);
  const identity = workspaceRoots.length > 0 ? `roots:${workspaceRoots.map((root) => root.toLowerCase()).join("|")}` : `project:${projectName.toLowerCase()}`;
  const key = stableHash(identity);
  const label = workspaceRoots.length > 0 ? workspaceRoots.join(" | ") : projectName;

  return {
    key,
    label,
    projectName,
    workspaceRoots,
  };
}

export function normalizeProjectNameForMemory(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || "General";
}

function normalizeWorkspaceRoots(roots: string[]) {
  const seen = new Set<string>();
  const normalizedRoots: string[] = [];

  for (const root of roots) {
    const normalized = normalizeWorkspaceRoot(root);

    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }

    seen.add(normalized.toLowerCase());
    normalizedRoots.push(normalized);
  }

  return normalizedRoots.sort((left, right) => left.localeCompare(right));
}

function normalizeWorkspaceRoot(root: string) {
  const trimmed = root.trim();

  if (!trimmed) {
    return "";
  }

  if (/^[a-z]:$/i.test(trimmed)) {
    return `${trimmed.toUpperCase()}\\`;
  }

  return trimmed.replace(/[\\/]+$/, "");
}

export function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
