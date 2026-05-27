import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauriDesktopRuntime } from "../app/tauriClient";
import type {
  ComputerCreateDirectoryResult,
  ComputerDirectoryListing,
  ComputerDrive,
  ComputerGitActionResult,
  ComputerGitDiffResult,
  ComputerFileIndexProgress,
  ComputerFileIndexSummary,
  ComputerGitStatus,
  ComputerGitWorktreeResult,
  ComputerDeleteFileResult,
  ComputerCopyPathResult,
  ComputerMovePathResult,
  ComputerReadFileResult,
  ComputerReadFileRangeResult,
  ComputerSearchResult,
  ComputerTextSearchRequest,
  ComputerTextSearchResponse,
  ComputerWriteFileResult,
  ComputerWriteFilesResult,
  LocalPermissionMode,
  LocalWorkspaceScope,
  LocalWorkspaceSettings,
} from "../types/localWorkspace";
import type { ToolRegistrySettings } from "../types/tools";

const DEFAULT_FOLDER_INDEX_LIMIT: number | undefined = undefined;
const DEFAULT_FULL_COMPUTER_INDEX_LIMIT: number | undefined = undefined;
const DEFAULT_FOLDER_DEPTH: number | undefined = undefined;
const DEFAULT_FULL_COMPUTER_DEPTH: number | undefined = undefined;
const MAX_GILBERT_MEMORY_IMPORT_DEPTH = 3;
const MAX_GILBERT_MEMORY_FILE_BYTES = 24 * 1024;
const MAX_GILBERT_MEMORY_CONTEXT_CHARS = 12_000;
const COMPUTER_FILE_INDEX_PROGRESS_EVENT = "computer-file-index-progress";
const GIT_STATUS_CACHE_TTL_MS = 4_000;
const GIT_STATUS_RICH_CACHE_TTL_MS = 1_500;
const CONTEXT_SEARCH_RESULT_LIMIT = 8;
const CONTEXT_DIRECTORY_LISTING_LIMIT = 40;
const CONTEXT_GIT_CHANGED_FILE_LIMIT = 36;
const LOCAL_WORKSPACE_CONTEXT_MAX_CHARS = 24_000;
const SEARCH_PREVIEW_MAX_CHARS = 360;
const COMPUTER_LIST_DIRECTORY_TIMEOUT_MS = 8_000;
const COMPUTER_READ_TEXT_FILE_TIMEOUT_MS = 12_000;
const COMPUTER_SEARCH_TEXT_FILES_TIMEOUT_MS = 20_000;
const COMPUTER_GIT_STATUS_TIMEOUT_MS = 10_000;

interface ComputerGitStatusOptions {
  force?: boolean;
  includeDiffPreview?: boolean;
}

const gitStatusCache = new Map<string, { capturedAt: number; status: ComputerGitStatus }>();
const pendingGitStatusRequests = new Map<string, Promise<ComputerGitStatus>>();

/** Project-local memory file imported into workspace context when present. */
export const GILBERT_PROJECT_MEMORY_FILE = "GILBERT.md";

/** A loaded project memory note and the absolute/local path it came from. */
export interface GilbertProjectMemory {
  content: string;
  path: string;
}

type BrowserDirectoryHandle = {
  entries?: () => AsyncIterable<[string, BrowserFileSystemHandle]>;
  getDirectoryHandle?: (name: string, options?: { create?: boolean }) => Promise<BrowserDirectoryHandle>;
  getFileHandle?: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
  kind: "directory";
  name: string;
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
  values?: () => AsyncIterable<BrowserFileSystemHandle>;
};

type BrowserFileHandle = {
  createWritable?: () => Promise<{
    close: () => Promise<void>;
    write: (data: string) => Promise<void>;
  }>;
  getFile: () => Promise<File>;
  kind: "file";
  name: string;
};

type BrowserFileSystemHandle = BrowserDirectoryHandle | BrowserFileHandle;

interface BrowserWorkspaceRoot {
  handle: BrowserDirectoryHandle;
  name: string;
  path: string;
}

interface BrowserIndexedEntry extends ComputerSearchResult {
  content?: string;
  haystack: string;
}

const BROWSER_WORKSPACE_PREFIX = "browser-folder://";
const BROWSER_INDEX_SKIPPED_DIRECTORIES = new Set([
  ".cache",
  ".dart_tool",
  ".expo",
  ".git",
  ".gilbert",
  ".gradle",
  ".hg",
  ".idea",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".svn",
  ".tools",
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
]);
const BROWSER_INDEX_SKIPPED_FILES = new Set([".npmrc", ".pypirc", ".yarnrc", ".netrc", "credentials", "credentials.json", "secrets.json", "token.json"]);
const BROWSER_INDEX_SKIPPED_EXTENSIONS = new Set(["cer", "crt", "db", "der", "key", "log", "p12", "pem", "pfx", "sqlite", "sqlite3", "sqlite-shm", "sqlite-wal"]);
const browserWorkspaceRoots = new Map<string, BrowserWorkspaceRoot>();
let browserIndexEntries: BrowserIndexedEntry[] = [];
let browserIndexSummary: ComputerFileIndexSummary = {
  builtAt: undefined,
  entryCount: 0,
  ignoredEntries: 0,
  roots: [],
  scannedDirectories: 0,
  skippedEntries: 0,
  truncated: false,
};

/** Returns the desktop default workspace, or the first browser folder fallback. */
export async function getDefaultComputerWorkspace() {
  if (!isTauriDesktopRuntime()) {
    return browserWorkspaceRoots.keys().next().value ?? "";
  }

  return (await invoke<string | null>("computer_get_default_workspace")) ?? "";
}

/** Lists readable roots for full-computer and folder-picker UI. */
export async function listComputerDrives() {
  if (!isTauriDesktopRuntime()) {
    return Array.from(browserWorkspaceRoots.values()).map((root) => ({
      available: true,
      kind: "browser-folder",
      label: root.name,
      name: root.name,
      path: root.path,
    })) satisfies ComputerDrive[];
  }

  return await invoke<ComputerDrive[]>("computer_list_drives");
}

/** Opens the native folder picker in desktop, with browser File System Access fallback. */
export async function pickComputerFolder(startPath?: string) {
  if (!isTauriDesktopRuntime()) {
    return await pickBrowserFolder();
  }

  return await invoke<string | null>("computer_pick_folder", {
    startPath,
  });
}

/** Registers folders dropped onto the browser preview fallback runtime. */
export async function registerBrowserDroppedFolders(dataTransfer: DataTransfer) {
  if (isTauriDesktopRuntime()) {
    return [];
  }

  const roots: string[] = [];

  for (const item of Array.from(dataTransfer.items)) {
    const getHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<BrowserFileSystemHandle | null> }).getAsFileSystemHandle;

    if (!getHandle || item.kind !== "file") {
      continue;
    }

    const handle = await getHandle.call(item);

    if (handle?.kind === "directory") {
      roots.push(registerBrowserWorkspaceRoot(handle));
    }
  }

  return roots;
}

/** Subscribes to native folder drag/drop events from the Tauri webview. */
export async function listenForComputerFolderDrops(onDrop: (paths: string[]) => void, onHover?: (hovering: boolean) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;

    if (payload.type === "enter" || payload.type === "over") {
      onHover?.(true);
      return;
    }

    if (payload.type === "leave") {
      onHover?.(false);
      return;
    }

    onHover?.(false);
    onDrop(payload.paths);
  });
}

