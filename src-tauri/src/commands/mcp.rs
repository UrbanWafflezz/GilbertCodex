//! MCP desktop commands for Streamable HTTP and stdio server connections and tool calls.

#[cfg(not(windows))]
use crate::core::native_path::{
    expand_home_path, native_runtime_path_dirs, resolve_native_executable,
};
use crate::{
    commands::auth,
    core::{process::hide_command_window, secure_storage, storage},
};
use reqwest::{
    header::{self, HeaderName, HeaderValue},
    Method, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, path::BaseDirectory, Manager};
use uuid::Uuid;

const MCP_DATABASE_STORAGE_KEY: &str = "mcp-servers.v1";
const MCP_DATABASE_GENERATION: u32 = 1;
const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const MCP_TRANSPORT_HTTP: &str = "http";
const MCP_TRANSPORT_STDIO: &str = "stdio";
const MCP_HTTP_CONNECT_TIMEOUT_SECS: u64 = 8;
const MCP_HTTP_TIMEOUT_SECS: u64 = 30;
const MCP_STDIO_TIMEOUT_SECS: u64 = 90;
const MCP_STDIO_SHUTDOWN_TIMEOUT_MS: u64 = 1_200;
const MCP_STDIO_PROGRESS_MIN_INTERVAL_MS: u64 = 400;
const MCP_MAX_SERVERS: usize = 50;
const MCP_MAX_TOOL_LIST_PAGES: usize = 8;
const MCP_MAX_TOOLS_PER_SERVER: usize = 200;
const MCP_MAX_ARGUMENT_BYTES: usize = 256_000;
const MCP_MAX_RESULT_CHARS: usize = 80_000;
const MCP_MAX_HTTP_HEADERS: usize = 24;
const MCP_MAX_STDIO_ARGS: usize = 80;
const MCP_MAX_STDIO_ENV: usize = 80;
const MCP_REGISTRY_BASE_URL: &str = "https://registry.modelcontextprotocol.io/v0.1/servers";
const MCP_REGISTRY_DEFAULT_RESULTS: usize = 12;
const MCP_REGISTRY_MAX_RESULTS: usize = 24;
const LINKEDIN_MCP_SERVER_RELATIVE_PATH: &str = "plugins/linkedin/scripts/linkedin-mcp-server.mjs";
const USER_AGENT: &str = "GilbertCodex/0.5 (desktop MCP)";

#[derive(Default)]
pub struct McpState {
    lock: Mutex<()>,
    stdio_sessions: StdioSessionCache,
}

