//! Local computer filesystem commands for workspace picking, indexing, Git status, and guarded file mutations.

use crate::core::{
    fs_utils::path_to_string,
    native_path::{configure_native_path, resolve_native_executable},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    hash::{Hash, Hasher},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const EMBEDDING_DIMS: usize = 64;
const GIT_DEFAULT_COMMAND_TIMEOUT_MS: u64 = 60_000;
const GIT_STATUS_COMMAND_TIMEOUT_MS: u64 = 3_000;
const MAX_GIT_DIFF_PREVIEW_FILES: usize = 500;
const MAX_GIT_DIFF_PREVIEW_LINES_PER_FILE: usize = 200;
const MAX_GIT_DIFF_PREVIEW_LINE_CHARS: usize = 2_000;
const MAX_GIT_UNTRACKED_DIFF_BYTES: u64 = 524_288;
const INDEX_PROGRESS_EVENT: &str = "computer-file-index-progress";
const INDEX_PROGRESS_INTERVAL_MS: u64 = 150;
const INDEX_PROGRESS_ENTRY_INTERVAL: usize = 250;
const TEXT_SEARCH_TIME_BUDGET_MS: u64 = 15_000;
const DEFAULT_TEXT_SEARCH_MAX_MATCHES: usize = 120;
const MAX_TEXT_SEARCH_MAX_MATCHES: usize = 500;
const DEFAULT_TEXT_SEARCH_MAX_MATCHES_PER_FILE: usize = 20;
const MAX_TEXT_SEARCH_MAX_MATCHES_PER_FILE: usize = 100;
const MAX_TEXT_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_BATCH_WRITE_WORKERS: usize = 8;
const DEFAULT_TEXT_SEARCH_EXTENSIONS: &[&str] = &[
    "astro", "bat", "c", "cmd", "cpp", "cs", "css", "csv", "dart", "go", "graphql", "h", "html",
    "java", "js", "json", "jsx", "kt", "kts", "lua", "md", "mdx", "php", "ps1", "py", "rb", "rs",
    "scss", "sh", "sql", "svelte", "swift", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml",
    "yml",
];
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SKIPPED_INDEX_DIRECTORY_NAMES: &[&str] = &[
    ".cache",
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
const SKIPPED_INDEX_FILE_NAMES: &[&str] = &[
    ".npmrc",
    ".pypirc",
    ".yarnrc",
    ".netrc",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "known_hosts",
    "secrets.json",
    "token.json",
];
const SKIPPED_INDEX_FILE_EXTENSIONS: &[&str] = &[
    "cer",
    "crt",
    "db",
    "der",
    "key",
    "log",
    "p12",
    "pem",
    "pfx",
    "sqlite",
    "sqlite3",
    "sqlite-shm",
    "sqlite-wal",
];

/// Shared in-memory file index state for the active desktop process.
#[derive(Clone)]
pub struct ComputerFileIndexState {
    active_request_id: Arc<AtomicU64>,
    index: Arc<Mutex<ComputerFileIndex>>,
}

impl Default for ComputerFileIndexState {
    fn default() -> Self {
        Self {
            active_request_id: Arc::new(AtomicU64::new(0)),
            index: Arc::new(Mutex::new(ComputerFileIndex::default())),
        }
    }
}

#[derive(Default)]
struct ComputerFileIndex {
    built_at: Option<u64>,
    entries: Vec<IndexedComputerFile>,
    ignored_entries: usize,
    roots: Vec<String>,
    scanned_directories: usize,
    skipped_entries: usize,
    truncated: bool,
}

#[derive(Clone, Debug)]
struct IndexDirectoryScan {
    depth: usize,
    ignore_rules: Vec<IndexIgnoreRule>,
    path: PathBuf,
}

#[derive(Clone, Debug)]
struct IndexIgnoreRule {
    anchored: bool,
    base: PathBuf,
    directory_only: bool,
    has_slash: bool,
    negated: bool,
    pattern: String,
}

#[derive(Clone)]
struct IndexedComputerFile {
    embedding: Vec<f32>,
    extension: Option<String>,
    kind: ComputerFileKind,
    modified_at: Option<u64>,
    name: String,
    path: String,
    preview: Option<String>,
    size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComputerFileKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDrive {
    pub available: bool,
    pub kind: String,
    pub label: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDirectoryEntry {
    pub extension: Option<String>,
    pub kind: ComputerFileKind,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDirectoryListing {
    pub entries: Vec<ComputerDirectoryEntry>,
    pub inaccessible_entries: usize,
    pub limited: bool,
    pub parent_path: Option<String>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDirectoryRequest {
    pub limit: Option<usize>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerIndexRequest {
    pub max_depth: Option<usize>,
    pub max_files: Option<usize>,
    pub request_id: Option<u64>,
    pub roots: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerFileIndexSummary {
    pub built_at: Option<u64>,
    pub entry_count: usize,
    pub ignored_entries: usize,
    pub roots: Vec<String>,
    pub scanned_directories: usize,
    pub skipped_entries: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerFileIndexProgress {
    pub current_path: Option<String>,
    pub done: bool,
    pub entry_count: usize,
    pub ignored_entries: usize,
    pub request_id: u64,
    pub roots: Vec<String>,
    pub scanned_directories: usize,
    pub skipped_entries: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitStatusRequest {
    pub include_diff_preview: Option<bool>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitInitRequest {
    pub initial_branch: Option<String>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitCommitRequest {
    pub message: String,
    pub path: String,
    pub stage_all: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitCreateBranchRequest {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitPushRequest {
    pub path: String,
    pub remote: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitPullRequest {
    pub branch: Option<String>,
    pub path: String,
    pub remote: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitStageRequest {
    pub path: String,
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitDiffRequest {
    pub include_untracked: Option<bool>,
    pub max_bytes: Option<usize>,
    pub path: String,
    pub paths: Option<Vec<String>>,
    pub staged: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitDiffResult {
    pub diff: String,
    pub path: String,
    pub repository_root: String,
    pub status: ComputerGitStatus,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitWorktreeRequest {
    pub branch_name: Option<String>,
    pub directory_name: Option<String>,
    pub path: String,
    pub title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitActionResult {
    pub message: String,
    pub output: Option<String>,
    pub status: ComputerGitStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitWorktreeResult {
    pub branch_name: String,
    pub message: String,
    pub output: Option<String>,
    pub path: String,
    pub status: ComputerGitStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitChangedFile {
    pub additions: usize,
    pub deletions: usize,
    pub diff_preview: Option<Vec<ComputerGitDiffLine>>,
    pub diff_truncated: bool,
    pub old_path: Option<String>,
    pub path: String,
    pub staged: bool,
    pub status: String,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitDiffLine {
    pub content: String,
    pub kind: String,
    pub new_line: Option<usize>,
    pub old_line: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitStatus {
    pub additions: usize,
    pub ahead: usize,
    pub available: bool,
    pub behind: usize,
    pub branch: Option<String>,
    pub changed_files: usize,
    pub clean: bool,
    pub deletions: usize,
    pub error: Option<String>,
    pub files: Vec<ComputerGitChangedFile>,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub head_sha: Option<String>,
    pub remote_url: Option<String>,
    pub repository_root: Option<String>,
    pub staged_files: usize,
    pub upstream: Option<String>,
    pub unstaged_files: usize,
    pub untracked_files: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSearchRequest {
    pub limit: Option<usize>,
    pub query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSearchResult {
    pub extension: Option<String>,
    pub kind: ComputerFileKind,
    pub line: Option<usize>,
    pub match_kind: String,
    pub matches: Vec<String>,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    pub preview: Option<String>,
    pub score: f32,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerReadFileRequest {
    pub max_bytes: Option<usize>,
    pub offset: Option<u64>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerReadFileRangeRequest {
    pub end_line: usize,
    pub path: String,
    pub start_line: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerTextSearchRequest {
    pub case_sensitive: Option<bool>,
    pub context_lines: Option<usize>,
    pub exclude_directories: Option<Vec<String>>,
    pub extensions: Option<Vec<String>>,
    pub globs: Option<Vec<String>>,
    pub include_content: Option<bool>,
    pub include_generated: Option<bool>,
    pub include_path: Option<bool>,
    pub max_matches: Option<usize>,
    pub max_matches_per_file: Option<usize>,
    pub path: String,
    pub query: String,
    pub regex: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFileRequest {
    pub content: String,
    pub create_parent_dirs: Option<bool>,
    pub overwrite: Option<bool>,
    pub path: String,
    pub roots: Vec<String>,
    /// Lowercase hex SHA-256 of the last observed file; mismatches reject writes to protect user edits.
    pub expected_sha256: Option<String>,
    /// Optional line-ending family; otherwise the writer preserves detected EOL or uses the platform default.
    pub force_eol: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFilesRequest {
    pub files: Vec<ComputerWriteFilesItemRequest>,
    pub roots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFilesItemRequest {
    pub content: String,
    pub create_parent_dirs: Option<bool>,
    pub overwrite: Option<bool>,
    pub path: String,
    /// Lowercase hex SHA-256 of the last observed file; mismatches reject writes to protect user edits.
    pub expected_sha256: Option<String>,
    /// Optional line-ending family; otherwise the writer preserves detected EOL or uses the platform default.
    pub force_eol: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerCreateDirectoryRequest {
    pub path: String,
    pub recursive: Option<bool>,
    pub roots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDeleteFileRequest {
    pub path: String,
    pub roots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerMovePathRequest {
    pub create_parent_dirs: Option<bool>,
    pub from_path: String,
    pub roots: Vec<String>,
    pub to_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerCopyPathRequest {
    pub create_parent_dirs: Option<bool>,
    pub from_path: String,
    pub overwrite: Option<bool>,
    pub roots: Vec<String>,
    pub to_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerReadFileResult {
    pub content: String,
    pub extension: Option<String>,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    /// Lowercase hex SHA-256 of fully loaded bytes; omitted for truncated reads.
    pub sha256: Option<String>,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerReadFileRangeResult {
    pub content: String,
    pub end_line: usize,
    pub extension: Option<String>,
    pub line_count: usize,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    pub requested_end_line: usize,
    pub requested_start_line: usize,
    pub size: u64,
    pub start_line: usize,
    pub total_lines: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerTextSearchLineContext {
    pub line: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerTextSearchMatch {
    pub after: Option<Vec<ComputerTextSearchLineContext>>,
    pub before: Option<Vec<ComputerTextSearchLineContext>>,
    pub line: usize,
    pub preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerTextSearchFileResult {
    pub content_matches: Vec<ComputerTextSearchMatch>,
    pub extension: Option<String>,
    pub name: String,
    pub path: String,
    pub path_matched: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerTextSearchResponse {
    pub files_read: usize,
    pub files_scanned: usize,
    pub filtered_by_glob: usize,
    pub inaccessible_entries: usize,
    pub limited: bool,
    pub matches: Vec<ComputerTextSearchFileResult>,
    pub scanned_directories: usize,
    pub skipped_large_files: usize,
    pub skipped_directories: usize,
    pub skipped_files: usize,
    pub total_content_matches: usize,
    pub unreadable_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFileResult {
    pub bytes_written: usize,
    pub created: bool,
    pub modified_at: Option<u64>,
    pub path: String,
    /// Lowercase hex SHA-256 of bytes actually written for later `expected_sha256` guards.
    pub sha256: Option<String>,
    /// Line-ending family applied to the written bytes ("crlf" or "lf").
    pub eol: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFilesResult {
    pub files: Vec<ComputerWriteFilesItemResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFilesItemResult {
    pub error: Option<String>,
    pub ok: bool,
    pub requested_path: String,
    pub result: Option<ComputerWriteFileResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerCreateDirectoryResult {
    pub created: bool,
    pub modified_at: Option<u64>,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDeleteFileResult {
    pub bytes_deleted: u64,
    pub deleted: bool,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerMovePathResult {
    pub from_path: String,
    pub kind: ComputerFileKind,
    pub moved: bool,
    pub to_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerCopyPathResult {
    pub bytes_copied: u64,
    pub copied: bool,
    pub from_path: String,
    pub kind: ComputerFileKind,
    pub to_path: String,
}

/// Returns the user's default workspace path when the host can determine one.
#[tauri::command]
pub fn computer_get_default_workspace() -> Option<String> {
    default_user_workspace_directory().map(path_to_string)
}

/// Lists host drives or root folders for workspace selection.
#[tauri::command]
pub fn computer_list_drives() -> Vec<ComputerDrive> {
    list_system_roots()
}

/// Opens the native folder picker and returns the selected path.
#[tauri::command]
pub async fn computer_pick_folder(start_path: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || pick_folder_blocking(start_path))
        .await
        .map_err(|error| format!("The folder picker stopped unexpectedly: {}", error))?
}

fn pick_folder_blocking(start_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose a folder for Gilbert Codex");

    if let Some(start_path) = start_path {
        let start = normalize_input_path(&start_path);

        if start.is_dir() {
            dialog = dialog.set_directory(start);
        }
    }

    Ok(dialog.pick_folder().map(path_to_string))
}

/// Lists a directory with an explicit limit only when the caller supplies one.
#[tauri::command]
pub async fn computer_list_directory(
    request: ComputerDirectoryRequest,
) -> Result<ComputerDirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || computer_list_directory_blocking(request))
        .await
        .map_err(|error| {
            format!(
                "The directory listing worker stopped unexpectedly: {}",
                error
            )
        })?
}

fn computer_list_directory_blocking(
    request: ComputerDirectoryRequest,
) -> Result<ComputerDirectoryListing, String> {
    let path = normalize_input_path(&request.path);
    let limit = request.limit.filter(|value| *value > 0);
    let mut entries = Vec::new();
    let mut inaccessible_entries = 0usize;
    let mut limited = false;
    let read_dir = fs::read_dir(&path)
        .map_err(|error| format!("Could not open {}: {}", path_to_string(&path), error))?;

    for entry_result in read_dir {
        if limit.is_some_and(|max_entries| entries.len() >= max_entries) {
            limited = true;
            break;
        }

        match entry_result {
            Ok(entry) => match create_directory_entry(entry.path()) {
                Some(entry) => entries.push(entry),
                None => inaccessible_entries += 1,
            },
            Err(_) => inaccessible_entries += 1,
        }
    }

    entries.sort_by(|left, right| {
        let left_rank = kind_sort_rank(&left.kind);
        let right_rank = kind_sort_rank(&right.kind);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(ComputerDirectoryListing {
        entries,
        inaccessible_entries,
        limited,
        parent_path: path.parent().map(path_to_string),
        path: path_to_string(&path),
    })
}

/// Builds a searchable file index with caller limits, ignore rules, and secret-file safeguards.
#[tauri::command]
pub async fn computer_build_file_index(
    app: tauri::AppHandle,
    state: tauri::State<'_, ComputerFileIndexState>,
    request: ComputerIndexRequest,
) -> Result<ComputerFileIndexSummary, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || build_file_index_blocking(app, state, request))
        .await
        .map_err(|error| format!("The file index worker stopped unexpectedly: {}", error))?
}

fn build_file_index_blocking(
    app: tauri::AppHandle,
    state: ComputerFileIndexState,
    request: ComputerIndexRequest,
) -> Result<ComputerFileIndexSummary, String> {
    let max_files = request.max_files.filter(|value| *value > 0);
    let max_depth = request.max_depth.filter(|value| *value > 0);
    let request_id = request.request_id.unwrap_or_else(now_millis);
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose at least one folder or drive before indexing.".to_string());
    }

    state.active_request_id.store(request_id, Ordering::SeqCst);

    let mut next_index = ComputerFileIndex {
        roots: roots.iter().map(path_to_string).collect(),
        ..ComputerFileIndex::default()
    };
    let mut queue: VecDeque<IndexDirectoryScan> = roots
        .into_iter()
        .map(|root| IndexDirectoryScan {
            depth: 0,
            ignore_rules: Vec::new(),
            path: root,
        })
        .collect();
    let mut last_progress_emit = Instant::now();

    emit_file_index_progress(&app, request_id, &next_index, None, false);

    'scan: while let Some(scan) = queue.pop_front() {
        if state.active_request_id.load(Ordering::SeqCst) != request_id {
            return Err("Indexing was replaced by a newer request.".to_string());
        }

        let directory = scan.path;
        let depth = scan.depth;
        let mut ignore_rules = scan.ignore_rules;
        ignore_rules.extend(read_gitignore_rules(&directory));

        next_index.scanned_directories += 1;

        let read_dir = match fs::read_dir(&directory) {
            Ok(read_dir) => read_dir,
            Err(_) => {
                next_index.skipped_entries += 1;
                continue;
            }
        };

        for entry_result in read_dir {
            if max_files.is_some_and(|max_entries| next_index.entries.len() >= max_entries) {
                next_index.truncated = true;
                break 'scan;
            }

            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    next_index.skipped_entries += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    next_index.skipped_entries += 1;
                    continue;
                }
            };
            let kind = file_kind_from_metadata(&metadata);
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path_to_string(&path));
            let extension = file_extension(&path);
            if should_skip_index_entry(&path, &name, &kind, &ignore_rules) {
                next_index.skipped_entries += 1;
                next_index.ignored_entries += 1;
                continue;
            }

            let preview = if matches!(kind, ComputerFileKind::File)
                && should_index_text_preview(&path, metadata.len())
            {
                read_text_preview(&path)
            } else {
                None
            };
            let embedding_text = format!(
                "{}\n{}\n{}\n{}",
                name,
                path_to_string(&path),
                extension.clone().unwrap_or_default(),
                preview.clone().unwrap_or_default()
            );

            if matches!(kind, ComputerFileKind::Directory)
                && max_depth.map(|limit| depth < limit).unwrap_or(true)
            {
                queue.push_back(IndexDirectoryScan {
                    depth: depth + 1,
                    ignore_rules: ignore_rules.clone(),
                    path: path.clone(),
                });
            }

            next_index.entries.push(IndexedComputerFile {
                embedding: create_embedding(&embedding_text),
                extension,
                kind,
                modified_at: modified_millis(&metadata),
                name,
                path: path_to_string(&path),
                preview,
                size: if metadata.is_file() {
                    Some(metadata.len())
                } else {
                    None
                },
            });

            if should_emit_file_index_progress(&last_progress_emit, next_index.entries.len()) {
                emit_file_index_progress(
                    &app,
                    request_id,
                    &next_index,
                    Some(path_to_string(&path)),
                    false,
                );
                last_progress_emit = Instant::now();
            }
        }
    }

    next_index.built_at = Some(now_millis());
    let summary = next_index.summary();

    if state.active_request_id.load(Ordering::SeqCst) != request_id {
        return Err("Indexing was replaced by a newer request.".to_string());
    }

    let mut index = state
        .index
        .lock()
        .map_err(|_| "The file index is busy. Try again in a moment.".to_string())?;
    *index = next_index;
    emit_file_index_progress_from_summary(&app, request_id, &summary, None, true);

    Ok(summary)
}

/// Returns the last completed file-index summary.
#[tauri::command]
pub fn computer_get_file_index_summary(
    state: tauri::State<'_, ComputerFileIndexState>,
) -> Result<ComputerFileIndexSummary, String> {
    let index = state
        .index
        .lock()
        .map_err(|_| "The file index is busy. Try again in a moment.".to_string())?;
    Ok(index.summary())
}

/// Reads Git status signals for a workspace root.
#[tauri::command]
pub async fn computer_get_git_status(
    request: ComputerGitStatusRequest,
) -> Result<ComputerGitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || get_git_status_blocking(request))
        .await
        .map_err(|error| format!("The Git status worker stopped unexpectedly: {}", error))?
}

/// Initializes a local Git repository in a workspace folder.
#[tauri::command]
pub async fn computer_git_init(
    request: ComputerGitInitRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_init_blocking(request))
        .await
        .map_err(|error| format!("The Git init worker stopped unexpectedly: {}", error))?
}

/// Stages and commits local Git changes for a workspace root.
#[tauri::command]
pub async fn computer_git_commit(
    request: ComputerGitCommitRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_blocking(request))
        .await
        .map_err(|error| format!("The Git commit worker stopped unexpectedly: {}", error))?
}

/// Creates and switches to a new local Git branch for a workspace root.
#[tauri::command]
pub async fn computer_git_create_branch(
    request: ComputerGitCreateBranchRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_create_branch_blocking(request))
        .await
        .map_err(|error| format!("The Git branch worker stopped unexpectedly: {}", error))?
}

/// Pushes the current local Git branch, setting upstream when needed.
#[tauri::command]
pub async fn computer_git_push(
    request: ComputerGitPushRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_push_blocking(request))
        .await
        .map_err(|error| format!("The Git push worker stopped unexpectedly: {}", error))?
}

/// Pulls the current local Git branch with fast-forward only semantics.
#[tauri::command]
pub async fn computer_git_pull(
    request: ComputerGitPullRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_pull_blocking(request))
        .await
        .map_err(|error| format!("The Git pull worker stopped unexpectedly: {}", error))?
}

/// Stages local Git changes for a workspace root.
#[tauri::command]
pub async fn computer_git_stage(
    request: ComputerGitStageRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_stage_blocking(request))
        .await
        .map_err(|error| format!("The Git stage worker stopped unexpectedly: {}", error))?
}

/// Returns a full local Git diff for a workspace root.
#[tauri::command]
pub async fn computer_git_diff(
    request: ComputerGitDiffRequest,
) -> Result<ComputerGitDiffResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_blocking(request))
        .await
        .map_err(|error| format!("The Git diff worker stopped unexpectedly: {}", error))?
}

/// Creates a sibling Git worktree on a fresh branch for a forked conversation.
#[tauri::command]
pub async fn computer_git_create_worktree(
    request: ComputerGitWorktreeRequest,
) -> Result<ComputerGitWorktreeResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_create_worktree_blocking(request))
        .await
        .map_err(|error| format!("The Git worktree worker stopped unexpectedly: {}", error))?
}

fn get_git_status_blocking(request: ComputerGitStatusRequest) -> Result<ComputerGitStatus, String> {
    let path = normalize_input_path(&request.path);
    let include_diff_preview = request.include_diff_preview.unwrap_or(false);

    if !path.exists() {
        return Ok(create_unavailable_git_status(Some(format!(
            "{} does not exist.",
            path_to_string(&path)
        ))));
    }

    let repository_path = match find_git_repository_root(&path) {
        Some(root) => root,
        None => return Ok(create_unavailable_git_status(None)),
    };
    let head_sha = run_git_quick(&repository_path, &["rev-parse", "--short", "HEAD"])
        .ok()
        .filter(|value| !value.is_empty());
    let branch = run_git_quick(&repository_path, &["branch", "--show-current"])
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| head_sha.as_ref().map(|sha| format!("detached {}", sha)));
    let upstream = run_git_quick(
        &repository_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .filter(|value| !value.is_empty());
    let (behind, ahead) = if upstream.is_some() {
        get_git_ahead_behind(&repository_path).unwrap_or((0, 0))
    } else {
        (0, 0)
    };
    let remote_url = run_git_quick(&repository_path, &["remote", "get-url", "origin"])
        .ok()
        .filter(|value| !value.is_empty());
    let (github_owner, github_repo) = remote_url
        .as_deref()
        .and_then(parse_github_remote_url)
        .unwrap_or((None, None));
    let status_output = match run_git_quick(
        &repository_path,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    ) {
        Ok(output) => output,
        Err(error) => return Ok(create_unavailable_git_status(Some(error))),
    };
    let status_summary = summarize_git_status_entries(&status_output);
    let tracked_stats = parse_git_numstat_entries(
        &run_git_quick(&repository_path, &["diff", "--numstat", "HEAD"]).unwrap_or_default(),
    );
    let tracked_additions = tracked_stats
        .iter()
        .map(|(_path, additions, _deletions)| *additions)
        .sum::<usize>();
    let deletions = tracked_stats
        .iter()
        .map(|(_path, _additions, deletions)| *deletions)
        .sum::<usize>();
    let untracked_output = run_git_quick(
        &repository_path,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )
    .unwrap_or_default();
    let untracked_additions_by_path =
        count_untracked_git_additions_by_path(&repository_path, &untracked_output);
    let untracked_additions = untracked_additions_by_path.values().sum::<usize>();
    let additions = tracked_additions + untracked_additions;
    let diff_previews = if include_diff_preview {
        build_git_diff_previews(&repository_path, &status_output)
    } else {
        HashMap::new()
    };
    let files = parse_git_changed_files(
        &status_output,
        &tracked_stats,
        &untracked_additions_by_path,
        &diff_previews,
    );
    let repository_root = path_to_string(&repository_path);

    Ok(ComputerGitStatus {
        additions,
        ahead,
        available: true,
        behind,
        branch,
        changed_files: status_summary.changed_files,
        clean: status_summary.changed_files == 0,
        deletions,
        error: None,
        files,
        github_owner,
        github_repo,
        head_sha,
        remote_url,
        repository_root: Some(repository_root),
        staged_files: status_summary.staged_files,
        upstream,
        unstaged_files: status_summary.unstaged_files,
        untracked_files: status_summary.untracked_files,
    })
}

fn git_init_blocking(request: ComputerGitInitRequest) -> Result<ComputerGitActionResult, String> {
    let path = normalize_input_path(&request.path);

    if !path.exists() {
        return Err(format!("{} does not exist.", path_to_string(&path)));
    }

    if !path.is_dir() {
        return Err("Choose a folder before initializing Git.".to_string());
    }

    if let Some(repository_path) = find_git_repository_root(&path) {
        let status = get_git_status_blocking(ComputerGitStatusRequest {
            include_diff_preview: None,
            path: path_to_string(&repository_path),
        })?;

        return Ok(ComputerGitActionResult {
            message: "Git is already initialized for this folder.".to_string(),
            output: None,
            status,
        });
    }

    let initial_branch = request
        .initial_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main")
        .to_string();

    validate_new_git_branch_name(&initial_branch)?;

    let init_output = run_git(&path, &["init"])?;
    let head_ref = format!("refs/heads/{}", initial_branch);
    let head_output = run_git(&path, &["symbolic-ref", "HEAD", &head_ref])?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&path),
    })?;

    Ok(ComputerGitActionResult {
        message: format!("Initialized Git on {}.", initial_branch),
        output: optional_git_output([init_output, head_output].join("\n")),
        status,
    })
}

fn git_commit_blocking(
    request: ComputerGitCommitRequest,
) -> Result<ComputerGitActionResult, String> {
    let message = request.message.trim().to_string();

    if message.is_empty() {
        return Err("Enter a commit message before committing.".to_string());
    }

    let repository_path = resolve_git_repository_path(&request.path)?;

    if request.stage_all.unwrap_or(true) {
        run_git(&repository_path, &["add", "-A"])?;
    }

    let output = run_git(&repository_path, &["commit", "-m", &message])?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;

    Ok(ComputerGitActionResult {
        message: "Committed local changes.".to_string(),
        output: optional_git_output(output),
        status,
    })
}

fn git_create_branch_blocking(
    request: ComputerGitCreateBranchRequest,
) -> Result<ComputerGitActionResult, String> {
    let branch_name = request.name.trim().to_string();
    let repository_path = resolve_git_repository_path(&request.path)?;

    validate_git_branch_name(&repository_path, &branch_name)?;

    let output = run_git(&repository_path, &["switch", "-c", &branch_name])?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;

    Ok(ComputerGitActionResult {
        message: format!("Created and switched to {}.", branch_name),
        output: optional_git_output(output),
        status,
    })
}

fn git_push_blocking(request: ComputerGitPushRequest) -> Result<ComputerGitActionResult, String> {
    let repository_path = resolve_git_repository_path(&request.path)?;
    let branch = run_git(&repository_path, &["branch", "--show-current"])?
        .trim()
        .to_string();

    if branch.is_empty() {
        return Err(
            "Cannot push while HEAD is detached. Create or switch to a branch first.".to_string(),
        );
    }

    let remote = request
        .remote
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("origin")
        .to_string();

    validate_git_remote_name(&remote)?;

    let before_status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;
    let upstream = run_git(
        &repository_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .filter(|value| !value.trim().is_empty());
    let upstream_target = upstream.as_deref().and_then(split_git_upstream);
    let pushes_upstream = upstream_target
        .as_ref()
        .map(|(upstream_remote, _branch)| upstream_remote == &remote)
        .unwrap_or(false);
    let target_branch = if pushes_upstream {
        upstream_target
            .as_ref()
            .map(|(_remote, upstream_branch)| upstream_branch.clone())
            .unwrap_or_else(|| branch.clone())
    } else {
        branch.clone()
    };

    if pushes_upstream && before_status.ahead == 0 && before_status.changed_files > 0 {
        return Err(
            "No commits to push. Stage and commit local changes before pushing this branch."
                .to_string(),
        );
    }

    let output = if upstream.is_none() {
        run_git(
            &repository_path,
            &["push", "--set-upstream", &remote, &branch],
        )?
    } else {
        let refspec = format!("HEAD:refs/heads/{}", target_branch);
        run_git_owned(
            &repository_path,
            &["push".to_string(), remote.clone(), refspec],
        )?
    };
    let local_head = git_head_sha(&repository_path)?;
    let remote_head = git_remote_head_sha(&repository_path, &remote, &target_branch)?;

    if remote_head.as_deref() != Some(local_head.as_str()) {
        return Err(match remote_head {
            Some(remote_sha) => format!(
                "Git push finished, but {}/{} is at {} instead of local HEAD {}.",
                remote, target_branch, remote_sha, local_head
            ),
            None => format!(
                "Git push finished, but {}/{} was not found on the remote.",
                remote, target_branch
            ),
        });
    }

    let mut status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;
    if status
        .upstream
        .as_deref()
        .and_then(split_git_upstream)
        .map(|(upstream_remote, upstream_branch)| {
            upstream_remote == remote && upstream_branch == target_branch
        })
        .unwrap_or(false)
    {
        status.ahead = 0;
        status.behind = 0;
    }
    let message = if pushes_upstream && before_status.ahead == 0 {
        format!("{}/{} already matches {}.", remote, target_branch, branch)
    } else {
        format!("Pushed {} to {}/{}.", branch, remote, target_branch)
    };

    Ok(ComputerGitActionResult {
        message,
        output: optional_git_output(output),
        status,
    })
}

fn git_pull_blocking(request: ComputerGitPullRequest) -> Result<ComputerGitActionResult, String> {
    let repository_path = resolve_git_repository_path(&request.path)?;
    let before_head = git_head_sha(&repository_path)?;
    let remote = request
        .remote
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("origin")
        .to_string();
    validate_git_remote_name(&remote)?;

    let branch = request
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if let Some(branch_name) = branch.as_deref() {
        validate_git_branch_name(&repository_path, branch_name)?;
    }

    let output = if let Some(branch_name) = branch.as_deref() {
        run_git(
            &repository_path,
            &["pull", "--ff-only", &remote, branch_name],
        )?
    } else {
        run_git(&repository_path, &["pull", "--ff-only"])?
    };
    let after_head = git_head_sha(&repository_path)?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;
    let pulled_changes = before_head != after_head;

    Ok(ComputerGitActionResult {
        message: if pulled_changes {
            branch
                .map(|branch_name| format!("Pulled {} from {}.", branch_name, remote))
                .unwrap_or_else(|| "Pulled current branch.".to_string())
        } else {
            branch
                .map(|branch_name| format!("Already up to date with {}/{}.", remote, branch_name))
                .unwrap_or_else(|| "Already up to date.".to_string())
        },
        output: optional_git_output(output),
        status,
    })
}

fn git_stage_blocking(request: ComputerGitStageRequest) -> Result<ComputerGitActionResult, String> {
    let repository_path = resolve_git_repository_path(&request.path)?;
    let pathspecs = normalize_git_pathspecs(&repository_path, request.paths.as_deref())?;
    let before_status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;
    let stageable_files = count_stageable_git_files(&before_status, &pathspecs);

    if stageable_files == 0 {
        return Ok(ComputerGitActionResult {
            message: if before_status.staged_files > 0 {
                "All matching changes are already staged.".to_string()
            } else if pathspecs.is_empty() {
                "No local changes to stage.".to_string()
            } else {
                "No matching local changes to stage.".to_string()
            },
            output: None,
            status: before_status,
        });
    }

    let mut args = vec!["add".to_string(), "-A".to_string(), "--".to_string()];

    args.extend(pathspecs.iter().cloned());
    let output = run_git_owned(&repository_path, &args)?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;

    if pathspecs.is_empty() && status.unstaged_files + status.untracked_files > 0 {
        return Err("Git did not stage every local change. Review the remaining unstaged files and try again.".to_string());
    }

    Ok(ComputerGitActionResult {
        message: if pathspecs.is_empty() {
            format!(
                "Staged {} file{}.",
                stageable_files,
                if stageable_files == 1 { "" } else { "s" }
            )
        } else {
            format!(
                "Staged {} path{}.",
                pathspecs.len(),
                if pathspecs.len() == 1 { "" } else { "s" }
            )
        },
        output: optional_git_output(output),
        status,
    })
}

fn git_diff_blocking(request: ComputerGitDiffRequest) -> Result<ComputerGitDiffResult, String> {
    let repository_path = resolve_git_repository_path(&request.path)?;
    let pathspecs = normalize_git_pathspecs(&repository_path, request.paths.as_deref())?;
    let staged_only = request.staged.unwrap_or(false);
    let include_untracked = request.include_untracked.unwrap_or(true);
    let mut sections = Vec::new();

    if staged_only {
        let staged_diff = run_git_diff_command(&repository_path, true, &pathspecs)?;
        if !staged_diff.trim().is_empty() {
            sections.push(staged_diff);
        }
    } else {
        let working_diff = run_git_diff_command(&repository_path, false, &pathspecs)?;
        let staged_diff = run_git_diff_command(&repository_path, true, &pathspecs)?;

        if !working_diff.trim().is_empty() {
            sections.push(working_diff);
        }

        if !staged_diff.trim().is_empty() {
            sections.push(staged_diff);
        }
    }

    if include_untracked && !staged_only {
        let untracked_diff = create_untracked_git_diff(&repository_path, &pathspecs)?;
        if !untracked_diff.trim().is_empty() {
            sections.push(untracked_diff);
        }
    }

    let raw_diff = sections.join("\n");
    let (diff, truncated) = limit_git_diff_output(raw_diff, request.max_bytes);
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: path_to_string(&repository_path),
    })?;

    Ok(ComputerGitDiffResult {
        diff,
        path: path_to_string(normalize_input_path(&request.path)),
        repository_root: path_to_string(&repository_path),
        status,
        truncated,
    })
}

fn git_create_worktree_blocking(
    request: ComputerGitWorktreeRequest,
) -> Result<ComputerGitWorktreeResult, String> {
    let repository_path = resolve_git_repository_path(&request.path)?;
    let head = run_git(&repository_path, &["rev-parse", "--verify", "HEAD"])
        .map_err(|error| format!("Create the first commit before adding a worktree: {error}"))?;

    if head.trim().is_empty() {
        return Err("Create the first commit before adding a worktree.".to_string());
    }

    let branch_name = create_unique_worktree_branch_name(
        &repository_path,
        request.branch_name.as_deref(),
        request.title.as_deref(),
    )?;
    let target_path = create_unique_worktree_path(
        &repository_path,
        request.directory_name.as_deref(),
        &branch_name,
    )?;
    let target_path_string = path_to_string(&target_path);
    let output = run_git(
        &repository_path,
        &[
            "worktree",
            "add",
            "-b",
            &branch_name,
            &target_path_string,
            "HEAD",
        ],
    )?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        include_diff_preview: None,
        path: target_path_string.clone(),
    })?;

    Ok(ComputerGitWorktreeResult {
        branch_name: branch_name.clone(),
        message: format!(
            "Created worktree {} on {}.",
            target_path_string, branch_name
        ),
        output: optional_git_output(output),
        path: target_path_string,
        status,
    })
}

/// Searches the active file index using path, preview text, and local embeddings.
#[tauri::command]
pub fn computer_search_file_index(
    state: tauri::State<'_, ComputerFileIndexState>,
    request: ComputerSearchRequest,
) -> Result<Vec<ComputerSearchResult>, String> {
    let query = request.query.trim();

    if query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = request.limit.filter(|value| *value > 0);
    let query_embedding = create_embedding(query);
    let query_lower = query.to_lowercase();
    let query_tokens = tokenize_search_query(query);
    let index = state
        .index
        .lock()
        .map_err(|_| "The file index is busy. Try again in a moment.".to_string())?;
    let mut results = index
        .entries
        .iter()
        .filter_map(|entry| {
            let scored = score_entry(entry, &query_embedding, &query_lower, &query_tokens);

            if scored.score <= 0.0 {
                return None;
            }

            Some(ComputerSearchResult {
                extension: entry.extension.clone(),
                kind: entry.kind.clone(),
                line: scored.line,
                match_kind: scored.match_kind,
                matches: scored.matches,
                modified_at: entry.modified_at,
                name: entry.name.clone(),
                path: entry.path.clone(),
                preview: scored.preview.or_else(|| entry.preview.clone()),
                score: scored.score,
                size: entry.size,
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.total_cmp(&left.score));
    if let Some(limit) = limit {
        results.truncate(limit);
    }

    Ok(results)
}

/// Streams an exact literal text search through the filesystem without materializing every file.
#[tauri::command]
pub async fn computer_search_text_files(
    request: ComputerTextSearchRequest,
) -> Result<ComputerTextSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || computer_search_text_files_blocking(request))
        .await
        .map_err(|error| format!("The text search worker stopped unexpectedly: {}", error))?
}

/// Reads one text file and honors byte limits only when the caller explicitly asks for them.
#[tauri::command]
pub async fn computer_read_text_file(
    request: ComputerReadFileRequest,
) -> Result<ComputerReadFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_read_text_file_blocking(request))
        .await
        .map_err(|error| format!("The file read worker stopped unexpectedly: {}", error))?
}

/// Reads a precise 1-based line range without loading the whole file into memory.
#[tauri::command]
pub async fn computer_read_text_file_range(
    request: ComputerReadFileRangeRequest,
) -> Result<ComputerReadFileRangeResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_read_text_file_range_blocking(request))
        .await
        .map_err(|error| format!("The file range read worker stopped unexpectedly: {}", error))?
}

fn computer_read_text_file_blocking(
    request: ComputerReadFileRequest,
) -> Result<ComputerReadFileResult, String> {
    let path = normalize_input_path(&request.path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;

    if !metadata.is_file() {
        return Err("Choose a text file, not a folder.".to_string());
    }

    let mut file = File::open(&path)
        .map_err(|error| format!("Could not open {}: {}", path_to_string(&path), error))?;
    let mut buffer = Vec::new();
    let offset = request.offset.unwrap_or(0);

    if offset > metadata.len() {
        return Err(format!(
            "Requested offset {} is beyond the end of {} ({} bytes).",
            offset,
            path_to_string(&path),
            metadata.len()
        ));
    }

    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("Could not seek {}: {}", path_to_string(&path), error))?;
    }

    let remaining_bytes = metadata.len().saturating_sub(offset);
    let truncated = if let Some(max_bytes) = request.max_bytes.filter(|value| *value > 0) {
        buffer.resize(max_bytes.saturating_add(1), 0);
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;
        let truncated = offset > 0 || bytes_read > max_bytes || remaining_bytes > max_bytes as u64;
        buffer.truncate(bytes_read.min(max_bytes));
        truncated
    } else {
        file.read_to_end(&mut buffer)
            .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;
        offset > 0
    };

    if buffer.contains(&0) {
        return Err("This file looks binary, so Gilbert did not load it as text.".to_string());
    }

    Ok(ComputerReadFileResult {
        content: String::from_utf8_lossy(&buffer).to_string(),
        extension: file_extension(&path),
        modified_at: modified_millis(&metadata),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path_to_string(&path)),
        path: path_to_string(&path),
        sha256: if truncated {
            None
        } else {
            Some(hex_sha256(&buffer))
        },
        size: metadata.len(),
        truncated,
    })
}

fn computer_read_text_file_range_blocking(
    request: ComputerReadFileRangeRequest,
) -> Result<ComputerReadFileRangeResult, String> {
    let path = normalize_input_path(&request.path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;

    if !metadata.is_file() {
        return Err("Choose a text file, not a folder.".to_string());
    }

    if request.start_line == 0 || request.end_line == 0 {
        return Err("Line numbers must be positive integers.".to_string());
    }

    if request.end_line < request.start_line {
        return Err("endLine must be greater than or equal to startLine.".to_string());
    }

    if metadata.len() == 0 {
        if request.start_line > 1 {
            return Err(format!(
                "Requested startLine {} is beyond the end of `{}` (1 line).",
                request.start_line,
                path_to_string(&path)
            ));
        }

        return Ok(ComputerReadFileRangeResult {
            content: String::new(),
            end_line: 1,
            extension: file_extension(&path),
            line_count: 1,
            modified_at: modified_millis(&metadata),
            name: path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path_to_string(&path)),
            path: path_to_string(&path),
            requested_end_line: request.end_line,
            requested_start_line: request.start_line,
            size: metadata.len(),
            start_line: 1,
            total_lines: 1,
            truncated: request.end_line > 1,
        });
    }

    let file = File::open(&path)
        .map_err(|error| format!("Could not open {}: {}", path_to_string(&path), error))?;
    let mut reader = BufReader::new(file);
    let mut buffer = String::new();
    let mut line_number = 0usize;
    let mut selected_lines = Vec::new();

    loop {
        buffer.clear();
        let bytes_read = reader
            .read_line(&mut buffer)
            .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;

        if bytes_read == 0 {
            break;
        }

        if buffer.as_bytes().contains(&0) {
            return Err("This file looks binary, so Gilbert did not load it as text.".to_string());
        }

        line_number += 1;

        if line_number >= request.start_line && line_number <= request.end_line {
            selected_lines.push(trim_line_end(&buffer).to_string());
        }
    }

    let total_lines = line_number.max(1);

    if request.start_line > total_lines {
        return Err(format!(
            "Requested startLine {} is beyond the end of `{}` ({} line{}).",
            request.start_line,
            path_to_string(&path),
            total_lines,
            if total_lines == 1 { "" } else { "s" }
        ));
    }

    let actual_end_line = request.end_line.min(total_lines);
    let line_count = selected_lines.len();

    Ok(ComputerReadFileRangeResult {
        content: selected_lines.join("\n"),
        end_line: actual_end_line,
        extension: file_extension(&path),
        line_count,
        modified_at: modified_millis(&metadata),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path_to_string(&path)),
        path: path_to_string(&path),
        requested_end_line: request.end_line,
        requested_start_line: request.start_line,
        size: metadata.len(),
        start_line: request.start_line,
        total_lines,
        truncated: request.start_line > 1 || request.end_line < total_lines,
    })
}

fn computer_search_text_files_blocking(
    request: ComputerTextSearchRequest,
) -> Result<ComputerTextSearchResponse, String> {
    let started_at = Instant::now();
    let root = normalize_input_path(&request.path);
    let query = request.query.trim().to_string();

    if query.is_empty() {
        return Ok(ComputerTextSearchResponse::default());
    }

    let metadata = fs::metadata(&root)
        .map_err(|error| format!("Could not read {}: {}", path_to_string(&root), error))?;
    if !metadata.is_dir() {
        return Err("Choose a folder before searching text files.".to_string());
    }

    let case_sensitive = request.case_sensitive.unwrap_or(false);
    let context_lines = request.context_lines.unwrap_or(0);
    let include_content = request.include_content.unwrap_or(true);
    let include_generated = request.include_generated.unwrap_or(false);
    let include_path = request.include_path.unwrap_or(true);
    let max_matches = request
        .max_matches
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_TEXT_SEARCH_MAX_MATCHES)
        .min(MAX_TEXT_SEARCH_MAX_MATCHES);
    let max_matches_per_file = request
        .max_matches_per_file
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_TEXT_SEARCH_MAX_MATCHES_PER_FILE)
        .min(MAX_TEXT_SEARCH_MAX_MATCHES_PER_FILE);
    let extensions = normalize_search_extensions(request.extensions.as_deref());
    let exclude_directories = request
        .exclude_directories
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let globs = request.globs.unwrap_or_default();
    let matcher = NativeTextMatcher::new(&query, case_sensitive, request.regex.unwrap_or(false))?;
    let mut response = ComputerTextSearchResponse::default();
    let mut queue = VecDeque::from([root]);

    'scan: while let Some(directory) = queue.pop_front() {
        if text_search_time_budget_exceeded(started_at) {
            response.limited = true;
            break;
        }

        if response.matches.len() >= max_matches {
            response.limited = true;
            break;
        }

        let read_dir = match fs::read_dir(&directory) {
            Ok(read_dir) => read_dir,
            Err(_) => {
                response.inaccessible_entries += 1;
                continue;
            }
        };
        response.scanned_directories += 1;

        for entry_result in read_dir {
            if text_search_time_budget_exceeded(started_at) {
                response.limited = true;
                break 'scan;
            }

            if response.matches.len() >= max_matches {
                response.limited = true;
                break 'scan;
            }

            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    response.inaccessible_entries += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    response.inaccessible_entries += 1;
                    continue;
                }
            };
            let kind = file_kind_from_metadata(&metadata);
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path_to_string(&path));

            if matches!(kind, ComputerFileKind::Directory) {
                if should_skip_native_search_directory(
                    &path,
                    &name,
                    include_generated,
                    &exclude_directories,
                ) {
                    response.skipped_directories += 1;
                } else {
                    queue.push_back(path);
                }
                continue;
            }

            if !matches!(kind, ComputerFileKind::File) {
                response.skipped_files += 1;
                continue;
            }

            if !include_generated
                && should_skip_index_entry(&path, &name, &ComputerFileKind::File, &[])
            {
                response.skipped_files += 1;
                continue;
            }

            let path_text = path_to_string(&path);

            if !globs.is_empty() && !native_matches_globs(&path_text, &name, &globs) {
                response.filtered_by_glob += 1;
                continue;
            }

            let extension = file_extension(&path).unwrap_or_default();
            let path_matched =
                include_path && (matcher.is_match(&path_text) || matcher.is_match(&name));
            let should_read_content =
                include_content && extensions.iter().any(|value| value == &extension);
            let mut content_matches = Vec::new();

            response.files_scanned += 1;

            if should_read_content {
                if metadata.len() > MAX_TEXT_SEARCH_FILE_BYTES {
                    response.skipped_large_files += 1;
                    continue;
                }

                match search_file_for_matches(&path, &matcher, context_lines, max_matches_per_file)
                {
                    Ok(matches) => {
                        response.files_read += 1;
                        response.total_content_matches += matches.len();
                        content_matches = matches;
                    }
                    Err(_) => {
                        response.unreadable_files += 1;
                    }
                }
            }

            if path_matched || !content_matches.is_empty() {
                response.matches.push(ComputerTextSearchFileResult {
                    content_matches,
                    extension: if extension.is_empty() {
                        None
                    } else {
                        Some(extension)
                    },
                    name,
                    path: path_text,
                    path_matched,
                    size: Some(metadata.len()),
                });
            }
        }
    }

    Ok(response)
}

fn search_file_for_matches(
    path: &Path,
    matcher: &NativeTextMatcher,
    context_lines: usize,
    max_matches_per_file: usize,
) -> Result<Vec<ComputerTextSearchMatch>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let reader = BufReader::new(file);
    let mut matches = Vec::new();
    let mut previous = VecDeque::<ComputerTextSearchLineContext>::new();

    for (index, line_result) in reader.lines().enumerate() {
        let line_number = index + 1;
        let line = line_result.map_err(|error| error.to_string())?;

        if line.as_bytes().contains(&0) {
            return Err("binary file".to_string());
        }

        let preview = normalize_search_preview(&line);
        if context_lines > 0 {
            add_after_context(&mut matches, line_number, &preview, context_lines);
        }

        if matches.len() < max_matches_per_file && matcher.is_match(&line) {
            matches.push(ComputerTextSearchMatch {
                after: if context_lines > 0 {
                    Some(Vec::new())
                } else {
                    None
                },
                before: if context_lines > 0 {
                    Some(previous.iter().cloned().collect())
                } else {
                    None
                },
                line: line_number,
                preview: preview.clone(),
            });
        }

        if matches.len() >= max_matches_per_file && context_lines == 0 {
            break;
        }

        if context_lines > 0 {
            previous.push_back(ComputerTextSearchLineContext {
                line: line_number,
                preview,
            });
            while previous.len() > context_lines {
                previous.pop_front();
            }
        }
    }

    Ok(matches)
}

fn add_after_context(
    matches: &mut [ComputerTextSearchMatch],
    line_number: usize,
    preview: &str,
    context_lines: usize,
) {
    for search_match in matches {
        if line_number <= search_match.line || line_number > search_match.line + context_lines {
            continue;
        }

        let after = search_match.after.get_or_insert_with(Vec::new);
        if after.len() < context_lines {
            after.push(ComputerTextSearchLineContext {
                line: line_number,
                preview: preview.to_string(),
            });
        }
    }
}

fn should_skip_native_search_directory(
    path: &Path,
    name: &str,
    include_generated: bool,
    exclude_directories: &[String],
) -> bool {
    let lower_name = name.to_lowercase();

    exclude_directories.iter().any(|value| value == &lower_name)
        || (!include_generated
            && should_skip_index_entry(path, name, &ComputerFileKind::Directory, &[]))
}

fn normalize_search_extensions(values: Option<&[String]>) -> Vec<String> {
    let normalized = values
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().trim_start_matches('.').to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        DEFAULT_TEXT_SEARCH_EXTENSIONS
            .iter()
            .map(|value| value.to_string())
            .collect()
    } else {
        normalized
    }
}

enum NativeTextMatcher {
    Literal { case_sensitive: bool, query: String },
    Regex(regex::Regex),
}

impl NativeTextMatcher {
    fn new(query: &str, case_sensitive: bool, regex: bool) -> Result<Self, String> {
        if regex {
            return regex::RegexBuilder::new(query)
                .case_insensitive(!case_sensitive)
                .build()
                .map(NativeTextMatcher::Regex)
                .map_err(|error| format!("Unsupported regex for native files_search: {}", error));
        }

        Ok(NativeTextMatcher::Literal {
            case_sensitive,
            query: if case_sensitive {
                query.to_string()
            } else {
                query.to_lowercase()
            },
        })
    }

    fn is_match(&self, value: &str) -> bool {
        match self {
            NativeTextMatcher::Literal {
                case_sensitive,
                query,
            } => line_matches(value, query, *case_sensitive),
            NativeTextMatcher::Regex(expression) => expression.is_match(value),
        }
    }
}

fn line_matches(value: &str, query: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        value.contains(query)
    } else {
        value.to_lowercase().contains(query)
    }
}

fn text_search_time_budget_exceeded(started_at: Instant) -> bool {
    started_at.elapsed() >= Duration::from_millis(TEXT_SEARCH_TIME_BUDGET_MS)
}

fn normalize_search_preview(line: &str) -> String {
    line.trim().chars().take(360).collect()
}

fn trim_line_end(line: &str) -> &str {
    line.strip_suffix("\r\n")
        .or_else(|| line.strip_suffix('\n'))
        .or_else(|| line.strip_suffix('\r'))
        .unwrap_or(line)
}

fn native_matches_globs(path: &str, name: &str, globs: &[String]) -> bool {
    let normalized_path = path.replace('\\', "/").to_lowercase();
    let normalized_name = name.to_lowercase();

    globs.iter().any(|glob| {
        let pattern = glob
            .trim()
            .trim_start_matches("./")
            .replace('\\', "/")
            .to_lowercase();

        wildcard_match(&pattern, &normalized_path)
            || wildcard_match(&format!("*{pattern}"), &normalized_path)
            || wildcard_match(&pattern, &normalized_name)
    })
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern_chars = pattern.chars().collect::<Vec<_>>();
    let value_chars = value.chars().collect::<Vec<_>>();
    wildcard_match_chars(&pattern_chars, &value_chars)
}

fn wildcard_match_chars(pattern: &[char], value: &[char]) -> bool {
    let (mut pattern_index, mut value_index) = (0usize, 0usize);
    let mut star_index: Option<usize> = None;
    let mut star_value_index = 0usize;

    while value_index < value.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == '?' || pattern[pattern_index] == value[value_index])
        {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == '*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            star_value_index = value_index;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_value_index += 1;
            value_index = star_value_index;
        } else {
            return false;
        }
    }

    while pattern_index < pattern.len() && pattern[pattern_index] == '*' {
        pattern_index += 1;
    }

    pattern_index == pattern.len()
}

static ATOMIC_WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

const ATOMIC_RENAME_BACKOFFS_MS: [u64; 5] = [50, 100, 200, 400, 800];
const ATOMIC_EOL_SAMPLE_BYTES: usize = 64 * 1024;

#[cfg(windows)]
const WIN_ERROR_ACCESS_DENIED: i32 = 5;
#[cfg(windows)]
const WIN_ERROR_SHARING_VIOLATION: i32 = 32;
#[cfg(windows)]
const WIN_ERROR_LOCK_VIOLATION: i32 = 33;

/// Detects the majority line-ending family in a byte sample.
fn detect_eol_majority(bytes: &[u8]) -> Option<&'static str> {
    let sample_end = bytes.len().min(ATOMIC_EOL_SAMPLE_BYTES);
    let sample = &bytes[..sample_end];

    let mut crlf = 0usize;
    let mut lone_lf = 0usize;

    for (index, byte) in sample.iter().enumerate() {
        if *byte == b'\n' {
            if index > 0 && sample[index - 1] == b'\r' {
                crlf += 1;
            } else {
                lone_lf += 1;
            }
        }
    }

    if crlf == 0 && lone_lf == 0 {
        return None;
    }

    if crlf > lone_lf {
        Some("\r\n")
    } else if lone_lf > crlf {
        Some("\n")
    } else {
        // Tie: favour CRLF on Windows, LF elsewhere.
        if cfg!(windows) {
            Some("\r\n")
        } else {
            Some("\n")
        }
    }
}

fn has_utf8_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
}

/// Normalises every line ending in `content` to `target_eol`.
fn normalize_eol(content: &str, target_eol: &str) -> String {
    if content.is_empty() {
        return String::new();
    }

    let lf_only: std::borrow::Cow<'_, str> = if content.contains('\r') {
        std::borrow::Cow::Owned(content.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        std::borrow::Cow::Borrowed(content)
    };

    if target_eol == "\n" {
        return lf_only.into_owned();
    }

    let mut out = String::with_capacity(lf_only.len() + lf_only.matches('\n').count());
    for ch in lf_only.chars() {
        if ch == '\n' {
            out.push_str("\r\n");
        } else {
            out.push(ch);
        }
    }
    out
}

fn classify_eol(force: Option<&str>) -> Option<&'static str> {
    match force {
        Some(value) => match value.to_ascii_lowercase().as_str() {
            "crlf" | "windows" | "win" | "\r\n" => Some("\r\n"),
            "lf" | "unix" | "posix" | "\n" => Some("\n"),
            _ => None,
        },
        None => None,
    }
}

fn eol_label(eol: &str) -> &'static str {
    if eol == "\r\n" {
        "crlf"
    } else {
        "lf"
    }
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(windows)]
fn is_windows_sharing_error(error: &std::io::Error) -> bool {
    match error.raw_os_error() {
        Some(code) => {
            code == WIN_ERROR_SHARING_VIOLATION
                || code == WIN_ERROR_LOCK_VIOLATION
                || code == WIN_ERROR_ACCESS_DENIED
        }
        None => false,
    }
}

#[cfg(not(windows))]
fn is_windows_sharing_error(_error: &std::io::Error) -> bool {
    false
}

/// Writes bytes atomically with a sibling temp file, fsync, rename, and Windows lock retries.
fn atomic_write_with_retry(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path has no parent directory",
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("write");

    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.subsec_nanos())
        .unwrap_or(0);
    let counter = ATOMIC_WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(".{}.{}.{}.{}.tmp", file_name, pid, nanos, counter);
    let tmp_path = parent.join(&tmp_name);

    // Fsync is best-effort; an unreadable temp file still fails loudly on rename.
    {
        let mut tmp = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp_path)?;
        tmp.write_all(bytes)?;
        let _ = tmp.flush();
        let _ = tmp.sync_all();
    }

    let mut last_err: Option<std::io::Error> = None;
    let backoffs = std::iter::once(0u64).chain(ATOMIC_RENAME_BACKOFFS_MS.iter().copied());

    for delay in backoffs {
        if delay > 0 {
            thread::sleep(Duration::from_millis(delay));
        }

        match fs::rename(&tmp_path, path) {
            Ok(()) => return Ok(()),
            Err(err) => {
                if !is_windows_sharing_error(&err) {
                    let _ = fs::remove_file(&tmp_path);
                    return Err(err);
                }
                last_err = Some(err);
            }
        }
    }

    let _ = fs::remove_file(&tmp_path);
    Err(last_err.unwrap_or_else(|| std::io::Error::other("atomic rename failed")))
}

