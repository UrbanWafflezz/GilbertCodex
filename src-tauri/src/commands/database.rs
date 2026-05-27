use crate::{
    commands::auth,
    core::{
        fs_utils::path_to_string,
        storage::{self, DeviceStorageSeed, DeviceStorageSnapshot},
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageCleanupResponse {
    removed_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseOverviewResponse {
    database_path: String,
    exists: bool,
    file_size_bytes: u64,
    last_modified: Option<u64>,
    record_count: usize,
    namespace_count: usize,
    categories: Vec<DatabaseStorageCategory>,
    records: Vec<DatabaseStorageRecord>,
    context: DatabaseContextSummary,
    engine: DatabaseEngineSummary,
    migration: DatabaseMigrationSummary,
    legacy_storage: LegacyStorageSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStorageCategory {
    id: String,
    label: String,
    description: String,
    record_count: usize,
    storage_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStorageRecord {
    namespace: String,
    key: String,
    label: String,
    category: String,
    size_bytes: u64,
    updated_at: u64,
    summary: String,
    sensitive: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseContextSummary {
    chat_count: u64,
    message_count: u64,
    user_message_count: u64,
    assistant_message_count: u64,
    source_count: u64,
    image_count: u64,
    file_attachment_count: u64,
    tool_call_count: u64,
    approval_count: u64,
    artifact_count: u64,
    thinking_bytes: u64,
    reasoning_bytes: u64,
    content_bytes: u64,
    estimated_tokens: u64,
    context_compaction_count: u64,
    agent_run_count: u64,
    agent_run_step_count: u64,
    agent_run_event_count: u64,
    largest_chat_title: Option<String>,
    largest_chat_bytes: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseEngineSummary {
    schema_version: String,
    journal_mode: String,
    synchronous: String,
    wal_autocheckpoint: u64,
    quick_check: String,
    page_size_bytes: u64,
    page_count: u64,
    freelist_count: u64,
    free_bytes: u64,
    wal_size_bytes: u64,
    shm_size_bytes: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMigrationSummary {
    target_schema_version: String,
    current_schema_version: String,
    status: String,
    typed_chat_count: u64,
    typed_message_count: u64,
    typed_agent_run_count: u64,
    typed_agent_run_event_count: u64,
    typed_memory_chunk_count: u64,
    binary_vector_count: u64,
    legacy_agent_run_blob_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageSummary {
    total_bytes: u64,
    files: Vec<LegacyStorageEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageEntry {
    path: String,
    exists: bool,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseResetResponse {
    removed_paths: Vec<String>,
    failed_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupResponse {
    backup_path: String,
    file_size_bytes: u64,
    created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMigrationFinalizeResponse {
    backup: DatabaseBackupResponse,
    removed_storage_keys: Vec<String>,
    removed_legacy_paths: Vec<String>,
    failed_legacy_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAutoMigrationFinalizeResponse {
    already_finalized: bool,
    backup: Option<DatabaseBackupResponse>,
    removed_storage_keys: Vec<String>,
    removed_legacy_paths: Vec<String>,
    failed_legacy_paths: Vec<String>,
}

struct StoredDatabaseRecord {
    namespace: String,
    key: String,
    value: String,
    updated_at: u64,
}

async fn run_database_worker<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{label} worker stopped unexpectedly: {error}"))?
}

struct CategoryDefinition {
    id: &'static str,
    label: &'static str,
    description: &'static str,
}

#[tauri::command]
pub async fn gilbert_database_load(
    app: AppHandle,
    namespace: String,
    seeds: Vec<DeviceStorageSeed>,
) -> Result<DeviceStorageSnapshot, String> {
    run_database_worker("Database load", move || {
        let namespace = require_active_namespace(&app, &namespace)?;
        storage::load_namespace(&app, &namespace, &seeds)
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_load_chat(
    app: AppHandle,
    namespace: String,
    chat_id: String,
) -> Result<Option<String>, String> {
    run_database_worker("Database chat load", move || {
        let namespace = require_active_namespace(&app, &namespace)?;
        storage::load_chat(&app, &namespace, &chat_id)
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_set_value(
    app: AppHandle,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    run_database_worker("Database write", move || {
        let namespace = require_active_namespace(&app, &namespace)?;
        storage::write_value(&app, &namespace, &key, &value)
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_set_values(
    app: AppHandle,
    namespace: String,
    values: Vec<DeviceStorageSeed>,
) -> Result<(), String> {
    run_database_worker("Database batch write", move || {
        let namespace = require_active_namespace(&app, &namespace)?;
        storage::write_values(&app, &namespace, &values)
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_cleanup_legacy_storage(
    app: AppHandle,
) -> Result<LegacyStorageCleanupResponse, String> {
    run_database_worker("Database legacy cleanup", move || {
        let (removed_paths, failed_paths) = cleanup_paths(&legacy_storage_paths(&app)?);
        if let Some(error) = failed_paths.first() {
            return Err(error.clone());
        }

        Ok(LegacyStorageCleanupResponse { removed_paths })
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_get_overview(
    app: AppHandle,
) -> Result<DatabaseOverviewResponse, String> {
    run_database_worker("Database overview", move || {
        let active_namespace = auth::current_user_storage_namespace(&app)?;
        let database_path = storage::database_path(&app)
            .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
        let exists = database_path.exists();
        if exists {
            storage::with_database_connection(&app, |_| Ok(()))?;
        }
        let metadata = fs::metadata(&database_path).ok();
        let file_size_bytes = metadata
            .as_ref()
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let last_modified = metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64);

        let stored_records = if exists {
            read_database_records(&database_path, &active_namespace)?
        } else {
            Vec::new()
        };

        let mut categories = Vec::new();
        let mut context = DatabaseContextSummary::default();
        let mut namespaces = BTreeSet::new();
        let mut records = Vec::new();

        for record in stored_records {
            namespaces.insert(record.namespace.clone());
            add_record_context(&record.key, &record.value, &mut context);

            let definition = category_for_key(&record.key);
            let size_bytes = record.value.len() as u64;
            add_category_usage(&mut categories, &definition, size_bytes);

            records.push(DatabaseStorageRecord {
                namespace: record.namespace,
                key: record.key.clone(),
                label: label_for_key(&record.key).to_string(),
                category: definition.id.to_string(),
                size_bytes,
                updated_at: record.updated_at,
                summary: summarize_record(&record.key, &record.value),
                sensitive: is_sensitive_key(&record.key),
            });
        }

        context.estimated_tokens =
            ((context.content_bytes + context.reasoning_bytes + context.thinking_bytes) as f64
                / 4.0)
                .ceil() as u64;

        let engine = inspect_database_engine(&database_path).unwrap_or_default();
        let migration =
            inspect_database_migration(&database_path, &active_namespace).unwrap_or_default();
        let legacy_storage = inspect_legacy_storage(&app)?;

        Ok(DatabaseOverviewResponse {
            database_path: path_to_string(&database_path),
            exists,
            file_size_bytes,
            last_modified,
            record_count: records.len(),
            namespace_count: namespaces.len(),
            categories,
            records,
            context,
            engine,
            migration,
            legacy_storage,
        })
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_backup(app: AppHandle) -> Result<DatabaseBackupResponse, String> {
    run_database_worker("Database backup", move || create_database_backup(&app)).await
}

#[tauri::command]
pub async fn gilbert_database_finalize_migration(
    app: AppHandle,
) -> Result<DatabaseMigrationFinalizeResponse, String> {
    run_database_worker("Database migration finalizer", move || {
        let backup = create_database_backup_with_label(&app, "secure-v3")?;
        let removed_storage_keys = storage::finalize_schema_v3_migration(&app)?;
        let (removed_legacy_paths, failed_legacy_paths) =
            cleanup_paths(&safe_legacy_replacement_paths(&app)?);

        if failed_legacy_paths.is_empty() {
            storage::mark_schema_v3_auto_finalized(&app)?;
        }

        Ok(DatabaseMigrationFinalizeResponse {
            backup,
            removed_storage_keys,
            removed_legacy_paths,
            failed_legacy_paths,
        })
    })
    .await
}

#[tauri::command]
pub async fn gilbert_database_auto_finalize_migration(
    app: AppHandle,
) -> Result<DatabaseAutoMigrationFinalizeResponse, String> {
    run_database_worker("Database migration finalizer", move || {
        let database_path = storage::database_path(&app)
            .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
        if !database_path.exists() {
            return Ok(DatabaseAutoMigrationFinalizeResponse {
                already_finalized: true,
                backup: None,
                removed_storage_keys: Vec::new(),
                removed_legacy_paths: Vec::new(),
                failed_legacy_paths: Vec::new(),
            });
        }

        let legacy_paths = safe_legacy_replacement_paths(&app)?;
        let has_legacy_paths = legacy_paths.iter().any(|path| path.exists());
        let auto_finalized = storage::schema_v3_auto_finalized(&app)?;
        let has_legacy_hot_storage = storage::schema_v3_has_legacy_hot_storage(&app)?;

        if auto_finalized && !has_legacy_paths && !has_legacy_hot_storage {
            return Ok(DatabaseAutoMigrationFinalizeResponse {
                already_finalized: true,
                backup: None,
                removed_storage_keys: Vec::new(),
                removed_legacy_paths: Vec::new(),
                failed_legacy_paths: Vec::new(),
            });
        }

        let backup = Some(create_database_backup_with_label(&app, "auto-v3")?);
        let removed_storage_keys = storage::finalize_schema_v3_migration(&app)?;
        let (removed_legacy_paths, failed_legacy_paths) = cleanup_paths(&legacy_paths);

        if failed_legacy_paths.is_empty() {
            storage::mark_schema_v3_auto_finalized(&app)?;
        }

        Ok(DatabaseAutoMigrationFinalizeResponse {
            already_finalized: false,
            backup,
            removed_storage_keys,
            removed_legacy_paths,
            failed_legacy_paths,
        })
    })
    .await
}

fn create_database_backup(app: &AppHandle) -> Result<DatabaseBackupResponse, String> {
    create_database_backup_with_label(app, "backup")
}

fn create_database_backup_with_label(
    app: &AppHandle,
    label: &str,
) -> Result<DatabaseBackupResponse, String> {
    let database_path = storage::database_path(app)
        .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
    if !database_path.exists() {
        return Err("Gilbert Database has not been created yet.".to_string());
    }

    let backup_dir = database_path
        .parent()
        .ok_or_else(|| "Could not resolve the database backup folder.".to_string())?
        .join("backups");
    fs::create_dir_all(&backup_dir).map_err(|error| {
        format!(
            "Could not create database backup folder at {}: {error}",
            path_to_string(&backup_dir)
        )
    })?;

    let created_at = current_time_millis();
    let backup_path = backup_dir.join(format!("Gilbert Database {label} {created_at}.sqlite3"));
    let backup_path_text = path_to_string(&backup_path);

    storage::with_database_connection(app, |connection| {
        connection
            .execute("VACUUM main INTO ?1", params![backup_path_text])
            .map(|_| ())
            .map_err(|error| format!("Could not create WAL-safe database backup: {error}"))
    })?;

    let file_size_bytes = fs::metadata(&backup_path)
        .map(|metadata| metadata.len())
        .map_err(|error| {
            format!(
                "Could not inspect database backup at {}: {error}",
                path_to_string(&backup_path)
            )
        })?;

    Ok(DatabaseBackupResponse {
        backup_path: path_to_string(&backup_path),
        file_size_bytes,
        created_at,
    })
}

#[tauri::command]
pub async fn gilbert_database_reset(app: AppHandle) -> Result<DatabaseResetResponse, String> {
    run_database_worker("Database reset", move || {
        let database_path = storage::database_path(&app)
            .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
        let mut removed_paths = Vec::new();
        let mut failed_paths = Vec::new();

        for path in storage::database_file_family(&database_path) {
            if delete_path(&path)? {
                removed_paths.push(path_to_string(&path));
            }
        }

        for path in legacy_storage_paths(&app)? {
            match delete_path(&path) {
                Ok(true) => removed_paths.push(path_to_string(&path)),
                Ok(false) => {}
                Err(error) => failed_paths.push(error),
            }
        }

        Ok(DatabaseResetResponse {
            removed_paths,
            failed_paths,
        })
    })
    .await
}

fn legacy_storage_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut paths = safe_legacy_replacement_paths(app)?;

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(local_app_data)
                .join("com.gilbert.codex")
                .join("EBWebView")
                .join("Default")
                .join("Local Storage"),
        );
    }

    Ok(paths)
}

fn safe_legacy_replacement_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the old app data folder: {error}"))?;
    let mut paths = storage::legacy_database_file_family(app)?;
    paths.extend([
        app_data.join("auth").join("local-auth-db.json"),
        app_data.join("agent-runs.json"),
        app_data.join("github").join("github-account.json"),
    ]);

    Ok(paths)
}

fn cleanup_paths(paths: &[PathBuf]) -> (Vec<String>, Vec<String>) {
    let mut removed_paths = Vec::new();
    let mut failed_paths = Vec::new();

    for path in paths {
        match delete_path(path) {
            Ok(true) => removed_paths.push(path_to_string(path)),
            Ok(false) => {}
            Err(error) => failed_paths.push(error),
        }
    }

    (removed_paths, failed_paths)
}

fn require_active_namespace(app: &AppHandle, requested_namespace: &str) -> Result<String, String> {
    let active_namespace = auth::current_user_storage_namespace(app)?;

    if requested_namespace.trim() != active_namespace {
        return Err(
            "Account-scoped database access is limited to the signed-in local user.".to_string(),
        );
    }

    Ok(active_namespace)
}

fn delete_path(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path_to_string(path)))?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Could not remove {}: {error}", path_to_string(path)))?;
    } else {
        fs::remove_file(path)
            .map_err(|error| format!("Could not remove {}: {error}", path_to_string(path)))?;
    }

    if let Some(parent) = path.parent() {
        let is_empty = fs::read_dir(parent)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);

        if is_empty {
            let _ = fs::remove_dir(parent);
        }
    }

    Ok(true)
}

fn read_database_records(
    database_path: &Path,
    namespace: &str,
) -> Result<Vec<StoredDatabaseRecord>, String> {
    let connection = Connection::open(database_path)
        .map_err(|error| format!("Could not open local database: {error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT namespace,
                    storage_key,
                    storage_value,
                    COALESCE(CAST(strftime('%s', updated_at) AS INTEGER) * 1000, 0) AS updated_at_ms \
             FROM app_storage WHERE namespace = ?1 ORDER BY storage_key",
        )
        .map_err(|error| format!("Could not read local database index: {error}"))?;
    let rows = statement
        .query_map([namespace], |row| {
            Ok(StoredDatabaseRecord {
                namespace: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                updated_at: row.get::<_, i64>(3)?.max(0) as u64,
            })
        })
        .map_err(|error| format!("Could not read local database rows: {error}"))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|error| format!("Could not decode local database row: {error}"))?);
    }

    Ok(records)
}

fn inspect_database_engine(database_path: &Path) -> Result<DatabaseEngineSummary, String> {
    if !database_path.exists() {
        return Ok(DatabaseEngineSummary::default());
    }

    let connection = Connection::open(database_path)
        .map_err(|error| format!("Could not open local database: {error}"))?;
    let schema_version = read_metadata_value(&connection, "schema_version")?.unwrap_or_default();
    let journal_mode = read_text_pragma(&connection, "journal_mode")?;
    let synchronous = read_integer_pragma(&connection, "synchronous")?.to_string();
    let wal_autocheckpoint = read_integer_pragma(&connection, "wal_autocheckpoint")?;
    let quick_check = read_text_pragma(&connection, "quick_check")?;
    let page_size_bytes = read_integer_pragma(&connection, "page_size")?;
    let page_count = read_integer_pragma(&connection, "page_count")?;
    let freelist_count = read_integer_pragma(&connection, "freelist_count")?;
    let free_bytes = page_size_bytes.saturating_mul(freelist_count);
    let path_text = path_to_string(database_path);
    let wal_size_bytes = fs::metadata(PathBuf::from(format!("{path_text}-wal")))
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let shm_size_bytes = fs::metadata(PathBuf::from(format!("{path_text}-shm")))
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    Ok(DatabaseEngineSummary {
        schema_version,
        journal_mode,
        synchronous,
        wal_autocheckpoint,
        quick_check,
        page_size_bytes,
        page_count,
        freelist_count,
        free_bytes,
        wal_size_bytes,
        shm_size_bytes,
    })
}

fn inspect_database_migration(
    database_path: &Path,
    namespace: &str,
) -> Result<DatabaseMigrationSummary, String> {
    if !database_path.exists() {
        return Ok(DatabaseMigrationSummary {
            target_schema_version: "3".to_string(),
            ..DatabaseMigrationSummary::default()
        });
    }

    let connection = Connection::open(database_path)
        .map_err(|error| format!("Could not open local database: {error}"))?;
    let current_schema_version = read_metadata_value(&connection, "schema_version")?
        .unwrap_or_else(|| "unknown".to_string());
    let typed_chat_count = count_table_rows(&connection, "chat_records", namespace)?;
    let typed_message_count = count_table_rows(&connection, "chat_messages", namespace)?;
    let typed_agent_run_count = count_table_rows(&connection, "agent_runs", namespace)?;
    let typed_agent_run_event_count = count_table_rows(&connection, "agent_run_events", namespace)?;
    let typed_memory_chunk_count = count_table_rows(&connection, "memory_chunks", namespace)?;
    let binary_vector_count = connection
        .query_row(
            "SELECT COUNT(*)
             FROM vector_embeddings
             WHERE namespace = ?1 AND vector_blob IS NOT NULL",
            params![namespace],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("Could not count binary vector rows: {error}"))?
        .unwrap_or(0)
        .max(0) as u64;
    let legacy_agent_run_blob_bytes = connection
        .query_row(
            "SELECT LENGTH(storage_value)
             FROM app_storage
             WHERE namespace = ?1 AND storage_key = 'agent-runs.v1'",
            params![namespace],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|error| format!("Could not inspect legacy agent run blob: {error}"))?
        .flatten()
        .unwrap_or(0)
        .max(0) as u64;
    let status = if current_schema_version == "3" {
        "schema-v3-ready"
    } else {
        "migration-pending"
    }
    .to_string();

    Ok(DatabaseMigrationSummary {
        target_schema_version: "3".to_string(),
        current_schema_version,
        status,
        typed_chat_count,
        typed_message_count,
        typed_agent_run_count,
        typed_agent_run_event_count,
        typed_memory_chunk_count,
        binary_vector_count,
        legacy_agent_run_blob_bytes,
    })
}

fn count_table_rows(connection: &Connection, table: &str, namespace: &str) -> Result<u64, String> {
    if !table_exists(connection, table)? {
        return Ok(0);
    }

    connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE namespace = ?1"),
            params![namespace],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(|error| format!("Could not count {table}: {error}"))
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(|error| format!("Could not inspect database table {table}: {error}"))
}

fn read_metadata_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    if !table_exists(connection, "database_metadata")? {
        return Ok(None);
    }

    connection
        .query_row(
            "SELECT value FROM database_metadata WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Could not read database metadata {key}: {error}"))
}

fn read_text_pragma(connection: &Connection, pragma: &str) -> Result<String, String> {
    connection
        .query_row(&format!("PRAGMA {pragma}"), [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("Could not read PRAGMA {pragma}: {error}"))
}

fn read_integer_pragma(connection: &Connection, pragma: &str) -> Result<u64, String> {
    connection
        .query_row(&format!("PRAGMA {pragma}"), [], |row| row.get::<_, i64>(0))
        .map(|value| value.max(0) as u64)
        .map_err(|error| format!("Could not read PRAGMA {pragma}: {error}"))
}

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn inspect_legacy_storage(app: &AppHandle) -> Result<LegacyStorageSummary, String> {
    let mut total_bytes = 0;
    let mut files = Vec::new();

    for path in legacy_storage_paths(app)? {
        let exists = path.exists();
        let size_bytes = if exists { path_size(&path)? } else { 0 };
        total_bytes += size_bytes;
        files.push(LegacyStorageEntry {
            path: path_to_string(&path),
            exists,
            size_bytes,
        });
    }

    Ok(LegacyStorageSummary { total_bytes, files })
}

fn path_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path_to_string(path)))?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }

    let mut total = 0;
    for entry in fs::read_dir(path)
        .map_err(|error| format!("Could not read {}: {error}", path_to_string(path)))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read {}: {error}", path_to_string(path)))?;
        total += path_size(&entry.path())?;
    }

    Ok(total)
}

fn category_for_key(key: &str) -> CategoryDefinition {
    match key {
        "gilbert-codex.chats.v1" => CategoryDefinition {
            id: "context",
            label: "Chats & context",
            description:
                "Saved conversations, sources, attachments, tool traces, and reasoning context.",
        },
        key if key.starts_with("gilbert-codex.project-tool-memory.v1.") => CategoryDefinition {
            id: "context",
            label: "Chats & context",
            description:
                "Saved conversations, sources, attachments, tool traces, and reasoning context.",
        },
        key if key.starts_with("gilbert-codex.chat-memory.v1.")
            || key.starts_with("gilbert-codex.project-memory.v1.") =>
        {
            CategoryDefinition {
                id: "context",
                label: "Chats & context",
                description:
                    "Saved conversations, sources, attachments, tool traces, reasoning summaries, memory indexes, and project maps.",
            }
        },
        "gilbert-codex.projects.v1" => CategoryDefinition {
            id: "projects",
            label: "Projects",
            description: "Project records and workspace organization.",
        },
        "local-auth-db.v1" => CategoryDefinition {
            id: "auth",
            label: "Auth",
            description: "Local authentication state stored only on this device.",
        },
        "agent-runs.v1" => CategoryDefinition {
            id: "agent-runs",
            label: "Agent runs",
            description: "Background run history, steps, events, and tool activity.",
        },
        "gilbert-codex.usage-history.v1" => CategoryDefinition {
            id: "usage",
            label: "Usage & costs",
            description: "Provider request history, token totals, and estimated cost rollups.",
        },
        "github-account.v1"
        | "gilbert-codex.discord-bridge.v1"
        | "gilbert-codex.github-oauth-client-id.v1" => CategoryDefinition {
            id: "integrations",
            label: "Integrations",
            description: "Connected service state and integration preferences.",
        },
        "gilbert-codex.provider-settings.v1"
        | "gilbert-codex.thinking.v1"
        | "gilbert-codex.tool-registry.v1"
        | "gilbert-codex.appearance.v1"
        | "gilbert-codex.local-workspace.v1"
        | "gilbert-codex.browser-preview-session.v1"
        | "gilbert-codex.active-chat.v1" => CategoryDefinition {
            id: "settings",
            label: "Settings",
            description: "Model, tool, appearance, workspace, and session preferences.",
        },
        _ => CategoryDefinition {
            id: "other",
            label: "Other",
            description: "Additional local app data.",
        },
    }
}

fn add_category_usage(
    categories: &mut Vec<DatabaseStorageCategory>,
    definition: &CategoryDefinition,
    bytes: u64,
) {
    if let Some(category) = categories
        .iter_mut()
        .find(|category| category.id == definition.id)
    {
        category.record_count += 1;
        category.storage_bytes += bytes;
        return;
    }

    categories.push(DatabaseStorageCategory {
        id: definition.id.to_string(),
        label: definition.label.to_string(),
        description: definition.description.to_string(),
        record_count: 1,
        storage_bytes: bytes,
    });
}

fn label_for_key(key: &str) -> &'static str {
    match key {
        "gilbert-codex.chats.v1" => "Saved chats",
        key if key.starts_with("gilbert-codex.project-tool-memory.v1.") => "Project tool memory",
        key if key.starts_with("gilbert-codex.chat-memory.v1.") => "Chat memory index",
        key if key.starts_with("gilbert-codex.project-memory.v1.") => "Project memory map",
        "gilbert-codex.projects.v1" => "Projects",
        "gilbert-codex.provider-settings.v1" => "Provider settings",
        "gilbert-codex.thinking.v1" => "Thinking settings",
        "gilbert-codex.tool-registry.v1" => "Tool registry",
        "gilbert-codex.appearance.v1" => "Appearance settings",
        "gilbert-codex.local-workspace.v1" => "Local workspace",
        "gilbert-codex.active-chat.v1" => "Active chat",
        "gilbert-codex.discord-bridge.v1" => "Discord bridge",
        "gilbert-codex.github-oauth-client-id.v1" => "GitHub OAuth client",
        "gilbert-codex.browser-preview-session.v1" => "Browser preview session",
        "local-auth-db.v1" => "Local auth",
        "agent-runs.v1" => "Agent runs",
        "gilbert-codex.usage-history.v1" => "Usage history",
        "github-account.v1" => "GitHub account",
        _ => "Local record",
    }
}

fn is_sensitive_key(key: &str) -> bool {
    matches!(
        key,
        "local-auth-db.v1"
            | "github-account.v1"
            | "gilbert-codex.provider-settings.v1"
            | "gilbert-codex.discord-bridge.v1"
    )
}

fn summarize_record(key: &str, raw: &str) -> String {
    if is_sensitive_key(key) {
        return "Stored locally; value hidden from the inspector.".to_string();
    }

    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return "Stored local value.".to_string();
    };

    match key {
        "gilbert-codex.chats.v1" => summarize_chat_record(&value),
        key if key.starts_with("gilbert-codex.project-tool-memory.v1.") => {
            summarize_project_tool_memory_record(&value)
        }
        key if key.starts_with("gilbert-codex.chat-memory.v1.")
            || key.starts_with("gilbert-codex.project-memory.v1.") =>
        {
            summarize_durable_memory_record(&value)
        }
        "gilbert-codex.projects.v1" => summarize_array_record(&value, "project", "projects"),
        "agent-runs.v1" => summarize_agent_record(&value),
        "gilbert-codex.usage-history.v1" => summarize_usage_history_record(&value),
        "gilbert-codex.tool-registry.v1" => summarize_tool_registry_record(&value),
        _ => summarize_json_record(&value),
    }
}

fn summarize_chat_record(value: &Value) -> String {
    let Some(chats) = value.as_array() else {
        return "Saved chat data.".to_string();
    };
    let message_count = chats
        .iter()
        .filter_map(|chat| chat.get("messages").and_then(Value::as_array))
        .map(|messages| messages.len())
        .sum::<usize>();
    format!(
        "{} {}, {} {}",
        chats.len(),
        plural("chat", "chats", chats.len()),
        message_count,
        plural("message", "messages", message_count)
    )
}

fn summarize_project_tool_memory_record(value: &Value) -> String {
    let entry_count = value
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| entries.len())
        .unwrap_or(0);

    if entry_count == 1 {
        "1 project tool lesson".to_string()
    } else {
        format!("{entry_count} project tool lessons")
    }
}

fn summarize_durable_memory_record(value: &Value) -> String {
    let event_count = value
        .get("events")
        .and_then(Value::as_array)
        .map(|events| events.len())
        .unwrap_or(0);
    let record_count = value
        .get("records")
        .and_then(Value::as_array)
        .map(|records| records.len())
        .unwrap_or(0);
    let known_file_count = value
        .get("fileMap")
        .and_then(|file_map| file_map.get("knownFiles"))
        .and_then(Value::as_array)
        .map(|files| files.len())
        .unwrap_or(0);

    if known_file_count > 0 {
        format!(
            "{} {}, {} {}, {} known {}",
            event_count,
            plural("event", "events", event_count),
            record_count,
            plural("memory chunk", "memory chunks", record_count),
            known_file_count,
            plural("path", "paths", known_file_count)
        )
    } else {
        format!(
            "{} {}, {} {}",
            event_count,
            plural("event", "events", event_count),
            record_count,
            plural("memory chunk", "memory chunks", record_count)
        )
    }
}

fn summarize_array_record(value: &Value, singular: &str, plural_label: &str) -> String {
    let count = value.as_array().map(|items| items.len()).unwrap_or(0);
    if count == 1 {
        format!("1 {singular}")
    } else {
        format!("{count} {plural_label}")
    }
}

fn summarize_agent_record(value: &Value) -> String {
    let Some(runs) = value.as_array() else {
        return "Saved agent run history.".to_string();
    };
    let step_count = runs
        .iter()
        .filter_map(|run| run.get("steps").and_then(Value::as_array))
        .map(|steps| steps.len())
        .sum::<usize>();
    let event_count = runs
        .iter()
        .filter_map(|run| run.get("events").and_then(Value::as_array))
        .map(|events| events.len())
        .sum::<usize>();
    format!(
        "{} {}, {} {}, {} {}",
        runs.len(),
        plural("run", "runs", runs.len()),
        step_count,
        plural("step", "steps", step_count),
        event_count,
        plural("event", "events", event_count)
    )
}

fn summarize_usage_history_record(value: &Value) -> String {
    let Some(records) = value.get("records").and_then(Value::as_array) else {
        return "Saved provider usage history.".to_string();
    };

    let request_count = records
        .iter()
        .filter_map(|record| record.get("requestCount").and_then(Value::as_u64))
        .sum::<u64>();
    let token_count = records
        .iter()
        .filter_map(|record| record.get("totalTokens").and_then(Value::as_u64))
        .sum::<u64>();
    let provider_count = records
        .iter()
        .filter_map(|record| record.get("provider").and_then(Value::as_str))
        .collect::<std::collections::HashSet<_>>()
        .len();

    format!(
        "{} {}, {} tokens, {} {}",
        request_count,
        plural("request", "requests", request_count as usize),
        token_count,
        provider_count,
        plural("provider", "providers", provider_count)
    )
}

fn summarize_tool_registry_record(value: &Value) -> String {
    let enabled = value
        .get("enabledToolIds")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let disabled = value
        .get("disabledToolIds")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    format!("{enabled} enabled tools, {disabled} disabled tools")
}

fn summarize_json_record(value: &Value) -> String {
    if let Some(object) = value.as_object() {
        return format!("{} saved fields", object.len());
    }
    if let Some(array) = value.as_array() {
        return format!("{} saved items", array.len());
    }
    "Stored local value.".to_string()
}

fn plural<'a>(singular: &'a str, plural_label: &'a str, count: usize) -> &'a str {
    if count == 1 {
        singular
    } else {
        plural_label
    }
}

fn add_record_context(key: &str, raw: &str, context: &mut DatabaseContextSummary) {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return;
    };

    match key {
        "gilbert-codex.chats.v1" => add_chat_context(&value, context),
        "agent-runs.v1" => add_agent_context(&value, context),
        _ => {}
    }
}

fn add_chat_context(value: &Value, context: &mut DatabaseContextSummary) {
    let Some(chats) = value.as_array() else {
        return;
    };
    context.chat_count += chats.len() as u64;

    for chat in chats {
        let chat_bytes = serde_json::to_vec(chat)
            .map(|bytes| bytes.len() as u64)
            .unwrap_or(0);
        if chat_bytes > context.largest_chat_bytes {
            context.largest_chat_bytes = chat_bytes;
            context.largest_chat_title = chat
                .get("title")
                .and_then(Value::as_str)
                .map(|title| title.to_string());
        }

        if let Some(compactions) = chat.get("contextCompactions").and_then(Value::as_array) {
            context.context_compaction_count += compactions.len() as u64;
        }

        let Some(messages) = chat.get("messages").and_then(Value::as_array) else {
            continue;
        };
        context.message_count += messages.len() as u64;

        for message in messages {
            match message.get("role").and_then(Value::as_str) {
                Some("user") => context.user_message_count += 1,
                Some("assistant") => context.assistant_message_count += 1,
                _ => {}
            }

            if let Some(content) = message.get("content").and_then(Value::as_str) {
                context.content_bytes += content.len() as u64;
            }
            if let Some(reasoning) = message.get("reasoning").and_then(Value::as_str) {
                context.reasoning_bytes += reasoning.len() as u64;
            }
            if let Some(thinking) = message.get("thinking") {
                context.thinking_bytes += serde_json::to_vec(thinking)
                    .map(|bytes| bytes.len() as u64)
                    .unwrap_or(0);
            }

            context.source_count += count_array(message, "sources");
            context.tool_call_count += count_array(message, "toolCalls");
            context.approval_count += count_array(message, "approvals");
            context.artifact_count += count_array(message, "artifacts");
            add_attachment_counts(message, context);
        }
    }
}

fn add_attachment_counts(message: &Value, context: &mut DatabaseContextSummary) {
    let Some(attachments) = message.get("attachments").and_then(Value::as_array) else {
        return;
    };

    for attachment in attachments {
        match attachment.get("kind").and_then(Value::as_str) {
            Some("image") => context.image_count += 1,
            Some("file") => context.file_attachment_count += 1,
            _ => {}
        }
    }
}

fn add_agent_context(value: &Value, context: &mut DatabaseContextSummary) {
    let Some(runs) = value.as_array() else {
        return;
    };
    context.agent_run_count += runs.len() as u64;
    for run in runs {
        context.agent_run_step_count += count_array(run, "steps");
        context.agent_run_event_count += count_array(run, "events");
    }
}

fn count_array(value: &Value, field: &str) -> u64 {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|items| items.len() as u64)
        .unwrap_or(0)
}