impl Drop for McpState {
    fn drop(&mut self) {
        shutdown_all_cached_stdio_sessions(&self.stdio_sessions);
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct McpDatabase {
    database_generation: u32,
    servers: Vec<McpServerRecord>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct McpServerRecord {
    authorization_token: Option<String>,
    args: Vec<String>,
    command: Option<String>,
    created_at: Option<u64>,
    enabled: bool,
    endpoint: Option<String>,
    environment: Vec<McpEnvironmentVariable>,
    headers: Vec<McpHttpHeader>,
    id: String,
    last_connected_at: Option<u64>,
    last_error: Option<String>,
    name: String,
    protocol_version: Option<String>,
    query_params: Vec<McpHttpQueryParam>,
    server_name: Option<String>,
    server_version: Option<String>,
    tools: Vec<McpToolSummary>,
    transport: String,
    updated_at: Option<u64>,
    working_directory: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct McpEnvironmentVariable {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct McpHttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct McpHttpQueryParam {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct McpToolSummary {
    pub description: Option<String>,
    pub input_schema: Option<Value>,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionState {
    pub connected: bool,
    pub enabled_server_count: usize,
    pub max_servers: usize,
    pub servers: Vec<McpServerState>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerState {
    pub args: Vec<String>,
    pub command: Option<String>,
    pub created_at: Option<u64>,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub environment: Vec<McpEnvironmentVariableState>,
    pub headers: Vec<McpHttpHeaderState>,
    pub has_authorization_token: bool,
    pub id: String,
    pub last_connected_at: Option<u64>,
    pub last_error: Option<String>,
    pub name: String,
    pub protocol_version: Option<String>,
    pub query_params: Vec<McpHttpQueryParamState>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolSummary>,
    pub transport: String,
    pub updated_at: Option<u64>,
    pub working_directory: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEnvironmentVariableState {
    pub has_value: bool,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpHeaderState {
    pub has_value: bool,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpQueryParamState {
    pub has_value: bool,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSaveServerRequest {
    pub authorization_token: Option<String>,
    pub args: Option<Vec<String>>,
    pub command: Option<String>,
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    pub environment: Option<Vec<McpEnvironmentVariable>>,
    pub headers: Option<Vec<McpHttpHeader>>,
    pub id: Option<String>,
    pub name: String,
    pub query_params: Option<Vec<McpHttpQueryParam>>,
    pub transport: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSaveServerResponse {
    pub server: McpServerState,
    pub state: McpConnectionState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestServerRequest {
    pub authorization_token: Option<String>,
    pub args: Option<Vec<String>>,
    pub command: Option<String>,
    pub endpoint: Option<String>,
    pub environment: Option<Vec<McpEnvironmentVariable>>,
    pub headers: Option<Vec<McpHttpHeader>>,
    pub id: Option<String>,
    pub query_params: Option<Vec<McpHttpQueryParam>>,
    pub transport: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerTestResponse {
    pub message: String,
    pub ok: bool,
    pub protocol_version: Option<String>,
    pub server: Option<McpServerState>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub state: Option<McpConnectionState>,
    pub tools: Vec<McpToolSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsRequest {
    pub server_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsResponse {
    pub server: McpServerState,
    pub state: McpConnectionState,
    pub tools: Vec<McpToolSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallToolRequest {
    pub arguments: Option<Value>,
    pub server_id: String,
    pub tool_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResponse {
    pub content: String,
    pub is_error: bool,
    pub ok: bool,
    pub raw_result: Value,
    pub server: McpServerState,
    pub structured_content: Option<Value>,
    pub tool_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySearchRequest {
    pub limit: Option<usize>,
    pub query: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySearchResponse {
    pub count: usize,
    pub next_cursor: Option<String>,
    pub query: String,
    pub servers: Vec<McpRegistryServerSummary>,
    pub source: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryServerSummary {
    pub description: Option<String>,
    pub install: Option<McpRegistryInstallHint>,
    pub name: String,
    pub official: bool,
    pub packages: Vec<McpRegistryPackageHint>,
    pub remotes: Vec<McpRegistryRemoteHint>,
    pub repository_url: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryPackageHint {
    pub args: Vec<String>,
    pub command: Option<String>,
    pub identifier: Option<String>,
    pub registry_type: Option<String>,
    pub runtime_hint: Option<String>,
    pub transport: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryRemoteHint {
    pub endpoint: Option<String>,
    pub transport: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryInstallHint {
    pub args: Vec<String>,
    pub command: Option<String>,
    pub endpoint: Option<String>,
    pub note: Option<String>,
    pub package_id: Option<String>,
    pub package_manager: Option<String>,
    pub transport: String,
}

struct McpProbeResult {
    protocol_version: Option<String>,
    server_name: Option<String>,
    server_version: Option<String>,
    tools: Vec<McpToolSummary>,
}

#[derive(Clone, Debug)]
struct McpInitializeResult {
    protocol_version: Option<String>,
    server_name: Option<String>,
    server_version: Option<String>,
    session_id: Option<String>,
}

struct McpRpcResponse {
    result: Value,
    session_id: Option<String>,
}

type McpProgressSender = Arc<Channel<McpServerProgressEvent>>;
type StdioSessionCache = Arc<Mutex<HashMap<String, CachedStdioMcpSession>>>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerProgressEvent {
    pub kind: String,
    pub message: String,
    pub stream: Option<String>,
}

struct NormalizedMcpServerInput {
    args: Vec<String>,
    authorization_token: Option<String>,
    command: Option<String>,
    endpoint: Option<String>,
    environment: Vec<McpEnvironmentVariable>,
    headers: Vec<McpHttpHeader>,
    query_params: Vec<McpHttpQueryParam>,
    transport: String,
    working_directory: Option<String>,
}

struct StdioMcpSession {
    child: Child,
    stderr_rx: mpsc::Receiver<String>,
    stdin: ChildStdin,
    stdout_rx: mpsc::Receiver<String>,
}

struct CachedStdioMcpSession {
    config_key: String,
    initialized: McpInitializeResult,
    session: StdioMcpSession,
}

#[derive(Clone, Debug, Default)]
struct ResolvedStdioCommand {
    executable: String,
    extra_path_dirs: Vec<PathBuf>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_get_state(app: tauri::AppHandle) -> Result<McpConnectionState, String> {
    let database = load_database(&app)?;
    Ok(create_connection_state(&database))
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_save_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpSaveServerRequest,
) -> Result<McpSaveServerResponse, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let now = now_millis();
    let name = normalize_server_name(&request.name)?;
    let input = normalize_server_input(&request)?;
    let requested_id = request.id.as_ref().and_then(|id| normalize_optional_id(id));
    let target_hint = normalized_server_target_hint(&input);
    let generated_server_id = requested_id
        .clone()
        .unwrap_or_else(|| create_server_id(&name, &target_hint));
    let existing_index = requested_id
        .as_ref()
        .and_then(|id| database.servers.iter().position(|server| server.id == *id))
        .or_else(|| {
            if requested_id.is_some() {
                None
            } else {
                database
                    .servers
                    .iter()
                    .position(|server| server_matches_normalized_input(server, &input))
            }
        });
    let server_id = existing_index
        .and_then(|index| database.servers.get(index).map(|server| server.id.clone()))
        .unwrap_or(generated_server_id);

    if let Some(index) = existing_index {
        let existing = &mut database.servers[index];
        let merged_environment = if input.transport == MCP_TRANSPORT_STDIO {
            merge_stdio_environment(input.environment.clone(), &existing.environment)
        } else {
            Vec::new()
        };
        let merged_headers = if input.transport == MCP_TRANSPORT_HTTP {
            merge_http_headers(input.headers.clone(), &existing.headers)
        } else {
            Vec::new()
        };
        let merged_query_params = if input.transport == MCP_TRANSPORT_HTTP {
            merge_http_query_params(input.query_params.clone(), &existing.query_params)
        } else {
            Vec::new()
        };

        existing.name = name;
        existing.args = input.args;
        existing.command = input.command;
        existing.endpoint = input.endpoint;
        existing.environment = merged_environment;
        existing.headers = merged_headers;
        existing.query_params = merged_query_params;
        existing.enabled = request.enabled.unwrap_or(existing.enabled);
        existing.authorization_token = if input.transport == MCP_TRANSPORT_HTTP {
            input
                .authorization_token
                .or_else(|| existing.authorization_token.clone())
        } else {
            None
        };
        existing.last_error = None;
        existing.protocol_version = None;
        existing.server_name = None;
        existing.server_version = None;
        existing.tools.clear();
        existing.transport = input.transport;
        existing.updated_at = Some(now);
        existing.working_directory = input.working_directory;
    } else {
        if database.servers.len() >= MCP_MAX_SERVERS {
            return Err(format!(
                "MCP already has {MCP_MAX_SERVERS} servers configured. Remove one before adding another."
            ));
        }

        database.servers.push(McpServerRecord {
            args: input.args,
            authorization_token: input.authorization_token,
            command: input.command,
            created_at: Some(now),
            enabled: request.enabled.unwrap_or(true),
            endpoint: input.endpoint,
            environment: input.environment,
            headers: input.headers,
            query_params: input.query_params,
            id: server_id.clone(),
            last_connected_at: None,
            last_error: None,
            name,
            protocol_version: None,
            server_name: None,
            server_version: None,
            tools: Vec::new(),
            transport: input.transport,
            updated_at: Some(now),
            working_directory: input.working_directory,
        });
    }

    normalize_database(&mut database);
    apply_first_party_mcp_defaults(&app, &mut database);
    save_database(&app, &database)?;
    reset_cached_stdio_session(state.inner(), &server_id);

    let state = create_connection_state(&database);
    let server = state
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| "MCP server was saved but could not be reloaded.".to_string())?;

    Ok(McpSaveServerResponse { server, state })
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_remove_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpServerIdRequest,
) -> Result<McpConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let id = normalize_id(&request.id, "MCP server id")?;
    let before = database.servers.len();
    let removed_server = database
        .servers
        .iter()
        .find(|server| server.id == id)
        .cloned();

    database.servers.retain(|server| server.id != id);

    if database.servers.len() == before {
        return Err("MCP server was not found.".to_string());
    }

    save_database(&app, &database)?;
    reset_cached_stdio_session(state.inner(), &id);
    delete_mcp_server_secrets(&app, &id, removed_server.as_ref());
    Ok(create_connection_state(&database))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_test_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpTestServerRequest,
) -> Result<McpServerTestResponse, String> {
    run_mcp_test_server(&app, state.inner(), request, None).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_test_server_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpTestServerRequest,
    on_event: Channel<McpServerProgressEvent>,
) -> Result<McpServerTestResponse, String> {
    run_mcp_test_server(&app, state.inner(), request, Some(Arc::new(on_event))).await
}

async fn run_mcp_test_server(
    app: &tauri::AppHandle,
    state: &McpState,
    request: McpTestServerRequest,
    progress: Option<McpProgressSender>,
) -> Result<McpServerTestResponse, String> {
    let id = request.id.as_ref().and_then(|id| normalize_optional_id(id));
    let mut record = match id.as_ref() {
        Some(server_id) => find_server_record(app, server_id)?,
        None => create_probe_record(&request)?,
    };
    apply_first_party_mcp_server_defaults(app, &mut record);

    send_mcp_progress(
        progress.as_ref(),
        "started",
        format!("Testing {}.", record.name.trim()),
        None,
    );

    let probe = probe_server(&record, progress.clone(), None).await;

    match probe {
        Ok(probe) => {
            if let Some(server_id) = id.as_ref() {
                let (state_response, server) =
                    update_server_after_probe(app, state, server_id, &probe, None)?;

                let response = McpServerTestResponse {
                    message: format!(
                        "Connected to {}. Discovered {} tool{}.",
                        server.name,
                        probe.tools.len(),
                        if probe.tools.len() == 1 { "" } else { "s" }
                    ),
                    ok: true,
                    protocol_version: probe.protocol_version,
                    server: Some(server),
                    server_name: probe.server_name,
                    server_version: probe.server_version,
                    state: Some(state_response),
                    tools: probe.tools,
                };
                send_mcp_progress(
                    progress.as_ref(),
                    "finished",
                    response.message.clone(),
                    None,
                );
                Ok(response)
            } else {
                let response = McpServerTestResponse {
                    message: format!(
                        "Connected to MCP server. Discovered {} tool{}.",
                        probe.tools.len(),
                        if probe.tools.len() == 1 { "" } else { "s" }
                    ),
                    ok: true,
                    protocol_version: probe.protocol_version,
                    server: None,
                    server_name: probe.server_name,
                    server_version: probe.server_version,
                    state: None,
                    tools: probe.tools,
                };
                send_mcp_progress(
                    progress.as_ref(),
                    "finished",
                    response.message.clone(),
                    None,
                );
                Ok(response)
            }
        }
        Err(error) => {
            if let Some(server_id) = id.as_ref() {
                let (state_response, server) =
                    update_server_after_error(app, state, server_id, &error)?;

                let response = McpServerTestResponse {
                    message: error,
                    ok: false,
                    protocol_version: None,
                    server: Some(server),
                    server_name: None,
                    server_version: None,
                    state: Some(state_response),
                    tools: Vec::new(),
                };
                send_mcp_progress(progress.as_ref(), "error", response.message.clone(), None);
                Ok(response)
            } else {
                let response = McpServerTestResponse {
                    message: error,
                    ok: false,
                    protocol_version: None,
                    server: None,
                    server_name: None,
                    server_version: None,
                    state: None,
                    tools: Vec::new(),
                };
                send_mcp_progress(progress.as_ref(), "error", response.message.clone(), None);
                Ok(response)
            }
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_list_tools(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpListToolsRequest,
) -> Result<McpListToolsResponse, String> {
    let server_id = normalize_id(&request.server_id, "MCP server id")?;
    let record = find_server_record(&app, &server_id)?;
    let probe = probe_server(&record, None, Some(state.inner().stdio_sessions.clone()))
        .await
        .map_err(|error| format!("Could not list tools for {}: {error}", record.name.trim()))?;
    let tools = probe.tools.clone();
    let (state_response, server) =
        update_server_after_probe(&app, state.inner(), &server_id, &probe, None)?;

    Ok(McpListToolsResponse {
        server,
        state: state_response,
        tools,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_call_tool(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpCallToolRequest,
) -> Result<McpToolCallResponse, String> {
    run_mcp_call_tool(&app, state.inner(), request, None).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_call_tool_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpCallToolRequest,
    on_event: Channel<McpServerProgressEvent>,
) -> Result<McpToolCallResponse, String> {
    run_mcp_call_tool(&app, state.inner(), request, Some(Arc::new(on_event))).await
}

async fn run_mcp_call_tool(
    app: &tauri::AppHandle,
    state: &McpState,
    request: McpCallToolRequest,
    progress: Option<McpProgressSender>,
) -> Result<McpToolCallResponse, String> {
    let server_id = normalize_id(&request.server_id, "MCP server id")?;
    let requested_tool_name = normalize_tool_name(&request.tool_name)?;
    let arguments = normalize_tool_arguments(request.arguments)?;
    let record = find_server_record(app, &server_id)?;
    let tool_name = resolve_mcp_tool_name(&record, &requested_tool_name);
    let arguments = normalize_mcp_tool_arguments_for_server(&record, &tool_name, arguments);

    if !record.enabled {
        return Err(format!("MCP server {} is disabled.", record.name));
    }

    send_mcp_progress(
        progress.as_ref(),
        "started",
        format!("Calling `{}` on {}.", tool_name, record.name.trim()),
        None,
    );

    let raw_result = match call_server_tool(
        &record,
        state.stdio_sessions.clone(),
        &tool_name,
        arguments.clone(),
        progress.clone(),
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            send_mcp_progress(progress.as_ref(), "error", error.clone(), None);
            return Err(error);
        }
    };
    let visible_result = sanitize_mcp_visible_value(&raw_result);
    let structured_content = visible_result.get("structuredContent").cloned();
    let is_error = visible_result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = format_mcp_tool_result_content(&visible_result);
    let probe = McpProbeResult {
        protocol_version: record.protocol_version.clone(),
        server_name: record.server_name.clone(),
        server_version: record.server_version.clone(),
        tools: record.tools.clone(),
    };
    let (_state_response, server) =
        update_server_after_probe(app, state, &server_id, &probe, None)?;
    let server = maybe_persist_firebase_project_directory(
        app, state, &server_id, &record, &tool_name, &arguments, is_error, server,
    )?;
    send_mcp_progress(
        progress.as_ref(),
        if is_error { "error" } else { "finished" },
        if is_error {
            format!("MCP tool `{}` reported an error.", tool_name)
        } else {
            format!("MCP tool `{}` finished.", tool_name)
        },
        None,
    );

    Ok(McpToolCallResponse {
        content,
        is_error,
        ok: !is_error,
        raw_result: visible_result,
        server,
        structured_content,
        tool_name,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_search_registry(
    request: McpRegistrySearchRequest,
) -> Result<McpRegistrySearchResponse, String> {
    let query = request
        .query
        .unwrap_or_default()
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    let limit = request
        .limit
        .unwrap_or(MCP_REGISTRY_DEFAULT_RESULTS)
        .clamp(1, MCP_REGISTRY_MAX_RESULTS);
    let mut url = Url::parse(MCP_REGISTRY_BASE_URL)
        .map_err(|error| format!("Could not prepare MCP Registry URL: {error}"))?;

    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("limit", &limit.to_string());

        if !query.is_empty() {
            query_pairs.append_pair("search", &query);
        }
    }

    let client = mcp_client()?;
    let response = client
        .get(url)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Could not reach the MCP Registry: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the MCP Registry response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "MCP Registry search failed with HTTP {}: {}",
            status.as_u16(),
            summarize_response_text(&text)
        ));
    }

    let payload = serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("MCP Registry returned invalid JSON: {error}"))?;

    Ok(normalize_registry_search_response(payload, query))
}

fn normalize_registry_search_response(payload: Value, query: String) -> McpRegistrySearchResponse {
    let servers = payload
        .get("servers")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(normalize_registry_server_entry)
                .take(MCP_REGISTRY_MAX_RESULTS)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let count = payload
        .pointer("/metadata/count")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(servers.len());
    let next_cursor = registry_string(payload.pointer("/metadata/nextCursor"));

    McpRegistrySearchResponse {
        count,
        next_cursor,
        query,
        servers,
        source: MCP_REGISTRY_BASE_URL.to_string(),
    }
}

fn normalize_registry_server_entry(entry: &Value) -> Option<McpRegistryServerSummary> {
    let server = entry.get("server").unwrap_or(entry);
    let name = registry_string(server.get("name"))?;
    let packages = normalize_registry_packages(server);
    let remotes = normalize_registry_remotes(server);
    let install = choose_registry_install_hint(&packages, &remotes);
    let official_meta = entry
        .get("_meta")
        .and_then(|meta| meta.get("io.modelcontextprotocol.registry/official"));
    let status = registry_string(server.get("status"))
        .or_else(|| official_meta.and_then(|meta| registry_string(meta.get("status"))));
    let updated_at = registry_string(server.get("updatedAt"))
        .or_else(|| official_meta.and_then(|meta| registry_string(meta.get("updatedAt"))));

    Some(McpRegistryServerSummary {
        description: registry_string(server.get("description")),
        install,
        name,
        official: official_meta.is_some(),
        packages,
        remotes,
        repository_url: server
            .get("repository")
            .and_then(|repository| registry_string(repository.get("url"))),
        status,
        title: registry_string(server.get("title")),
        updated_at,
        version: registry_string(server.get("version")),
    })
}

fn normalize_registry_packages(server: &Value) -> Vec<McpRegistryPackageHint> {
    let Some(packages) = server.get("packages").and_then(Value::as_array) else {
        return Vec::new();
    };

    packages
        .iter()
        .take(12)
        .map(|package| McpRegistryPackageHint {
            args: registry_runtime_arguments(package.get("runtimeArguments")),
            command: registry_string(package.get("command")),
            identifier: registry_string(package.get("identifier")),
            registry_type: registry_string(package.get("registryType")),
            runtime_hint: registry_string(package.get("runtimeHint")),
            transport: package
                .get("transport")
                .and_then(|transport| registry_string(transport.get("type")))
                .or_else(|| registry_string(package.get("transport"))),
            version: registry_string(package.get("version")),
        })
        .collect()
}

fn normalize_registry_remotes(server: &Value) -> Vec<McpRegistryRemoteHint> {
    let Some(remotes) = server.get("remotes").and_then(Value::as_array) else {
        return Vec::new();
    };

    remotes
        .iter()
        .take(12)
        .map(|remote| McpRegistryRemoteHint {
            endpoint: registry_string(remote.get("url"))
                .or_else(|| registry_string(remote.get("endpoint"))),
            transport: registry_string(remote.get("type")).or_else(|| {
                remote
                    .get("transport")
                    .and_then(|transport| registry_string(transport.get("type")))
            }),
        })
        .collect()
}

fn choose_registry_install_hint(
    packages: &[McpRegistryPackageHint],
    remotes: &[McpRegistryRemoteHint],
) -> Option<McpRegistryInstallHint> {
    if let Some(remote) = remotes.iter().find(|remote| {
        remote
            .endpoint
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    }) {
        let endpoint = remote.endpoint.clone()?;
        return Some(McpRegistryInstallHint {
            args: vec![
                "-y".to_string(),
                "mcp-remote@latest".to_string(),
                endpoint.clone(),
            ],
            command: Some("npx".to_string()),
            endpoint: Some(endpoint),
            note: Some("Remote MCP servers are configured through the mcp-remote stdio bridge so provider OAuth flows can open in the browser when needed. Gilbert resolves common Node, Python, and package-runner paths automatically on desktop.".to_string()),
            package_id: Some("mcp-remote@latest".to_string()),
            package_manager: Some("npm".to_string()),
            transport: MCP_TRANSPORT_STDIO.to_string(),
            ..Default::default()
        });
    }

    packages
        .iter()
        .filter(|package| {
            package
                .transport
                .as_deref()
                .map(|transport| transport.eq_ignore_ascii_case("stdio"))
                .unwrap_or(true)
        })
        .find_map(package_install_hint)
}

fn package_install_hint(package: &McpRegistryPackageHint) -> Option<McpRegistryInstallHint> {
    let registry_type = package
        .registry_type
        .as_deref()?
        .trim()
        .to_ascii_lowercase();
    let identifier = package.identifier.as_deref()?.trim();

    if identifier.is_empty() {
        return None;
    }

    match registry_type.as_str() {
        "npm" => {
            let package_id =
                package_identifier_with_version(identifier, package.version.as_deref());
            let mut args = vec!["-y".to_string(), package_id.clone()];
            args.extend(package.args.clone());

            Some(McpRegistryInstallHint {
                args,
                command: Some(
                    package
                        .runtime_hint
                        .clone()
                        .filter(|hint| !hint.trim().is_empty())
                        .unwrap_or_else(|| "npx".to_string()),
                ),
                note: Some("This stdio MCP server will be launched as a local subprocess when Gilbert lists or calls its tools. Gilbert resolves common Node, Python, and package-runner paths automatically on desktop.".to_string()),
                package_id: Some(package_id),
                package_manager: Some("npm".to_string()),
                transport: MCP_TRANSPORT_STDIO.to_string(),
                ..Default::default()
            })
        }
        "pypi" => {
            let package_id =
                pypi_package_identifier_with_version(identifier, package.version.as_deref());
            let mut args = vec![package_id.clone()];
            args.extend(package.args.clone());

            Some(McpRegistryInstallHint {
                args,
                command: Some(
                    package
                        .runtime_hint
                        .clone()
                        .filter(|hint| !hint.trim().is_empty())
                        .unwrap_or_else(|| "uvx".to_string()),
                ),
                note: Some("This Python MCP server needs uv/uvx available on PATH before Gilbert can test it.".to_string()),
                package_id: Some(package_id),
                package_manager: Some("pypi".to_string()),
                transport: MCP_TRANSPORT_STDIO.to_string(),
                ..Default::default()
            })
        }
        _ => None,
    }
}

fn package_identifier_with_version(identifier: &str, version: Option<&str>) -> String {
    let Some(version) = version.map(str::trim).filter(|value| !value.is_empty()) else {
        return identifier.to_string();
    };

    if identifier.contains('@') && !identifier.starts_with('@') {
        identifier.to_string()
    } else {
        format!("{identifier}@{version}")
    }
}

fn pypi_package_identifier_with_version(identifier: &str, version: Option<&str>) -> String {
    let Some(version) = version.map(str::trim).filter(|value| !value.is_empty()) else {
        return identifier.to_string();
    };

    if identifier.contains("==")
        || identifier.contains(">=")
        || identifier.contains("<=")
        || identifier.contains('~')
    {
        identifier.to_string()
    } else {
        format!("{identifier}=={version}")
    }
}

fn registry_runtime_arguments(value: Option<&Value>) -> Vec<String> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::to_string)
                .or_else(|| registry_string(item.get("value")))
        })
        .filter(|value| !value.trim().is_empty())
        .take(24)
        .collect()
}

fn registry_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn load_database(app: &tauri::AppHandle) -> Result<McpDatabase, String> {
    let namespace = auth::current_user_storage_namespace(app)?;

    if let Some(content) = storage::read_value(app, &namespace, MCP_DATABASE_STORAGE_KEY)? {
        let mut database = parse_database_content(&content)?;
        apply_first_party_mcp_defaults(app, &mut database);
        return Ok(database);
    }

    Ok(fresh_database())
}

fn save_database(app: &tauri::AppHandle, database: &McpDatabase) -> Result<(), String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    let content = serde_json::to_string_pretty(database)
        .map_err(|error| format!("Could not serialize the MCP server store: {error}"))?;

    storage::write_value(app, &namespace, MCP_DATABASE_STORAGE_KEY, &content)
        .map_err(|error| format!("Could not write the MCP server store: {error}"))
}

fn parse_database_content(content: &str) -> Result<McpDatabase, String> {
    let mut database = serde_json::from_str::<McpDatabase>(content)
        .map_err(|error| format!("Could not parse the MCP server store: {error}"))?;

    if database.database_generation != MCP_DATABASE_GENERATION {
        return Ok(fresh_database());
    }

    normalize_database(&mut database);
    Ok(database)
}

fn fresh_database() -> McpDatabase {
    McpDatabase {
        database_generation: MCP_DATABASE_GENERATION,
        servers: Vec::new(),
    }
}

fn normalize_database(database: &mut McpDatabase) {
    database.database_generation = MCP_DATABASE_GENERATION;
    database
        .servers
        .retain(|server| !server.id.trim().is_empty() && !server.name.trim().is_empty());
    database.servers.truncate(MCP_MAX_SERVERS);

    for server in &mut database.servers {
        server.transport = normalize_existing_transport(server);
        server.name = server.name.trim().to_string();

        if server.transport == MCP_TRANSPORT_STDIO {
            server.endpoint = None;
            server.authorization_token = None;
            server.command = normalize_optional_stdio_command(server.command.as_deref());
            server.args = normalize_existing_stdio_args(&server.args);
            server.environment = normalize_existing_stdio_environment(&server.environment);
            server.headers.clear();
            server.query_params.clear();
            server.working_directory =
                normalize_optional_working_directory(server.working_directory.as_deref());
        } else {
            server.endpoint = server
                .endpoint
                .as_deref()
                .map(str::trim)
                .filter(|endpoint| !endpoint.is_empty())
                .map(str::to_string);
            server.command = None;
            server.args.clear();
            server.environment.clear();
            server.headers = normalize_existing_http_headers(&server.headers);
            server.query_params = normalize_existing_http_query_params(&server.query_params);
            server.working_directory = None;
            server.authorization_token =
                normalize_optional_secret(server.authorization_token.as_deref());
        }

        let target_hint = server_record_target_hint(server);
        server.id = normalize_optional_id(&server.id)
            .unwrap_or_else(|| create_server_id(&server.name, &target_hint));
        server.tools.truncate(MCP_MAX_TOOLS_PER_SERVER);
    }

    database.servers.retain(has_valid_record_target);
    dedupe_servers_by_target(database);
}

fn apply_first_party_mcp_defaults(app: &tauri::AppHandle, database: &mut McpDatabase) {
    for server in &mut database.servers {
        apply_first_party_mcp_server_defaults(app, server);
    }
}

fn apply_first_party_mcp_server_defaults(app: &tauri::AppHandle, server: &mut McpServerRecord) {
    if server.transport != MCP_TRANSPORT_STDIO
        || !is_linkedin_local_mcp_server(server.command.as_deref(), &server.args)
        || server
            .working_directory
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
    {
        return;
    }

    if let Some(root) =
        resolve_first_party_mcp_working_directory(Some(app), LINKEDIN_MCP_SERVER_RELATIVE_PATH)
    {
        server.working_directory = Some(root.to_string_lossy().to_string());
    }
}

fn create_connection_state(database: &McpDatabase) -> McpConnectionState {
    let servers: Vec<McpServerState> = database.servers.iter().map(sanitize_server).collect();
    let enabled_server_count = servers.iter().filter(|server| server.enabled).count();

    McpConnectionState {
        connected: enabled_server_count > 0,
        enabled_server_count,
        max_servers: MCP_MAX_SERVERS,
        servers,
    }
}

fn sanitize_server(server: &McpServerRecord) -> McpServerState {
    McpServerState {
        args: if server.transport == MCP_TRANSPORT_STDIO {
            server.args.clone()
        } else {
            Vec::new()
        },
        command: if server.transport == MCP_TRANSPORT_STDIO {
            server.command.clone()
        } else {
            None
        },
        created_at: server.created_at,
        enabled: server.enabled,
        endpoint: server.endpoint.clone(),
        environment: if server.transport == MCP_TRANSPORT_STDIO {
            server
                .environment
                .iter()
                .map(|item| McpEnvironmentVariableState {
                    has_value: !item.value.trim().is_empty(),
                    name: item.name.clone(),
                })
                .collect()
        } else {
            Vec::new()
        },
        headers: if server.transport == MCP_TRANSPORT_HTTP {
            server
                .headers
                .iter()
                .map(|item| McpHttpHeaderState {
                    has_value: !item.value.trim().is_empty(),
                    name: item.name.clone(),
                })
                .collect()
        } else {
            Vec::new()
        },
        query_params: if server.transport == MCP_TRANSPORT_HTTP {
            server
                .query_params
                .iter()
                .map(|item| McpHttpQueryParamState {
                    has_value: !item.value.trim().is_empty(),
                    name: item.name.clone(),
                })
                .collect()
        } else {
            Vec::new()
        },
        has_authorization_token: server
            .authorization_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .is_some(),
        id: server.id.clone(),
        last_connected_at: server.last_connected_at,
        last_error: server.last_error.clone(),
        name: server.name.clone(),
        protocol_version: server.protocol_version.clone(),
        server_name: server.server_name.clone(),
        server_version: server.server_version.clone(),
        tools: server.tools.clone(),
        transport: server.transport.clone(),
        updated_at: server.updated_at,
        working_directory: server.working_directory.clone(),
    }
}

fn find_server_record(app: &tauri::AppHandle, id: &str) -> Result<McpServerRecord, String> {
    let database = load_database(app)?;
    database
        .servers
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "MCP server was not found.".to_string())
}

fn create_probe_record(request: &McpTestServerRequest) -> Result<McpServerRecord, String> {
    let input = normalize_test_server_input(request)?;

    Ok(McpServerRecord {
        args: input.args,
        authorization_token: input.authorization_token,
        command: input.command,
        created_at: None,
        enabled: true,
        endpoint: input.endpoint,
        environment: input.environment,
        headers: input.headers,
        query_params: input.query_params,
        id: "test".to_string(),
        last_connected_at: None,
        last_error: None,
        name: "Test MCP server".to_string(),
        protocol_version: None,
        server_name: None,
        server_version: None,
        tools: Vec::new(),
        transport: input.transport,
        updated_at: None,
        working_directory: input.working_directory,
    })
}

fn update_server_after_probe(
    app: &tauri::AppHandle,
    state: &McpState,
    server_id: &str,
    probe: &McpProbeResult,
    last_error: Option<String>,
) -> Result<(McpConnectionState, McpServerState), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(app)?;
    let now = now_millis();
    let server = database
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "MCP server was not found.".to_string())?;

    server.last_connected_at = Some(now);
    server.last_error = last_error;
    server.protocol_version = probe.protocol_version.clone();
    server.server_name = probe.server_name.clone();
    server.server_version = probe.server_version.clone();
    server.tools = probe.tools.clone();
    server.updated_at = Some(now);

    save_database(app, &database)?;
    let state_response = create_connection_state(&database);
    let server_response = state_response
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| "MCP server was updated but could not be reloaded.".to_string())?;

    Ok((state_response, server_response))
}

fn update_server_after_error(
    app: &tauri::AppHandle,
    state: &McpState,
    server_id: &str,
    error: &str,
) -> Result<(McpConnectionState, McpServerState), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(app)?;
    let now = now_millis();
    let server = database
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "MCP server was not found.".to_string())?;

    server.last_error = Some(error.to_string());
    server.updated_at = Some(now);

    save_database(app, &database)?;
    let state_response = create_connection_state(&database);
    let server_response = state_response
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| "MCP server was updated but could not be reloaded.".to_string())?;

    Ok((state_response, server_response))
}

async fn probe_server(
    record: &McpServerRecord,
    progress: Option<McpProgressSender>,
    stdio_sessions: Option<StdioSessionCache>,
) -> Result<McpProbeResult, String> {
    if is_stdio_transport(record) {
        let record = record.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            if let Some(stdio_sessions) = stdio_sessions {
                probe_stdio_server_persistent(&stdio_sessions, &record, progress)
            } else {
                probe_stdio_server(&record, progress)
            }
        })
        .await
        .map_err(|error| format!("MCP stdio task failed: {error}"))?;
    }

    send_mcp_progress(
        progress.as_ref(),
        "step",
        format!(
            "Connecting to {}.",
            record.endpoint.as_deref().unwrap_or("MCP endpoint")
        ),
        None,
    );
    let client = mcp_client()?;
    let initialized = initialize_server(&client, record).await?;
    send_mcp_progress(
        progress.as_ref(),
        "step",
        "Server initialized. Loading tools.".to_string(),
        None,
    );
    let tools = list_server_tools(&client, record, initialized.session_id.as_deref()).await?;

    Ok(McpProbeResult {
        protocol_version: initialized.protocol_version,
        server_name: initialized.server_name,
        server_version: initialized.server_version,
        tools,
    })
}

async fn initialize_server(
    client: &reqwest::Client,
    record: &McpServerRecord,
) -> Result<McpInitializeResult, String> {
    let response = mcp_rpc_request(
        client,
        record,
        "initialize",
        Some(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "Gilbert Codex",
                "version": "0.5.5"
            }
        })),
        None,
    )
    .await?;

    let session_id = response.session_id;
    let _ = mcp_rpc_notification(
        client,
        record,
        "notifications/initialized",
        Some(json!({})),
        session_id.as_deref(),
    )
    .await;

    Ok(McpInitializeResult {
        protocol_version: response
            .result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_name: response
            .result
            .pointer("/serverInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_version: response
            .result
            .pointer("/serverInfo/version")
            .and_then(Value::as_str)
            .map(str::to_string),
        session_id,
    })
}

async fn list_server_tools(
    client: &reqwest::Client,
    record: &McpServerRecord,
    session_id: Option<&str>,
) -> Result<Vec<McpToolSummary>, String> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    let mut next_session_id = session_id.map(str::to_string);

    for _ in 0..MCP_MAX_TOOL_LIST_PAGES {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        let response = mcp_rpc_request(
            client,
            record,
            "tools/list",
            Some(params),
            next_session_id.as_deref(),
        )
        .await?;

        if response.session_id.is_some() {
            next_session_id = response.session_id;
        }

        extend_tool_summaries(&mut tools, &response.result);
        tools.truncate(MCP_MAX_TOOLS_PER_SERVER);

        cursor = response
            .result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_string);

        if cursor.is_none() || tools.len() >= MCP_MAX_TOOLS_PER_SERVER {
            break;
        }
    }

    Ok(filter_mcp_tools_for_server(record, tools))
}

async fn call_server_tool(
    record: &McpServerRecord,
    stdio_sessions: StdioSessionCache,
    tool_name: &str,
    arguments: Value,
    progress: Option<McpProgressSender>,
) -> Result<Value, String> {
    if is_firebase_mcp_server(record) && is_firebase_mcp_login_tool(tool_name) {
        return Ok(firebase_mcp_login_guidance());
    }

    if is_stdio_transport(record) {
        let record = record.clone();
        let tool_name = tool_name.to_string();
        return tauri::async_runtime::spawn_blocking(move || {
            call_stdio_server_tool_persistent(
                &stdio_sessions,
                &record,
                &tool_name,
                arguments,
                progress,
            )
        })
        .await
        .map_err(|error| format!("MCP stdio task failed: {error}"))?;
    }

    send_mcp_progress(
        progress.as_ref(),
        "step",
        format!(
            "Connecting to {}.",
            record.endpoint.as_deref().unwrap_or("MCP endpoint")
        ),
        None,
    );
    let client = mcp_client()?;
    let initialized = initialize_server(&client, record).await?;
    send_mcp_progress(
        progress.as_ref(),
        "step",
        format!("Invoking `{tool_name}`."),
        None,
    );
    let response = mcp_rpc_request(
        &client,
        record,
        "tools/call",
        Some(json!({
            "name": tool_name,
            "arguments": arguments,
        })),
        initialized.session_id.as_deref(),
    )
    .await?;

    Ok(response.result)
}

async fn mcp_rpc_request(
    client: &reqwest::Client,
    record: &McpServerRecord,
    method: &str,
    params: Option<Value>,
    session_id: Option<&str>,
) -> Result<McpRpcResponse, String> {
    let request_id = Uuid::new_v4().to_string();
    let body = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });
    let response = create_rpc_request(client, record, Method::POST, session_id)?
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MCP request `{method}` failed: {error}"))?;
    let headers = response.headers().clone();
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read MCP `{method}` response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "MCP request `{method}` failed with HTTP {}: {}",
            status.as_u16(),
            summarize_response_text(&text)
        ));
    }

    let result = parse_json_rpc_result(&text, Some(&request_id))
        .map_err(|error| format!("MCP `{method}` returned an invalid response: {error}"))?;
    let session_id = response_header(&headers, "mcp-session-id");

    Ok(McpRpcResponse { result, session_id })
}

async fn mcp_rpc_notification(
    client: &reqwest::Client,
    record: &McpServerRecord,
    method: &str,
    params: Option<Value>,
    session_id: Option<&str>,
) -> Result<(), String> {
    let body = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });
    let response = create_rpc_request(client, record, Method::POST, session_id)?
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MCP notification `{method}` failed: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if status.is_success() {
        return Ok(());
    }

    Err(format!(
        "MCP notification `{method}` failed with HTTP {}: {}",
        status.as_u16(),
        summarize_response_text(&text)
    ))
}

fn create_rpc_request(
    client: &reqwest::Client,
    record: &McpServerRecord,
    method: Method,
    session_id: Option<&str>,
) -> Result<reqwest::RequestBuilder, String> {
    let endpoint = record
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .ok_or_else(|| "This MCP server does not have an HTTP endpoint configured.".to_string())?;
    let endpoint = endpoint_with_query_params(endpoint, &record.query_params)?;
    let mut request = client
        .request(method, endpoint)
        .header(header::ACCEPT, "application/json, text/event-stream")
        .header(header::CONTENT_TYPE, "application/json")
        .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
        .header(header::USER_AGENT, USER_AGENT);

    if let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header("Mcp-Session-Id", session_id);
    }