/// Writes one text file after checking it stays inside enabled roots.
#[tauri::command]
pub async fn computer_write_text_file(
    request: ComputerWriteFileRequest,
) -> Result<ComputerWriteFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_write_text_file_blocking(request))
        .await
        .map_err(|error| format!("The file write worker stopped unexpectedly: {}", error))?
}

fn computer_write_text_file_blocking(
    request: ComputerWriteFileRequest,
) -> Result<ComputerWriteFileResult, String> {
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before writing files.".to_string());
    }

    let path = normalize_workspace_path(&request.path, &roots)?;

    if !path_is_inside_roots(&path, &roots) {
        return Err(
            "Writes are only allowed inside the selected or current workspace folder.".to_string(),
        );
    }

    let created = !path.exists();
    let mut existing_bytes: Vec<u8> = Vec::new();
    let mut preserve_bom = false;
    let mut detected_eol: Option<&'static str> = None;

    if created && request.expected_sha256.is_some() {
        return Err("expectedSha256 was provided, but the target file does not exist.".to_string());
    }

    if !created {
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {}", path_to_string(&path), error))?;

        if !metadata.is_file() {
            return Err("Choose a file path, not a folder.".to_string());
        }

        if request.overwrite == Some(false) {
            return Err("That file already exists and overwrite is disabled.".to_string());
        }

        if let Some(expected) = request.expected_sha256.as_deref() {
            let mut file = File::open(&path)
                .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;
            file.read_to_end(&mut existing_bytes)
                .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;
            let actual = hex_sha256(&existing_bytes);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(format!(
                    "Refusing to write {}: file changed since it was last read (expected sha256 {}, on-disk sha256 {}). Re-read the file before retrying.",
                    path_to_string(&path),
                    expected,
                    actual
                ));
            }
        }

        // Reuse SHA-check bytes when available; otherwise sample only the head for EOL/BOM detection.
        if existing_bytes.is_empty() {
            if let Ok(mut file) = File::open(&path) {
                let mut sample = vec![0u8; ATOMIC_EOL_SAMPLE_BYTES];
                if let Ok(read) = file.read(&mut sample) {
                    sample.truncate(read);
                    existing_bytes = sample;
                }
            }
        }

        preserve_bom = has_utf8_bom(&existing_bytes);
        detected_eol = detect_eol_majority(&existing_bytes);
    }

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if request.create_parent_dirs.unwrap_or(true) {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Could not create {}: {}", path_to_string(parent), error)
                })?;
            } else {
                return Err(format!(
                    "Parent folder does not exist: {}",
                    path_to_string(parent)
                ));
            }
        }
    }

    // Strip an incoming UTF-8 BOM so we don't double it after preservation.
    let content_no_bom = request
        .content
        .strip_prefix('\u{feff}')
        .unwrap_or(&request.content);

    let forced_eol = classify_eol(request.force_eol.as_deref());
    let target_eol =
        forced_eol
            .or(detected_eol)
            .unwrap_or(if cfg!(windows) { "\r\n" } else { "\n" });

    let normalized = normalize_eol(content_no_bom, target_eol);

    let mut payload: Vec<u8> = Vec::with_capacity(normalized.len() + 3);
    if preserve_bom {
        payload.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    payload.extend_from_slice(normalized.as_bytes());

    atomic_write_with_retry(&path, &payload).map_err(|error| {
        format!(
            "Could not atomically write {}: {}",
            path_to_string(&path),
            error
        )
    })?;

    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "Could not inspect written file {}: {}",
            path_to_string(&path),
            error
        )
    })?;

    Ok(ComputerWriteFileResult {
        bytes_written: payload.len(),
        created,
        modified_at: modified_millis(&metadata),
        path: path_to_string(&path),
        sha256: Some(hex_sha256(&payload)),
        eol: Some(eol_label(target_eol).to_string()),
    })
}