/** Lists one directory from the native command layer or browser folder fallback. */
export async function listComputerDirectory(path: string, limit?: number) {
  if (isBrowserWorkspacePath(path)) {
    return await listBrowserDirectory(path, limit);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Open or drop a folder first so Gilbert can browse it.");
  }

  return await invokeComputerCommand<ComputerDirectoryListing>(
    "computer_list_directory",
    {
      request: {
        ...(limit === undefined ? {} : { limit }),
        path,
      },
    },
    COMPUTER_LIST_DIRECTORY_TIMEOUT_MS,
    `List directory ${path}`,
  );
}

/** Builds the hybrid file index for the selected workspace scope. */
export async function buildComputerFileIndex(roots: string[], scope: LocalWorkspaceScope, requestId = Date.now()) {
  const fullComputer = scope === "full-computer";
  const indexRoots = getIndexableWorkspaceRoots(roots, scope);

  if (indexRoots.length === 0) {
    return emptyComputerFileIndexSummary();
  }

  if (!isTauriDesktopRuntime() || indexRoots.some(isBrowserWorkspacePath)) {
    return await buildBrowserFileIndex(indexRoots, fullComputer ? DEFAULT_FULL_COMPUTER_DEPTH : DEFAULT_FOLDER_DEPTH, fullComputer ? DEFAULT_FULL_COMPUTER_INDEX_LIMIT : DEFAULT_FOLDER_INDEX_LIMIT);
  }

  return await invoke<ComputerFileIndexSummary>("computer_build_file_index", {
    request: {
      maxDepth: fullComputer ? DEFAULT_FULL_COMPUTER_DEPTH : DEFAULT_FOLDER_DEPTH,
      maxFiles: fullComputer ? DEFAULT_FULL_COMPUTER_INDEX_LIMIT : DEFAULT_FOLDER_INDEX_LIMIT,
      requestId,
      roots: indexRoots,
    },
  });
}

/** Streams indexing progress from Rust while large folders are scanned. */
export async function listenForComputerFileIndexProgress(onProgress: (progress: ComputerFileIndexProgress) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<ComputerFileIndexProgress>(COMPUTER_FILE_INDEX_PROGRESS_EVENT, (event) => {
    onProgress(event.payload);
  });
}

/** Returns the most recent local file-index summary for UI status and context. */
export async function getComputerFileIndexSummary() {
  if (!isTauriDesktopRuntime()) {
    return browserIndexSummary;
  }

  return await invoke<ComputerFileIndexSummary>("computer_get_file_index_summary");
}

/** Reads local Git status for a workspace root when native git is available. */
export async function getComputerGitStatus(path: string, options: ComputerGitStatusOptions = {}): Promise<ComputerGitStatus> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    return createUnavailableGitStatus(path ? "Git status is available in the desktop app for real folders." : "Choose a project folder first.");
  }

  const includeDiffPreview = options.includeDiffPreview === true;
  const cacheKey = createGitStatusCacheKey(path, includeDiffPreview);
  const pending = pendingGitStatusRequests.get(cacheKey);

  if (pending) {
    return pending;
  }

  const cached = gitStatusCache.get(cacheKey);
  const cacheTtl = includeDiffPreview ? GIT_STATUS_RICH_CACHE_TTL_MS : GIT_STATUS_CACHE_TTL_MS;

  if (!options.force && cached && Date.now() - cached.capturedAt < cacheTtl) {
    return cached.status;
  }

  const request = invokeComputerCommand<ComputerGitStatus>(
    "computer_get_git_status",
    {
      request: {
        includeDiffPreview,
        path,
      },
    },
    COMPUTER_GIT_STATUS_TIMEOUT_MS,
    `Check Git status for ${path}`,
  ).then((status) => {
    gitStatusCache.set(cacheKey, { capturedAt: Date.now(), status });
    return status;
  }).finally(() => {
    pendingGitStatusRequests.delete(cacheKey);
  });

  pendingGitStatusRequests.set(cacheKey, request);
  return request;
}

function createGitStatusCacheKey(path: string, includeDiffPreview: boolean) {
  return `${includeDiffPreview ? "rich" : "summary"}:${path.trim().toLowerCase()}`;
}

/** Initializes Git in a selected local project folder. */
export async function initComputerGitRepository(path: string, initialBranch = "main"): Promise<ComputerGitActionResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitActionResult>("computer_git_init", {
    request: {
      initialBranch,
      path,
    },
  });
}

/** Stages all local Git changes by default and creates a commit. */
export async function commitComputerGitChanges(path: string, message: string, stageAll = true): Promise<ComputerGitActionResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitActionResult>("computer_git_commit", {
    request: {
      message,
      path,
      stageAll,
    },
  });
}

/** Creates and switches to a new local Git branch. */
export async function createComputerGitBranch(path: string, name: string): Promise<ComputerGitActionResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitActionResult>("computer_git_create_branch", {
    request: {
      name,
      path,
    },
  });
}

/** Returns a full local Git diff, including untracked text files by default. */
export async function diffComputerGitChanges(
  path: string,
  options: {
    includeUntracked?: boolean;
    maxBytes?: number;
    paths?: string[];
    staged?: boolean;
  } = {},
): Promise<ComputerGitDiffResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitDiffResult>("computer_git_diff", {
    request: {
      includeUntracked: options.includeUntracked,
      maxBytes: options.maxBytes,
      path,
      paths: options.paths,
      staged: options.staged,
    },
  });
}

/** Stages all changes, or a precise set of paths, in a local Git repository. */
export async function stageComputerGitChanges(path: string, paths?: string[]): Promise<ComputerGitActionResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitActionResult>("computer_git_stage", {
    request: {
      path,
      paths,
    },
  });
}

/** Pushes the current branch and sets origin/current-branch as upstream when needed. */
export async function pushComputerGitBranch(path: string, remote = "origin"): Promise<ComputerGitActionResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitActionResult>("computer_git_push", {
    request: {
      path,
      remote,
    },
  });
}

/** Pulls the current local branch with fast-forward-only safety. */
export async function pullComputerGitBranch(path: string, options: { branch?: string; remote?: string } = {}): Promise<ComputerGitActionResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git actions are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitActionResult>("computer_git_pull", {
    request: {
      branch: options.branch,
      path,
      remote: options.remote,
    },
  });
}

/** Creates a sibling Git worktree on a fresh branch for a forked chat. */
export async function createComputerGitWorktree(path: string, request: { branchName?: string; directoryName?: string; title?: string } = {}): Promise<ComputerGitWorktreeResult> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    throw new Error(path ? "Git worktrees are available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitWorktreeResult>("computer_git_create_worktree", {
    request: {
      branchName: request.branchName,
      directoryName: request.directoryName,
      path,
      title: request.title,
    },
  });
}

/** Searches the current file index and optionally filters results to selected roots. */
export async function searchComputerFiles(query: string, limit?: number, roots: string[] = []) {
  const filterToRoots = (results: ComputerSearchResult[]) => (roots.length > 0 ? results.filter((result) => roots.some((root) => isPathInsideRoot(result.path, root))) : results);

  if (!isTauriDesktopRuntime()) {
    return filterToRoots(searchBrowserFileIndex(query, limit));
  }

  const results = await invoke<ComputerSearchResult[]>("computer_search_file_index", {
    request: {
      ...(limit === undefined ? {} : { limit }),
      query,
    },
  });

  return filterToRoots(results);
}

/** Streams exact text search through the native filesystem backend when desktop is available. */
export async function searchComputerTextFiles(request: ComputerTextSearchRequest) {
  if (isBrowserWorkspacePath(request.path) || !isTauriDesktopRuntime()) {
    throw new Error("Native text search is available in the desktop app for real folders.");
  }

  return await invokeComputerCommand<ComputerTextSearchResponse>(
    "computer_search_text_files",
    { request },
    COMPUTER_SEARCH_TEXT_FILES_TIMEOUT_MS,
    `Search text files in ${request.path}`,
  );
}