    if let Some(token) = record
        .authorization_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        request = request.bearer_auth(token);
    }

    for item in &record.headers {
        let name = item.name.trim();
        let value = item.value.trim();

        if name.is_empty() || value.is_empty() {
            continue;
        }

        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("HTTP header `{name}` is not a valid header name."))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|_| format!("HTTP header `{name}` has an invalid value."))?;
        request = request.header(header_name, header_value);
    }

    Ok(request)
}

fn endpoint_with_query_params(
    endpoint: &str,
    query_params: &[McpHttpQueryParam],
) -> Result<Url, String> {
    let mut url = Url::parse(endpoint)
        .map_err(|error| format!("MCP endpoint is not a valid URL: {error}"))?;

    {
        let mut pairs = url.query_pairs_mut();

        for item in query_params {
            let name = item.name.trim();
            let value = item.value.trim();

            if name.is_empty() || value.is_empty() {
                continue;
            }

            pairs.append_pair(name, value);
        }
    }

    Ok(url)
}

fn probe_stdio_server(
    record: &McpServerRecord,
    progress: Option<McpProgressSender>,
) -> Result<McpProbeResult, String> {
    let mut session = open_stdio_session(record, progress.clone())?;
    let result = (|| {
        send_mcp_progress(
            progress.as_ref(),
            "step",
            "Process started. Waiting for MCP initialize.".to_string(),
            None,
        );
        let initialized = initialize_stdio_server(&mut session)?;
        let _ = stdio_rpc_notification(&mut session, "notifications/initialized", Some(json!({})));
        send_mcp_progress(
            progress.as_ref(),
            "step",
            "Server initialized. Loading tools.".to_string(),
            None,
        );
        let tools = filter_mcp_tools_for_server(record, list_stdio_server_tools(&mut session)?);

        Ok(McpProbeResult {
            protocol_version: initialized.protocol_version,
            server_name: initialized.server_name,
            server_version: initialized.server_version,
            tools,
        })
    })();

    shutdown_stdio_session(session);
    result
}

fn probe_stdio_server_persistent(
    stdio_sessions: &StdioSessionCache,
    record: &McpServerRecord,
    progress: Option<McpProgressSender>,
) -> Result<McpProbeResult, String> {
    with_persistent_stdio_session(stdio_sessions, record, progress.clone(), |entry| {
        send_mcp_progress(
            progress.as_ref(),
            "step",
            "Loading tools from the running MCP process.".to_string(),
            None,
        );
        let tools =
            filter_mcp_tools_for_server(record, list_stdio_server_tools(&mut entry.session)?);

        Ok(McpProbeResult {
            protocol_version: entry.initialized.protocol_version.clone(),
            server_name: entry.initialized.server_name.clone(),
            server_version: entry.initialized.server_version.clone(),
            tools,
        })
    })
}

#[cfg(test)]
fn call_stdio_server_tool(
    record: &McpServerRecord,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    if is_firebase_mcp_server(record) && is_firebase_mcp_login_tool(tool_name) {
        return Ok(firebase_mcp_login_guidance());
    }

    let mut session = open_stdio_session(record, None)?;
    let result = (|| {
        let _initialized = initialize_stdio_server(&mut session)?;
        let _ = stdio_rpc_notification(&mut session, "notifications/initialized", Some(json!({})));
        stdio_rpc_request(
            &mut session,
            "tools/call",
            Some(json!({
                "name": tool_name,
                "arguments": arguments,
            })),
        )
    })();

    shutdown_stdio_session(session);
    result
}

fn call_stdio_server_tool_persistent(
    stdio_sessions: &StdioSessionCache,
    record: &McpServerRecord,
    tool_name: &str,
    arguments: Value,
    progress: Option<McpProgressSender>,
) -> Result<Value, String> {
    if is_firebase_mcp_server(record) && is_firebase_mcp_login_tool(tool_name) {
        return Ok(firebase_mcp_login_guidance());
    }

    with_persistent_stdio_session(stdio_sessions, record, progress, |entry| {
        stdio_rpc_request(
            &mut entry.session,
            "tools/call",
            Some(json!({
                "name": tool_name,
                "arguments": arguments,
            })),
        )
    })
}