/// Writes many text files in one desktop command so batch write tools avoid per-file IPC.
#[tauri::command]
pub async fn computer_write_text_files(
    request: ComputerWriteFilesRequest,
) -> Result<ComputerWriteFilesResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_write_text_files_blocking(request))
        .await
        .map_err(|error| {
            format!(
                "The batch file write worker stopped unexpectedly: {}",
                error
            )
        })?
}

fn computer_write_text_files_blocking(
    request: ComputerWriteFilesRequest,
) -> Result<ComputerWriteFilesResult, String> {
    let roots = request.roots;
    let item_count = request.files.len();

    if item_count <= 1 {
        let files = request
            .files
            .into_iter()
            .map(|item| write_text_files_item(item, &roots))
            .collect();
        return Ok(ComputerWriteFilesResult { files });
    }

    let requested_paths = request
        .files
        .iter()
        .map(|item| item.path.clone())
        .collect::<Vec<_>>();
    let worker_count = MAX_BATCH_WRITE_WORKERS.min(item_count).max(1);
    let queue = Arc::new(Mutex::new(
        request
            .files
            .into_iter()
            .enumerate()
            .collect::<VecDeque<_>>(),
    ));
    let roots = Arc::new(roots);
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut handles = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let queue = Arc::clone(&queue);
        let roots = Arc::clone(&roots);
        let sender = sender.clone();

        handles.push(thread::spawn(move || loop {
            let next_item = {
                let mut queue = queue.lock().expect("batch write queue poisoned");
                queue.pop_front()
            };

            let Some((index, item)) = next_item else {
                break;
            };

            let result = write_text_files_item(item, &roots);
            if sender.send((index, result)).is_err() {
                break;
            }
        }));
    }

    drop(sender);

    let mut ordered_files: Vec<Option<ComputerWriteFilesItemResult>> =
        (0..item_count).map(|_| None).collect();
    for (index, result) in receiver {
        if let Some(slot) = ordered_files.get_mut(index) {
            *slot = Some(result);
        }
    }

    for handle in handles {
        if handle.join().is_err() {
            return Err("The batch file write worker stopped unexpectedly.".to_string());
        }
    }

    let files = ordered_files
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| ComputerWriteFilesItemResult {
                error: Some(
                    "The batch file write worker stopped before reporting this file.".to_string(),
                ),
                ok: false,
                requested_path: requested_paths.get(index).cloned().unwrap_or_default(),
                result: None,
            })
        })
        .collect();

    Ok(ComputerWriteFilesResult { files })
}

