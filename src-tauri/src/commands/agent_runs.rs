use crate::{
    commands::auth,
    core::{
        fs_utils::delete_legacy_file,
        storage::{self, SYSTEM_NAMESPACE},
    },
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const AGENT_RUNS_STORAGE_KEY: &str = "agent-runs.v1";
const MAX_AGENT_RUN_HISTORY: usize = 200;

async fn run_agent_runs_worker<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{label} worker stopped unexpectedly: {error}"))?
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRecord {
    pub args: Option<Value>,
    pub command: Option<String>,
    pub created_at: String,
    pub detail: Option<String>,
    pub edited_args: Option<Value>,
    pub id: String,
    pub kind: String,
    pub message_id: Option<String>,
    pub path: Option<String>,
    pub preview: Option<String>,
    pub resolved_at: Option<String>,
    pub resolution_note: Option<String>,
    pub resume_tool_call_content: Option<String>,
    pub risk: String,
    pub run_id: Option<String>,
    pub status: String,
    pub title: String,
    pub tool: String,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStepRecord {
    pub approval_id: Option<String>,
    pub completed_at: Option<String>,
    pub detail: Option<String>,
    pub id: String,
    pub input: Option<String>,
    pub label: String,
    pub output: Option<String>,
    pub started_at: String,
    pub status: String,
    pub tool_call_id: Option<String>,
    #[serde(rename = "type")]
    pub step_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEventRecord {
    pub at: String,
    pub detail: Option<String>,
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub event_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub approvals: Vec<AgentApprovalRecord>,
    pub artifacts: Vec<Value>,
    pub chat_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coding: Option<Value>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub events: Vec<AgentRunEventRecord>,
    pub id: String,
    pub last_error: Option<String>,
    pub local_workspace: Option<Value>,
    pub message_id: Option<String>,
    pub mode: String,
    pub pending_tool_call_content: Option<String>,
    pub prompt: String,
    pub sources: Vec<Value>,
    pub status: String,
    pub steps: Vec<AgentRunStepRecord>,
    pub title: String,
    pub tool_calls: Vec<Value>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn agent_runs_list(app: AppHandle) -> Result<Vec<AgentRunRecord>, String> {
    run_agent_runs_worker("Agent runs load", move || load_agent_runs(&app)).await
}

#[tauri::command]
pub async fn agent_run_save(app: AppHandle, run: AgentRunRecord) -> Result<AgentRunRecord, String> {
    run_agent_runs_worker("Agent run save", move || {
        let namespace = auth::current_user_storage_namespace(&app)?;
        save_agent_run_typed(&app, &namespace, &run)?;
        prune_typed_agent_runs(&app, &namespace)?;
        Ok(run)
    })
    .await
}

#[tauri::command]
pub async fn agent_run_delete(app: AppHandle, id: String) -> Result<(), String> {
    run_agent_runs_worker("Agent run delete", move || {
        let namespace = auth::current_user_storage_namespace(&app)?;
        storage::with_serialized_database_write(&app, "agent run delete", |connection| {
            connection
                .execute(
                    "DELETE FROM agent_runs WHERE namespace = ?1 AND run_id = ?2",
                    params![namespace, id],
                )
                .map(|_| ())
                .map_err(|error| {
                    format!("Failed to delete agent run from Gilbert Database: {error}")
                })
        })
    })
    .await
}

fn load_agent_runs(app: &AppHandle) -> Result<Vec<AgentRunRecord>, String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_agent_runs(app)?;

    let typed_runs = load_typed_agent_runs(app, &namespace)?;
    if !typed_runs.is_empty() {
        cleanup_legacy_agent_runs(app)?;
        return Ok(prune_agent_runs(typed_runs));
    }

    if let Some(raw) = storage::read_value(app, &namespace, AGENT_RUNS_STORAGE_KEY)? {
        let runs = prune_agent_runs(parse_agent_runs(&raw, "Gilbert Database agent runs")?);
        save_agent_runs_typed(app, &namespace, &runs)?;
        cleanup_legacy_agent_runs(app)?;
        return Ok(runs);
    }

    let path = legacy_agent_runs_path(app)?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read agent runs: {error}"))?;
    let runs = prune_agent_runs(parse_agent_runs(&raw, "legacy agent runs file")?);
    save_agent_runs_typed(app, &namespace, &runs)?;
    delete_legacy_file(&path, "agent runs store")?;

    Ok(runs)
}

fn load_typed_agent_runs(app: &AppHandle, namespace: &str) -> Result<Vec<AgentRunRecord>, String> {
    storage::with_database_connection(app, |connection| {
        let mut statement = connection
            .prepare(
                "SELECT raw_json
                 FROM agent_runs
                 WHERE namespace = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2",
            )
            .map_err(|error| format!("Failed to prepare typed agent run load: {error}"))?;
        let rows = statement
            .query_map(params![namespace, MAX_AGENT_RUN_HISTORY as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Failed to read typed agent runs: {error}"))?;
        let mut runs = Vec::new();

        for row in rows {
            let raw = row.map_err(|error| format!("Failed to decode typed agent run: {error}"))?;
            runs.push(
                serde_json::from_str::<AgentRunRecord>(&raw)
                    .map_err(|error| format!("Failed to parse typed agent run: {error}"))?,
            );
        }

        Ok(runs)
    })
}

fn save_agent_runs_typed(
    app: &AppHandle,
    namespace: &str,
    runs: &[AgentRunRecord],
) -> Result<(), String> {
    let pruned_runs = prune_agent_runs(runs.to_vec());

    storage::with_serialized_database_write(app, "agent run migration", |connection| {
        for run in &pruned_runs {
            save_agent_run_typed_on_connection(connection, namespace, run)?;
        }

        Ok(())
    })?;
    prune_typed_agent_runs(app, namespace)
}

fn save_agent_run_typed(
    app: &AppHandle,
    namespace: &str,
    run: &AgentRunRecord,
) -> Result<(), String> {
    storage::with_serialized_database_write(app, "agent run save", |connection| {
        save_agent_run_typed_on_connection(connection, namespace, run)
    })
}

fn save_agent_run_typed_on_connection(
    connection: &rusqlite::Connection,
    namespace: &str,
    run: &AgentRunRecord,
) -> Result<(), String> {
    let raw_json = serde_json::to_string(run)
        .map_err(|error| format!("Failed to serialize agent run: {error}"))?;
    let local_workspace_json = optional_json_string(&run.local_workspace)?;

    connection
        .execute(
            "INSERT INTO agent_runs(
               namespace, run_id, chat_id, message_id, title, prompt, mode, status,
               created_at, updated_at, completed_at, last_error, pending_tool_call_content,
               local_workspace_json, raw_json, indexed_at
             )
             VALUES(
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
               ?9, ?10, ?11, ?12, ?13, ?14, ?15, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )
             ON CONFLICT(namespace, run_id) DO UPDATE SET
               chat_id = excluded.chat_id,
               message_id = excluded.message_id,
               title = excluded.title,
               prompt = excluded.prompt,
               mode = excluded.mode,
               status = excluded.status,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at,
               completed_at = excluded.completed_at,
               last_error = excluded.last_error,
               pending_tool_call_content = excluded.pending_tool_call_content,
               local_workspace_json = excluded.local_workspace_json,
               raw_json = excluded.raw_json,
               indexed_at = excluded.indexed_at",
            params![
                namespace,
                run.id,
                run.chat_id,
                run.message_id,
                run.title,
                run.prompt,
                run.mode,
                run.status,
                run.created_at,
                run.updated_at,
                run.completed_at,
                run.last_error,
                run.pending_tool_call_content,
                local_workspace_json,
                raw_json,
            ],
        )
        .map_err(|error| format!("Failed to save agent run to Gilbert Database: {error}"))?;

    connection
        .execute(
            "DELETE FROM agent_run_steps WHERE namespace = ?1 AND run_id = ?2",
            params![namespace, run.id],
        )
        .map_err(|error| format!("Failed to clear agent run steps: {error}"))?;
    connection
        .execute(
            "DELETE FROM agent_run_events WHERE namespace = ?1 AND run_id = ?2",
            params![namespace, run.id],
        )
        .map_err(|error| format!("Failed to clear agent run events: {error}"))?;
    connection
        .execute(
            "DELETE FROM agent_run_approvals WHERE namespace = ?1 AND run_id = ?2",
            params![namespace, run.id],
        )
        .map_err(|error| format!("Failed to clear agent run approvals: {error}"))?;
    connection
        .execute(
            "DELETE FROM agent_run_items WHERE namespace = ?1 AND run_id = ?2",
            params![namespace, run.id],
        )
        .map_err(|error| format!("Failed to clear agent run items: {error}"))?;

    for (step_index, step) in run.steps.iter().enumerate() {
        let raw_json = serde_json::to_string(step)
            .map_err(|error| format!("Failed to serialize agent run step: {error}"))?;
        connection
            .execute(
                "INSERT INTO agent_run_steps(
                   namespace, run_id, step_id, step_index, step_type, label, status,
                   started_at, completed_at, detail, input, output, approval_id,
                   tool_call_id, raw_json
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    namespace,
                    run.id,
                    step.id,
                    step_index as i64,
                    step.step_type,
                    step.label,
                    step.status,
                    step.started_at,
                    step.completed_at,
                    step.detail,
                    step.input,
                    step.output,
                    step.approval_id,
                    step.tool_call_id,
                    raw_json,
                ],
            )
            .map_err(|error| format!("Failed to save agent run step: {error}"))?;
    }

    for (event_index, event) in run.events.iter().enumerate() {
        let raw_json = serde_json::to_string(event)
            .map_err(|error| format!("Failed to serialize agent run event: {error}"))?;
        connection
            .execute(
                "INSERT INTO agent_run_events(
                   namespace, run_id, event_id, event_index, event_type, label, at, detail, raw_json
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    namespace,
                    run.id,
                    event.id,
                    event_index as i64,
                    event.event_type,
                    event.label,
                    event.at,
                    event.detail,
                    raw_json,
                ],
            )
            .map_err(|error| format!("Failed to save agent run event: {error}"))?;
    }

    for (approval_index, approval) in run.approvals.iter().enumerate() {
        let raw_json = serde_json::to_string(approval)
            .map_err(|error| format!("Failed to serialize agent run approval: {error}"))?;
        connection
            .execute(
                "INSERT INTO agent_run_approvals(
                   namespace, run_id, approval_id, approval_index, tool, kind, status, risk,
                   title, command, path, preview, detail, created_at, resolved_at,
                   message_id, tool_call_id, raw_json
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    namespace,
                    run.id,
                    approval.id,
                    approval_index as i64,
                    approval.tool,
                    approval.kind,
                    approval.status,
                    approval.risk,
                    approval.title,
                    approval.command,
                    approval.path,
                    approval.preview,
                    approval.detail,
                    approval.created_at,
                    approval.resolved_at,
                    approval.message_id,
                    approval.tool_call_id,
                    raw_json,
                ],
            )
            .map_err(|error| format!("Failed to save agent run approval: {error}"))?;
    }

    save_agent_run_json_items(connection, namespace, &run.id, "artifact", &run.artifacts)?;
    save_agent_run_json_items(connection, namespace, &run.id, "source", &run.sources)?;
    save_agent_run_json_items(connection, namespace, &run.id, "tool-call", &run.tool_calls)?;

    Ok(())
}

fn save_agent_run_json_items(
    connection: &rusqlite::Connection,
    namespace: &str,
    run_id: &str,
    item_kind: &str,
    items: &[Value],
) -> Result<(), String> {
    for (item_index, item) in items.iter().enumerate() {
        let item_json = serde_json::to_string(item)
            .map_err(|error| format!("Failed to serialize agent run {item_kind}: {error}"))?;
        connection
            .execute(
                "INSERT INTO agent_run_items(namespace, run_id, item_kind, item_index, item_json)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                params![namespace, run_id, item_kind, item_index as i64, item_json],
            )
            .map_err(|error| format!("Failed to save agent run {item_kind}: {error}"))?;
    }

    Ok(())
}

fn prune_typed_agent_runs(app: &AppHandle, namespace: &str) -> Result<(), String> {
    storage::with_serialized_database_write(app, "agent run pruning", |connection| {
        connection
            .execute(
                "DELETE FROM agent_runs
                 WHERE namespace = ?1
                   AND run_id NOT IN (
                     SELECT run_id
                     FROM agent_runs
                     WHERE namespace = ?1
                     ORDER BY updated_at DESC
                     LIMIT ?2
                   )",
                params![namespace, MAX_AGENT_RUN_HISTORY as i64],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to prune agent runs: {error}"))
    })
}

fn optional_json_string(value: &Option<Value>) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("Failed to serialize agent run field: {error}"))
}

fn clear_shared_agent_runs(app: &AppHandle) -> Result<(), String> {
    if storage::read_value(app, SYSTEM_NAMESPACE, AGENT_RUNS_STORAGE_KEY)?
        .is_some_and(|raw| raw.trim() != "[]")
    {
        storage::write_value(app, SYSTEM_NAMESPACE, AGENT_RUNS_STORAGE_KEY, "[]")?;
    }

    Ok(())
}

fn parse_agent_runs(raw: &str, source: &str) -> Result<Vec<AgentRunRecord>, String> {
    serde_json::from_str::<Vec<AgentRunRecord>>(raw)
        .map_err(|error| format!("Failed to parse {source}: {error}"))
}

fn prune_agent_runs(mut runs: Vec<AgentRunRecord>) -> Vec<AgentRunRecord> {
    runs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    runs.truncate(MAX_AGENT_RUN_HISTORY);
    runs
}

fn legacy_agent_runs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    Ok(directory.join("agent-runs.json"))
}

fn cleanup_legacy_agent_runs(app: &AppHandle) -> Result<(), String> {
    let path = legacy_agent_runs_path(app)?;
    delete_legacy_file(&path, "agent runs store")
}