/** Reads a text file through the active desktop or browser workspace backend. */
export async function readComputerTextFile(path: string, maxBytes?: number, offset?: number) {
  if (isBrowserWorkspacePath(path)) {
    return await readBrowserTextFile(path, maxBytes, offset);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Open or drop a folder first so Gilbert can read files.");
  }

  return await invokeComputerCommand<ComputerReadFileResult>(
    "computer_read_text_file",
    {
      request: {
        ...(maxBytes === undefined ? {} : { maxBytes }),
        ...(offset === undefined ? {} : { offset }),
        path,
      },
    },
    COMPUTER_READ_TEXT_FILE_TIMEOUT_MS,
    `Read file ${path}`,
  );
}

/** Reads a 1-based line range through the native filesystem backend without loading the whole file into memory. */
export async function readComputerTextFileRange(path: string, startLine: number, endLine: number) {
  if (isBrowserWorkspacePath(path) || !isTauriDesktopRuntime()) {
    throw new Error("Native line-range reads are available in the desktop app for real files.");
  }

  return await invokeComputerCommand<ComputerReadFileRangeResult>(
    "computer_read_text_file_range",
    {
      request: {
        endLine,
        path,
        startLine,
      },
    },
    COMPUTER_READ_TEXT_FILE_TIMEOUT_MS,
    `Read file range ${path}`,
  );
}

function invokeComputerCommand<T>(command: string, args: Record<string, unknown>, timeoutMs: number, label: string): Promise<T> {
  const safeTimeoutMs = Math.max(1_000, timeoutMs);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId: ReturnType<typeof setTimeout> = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(`${label} did not respond within ${Math.round(safeTimeoutMs / 1000)} seconds.`));
    }, safeTimeoutMs);

    invoke<T>(command, args).then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export interface WriteComputerTextFileOptions {
  createParentDirs?: boolean;
  overwrite?: boolean;
  // Lowercase hex SHA-256 of the last observed file; Rust rejects writes when it no longer matches.
  expectedSha256?: string;
  /** Force a specific line-ending family. Defaults to majority-of-existing. */
  forceEol?: "crlf" | "lf";
}

export interface WriteComputerTextFileItem extends WriteComputerTextFileOptions {
  content: string;
  path: string;
}

/** Writes a text file after the caller has already resolved permission policy. */
export async function writeComputerTextFile(
  path: string,
  content: string,
  roots: string[],
  options: WriteComputerTextFileOptions = {},
) {
  if (isBrowserWorkspacePath(path)) {
    return await writeBrowserTextFile(path, content, roots, options);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app or open a browser folder before writing files.");
  }

  return await invoke<ComputerWriteFileResult>("computer_write_text_file", {
    request: {
      content,
      createParentDirs: options.createParentDirs ?? true,
      overwrite: options.overwrite ?? true,
      path,
      roots,
      expectedSha256: options.expectedSha256,
      forceEol: options.forceEol,
    },
  });
}

/** Writes many text files with one desktop command where available. */
export async function writeComputerTextFiles(
  files: WriteComputerTextFileItem[],
  roots: string[],
): Promise<ComputerWriteFilesResult> {
  if (files.length === 0) {
    return { files: [] };
  }

  if (files.some((file) => isBrowserWorkspacePath(file.path)) || !isTauriDesktopRuntime()) {
    const results = await Promise.all(files.map(async (file) => {
      try {
        const result = await writeComputerTextFile(file.path, file.content, roots, file);
        return {
          ok: true,
          requestedPath: file.path,
          result,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : typeof error === "string" ? error : "Could not write file.",
          ok: false,
          requestedPath: file.path,
        };
      }
    }));

    return { files: results };
  }

  return await invoke<ComputerWriteFilesResult>("computer_write_text_files", {
    request: {
      files: files.map((file) => ({
        content: file.content,
        createParentDirs: file.createParentDirs,
        expectedSha256: file.expectedSha256,
        forceEol: file.forceEol,
        overwrite: file.overwrite,
        path: file.path,
      })),
      roots,
    },
  });
}

/** Creates a directory through the active backend. */
export async function createComputerDirectory(
  path: string,
  roots: string[],
  options: { recursive?: boolean } = {},
): Promise<ComputerCreateDirectoryResult> {
  if (isBrowserWorkspacePath(path)) {
    return await createBrowserDirectory(path, roots, options);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app or open a browser folder before creating folders.");
  }

  return await invoke<ComputerCreateDirectoryResult>("computer_create_directory", {
    request: {
      path,
      recursive: options.recursive ?? true,
      roots,
    },
  });
}

/** Deletes one file through the active backend; directories are rejected below Rust/browser layers. */
export async function deleteComputerFile(path: string, roots: string[]) {
  if (isBrowserWorkspacePath(path)) {
    return await deleteBrowserFile(path, roots);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app or open a browser folder before deleting files.");
  }

  return await invoke<ComputerDeleteFileResult>("computer_delete_file", {
    request: {
      path,
      roots,
    },
  });
}

/** Moves or renames a file or folder through the desktop backend. */
export async function moveComputerPath(
  fromPath: string,
  toPath: string,
  roots: string[],
  options: { createParentDirs?: boolean } = {},
) {
  if (isBrowserWorkspacePath(fromPath) || isBrowserWorkspacePath(toPath)) {
    throw new Error("Rename and move operations are available in the desktop app for real folders.");
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app before renaming or moving files and folders.");
  }

  return await invoke<ComputerMovePathResult>("computer_move_path", {
    request: {
      createParentDirs: options.createParentDirs ?? true,
      fromPath,
      roots,
      toPath,
    },
  });
}

/** Copies a file or folder through the desktop backend. */
export async function copyComputerPath(
  fromPath: string,
  toPath: string,
  roots: string[],
  options: { createParentDirs?: boolean; overwrite?: boolean } = {},
) {
  if (isBrowserWorkspacePath(fromPath) || isBrowserWorkspacePath(toPath)) {
    throw new Error("Copy operations are available in the desktop app for real folders.");
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app before copying files and folders.");
  }

  return await invoke<ComputerCopyPathResult>("computer_copy_path", {
    request: {
      createParentDirs: options.createParentDirs ?? true,
      fromPath,
      overwrite: options.overwrite ?? false,
      roots,
      toPath,
    },
  });
}

/** Resolves saved workspace settings to concrete roots used by host context. */
export async function resolveLocalWorkspaceRoots(settings: LocalWorkspaceSettings) {
  if (!settings.enabled) {
    return [];
  }

  if (settings.scope === "full-computer") {
    if (!isTauriDesktopRuntime() && settings.roots.length > 0) {
      return settings.roots;
    }

    const drives = await listComputerDrives();
    return mergeFullComputerRoots(settings.roots, drives);
  }

  if (settings.roots.length > 0) {
    return settings.roots;
  }

  return [];
}