fn write_text_files_item(
    item: ComputerWriteFilesItemRequest,
    roots: &[String],
) -> ComputerWriteFilesItemResult {
    let requested_path = item.path.clone();
    let result = computer_write_text_file_blocking(ComputerWriteFileRequest {
        content: item.content,
        create_parent_dirs: item.create_parent_dirs,
        expected_sha256: item.expected_sha256,
        force_eol: item.force_eol,
        overwrite: item.overwrite,
        path: item.path,
        roots: roots.to_vec(),
    });

    match result {
        Ok(result) => ComputerWriteFilesItemResult {
            error: None,
            ok: true,
            requested_path,
            result: Some(result),
        },
        Err(error) => ComputerWriteFilesItemResult {
            error: Some(error),
            ok: false,
            requested_path,
            result: None,
        },
    }
}

/// Creates a directory after checking it stays inside enabled roots.
#[tauri::command]
pub async fn computer_create_directory(
    request: ComputerCreateDirectoryRequest,
) -> Result<ComputerCreateDirectoryResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_create_directory_blocking(request))
        .await
        .map_err(|error| {
            format!(
                "The directory creation worker stopped unexpectedly: {}",
                error
            )
        })?
}

fn computer_create_directory_blocking(
    request: ComputerCreateDirectoryRequest,
) -> Result<ComputerCreateDirectoryResult, String> {
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before creating folders.".to_string());
    }

    let path = normalize_workspace_path(&request.path, &roots)?;

    if !path_is_inside_roots(&path, &roots) {
        return Err(
            "Folder creation is only allowed inside the selected or current workspace folder."
                .to_string(),
        );
    }

    if path.exists() {
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {}", path_to_string(&path), error))?;

        if !metadata.is_dir() {
            return Err(format!(
                "A file already exists at {}.",
                path_to_string(&path)
            ));
        }

        return Ok(ComputerCreateDirectoryResult {
            created: false,
            modified_at: modified_millis(&metadata),
            path: path_to_string(&path),
        });
    }

    if request.recursive.unwrap_or(true) {
        fs::create_dir_all(&path)
            .map_err(|error| format!("Could not create {}: {}", path_to_string(&path), error))?;
    } else {
        fs::create_dir(&path)
            .map_err(|error| format!("Could not create {}: {}", path_to_string(&path), error))?;
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {}", path_to_string(&path), error))?;

    Ok(ComputerCreateDirectoryResult {
        created: true,
        modified_at: modified_millis(&metadata),
        path: path_to_string(&path),
    })
}

/// Deletes one file after checking it stays inside enabled roots.
#[tauri::command]
pub async fn computer_delete_file(
    request: ComputerDeleteFileRequest,
) -> Result<ComputerDeleteFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_delete_file_blocking(request))
        .await
        .map_err(|error| format!("The file delete worker stopped unexpectedly: {}", error))?
}