fn with_persistent_stdio_session<T>(
    stdio_sessions: &StdioSessionCache,
    record: &McpServerRecord,
    progress: Option<McpProgressSender>,
    action: impl FnOnce(&mut CachedStdioMcpSession) -> Result<T, String>,
) -> Result<T, String> {
    let config_key = stdio_session_config_key(record);
    let mut sessions = stdio_sessions
        .lock()
        .map_err(|_| "The MCP stdio session store is busy. Try again in a moment.".to_string())?;
    let mut restart_reason: Option<String> = None;

    if let Some(entry) = sessions.get_mut(&record.id) {
        if entry.config_key != config_key {
            restart_reason =
                Some("MCP server configuration changed; restarting the stdio process.".to_string());
        } else {
            match entry.session.child.try_wait() {
                Ok(Some(status)) => {
                    restart_reason = Some(format!(
                        "MCP stdio process exited with {status}; starting a fresh process."
                    ));
                }
                Ok(None) => {}
                Err(error) => {
                    restart_reason = Some(format!(
                        "Could not inspect the MCP stdio process ({error}); starting a fresh process."
                    ));
                }
            }
        }
    }

    if restart_reason.is_some() || !sessions.contains_key(&record.id) {
        if let Some(reason) = restart_reason {
            send_mcp_progress(progress.as_ref(), "step", reason, None);
        }

        if let Some(entry) = sessions.remove(&record.id) {
            shutdown_stdio_session(entry.session);
        }

        let entry = open_initialized_stdio_session(record, progress.clone(), config_key)?;
        sessions.insert(record.id.clone(), entry);
    }

    let result = {
        let entry = sessions
            .get_mut(&record.id)
            .ok_or_else(|| "MCP stdio session was not available after startup.".to_string())?;
        action(entry)
    };

    if let Err(error) = &result {
        if is_broken_stdio_session_error(error) {
            if let Some(entry) = sessions.remove(&record.id) {
                shutdown_stdio_session(entry.session);
            }
        }
    }

    result
}

fn open_initialized_stdio_session(
    record: &McpServerRecord,
    progress: Option<McpProgressSender>,
    config_key: String,
) -> Result<CachedStdioMcpSession, String> {
    let mut session = open_stdio_session(record, progress.clone())?;
    let initialized = (|| {
        send_mcp_progress(
            progress.as_ref(),
            "step",
            "Process started. Waiting for MCP initialize.".to_string(),
            None,
        );
        let initialized = initialize_stdio_server(&mut session)?;
        let _ = stdio_rpc_notification(&mut session, "notifications/initialized", Some(json!({})));
        Ok(initialized)
    })();

    match initialized {
        Ok(initialized) => Ok(CachedStdioMcpSession {
            config_key,
            initialized,
            session,
        }),
        Err(error) => {
            shutdown_stdio_session(session);
            Err(error)
        }
    }
}

fn initialize_stdio_server(session: &mut StdioMcpSession) -> Result<McpInitializeResult, String> {
    let result = stdio_rpc_request(
        session,
        "initialize",
        Some(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "Gilbert Codex",
                "version": "0.5.5"
            }
        })),
    )?;

    Ok(McpInitializeResult {
        protocol_version: result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_name: result
            .pointer("/serverInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_version: result
            .pointer("/serverInfo/version")
            .and_then(Value::as_str)
            .map(str::to_string),
        session_id: None,
    })
}

fn list_stdio_server_tools(session: &mut StdioMcpSession) -> Result<Vec<McpToolSummary>, String> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;

    for _ in 0..MCP_MAX_TOOL_LIST_PAGES {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        let result = stdio_rpc_request(session, "tools/list", Some(params))?;

        extend_tool_summaries(&mut tools, &result);
        tools.truncate(MCP_MAX_TOOLS_PER_SERVER);

        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_string);

        if cursor.is_none() || tools.len() >= MCP_MAX_TOOLS_PER_SERVER {
            break;
        }
    }

    Ok(tools)
}

fn resolve_stdio_command(command: &str) -> Result<ResolvedStdioCommand, String> {
    let command = command.trim();

    if command.is_empty() {
        return Err("This MCP stdio server does not have a command configured.".to_string());
    }

    #[cfg(windows)]
    {
        return resolve_stdio_command_windows(command);
    }

    #[cfg(not(windows))]
    {
        return resolve_stdio_command_unix(command);
    }
}

#[cfg(windows)]
fn resolve_stdio_command_windows(command: &str) -> Result<ResolvedStdioCommand, String> {
    if command_looks_like_path(command) {
        let path = PathBuf::from(command);
        let resolved = resolve_path_like_windows_command(&path).unwrap_or(path);
        return Ok(resolved_stdio_command_from_path(resolved));
    }

    if let Some(path) = find_windows_stdio_command(command) {
        return Ok(resolved_stdio_command_from_path(path));
    }

    if is_windows_runtime_shim(command) {
        return Err(format!(
            "`{command}` was not found on PATH or in common runtime folders. Gilbert can auto-resolve npm/Node shims such as `npx.cmd` when Node.js is installed, but no matching executable was found."
        ));
    }

    Ok(ResolvedStdioCommand {
        executable: command.to_string(),
        extra_path_dirs: Vec::new(),
    })
}

fn command_looks_like_path(command: &str) -> bool {
    command.contains('\\') || command.contains('/') || Path::new(command).is_absolute()
}

#[cfg(not(windows))]
fn resolve_stdio_command_unix(command: &str) -> Result<ResolvedStdioCommand, String> {
    let mut extra_path_dirs = native_runtime_path_dirs();

    if command_looks_like_path(command) {
        let path = expand_home_path(PathBuf::from(command));

        if let Some(parent) = path.parent() {
            extra_path_dirs.insert(0, parent.to_path_buf());
        }

        return Ok(ResolvedStdioCommand {
            executable: path.to_string_lossy().to_string(),
            extra_path_dirs,
        });
    }

    let executable = resolve_native_executable(command);

    if executable.is_file() {
        if let Some(parent) = executable.parent() {
            extra_path_dirs.insert(0, parent.to_path_buf());
        }
    }

    Ok(ResolvedStdioCommand {
        executable: executable.to_string_lossy().to_string(),
        extra_path_dirs,
    })
}

#[cfg(windows)]
fn resolve_path_like_windows_command(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }

    if path.extension().is_some() {
        return None;
    }

    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let name = path.file_name()?.to_string_lossy();

    windows_stdio_command_candidates(&name)
        .into_iter()
        .map(|candidate| parent.join(candidate))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn resolved_stdio_command_from_path(path: PathBuf) -> ResolvedStdioCommand {
    let extra_path_dirs = path
        .parent()
        .map(|parent| vec![parent.to_path_buf()])
        .unwrap_or_default();

    ResolvedStdioCommand {
        executable: path.to_string_lossy().to_string(),
        extra_path_dirs,
    }
}

#[cfg(windows)]
fn find_windows_stdio_command(command: &str) -> Option<PathBuf> {
    find_windows_stdio_command_in_dirs(command, &windows_stdio_search_dirs())
}

#[cfg(windows)]
fn find_windows_stdio_command_in_dirs(command: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let name = Path::new(command)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| command.to_string());
    let candidates = windows_stdio_command_candidates(&name);

    for dir in dirs {
        for candidate in &candidates {
            let path = dir.join(candidate);

            if path.is_file() {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(windows)]
fn windows_stdio_command_candidates(command: &str) -> Vec<String> {
    let trimmed = command.trim();
    let lower = trimmed.to_ascii_lowercase();

    if Path::new(trimmed).extension().is_some() {
        return vec![trimmed.to_string()];
    }

    let mut candidates = match lower.as_str() {
        "node" => vec![
            "node.exe".to_string(),
            "node.cmd".to_string(),
            "node.bat".to_string(),
        ],
        "npm" | "npx" | "pnpm" | "yarn" => vec![
            format!("{trimmed}.cmd"),
            format!("{trimmed}.exe"),
            format!("{trimmed}.bat"),
        ],
        "uv" | "uvx" => vec![
            format!("{trimmed}.exe"),
            format!("{trimmed}.cmd"),
            format!("{trimmed}.bat"),
        ],
        _ => vec![
            format!("{trimmed}.exe"),
            format!("{trimmed}.cmd"),
            format!("{trimmed}.bat"),
        ],
    };
    candidates.push(trimmed.to_string());
    candidates
}

#[cfg(windows)]
fn windows_stdio_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(path) = env::var_os("PATH") {
        dirs.extend(env::split_paths(&path));
    }

    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = env::var_os(key) {
            dirs.push(PathBuf::from(root).join("nodejs"));
        }
    }

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        dirs.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("nodejs"),
        );
    }

    if let Some(app_data) = env::var_os("APPDATA") {
        dirs.push(PathBuf::from(app_data).join("npm"));
    }

    if let Some(user_profile) = env::var_os("USERPROFILE") {
        let user_profile = PathBuf::from(user_profile);
        dirs.push(user_profile.join(".local").join("bin"));
        dirs.push(user_profile.join(".cargo").join("bin"));
    }

    dedupe_paths(dirs)
}

#[cfg(windows)]
fn is_windows_runtime_shim(command: &str) -> bool {
    matches!(
        command.to_ascii_lowercase().as_str(),
        "node" | "npm" | "npx" | "pnpm" | "yarn" | "uv" | "uvx"
    )
}

fn prepend_stdio_path_dirs(process: &mut Command, dirs: &[PathBuf]) {
    if dirs.is_empty() {
        return;
    }

    let mut paths = dedupe_paths(dirs.to_vec());

    if let Some(existing) = env::var_os("PATH") {
        paths.extend(env::split_paths(&existing));
        paths = dedupe_paths(paths);
    }

    if let Ok(joined) = env::join_paths(paths) {
        process.env("PATH", joined);
    }
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped: Vec<PathBuf> = Vec::new();

    for path in paths {
        if path.as_os_str().is_empty() {
            continue;
        }

        let key = path.to_string_lossy().to_ascii_lowercase();
        let exists = deduped
            .iter()
            .any(|existing| existing.to_string_lossy().to_ascii_lowercase() == key);

        if !exists {
            deduped.push(path);
        }
    }

    deduped
}

fn command_is_package_runner(command: &str) -> bool {
    let file_name = Path::new(command)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();

    matches!(
        file_name.as_str(),
        "npm" | "npx" | "pnpm" | "yarn" | "uv" | "uvx"
    )
}

fn send_mcp_progress(
    progress: Option<&McpProgressSender>,
    kind: &str,
    message: String,
    stream: Option<String>,
) {
    let Some(progress) = progress else {
        return;
    };

    let message = truncate_chars(&sanitize_sensitive_mcp_text(message.trim()), 1_200);

    if message.is_empty() {
        return;
    }

    let _ = progress.send(McpServerProgressEvent {
        kind: kind.to_string(),
        message,
        stream,
    });
}

fn sanitize_stdio_progress_line(line: &str) -> Option<String> {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return None;
    }

    let lowered = trimmed.to_ascii_lowercase();
    if lowered.contains("token=")
        || lowered.contains("authorization:")
        || lowered.contains("password=")
        || lowered.contains("secret=")
        || lowered.contains("code=")
        || lowered.contains("access_token=")
        || lowered.contains("refresh_token=")
        || lowered.contains("id_token=")
    {
        return Some("MCP server wrote a hidden diagnostic line.".to_string());
    }

    Some(truncate_chars(&sanitize_sensitive_mcp_text(trimmed), 1_200))
}

#[derive(Default)]
struct StdioProgressThrottle {
    last_sent_at: Option<Instant>,
    latest_suppressed: Option<String>,
    suppressed_count: usize,
}

fn collect_due_stdio_progress_messages(
    throttle: &mut StdioProgressThrottle,
    message: String,
    now: Instant,
) -> Vec<String> {
    let Some(last_sent_at) = throttle.last_sent_at else {
        throttle.last_sent_at = Some(now);
        return vec![message];
    };

    if now.duration_since(last_sent_at) < Duration::from_millis(MCP_STDIO_PROGRESS_MIN_INTERVAL_MS)
    {
        throttle.suppressed_count += 1;
        throttle.latest_suppressed = Some(message);
        return Vec::new();
    }

    let mut messages = flush_stdio_progress_throttle(throttle);
    messages.push(message);
    throttle.last_sent_at = Some(now);
    messages
}

fn flush_stdio_progress_throttle(throttle: &mut StdioProgressThrottle) -> Vec<String> {
    if throttle.suppressed_count == 0 {
        return Vec::new();
    }

    let suffix = throttle
        .latest_suppressed
        .take()
        .map(|latest| format!(" Latest: {latest}"))
        .unwrap_or_default();
    let count = throttle.suppressed_count;
    throttle.suppressed_count = 0;

    vec![format!(
        "{count} additional MCP stderr update{} suppressed for UI performance.{suffix}",
        if count == 1 { "" } else { "s" }
    )]
}

fn open_stdio_session(
    record: &McpServerRecord,
    progress: Option<McpProgressSender>,
) -> Result<StdioMcpSession, String> {
    let command = record
        .command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .ok_or_else(|| "This MCP stdio server does not have a command configured.".to_string())?;
    let resolved_command = resolve_stdio_command(command)?;
    let mut process = Command::new(&resolved_command.executable);
    let arg_count = record.args.len();

    send_mcp_progress(
        progress.as_ref(),
        "step",
        format!(
            "Starting `{}` with {} argument{}.",
            command,
            arg_count,
            if arg_count == 1 { "" } else { "s" }
        ),
        None,
    );

    if command_is_package_runner(command) || command_is_package_runner(&resolved_command.executable)
    {
        send_mcp_progress(
            progress.as_ref(),
            "download",
            "If this MCP package is not cached yet, the package runner is downloading it now."
                .to_string(),
            None,
        );
    }

    process
        .args(&record.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_command_window(&mut process);

    prepend_stdio_path_dirs(&mut process, &resolved_command.extra_path_dirs);

    if let Some(working_directory) = record
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        process.current_dir(working_directory);
    }

    for item in &record.environment {
        let name = item.name.trim();

        if !name.is_empty() {
            process.env(name, &item.value);
        }
    }

    let mut child = process.spawn().map_err(|error| {
        if resolved_command.executable == command {
            format!("Could not start MCP stdio server `{command}`: {error}")
        } else {
            format!(
                "Could not start MCP stdio server `{command}` resolved to `{}`: {error}",
                resolved_command.executable
            )
        }
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open stdin for the MCP stdio server.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open stdout for the MCP stdio server.".to_string())?;
    let stderr = child.stderr.take();
    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if stdout_tx.send(line).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = stdout_tx.send(format!("__gilbert_stdio_read_error__:{error}"));
                    break;
                }
            }
        }
    });

    if let Some(stderr) = stderr {
        let progress = progress.clone();
        thread::spawn(move || {
            let mut progress_throttle = StdioProgressThrottle::default();
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(line) => {
                        if let Some(progress) = progress.as_ref() {
                            if let Some(message) = sanitize_stdio_progress_line(&line) {
                                for message in collect_due_stdio_progress_messages(
                                    &mut progress_throttle,
                                    message,
                                    Instant::now(),
                                ) {
                                    send_mcp_progress(
                                        Some(progress),
                                        "output",
                                        message,
                                        Some("stderr".to_string()),
                                    );
                                }
                            }
                        }

                        if stderr_tx.send(line).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = stderr_tx.send(format!("stderr read error: {error}"));
                        break;
                    }
                }
            }

            if let Some(progress) = progress.as_ref() {
                for message in flush_stdio_progress_throttle(&mut progress_throttle) {
                    send_mcp_progress(
                        Some(progress),
                        "output",
                        message,
                        Some("stderr".to_string()),
                    );
                }
            }
        });
    }

    Ok(StdioMcpSession {
        child,
        stderr_rx,
        stdin,
        stdout_rx,
    })
}