// Builds compact advisory workspace context without scanning entire trees or implying real tool work occurred.
export async function createLocalWorkspaceContext(settings: LocalWorkspaceSettings, prompt: string, toolSettings?: ToolRegistrySettings, options: { maxContextChars?: number } = {}) {
  if (!settings.enabled) {
    return "";
  }

  const roots = await resolveLocalWorkspaceRoots(settings);
  const contextRoots = settings.scope === "full-computer" ? getIndexableWorkspaceRoots(roots, settings.scope) : roots;

  if (roots.length === 0) {
    return createWorkspaceHeader(settings, [], undefined, "No readable roots are selected yet.", toolSettings);
  }

  if (settings.scope === "full-computer" && contextRoots.length === 0) {
    return createWorkspaceHeader(
      settings,
      roots,
      undefined,
      "Full computer access is enabled lazily. Gilbert will not index or load whole drive roots into context; use app-exposed bridge tools only when precise evidence is required.",
      toolSettings,
    );
  }

  const summary = await getMatchingComputerFileIndexSummary(contextRoots);
  const gitStatuses = await Promise.all(contextRoots.map((root) => getComputerGitStatus(root).catch((error) => createUnavailableGitStatus(readErrorMessage(error, "Git status unavailable.")))));
  const projectMemories = await readGilbertProjectMemories(contextRoots);
  const searchResults = summary && summary.entryCount > 0
    ? await searchComputerFiles(prompt, CONTEXT_SEARCH_RESULT_LIMIT, contextRoots).catch(() => [])
    : [];
  const hintedFolders = await resolvePromptFolders(prompt, contextRoots);
  const listings = await Promise.all(
    uniquePaths([...hintedFolders, ...contextRoots]).map(async (root) => {
      try {
        return await listComputerDirectory(root, CONTEXT_DIRECTORY_LISTING_LIMIT);
      } catch {
        return null;
      }
    }),
  );

  return limitContext(
    [
      createWorkspaceHeader(settings, roots, summary, undefined, toolSettings),
      settings.scope === "full-computer"
        ? "Full computer scope is lazy: automatic context and indexing use only the focused project/folder roots above. Drive roots are not scanned or listed automatically."
        : "",
      formatGitStatuses(gitStatuses),
      formatGilbertProjectMemories(projectMemories),
      formatRootListings(listings.flatMap((listing) => (listing ? [listing] : []))),
      formatSearchResults(searchResults, Boolean(summary && summary.entryCount > 0)),
    ]
      .filter(Boolean)
      .join("\n\n"),
    options.maxContextChars,
  );
}

export function localPermissionModeLabel(mode: LocalPermissionMode) {
  if (mode === "full-access") {
    return "Full access";
  }

  if (mode === "auto-review") {
    return "Auto-review";
  }

  return "Default permissions";
}

export function localWorkspaceScopeLabel(scope: LocalWorkspaceScope) {
  if (scope === "full-computer") {
    return "Full computer";
  }

  if (scope === "selected-folder") {
    return "Selected folder";
  }

  return "Current folder";
}

// Full-computer scope adds host drive roots while keeping the active project roots first.
export function mergeFullComputerRoots(preferredRoots: string[], drives: ComputerDrive[]) {
  return uniquePaths([...preferredRoots.filter((root) => !isSystemRootPath(root)), ...drives.map((drive) => drive.path)]);
}

export function getIndexableWorkspaceRoots(roots: string[], scope: LocalWorkspaceScope) {
  if (scope !== "full-computer") {
    return roots;
  }

  return roots.filter((root) => !isSystemRootPath(root));
}

function emptyComputerFileIndexSummary(): ComputerFileIndexSummary {
  return {
    builtAt: Date.now(),
    entryCount: 0,
    ignoredEntries: 0,
    roots: [],
    scannedDirectories: 0,
    skippedEntries: 0,
    truncated: false,
  };
}

function isSystemRootPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");

  return (
    normalized === "/" ||
    withoutTrailingSlash === "" ||
    /^[a-zA-Z]:$/.test(withoutTrailingSlash)
  );
}

export function formatIndexSummary(summary?: ComputerFileIndexSummary) {
  if (!summary || summary.entryCount === 0) {
    return "Not indexed";
  }

  const entryCount = new Intl.NumberFormat().format(summary.entryCount);
  const ignored = summary.ignoredEntries > 0 ? `, ${new Intl.NumberFormat().format(summary.ignoredEntries)} ignored` : "";
  const suffix = summary.truncated ? " indexed, stopped at the explicit index limit" : " indexed";
  return `${entryCount}${suffix}${ignored}`;
}

export function formatLocalWorkspaceIndexStatus(settings: LocalWorkspaceSettings) {
  if (settings.indexStatus === "indexing") {
    return settings.indexReason || "Indexing...";
  }

  if (settings.indexStatus === "error") {
    return "Index failed";
  }

  return formatIndexSummary(settings.indexSummary);
}

async function pickBrowserFolder() {
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle> }).showDirectoryPicker;

  if (!picker) {
    throw new Error("This browser cannot open folders directly. Use the desktop app or type a folder path there.");
  }

  const handle = await picker.call(window, { mode: "readwrite" });
  return registerBrowserWorkspaceRoot(handle);
}

function registerBrowserWorkspaceRoot(handle: BrowserDirectoryHandle) {
  const path = createBrowserWorkspacePath(handle.name);

  browserWorkspaceRoots.set(path, {
    handle,
    name: handle.name,
    path,
  });

  return path;
}

async function listBrowserDirectory(path: string, limit?: number): Promise<ComputerDirectoryListing> {
  const resolved = await resolveBrowserDirectory(path);
  const entries: ComputerDirectoryListing["entries"] = [];
  let inaccessibleEntries = 0;
  let limited = false;

  for await (const handle of iterateDirectoryHandles(resolved.handle)) {
    if (limit !== undefined && entries.length >= limit) {
      limited = true;
      break;
    }

    try {
      const entryPath = joinBrowserPath(resolved.path, handle.name);

      if (handle.kind === "directory") {
        entries.push({
          kind: "directory",
          name: handle.name,
          path: entryPath,
        });
      } else {
        const file = await handle.getFile();

        entries.push({
          extension: fileExtensionFromName(handle.name),
          kind: "file",
          modifiedAt: file.lastModified,
          name: handle.name,
          path: entryPath,
          size: file.size,
        });
      }
    } catch {
      inaccessibleEntries += 1;
    }
  }

  entries.sort((left, right) => {
    const leftRank = left.kind === "directory" ? 0 : 1;
    const rightRank = right.kind === "directory" ? 0 : 1;
    return leftRank - rightRank || left.name.toLowerCase().localeCompare(right.name.toLowerCase());
  });

  return {
    entries,
    inaccessibleEntries,
    limited,
    parentPath: browserParentPath(resolved.path),
    path: resolved.path,
  };
}

async function buildBrowserFileIndex(roots: string[], maxDepth?: number, maxFiles?: number): Promise<ComputerFileIndexSummary> {
  const rootPaths = uniquePaths(roots.filter(isBrowserWorkspacePath));
  const nextEntries: BrowserIndexedEntry[] = [];
  let scannedDirectories = 0;
  let ignoredEntries = 0;
  let skippedEntries = 0;
  let truncated = false;

  for (const rootPath of rootPaths) {
    try {
      const root = await resolveBrowserDirectory(rootPath);
      const queue: Array<{ depth: number; handle: BrowserDirectoryHandle; path: string }> = [{ depth: 0, handle: root.handle, path: root.path }];

      while (queue.length > 0) {
        const item = queue.shift()!;
        scannedDirectories += 1;

        for await (const handle of iterateDirectoryHandles(item.handle)) {
          if (maxFiles !== undefined && nextEntries.length >= maxFiles) {
            truncated = true;
            break;
          }

          const entryPath = joinBrowserPath(item.path, handle.name);

          if (shouldSkipBrowserIndexEntry(handle.name, handle.kind)) {
            ignoredEntries += 1;
            skippedEntries += 1;
            continue;
          }

          if (handle.kind === "directory") {
            nextEntries.push({
              haystack: `${handle.name} ${entryPath}`.toLowerCase(),
              kind: "directory",
              name: handle.name,
              path: entryPath,
              score: 0,
            });

            if (maxDepth === undefined || item.depth < maxDepth) {
              queue.push({ depth: item.depth + 1, handle, path: entryPath });
            }
          } else {
            try {
              const file = await handle.getFile();
              const extension = fileExtensionFromName(handle.name);
              const content = shouldReadBrowserFile(file) ? await readFilePreview(file) : "";
              const preview = content || undefined;

              nextEntries.push({
                content,
                extension,
                haystack: `${handle.name} ${entryPath} ${extension ?? ""} ${preview ?? ""}`.toLowerCase(),
                kind: "file",
                modifiedAt: file.lastModified,
                name: handle.name,
                path: entryPath,
                preview,
                score: 0,
                size: file.size,
              });
            } catch {
              skippedEntries += 1;
            }
          }
        }

        if (truncated) {
          break;
        }
      }
    } catch {
      skippedEntries += 1;
    }

    if (truncated) {
      break;
    }
  }

  browserIndexEntries = nextEntries;
  browserIndexSummary = {
    builtAt: Date.now(),
    entryCount: nextEntries.length,
    ignoredEntries,
    roots: rootPaths,
    scannedDirectories,
    skippedEntries,
    truncated,
  };

  return browserIndexSummary;
}

