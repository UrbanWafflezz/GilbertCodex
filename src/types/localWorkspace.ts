export type LocalPermissionMode = "default" | "auto-review" | "full-access";

export type LocalWorkspaceScope = "current-folder" | "selected-folder" | "full-computer";
export type LocalWorkspaceIndexStatus = "idle" | "indexing" | "error";

export interface LocalWorkspaceSettings {
  enabled: boolean;
  indexReason?: string;
  indexSummary?: ComputerFileIndexSummary;
  indexStatus?: LocalWorkspaceIndexStatus;
  indexUpdatedAt?: string;
  lastError?: string;
  permissionMode: LocalPermissionMode;
  roots: string[];
  scope: LocalWorkspaceScope;
}

export interface ComputerDrive {
  available: boolean;
  kind: string;
  label: string;
  name: string;
  path: string;
}

export type ComputerFileKind = "directory" | "file" | "symlink" | "other";

export interface ComputerDirectoryEntry {
  extension?: string;
  kind: ComputerFileKind;
  modifiedAt?: number;
  name: string;
  path: string;
  size?: number;
}

export interface ComputerDirectoryListing {
  entries: ComputerDirectoryEntry[];
  inaccessibleEntries: number;
  limited: boolean;
  parentPath?: string;
  path: string;
}

export interface ComputerFileIndexSummary {
  builtAt?: number;
  entryCount: number;
  ignoredEntries: number;
  roots: string[];
  scannedDirectories: number;
  skippedEntries: number;
  truncated: boolean;
}

export interface ComputerFileIndexProgress {
  currentPath?: string;
  done: boolean;
  entryCount: number;
  ignoredEntries: number;
  requestId: number;
  roots: string[];
  scannedDirectories: number;
  skippedEntries: number;
  truncated: boolean;
}

export interface ComputerGitStatus {
  additions: number;
  ahead: number;
  available: boolean;
  behind: number;
  branch?: string;
  changedFiles: number;
  clean: boolean;
  deletions: number;
  error?: string;
  files?: ComputerGitChangedFile[];
  githubOwner?: string;
  githubRepo?: string;
  headSha?: string;
  remoteUrl?: string;
  repositoryRoot?: string;
  stagedFiles?: number;
  upstream?: string;
  unstagedFiles?: number;
  untrackedFiles?: number;
}

export interface ComputerGitActionResult {
  message: string;
  output?: string;
  status: ComputerGitStatus;
}

export interface ComputerGitDiffResult {
  diff: string;
  path: string;
  repositoryRoot: string;
  status: ComputerGitStatus;
  truncated: boolean;
}

export interface ComputerGitWorktreeResult {
  branchName: string;
  message: string;
  output?: string;
  path: string;
  status: ComputerGitStatus;
}

export interface ComputerGitChangedFile {
  additions: number;
  deletions: number;
  diffPreview?: ComputerGitDiffLine[];
  diffTruncated?: boolean;
  oldPath?: string;
  path: string;
  staged?: boolean;
  status: string;
  unstaged?: boolean;
  untracked?: boolean;
}

export interface ComputerGitDiffLine {
  content: string;
  kind: "add" | "context" | "hunk" | "meta" | "remove";
  newLine?: number;
  oldLine?: number;
}

export interface ComputerSearchResult {
  extension?: string;
  kind: ComputerFileKind;
  line?: number;
  matchKind?: "content" | "memory" | "name" | "path" | "semantic";
  matches?: string[];
  modifiedAt?: number;
  name: string;
  path: string;
  preview?: string;
  score: number;
  size?: number;
}

export interface ComputerReadFileResult {
  content: string;
  extension?: string;
  modifiedAt?: number;
  name: string;
  path: string;
  /** Lowercase hex SHA-256 of the fully loaded file bytes. Omitted for truncated reads. */
  sha256?: string;
  size: number;
  truncated: boolean;
}

export interface ComputerReadFileRangeResult {
  content: string;
  endLine: number;
  extension?: string;
  lineCount: number;
  modifiedAt?: number;
  name: string;
  path: string;
  requestedEndLine: number;
  requestedStartLine: number;
  size: number;
  startLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface ComputerTextSearchLineContext {
  line: number;
  preview: string;
}

export interface ComputerTextSearchMatch {
  after?: ComputerTextSearchLineContext[];
  before?: ComputerTextSearchLineContext[];
  line: number;
  preview: string;
}

export interface ComputerTextSearchFileResult {
  contentMatches: ComputerTextSearchMatch[];
  extension: string | null;
  name: string;
  path: string;
  pathMatched: boolean;
  size?: number | null;
}

export interface ComputerTextSearchRequest {
  caseSensitive?: boolean;
  contextLines?: number;
  excludeDirectories?: string[];
  extensions?: string[];
  globs?: string[];
  includeContent?: boolean;
  includeGenerated?: boolean;
  includePath?: boolean;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  path: string;
  query: string;
  regex?: boolean;
}

export interface ComputerTextSearchResponse {
  filesRead: number;
  filesScanned: number;
  filteredByGlob: number;
  inaccessibleEntries: number;
  limited: boolean;
  matches: ComputerTextSearchFileResult[];
  scannedDirectories: number;
  skippedLargeFiles?: number;
  skippedDirectories: number;
  skippedFiles: number;
  totalContentMatches: number;
  unreadableFiles: number;
}

export interface ComputerWriteFileResult {
  bytesWritten: number;
  created: boolean;
  modifiedAt?: number;
  path: string;
  /** Lowercase hex SHA-256 of the bytes actually written. */
  sha256?: string;
  /** Line-ending family applied to the written bytes ("crlf" or "lf"). */
  eol?: "crlf" | "lf";
}

export interface ComputerWriteFilesResult {
  files: Array<{
    error?: string;
    ok: boolean;
    requestedPath: string;
    result?: ComputerWriteFileResult;
  }>;
}

export interface ComputerCreateDirectoryResult {
  created: boolean;
  modifiedAt?: number;
  path: string;
}

export interface ComputerDeleteFileResult {
  bytesDeleted: number;
  deleted: boolean;
  path: string;
}

export interface ComputerMovePathResult {
  fromPath: string;
  kind: ComputerFileKind;
  moved: boolean;
  toPath: string;
}

export interface ComputerCopyPathResult {
  bytesCopied: number;
  copied: boolean;
  fromPath: string;
  kind: ComputerFileKind;
  toPath: string;
}