fn computer_delete_file_blocking(
    request: ComputerDeleteFileRequest,
) -> Result<ComputerDeleteFileResult, String> {
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before deleting files.".to_string());
    }

    let path = normalize_workspace_path(&request.path, &roots)?;

    if !path_is_inside_roots(&path, &roots) {
        return Err(
            "Deletes are only allowed inside the selected or current workspace folder.".to_string(),
        );
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {}", path_to_string(&path), error))?;

    if !metadata.is_file() {
        return Err("delete_file only removes files, not folders.".to_string());
    }

    let bytes_deleted = metadata.len();

    fs::remove_file(&path)
        .map_err(|error| format!("Could not delete {}: {}", path_to_string(&path), error))?;

    Ok(ComputerDeleteFileResult {
        bytes_deleted,
        deleted: true,
        path: path_to_string(&path),
    })
}

/// Moves or renames a file or folder after checking both paths stay inside enabled roots.
#[tauri::command]
pub async fn computer_move_path(
    request: ComputerMovePathRequest,
) -> Result<ComputerMovePathResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_move_path_blocking(request))
        .await
        .map_err(|error| format!("The path move worker stopped unexpectedly: {}", error))?
}

fn computer_move_path_blocking(
    request: ComputerMovePathRequest,
) -> Result<ComputerMovePathResult, String> {
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before moving or renaming paths.".to_string());
    }

    let from_path = normalize_workspace_path(&request.from_path, &roots)?;
    let to_path = normalize_workspace_path(&request.to_path, &roots)?;

    if !path_is_inside_roots(&from_path, &roots) || !path_is_inside_roots(&to_path, &roots) {
        return Err(
            "Moves and renames are only allowed inside the selected or current workspace folder."
                .to_string(),
        );
    }

    if from_path == to_path {
        return Err("The source and destination paths are the same.".to_string());
    }

    let metadata = fs::symlink_metadata(&from_path).map_err(|error| {
        format!(
            "Could not inspect {}: {}",
            path_to_string(&from_path),
            error
        )
    })?;
    let kind = file_kind_from_metadata(&metadata);

    if to_path.exists() {
        return Err(format!(
            "The destination already exists: {}",
            path_to_string(&to_path)
        ));
    }

    if metadata.is_dir() {
        let source_compare = fs::canonicalize(&from_path).unwrap_or_else(|_| from_path.clone());
        let destination_compare = existing_path_for_compare(&to_path);
        if destination_compare.starts_with(source_compare) {
            return Err("Refusing to move a folder into itself.".to_string());
        }
    }

    if let Some(parent) = to_path.parent() {
        if !parent.exists() {
            if request.create_parent_dirs.unwrap_or(true) {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Could not create {}: {}", path_to_string(parent), error)
                })?;
            } else {
                return Err(format!(
                    "Destination parent folder does not exist: {}",
                    path_to_string(parent)
                ));
            }
        }
    }

    fs::rename(&from_path, &to_path).map_err(|error| {
        format!(
            "Could not move {} to {}: {}",
            path_to_string(&from_path),
            path_to_string(&to_path),
            error
        )
    })?;

    Ok(ComputerMovePathResult {
        from_path: path_to_string(&from_path),
        kind,
        moved: true,
        to_path: path_to_string(&to_path),
    })
}

/// Copies a file or folder after checking both paths stay inside enabled roots.
#[tauri::command]
pub async fn computer_copy_path(
    request: ComputerCopyPathRequest,
) -> Result<ComputerCopyPathResult, String> {
    tauri::async_runtime::spawn_blocking(move || computer_copy_path_blocking(request))
        .await
        .map_err(|error| format!("The path copy worker stopped unexpectedly: {}", error))?
}

fn computer_copy_path_blocking(
    request: ComputerCopyPathRequest,
) -> Result<ComputerCopyPathResult, String> {
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before copying paths.".to_string());
    }

    let from_path = normalize_workspace_path(&request.from_path, &roots)?;
    let to_path = normalize_workspace_path(&request.to_path, &roots)?;

    if !path_is_inside_roots(&from_path, &roots) || !path_is_inside_roots(&to_path, &roots) {
        return Err(
            "Copies are only allowed inside the selected, current, or full-computer workspace roots."
                .to_string(),
        );
    }

    if from_path == to_path {
        return Err("The source and destination paths are the same.".to_string());
    }

    let metadata = fs::symlink_metadata(&from_path).map_err(|error| {
        format!(
            "Could not inspect {}: {}",
            path_to_string(&from_path),
            error
        )
    })?;
    let kind = file_kind_from_metadata(&metadata);
    let overwrite = request.overwrite.unwrap_or(false);

    if metadata.is_dir() {
        let source_compare = fs::canonicalize(&from_path).unwrap_or_else(|_| from_path.clone());
        let destination_compare = existing_path_for_compare(&to_path);
        if destination_compare.starts_with(source_compare) {
            return Err("Refusing to copy a folder into itself.".to_string());
        }
    }

    if to_path.exists() {
        if !overwrite {
            return Err(format!(
                "The destination already exists: {}",
                path_to_string(&to_path)
            ));
        }

        let destination_metadata = fs::symlink_metadata(&to_path).map_err(|error| {
            format!(
                "Could not inspect destination {}: {}",
                path_to_string(&to_path),
                error
            )
        })?;

        if destination_metadata.is_dir() {
            fs::remove_dir_all(&to_path).map_err(|error| {
                format!(
                    "Could not remove existing destination {}: {}",
                    path_to_string(&to_path),
                    error
                )
            })?;
        } else {
            fs::remove_file(&to_path).map_err(|error| {
                format!(
                    "Could not remove existing destination {}: {}",
                    path_to_string(&to_path),
                    error
                )
            })?;
        }
    }

    if let Some(parent) = to_path.parent() {
        if !parent.exists() {
            if request.create_parent_dirs.unwrap_or(true) {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Could not create {}: {}", path_to_string(parent), error)
                })?;
            } else {
                return Err(format!(
                    "Destination parent folder does not exist: {}",
                    path_to_string(parent)
                ));
            }
        }
    }

    let bytes_copied = copy_path_recursive(&from_path, &to_path)?;

    Ok(ComputerCopyPathResult {
        bytes_copied,
        copied: true,
        from_path: path_to_string(&from_path),
        kind,
        to_path: path_to_string(&to_path),
    })
}

fn copy_path_recursive(from_path: &Path, to_path: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(from_path)
        .map_err(|error| format!("Could not inspect {}: {}", path_to_string(from_path), error))?;

    if metadata.file_type().is_symlink() {
        return Err("Copying symlinks is not supported by this tool.".to_string());
    }

    if metadata.is_file() {
        return fs::copy(from_path, to_path).map_err(|error| {
            format!(
                "Could not copy {} to {}: {}",
                path_to_string(from_path),
                path_to_string(to_path),
                error
            )
        });
    }

    if !metadata.is_dir() {
        return Err(format!(
            "Unsupported path type for copy: {}",
            path_to_string(from_path)
        ));
    }

    fs::create_dir_all(to_path)
        .map_err(|error| format!("Could not create {}: {}", path_to_string(to_path), error))?;

    let mut bytes_copied = 0_u64;
    for entry in fs::read_dir(from_path)
        .map_err(|error| format!("Could not read {}: {}", path_to_string(from_path), error))?
    {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {}", error))?;
        let child_from = entry.path();
        let child_to = to_path.join(entry.file_name());
        bytes_copied += copy_path_recursive(&child_from, &child_to)?;
    }

    Ok(bytes_copied)
}

impl ComputerFileIndex {
    fn summary(&self) -> ComputerFileIndexSummary {
        ComputerFileIndexSummary {
            built_at: self.built_at,
            entry_count: self.entries.len(),
            ignored_entries: self.ignored_entries,
            roots: self.roots.clone(),
            scanned_directories: self.scanned_directories,
            skipped_entries: self.skipped_entries,
            truncated: self.truncated,
        }
    }
}

fn should_emit_file_index_progress(last_emit: &Instant, entry_count: usize) -> bool {
    entry_count.is_multiple_of(INDEX_PROGRESS_ENTRY_INTERVAL)
        || last_emit.elapsed() >= Duration::from_millis(INDEX_PROGRESS_INTERVAL_MS)
}

fn emit_file_index_progress(
    app: &tauri::AppHandle,
    request_id: u64,
    index: &ComputerFileIndex,
    current_path: Option<String>,
    done: bool,
) {
    emit_file_index_progress_from_summary(app, request_id, &index.summary(), current_path, done);
}

fn emit_file_index_progress_from_summary(
    app: &tauri::AppHandle,
    request_id: u64,
    summary: &ComputerFileIndexSummary,
    current_path: Option<String>,
    done: bool,
) {
    let progress = ComputerFileIndexProgress {
        current_path,
        done,
        entry_count: summary.entry_count,
        ignored_entries: summary.ignored_entries,
        request_id,
        roots: summary.roots.clone(),
        scanned_directories: summary.scanned_directories,
        skipped_entries: summary.skipped_entries,
        truncated: summary.truncated,
    };

    let _ = app.emit(INDEX_PROGRESS_EVENT, progress);
}

fn list_system_roots() -> Vec<ComputerDrive> {
    #[cfg(windows)]
    {
        let mut drives = Vec::new();

        for letter in b'A'..=b'Z' {
            let name = format!("{}:", letter as char);
            let path = format!("{}\\", name);
            let root = Path::new(&path);

            if root.exists() {
                drives.push(ComputerDrive {
                    available: fs::read_dir(root).is_ok(),
                    kind: "drive".to_string(),
                    label: format!("{} drive", name),
                    name,
                    path,
                });
            }
        }

        drives
    }

    #[cfg(not(windows))]
    {
        let mut roots = vec![ComputerDrive {
            available: fs::read_dir("/").is_ok(),
            kind: "root".to_string(),
            label: "Filesystem root".to_string(),
            name: "/".to_string(),
            path: "/".to_string(),
        }];

        if let Some(home) = std::env::var_os("HOME") {
            let home_path = PathBuf::from(home);

            if home_path.exists() {
                roots.push(ComputerDrive {
                    available: fs::read_dir(&home_path).is_ok(),
                    kind: "home".to_string(),
                    label: "Home".to_string(),
                    name: "Home".to_string(),
                    path: path_to_string(&home_path),
                });
            }
        }

        roots
    }
}

fn default_user_workspace_directory() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let documents = home.join("Documents");

    if documents.is_dir() {
        return Some(documents);
    }

    if home.is_dir() {
        return Some(home);
    }

    std::env::current_dir().ok()
}

fn normalize_roots(roots: Vec<String>) -> Vec<PathBuf> {
    roots
        .into_iter()
        .map(|root| normalize_input_path(&root))
        .filter(|root| root.exists())
        .collect()
}

fn normalize_input_path(path: &str) -> PathBuf {
    let trimmed = path.trim();

    #[cfg(windows)]
    {
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            return PathBuf::from(format!("{}\\", trimmed));
        }
    }

    PathBuf::from(trimmed)
}

fn normalize_workspace_path(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let raw_path = normalize_input_path(path);

    if has_parent_dir_component(&raw_path) {
        return Err("Refusing to use a path that contains '..'.".to_string());
    }

    if raw_path.is_absolute() || roots.is_empty() {
        return Ok(raw_path);
    }

    let relative_path = strip_repeated_workspace_folder(&raw_path, &roots[0]);
    Ok(roots[0].join(relative_path))
}

fn strip_repeated_workspace_folder(path: &Path, root: &Path) -> PathBuf {
    let mut parts = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_os_string()),
            _ => None,
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return path_buf_from_parts(parts);
    }

    let Some(root_name) = root.file_name() else {
        return path_buf_from_parts(parts);
    };

    if comparable_path_segment(&parts[0].to_string_lossy())
        == comparable_path_segment(&root_name.to_string_lossy())
    {
        parts.remove(0);
    }

    path_buf_from_parts(parts)
}

fn path_buf_from_parts(parts: Vec<std::ffi::OsString>) -> PathBuf {
    let mut path = PathBuf::new();

    for part in parts {
        path.push(part);
    }

    path
}

fn comparable_path_segment(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect()
}

fn has_parent_dir_component(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
}

fn path_is_inside_roots(path: &Path, roots: &[PathBuf]) -> bool {
    let compare_path = existing_path_for_compare(path);

    roots.iter().any(|root| {
        let compare_root = existing_path_for_compare(root);
        compare_path.starts_with(compare_root)
    })
}

fn existing_path_for_compare(path: &Path) -> PathBuf {
    if let Ok(canonical) = fs::canonicalize(path) {
        return canonical;
    }

    let mut current = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    };

    loop {
        if let Ok(canonical) = fs::canonicalize(&current) {
            return canonical;
        }

        if !current.pop() {
            break;
        }
    }

    path.to_path_buf()
}

fn create_directory_entry(path: PathBuf) -> Option<ComputerDirectoryEntry> {
    let metadata = fs::symlink_metadata(&path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    let kind = file_kind_from_metadata(&metadata);

    Some(ComputerDirectoryEntry {
        extension: file_extension(&path),
        kind,
        modified_at: modified_millis(&metadata),
        name,
        path: path_to_string(&path),
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
    })
}

fn file_kind_from_metadata(metadata: &fs::Metadata) -> ComputerFileKind {
    let file_type = metadata.file_type();

    if file_type.is_symlink() {
        ComputerFileKind::Symlink
    } else if metadata.is_dir() {
        ComputerFileKind::Directory
    } else if metadata.is_file() {
        ComputerFileKind::File
    } else {
        ComputerFileKind::Other
    }
}

fn kind_sort_rank(kind: &ComputerFileKind) -> u8 {
    match kind {
        ComputerFileKind::Directory => 0,
        ComputerFileKind::File => 1,
        ComputerFileKind::Symlink => 2,
        ComputerFileKind::Other => 3,
    }
}

fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn should_skip_index_entry(
    path: &Path,
    name: &str,
    kind: &ComputerFileKind,
    ignore_rules: &[IndexIgnoreRule],
) -> bool {
    is_hard_skipped_index_entry(name, kind)
        || is_ignored_by_gitignore_rules(path, kind, ignore_rules)
}

fn is_hard_skipped_index_entry(name: &str, kind: &ComputerFileKind) -> bool {
    let normalized_name = name.to_ascii_lowercase();

    match kind {
        ComputerFileKind::Directory => SKIPPED_INDEX_DIRECTORY_NAMES
            .iter()
            .any(|skipped_name| *skipped_name == normalized_name),
        ComputerFileKind::File => {
            if normalized_name == ".env" || normalized_name.starts_with(".env.") {
                return true;
            }

            if SKIPPED_INDEX_FILE_NAMES
                .iter()
                .any(|skipped_name| *skipped_name == normalized_name)
            {
                return true;
            }

            file_extension(Path::new(&normalized_name))
                .map(|extension| {
                    SKIPPED_INDEX_FILE_EXTENSIONS
                        .iter()
                        .any(|skipped_extension| *skipped_extension == extension)
                })
                .unwrap_or(false)
        }
        _ => false,
    }
}

fn read_gitignore_rules(directory: &Path) -> Vec<IndexIgnoreRule> {
    let gitignore_path = directory.join(".gitignore");
    let Ok(contents) = fs::read_to_string(gitignore_path) else {
        return Vec::new();
    };

    parse_gitignore_rules_from_text(directory, &contents)
}

fn parse_gitignore_rules_from_text(base: &Path, contents: &str) -> Vec<IndexIgnoreRule> {
    contents
        .lines()
        .filter_map(|line| parse_gitignore_rule_line(base, line))
        .collect()
}

fn parse_gitignore_rule_line(base: &Path, line: &str) -> Option<IndexIgnoreRule> {
    let mut pattern = line.trim();

    if pattern.is_empty() {
        return None;
    }

    if let Some(comment) = pattern.strip_prefix("\\#") {
        pattern = comment;
    } else if pattern.starts_with('#') {
        return None;
    }

    let mut negated = false;
    if let Some(literal_bang) = pattern.strip_prefix("\\!") {
        pattern = literal_bang;
    } else if let Some(rest) = pattern.strip_prefix('!') {
        negated = true;
        pattern = rest.trim_start();
    }

    let mut pattern = pattern.replace('\\', "/");
    let directory_only = pattern.ends_with('/');
    while pattern.ends_with('/') {
        pattern.pop();
    }

    let anchored = pattern.starts_with('/');
    while pattern.starts_with('/') {
        pattern.remove(0);
    }

    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return None;
    }

    Some(IndexIgnoreRule {
        anchored,
        base: base.to_path_buf(),
        directory_only,
        has_slash: pattern.contains('/'),
        negated,
        pattern,
    })
}

fn is_ignored_by_gitignore_rules(
    path: &Path,
    kind: &ComputerFileKind,
    ignore_rules: &[IndexIgnoreRule],
) -> bool {
    let mut ignored = false;

    for rule in ignore_rules {
        if gitignore_rule_matches(rule, path, kind) {
            ignored = !rule.negated;
        }
    }

    ignored
}