function shouldSkipBrowserIndexEntry(name: string, kind: BrowserFileSystemHandle["kind"]) {
  const normalizedName = name.toLowerCase();

  if (kind === "directory") {
    return BROWSER_INDEX_SKIPPED_DIRECTORIES.has(normalizedName);
  }

  if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
    return true;
  }

  if (BROWSER_INDEX_SKIPPED_FILES.has(normalizedName)) {
    return true;
  }

  const extension = fileExtensionFromName(normalizedName);
  return extension ? BROWSER_INDEX_SKIPPED_EXTENSIONS.has(extension) : false;
}

function searchBrowserFileIndex(query: string, limit?: number) {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return [];
  }

  return browserIndexEntries
    .map((entry) => ({
      ...entry,
      ...scoreBrowserEntry(entry, query, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit ?? undefined)
    .map(({ content, haystack, ...entry }) => entry);
}

async function readBrowserTextFile(path: string, maxBytes?: number, offset?: number): Promise<ComputerReadFileResult> {
  const { file, handle } = await resolveBrowserFile(path);
  const start = normalizeReadOffset(offset);
  const content = await readFilePreview(file, maxBytes, start);
  const truncated = start > 0 || (maxBytes !== undefined && file.size > start + maxBytes);

  return {
    content,
    extension: fileExtensionFromName(handle.name),
    modifiedAt: file.lastModified,
    name: handle.name,
    path,
    sha256: truncated ? undefined : await hashTextSha256(content),
    size: file.size,
    truncated,
  };
}

async function writeBrowserTextFile(
  path: string,
  content: string,
  roots: string[],
  options: WriteComputerTextFileOptions,
): Promise<ComputerWriteFileResult> {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("Writes are only allowed inside the selected browser folder.");
  }

  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    throw new Error("Choose a file path, not the folder root.");
  }

  const fileName = parts[parts.length - 1];
  let directoryHandle = root.handle;
  let resolvedPath = root.path;

  for (const part of parts.slice(0, -1)) {
    if (!directoryHandle.getDirectoryHandle) {
      throw new Error("This browser cannot create folders in that workspace.");
    }

    directoryHandle = await directoryHandle.getDirectoryHandle(part, { create: options.createParentDirs ?? true });
    resolvedPath = joinBrowserPath(resolvedPath, part);
  }

  if (!directoryHandle.getFileHandle) {
    throw new Error("This browser cannot write that file.");
  }

  let created = false;

  try {
    const existingHandle = await directoryHandle.getFileHandle(fileName);

    if (options.overwrite === false) {
      throw new Error("That file already exists and overwrite is disabled.");
    }

    if (options.expectedSha256) {
      const existingFile = await existingHandle.getFile();
      const existingContent = await existingFile.text();
      const actualSha256 = await hashTextSha256(existingContent);
      if (actualSha256 && actualSha256.toLowerCase() !== options.expectedSha256.toLowerCase()) {
        throw new Error(`Refusing to write ${path}: file changed since it was last read (expected sha256 ${options.expectedSha256}, on-disk sha256 ${actualSha256}). Re-read the file before retrying.`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("overwrite is disabled")) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("file changed since it was last read")) {
      throw error;
    }

    created = true;
  }

  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });

  if (!fileHandle.createWritable) {
    throw new Error("This browser did not grant write access to that folder.");
  }

  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();

  return {
    bytesWritten: new TextEncoder().encode(content).byteLength,
    created,
    modifiedAt: Date.now(),
    path: joinBrowserPath(resolvedPath, fileName),
    sha256: await hashTextSha256(content),
  };
}

async function createBrowserDirectory(
  path: string,
  roots: string[],
  options: { recursive?: boolean },
): Promise<ComputerCreateDirectoryResult> {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("Folder creation is only allowed inside the selected browser folder.");
  }

  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    return {
      created: false,
      modifiedAt: Date.now(),
      path: root.path,
    };
  }

  let directoryHandle = root.handle;
  let resolvedPath = root.path;
  let created = false;

  for (const [index, part] of parts.entries()) {
    const getDirectoryHandle = directoryHandle.getDirectoryHandle?.bind(directoryHandle);

    if (!getDirectoryHandle) {
      throw new Error("This browser cannot create folders in that workspace.");
    }

    try {
      directoryHandle = await getDirectoryHandle(part);
    } catch {
      if (options.recursive === false && index < parts.length - 1) {
        throw new Error(`Parent folder does not exist: ${resolvedPath}`);
      }

      directoryHandle = await getDirectoryHandle(part, { create: true });
      created = true;
    }

    resolvedPath = joinBrowserPath(resolvedPath, part);
  }

  return {
    created,
    modifiedAt: Date.now(),
    path: resolvedPath,
  };
}

async function hashTextSha256(content: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deleteBrowserFile(path: string, roots: string[]): Promise<ComputerDeleteFileResult> {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("Deletes are only allowed inside the selected browser folder.");
  }

  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    throw new Error("Choose a file path, not the folder root.");
  }

  const fileName = parts[parts.length - 1];
  let directoryHandle = root.handle;

  for (const part of parts.slice(0, -1)) {
    if (!directoryHandle.getDirectoryHandle) {
      throw new Error("This browser cannot open that folder.");
    }

    directoryHandle = await directoryHandle.getDirectoryHandle(part);
  }

  if (!directoryHandle.getFileHandle || !directoryHandle.removeEntry) {
    throw new Error("This browser did not grant delete access to that folder.");
  }

  const handle = await directoryHandle.getFileHandle(fileName);
  const file = await handle.getFile();
  await directoryHandle.removeEntry(fileName, { recursive: false });

  return {
    bytesDeleted: file.size,
    deleted: true,
    path,
  };
}

async function getMatchingComputerFileIndexSummary(roots: string[]) {
  const currentSummary = await getComputerFileIndexSummary().catch(() => undefined);

  if (currentSummary && currentSummary.entryCount > 0 && sameRootSet(currentSummary.roots, roots)) {
    return currentSummary;
  }

  return undefined;
}