fn stdio_rpc_request(
    session: &mut StdioMcpSession,
    method: &str,
    params: Option<Value>,
) -> Result<Value, String> {
    let request_id = Uuid::new_v4().to_string();
    let body = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });

    write_stdio_message(session, &body, method)?;
    wait_for_stdio_response(session, &request_id, method)
}

fn stdio_rpc_notification(
    session: &mut StdioMcpSession,
    method: &str,
    params: Option<Value>,
) -> Result<(), String> {
    let body = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });

    write_stdio_message(session, &body, method)
}

fn write_stdio_message(
    session: &mut StdioMcpSession,
    body: &Value,
    method: &str,
) -> Result<(), String> {
    let text = serde_json::to_string(body)
        .map_err(|error| format!("Could not serialize MCP stdio `{method}` request: {error}"))?;

    if text.contains('\n') || text.contains('\r') {
        return Err(format!(
            "MCP stdio `{method}` request contained an embedded newline."
        ));
    }

    session
        .stdin
        .write_all(text.as_bytes())
        .and_then(|_| session.stdin.write_all(b"\n"))
        .and_then(|_| session.stdin.flush())
        .map_err(|error| format!("Could not write MCP stdio `{method}` request: {error}"))
}

fn wait_for_stdio_response(
    session: &mut StdioMcpSession,
    request_id: &str,
    method: &str,
) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(MCP_STDIO_TIMEOUT_SECS);
    let mut last_non_matching: Option<String> = None;

    loop {
        let now = Instant::now();

        if now >= deadline {
            return Err(format!(
                "MCP stdio request `{method}` timed out waiting for a JSON-RPC response.{}",
                format_stdio_stderr_suffix(session)
            ));
        }

        let remaining = deadline.saturating_duration_since(now);

        match session.stdout_rx.recv_timeout(remaining) {
            Ok(line) => {
                let line = line.trim_end_matches('\r').trim();

                if line.is_empty() {
                    continue;
                }

                if let Some(error) = line.strip_prefix("__gilbert_stdio_read_error__:") {
                    return Err(format!("Could not read MCP stdio stdout: {error}"));
                }

                let value = serde_json::from_str::<Value>(line).map_err(|error| {
                    format!(
                        "MCP stdio server wrote non-JSON-RPC stdout for `{method}`: {error}.{}",
                        format_stdio_stderr_suffix(session)
                    )
                })?;

                if let Some(result) =
                    parse_json_rpc_value(value, Some(request_id), &mut last_non_matching)?
                {
                    return Ok(result);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(format!(
                    "MCP stdio request `{method}` timed out waiting for a JSON-RPC response.{}",
                    format_stdio_stderr_suffix(session)
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let exit_status = match session.child.try_wait() {
                    Ok(Some(status)) => format!(" Process exited with {status}."),
                    Ok(None) => " Stdout closed while the process was still running.".to_string(),
                    Err(error) => format!(" Could not inspect process status: {error}."),
                };

                return Err(format!(
                    "MCP stdio server closed stdout before responding to `{method}`.{exit_status}{}",
                    format_stdio_stderr_suffix(session)
                ));
            }
        }
    }
}

fn format_stdio_stderr_suffix(session: &StdioMcpSession) -> String {
    let stderr = drain_stdio_stderr(session);

    if stderr.is_empty() {
        String::new()
    } else {
        format!(
            " Stderr: {}",
            truncate_chars(&sanitize_sensitive_mcp_text(&stderr.join("\n")), 900)
        )
    }
}

fn drain_stdio_stderr(session: &StdioMcpSession) -> Vec<String> {
    let mut lines = Vec::new();

    while let Ok(line) = session.stderr_rx.try_recv() {
        if !line.trim().is_empty() {
            lines.push(line);
        }

        if lines.len() >= 12 {
            break;
        }
    }

    lines
}

fn shutdown_stdio_session(mut session: StdioMcpSession) {
    drop(session.stdin);
    let deadline = Instant::now() + Duration::from_millis(MCP_STDIO_SHUTDOWN_TIMEOUT_MS);

    while Instant::now() < deadline {
        match session.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(_) => break,
        }
    }

    let _ = session.child.kill();
    let _ = session.child.wait();
}

fn reset_cached_stdio_session(state: &McpState, server_id: &str) {
    if let Ok(mut sessions) = state.stdio_sessions.lock() {
        if let Some(entry) = sessions.remove(server_id) {
            shutdown_stdio_session(entry.session);
        }
    }
}

fn shutdown_all_cached_stdio_sessions(stdio_sessions: &StdioSessionCache) {
    if let Ok(mut sessions) = stdio_sessions.lock() {
        for (_, entry) in sessions.drain() {
            shutdown_stdio_session(entry.session);
        }
    }
}

fn stdio_session_config_key(record: &McpServerRecord) -> String {
    serde_json::to_string(&json!({
        "args": &record.args,
        "command": &record.command,
        "environment": record.environment.iter().map(|item| json!({
            "name": item.name,
            "value": item.value,
        })).collect::<Vec<_>>(),
        "transport": &record.transport,
        "workingDirectory": &record.working_directory,
    }))
    .unwrap_or_else(|_| {
        format!(
            "{}|{}|{}",
            record.command.as_deref().unwrap_or(""),
            record.args.join("\u{1f}"),
            record.working_directory.as_deref().unwrap_or("")
        )
    })
}

fn is_broken_stdio_session_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();

    lower.contains("could not write mcp stdio")
        || lower.contains("could not read mcp stdio")
        || lower.contains("closed stdout")
        || lower.contains("stdout closed")
        || lower.contains("timed out waiting")
        || lower.contains("non-json-rpc stdout")
        || lower.contains("read error")
        || lower.contains("broken pipe")
}

fn mcp_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(MCP_HTTP_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(MCP_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create MCP HTTP client: {error}"))
}

fn parse_json_rpc_result(text: &str, expected_id: Option<&str>) -> Result<Value, String> {
    let payloads = extract_json_payloads(text);

    if payloads.is_empty() {
        return Err("empty response body".to_string());
    }

    let mut last_non_matching: Option<String> = None;

    for payload in payloads {
        let value = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("invalid JSON-RPC JSON: {error}"))?;

        if let Some(result) = parse_json_rpc_value(value, expected_id, &mut last_non_matching)? {
            return Ok(result);
        }
    }

    Err(last_non_matching.unwrap_or_else(|| "no JSON-RPC result was returned".to_string()))
}

fn parse_json_rpc_value(
    value: Value,
    expected_id: Option<&str>,
    last_non_matching: &mut Option<String>,
) -> Result<Option<Value>, String> {
    if let Value::Array(items) = value {
        for item in items {
            if let Some(result) = parse_json_rpc_value(item, expected_id, last_non_matching)? {
                return Ok(Some(result));
            }
        }

        return Ok(None);
    }

    let Value::Object(mut object) = value else {
        *last_non_matching = Some("JSON-RPC response was not an object".to_string());
        return Ok(None);
    };

    if let Some(expected_id) = expected_id {
        let id_matches = object
            .get("id")
            .map(|id| json_rpc_id_matches(id, expected_id))
            .unwrap_or(false);

        if !id_matches {
            *last_non_matching =
                Some("JSON-RPC response id did not match the request id".to_string());
            return Ok(None);
        }
    }

    if let Some(error) = object.remove("error") {
        return Err(format_json_rpc_error(&error));
    }

    object
        .remove("result")
        .map(Some)
        .ok_or_else(|| "JSON-RPC response did not contain result".to_string())
}

fn extract_json_payloads(text: &str) -> Vec<String> {
    let trimmed = text.trim();

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return vec![trimmed.to_string()];
    }

    let mut payloads = Vec::new();
    let mut event_data = String::new();

    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');

        if line.is_empty() {
            push_sse_event(&mut payloads, &mut event_data);
            continue;
        }

        if line.starts_with(':') {
            continue;
        }

        if let Some(data) = line.strip_prefix("data:") {
            if !event_data.is_empty() {
                event_data.push('\n');
            }
            event_data.push_str(data.trim_start());
        }
    }

    push_sse_event(&mut payloads, &mut event_data);
    payloads
}

fn push_sse_event(payloads: &mut Vec<String>, event_data: &mut String) {
    let payload = event_data.trim();

    if !payload.is_empty() && payload != "[DONE]" {
        payloads.push(payload.to_string());
    }

    event_data.clear();
}

fn json_rpc_id_matches(value: &Value, expected_id: &str) -> bool {
    value.as_str().map(|id| id == expected_id).unwrap_or(false)
        || value
            .as_i64()
            .map(|id| id.to_string() == expected_id)
            .unwrap_or(false)
        || value
            .as_u64()
            .map(|id| id.to_string() == expected_id)
            .unwrap_or(false)
}

fn format_json_rpc_error(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("MCP server returned a JSON-RPC error");
    let message = sanitize_sensitive_mcp_text(message);
    let code = error.get("code").and_then(Value::as_i64);

    match code {
        Some(code) => format!("{message} (code {code})"),
        None => message,
    }
}

fn extend_tool_summaries(tools: &mut Vec<McpToolSummary>, result: &Value) {
    let Some(items) = result.get("tools").and_then(Value::as_array) else {
        return;
    };

    for item in items {
        if tools.len() >= MCP_MAX_TOOLS_PER_SERVER {
            break;
        }

        let Some(name) = item
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };

        tools.push(McpToolSummary {
            description: item
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
            input_schema: item.get("inputSchema").cloned(),
            name: name.to_string(),
        });
    }
}

fn filter_mcp_tools_for_server(
    record: &McpServerRecord,
    tools: Vec<McpToolSummary>,
) -> Vec<McpToolSummary> {
    if !is_firebase_mcp_server(record) {
        return tools;
    }

    tools
        .into_iter()
        .filter(|tool| !is_firebase_mcp_login_tool(&tool.name))
        .collect()
}

fn resolve_mcp_tool_name(record: &McpServerRecord, requested_tool_name: &str) -> String {
    let requested = requested_tool_name.trim();

    if requested.is_empty() {
        return requested_tool_name.to_string();
    }

    if let Some(tool) = record.tools.iter().find(|tool| tool.name == requested) {
        return tool.name.clone();
    }

    let requested_key = compact_mcp_name(requested);
    if let Some(tool) = record
        .tools
        .iter()
        .find(|tool| compact_mcp_name(&tool.name) == requested_key)
    {
        return tool.name.clone();
    }

    if is_firebase_mcp_server(record) {
        if let Some(name) = firebase_mcp_tool_alias(&requested_key) {
            return name.to_string();
        }
    }

    requested.to_string()
}

fn normalize_mcp_tool_arguments_for_server(
    record: &McpServerRecord,
    tool_name: &str,
    arguments: Value,
) -> Value {
    if !is_firebase_mcp_server(record) || !is_firebase_update_environment_tool(tool_name) {
        return arguments;
    }

    let Value::Object(mut object) = arguments else {
        return arguments;
    };

    copy_mcp_argument_alias(
        &mut object,
        "project_dir",
        &["projectDir", "projectDirectory", "project_directory"],
    );
    copy_mcp_argument_alias(
        &mut object,
        "active_project",
        &["activeProject", "projectId", "projectID", "activeProjectId"],
    );
    copy_mcp_argument_alias(
        &mut object,
        "active_user_account",
        &["activeUserAccount", "userAccount", "accountEmail"],
    );

    Value::Object(object)
}

fn copy_mcp_argument_alias(object: &mut Map<String, Value>, canonical: &str, aliases: &[&str]) {
    if object.contains_key(canonical) {
        return;
    }

    let Some(value) = aliases.iter().find_map(|alias| object.get(*alias).cloned()) else {
        return;
    };

    object.insert(canonical.to_string(), value);
}

fn maybe_persist_firebase_project_directory(
    app: &tauri::AppHandle,
    state: &McpState,
    server_id: &str,
    record: &McpServerRecord,
    tool_name: &str,
    arguments: &Value,
    is_error: bool,
    fallback_server: McpServerState,
) -> Result<McpServerState, String> {
    if is_error
        || !is_firebase_mcp_server(record)
        || !is_firebase_update_environment_tool(tool_name)
    {
        return Ok(fallback_server);
    }

    let Some(project_dir) = firebase_project_dir_argument(arguments) else {
        return Ok(fallback_server);
    };

    let project_path = PathBuf::from(&project_dir);
    if !project_path.is_absolute() || !project_path.is_dir() {
        return Ok(fallback_server);
    }

    let canonical_project_dir = project_path
        .canonicalize()
        .unwrap_or(project_path)
        .to_string_lossy()
        .to_string();
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(app)?;
    let now = now_millis();
    let server = database
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "MCP server was not found.".to_string())?;

    if server.working_directory.as_deref() == Some(canonical_project_dir.as_str()) {
        return Ok(fallback_server);
    }

    server.working_directory = Some(canonical_project_dir);
    server.updated_at = Some(now);
    save_database(app, &database)?;
    reset_cached_stdio_session(state, server_id);

    let state_response = create_connection_state(&database);
    state_response
        .servers
        .into_iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "MCP server was updated but could not be reloaded.".to_string())
}

fn is_firebase_mcp_server(record: &McpServerRecord) -> bool {
    let name = record.name.to_ascii_lowercase();
    let server_name = record
        .server_name
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let command = record.command.as_deref().unwrap_or("").to_ascii_lowercase();
    let args = record.args.join(" ").to_ascii_lowercase();

    name.contains("firebase")
        || server_name.contains("firebase")
        || args.contains("firebase-tools")
        || command.contains("firebase")
}

fn is_firebase_update_environment_tool(tool_name: &str) -> bool {
    matches!(
        compact_mcp_name(tool_name).as_str(),
        "firebaseupdateenvironment" | "updateenvironment"
    )
}

fn is_firebase_mcp_login_tool(tool_name: &str) -> bool {
    matches!(
        compact_mcp_name(tool_name).as_str(),
        "firebaselogin" | "login"
    )
}

fn firebase_project_dir_argument(arguments: &Value) -> Option<String> {
    arguments
        .get("project_dir")
        .or_else(|| arguments.get("projectDir"))
        .or_else(|| arguments.get("projectDirectory"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains('\0'))
        .map(str::to_string)
}

fn firebase_mcp_tool_alias(compact_name: &str) -> Option<&'static str> {
    match compact_name {
        "firebaselogin" => Some("firebase_login"),
        "firebaselogout" => Some("firebase_logout"),
        "firebasegetproject" => Some("firebase_get_project"),
        "firebaselistapps" => Some("firebase_list_apps"),
        "firebaselistprojects" => Some("firebase_list_projects"),
        "firebasegetsdkconfig" => Some("firebase_get_sdk_config"),
        "firebasecreateproject" => Some("firebase_create_project"),
        "firebasecreateapp" => Some("firebase_create_app"),
        "firebasecreateandroidsha" => Some("firebase_create_android_sha"),
        "firebasegetenvironment" => Some("firebase_get_environment"),
        "firebaseupdateenvironment" => Some("firebase_update_environment"),
        "firebaseinit" => Some("firebase_init"),
        "firebasegetsecurityrules" => Some("firebase_get_security_rules"),
        "firebasereadresources" => Some("firebase_read_resources"),
        "firebasedeploy" => Some("firebase_deploy"),
        "firebasedeploystatus" | "deploystatus" => Some("firebase_deploy_status"),
        _ => None,
    }
}