fn gitignore_rule_matches(rule: &IndexIgnoreRule, path: &Path, kind: &ComputerFileKind) -> bool {
    if rule.directory_only && !matches!(kind, ComputerFileKind::Directory) {
        return false;
    }

    let Ok(relative_path) = path.strip_prefix(&rule.base) else {
        return false;
    };
    let relative_path = path_to_slash_lossy(relative_path);

    if relative_path.is_empty() {
        return false;
    }

    if rule.anchored || rule.has_slash {
        return wildcard_path_matches(&rule.pattern, &relative_path);
    }

    relative_path
        .split('/')
        .any(|component| wildcard_match_segment(&rule.pattern, component))
}

fn wildcard_path_matches(pattern: &str, path: &str) -> bool {
    let pattern_parts: Vec<&str> = pattern.split('/').filter(|part| !part.is_empty()).collect();
    let path_parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    wildcard_path_segments_match(&pattern_parts, &path_parts)
}

fn wildcard_path_segments_match(pattern_parts: &[&str], path_parts: &[&str]) -> bool {
    match (pattern_parts.split_first(), path_parts.split_first()) {
        (None, None) => true,
        (None, Some(_)) => false,
        (Some((&"**", remaining_patterns)), _) => {
            wildcard_path_segments_match(remaining_patterns, path_parts)
                || (!path_parts.is_empty()
                    && wildcard_path_segments_match(pattern_parts, &path_parts[1..]))
        }
        (Some((pattern, remaining_patterns)), Some((path_part, remaining_path_parts))) => {
            wildcard_match_segment(pattern, path_part)
                && wildcard_path_segments_match(remaining_patterns, remaining_path_parts)
        }
        (Some(_), None) => false,
    }
}

fn wildcard_match_segment(pattern: &str, text: &str) -> bool {
    let pattern_chars: Vec<char> = pattern.chars().collect();
    let text_chars: Vec<char> = text.chars().collect();
    let mut matches = vec![vec![false; text_chars.len() + 1]; pattern_chars.len() + 1];
    matches[0][0] = true;

    for pattern_index in 1..=pattern_chars.len() {
        if pattern_chars[pattern_index - 1] == '*' {
            matches[pattern_index][0] = matches[pattern_index - 1][0];
        }
    }

    for pattern_index in 1..=pattern_chars.len() {
        for text_index in 1..=text_chars.len() {
            matches[pattern_index][text_index] = match pattern_chars[pattern_index - 1] {
                '*' => {
                    matches[pattern_index - 1][text_index] || matches[pattern_index][text_index - 1]
                }
                '?' => matches[pattern_index - 1][text_index - 1],
                expected => {
                    expected == text_chars[text_index - 1]
                        && matches[pattern_index - 1][text_index - 1]
                }
            };
        }
    }

    matches[pattern_chars.len()][text_chars.len()]
}

fn path_to_slash_lossy(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().replace('\\', "/")),
            Component::ParentDir => Some("..".to_string()),
            Component::CurDir | Component::Prefix(_) | Component::RootDir => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn should_index_text_preview(path: &Path, _size: u64) -> bool {
    matches!(
        file_extension(path).as_deref(),
        Some(
            "bat"
                | "astro"
                | "c"
                | "cmd"
                | "cpp"
                | "cs"
                | "css"
                | "csv"
                | "dart"
                | "go"
                | "graphql"
                | "gradle"
                | "h"
                | "html"
                | "java"
                | "js"
                | "json"
                | "jsx"
                | "kt"
                | "kts"
                | "log"
                | "lua"
                | "md"
                | "ps1"
                | "php"
                | "py"
                | "rb"
                | "rs"
                | "scss"
                | "sh"
                | "sql"
                | "svelte"
                | "swift"
                | "toml"
                | "ts"
                | "tsx"
                | "vue"
                | "txt"
                | "xml"
                | "yaml"
                | "yml"
        )
    )
}

fn read_text_preview(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).ok()?;

    if buffer.contains(&0) {
        return None;
    }

    let preview = String::from_utf8_lossy(&buffer)
        .lines()
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = preview.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn create_embedding(text: &str) -> Vec<f32> {
    let mut vector = vec![0f32; EMBEDDING_DIMS];
    let mut token = String::new();

    for character in text.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            token.push(character.to_ascii_lowercase());
        } else {
            push_embedding_token(&mut vector, &token);
            token.clear();
        }
    }

    push_embedding_token(&mut vector, &token);
    normalize_vector(&mut vector);
    vector
}

fn push_embedding_token(vector: &mut [f32], token: &str) {
    if token.len() < 2 {
        return;
    }

    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    let hash = hasher.finish();
    let index = (hash as usize) % vector.len();
    let weight = if token.len() > 18 { 1.35 } else { 1.0 };
    vector[index] += weight;
}

fn normalize_vector(vector: &mut [f32]) {
    let length = vector.iter().map(|value| value * value).sum::<f32>().sqrt();

    if length <= f32::EPSILON {
        return;
    }

    for value in vector {
        *value /= length;
    }
}

#[derive(Debug)]
struct SearchScore {
    line: Option<usize>,
    match_kind: String,
    matches: Vec<String>,
    preview: Option<String>,
    score: f32,
}

fn tokenize_search_query(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for character in value.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            current.push(character.to_ascii_lowercase());
        } else {
            push_search_token(&mut tokens, &current);
            current.clear();
        }
    }

    push_search_token(&mut tokens, &current);
    tokens
}

fn push_search_token(tokens: &mut Vec<String>, token: &str) {
    let cleaned = token.trim_matches(|character: char| character == '_' || character == '-');

    if cleaned.len() < 2 {
        return;
    }

    if !tokens.iter().any(|existing| existing == cleaned) {
        tokens.push(cleaned.to_string());
    }

    for part in cleaned.split(['_', '-']) {
        if part.len() > 1 && !tokens.iter().any(|existing| existing == part) {
            tokens.push(part.to_string());
        }
    }
}

fn score_entry(
    entry: &IndexedComputerFile,
    query_embedding: &[f32],
    query_lower: &str,
    query_tokens: &[String],
) -> SearchScore {
    let semantic_score = entry
        .embedding
        .iter()
        .zip(query_embedding)
        .map(|(left, right)| left * right)
        .sum::<f32>();
    let path_lower = entry.path.to_lowercase();
    let name_lower = entry.name.to_lowercase();
    let extension_lower = entry.extension.clone().unwrap_or_default();
    let preview_lower = entry.preview.as_deref().unwrap_or_default().to_lowercase();
    let mut matches = Vec::new();
    let mut name_score = 0f32;
    let mut path_score = 0f32;
    let mut content_score = 0f32;

    if !query_lower.is_empty() && name_lower == query_lower {
        name_score += 8.0;
        push_match(&mut matches, query_lower);
    } else if !query_lower.is_empty() && name_lower.contains(query_lower) {
        name_score += 5.0;
        push_match(&mut matches, query_lower);
    }

    if !query_lower.is_empty() && path_lower.contains(query_lower) {
        path_score += 2.5;
        push_match(&mut matches, query_lower);
    }

    if !query_lower.is_empty() && preview_lower.contains(query_lower) {
        content_score += 1.4;
        push_match(&mut matches, query_lower);
    }

    for token in query_tokens {
        if name_lower.contains(token) {
            name_score += 1.6;
            push_match(&mut matches, token);
        }

        if path_lower.contains(token) {
            path_score += 0.85;
            push_match(&mut matches, token);
        }

        if extension_lower == *token {
            path_score += 0.45;
            push_match(&mut matches, token);
        }

        if preview_lower.contains(token) {
            content_score += 0.35;
            push_match(&mut matches, token);
        }
    }

    let snippet = find_preview_snippet(
        entry.preview.as_deref().unwrap_or_default(),
        query_lower,
        query_tokens,
    );

    if snippet.preview.is_some() {
        content_score += 0.8;
        for item in &snippet.matches {
            push_match(&mut matches, item);
        }
    }

    let strongest_lexical = name_score.max(path_score).max(content_score);
    let match_kind = if name_score > 0.0 && name_score >= path_score && name_score >= content_score
    {
        "name"
    } else if path_score > 0.0 && path_score >= content_score {
        "path"
    } else if content_score > 0.0 {
        "content"
    } else {
        "semantic"
    };

    SearchScore {
        line: snippet.line,
        match_kind: match_kind.to_string(),
        matches,
        preview: snippet.preview,
        score: strongest_lexical
            + content_score / query_tokens.len().max(1) as f32
            + semantic_score * 0.75,
    }
}

#[derive(Default)]
struct SearchSnippet {
    line: Option<usize>,
    matches: Vec<String>,
    preview: Option<String>,
}

fn find_preview_snippet(
    content: &str,
    query_lower: &str,
    query_tokens: &[String],
) -> SearchSnippet {
    if content.is_empty() {
        return SearchSnippet::default();
    }

    for (index, line) in content.lines().enumerate() {
        let line_lower = line.to_lowercase();
        let mut matches = Vec::new();

        if !query_lower.is_empty() && line_lower.contains(query_lower) {
            push_match(&mut matches, query_lower);
        }

        for token in query_tokens {
            if line_lower.contains(token) {
                push_match(&mut matches, token);
            }
        }

        if !matches.is_empty() {
            return SearchSnippet {
                line: Some(index + 1),
                matches,
                preview: Some(trim_search_preview(line)),
            };
        }
    }

    SearchSnippet::default()
}

fn trim_search_preview(line: &str) -> String {
    line.trim().to_string()
}

fn push_match(matches: &mut Vec<String>, value: &str) {
    let cleaned = value.trim().to_ascii_lowercase();

    if cleaned.is_empty() || matches.iter().any(|item| item == &cleaned) {
        return;
    }

    matches.push(cleaned);
}

fn modified_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata.modified().ok().and_then(system_time_millis)
}

fn now_millis() -> u64 {
    system_time_millis(SystemTime::now()).unwrap_or_default()
}

fn system_time_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
}

fn create_unavailable_git_status(error: Option<String>) -> ComputerGitStatus {
    ComputerGitStatus {
        additions: 0,
        ahead: 0,
        available: false,
        behind: 0,
        branch: None,
        changed_files: 0,
        clean: true,
        deletions: 0,
        error,
        files: Vec::new(),
        github_owner: None,
        github_repo: None,
        head_sha: None,
        remote_url: None,
        repository_root: None,
        staged_files: 0,
        upstream: None,
        unstaged_files: 0,
        untracked_files: 0,
    }
}

fn resolve_git_repository_path(input_path: &str) -> Result<PathBuf, String> {
    let path = normalize_input_path(input_path);

    if !path.exists() {
        return Err(format!("{} does not exist.", path_to_string(&path)));
    }

    find_git_repository_root(&path)
        .ok_or_else(|| "This folder is not inside a Git repository.".to_string())
}

fn find_git_repository_root(path: &Path) -> Option<PathBuf> {
    let mut current = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };

    loop {
        if current.join(".git").exists() {
            return Some(current);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
    run_git_with_timeout(
        path,
        args,
        Duration::from_millis(GIT_DEFAULT_COMMAND_TIMEOUT_MS),
    )
}

fn run_git_owned(path: &Path, args: &[String]) -> Result<String, String> {
    run_git_owned_with_timeout(
        path,
        args,
        Duration::from_millis(GIT_DEFAULT_COMMAND_TIMEOUT_MS),
    )
}

fn run_git_quick(path: &Path, args: &[&str]) -> Result<String, String> {
    run_git_with_timeout(
        path,
        args,
        Duration::from_millis(GIT_STATUS_COMMAND_TIMEOUT_MS),
    )
}

fn run_git_with_timeout(path: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut command = git_command();

    let mut child = command
        .arg("-C")
        .arg(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run git: {}", error))?;

    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Could not read git output: {}", error))?;
                return parse_git_output(output);
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Git timed out after {}s while running: git {}",
                    timeout.as_secs().max(1),
                    args.join(" ")
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => return Err(format!("Could not poll git: {}", error)),
        }
    }
}

fn run_git_owned_with_timeout(
    path: &Path,
    args: &[String],
    timeout: Duration,
) -> Result<String, String> {
    let mut command = git_command();

    let mut child = command
        .arg("-C")
        .arg(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run git: {}", error))?;

    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Could not read git output: {}", error))?;
                return parse_git_output(output);
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Git timed out after {}s while running: git {}",
                    timeout.as_secs().max(1),
                    args.join(" ")
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => return Err(format!("Could not poll git: {}", error)),
        }
    }
}

fn git_command() -> Command {
    let mut command = Command::new(resolve_native_executable("git"));
    configure_native_path(&mut command);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
}

fn parse_git_output(output: Output) -> Result<String, String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };

        return Err(if detail.is_empty() {
            "Git did not return status for this folder.".to_string()
        } else {
            detail
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_git_branch_name(repository_path: &Path, branch_name: &str) -> Result<(), String> {
    validate_new_git_branch_name(branch_name)?;

    run_git(
        repository_path,
        &["check-ref-format", "--branch", branch_name],
    )
    .map(|_| ())
    .map_err(|_| "Enter a valid Git branch name.".to_string())
}

fn validate_new_git_branch_name(branch_name: &str) -> Result<(), String> {
    if branch_name.is_empty() {
        return Err("Enter a branch name before creating a branch.".to_string());
    }

    if branch_name.starts_with('-')
        || branch_name
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("Branch names cannot start with '-' or contain whitespace.".to_string());
    }

    Ok(())
}

fn validate_git_remote_name(remote: &str) -> Result<(), String> {
    if remote.is_empty()
        || remote.starts_with('-')
        || remote
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("Enter a valid Git remote name.".to_string());
    }

    Ok(())
}

fn normalize_git_pathspecs(
    repository_path: &Path,
    paths: Option<&[String]>,
) -> Result<Vec<String>, String> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    let mut pathspecs = Vec::new();

    for raw_path in paths {
        let trimmed = raw_path.trim();

        if trimmed.is_empty() {
            continue;
        }

        if trimmed.chars().any(char::is_control) {
            return Err("Git path filters cannot contain control characters.".to_string());
        }

        let candidate = Path::new(trimmed);
        let pathspec = if candidate.is_absolute() {
            let absolute_path = normalize_input_path(trimmed);
            let relative_path = absolute_path.strip_prefix(repository_path).map_err(|_| {
                format!(
                    "{} is outside the Git repository {}.",
                    path_to_string(&absolute_path),
                    path_to_string(repository_path)
                )
            })?;

            relative_path.to_string_lossy().replace('\\', "/")
        } else {
            trimmed.replace('\\', "/")
        };
        let cleaned = pathspec
            .trim_start_matches("./")
            .trim_matches('/')
            .to_string();

        if cleaned.is_empty() {
            continue;
        }

        if cleaned == ".." || cleaned.starts_with("../") || cleaned.contains("/../") {
            return Err("Git path filters must stay inside the repository.".to_string());
        }

        pathspecs.push(cleaned);
    }

    pathspecs.sort();
    pathspecs.dedup();
    Ok(pathspecs)
}

fn run_git_diff_command(
    repository_path: &Path,
    staged: bool,
    pathspecs: &[String],
) -> Result<String, String> {
    let mut args = vec![
        "diff".to_string(),
        "--no-ext-diff".to_string(),
        "--no-color".to_string(),
        "--find-renames".to_string(),
    ];

    if staged {
        args.push("--cached".to_string());
    }

    args.push("--".to_string());
    args.extend(pathspecs.iter().cloned());

    run_git_owned(repository_path, &args)
}

fn create_untracked_git_diff(
    repository_path: &Path,
    pathspecs: &[String],
) -> Result<String, String> {
    let mut args = vec![
        "ls-files".to_string(),
        "--others".to_string(),
        "--exclude-standard".to_string(),
        "-z".to_string(),
        "--".to_string(),
    ];
    args.extend(pathspecs.iter().cloned());
    let output = run_git_owned(repository_path, &args)?;
    let mut sections = Vec::new();

    for path in output.split('\0').filter(|value| !value.trim().is_empty()) {
        if let Some(diff) = create_untracked_git_full_diff(repository_path, path) {
            sections.push(diff);
        }
    }

    Ok(sections.join("\n"))
}