function createWorkspaceHeader(settings: LocalWorkspaceSettings, roots: string[], summary?: ComputerFileIndexSummary, issue?: string, _toolSettings?: ToolRegistrySettings) {
  const permissionRules = {
    "auto-review": "Diagnostic tools and future low-risk in-workspace actions may run after policy validation; destructive and external actions still require approval.",
    default: "Diagnostic and read-only bridge tools may run; mutating, terminal, external, network, destructive, publish, and credential-adjacent tools require approval.",
    "full-access": "In-scope file, terminal, and network actions may run without routine prompts; destructive, credential, publish, and connected-app write actions still use circuit breakers.",
  } satisfies Record<LocalPermissionMode, string>;

  return [
    "LOCAL WORKSPACE CONTEXT",
    "This is bounded, host-attached project context. It is not proof that a provider tool read, edited, tested, or executed anything.",
    `${GILBERT_PROJECT_MEMORY_FILE}: When present in a workspace root, Gilbert loads it like curated project memory for architecture notes, commands, decisions, style rules, lessons, and workflow preferences. It is not a raw tool-error log. @path imports are followed recursively with cycle protection.`,
    "Automatic workspace context may include root metadata, shallow listings, bounded project memory, and existing index hits. Treat it as helpful context, not proof of current file contents.",
    "Do not claim to have edited, read, listed, searched, tested, committed, or run terminal commands from this context alone. Ask the user for explicit evidence or use normal chat/web search where appropriate.",
    `Mode: ${localPermissionModeLabel(settings.permissionMode)}`,
    `Scope: ${localWorkspaceScopeLabel(settings.scope)}`,
    `Roots: ${roots.length > 0 ? roots.join(" | ") : "none"}`,
    `Index: ${summary ? `${summary.entryCount} entries, ${summary.scannedDirectories} folders scanned, ${summary.skippedEntries} skipped, ${summary.ignoredEntries ?? 0} ignored by ignore/secret rules${summary.truncated ? ", stopped at an explicit index limit" : ""}` : "not preloaded for this request"}`,
    `Permission rule: ${permissionRules[settings.permissionMode]}`,
    settings.scope === "full-computer"
      ? "Full computer scope: bridge tools can use precise absolute paths under host drive roots. Automatic context stays lazy, so list/search/read sibling projects, assets, downloads, or clone targets with tools before claiming they are unavailable."
      : "",
    issue ? `Tool note: ${issue}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function createUnavailableGitStatus(error?: string): ComputerGitStatus {
  return {
    additions: 0,
    ahead: 0,
    available: false,
    behind: 0,
    changedFiles: 0,
    clean: true,
    deletions: 0,
    error,
    files: [],
    stagedFiles: 0,
    unstagedFiles: 0,
    untrackedFiles: 0,
  };
}

function formatGitStatuses(statuses: ComputerGitStatus[]) {
  const availableStatuses = statuses.filter((status) => status.available);

  if (availableStatuses.length === 0) {
    return "";
  }

  return [
    "LOCAL GIT STATE",
    ...availableStatuses.map((status) => {
      const repository = status.githubOwner && status.githubRepo ? `${status.githubOwner}/${status.githubRepo}` : status.remoteUrl || "No GitHub remote detected";
      const branch = status.branch || "unknown branch";
      const changes = status.clean ? "working tree clean" : formatGitChangeSummary(status);
      const changedFiles = formatGitStatusFiles(status);

      return [
        `- ${status.repositoryRoot || "repository"}: ${repository}, branch ${branch}, ${changes}.`,
        changedFiles,
      ].filter(Boolean).join("\n");
    }),
    "Use this Git state when answering branch, local status, uncommitted-change, next-commit, next-push, or changed-file questions for the selected project. If the user asks for all details, use an app-exposed Git/file tool when available or ask for the exact status/diff.",
  ].join("\n");
}

function formatGitChangeSummary(status: ComputerGitStatus) {
  const changed = status.changedFiles === 1 ? "1 file changed" : `${status.changedFiles} files changed`;
  const additions = status.additions > 0 ? `+${status.additions}` : "";
  const deletions = status.deletions > 0 ? `-${status.deletions}` : "";
  const staged = typeof status.stagedFiles === "number" && status.stagedFiles > 0 ? `${status.stagedFiles} staged` : "";
  const unstaged = typeof status.unstagedFiles === "number" && status.unstagedFiles > 0 ? `${status.unstagedFiles} unstaged` : "";
  const untracked = typeof status.untrackedFiles === "number" && status.untrackedFiles > 0 ? `${status.untrackedFiles} untracked` : "";

  return [changed, additions, deletions, staged, unstaged, untracked].filter(Boolean).join(" ");
}

function formatGitStatusFiles(status: ComputerGitStatus) {
  const files = status.files ?? [];

  if (files.length === 0) {
    return "";
  }

  const visibleFiles = files.slice(0, CONTEXT_GIT_CHANGED_FILE_LIMIT).map((file) => {
    const stats = [file.additions > 0 ? `+${file.additions}` : "", file.deletions > 0 ? `-${file.deletions}` : ""].filter(Boolean).join(" ");
    const oldPath = file.oldPath ? `${file.oldPath} -> ` : "";
    return `  - ${file.status}: ${oldPath}${file.path}${stats ? ` (${stats})` : ""}`;
  });
  const omitted = files.length - visibleFiles.length;

  return [
    "  Changed files:",
    ...visibleFiles,
    omitted > 0 ? `  - (${omitted} more changed files omitted from automatic context; ask for the full current Git status/diff if needed.)` : "",
  ].filter(Boolean).join("\n");
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

export function createGilbertProjectMemoryTemplate() {
  return [
    "# Gilbert Project Memory",
    "",
    "Gilbert loads this file whenever this folder is selected. Keep it as curated project memory, not a raw error log.",
    "",
    "Write short notes that help future chats work correctly: architecture, important folders, commands, conventions, user preferences, decisions, and recovered lessons.",
    "Do not paste provider reasoning, hidden tool syntax, stack traces, raw terminal dumps, or repeated tool errors here. If a failure teaches something, summarize the lesson and the working pattern.",
    "",
    "## Project Overview",
    "- What this project does:",
    "- Primary app/runtime:",
    "- Important entry points:",
    "",
    "## Commands",
    "- Build:",
    "- Test:",
    "- Lint:",
    "- Run/dev:",
    "",
    "## Architecture Notes",
    "- Important folders:",
    "- Runtime boundaries:",
    "- Data/storage notes:",
    "",
    "## User Preferences",
    "- Product/UX preferences:",
    "- Code style preferences:",
    "- Verification expectations:",
    "",
    "## Decisions",
    "- Decision:",
    "- Why:",
    "",
    "## Lessons Learned",
    "- Lesson:",
    "- Working pattern:",
    "",
    "## Imports",
    "- Add @relative/path.md imports for larger project-memory files when needed.",
  ].join("\n");
}

export async function readGilbertProjectMemories(roots: string[]) {
  const visited = new Set<string>();
  const memories: GilbertProjectMemory[] = [];
  for (const root of roots) {
    const candidates = [
      joinPathParts(root, [GILBERT_PROJECT_MEMORY_FILE]),
      joinPathParts(root, ["Gilbert.md"]),
      joinPathParts(root, [".gilbert", GILBERT_PROJECT_MEMORY_FILE]),
      joinPathParts(root, [".gilbert", "Gilbert.md"]),
    ];

    for (const candidate of candidates) {
      const loaded = await readGilbertMemoryFile(candidate, visited, 0);

      for (const memory of loaded) {
        memories.push(memory);
      }
    }
  }

  return memories;
}

async function readGilbertMemoryFile(path: string, visited: Set<string>, depth: number): Promise<GilbertProjectMemory[]> {
  const key = normalizePathKey(path);

  if (!key || visited.has(key) || depth > MAX_GILBERT_MEMORY_IMPORT_DEPTH) {
    return [];
  }

  visited.add(key);

  try {
    const file = await readComputerTextFile(path, MAX_GILBERT_MEMORY_FILE_BYTES);
    const content = file.truncated
      ? `${file.content}\n[Project memory truncated after ${MAX_GILBERT_MEMORY_FILE_BYTES} bytes. Ask the user for exact omitted text if it matters.]`
      : file.content;
    const memories: GilbertProjectMemory[] = [{ content, path: file.path }];

    for (const importPath of extractGilbertMemoryImports(content)) {
      const resolvedImportPath = resolveGilbertMemoryImportPath(file.path, importPath);
      const imported = await readGilbertMemoryFile(resolvedImportPath, visited, depth + 1);

      for (const memory of imported) {
        memories.push(memory);
      }
    }

    return memories;
  } catch {
    return [];
  }
}

function extractGilbertMemoryImports(content: string) {
  const imports: string[] = [];
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const importRegex = /(?:^|\s)@([^\s`]+)/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(line))) {
      const value = match[1].replace(/[),.;:]+$/, "");

      if (value && !value.includes("://")) {
        imports.push(value);
      }
    }
  }

  return imports;
}