fn compact_mcp_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn firebase_mcp_login_guidance() -> Value {
    json!({
        "isError": true,
        "content": [{
            "type": "text",
            "text": "Firebase MCP's built-in firebase_login auth-proxy flow is not available in Gilbert because auth.firebase.tools can return `Unable to verify client` before login starts. Do not show the user another auth.firebase.tools URL. If terminal_run is available, run `npx.cmd -y firebase-tools@latest login --reauth` yourself in the user's workspace and tell the user only to finish the Google browser sign-in. If terminal_run is not available, show that exact npx.cmd command. After sign-in completes, retry the Firebase MCP tool. Do not use --no-localhost for this desktop setup."
        }]
    })
}

fn format_mcp_tool_result_content(result: &Value) -> String {
    let mut lines = Vec::new();

    if let Some(items) = result.get("content").and_then(Value::as_array) {
        for (index, item) in items.iter().enumerate() {
            let item_type = item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("content");

            match item_type {
                "text" => {
                    let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                    lines.push(format!("--- Text content {} ---\n{}", index + 1, text));
                }
                "resource" => {
                    let resource = item.get("resource").unwrap_or(item);
                    let uri = resource
                        .get("uri")
                        .and_then(Value::as_str)
                        .unwrap_or("resource");
                    let mime_type = resource.get("mimeType").and_then(Value::as_str);
                    let text = resource.get("text").and_then(Value::as_str);
                    lines.push(
                        [
                            format!("--- Resource content {} ---", index + 1),
                            format!("URI: {uri}"),
                            mime_type
                                .map(|value| format!("MIME: {value}"))
                                .unwrap_or_default(),
                            text.map(|value| format!("Text:\n{value}"))
                                .unwrap_or_default(),
                        ]
                        .into_iter()
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    );
                }
                "image" | "audio" => {
                    let mime_type = item
                        .get("mimeType")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    lines.push(format!(
                        "--- {} content {} ---\nMIME: {}\nBinary data omitted from visible tool result.",
                        item_type,
                        index + 1,
                        mime_type
                    ));
                }
                _ => {
                    lines.push(format!(
                        "--- {} content {} ---\n{}",
                        item_type,
                        index + 1,
                        serde_json::to_string_pretty(item).unwrap_or_else(|_| item.to_string())
                    ));
                }
            }
        }
    }

    if let Some(structured) = result.get("structuredContent") {
        let details = format_structured_mcp_result_details(structured);
        if !details.is_empty() && !lines.iter().any(|line| line.contains(&details)) {
            lines.push(format!("--- Structured content ---\n{details}"));
        }
    }

    if lines.is_empty() {
        if let Some(structured) = result.get("structuredContent") {
            lines.push(format!(
                "Structured content:\n{}",
                serde_json::to_string_pretty(structured).unwrap_or_else(|_| structured.to_string())
            ));
        } else {
            lines.push(serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string()));
        }
    }

    truncate_chars(&lines.join("\n\n"), MCP_MAX_RESULT_CHARS)
}

fn format_structured_mcp_result_details(value: &Value) -> String {
    let Value::Object(object) = value else {
        return serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
    };

    let mut lines = Vec::new();

    for key in ["status", "progress", "error", "message", "jobId"] {
        if let Some(value) = object.get(key) {
            if let Some(text) = structured_scalar_text(value) {
                lines.push(format!("{}: {}", structured_label(key), text));
            }
        }
    }

    if let Some(logs) = object.get("logs").and_then(Value::as_array) {
        let log_lines = logs
            .iter()
            .filter_map(structured_scalar_text)
            .filter(|line| !line.trim().is_empty())
            .take(20)
            .collect::<Vec<_>>();

        if !log_lines.is_empty() {
            lines.push(format!("Logs:\n{}", log_lines.join("\n")));
        }
    }

    if lines.is_empty() {
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
    } else {
        lines.join("\n")
    }
}

fn structured_scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

fn structured_label(key: &str) -> &'static str {
    match key {
        "jobId" => "Job ID",
        "status" => "Status",
        "progress" => "Progress",
        "error" => "Error",
        "message" => "Message",
        _ => "Value",
    }
}

fn sanitize_mcp_visible_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(sanitize_sensitive_mcp_text(text)),
        Value::Array(items) => Value::Array(items.iter().map(sanitize_mcp_visible_value).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), sanitize_mcp_visible_value(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn sanitize_sensitive_mcp_text(text: &str) -> String {
    let text = normalize_known_mcp_guidance(text);
    let mut sanitized = String::with_capacity(text.len());
    let mut token = String::new();

    for character in text.chars() {
        if character.is_whitespace() {
            if !token.is_empty() {
                sanitized.push_str(&sanitize_sensitive_mcp_token(&token));
                token.clear();
            }

            sanitized.push(character);
        } else {
            token.push(character);
        }
    }

    if !token.is_empty() {
        sanitized.push_str(&sanitize_sensitive_mcp_token(&token));
    }

    sanitized
}

fn normalize_known_mcp_guidance(text: &str) -> String {
    text.replace(
        "firebase login --no-localhost",
        "npx.cmd -y firebase-tools@latest login --reauth",
    )
    .replace(
        "Firebase login --no-localhost",
        "npx.cmd -y firebase-tools@latest login --reauth",
    )
    .replace(
        "npx.cmd -y firebase-tools@latest login --no-localhost",
        "npx.cmd -y firebase-tools@latest login --reauth",
    )
    .replace(
        "firebase login",
        "npx.cmd -y firebase-tools@latest login --reauth",
    )
    .replace(
        "Firebase login",
        "npx.cmd -y firebase-tools@latest login --reauth",
    )
}

fn sanitize_sensitive_mcp_token(token: &str) -> String {
    let candidate = token.trim_matches(|character: char| {
        matches!(
            character,
            '"' | '\'' | '<' | '>' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
        )
    });

    if candidate.is_empty() {
        return token.to_string();
    }

    let Ok(mut url) = Url::parse(candidate) else {
        return token.to_string();
    };

    let pairs = url
        .query_pairs()
        .map(|(key, value)| {
            let key_string = key.to_string();
            let value_string = if is_sensitive_oauth_query_key(&key_string) {
                "[redacted]".to_string()
            } else {
                value.to_string()
            };
            (key_string, value_string)
        })
        .collect::<Vec<_>>();

    if !pairs
        .iter()
        .any(|(key, value)| is_sensitive_oauth_query_key(key) && value == "[redacted]")
    {
        return token.to_string();
    }

    url.query_pairs_mut().clear().extend_pairs(
        pairs
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str())),
    );

    token.replace(candidate, url.as_str())
}

fn is_sensitive_oauth_query_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "access_token"
            | "authuser"
            | "code"
            | "id_token"
            | "prompt"
            | "refresh_token"
            | "state"
            | "attest"
            | "code_challenge"
            | "session"
    )
}

fn normalize_server_input(
    request: &McpSaveServerRequest,
) -> Result<NormalizedMcpServerInput, String> {
    normalize_server_config(
        request.transport.as_deref(),
        request.endpoint.as_deref(),
        request.authorization_token.as_deref(),
        request.command.as_deref(),
        request.args.as_ref(),
        request.environment.as_ref(),
        request.headers.as_ref(),
        request.query_params.as_ref(),
        request.working_directory.as_deref(),
    )
}

fn normalize_test_server_input(
    request: &McpTestServerRequest,
) -> Result<NormalizedMcpServerInput, String> {
    normalize_server_config(
        request.transport.as_deref(),
        request.endpoint.as_deref(),
        request.authorization_token.as_deref(),
        request.command.as_deref(),
        request.args.as_ref(),
        request.environment.as_ref(),
        request.headers.as_ref(),
        request.query_params.as_ref(),
        request.working_directory.as_deref(),
    )
}

fn normalize_server_config(
    transport: Option<&str>,
    endpoint: Option<&str>,
    authorization_token: Option<&str>,
    command: Option<&str>,
    args: Option<&Vec<String>>,
    environment: Option<&Vec<McpEnvironmentVariable>>,
    headers: Option<&Vec<McpHttpHeader>>,
    query_params: Option<&Vec<McpHttpQueryParam>>,
    working_directory: Option<&str>,
) -> Result<NormalizedMcpServerInput, String> {
    let transport = normalize_transport(transport, endpoint, command)?;

    if transport == MCP_TRANSPORT_STDIO {
        return Ok(NormalizedMcpServerInput {
            args: normalize_stdio_args(args)?,
            authorization_token: None,
            command: Some(normalize_stdio_command(command)?),
            endpoint: None,
            environment: normalize_stdio_environment(environment)?,
            headers: Vec::new(),
            query_params: Vec::new(),
            transport,
            working_directory: normalize_working_directory(working_directory)?,
        });
    }

    let endpoint = normalize_mcp_endpoint(
        endpoint.ok_or_else(|| "Enter an MCP endpoint before testing.".to_string())?,
    )?;

    Ok(NormalizedMcpServerInput {
        args: Vec::new(),
        authorization_token: normalize_optional_secret(authorization_token),
        command: None,
        endpoint: Some(endpoint),
        environment: Vec::new(),
        headers: normalize_http_headers(headers)?,
        query_params: normalize_http_query_params(query_params)?,
        transport,
        working_directory: None,
    })
}

fn normalize_transport(
    value: Option<&str>,
    endpoint: Option<&str>,
    command: Option<&str>,
) -> Result<String, String> {
    let inferred = if command
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        && endpoint
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        MCP_TRANSPORT_STDIO
    } else {
        MCP_TRANSPORT_HTTP
    };
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(inferred)
        .to_ascii_lowercase()
        .replace(['_', '-'], "");

    match normalized.as_str() {
        "http" | "streamablehttp" => Ok(MCP_TRANSPORT_HTTP.to_string()),
        "stdio" => Ok(MCP_TRANSPORT_STDIO.to_string()),
        _ => Err("MCP transport must be either Streamable HTTP or stdio.".to_string()),
    }
}

fn normalize_existing_transport(server: &McpServerRecord) -> String {
    normalize_transport(
        Some(&server.transport),
        server.endpoint.as_deref(),
        server.command.as_deref(),
    )
    .unwrap_or_else(|_| {
        if server
            .command
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
        {
            MCP_TRANSPORT_STDIO.to_string()
        } else {
            MCP_TRANSPORT_HTTP.to_string()
        }
    })
}

fn normalized_server_target_hint(input: &NormalizedMcpServerInput) -> String {
    if input.transport == MCP_TRANSPORT_STDIO {
        input.command.clone().unwrap_or_else(|| "stdio".to_string())
    } else {
        input.endpoint.clone().unwrap_or_else(|| "mcp".to_string())
    }
}

fn server_record_target_hint(server: &McpServerRecord) -> String {
    if server.transport == MCP_TRANSPORT_STDIO {
        server
            .command
            .clone()
            .unwrap_or_else(|| "stdio".to_string())
    } else {
        server.endpoint.clone().unwrap_or_else(|| "mcp".to_string())
    }
}

fn has_valid_record_target(server: &McpServerRecord) -> bool {
    if server.transport == MCP_TRANSPORT_STDIO {
        return server
            .command
            .as_deref()
            .map(str::trim)
            .filter(|command| !command.is_empty())
            .is_some();
    }

    server
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .is_some()
}

fn server_matches_normalized_input(
    server: &McpServerRecord,
    input: &NormalizedMcpServerInput,
) -> bool {
    server_target_key(server) == normalized_input_target_key(input)
}

fn dedupe_servers_by_target(database: &mut McpDatabase) {
    let mut seen = HashSet::new();

    database.servers.reverse();
    database
        .servers
        .retain(|server| seen.insert(server_target_key(server)));
    database.servers.reverse();
}

fn server_target_key(server: &McpServerRecord) -> String {
    if server.transport == MCP_TRANSPORT_STDIO {
        return format!(
            "stdio|{}|{}|{}",
            normalize_command_key(server.command.as_deref()),
            normalize_arg_key(&server.args),
            normalize_optional_text_key(server.working_directory.as_deref())
        );
    }

    format!(
        "http|{}",
        normalize_endpoint_key(server.endpoint.as_deref())
    )
}

fn normalized_input_target_key(input: &NormalizedMcpServerInput) -> String {
    if input.transport == MCP_TRANSPORT_STDIO {
        return format!(
            "stdio|{}|{}|{}",
            normalize_command_key(input.command.as_deref()),
            normalize_arg_key(&input.args),
            normalize_optional_text_key(input.working_directory.as_deref())
        );
    }

    format!("http|{}", normalize_endpoint_key(input.endpoint.as_deref()))
}

fn normalize_command_key(value: Option<&str>) -> String {
    let normalized = normalize_optional_text_key(value);

    normalized
        .strip_suffix(".cmd")
        .unwrap_or(normalized.as_str())
        .to_string()
}

fn normalize_arg_key(args: &[String]) -> String {
    args.iter()
        .map(|arg| arg.trim())
        .filter(|arg| !arg.is_empty())
        .collect::<Vec<_>>()
        .join("\u{1f}")
}

fn normalize_endpoint_key(value: Option<&str>) -> String {
    normalize_optional_text_key(value)
        .trim_end_matches('/')
        .to_string()
}