fn create_untracked_git_full_diff(repository_path: &Path, path: &str) -> Option<String> {
    let absolute_path = repository_path.join(path);
    let bytes = std::fs::read(&absolute_path).ok()?;

    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Some(format!(
            "diff --git a/{0} b/{0}\nnew file mode 100644\nBinary files /dev/null and b/{0} differ",
            path
        ));
    }

    let content = String::from_utf8(bytes).ok()?;
    let line_count = if content.is_empty() {
        0
    } else {
        content.lines().count().max(1)
    };
    let mut diff = format!(
        "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n",
        path, line_count
    );

    for line in content.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }

    if content.ends_with('\n') {
        // `lines()` omits the trailing empty segment, which is correct for diff display.
    } else if !content.is_empty() {
        diff.push_str("\\ No newline at end of file\n");
    }

    Some(diff)
}

fn limit_git_diff_output(diff: String, max_bytes: Option<usize>) -> (String, bool) {
    let Some(max_bytes) = max_bytes else {
        return (diff, false);
    };

    if max_bytes == 0 || diff.len() <= max_bytes {
        return (diff, false);
    }

    let mut end = max_bytes.min(diff.len());
    while end > 0 && !diff.is_char_boundary(end) {
        end -= 1;
    }

    let marker = format!(
        "\n[Git diff truncated after {} bytes by request.]",
        max_bytes
    );
    let mut truncated = diff[..end].trim_end().to_string();
    truncated.push_str(&marker);
    (truncated, true)
}

fn create_unique_worktree_branch_name(
    repository_path: &Path,
    requested_branch: Option<&str>,
    title: Option<&str>,
) -> Result<String, String> {
    let base_branch = requested_branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_start_matches("refs/heads/").to_string())
        .unwrap_or_else(|| {
            let slug = title
                .map(sanitize_worktree_slug)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "chat".to_string());
            format!("codex/fork-{}-{}", slug, now_millis())
        });

    for index in 0..1000 {
        let candidate = if index == 0 {
            base_branch.clone()
        } else {
            format!("{}-{}", base_branch, index + 1)
        };

        validate_git_branch_name(repository_path, &candidate)?;

        if !git_branch_exists(repository_path, &candidate) {
            return Ok(candidate);
        }
    }

    Err("Could not find an available worktree branch name.".to_string())
}

fn create_unique_worktree_path(
    repository_path: &Path,
    requested_directory: Option<&str>,
    branch_name: &str,
) -> Result<PathBuf, String> {
    let parent = repository_path
        .parent()
        .ok_or_else(|| "Could not find a parent folder for the Git worktree.".to_string())?;
    let repo_name = repository_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "workspace".to_string());
    let requested = requested_directory
        .map(sanitize_worktree_directory_name)
        .filter(|value| !value.is_empty());
    let branch_slug = branch_name
        .rsplit('/')
        .next()
        .map(sanitize_worktree_directory_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "fork".to_string());
    let base_directory = requested.unwrap_or_else(|| format!("{}-{}", repo_name, branch_slug));

    for index in 0..1000 {
        let directory_name = if index == 0 {
            base_directory.clone()
        } else {
            format!("{}-{}", base_directory, index + 1)
        };
        let candidate = parent.join(directory_name);

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Could not find an available folder for the Git worktree.".to_string())
}

fn git_branch_exists(repository_path: &Path, branch_name: &str) -> bool {
    let ref_name = format!("refs/heads/{}", branch_name);
    run_git(repository_path, &["rev-parse", "--verify", &ref_name]).is_ok()
}

fn sanitize_worktree_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;

    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }

        if slug.len() >= 48 {
            break;
        }
    }

    slug.trim_matches('-').to_string()
}

fn sanitize_worktree_directory_name(value: &str) -> String {
    let slug = sanitize_worktree_slug(value);

    if slug.is_empty() {
        "fork".to_string()
    } else {
        slug
    }
}

fn optional_git_output(output: String) -> Option<String> {
    let trimmed = output.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Clone)]
struct GitDiffPreview {
    lines: Vec<ComputerGitDiffLine>,
    truncated: bool,
}

fn get_git_ahead_behind(repository_path: &Path) -> Option<(usize, usize)> {
    let output = run_git_quick(
        repository_path,
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    )
    .ok()?;
    let mut parts = output.split_whitespace();
    let behind = parts.next()?.parse::<usize>().ok()?;
    let ahead = parts.next()?.parse::<usize>().ok()?;

    Some((behind, ahead))
}

fn split_git_upstream(upstream: &str) -> Option<(String, String)> {
    let (remote, branch) = upstream.split_once('/')?;

    if remote.trim().is_empty() || branch.trim().is_empty() {
        return None;
    }

    Some((remote.to_string(), branch.to_string()))
}

fn git_head_sha(repository_path: &Path) -> Result<String, String> {
    run_git(repository_path, &["rev-parse", "HEAD"]).map(|value| value.trim().to_string())
}

fn git_remote_head_sha(
    repository_path: &Path,
    remote: &str,
    branch: &str,
) -> Result<Option<String>, String> {
    let ref_name = format!("refs/heads/{}", branch);
    let output = run_git_owned(
        repository_path,
        &[
            "ls-remote".to_string(),
            "--heads".to_string(),
            remote.to_string(),
            ref_name.clone(),
        ],
    )?;

    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(sha) = parts.next() else {
            continue;
        };
        let Some(remote_ref) = parts.next() else {
            continue;
        };

        if remote_ref == ref_name {
            return Ok(Some(sha.to_string()));
        }
    }

    Ok(None)
}

fn count_stageable_git_files(status: &ComputerGitStatus, pathspecs: &[String]) -> usize {
    status
        .files
        .iter()
        .filter(|file| file.unstaged || file.untracked)
        .filter(|file| {
            pathspecs.is_empty()
                || pathspecs
                    .iter()
                    .any(|pathspec| git_path_matches_pathspec(&file.path, pathspec))
        })
        .count()
}

fn git_path_matches_pathspec(path: &str, pathspec: &str) -> bool {
    let path = git_status_path_key(path);
    let pathspec = git_status_path_key(pathspec).trim_matches('/').to_string();

    if pathspec.starts_with(':') || pathspec.contains('*') || pathspec.contains('?') {
        return true;
    }

    path == pathspec || path.starts_with(&format!("{}/", pathspec))
}

fn build_git_diff_previews(
    repository_path: &Path,
    status_output: &str,
) -> HashMap<String, GitDiffPreview> {
    let diff_output = run_git_quick(
        repository_path,
        &[
            "diff",
            "--unified=4",
            "--no-ext-diff",
            "--no-color",
            "HEAD",
            "--",
        ],
    )
    .unwrap_or_default();
    let mut previews = parse_tracked_git_diff_previews(&diff_output);

    for line in status_output.lines() {
        if previews.len() >= MAX_GIT_DIFF_PREVIEW_FILES {
            break;
        }

        let trimmed = line.trim_end();

        if trimmed.len() < 4 {
            continue;
        }

        let Some(status) = trimmed.get(0..2).map(str::trim) else {
            continue;
        };

        if status != "??" {
            continue;
        }

        let Some(raw_path) = trimmed.get(3..).map(str::trim) else {
            continue;
        };
        let (_old_path, path) = split_git_status_path(raw_path);
        let key = git_status_path_key(&path);

        if previews.contains_key(&key) {
            continue;
        }

        if let Some(preview) = create_untracked_git_diff_preview(repository_path, &path) {
            previews.insert(key, preview);
        }
    }

    previews
}

fn parse_tracked_git_diff_previews(output: &str) -> HashMap<String, GitDiffPreview> {
    let mut previews = HashMap::<String, GitDiffPreview>::new();
    let mut current_key: Option<String> = None;
    let mut pending_old_path: Option<String> = None;
    let mut old_line = 0usize;
    let mut new_line = 0usize;

    for line in output.lines() {
        if line.starts_with("diff --git ") {
            if previews.len() >= MAX_GIT_DIFF_PREVIEW_FILES {
                break;
            }

            current_key = None;
            pending_old_path = None;
            old_line = 0;
            new_line = 0;
            continue;
        }

        if let Some(raw_path) = line.strip_prefix("--- ") {
            pending_old_path = parse_git_diff_marker_path(raw_path);
            continue;
        }

        if let Some(raw_path) = line.strip_prefix("+++ ") {
            let path = parse_git_diff_marker_path(raw_path).or_else(|| pending_old_path.clone());

            if let Some(path) = path {
                let key = git_status_path_key(&path);
                previews
                    .entry(key.clone())
                    .or_insert_with(|| GitDiffPreview {
                        lines: Vec::new(),
                        truncated: false,
                    });
                current_key = Some(key);
            }

            continue;
        }

        let Some(key) = current_key.as_ref() else {
            continue;
        };

        if line.starts_with("@@") {
            if let Some((next_old_line, next_new_line)) = parse_git_diff_hunk_header(line) {
                old_line = next_old_line;
                new_line = next_new_line;
            }

            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(line),
                    kind: "hunk".to_string(),
                    new_line: None,
                    old_line: None,
                },
            );
            continue;
        }

        if line.starts_with("\\ ") {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(line),
                    kind: "meta".to_string(),
                    new_line: None,
                    old_line: None,
                },
            );
            continue;
        }

        if let Some(content) = line.strip_prefix('+') {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(content),
                    kind: "add".to_string(),
                    new_line: Some(new_line),
                    old_line: None,
                },
            );
            new_line = new_line.saturating_add(1);
            continue;
        }

        if let Some(content) = line.strip_prefix('-') {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(content),
                    kind: "remove".to_string(),
                    new_line: None,
                    old_line: Some(old_line),
                },
            );
            old_line = old_line.saturating_add(1);
            continue;
        }

        if let Some(content) = line.strip_prefix(' ') {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(content),
                    kind: "context".to_string(),
                    new_line: Some(new_line),
                    old_line: Some(old_line),
                },
            );
            old_line = old_line.saturating_add(1);
            new_line = new_line.saturating_add(1);
        }
    }

    previews
}

fn create_untracked_git_diff_preview(
    repository_path: &Path,
    relative_path: &str,
) -> Option<GitDiffPreview> {
    let path = repository_path.join(relative_path);
    let metadata = fs::metadata(&path).ok()?;

    if !metadata.is_file() || metadata.len() > MAX_GIT_UNTRACKED_DIFF_BYTES {
        return None;
    }

    let bytes = fs::read(&path).ok()?;

    if bytes.is_empty() || bytes.contains(&0) {
        return None;
    }

    let text = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    let mut truncated = false;

    for (index, line) in text.lines().enumerate() {
        if lines.len() >= MAX_GIT_DIFF_PREVIEW_LINES_PER_FILE {
            truncated = true;
            break;
        }

        lines.push(ComputerGitDiffLine {
            content: truncate_git_diff_line(line),
            kind: "add".to_string(),
            new_line: Some(index + 1),
            old_line: None,
        });
    }

    if lines.is_empty() {
        None
    } else {
        Some(GitDiffPreview { lines, truncated })
    }
}

fn push_git_diff_preview_line(
    previews: &mut HashMap<String, GitDiffPreview>,
    key: &str,
    line: ComputerGitDiffLine,
) {
    let Some(preview) = previews.get_mut(key) else {
        return;
    };

    if preview.lines.len() >= MAX_GIT_DIFF_PREVIEW_LINES_PER_FILE {
        preview.truncated = true;
        return;
    }

    preview.lines.push(line);
}

fn parse_git_diff_marker_path(raw_path: &str) -> Option<String> {
    let cleaned = clean_git_path(raw_path);

    if cleaned == "/dev/null" {
        return None;
    }

    if let Some(path) = cleaned.strip_prefix("a/") {
        Some(path.to_string())
    } else if let Some(path) = cleaned.strip_prefix("b/") {
        Some(path.to_string())
    } else {
        Some(cleaned)
    }
}

fn parse_git_diff_hunk_header(line: &str) -> Option<(usize, usize)> {
    let mut parts = line.split_whitespace();
    parts.next()?;
    let old_part = parts.next()?;
    let new_part = parts.next()?;

    Some((
        parse_git_diff_hunk_start(old_part)?,
        parse_git_diff_hunk_start(new_part)?,
    ))
}

fn parse_git_diff_hunk_start(part: &str) -> Option<usize> {
    part.trim_start_matches(['-', '+'])
        .split(',')
        .next()?
        .parse::<usize>()
        .ok()
}

fn truncate_git_diff_line(line: &str) -> String {
    if line.chars().count() <= MAX_GIT_DIFF_PREVIEW_LINE_CHARS {
        return line.to_string();
    }

    let mut truncated = line
        .chars()
        .take(MAX_GIT_DIFF_PREVIEW_LINE_CHARS)
        .collect::<String>();
    truncated.push_str("...");
    truncated
}

fn parse_git_numstat_entries(output: &str) -> Vec<(String, usize, usize)> {
    output
        .lines()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let additions = columns.next()?.parse::<usize>().unwrap_or(0);
            let deletions = columns.next()?.parse::<usize>().unwrap_or(0);
            let path = columns.next()?.trim();

            if path.is_empty() {
                None
            } else {
                Some((clean_git_path(path), additions, deletions))
            }
        })
        .collect()
}

fn count_untracked_git_additions_by_path(
    repository_path: &Path,
    output: &str,
) -> HashMap<String, usize> {
    output
        .split('\0')
        .filter(|path| !path.trim().is_empty())
        .map(|path| {
            (
                git_status_path_key(path),
                count_text_file_lines(&repository_path.join(path)),
            )
        })
        .collect()
}

fn parse_git_changed_files(
    status_output: &str,
    tracked_stats: &[(String, usize, usize)],
    untracked_additions_by_path: &HashMap<String, usize>,
    diff_previews: &HashMap<String, GitDiffPreview>,
) -> Vec<ComputerGitChangedFile> {
    let tracked_stats_by_path = tracked_stats
        .iter()
        .map(|(path, additions, deletions)| (git_status_path_key(path), (*additions, *deletions)))
        .collect::<HashMap<_, _>>();

    status_output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_end();

            if trimmed.len() < 4 {
                return None;
            }

            let status_code = trimmed.get(0..2)?;
            let untracked = status_code == "??";
            let staged = !untracked
                && status_code
                    .as_bytes()
                    .first()
                    .is_some_and(|value| *value != b' ');
            let unstaged = untracked
                || status_code
                    .as_bytes()
                    .get(1)
                    .is_some_and(|value| *value != b' ');
            let status = status_code.trim().to_string();
            let raw_path = trimmed.get(3..)?.trim();
            let (old_path, path) = split_git_status_path(raw_path);
            let key = git_status_path_key(&path);
            let (additions, deletions) = if status == "??" {
                (*untracked_additions_by_path.get(&key).unwrap_or(&0), 0)
            } else {
                tracked_stats_by_path.get(&key).copied().unwrap_or((0, 0))
            };
            let diff_preview = diff_previews.get(&key);

            Some(ComputerGitChangedFile {
                additions,
                deletions,
                diff_preview: diff_preview.map(|preview| preview.lines.clone()),
                diff_truncated: diff_preview
                    .map(|preview| preview.truncated)
                    .unwrap_or(false),
                old_path,
                path,
                staged,
                status,
                unstaged,
                untracked,
            })
        })
        .collect()
}

#[derive(Default)]
struct GitStatusEntrySummary {
    changed_files: usize,
    staged_files: usize,
    unstaged_files: usize,
    untracked_files: usize,
}

fn summarize_git_status_entries(status_output: &str) -> GitStatusEntrySummary {
    let mut summary = GitStatusEntrySummary::default();

    for line in status_output.lines() {
        let trimmed = line.trim_end();

        if trimmed.len() < 2 {
            continue;
        }

        let Some(status_code) = trimmed.get(0..2) else {
            continue;
        };
        let untracked = status_code == "??";
        let staged = !untracked
            && status_code
                .as_bytes()
                .first()
                .is_some_and(|value| *value != b' ');
        let unstaged = untracked
            || status_code
                .as_bytes()
                .get(1)
                .is_some_and(|value| *value != b' ');

        summary.changed_files += 1;

        if staged {
            summary.staged_files += 1;
        }

        if unstaged {
            summary.unstaged_files += 1;
        }

        if untracked {
            summary.untracked_files += 1;
        }
    }

    summary
}

fn split_git_status_path(raw_path: &str) -> (Option<String>, String) {
    if let Some((old_path, path)) = raw_path.split_once(" -> ") {
        return (Some(clean_git_path(old_path)), clean_git_path(path));
    }

    (None, clean_git_path(raw_path))
}

fn clean_git_path(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

fn git_status_path_key(path: &str) -> String {
    clean_git_path(path).replace('\\', "/")
}

fn count_text_file_lines(path: &Path) -> usize {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };

    if !metadata.is_file() || metadata.len() > MAX_GIT_UNTRACKED_DIFF_BYTES {
        return 0;
    }

    let Ok(bytes) = fs::read(path) else {
        return 0;
    };

    if bytes.is_empty() || bytes.contains(&0) {
        return 0;
    }

    let newline_count = bytes.iter().filter(|byte| **byte == b'\n').count();

    if bytes.ends_with(b"\n") {
        newline_count
    } else {
        newline_count + 1
    }
}