function resolveGilbertMemoryImportPath(memoryPath: string, importPath: string) {
  if (isAbsoluteLocalPath(importPath) || isBrowserWorkspacePath(importPath)) {
    return importPath;
  }

  return joinPathParts(directoryName(memoryPath), importPath.split(/[\\/]+/).filter(Boolean));
}

function isAbsoluteLocalPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function directoryName(path: string) {
  const lastBackslash = path.lastIndexOf("\\");
  const lastSlash = path.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index > 0 ? path.slice(0, index) : path;
}

function formatGilbertProjectMemories(memories: GilbertProjectMemory[]) {
  if (memories.length === 0) {
    return "";
  }

  let remaining = MAX_GILBERT_MEMORY_CONTEXT_CHARS;
  const formattedMemories: string[] = [];
  let omitted = 0;

  for (const memory of memories) {
    const header = `--- ${memory.path}`;
    const available = remaining - header.length - 2;

    if (available <= 160) {
      omitted += 1;
      continue;
    }

    const content = limitInlineText(memory.content, available, `[Project memory context truncated. Ask the user for exact omitted text from ${memory.path} if it matters.]`);
    formattedMemories.push(`${header}\n${content}`);
    remaining -= header.length + content.length + 4;
  }

  return [
    "GILBERT PROJECT MEMORY",
    "The following Markdown files are loaded like bounded project instructions. Follow them unless they conflict with explicit user instructions or safety rules. Ask the user for omitted memory text when it matters.",
    ...formattedMemories,
    omitted > 0 ? `[${omitted} project memory file${omitted === 1 ? "" : "s"} omitted from automatic context budget.]` : "",
  ].filter(Boolean).join("\n\n");
}

function formatRootListings(listings: ComputerDirectoryListing[]) {
  if (listings.length === 0) {
    return "";
  }

  return [
    "ROOT DIRECTORY SNAPSHOT",
    ...listings.map((listing) => {
      const rows = listing.entries.map((entry) => {
        const marker = entry.kind === "directory" ? "[dir]" : "[file]";
        return `${marker} ${entry.path}`;
      });
      return [
        `${listing.path}${listing.limited ? " (limited)" : ""}`,
        ...rows,
        listing.limited ? "Directory listing was limited; ask for the specific missing path if more entries matter." : "",
      ].filter(Boolean).join("\n");
    }),
  ].join("\n\n");
}

async function resolvePromptFolders(prompt: string, roots: string[]) {
  const normalizedPrompt = prompt.toLowerCase();
  const folders: string[] = [];

  if (!isTauriDesktopRuntime()) {
    const matchingRoots = roots.filter((root) => {
      const key = decodeURIComponent(root).toLowerCase();
      return (
        (normalizedPrompt.includes("document") && key.includes("document")) ||
        (normalizedPrompt.includes("desktop") && key.includes("desktop")) ||
        (normalizedPrompt.includes("download") && key.includes("download"))
      );
    });
    folders.push(...(matchingRoots.length > 0 ? matchingRoots : roots));
  }

  const defaultWorkspace = await getDefaultComputerWorkspace().catch(() => "");
  const documentsFolder = defaultWorkspace ? inferKnownFolder(defaultWorkspace, "Documents") : "";
  const userFolder = documentsFolder ? parentPath(documentsFolder) : defaultWorkspace ? parentPath(parentPath(defaultWorkspace)) : "";
  const cDrive = roots.find((root) => normalizePathKey(root) === "c:") || roots.find((root) => normalizePathKey(root).startsWith("c:"));

  if (normalizedPrompt.includes("document")) {
    pushIfPresent(folders, documentsFolder);
  }

  if (normalizedPrompt.includes("desktop")) {
    pushIfPresent(folders, joinPath(userFolder, "Desktop"));
  }

  if (normalizedPrompt.includes("download")) {
    pushIfPresent(folders, joinPath(userFolder, "Downloads"));
  }

  if (normalizedPrompt.includes("drive") || normalizedPrompt.includes("c drive") || normalizedPrompt.includes("c:")) {
    pushIfPresent(folders, cDrive);
  }

  const readable = await Promise.all(
    folders.map(async (folder) => {
      try {
        await listComputerDirectory(folder, 1);
        return folder;
      } catch {
        return "";
      }
    }),
  );

  return uniquePaths(readable.filter(Boolean));
}

function inferKnownFolder(defaultWorkspace: string, folderName: string) {
  const parts = splitPath(defaultWorkspace);
  const index = parts.findIndex((part) => part.toLowerCase() === folderName.toLowerCase());

  if (index < 0) {
    return "";
  }

  return pathFromParts(parts.slice(0, index + 1), defaultWorkspace);
}

function parentPath(path: string) {
  const parts = splitPath(path);

  if (parts.length <= 1) {
    return path;
  }

  return pathFromParts(parts.slice(0, -1), path);
}

function joinPath(root: string, child: string) {
  if (!root) {
    return "";
  }

  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function joinPathParts(root: string, parts: string[]) {
  return parts.reduce((path, part) => joinPath(path, part), root);
}

function splitPath(path: string) {
  return path.split(/[\\/]+/).filter(Boolean);
}

function pathFromParts(parts: string[], originalPath: string) {
  if (originalPath.includes("\\")) {
    const first = parts[0]?.endsWith(":") ? parts[0] : "";
    const rest = first ? parts.slice(1) : parts;
    return first ? `${first}\\${rest.join("\\")}` : rest.join("\\");
  }

  return originalPath.startsWith("/") ? `/${parts.join("/")}` : parts.join("/");
}

function pushIfPresent(values: string[], value?: string) {
  if (value) {
    values.push(value);
  }
}

function formatSearchResults(results: ComputerSearchResult[], indexReady: boolean) {
  if (!indexReady) {
    return [
      "HYBRID FILE SEARCH RESULTS",
      "The file index was not preloaded for this request, so Gilbert did not search or read the folder automatically.",
      "Use app-exposed bridge tools when exact project context is needed and available; otherwise ask the user for the missing context.",
    ].join("\n");
  }

  if (results.length === 0) {
    return "HYBRID FILE SEARCH RESULTS\nNo local file matches were found for this request yet.";
  }

  return [
    "HYBRID FILE SEARCH RESULTS",
    ...results.map((result, index) => {
      const matchKind = result.matchKind ? `, ${result.matchKind}` : "";
      const line = result.line ? `, line ${result.line}` : "";
      const matches = result.matches?.length ? `, matches: ${result.matches.join(", ")}` : "";
      const preview = result.preview ? `\n  preview: ${limitInlineText(result.preview.replace(/\s+/g, " "), SEARCH_PREVIEW_MAX_CHARS)}` : "";
      return `${index + 1}. ${result.path} (${result.kind}${matchKind}${line}, score ${result.score.toFixed(3)}${matches})${preview}`;
    }),
  ].join("\n");
}

function createBrowserWorkspacePath(name: string) {
  const safeName = encodeURIComponent(name || "Folder");
  let path = `${BROWSER_WORKSPACE_PREFIX}${safeName}`;
  let suffix = 2;

  while (browserWorkspaceRoots.has(path)) {
    path = `${BROWSER_WORKSPACE_PREFIX}${safeName}-${suffix}`;
    suffix += 1;
  }

  return path;
}

function isBrowserWorkspacePath(path: string) {
  return path.startsWith(BROWSER_WORKSPACE_PREFIX);
}

async function resolveBrowserDirectory(path: string): Promise<{ handle: BrowserDirectoryHandle; path: string; root: BrowserWorkspaceRoot }> {
  const { parts, root } = resolveBrowserRoot(path);
  let handle = root.handle;
  let resolvedPath = root.path;

  for (const part of parts) {
    if (!handle.getDirectoryHandle) {
      throw new Error("This browser cannot open that folder.");
    }

    handle = await handle.getDirectoryHandle(part);
    resolvedPath = joinBrowserPath(resolvedPath, part);
  }

  return { handle, path: resolvedPath, root };
}

async function resolveBrowserFile(path: string): Promise<{ file: File; handle: BrowserFileHandle; root: BrowserWorkspaceRoot }> {
  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    throw new Error("Choose a file, not the folder root.");
  }

  const fileName = parts[parts.length - 1];
  let directoryHandle = root.handle;

  for (const part of parts.slice(0, -1)) {
    if (!directoryHandle.getDirectoryHandle) {
      throw new Error("This browser cannot open that folder.");
    }

    directoryHandle = await directoryHandle.getDirectoryHandle(part);
  }

  if (!directoryHandle.getFileHandle) {
    throw new Error("This browser cannot read that file.");
  }

  const handle = await directoryHandle.getFileHandle(fileName);
  return { file: await handle.getFile(), handle, root };
}