fn normalize_optional_text_key(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_stdio_transport(record: &McpServerRecord) -> bool {
    record.transport == MCP_TRANSPORT_STDIO
}

fn normalize_stdio_command(value: Option<&str>) -> Result<String, String> {
    let command = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Enter a command for this MCP stdio server.".to_string())?;

    if command.contains('\0') || command.chars().count() > 512 {
        return Err("MCP stdio command is invalid or too long.".to_string());
    }

    Ok(command.to_string())
}

fn normalize_optional_stdio_command(value: Option<&str>) -> Option<String> {
    normalize_stdio_command(value).ok()
}

fn normalize_stdio_args(value: Option<&Vec<String>>) -> Result<Vec<String>, String> {
    let Some(args) = value else {
        return Ok(Vec::new());
    };

    if args.len() > MCP_MAX_STDIO_ARGS {
        return Err(format!(
            "MCP stdio servers can have at most {MCP_MAX_STDIO_ARGS} arguments."
        ));
    }

    let mut normalized = Vec::new();

    for arg in args {
        let arg = arg.trim();

        if arg.is_empty() {
            continue;
        }

        if arg.contains('\0')
            || arg.contains('\n')
            || arg.contains('\r')
            || arg.chars().count() > 2_048
        {
            return Err("One MCP stdio argument is invalid or too long.".to_string());
        }

        normalized.push(arg.to_string());
    }

    Ok(normalized)
}

fn normalize_existing_stdio_args(value: &[String]) -> Vec<String> {
    normalize_stdio_args(Some(&value.to_vec())).unwrap_or_default()
}

fn normalize_stdio_environment(
    value: Option<&Vec<McpEnvironmentVariable>>,
) -> Result<Vec<McpEnvironmentVariable>, String> {
    let Some(items) = value else {
        return Ok(Vec::new());
    };

    if items.len() > MCP_MAX_STDIO_ENV {
        return Err(format!(
            "MCP stdio servers can have at most {MCP_MAX_STDIO_ENV} environment variables."
        ));
    }

    let mut normalized = Vec::new();

    for item in items {
        let name = item.name.trim();

        if name.is_empty() {
            continue;
        }

        if name.contains('=') || name.contains('\0') || name.chars().count() > 128 {
            return Err("One MCP stdio environment variable name is invalid.".to_string());
        }

        if item.value.contains('\0') || item.value.chars().count() > 16_000 {
            return Err(format!(
                "Environment variable `{name}` is invalid or too long."
            ));
        }

        normalized.push(McpEnvironmentVariable {
            name: name.to_string(),
            value: item.value.trim().to_string(),
        });
    }

    normalized.truncate(MCP_MAX_STDIO_ENV);
    Ok(normalized)
}

fn normalize_existing_stdio_environment(
    value: &[McpEnvironmentVariable],
) -> Vec<McpEnvironmentVariable> {
    normalize_stdio_environment(Some(&value.to_vec())).unwrap_or_default()
}

fn merge_stdio_environment(
    next: Vec<McpEnvironmentVariable>,
    existing: &[McpEnvironmentVariable],
) -> Vec<McpEnvironmentVariable> {
    next.into_iter()
        .map(|item| {
            if !item.value.is_empty() {
                return item;
            }

            existing
                .iter()
                .find(|old| old.name.eq_ignore_ascii_case(&item.name))
                .cloned()
                .unwrap_or(item)
        })
        .collect()
}

fn normalize_http_headers(
    value: Option<&Vec<McpHttpHeader>>,
) -> Result<Vec<McpHttpHeader>, String> {
    let Some(items) = value else {
        return Ok(Vec::new());
    };

    if items.len() > MCP_MAX_HTTP_HEADERS {
        return Err(format!(
            "MCP HTTP servers can have at most {MCP_MAX_HTTP_HEADERS} custom headers."
        ));
    }

    let mut normalized = Vec::new();
    let mut seen = HashSet::new();

    for item in items {
        let name = item.name.trim();

        if name.is_empty() {
            continue;
        }

        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("HTTP header `{name}` is not a valid header name."))?;
        let header_key = header_name.as_str().to_ascii_lowercase();

        if is_reserved_mcp_http_header(&header_key) {
            return Err(format!(
                "Header `{name}` is managed by Gilbert. Use the bearer token field for Authorization."
            ));
        }

        if item.value.contains('\0') || item.value.chars().count() > 16_000 {
            return Err(format!("HTTP header `{name}` is invalid or too long."));
        }

        HeaderValue::from_str(item.value.trim())
            .map_err(|_| format!("HTTP header `{name}` has an invalid value."))?;

        if seen.insert(header_key) {
            normalized.push(McpHttpHeader {
                name: name.to_string(),
                value: item.value.trim().to_string(),
            });
        }
    }

    normalized.truncate(MCP_MAX_HTTP_HEADERS);
    Ok(normalized)
}

fn normalize_existing_http_headers(value: &[McpHttpHeader]) -> Vec<McpHttpHeader> {
    normalize_http_headers(Some(&value.to_vec())).unwrap_or_default()
}

fn merge_http_headers(next: Vec<McpHttpHeader>, existing: &[McpHttpHeader]) -> Vec<McpHttpHeader> {
    next.into_iter()
        .map(|item| {
            if !item.value.is_empty() {
                return item;
            }

            existing
                .iter()
                .find(|old| old.name.eq_ignore_ascii_case(&item.name))
                .cloned()
                .unwrap_or(item)
        })
        .collect()
}

fn normalize_http_query_params(
    value: Option<&Vec<McpHttpQueryParam>>,
) -> Result<Vec<McpHttpQueryParam>, String> {
    let Some(items) = value else {
        return Ok(Vec::new());
    };

    if items.len() > MCP_MAX_HTTP_HEADERS {
        return Err(format!(
            "MCP HTTP servers can have at most {MCP_MAX_HTTP_HEADERS} secret query parameters."
        ));
    }

    let mut normalized = Vec::new();
    let mut seen = HashSet::new();

    for item in items {
        let name = item.name.trim();

        if name.is_empty() {
            continue;
        }

        if name.contains('\0')
            || name.contains('=')
            || name.contains('&')
            || name.contains('#')
            || name.contains('?')
            || name.chars().count() > 128
        {
            return Err(format!("Query parameter `{name}` has an invalid name."));
        }

        if item.value.contains('\0') || item.value.chars().count() > 16_000 {
            return Err(format!("Query parameter `{name}` is invalid or too long."));
        }

        let key = name.to_ascii_lowercase();

        if seen.insert(key) {
            normalized.push(McpHttpQueryParam {
                name: name.to_string(),
                value: item.value.trim().to_string(),
            });
        }
    }

    normalized.truncate(MCP_MAX_HTTP_HEADERS);
    Ok(normalized)
}

fn normalize_existing_http_query_params(value: &[McpHttpQueryParam]) -> Vec<McpHttpQueryParam> {
    normalize_http_query_params(Some(&value.to_vec())).unwrap_or_default()
}

fn merge_http_query_params(
    next: Vec<McpHttpQueryParam>,
    existing: &[McpHttpQueryParam],
) -> Vec<McpHttpQueryParam> {
    next.into_iter()
        .map(|item| {
            if !item.value.is_empty() {
                return item;
            }

            existing
                .iter()
                .find(|old| old.name.eq_ignore_ascii_case(&item.name))
                .cloned()
                .unwrap_or(item)
        })
        .collect()
}

fn is_reserved_mcp_http_header(name: &str) -> bool {
    matches!(
        name,
        "accept"
            | "authorization"
            | "content-type"
            | "mcp-protocol-version"
            | "mcp-session-id"
            | "user-agent"
    )
}

fn normalize_working_directory(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if value.contains('\0') || value.chars().count() > 1_024 {
        return Err("MCP stdio working directory is invalid or too long.".to_string());
    }

    Ok(Some(value.to_string()))
}

fn normalize_optional_working_directory(value: Option<&str>) -> Option<String> {
    normalize_working_directory(value).ok().flatten()
}

fn is_linkedin_local_mcp_server(command: Option<&str>, args: &[String]) -> bool {
    is_node_command(command)
        && args
            .iter()
            .any(|arg| mcp_arg_matches_relative_path(arg, LINKEDIN_MCP_SERVER_RELATIVE_PATH))
}

fn is_node_command(command: Option<&str>) -> bool {
    let Some(command) = command.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let command_name = Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();
    let command_name = command_name
        .strip_suffix(".cmd")
        .unwrap_or(command_name.as_str());
    let command_name = command_name.strip_suffix(".exe").unwrap_or(command_name);

    command_name == "node"
}

fn mcp_arg_matches_relative_path(arg: &str, relative_path: &str) -> bool {
    let normalized_arg = normalize_mcp_arg_path(arg);
    let normalized_relative = normalize_mcp_arg_path(relative_path);

    normalized_arg == normalized_relative
        || normalized_arg.ends_with(&format!("/{normalized_relative}"))
}

fn normalize_mcp_arg_path(value: &str) -> String {
    let normalized = value.trim().replace('\\', "/");
    normalized
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_ascii_lowercase()
}

fn resolve_first_party_mcp_working_directory(
    app: Option<&tauri::AppHandle>,
    relative_file: &str,
) -> Option<PathBuf> {
    first_party_mcp_working_directory_from_roots(
        relative_file,
        first_party_mcp_working_directory_candidates(app),
    )
}

fn first_party_mcp_working_directory_from_roots(
    relative_file: &str,
    roots: Vec<PathBuf>,
) -> Option<PathBuf> {
    let relative_path = forward_slash_path(relative_file);
    let mut seen = HashSet::new();

    for root in roots {
        let root_key = root.to_string_lossy().to_ascii_lowercase();

        if !seen.insert(root_key) {
            continue;
        }

        if root.join(&relative_path).is_file() {
            return Some(root.canonicalize().unwrap_or(root));
        }
    }

    None
}

fn first_party_mcp_working_directory_candidates(app: Option<&tauri::AppHandle>) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(app) = app {
        if let Ok(resource_server) = app
            .path()
            .resolve(LINKEDIN_MCP_SERVER_RELATIVE_PATH, BaseDirectory::Resource)
        {
            if resource_server.is_file() {
                if let Some(root) = root_from_linkedin_mcp_server_path(&resource_server) {
                    roots.push(root);
                }
            }
        }
    }

    if let Ok(current_dir) = env::current_dir() {
        roots.push(current_dir.join("resources"));
        roots.push(current_dir.clone());

        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
            roots.push(parent.join("resources"));
        }
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    roots.push(manifest_dir.to_path_buf());
    if let Some(parent) = manifest_dir.parent() {
        roots.push(parent.to_path_buf());
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            roots.push(exe_dir.to_path_buf());
            roots.push(exe_dir.join("resources"));
        }
    }

    roots
}

fn root_from_linkedin_mcp_server_path(path: &Path) -> Option<PathBuf> {
    Some(path.parent()?.parent()?.parent()?.parent()?.to_path_buf())
}

fn forward_slash_path(value: &str) -> PathBuf {
    value.split('/').collect()
}

fn normalize_server_name(value: &str) -> Result<String, String> {
    let name = value.trim();

    if name.is_empty() {
        return Err("Enter a name for this MCP server.".to_string());
    }

    if name.chars().count() > 80 {
        return Err("MCP server names must be 80 characters or shorter.".to_string());
    }

    Ok(name.to_string())
}

fn normalize_mcp_endpoint(value: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("Enter an MCP endpoint URL.".to_string());
    }

    let url =
        Url::parse(trimmed).map_err(|error| format!("MCP endpoint is not a valid URL: {error}"))?;
    let scheme = url.scheme();

    if scheme != "https" && scheme != "http" {
        return Err(
            "MCP endpoints must use https://, or http:// for localhost development.".to_string(),
        );
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Put MCP credentials in the bearer token field, not in the URL.".to_string());
    }

    if url.fragment().is_some() {
        return Err("MCP endpoint URLs cannot include fragments.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "MCP endpoint URL must include a host.".to_string())?;

    if scheme == "http" && !is_loopback_host(host) {
        return Err("Plain HTTP MCP endpoints are only allowed for localhost or loopback development servers.".to_string());
    }

    Ok(url.to_string())
}

fn is_loopback_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();

    normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized == "127.0.0.1"
        || normalized == "::1"
}

fn normalize_tool_name(value: &str) -> Result<String, String> {
    let name = value.trim();

    if name.is_empty() {
        return Err("MCP tool name is required.".to_string());
    }

    Ok(name.to_string())
}

fn normalize_tool_arguments(arguments: Option<Value>) -> Result<Value, String> {
    let arguments = arguments.unwrap_or_else(|| Value::Object(Map::new()));

    if !arguments.is_object() {
        return Err("MCP tool arguments must be a JSON object.".to_string());
    }

    let size = serde_json::to_vec(&arguments)
        .map_err(|error| format!("Could not serialize MCP tool arguments: {error}"))?
        .len();

    if size > MCP_MAX_ARGUMENT_BYTES {
        return Err("MCP tool arguments are too large for one call.".to_string());
    }

    Ok(arguments)
}

fn normalize_id(value: &str, label: &str) -> Result<String, String> {
    normalize_optional_id(value).ok_or_else(|| format!("{label} is required."))
}

