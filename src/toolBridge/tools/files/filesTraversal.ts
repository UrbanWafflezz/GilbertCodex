import type { ComputerDirectoryEntry } from "../../../types/localWorkspace";
import type { FilesBackend } from "./backend";

export const DEFAULT_EXCLUDED_DIRECTORIES = [
  ".cache",
  ".codex-logs",
  ".codex-security-scans",
  ".dart_tool",
  ".expo",
  ".gilbert",
  ".git",
  ".gradle",
  ".hg",
  ".idea",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".svn",
  ".tools",
  ".tmp",
  ".turbo",
  ".venv",
  ".vite",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "deriveddata",
  "dist",
  "env",
  "logs",
  "node_modules",
  "pods",
  "target",
  "temp",
  "tmp",
  "venv",
];

export const DEFAULT_TEXT_SEARCH_EXTENSIONS = [
  "astro",
  "bat",
  "c",
  "cmd",
  "cpp",
  "cs",
  "css",
  "csv",
  "dart",
  "go",
  "graphql",
  "h",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "lua",
  "md",
  "mdx",
  "php",
  "ps1",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
];

export interface TraversedFile {
  extension: string;
  modifiedAt?: number | null;
  name: string;
  path: string;
  size?: number | null;
}

export interface WalkWorkspaceFilesOptions {
  deadlineMs?: number;
  excludeDirectories?: Set<string>;
  extensions?: Set<string>;
  includeGenerated?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

export interface WalkWorkspaceFilesResult {
  files: TraversedFile[];
  inaccessibleEntries: number;
  limited: boolean;
  scannedDirectories: number;
  skippedDirectories: number;
  skippedFiles: number;
}

export async function walkWorkspaceFiles(
  backend: FilesBackend,
  rootPath: string,
  options: WalkWorkspaceFilesOptions = {},
): Promise<WalkWorkspaceFilesResult> {
  const queue = [rootPath];
  const files: TraversedFile[] = [];
  const excludeDirectories = new Set([
    ...(options.includeGenerated ? [] : DEFAULT_EXCLUDED_DIRECTORIES),
    ...(options.excludeDirectories ?? []),
  ]);
  let inaccessibleEntries = 0;
  let limited = false;
  let scannedDirectories = 0;
  let skippedDirectories = 0;
  let skippedFiles = 0;

  while (queue.length > 0) {
    if (options.signal?.aborted) {
      break;
    }

    if (options.deadlineMs !== undefined && Date.now() >= options.deadlineMs) {
      limited = true;
      break;
    }

    const currentPath = queue.shift()!;
    let listing;

    try {
      listing = await backend.listDirectory(currentPath);
    } catch {
      inaccessibleEntries += 1;
      continue;
    }

    scannedDirectories += 1;
    inaccessibleEntries += listing.inaccessibleEntries;
    limited ||= listing.limited;

    for (const entry of listing.entries) {
      if (options.deadlineMs !== undefined && Date.now() >= options.deadlineMs) {
        limited = true;
        break;
      }

      if (options.limit !== undefined && files.length >= options.limit) {
        limited = true;
        break;
      }

      if (entry.kind === "directory") {
        if (excludeDirectories.has(entry.name.toLowerCase())) {
          skippedDirectories += 1;
        } else {
          queue.push(entry.path);
        }
        continue;
      }

      if (entry.kind !== "file") {
        skippedFiles += 1;
        continue;
      }

      const extension = normalizeExtension(entry.extension ?? extensionFromName(entry.name));
      if (options.extensions && (!extension || !options.extensions.has(extension))) {
        skippedFiles += 1;
        continue;
      }

      files.push(normalizeFileEntry(entry, extension));
    }

    if (options.limit !== undefined && files.length >= options.limit) {
      break;
    }
  }

  return {
    files,
    inaccessibleEntries,
    limited,
    scannedDirectories,
    skippedDirectories,
    skippedFiles,
  };
}

export function normalizeExtension(extension: string) {
  return extension.trim().replace(/^\./, "").toLowerCase();
}

export function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function extensionFromName(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1) : "";
}

function normalizeFileEntry(entry: ComputerDirectoryEntry, extension: string): TraversedFile {
  return {
    extension,
    modifiedAt: entry.modifiedAt ?? null,
    name: entry.name,
    path: entry.path,
    size: entry.size ?? null,
  };
}