function resolveBrowserRoot(path: string) {
  const normalizedPath = path.replace(/[\\/]+/g, "/");
  const root = Array.from(browserWorkspaceRoots.values())
    .sort((left, right) => right.path.length - left.path.length)
    .find((candidate) => normalizedPath === candidate.path || normalizedPath.startsWith(`${candidate.path}/`));

  if (!root) {
    throw new Error("Open or drop that folder again so Gilbert can access it.");
  }

  const relativePath = normalizedPath.slice(root.path.length).replace(/^\/+/, "");
  const parts = relativePath ? relativePath.split("/").map(decodeURIComponent) : [];
  return { parts, root };
}

async function* iterateDirectoryHandles(handle: BrowserDirectoryHandle): AsyncIterable<BrowserFileSystemHandle> {
  if (handle.values) {
    for await (const child of handle.values()) {
      yield child;
    }
    return;
  }

  if (handle.entries) {
    for await (const [, child] of handle.entries()) {
      yield child;
    }
  }
}

function joinBrowserPath(root: string, child: string) {
  return `${root.replace(/\/+$/, "")}/${encodeURIComponent(child)}`;
}

function browserParentPath(path: string) {
  const normalizedPath = path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const root = Array.from(browserWorkspaceRoots.values()).find((candidate) => normalizedPath === candidate.path || normalizedPath.startsWith(`${candidate.path}/`));

  if (!root || normalizedPath === root.path) {
    return undefined;
  }

  return normalizedPath.slice(0, normalizedPath.lastIndexOf("/"));
}

function fileExtensionFromName(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : undefined;
}

function shouldReadBrowserFile(file: File) {
  return isProbablyTextExtension(fileExtensionFromName(file.name));
}

async function readFilePreview(file: File, maxBytes?: number, offset = 0) {
  if (offset > file.size) {
    throw new Error(`Requested offset ${offset} is beyond the end of ${file.name} (${file.size} bytes).`);
  }

  const end = maxBytes === undefined ? undefined : offset + maxBytes;
  const text = offset === 0 && maxBytes === undefined ? await file.text() : await file.slice(offset, end).text();

  if (text.includes("\u0000")) {
    throw new Error("This file looks binary, so Gilbert did not load it as text.");
  }

  return text;
}

function normalizeReadOffset(offset?: number) {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(0, Math.floor(offset));
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_:-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreBrowserEntry(entry: BrowserIndexedEntry, query: string, tokens: string[]) {
  let contentScore = 0;
  let nameScore = 0;
  let pathScore = 0;
  const matches = new Set<string>();
  const nameLower = entry.name.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const haystackLower = entry.haystack.toLowerCase();
  const queryLower = query.trim().toLowerCase();

  if (queryLower && nameLower === queryLower) {
    nameScore += 8;
    matches.add(queryLower);
  } else if (queryLower && nameLower.includes(queryLower)) {
    nameScore += 5;
    matches.add(queryLower);
  }

  if (queryLower && pathLower.includes(queryLower)) {
    pathScore += 2.5;
    matches.add(queryLower);
  }

  if (queryLower && entry.content?.toLowerCase().includes(queryLower)) {
    contentScore += 1.4;
    matches.add(queryLower);
  }

  for (const token of tokens) {
    if (nameLower.includes(token)) {
      nameScore += 1.6;
      matches.add(token);
    }

    if (pathLower.includes(token)) {
      pathScore += 0.85;
      matches.add(token);
    }

    if (haystackLower.includes(token)) {
      contentScore += 0.35;
    }
  }

  const snippet = findBrowserContentSnippet(entry.preview ?? entry.content ?? "", queryLower, tokens);
  if (snippet) {
    contentScore += 0.8;
    snippet.matches.forEach((match) => matches.add(match));
  }

  const score = nameScore + pathScore + contentScore / Math.max(tokens.length, 1);
  const matchKind =
    nameScore > 0 && nameScore >= pathScore && nameScore >= contentScore
      ? "name"
      : pathScore > 0 && pathScore >= contentScore
        ? "path"
        : contentScore > 0
          ? "content"
          : "semantic";

  return {
    line: snippet?.line,
    matchKind,
    matches: Array.from(matches),
    preview: snippet?.preview ?? entry.preview,
    score,
  } satisfies Pick<ComputerSearchResult, "line" | "matchKind" | "matches" | "preview" | "score">;
}

function findBrowserContentSnippet(content: string, queryLower: string, tokens: string[]) {
  if (!content) {
    return undefined;
  }

  const usefulTokens = tokens.filter((token) => token.length > 1);
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const lineLower = line.toLowerCase();
    const matches = new Set<string>();

    if (queryLower && lineLower.includes(queryLower)) {
      matches.add(queryLower);
    }

    for (const token of usefulTokens) {
      if (lineLower.includes(token)) {
        matches.add(token);
      }
    }

    if (matches.size > 0) {
      return {
        line: index + 1,
        matches: Array.from(matches),
        preview: line.trim(),
      };
    }
  }

  return undefined;
}

function sameRootSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = left.map(normalizePathKey).sort();
  const normalizedRight = right.map(normalizePathKey).sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function uniquePaths(paths: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const key = normalizePathKey(path);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(path);
  }

  return result;
}

function normalizePathKey(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function isPathInsideRoot(path: string, root: string) {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedRoot = normalizeComparablePath(root);

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizeComparablePath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isProbablyTextExtension(extension?: string) {
  if (!extension) {
    return false;
  }

  return new Set([
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
    "log",
    "lua",
    "md",
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
    "xml",
    "yaml",
    "yml",
  ]).has(extension.toLowerCase());
}

function limitContext(content: string, maxChars = LOCAL_WORKSPACE_CONTEXT_MAX_CHARS) {
  return limitInlineText(
    content,
    maxChars,
    "[Automatic workspace context truncated before sending to the model. Ask the user for exact omitted context if it matters.]",
  );
}

function limitInlineText(content: string, maxChars: number, marker = "[Context truncated.]") {
  const trimmed = content.trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  const budget = Math.max(maxChars - marker.length - 2, 0);
  const clipped = trimmed.slice(0, budget).replace(/\s+\S*$/, "").trim();

  return clipped ? `${clipped}\n${marker}` : marker;
}