fn normalize_optional_id(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(96)
        .collect::<String>();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_optional_secret(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn create_server_id(name: &str, endpoint: &str) -> String {
    let mut slug = name
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();

    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }

    slug = slug.trim_matches('-').chars().take(36).collect();

    if slug.is_empty() {
        slug = "mcp-server".to_string();
    }

    let suffix = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let endpoint_hint = endpoint
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or("mcp")
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();

    if endpoint_hint.is_empty() {
        format!("{slug}-{suffix}")
    } else {
        format!("{slug}-{endpoint_hint}-{suffix}")
    }
}

fn response_header(headers: &header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn summarize_response_text(text: &str) -> String {
    let trimmed = text.trim();

    if trimmed.is_empty() {
        return "(empty response)".to_string();
    }

    truncate_chars(&sanitize_sensitive_mcp_text(trimmed), 900)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n[truncated]");
    truncated
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn delete_mcp_server_secrets(
    app: &tauri::AppHandle,
    server_id: &str,
    server: Option<&McpServerRecord>,
) {
    let Ok(namespace) = auth::current_user_storage_namespace(app) else {
        return;
    };
    delete_mcp_secret_field(
        &namespace,
        &format!("servers.{server_id}.authorizationToken"),
    );

    if let Some(server) = server {
        for item in &server.environment {
            delete_mcp_secret_field(
                &namespace,
                &format!("servers.{server_id}.environment.{}", item.name),
            );
        }

        for item in &server.headers {
            delete_mcp_secret_field(
                &namespace,
                &format!("servers.{server_id}.headers.{}", item.name),
            );
        }

        for item in &server.query_params {
            delete_mcp_secret_field(
                &namespace,
                &format!("servers.{server_id}.queryParams.{}", item.name),
            );
        }
    }
}

fn delete_mcp_secret_field(namespace: &str, field: &str) {
    let target = secret_target(namespace, MCP_DATABASE_STORAGE_KEY, field);
    let _ = secure_storage::delete_secret(&target);
}

fn secret_target(namespace: &str, storage_key: &str, field: &str) -> String {
    format!(
        "GilbertCodex/{}/{}/{}",
        sanitize_secret_component(namespace),
        sanitize_secret_component(storage_key),
        sanitize_secret_component(field)
    )
}

fn sanitize_secret_component(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.chars() {
        if sanitized.len() >= 96 {
            break;
        }

        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            sanitized.push(character);
        } else {
            sanitized.push('-');
        }
    }

    if sanitized.is_empty() {
        "value".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, path::PathBuf};

    fn node_available() -> bool {
        Command::new("node").arg("--version").output().is_ok()
    }

    #[test]
    fn detects_linkedin_local_mcp_server_path() {
        let args = vec!["./plugins/linkedin/scripts/linkedin-mcp-server.mjs".to_string()];

        assert!(is_linkedin_local_mcp_server(Some("node"), &args));
        assert!(is_linkedin_local_mcp_server(Some("node.exe"), &args));
        assert!(!is_linkedin_local_mcp_server(Some("npx"), &args));
    }

    #[test]
    fn stdio_progress_throttle_samples_noisy_stderr() {
        let mut throttle = StdioProgressThrottle::default();
        let now = Instant::now();

        assert_eq!(
            collect_due_stdio_progress_messages(&mut throttle, "line 1".to_string(), now),
            vec!["line 1".to_string()]
        );
        assert!(collect_due_stdio_progress_messages(
            &mut throttle,
            "line 2".to_string(),
            now + Duration::from_millis(100),
        )
        .is_empty());
        assert!(collect_due_stdio_progress_messages(
            &mut throttle,
            "line 3".to_string(),
            now + Duration::from_millis(200),
        )
        .is_empty());

        assert_eq!(
            collect_due_stdio_progress_messages(
                &mut throttle,
                "line 4".to_string(),
                now + Duration::from_millis(MCP_STDIO_PROGRESS_MIN_INTERVAL_MS + 1),
            ),
            vec![
                "2 additional MCP stderr updates suppressed for UI performance. Latest: line 3"
                    .to_string(),
                "line 4".to_string(),
            ]
        );
        assert!(flush_stdio_progress_throttle(&mut throttle).is_empty());
    }

    #[test]
    fn stdio_progress_throttle_flushes_trailing_summary() {
        let mut throttle = StdioProgressThrottle::default();
        let now = Instant::now();

        let _ = collect_due_stdio_progress_messages(&mut throttle, "first".to_string(), now);
        let _ = collect_due_stdio_progress_messages(
            &mut throttle,
            "suppressed".to_string(),
            now + Duration::from_millis(10),
        );

        assert_eq!(
            flush_stdio_progress_throttle(&mut throttle),
            vec![
                "1 additional MCP stderr update suppressed for UI performance. Latest: suppressed"
                    .to_string()
            ]
        );
    }

    #[test]
    fn resolves_first_party_mcp_working_directory_from_repo_root() {
        let root = env::temp_dir().join(format!("gilbert-linkedin-mcp-root-{}", Uuid::new_v4()));
        let server_path = root.join("plugins/linkedin/scripts/linkedin-mcp-server.mjs");
        fs::create_dir_all(server_path.parent().expect("server parent"))
            .expect("create linkedin mcp server folder");
        fs::write(&server_path, "process.exit(0);\n").expect("write linkedin mcp server");

        let resolved = first_party_mcp_working_directory_from_roots(
            LINKEDIN_MCP_SERVER_RELATIVE_PATH,
            vec![root.join("src-tauri"), root.clone()],
        )
        .expect("resolve linkedin mcp root");

        assert_eq!(resolved, root.canonicalize().expect("canonical root"));
        let _ = fs::remove_dir_all(root);
    }

    fn write_echo_stdio_server() -> PathBuf {
        let path = env::temp_dir().join(format!("gilbert-mcp-echo-{}.js", Uuid::new_v4()));
        let script = r#"
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Local Echo MCP", version: "test" }
      }
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "echo",
          description: "Echo a message back to the caller.",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"]
          }
        }]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    const text = message.params && message.params.arguments ? message.params.arguments.message : "";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: `hello ${text}` }],
        structuredContent: { message: text },
        isError: false
      }
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" }
  });
});
"#;

        fs::write(&path, script).expect("write echo MCP server");
        path
    }

    fn write_stateful_stdio_server() -> PathBuf {
        let path = env::temp_dir().join(format!("gilbert-mcp-stateful-{}.js", Uuid::new_v4()));
        let script = r#"
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let activeJobId = null;
let nextJobId = 1;
function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}
function textResult(id, text, extra = {}) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      isError: false,
      ...extra
    }
  });
}
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Stateful MCP", version: "test" }
      }
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "start_job",
            description: "Start a stateful background job.",
            inputSchema: { type: "object", properties: {} }
          },
          {
            name: "job_status",
            description: "Read stateful background job status.",
            inputSchema: {
              type: "object",
              properties: { jobId: { type: "string" } },
              required: ["jobId"]
            }
          }
        ]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params && message.params.name;
    const args = (message.params && message.params.arguments) || {};
    if (name === "start_job") {
      activeJobId = `job-${nextJobId++}`;
      textResult(
        message.id,
        `Deployment started with Job ID: ${activeJobId}. Use job_status tool to track.`,
        { structuredContent: { jobId: activeJobId } }
      );
      return;
    }
    if (name === "job_status") {
      if (args.jobId === activeJobId) {
        textResult(message.id, `Job ${args.jobId} finished successfully.`);
      } else {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: `Error: Job not found: ${args.jobId}` }],
            isError: true
          }
        });
      }
      return;
    }
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" }
  });
});
"#;

        fs::write(&path, script).expect("write stateful MCP server");
        path
    }

    fn echo_stdio_record(script_path: &PathBuf) -> McpServerRecord {
        McpServerRecord {
            args: vec![script_path.to_string_lossy().to_string()],
            command: Some("node".to_string()),
            enabled: true,
            id: "local-echo".to_string(),
            name: "Local Echo".to_string(),
            transport: MCP_TRANSPORT_STDIO.to_string(),
            ..Default::default()
        }
    }

    fn stateful_stdio_record(script_path: &PathBuf) -> McpServerRecord {
        McpServerRecord {
            args: vec![script_path.to_string_lossy().to_string()],
            command: Some("node".to_string()),
            enabled: true,
            id: "stateful-job".to_string(),
            name: "Stateful Job".to_string(),
            transport: MCP_TRANSPORT_STDIO.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn registry_npm_package_becomes_stdio_install_hint() {
        let entry = json!({
            "server": {
                "name": "io.github.firebase/firebase-mcp",
                "description": "Firebase MCP",
                "version": "0.3.0",
                "packages": [{
                    "registryType": "npm",
                    "identifier": "firebase-tools",
                    "version": "14.27.0",
                    "runtimeHint": "npx",
                    "transport": { "type": "stdio" },
                    "runtimeArguments": [{ "type": "positional", "value": "mcp" }]
                }]
            },
            "_meta": {
                "io.modelcontextprotocol.registry/official": {
                    "status": "active",
                    "updatedAt": "2025-12-04T17:56:29Z"
                }
            }
        });
        let server = normalize_registry_server_entry(&entry).expect("registry server");
        let install = server.install.expect("install hint");

        assert!(server.official);
        assert_eq!(install.transport, MCP_TRANSPORT_STDIO);
        assert_eq!(install.command.as_deref(), Some("npx"));
        assert_eq!(install.args, vec!["-y", "firebase-tools@14.27.0", "mcp"]);
    }

    #[test]
    fn registry_remote_becomes_oauth_ready_stdio_install_hint() {
        let entry = json!({
            "server": {
                "name": "com.figma.mcp/mcp",
                "description": "Figma MCP",
                "version": "1.0.3",
                "remotes": [{
                    "type": "streamable-http",
                    "url": "https://mcp.figma.com/mcp"
                }]
            }
        });
        let server = normalize_registry_server_entry(&entry).expect("registry server");
        let install = server.install.expect("install hint");

        assert_eq!(install.transport, MCP_TRANSPORT_STDIO);
        assert_eq!(install.command.as_deref(), Some("npx"));
        assert_eq!(
            install.args,
            vec!["-y", "mcp-remote@latest", "https://mcp.figma.com/mcp"]
        );
        assert_eq!(
            install.endpoint.as_deref(),
            Some("https://mcp.figma.com/mcp")
        );
    }

    #[test]
    fn registry_pypi_package_uses_python_version_specifier() {
        let entry = json!({
            "server": {
                "name": "io.github.aws/aws-api-mcp-server",
                "description": "AWS MCP",
                "version": "1.0.0",
                "packages": [{
                    "registryType": "pypi",
                    "identifier": "mcp-proxy-for-aws",
                    "version": "1.2.3",
                    "runtimeHint": "uvx",
                    "transport": { "type": "stdio" },
                    "runtimeArguments": ["https://aws-mcp.us-east-1.api.aws/mcp"]
                }]
            }
        });
        let server = normalize_registry_server_entry(&entry).expect("registry server");
        let install = server.install.expect("install hint");

        assert_eq!(install.transport, MCP_TRANSPORT_STDIO);
        assert_eq!(install.command.as_deref(), Some("uvx"));
        assert_eq!(
            install.args,
            vec![
                "mcp-proxy-for-aws==1.2.3",
                "https://aws-mcp.us-east-1.api.aws/mcp"
            ]
        );
    }

    #[test]
    fn normalize_database_dedupes_servers_by_target_and_keeps_latest() {
        let mut database = McpDatabase {
            database_generation: MCP_DATABASE_GENERATION,
            servers: vec![
                McpServerRecord {
                    endpoint: Some("https://mcp.cloudflare.com/mcp".to_string()),
                    id: "cloudflare-old".to_string(),
                    name: "Cloudflare API".to_string(),
                    transport: MCP_TRANSPORT_HTTP.to_string(),
                    updated_at: Some(1),
                    ..Default::default()
                },
                McpServerRecord {
                    endpoint: Some("https://mcp.cloudflare.com/mcp".to_string()),
                    id: "cloudflare-new".to_string(),
                    name: "Cloudflare API".to_string(),
                    transport: MCP_TRANSPORT_HTTP.to_string(),
                    updated_at: Some(2),
                    ..Default::default()
                },
            ],
        };

        normalize_database(&mut database);

        assert_eq!(database.servers.len(), 1);
        assert_eq!(database.servers[0].id, "cloudflare-new");
    }

    #[test]
    fn http_query_params_are_secret_state_and_request_query() {
        let record = McpServerRecord {
            endpoint: Some("https://mcp.browserbase.com/mcp?keepAlive=true".to_string()),
            id: "browserbase".to_string(),
            name: "Browserbase".to_string(),
            query_params: vec![McpHttpQueryParam {
                name: "browserbaseApiKey".to_string(),
                value: "bb_secret".to_string(),
            }],
            transport: MCP_TRANSPORT_HTTP.to_string(),
            ..Default::default()
        };
        let state = sanitize_server(&record);

        assert_eq!(state.query_params.len(), 1);
        assert_eq!(state.query_params[0].name, "browserbaseApiKey");
        assert!(state.query_params[0].has_value);

        let client = reqwest::Client::new();
        let request = create_rpc_request(&client, &record, Method::POST, None)
            .expect("create browserbase request")
            .build()
            .expect("build request");
        let url = request.url().as_str();

        assert!(url.contains("keepAlive=true"));
        assert!(url.contains("browserbaseApiKey=bb_secret"));
    }

    #[test]
    fn http_query_params_reject_invalid_names_and_preserve_saved_blanks() {
        assert!(normalize_http_query_params(Some(&vec![McpHttpQueryParam {
            name: "bad&name".to_string(),
            value: "secret".to_string(),
        }]))
        .is_err());

        let merged = merge_http_query_params(
            vec![McpHttpQueryParam {
                name: "browserbaseApiKey".to_string(),
                value: "".to_string(),
            }],
            &[McpHttpQueryParam {
                name: "browserbaseApiKey".to_string(),
                value: "saved".to_string(),
            }],
        );

        assert_eq!(merged[0].value, "saved");
    }

    #[cfg(windows)]
    #[test]
    fn windows_stdio_resolver_prefers_cmd_shim_for_npx() {
        let dir = env::temp_dir().join(format!("gilbert-mcp-shim-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create shim dir");
        let shim = dir.join("npx.cmd");
        fs::write(&shim, "@echo off\r\n").expect("write shim");

        let resolved =
            find_windows_stdio_command_in_dirs("npx", &[dir.clone()]).expect("resolve npx.cmd");

        assert_eq!(resolved, shim);
        let _ = fs::remove_file(shim);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn stdio_probe_lists_echo_tool() {
        if !node_available() {
            eprintln!("Skipping stdio MCP test because node is not available.");
            return;
        }

        let script_path = write_echo_stdio_server();
        let record = echo_stdio_record(&script_path);
        let probe = probe_stdio_server(&record, None).expect("probe echo stdio server");

        assert_eq!(probe.server_name.as_deref(), Some("Local Echo MCP"));
        assert_eq!(probe.tools.len(), 1);
        assert_eq!(probe.tools[0].name, "echo");

        let _ = fs::remove_file(script_path);
    }

    #[test]
    fn stdio_call_invokes_echo_tool() {
        if !node_available() {
            eprintln!("Skipping stdio MCP test because node is not available.");
            return;
        }

        let script_path = write_echo_stdio_server();
        let record = echo_stdio_record(&script_path);
        let result = call_stdio_server_tool(&record, "echo", json!({ "message": "from Gilbert" }))
            .expect("call echo stdio tool");
        let content = format_mcp_tool_result_content(&result);

        assert!(content.contains("hello from Gilbert"));
        assert_eq!(
            result
                .pointer("/structuredContent/message")
                .and_then(Value::as_str),
            Some("from Gilbert")
        );

        let _ = fs::remove_file(script_path);
    }

    #[test]
    fn persistent_stdio_session_preserves_server_job_state_between_tool_calls() {
        if !node_available() {
            eprintln!("Skipping stdio MCP test because node is not available.");
            return;
        }

        let script_path = write_stateful_stdio_server();
        let record = stateful_stdio_record(&script_path);
        let state = McpState::default();
        let start = call_stdio_server_tool_persistent(
            &state.stdio_sessions,
            &record,
            "start_job",
            json!({}),
            None,
        )
        .expect("start stateful job");
        let job_id = start
            .pointer("/structuredContent/jobId")
            .and_then(Value::as_str)
            .expect("job id");
        let status = call_stdio_server_tool_persistent(
            &state.stdio_sessions,
            &record,
            "job_status",
            json!({ "jobId": job_id }),
            None,
        )
        .expect("read stateful job status");
        let content = format_mcp_tool_result_content(&status);

        assert_eq!(status.get("isError").and_then(Value::as_bool), Some(false));
        assert!(content.contains("finished successfully"));

        reset_cached_stdio_session(&state, &record.id);
        let _ = fs::remove_file(script_path);
    }

    #[test]
    fn firebase_mcp_tool_names_accept_compact_aliases() {
        let mut record = McpServerRecord {
            args: vec!["firebase-tools@latest".to_string(), "mcp".to_string()],
            command: Some("npx.cmd".to_string()),
            enabled: true,
            id: "firebase".to_string(),
            name: "Firebase".to_string(),
            transport: MCP_TRANSPORT_STDIO.to_string(),
            ..Default::default()
        };
        record.tools = vec![McpToolSummary {
            description: None,
            input_schema: None,
            name: "firebase_deploy_status".to_string(),
        }];

        assert_eq!(
            resolve_mcp_tool_name(&record, "firebasedeploystatus"),
            "firebase_deploy_status"
        );
        assert_eq!(
            resolve_mcp_tool_name(&record, "firebase-deploy-status"),
            "firebase_deploy_status"
        );
    }

    #[test]
    fn firebase_update_environment_normalizes_common_argument_aliases() {
        let record = McpServerRecord {
            args: vec!["firebase-tools@latest".to_string(), "mcp".to_string()],
            command: Some("npx.cmd".to_string()),
            enabled: true,
            id: "firebase".to_string(),
            name: "Firebase".to_string(),
            transport: MCP_TRANSPORT_STDIO.to_string(),
            ..Default::default()
        };
        let arguments = normalize_mcp_tool_arguments_for_server(
            &record,
            "firebase_update_environment",
            json!({
                "activeProject": "gilbertcodexweb",
                "projectDirectory": "C:/Users/Kobe Work/Documents/Hello world"
            }),
        );

        assert_eq!(
            arguments.get("project_dir").and_then(Value::as_str),
            Some("C:/Users/Kobe Work/Documents/Hello world")
        );
        assert_eq!(
            arguments.get("active_project").and_then(Value::as_str),
            Some("gilbertcodexweb")
        );
    }

    #[test]
    fn mcp_tool_result_includes_structured_error_when_text_logs_are_empty() {
        let content = format_mcp_tool_result_content(&json!({
            "content": [{
                "type": "text",
                "text": "Job ID: 1779662380537\nStatus: failed\nProgress: 0%\n\nLogs:\n"
            }],
            "structuredContent": {
                "status": "failed",
                "progress": 0,
                "logs": [],
                "error": "Expected to be in a project directory, but none was found."
            }
        }));

        assert!(content.contains("Logs:"));
        assert!(content.contains("--- Structured content ---"));
        assert!(content.contains("Error: Expected to be in a project directory"));
    }
}