fn parse_github_remote_url(remote_url: &str) -> Option<(Option<String>, Option<String>)> {
    let trimmed = remote_url.trim().trim_end_matches(".git");
    let path = if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        rest
    } else {
        trimmed.strip_prefix("ssh://git@github.com/")?
    };
    let mut parts = path.split('/');
    let owner = parts
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let repo = parts
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if owner.is_none() || repo.is_none() {
        return None;
    }

    Some((owner, repo))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_index_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root = std::env::temp_dir().join(format!(
            "gilbertcodex-file-index-{}-{}-{}",
            label,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&root).expect("create temp index root");
        root
    }

    fn init_test_repository(label: &str) -> PathBuf {
        let root = temp_index_root(label);

        run_git(&root, &["init"]).expect("initialize test repository");
        run_git(&root, &["checkout", "-b", "main"]).expect("create main branch");
        configure_test_git_identity(&root);
        root
    }

    fn configure_test_git_identity(repository_path: &Path) {
        run_git(repository_path, &["config", "user.name", "Gilbert Test"])
            .expect("set test git user name");
        run_git(
            repository_path,
            &["config", "user.email", "gilbert-test@example.com"],
        )
        .expect("set test git user email");
        run_git(repository_path, &["config", "core.autocrlf", "false"])
            .expect("disable test git line ending conversion");
    }

    fn commit_test_file(repository_path: &Path, path: &str, content: &str, message: &str) {
        let file_path = repository_path.join(path);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("create test file parent");
        }

        fs::write(&file_path, content).expect("write test file");
        run_git(repository_path, &["add", path]).expect("stage test file");
        run_git(repository_path, &["commit", "-m", message]).expect("commit test file");
    }

    fn create_test_remote(label: &str) -> PathBuf {
        let remote = temp_index_root(label);

        run_git(&remote, &["init", "--bare"]).expect("initialize bare test remote");
        remote
    }

    fn attach_test_origin(repository_path: &Path, remote_path: &Path) {
        let remote = path_to_string(remote_path);

        run_git(repository_path, &["remote", "add", "origin", &remote]).expect("add test origin");
    }

    #[test]
    fn file_index_skips_secret_generated_entries_without_gitignore() {
        assert!(should_skip_index_entry(
            Path::new(".env.local"),
            ".env.local",
            &ComputerFileKind::File,
            &[]
        ));
        assert!(should_skip_index_entry(
            Path::new("workspace.sqlite3"),
            "workspace.sqlite3",
            &ComputerFileKind::File,
            &[]
        ));
        assert!(should_skip_index_entry(
            Path::new(".tools"),
            ".tools",
            &ComputerFileKind::Directory,
            &[]
        ));
        assert!(!should_skip_index_entry(
            Path::new("src/main.rs"),
            "main.rs",
            &ComputerFileKind::File,
            &[]
        ));
    }

    #[test]
    fn file_index_gitignore_rules_match_common_patterns() {
        let base = temp_index_root("gitignore-rules");
        let rules = parse_gitignore_rules_from_text(
            &base,
            "ignored-dir/\n*.cache\n!/keep.cache\n/secrets.json\nlogs/*.log\n",
        );

        assert!(is_ignored_by_gitignore_rules(
            &base.join("src").join("ignored-dir"),
            &ComputerFileKind::Directory,
            &rules
        ));
        assert!(is_ignored_by_gitignore_rules(
            &base.join("nested").join("data.cache"),
            &ComputerFileKind::File,
            &rules
        ));
        assert!(!is_ignored_by_gitignore_rules(
            &base.join("keep.cache"),
            &ComputerFileKind::File,
            &rules
        ));
        assert!(is_ignored_by_gitignore_rules(
            &base.join("secrets.json"),
            &ComputerFileKind::File,
            &rules
        ));
        assert!(!is_ignored_by_gitignore_rules(
            &base.join("src").join("secrets.json"),
            &ComputerFileKind::File,
            &rules
        ));
        assert!(is_ignored_by_gitignore_rules(
            &base.join("logs").join("dev.log"),
            &ComputerFileKind::File,
            &rules
        ));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn file_index_reads_gitignore_from_each_directory() {
        let base = temp_index_root("read-gitignore");
        fs::write(base.join(".gitignore"), "ignored-root.txt\n").expect("write root gitignore");
        let nested = base.join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");
        fs::write(nested.join(".gitignore"), "ignored-nested.txt\n")
            .expect("write nested gitignore");

        let root_rules = read_gitignore_rules(&base);
        let nested_rules = read_gitignore_rules(&nested);

        assert!(is_ignored_by_gitignore_rules(
            &base.join("ignored-root.txt"),
            &ComputerFileKind::File,
            &root_rules
        ));
        assert!(is_ignored_by_gitignore_rules(
            &nested.join("ignored-nested.txt"),
            &ComputerFileKind::File,
            &nested_rules
        ));
        assert!(!is_ignored_by_gitignore_rules(
            &base.join("kept.txt"),
            &ComputerFileKind::File,
            &root_rules
        ));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn write_text_file_creates_missing_parent_dirs_by_default() {
        let base = temp_index_root("write-parents");
        let path = base.join("hello").join("src").join("App.jsx");

        let result = computer_write_text_file_blocking(ComputerWriteFileRequest {
            content: "export default function App() {\n  return null;\n}\n".to_string(),
            create_parent_dirs: None,
            expected_sha256: None,
            force_eol: Some("lf".to_string()),
            overwrite: None,
            path: path_to_string(&path),
            roots: vec![path_to_string(&base)],
        })
        .expect("write nested file");

        assert!(result.created);
        assert_eq!(path_to_string(&path), result.path);
        assert_eq!(
            fs::read_to_string(&path).expect("read written file"),
            "export default function App() {\n  return null;\n}\n"
        );

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn write_text_file_can_still_refuse_missing_parent_dirs() {
        let base = temp_index_root("write-no-parents");
        let path = base.join("hello").join("src").join("App.jsx");

        let error = computer_write_text_file_blocking(ComputerWriteFileRequest {
            content: "export default null;\n".to_string(),
            create_parent_dirs: Some(false),
            expected_sha256: None,
            force_eol: Some("lf".to_string()),
            overwrite: None,
            path: path_to_string(&path),
            roots: vec![path_to_string(&base)],
        })
        .expect_err("missing parent folders should be refused when explicitly disabled");

        assert!(error.contains("Parent folder does not exist"));
        assert!(!path.exists());

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn create_directory_creates_nested_workspace_folder() {
        let base = temp_index_root("create-directory");
        let path = base.join("src").join("features").join("chat");

        let result = computer_create_directory_blocking(ComputerCreateDirectoryRequest {
            path: path_to_string(&path),
            recursive: None,
            roots: vec![path_to_string(&base)],
        })
        .expect("create nested folder");

        assert!(result.created);
        assert_eq!(path_to_string(&path), result.path);
        assert!(path.is_dir());

        let second = computer_create_directory_blocking(ComputerCreateDirectoryRequest {
            path: path_to_string(&path),
            recursive: None,
            roots: vec![path_to_string(&base)],
        })
        .expect("existing folder should be okay");

        assert!(!second.created);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn write_text_files_reports_per_file_results() {
        let base = temp_index_root("write-many");
        let first = base.join("src").join("a.ts");
        let second = base.join("src").join("b.ts");
        let result = computer_write_text_files_blocking(ComputerWriteFilesRequest {
            files: vec![
                ComputerWriteFilesItemRequest {
                    content: "export const a = 1;\n".to_string(),
                    create_parent_dirs: None,
                    expected_sha256: None,
                    force_eol: Some("lf".to_string()),
                    overwrite: None,
                    path: path_to_string(&first),
                },
                ComputerWriteFilesItemRequest {
                    content: "export const b = 2;\n".to_string(),
                    create_parent_dirs: None,
                    expected_sha256: None,
                    force_eol: Some("lf".to_string()),
                    overwrite: None,
                    path: path_to_string(&second),
                },
            ],
            roots: vec![path_to_string(&base)],
        })
        .expect("write batch");

        assert_eq!(result.files.len(), 2);
        assert!(result.files.iter().all(|file| file.ok));
        assert_eq!(
            fs::read_to_string(&first).expect("read first file"),
            "export const a = 1;\n"
        );
        assert_eq!(
            fs::read_to_string(&second).expect("read second file"),
            "export const b = 2;\n"
        );

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn write_text_file_rejects_expected_sha_for_missing_target() {
        let base = temp_index_root("write-missing-sha");
        let path = base.join("src").join("App.jsx");

        let error = computer_write_text_file_blocking(ComputerWriteFileRequest {
            content: "export default null;\n".to_string(),
            create_parent_dirs: None,
            expected_sha256: Some("deadbeef".to_string()),
            force_eol: Some("lf".to_string()),
            overwrite: None,
            path: path_to_string(&path),
            roots: vec![path_to_string(&base)],
        })
        .expect_err("missing target with expected hash should be refused");

        assert!(error.contains("expectedSha256 was provided"));
        assert!(!path.exists());

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn read_text_file_range_streams_requested_lines() {
        let base = temp_index_root("read-range");
        let path = base.join("src").join("App.jsx");
        fs::create_dir_all(path.parent().unwrap()).expect("create parent");
        fs::write(&path, "one\ntwo\nthree\nfour\n").expect("write file");

        let result = computer_read_text_file_range_blocking(ComputerReadFileRangeRequest {
            end_line: 3,
            path: path_to_string(&path),
            start_line: 2,
        })
        .expect("read line range");

        assert_eq!(result.content, "two\nthree");
        assert_eq!(result.start_line, 2);
        assert_eq!(result.end_line, 3);
        assert_eq!(result.total_lines, 4);
        assert!(result.truncated);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn count_text_file_lines_skips_large_untracked_files() {
        let base = temp_index_root("large-untracked-lines");
        let path = base.join("installer.exe");
        fs::write(
            &path,
            vec![b'a'; (MAX_GIT_UNTRACKED_DIFF_BYTES as usize).saturating_add(1)],
        )
        .expect("write large file");

        assert_eq!(count_text_file_lines(&path), 0);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn git_stage_blocking_stages_unstaged_changes() {
        let repository = init_test_repository("git-stage");
        commit_test_file(&repository, "app.txt", "one\n", "initial commit");
        fs::write(repository.join("app.txt"), "one\ntwo\n").expect("modify tracked file");

        let result = git_stage_blocking(ComputerGitStageRequest {
            path: path_to_string(&repository),
            paths: None,
        })
        .expect("stage changes");

        assert_eq!(result.message, "Staged 1 file.");
        assert_eq!(result.status.staged_files, 1);
        assert_eq!(result.status.unstaged_files, 0);
        assert_eq!(
            run_git(&repository, &["diff", "--cached", "--name-only"]).expect("read staged files"),
            "app.txt"
        );

        let _ = fs::remove_dir_all(repository);
    }

    #[test]
    fn git_push_blocking_refuses_uncommitted_only_changes() {
        let repository = init_test_repository("git-push-uncommitted");
        let remote = create_test_remote("git-push-uncommitted-remote");
        commit_test_file(&repository, "app.txt", "one\n", "initial commit");
        attach_test_origin(&repository, &remote);

        git_push_blocking(ComputerGitPushRequest {
            path: path_to_string(&repository),
            remote: None,
        })
        .expect("push initial commit");
        fs::write(repository.join("app.txt"), "one\ntwo\n").expect("modify tracked file");

        let error = git_push_blocking(ComputerGitPushRequest {
            path: path_to_string(&repository),
            remote: None,
        })
        .expect_err("uncommitted-only changes should not be reported as pushed");

        assert!(error.contains("No commits to push"));

        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_dir_all(remote);
    }

    #[test]
    fn git_push_blocking_verifies_remote_head_after_push() {
        let repository = init_test_repository("git-push-verify");
        let remote = create_test_remote("git-push-verify-remote");
        commit_test_file(&repository, "app.txt", "one\n", "initial commit");
        attach_test_origin(&repository, &remote);

        git_push_blocking(ComputerGitPushRequest {
            path: path_to_string(&repository),
            remote: None,
        })
        .expect("push initial commit");
        commit_test_file(&repository, "app.txt", "one\ntwo\n", "second commit");

        let result = git_push_blocking(ComputerGitPushRequest {
            path: path_to_string(&repository),
            remote: None,
        })
        .expect("push second commit");
        let local_head = git_head_sha(&repository).expect("read local head");
        let remote_head = git_remote_head_sha(&repository, "origin", "main")
            .expect("read remote head")
            .expect("remote main exists");

        assert_eq!(result.message, "Pushed main to origin/main.");
        assert_eq!(local_head, remote_head);
        assert_eq!(result.status.ahead, 0);

        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_dir_all(remote);
    }

    #[test]
    fn git_pull_blocking_reports_fast_forward_updates() {
        let repository = init_test_repository("git-pull-local");
        let remote = create_test_remote("git-pull-remote");
        commit_test_file(&repository, "app.txt", "one\n", "initial commit");
        attach_test_origin(&repository, &remote);
        git_push_blocking(ComputerGitPushRequest {
            path: path_to_string(&repository),
            remote: None,
        })
        .expect("push initial commit");
        run_git(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"])
            .expect("point bare remote head at main");

        let clone_parent = temp_index_root("git-pull-clone-parent");
        let remote_path = path_to_string(&remote);
        run_git(&clone_parent, &["clone", &remote_path, "peer"]).expect("clone peer repo");
        let peer = clone_parent.join("peer");
        configure_test_git_identity(&peer);
        commit_test_file(&peer, "app.txt", "one\ntwo\n", "remote update");
        run_git(&peer, &["push"]).expect("push peer update");

        let result = git_pull_blocking(ComputerGitPullRequest {
            branch: None,
            path: path_to_string(&repository),
            remote: None,
        })
        .expect("pull remote update");

        assert_eq!(result.message, "Pulled current branch.");
        assert_eq!(
            fs::read_to_string(repository.join("app.txt")).expect("read pulled file"),
            "one\ntwo\n"
        );
        assert_eq!(result.status.behind, 0);

        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_dir_all(remote);
        let _ = fs::remove_dir_all(clone_parent);
    }

    #[test]
    fn text_search_streams_literal_matches_with_context_and_skips_generated_dirs() {
        let base = temp_index_root("native-search");
        let src = base.join("src");
        let generated = base.join("node_modules");
        fs::create_dir_all(&src).expect("create src");
        fs::create_dir_all(&generated).expect("create generated");
        fs::write(src.join("app.ts"), "before\nconst needle = true;\nafter\n")
            .expect("write source");
        fs::write(generated.join("ignored.ts"), "needle\n").expect("write generated");

        let result = computer_search_text_files_blocking(ComputerTextSearchRequest {
            case_sensitive: None,
            context_lines: Some(1),
            exclude_directories: None,
            extensions: Some(vec!["ts".to_string()]),
            globs: None,
            include_content: None,
            include_generated: None,
            include_path: None,
            max_matches: None,
            max_matches_per_file: None,
            path: path_to_string(&base),
            query: "needle".to_string(),
            regex: None,
        })
        .expect("search text");

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.skipped_directories, 1);
        assert_eq!(result.total_content_matches, 1);
        let search_match = &result.matches[0].content_matches[0];
        assert_eq!(search_match.line, 2);
        assert_eq!(search_match.before.as_ref().unwrap()[0].preview, "before");
        assert_eq!(search_match.after.as_ref().unwrap()[0].preview, "after");

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn text_search_supports_regex_without_renderer_fallback() {
        let base = temp_index_root("native-regex-search");
        let src = base.join("src");
        fs::create_dir_all(&src).expect("create src");
        fs::write(
            src.join("danger.rs"),
            "Command::new(\"git\");\nfs::remove_file(path)?;\nlet safe = true;\n",
        )
        .expect("write source");

        let result = computer_search_text_files_blocking(ComputerTextSearchRequest {
            case_sensitive: None,
            context_lines: None,
            exclude_directories: None,
            extensions: Some(vec!["rs".to_string()]),
            globs: None,
            include_content: None,
            include_generated: None,
            include_path: None,
            max_matches: None,
            max_matches_per_file: None,
            path: path_to_string(&base),
            query: r"Command::new|fs::remove".to_string(),
            regex: Some(true),
        })
        .expect("regex search");

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.total_content_matches, 2);
        assert_eq!(result.matches[0].content_matches[0].line, 1);
        assert_eq!(result.matches[0].content_matches[1].line, 2);

        let _ = fs::remove_dir_all(base);
    }
}
