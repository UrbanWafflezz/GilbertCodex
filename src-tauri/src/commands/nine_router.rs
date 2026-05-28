#[cfg(not(windows))]
use crate::core::native_path::native_runtime_path_dirs;
use crate::{
    commands::auth,
    core::{
        native_path::{configure_native_path, expand_home_path, resolve_native_executable},
        process::run_probe_command,
    },
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const NINE_ROUTER_ADDR: &str = "127.0.0.1:20128";
const NINE_ROUTER_BASE_URL: &str = "http://127.0.0.1:20128/v1";
const NINE_ROUTER_DASHBOARD_URL: &str = "http://127.0.0.1:20128";
const NINE_ROUTER_BIND_HOST: &str = "0.0.0.0";
const NINE_ROUTER_STARTUP_WAIT_MS: u64 = 20_000;
const NINE_ROUTER_HTTP_CONNECT_TIMEOUT_MS: u64 = 5_000;
const NINE_ROUTER_HTTP_TIMEOUT_MS: u64 = 180_000;
const NINE_ROUTER_HTTP_MAX_TIMEOUT_MS: u64 = 600_000;
const NINE_ROUTER_OAUTH_CALLBACK_TIMEOUT_MS: u64 = 300_000;
const NINE_ROUTER_PROCESS_STOP_WAIT_MS: u64 = 2_500;
const NINE_ROUTER_TOOL_VERSION_TIMEOUT_MS: u64 = 5_000;
const NINE_ROUTER_REPO_URL: &str = "https://github.com/decolua/9router.git";
const NINE_ROUTER_CLI_TOKEN_HEADER: &str = "x-9r-cli-token";
const NINE_ROUTER_CLI_TOKEN_SALT: &str = "9r-cli-auth";
const NINE_ROUTER_UNINSTALL_REMOVE_RETRY_COUNT: usize = 5;
const NINE_ROUTER_UNINSTALL_STOP_RETRY_COUNT: usize = 3;

#[derive(Clone, Default)]
pub struct NineRouterLocalState {
    shared: Arc<NineRouterLocalShared>,
}

#[derive(Default)]
struct NineRouterLocalShared {
    child: Mutex<Option<Child>>,
    oauth_callbacks: Mutex<HashMap<String, NineRouterOAuthCallbackSession>>,
    operation: Mutex<()>,
    tool_versions: Mutex<Option<NineRouterToolVersions>>,
}

#[derive(Clone)]
struct NineRouterOAuthCallbackSession {
    created_at: Instant,
    result: Arc<Mutex<Option<NineRouterOAuthCallbackResponse>>>,
}

#[derive(Clone, Default)]
struct NineRouterToolVersions {
    docker: Option<String>,
    git: Option<String>,
    node: Option<String>,
    npm: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NineRouterLocalPreferences {
    auto_start: bool,
}

impl Default for NineRouterLocalPreferences {
    fn default() -> Self {
        Self { auto_start: false }
    }
}

impl Drop for NineRouterLocalShared {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(running_child) = child.take() {
                stop_child(running_child);
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterLocalStatus {
    pub base_url: String,
    pub auto_start_enabled: bool,
    pub built: bool,
    pub dashboard_url: String,
    pub lan_base_urls: Vec<String>,
    pub lan_dashboard_urls: Vec<String>,
    pub data_dir: Option<String>,
    pub docker_version: Option<String>,
    pub git_version: Option<String>,
    pub install_dir: Option<String>,
    pub installed: bool,
    pub launch_supported: bool,
    pub launched: bool,
    pub message: String,
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub pid: Option<u32>,
    pub running: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterHttpRequest {
    pub body: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub method: String,
    pub timeout_ms: Option<u64>,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterHttpResponse {
    pub body: String,
    pub headers: HashMap<String, String>,
    pub status: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum NineRouterHttpStreamEvent {
    #[serde(rename = "started", rename_all = "camelCase")]
    Started {
        headers: HashMap<String, String>,
        status: u16,
    },
    #[serde(rename = "chunk", rename_all = "camelCase")]
    Chunk { bytes_base64: String },
    #[serde(rename = "finished", rename_all = "camelCase")]
    Finished,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterOAuthCallbackStartResponse {
    pub id: String,
    pub redirect_uri: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterOAuthCallbackStartRequest {
    pub path: Option<String>,
    pub port: Option<u16>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterOAuthCallbackResponse {
    pub code: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NineRouterOAuthCallbackFinishRequest {
    pub id: String,
    pub timeout_ms: Option<u64>,
}

struct LaunchSpec {
    args: Vec<String>,
    cwd: Option<PathBuf>,
    program: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum NineRouterInstallEvent {
    #[serde(rename = "started", rename_all = "camelCase")]
    Started { message: String },
    #[serde(rename = "step", rename_all = "camelCase")]
    Step { message: String },
    #[serde(rename = "output", rename_all = "camelCase")]
    Output {
        label: String,
        stderr: String,
        stdout: String,
    },
    #[serde(rename = "finished", rename_all = "camelCase")]
    Finished { status: Box<NineRouterLocalStatus> },
}

#[tauri::command]
pub async fn nine_router_local_status(
    app: AppHandle,
    state: tauri::State<'_, NineRouterLocalState>,
) -> Result<NineRouterLocalStatus, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        Ok(create_status(
            &app,
            &state,
            is_nine_router_listening(),
            false,
            current_child_pid(&state)?,
            "9Router Local status refreshed.",
        ))
    })
    .await
    .map_err(|error| format!("9Router Local status task failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_local_install(
    app: AppHandle,
    state: tauri::State<'_, NineRouterLocalState>,
    on_event: Channel<NineRouterInstallEvent>,
) -> Result<NineRouterLocalStatus, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        install_nine_router_blocking(app, &state, on_event)
    })
    .await
    .map_err(|error| format!("9Router Local install task failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_local_ensure(
    app: AppHandle,
    state: tauri::State<'_, NineRouterLocalState>,
) -> Result<NineRouterLocalStatus, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        ensure_nine_router_blocking(
            &app,
            &state,
            Duration::from_millis(NINE_ROUTER_STARTUP_WAIT_MS),
        )
    })
    .await
    .map_err(|error| format!("9Router Local startup task failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_local_set_auto_start(
    app: AppHandle,
    state: tauri::State<'_, NineRouterLocalState>,
    enabled: bool,
) -> Result<NineRouterLocalStatus, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        write_preferences(
            &app,
            &NineRouterLocalPreferences {
                auto_start: enabled,
            },
        )?;

        if enabled {
            ensure_nine_router_blocking(
                &app,
                &state,
                Duration::from_millis(NINE_ROUTER_STARTUP_WAIT_MS),
            )
        } else {
            stop_nine_router_blocking(&app, &state)
        }
    })
    .await
    .map_err(|error| format!("9Router Local auto-start update failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_local_stop(
    app: AppHandle,
    state: tauri::State<'_, NineRouterLocalState>,
) -> Result<NineRouterLocalStatus, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let preference_result =
            write_preferences(&app, &NineRouterLocalPreferences { auto_start: false });
        let stop_result = stop_nine_router_blocking(&app, &state);

        match (preference_result, stop_result) {
            (_, Ok(status)) => Ok(status),
            (Err(preference_error), Err(stop_error)) => {
                Err(format!("{preference_error}; {stop_error}"))
            }
            (Ok(()), Err(stop_error)) => Err(stop_error),
        }
    })
    .await
    .map_err(|error| format!("9Router Local stop task failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_local_uninstall(
    app: AppHandle,
    state: tauri::State<'_, NineRouterLocalState>,
) -> Result<NineRouterLocalStatus, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || uninstall_nine_router_blocking(&app, &state))
        .await
        .map_err(|error| format!("Subscription sandbox uninstall task failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_local_http(
    app: AppHandle,
    request: NineRouterHttpRequest,
) -> Result<NineRouterHttpResponse, String> {
    let url = validate_nine_router_http_url(&request.url)?;
    let should_attach_cli_token = should_attach_nine_router_cli_token(&url);
    let method = parse_nine_router_http_method(&request.method)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(NINE_ROUTER_HTTP_TIMEOUT_MS)
        .clamp(1_000, NINE_ROUTER_HTTP_MAX_TIMEOUT_MS);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(NINE_ROUTER_HTTP_CONNECT_TIMEOUT_MS))
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Could not create 9Router Local HTTP client: {error}"))?;
    let mut native_request = client.request(method, url);

    let mut has_cli_token_header = false;
    for (name, value) in request.headers.unwrap_or_default() {
        let trimmed_name = name.trim();
        let normalized_name = trimmed_name.to_ascii_lowercase();
        if normalized_name == NINE_ROUTER_CLI_TOKEN_HEADER {
            has_cli_token_header = true;
        }

        if matches!(
            normalized_name.as_str(),
            "accept-encoding" | "connection" | "content-length" | "host"
        ) {
            continue;
        }

        let header_name = reqwest::header::HeaderName::from_bytes(trimmed_name.as_bytes())
            .map_err(|_| format!("9Router Local request header name is invalid: {name}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| format!("9Router Local request header value is invalid for {name}"))?;
        native_request = native_request.header(header_name, header_value);
    }

    if should_attach_cli_token && !has_cli_token_header {
        native_request =
            native_request.header(NINE_ROUTER_CLI_TOKEN_HEADER, nine_router_cli_token(&app)?);
    }

    if let Some(body) = request.body {
        native_request = native_request.body(body);
    }

    let response = native_request
        .send()
        .await
        .map_err(|error| format!("9Router Local request failed: {error}"))?;
    let status = response.status().as_u16();
    let headers = collect_nine_router_response_headers(response.headers());
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read 9Router Local response: {error}"))?;

    Ok(NineRouterHttpResponse {
        body,
        headers,
        status,
    })
}

#[tauri::command]
pub async fn nine_router_local_stream(
    app: AppHandle,
    request: NineRouterHttpRequest,
    on_event: Channel<NineRouterHttpStreamEvent>,
) -> Result<(), String> {
    let url = validate_nine_router_http_url(&request.url)?;
    let should_attach_cli_token = should_attach_nine_router_cli_token(&url);
    let method = parse_nine_router_http_method(&request.method)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(NINE_ROUTER_HTTP_TIMEOUT_MS)
        .clamp(1_000, NINE_ROUTER_HTTP_MAX_TIMEOUT_MS);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(NINE_ROUTER_HTTP_CONNECT_TIMEOUT_MS))
        .read_timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Could not create 9Router Local HTTP client: {error}"))?;
    let mut native_request = client.request(method, url);

    let mut has_cli_token_header = false;
    for (name, value) in request.headers.unwrap_or_default() {
        let trimmed_name = name.trim();
        let normalized_name = trimmed_name.to_ascii_lowercase();
        if normalized_name == NINE_ROUTER_CLI_TOKEN_HEADER {
            has_cli_token_header = true;
        }

        if matches!(
            normalized_name.as_str(),
            "accept-encoding" | "connection" | "content-length" | "host"
        ) {
            continue;
        }

        let header_name = reqwest::header::HeaderName::from_bytes(trimmed_name.as_bytes())
            .map_err(|_| format!("9Router Local request header name is invalid: {name}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| format!("9Router Local request header value is invalid for {name}"))?;
        native_request = native_request.header(header_name, header_value);
    }

    if should_attach_cli_token && !has_cli_token_header {
        native_request =
            native_request.header(NINE_ROUTER_CLI_TOKEN_HEADER, nine_router_cli_token(&app)?);
    }

    if let Some(body) = request.body {
        native_request = native_request.body(body);
    }

    let mut response = native_request
        .send()
        .await
        .map_err(|error| format!("9Router Local streaming request failed: {error}"))?;
    let status = response.status().as_u16();
    let headers = collect_nine_router_response_headers(response.headers());
    on_event
        .send(NineRouterHttpStreamEvent::Started { headers, status })
        .map_err(|error| format!("Could not start 9Router Local stream: {error}"))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not read 9Router Local stream: {error}"))?
    {
        if chunk.is_empty() {
            continue;
        }

        on_event
            .send(NineRouterHttpStreamEvent::Chunk {
                bytes_base64: general_purpose::STANDARD.encode(chunk.as_ref()),
            })
            .map_err(|error| format!("Could not send 9Router Local stream chunk: {error}"))?;
    }

    let _ = on_event.send(NineRouterHttpStreamEvent::Finished);
    Ok(())
}

fn collect_nine_router_response_headers(
    headers: &reqwest::header::HeaderMap,
) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|text| (name.as_str().to_string(), text.to_string()))
        })
        .collect::<HashMap<_, _>>()
}

#[tauri::command]
pub async fn nine_router_oauth_callback_start(
    state: tauri::State<'_, NineRouterLocalState>,
    request: Option<NineRouterOAuthCallbackStartRequest>,
) -> Result<NineRouterOAuthCallbackStartResponse, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || start_oauth_callback_listener(&state, request))
        .await
        .map_err(|error| format!("9Router OAuth callback startup failed: {error}"))?
}

#[tauri::command]
pub async fn nine_router_oauth_callback_finish(
    state: tauri::State<'_, NineRouterLocalState>,
    request: NineRouterOAuthCallbackFinishRequest,
) -> Result<NineRouterOAuthCallbackResponse, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || finish_oauth_callback_listener(&state, request))
        .await
        .map_err(|error| format!("9Router OAuth callback wait failed: {error}"))?
}

fn start_oauth_callback_listener(
    state: &NineRouterLocalState,
    request: Option<NineRouterOAuthCallbackStartRequest>,
) -> Result<NineRouterOAuthCallbackStartResponse, String> {
    cleanup_oauth_callback_sessions(state);

    let requested_port = request.as_ref().and_then(|value| value.port).unwrap_or(0);
    let callback_path =
        normalize_oauth_callback_path(request.as_ref().and_then(|value| value.path.as_deref()));
    let listener = TcpListener::bind(("127.0.0.1", requested_port))
        .map_err(|error| format!("Could not open local OAuth callback listener: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure local OAuth callback listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read local OAuth callback listener address: {error}"))?
        .port();
    let id = format!(
        "oauth-{}-{port}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    );
    let result = Arc::new(Mutex::new(None));
    let session = NineRouterOAuthCallbackSession {
        created_at: Instant::now(),
        result: result.clone(),
    };

    state
        .shared
        .oauth_callbacks
        .lock()
        .map_err(|_| "Could not lock 9Router OAuth callback sessions.".to_string())?
        .insert(id.clone(), session);

    thread::spawn(move || run_oauth_callback_listener(listener, result));

    Ok(NineRouterOAuthCallbackStartResponse {
        id,
        redirect_uri: format!("http://localhost:{port}{callback_path}"),
    })
}

fn normalize_oauth_callback_path(path: Option<&str>) -> &'static str {
    match path {
        Some("/auth/callback") => "/auth/callback",
        _ => "/callback",
    }
}

fn finish_oauth_callback_listener(
    state: &NineRouterLocalState,
    request: NineRouterOAuthCallbackFinishRequest,
) -> Result<NineRouterOAuthCallbackResponse, String> {
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(NINE_ROUTER_OAUTH_CALLBACK_TIMEOUT_MS)
        .clamp(1_000, NINE_ROUTER_OAUTH_CALLBACK_TIMEOUT_MS);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    loop {
        let result = {
            let sessions = state
                .shared
                .oauth_callbacks
                .lock()
                .map_err(|_| "Could not lock 9Router OAuth callback sessions.".to_string())?;
            let session = sessions
                .get(&request.id)
                .ok_or_else(|| "9Router OAuth callback session is missing.".to_string())?;
            let callback = session
                .result
                .lock()
                .map_err(|_| "Could not read 9Router OAuth callback result.".to_string())?
                .clone();
            callback
        };

        if let Some(callback) = result {
            if let Ok(mut sessions) = state.shared.oauth_callbacks.lock() {
                sessions.remove(&request.id);
            }
            return Ok(callback);
        }

        if Instant::now() >= deadline {
            if let Ok(mut sessions) = state.shared.oauth_callbacks.lock() {
                sessions.remove(&request.id);
            }
            return Err("Timed out waiting for the browser sign-in callback.".to_string());
        }

        thread::sleep(Duration::from_millis(150));
    }
}

fn cleanup_oauth_callback_sessions(state: &NineRouterLocalState) {
    if let Ok(mut sessions) = state.shared.oauth_callbacks.lock() {
        let stale_after = Duration::from_millis(NINE_ROUTER_OAUTH_CALLBACK_TIMEOUT_MS + 30_000);
        sessions.retain(|_, session| session.created_at.elapsed() < stale_after);
    }
}

fn run_oauth_callback_listener(
    listener: TcpListener,
    result: Arc<Mutex<Option<NineRouterOAuthCallbackResponse>>>,
) {
    let deadline = Instant::now() + Duration::from_millis(NINE_ROUTER_OAUTH_CALLBACK_TIMEOUT_MS);

    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let callback = match read_oauth_callback_from_stream(&mut stream) {
                    Ok(callback) => callback,
                    Err(error) if is_transient_oauth_callback_read_error(&error) => {
                        continue;
                    }
                    Err(error) => NineRouterOAuthCallbackResponse {
                        code: None,
                        error: Some(error),
                        error_description: None,
                        state: None,
                    },
                };
                let success = callback.error.is_none();
                let message = if success {
                    "Sign-in finished. You can close this window."
                } else {
                    callback
                        .error_description
                        .as_deref()
                        .or(callback.error.as_deref())
                        .unwrap_or("The sign-in callback could not be read.")
                };
                let _ = write_oauth_callback_page(&mut stream, success, message);

                if let Ok(mut guard) = result.lock() {
                    *guard = Some(callback);
                }
                return;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(75));
            }
            Err(error) => {
                if let Ok(mut guard) = result.lock() {
                    *guard = Some(NineRouterOAuthCallbackResponse {
                        code: None,
                        error: Some(format!("Could not receive OAuth callback: {error}")),
                        error_description: None,
                        state: None,
                    });
                }
                return;
            }
        }
    }

    if let Ok(mut guard) = result.lock() {
        *guard = Some(NineRouterOAuthCallbackResponse {
            code: None,
            error: Some("Timed out waiting for browser sign-in.".to_string()),
            error_description: None,
            state: None,
        });
    }
}

fn read_oauth_callback_from_stream(
    stream: &mut TcpStream,
) -> Result<NineRouterOAuthCallbackResponse, String> {
    let mut buffer = [0_u8; 8192];
    stream
        .set_nonblocking(false)
        .map_err(|error| format!("Could not configure callback socket blocking mode: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| format!("Could not configure callback socket: {error}"))?;
    let bytes_read = stream
        .read(&mut buffer)
        .map_err(|error| format!("Could not read callback request: {error}"))?;
    if bytes_read == 0 {
        return Err("OAuth callback connection closed before sending a request.".to_string());
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "OAuth callback request was empty.".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();

    if method != "GET" || target.is_empty() {
        return Err("OAuth callback request was not a GET request.".to_string());
    }

    let url_source = if target.starts_with("http://") || target.starts_with("https://") {
        target.to_string()
    } else {
        format!("http://localhost{target}")
    };
    let url = reqwest::Url::parse(&url_source)
        .map_err(|_| "OAuth callback request URL was invalid.".to_string())?;

    if url.path() != "/callback" && url.path() != "/auth/callback" {
        return Err("OAuth callback path was not recognized.".to_string());
    }

    let mut code = None;
    let mut error = None;
    let mut error_description = None;
    let mut state = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => error_description = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }

    Ok(NineRouterOAuthCallbackResponse {
        code,
        error,
        error_description,
        state,
    })
}

fn is_transient_oauth_callback_read_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();

    error.contains("os error 10035")
        || error.contains("os error 10060")
        || error.contains("WouldBlock")
        || normalized.contains("connection closed before sending")
        || normalized.contains("failed to respond")
        || normalized.contains("operation would block")
        || normalized.contains("timed out")
}

fn write_oauth_callback_page(
    stream: &mut TcpStream,
    success: bool,
    message: &str,
) -> Result<(), String> {
    let color = if success { "#22c55e" } else { "#ef4444" };
    let title = if success {
        "Sign-in complete"
    } else {
        "Sign-in failed"
    };
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title><style>body{{font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f1115;color:#f5f7fb}}main{{max-width:420px;padding:28px;border:1px solid #2b3040;border-radius:12px;background:#171a22;box-shadow:0 20px 60px rgba(0,0,0,.35)}}strong{{display:inline-grid;place-items:center;width:44px;height:44px;margin-bottom:12px;border-radius:999px;background:{}22;color:{}}}h1{{margin:0 0 8px;font-size:22px}}p{{margin:0;color:#b5bdcc;line-height:1.5}}</style></head><body><main><strong>{}</strong><h1>{}</h1><p>{}</p></main><script>setTimeout(()=>window.close(),1800)</script></body></html>",
        escape_html(title),
        color,
        color,
        if success { "OK" } else { "!" },
        escape_html(title),
        escape_html(message)
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| format!("Could not write callback response: {error}"))
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn shutdown_nine_router_on_exit(app: &AppHandle) {
    let state = app.state::<NineRouterLocalState>().inner().clone();
    let _ = stop_nine_router_processes(app, &state);
}

fn ensure_nine_router_blocking(
    app: &AppHandle,
    state: &NineRouterLocalState,
    wait_timeout: Duration,
) -> Result<NineRouterLocalStatus, String> {
    let _operation_guard = state
        .shared
        .operation
        .lock()
        .map_err(|_| "Could not lock the 9Router startup operation.".to_string())?;

    if is_nine_router_listening() {
        return Ok(create_status(
            app,
            state,
            true,
            false,
            current_child_pid(state)?,
            "9Router Local is already running.",
        ));
    }

    stop_stale_managed_process(app);

    let spec = match resolve_launch_spec(app) {
        Some(spec) => spec,
        None => {
            return Ok(create_status(
                app,
                state,
                false,
                false,
                None,
                "9Router Local is not running. Add a bundled 9Router sidecar or set GILBERT_CODEX_9ROUTER_EXE to let Gilbert start it automatically.",
            ));
        }
    };

    {
        let mut child_guard = state
            .shared
            .child
            .lock()
            .map_err(|_| "Could not lock the 9Router startup state.".to_string())?;

        if let Some(child) = child_guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) | Err(_) => {
                    *child_guard = None;
                }
                Ok(None) => {
                    let pid = Some(child.id());
                    drop(child_guard);
                    let running = wait_for_nine_router(wait_timeout);
                    return Ok(create_status(
                        app,
                        state,
                        running,
                        false,
                        pid,
                        if running {
                            "9Router Local finished starting."
                        } else {
                            "9Router Local process is starting, but the API is not ready yet."
                        },
                    ));
                }
            }
        }

        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .envs(launch_env(app))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Some(cwd) = spec.cwd.as_ref() {
            command.current_dir(cwd);
        } else if let Some(parent) = spec.program.parent() {
            command.current_dir(parent);
        }

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let child = command
            .spawn()
            .map_err(|error| format!("Could not start 9Router Local: {error}"))?;
        let pid = Some(child.id());
        write_pid_file(app, child.id());
        *child_guard = Some(child);
        drop(child_guard);

        let running = wait_for_nine_router(wait_timeout);
        Ok(create_status(
            app,
            state,
            running,
            true,
            pid,
            if running {
                "9Router Local started and is ready."
            } else {
                "9Router Local was started, but the API is not ready yet."
            },
        ))
    }
}

fn stop_nine_router_blocking(
    app: &AppHandle,
    state: &NineRouterLocalState,
) -> Result<NineRouterLocalStatus, String> {
    let _operation_guard = state
        .shared
        .operation
        .lock()
        .map_err(|_| "Could not lock the 9Router stop operation.".to_string())?;

    let stopped_processes = stop_nine_router_processes(app, state)?;
    let _ = wait_for_nine_router_shutdown(Duration::from_millis(2_500));

    let running = is_nine_router_listening();
    Ok(create_status(
        app,
        state,
        running,
        false,
        current_child_pid(state)?,
        if running && stopped_processes == 0 {
            "9Router Local is still running outside this Gilbert session and could not be stopped."
        } else if running {
            "9Router Local stop was requested, but the local API is still responding."
        } else {
            "All 9Router Local sessions are stopped and auto-start is disabled."
        },
    ))
}

fn stop_nine_router_processes(
    app: &AppHandle,
    state: &NineRouterLocalState,
) -> Result<usize, String> {
    let mut stopped = 0;

    {
        let mut child_guard = state
            .shared
            .child
            .lock()
            .map_err(|_| "Could not lock the 9Router startup state.".to_string())?;

        if let Some(child) = child_guard.take() {
            stop_child(child);
            stopped += 1;
        }
    }

    if let Some(pid) = read_pid_file(app) {
        if stop_process_tree(pid) {
            stopped += 1;
        }
    }

    for pid in listening_pids_on_port(20128) {
        if stop_process_tree(pid) {
            stopped += 1;
        }
    }

    remove_pid_file(app);

    Ok(stopped)
}

fn install_nine_router_blocking(
    app: AppHandle,
    state: &NineRouterLocalState,
    on_event: Channel<NineRouterInstallEvent>,
) -> Result<NineRouterLocalStatus, String> {
    let _operation_guard = state
        .shared
        .operation
        .lock()
        .map_err(|_| "Could not lock the subscription install operation.".to_string())?;

    let _ = on_event.send(NineRouterInstallEvent::Started {
        message: "Preparing 9Router Local install.".to_string(),
    });

    let install_dir = nine_router_install_dir(&app)?;
    let install_parent = install_dir
        .parent()
        .ok_or_else(|| "Could not resolve the 9Router install parent folder.".to_string())?;

    fs::create_dir_all(install_parent)
        .map_err(|error| format!("Could not create 9Router install folder: {error}"))?;
    fs::create_dir_all(nine_router_data_dir(&app)?)
        .map_err(|error| format!("Could not create 9Router data folder: {error}"))?;

    require_program("git")?;
    require_node_runtime()?;
    require_program("npm")?;

    if install_dir.join("package.json").is_file() {
        run_command_step(
            "Update 9Router source",
            program_name("git"),
            &["pull", "--ff-only"],
            &install_dir,
            &[],
            &on_event,
        )?;
    } else if install_dir.exists() {
        return Err(format!(
            "The 9Router install folder already exists but is not a source checkout: {}",
            path_to_string(&install_dir)
        ));
    } else {
        let install_target = path_to_string(&install_dir);
        run_command_step(
            "Clone 9Router source",
            program_name("git"),
            &[
                "clone",
                "--depth",
                "1",
                NINE_ROUTER_REPO_URL,
                &install_target,
            ],
            install_parent,
            &[],
            &on_event,
        )?;
    }

    run_command_step(
        "Install 9Router dependencies",
        program_name("npm"),
        &["install"],
        &install_dir,
        &[],
        &on_event,
    )?;
    run_command_step(
        "Build 9Router",
        program_name("npm"),
        &["run", "build"],
        &install_dir,
        &launch_env(&app),
        &on_event,
    )?;

    write_preferences(&app, &NineRouterLocalPreferences { auto_start: true })?;

    let status = create_status(
        &app,
        state,
        is_nine_router_listening(),
        false,
        current_child_pid(state)?,
        "9Router Local is installed.",
    );
    let _ = on_event.send(NineRouterInstallEvent::Finished {
        status: Box::new(status.clone()),
    });

    Ok(status)
}

fn uninstall_nine_router_blocking(
    app: &AppHandle,
    state: &NineRouterLocalState,
) -> Result<NineRouterLocalStatus, String> {
    let _operation_guard = state
        .shared
        .operation
        .lock()
        .map_err(|_| "Could not lock the subscription uninstall operation.".to_string())?;

    let _ = write_preferences(app, &NineRouterLocalPreferences { auto_start: false });
    for attempt in 0..NINE_ROUTER_UNINSTALL_STOP_RETRY_COUNT {
        let _ = stop_nine_router_processes(app, state)?;
        if wait_for_nine_router_shutdown(Duration::from_millis(1_500)) {
            break;
        }

        if attempt + 1 < NINE_ROUTER_UNINSTALL_STOP_RETRY_COUNT {
            thread::sleep(Duration::from_millis(250));
        }
    }

    remove_app_data_path_if_exists(app, &nine_router_install_dir(app)?, "subscription runtime")?;
    remove_app_data_path_if_exists(app, &nine_router_data_dir_path(app)?, "subscription data")?;
    remove_legacy_nine_router_data(app)?;
    remove_app_data_path_if_exists(
        app,
        &nine_router_preferences_path(app)?,
        "subscription preferences",
    )?;
    remove_app_data_path_if_exists(
        app,
        &legacy_nine_router_preferences_path(app)?,
        "legacy subscription preferences",
    )?;
    remove_app_data_path_if_exists(
        app,
        &nine_router_pid_path(app)?,
        "subscription process marker",
    )?;
    remove_app_data_path_if_exists(
        app,
        &legacy_nine_router_pid_path(app)?,
        "legacy subscription process marker",
    )?;

    let running = is_nine_router_listening();
    Ok(create_status(
        app,
        state,
        running,
        false,
        current_child_pid(state)?,
        if running {
            "Sandbox subscriptions were removed, but another local process is still using the subscription port."
        } else {
            "Sandbox subscriptions were uninstalled."
        },
    ))
}

fn create_status(
    app: &AppHandle,
    state: &NineRouterLocalState,
    running: bool,
    launched: bool,
    pid: Option<u32>,
    message: &str,
) -> NineRouterLocalStatus {
    let install_dir = nine_router_install_dir(app).ok();
    let data_dir = nine_router_status_data_dir(app);
    let installed = install_dir
        .as_ref()
        .map(|path| path.join("package.json").is_file())
        .unwrap_or(false);
    let built = install_dir
        .as_ref()
        .map(|path| path.join(".next").is_dir())
        .unwrap_or(false);
    let tool_versions = cached_tool_versions(state);

    NineRouterLocalStatus {
        base_url: NINE_ROUTER_BASE_URL.to_string(),
        auto_start_enabled: read_preferences(app).auto_start,
        built,
        dashboard_url: NINE_ROUTER_DASHBOARD_URL.to_string(),
        lan_base_urls: local_lan_dashboard_urls()
            .into_iter()
            .map(|url| format!("{url}/v1"))
            .collect(),
        lan_dashboard_urls: local_lan_dashboard_urls(),
        data_dir: data_dir.as_ref().map(|path| path_to_string(path)),
        docker_version: tool_versions.docker,
        git_version: tool_versions.git,
        install_dir: install_dir
            .as_ref()
            .filter(|path| path.exists())
            .map(|path| path_to_string(path)),
        installed,
        launch_supported: installed && resolve_launch_spec(app).is_some(),
        launched,
        message: message.to_string(),
        node_version: tool_versions.node,
        npm_version: tool_versions.npm,
        pid,
        running,
    }
}

impl Clone for NineRouterLocalStatus {
    fn clone(&self) -> Self {
        Self {
            base_url: self.base_url.clone(),
            auto_start_enabled: self.auto_start_enabled,
            built: self.built,
            dashboard_url: self.dashboard_url.clone(),
            lan_base_urls: self.lan_base_urls.clone(),
            lan_dashboard_urls: self.lan_dashboard_urls.clone(),
            data_dir: self.data_dir.clone(),
            docker_version: self.docker_version.clone(),
            git_version: self.git_version.clone(),
            install_dir: self.install_dir.clone(),
            installed: self.installed,
            launch_supported: self.launch_supported,
            launched: self.launched,
            message: self.message.clone(),
            node_version: self.node_version.clone(),
            npm_version: self.npm_version.clone(),
            pid: self.pid,
            running: self.running,
        }
    }
}

fn is_nine_router_listening() -> bool {
    let Ok(address) = NINE_ROUTER_ADDR.parse::<SocketAddr>() else {
        return false;
    };

    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

fn validate_nine_router_http_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url.trim())
        .map_err(|_| "9Router Local requests need a valid local URL.".to_string())?;

    if url.scheme() != "http" {
        return Err(
            "9Router Local requests must use http://127.0.0.1:20128 or http://localhost:20128."
                .to_string(),
        );
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("9Router Local requests cannot include embedded credentials.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "9Router Local requests need a URL host.".to_string())?
        .to_ascii_lowercase();

    if !is_allowed_nine_router_host(&host) {
        return Err(
            "9Router Local requests are restricted to localhost or private LAN hosts on port 20128.".to_string(),
        );
    }

    if url.port_or_known_default() != Some(20128) {
        return Err("9Router Local requests are restricted to port 20128.".to_string());
    }

    let path = url.path();

    if path != "/v1" && !path.starts_with("/v1/") && path != "/api" && !path.starts_with("/api/") {
        return Err(
            "9Router Local requests are restricted to the /v1 and /api endpoints.".to_string(),
        );
    }

    Ok(url)
}

fn is_allowed_nine_router_host(host: &str) -> bool {
    if matches!(host, "127.0.0.1" | "localhost" | "0.0.0.0" | "::1") {
        return true;
    }

    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };

    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || Some(ipv4) == local_primary_lan_ipv4()
        }
        IpAddr::V6(ipv6) => ipv6.is_loopback(),
    }
}

fn local_lan_dashboard_urls() -> Vec<String> {
    local_primary_lan_ipv4()
        .map(|address| vec![format!("http://{address}:20128")])
        .unwrap_or_default()
}

fn local_primary_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    let _ = socket.connect("8.8.8.8:80");
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(address) if !address.is_loopback() => Some(address),
        _ => None,
    }
}

fn should_attach_nine_router_cli_token(url: &reqwest::Url) -> bool {
    let path = url.path();
    path == "/api" || path.starts_with("/api/")
}

fn nine_router_cli_token(app: &AppHandle) -> Result<String, String> {
    let raw_machine_id = read_or_create_nine_router_machine_id(app)?;
    let cli_secret = read_or_create_nine_router_cli_secret(app)?;

    Ok(compute_nine_router_cli_token(&raw_machine_id, &cli_secret))
}

fn read_or_create_nine_router_machine_id(app: &AppHandle) -> Result<String, String> {
    let data_dir = nine_router_data_dir(app)?;
    let machine_id_path = data_dir.join("machine-id");

    if let Ok(existing) = fs::read_to_string(&machine_id_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not prepare 9Router machine id folder: {error}"))?;
    let generated = uuid::Uuid::new_v4().to_string();
    fs::write(&machine_id_path, &generated)
        .map_err(|error| format!("Could not save 9Router machine id: {error}"))?;
    Ok(generated)
}

fn read_or_create_nine_router_cli_secret(app: &AppHandle) -> Result<String, String> {
    let data_dir = nine_router_data_dir(app)?;
    let auth_dir = data_dir.join("auth");
    let cli_secret_path = auth_dir.join("cli-secret");

    if let Ok(existing) = fs::read_to_string(&cli_secret_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    fs::create_dir_all(&auth_dir)
        .map_err(|error| format!("Could not prepare 9Router CLI auth folder: {error}"))?;
    let generated = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    fs::write(&cli_secret_path, &generated)
        .map_err(|error| format!("Could not save 9Router CLI auth secret: {error}"))?;
    Ok(generated)
}

fn compute_nine_router_cli_token(raw_machine_id: &str, cli_secret: &str) -> String {
    let digest = Sha256::digest(
        format!("{raw_machine_id}{NINE_ROUTER_CLI_TOKEN_SALT}{cli_secret}").as_bytes(),
    );
    format!("{digest:x}").chars().take(16).collect()
}

fn parse_nine_router_http_method(method: &str) -> Result<reqwest::Method, String> {
    match method.trim().to_ascii_uppercase().as_str() {
        "DELETE" => Ok(reqwest::Method::DELETE),
        "GET" => Ok(reqwest::Method::GET),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        _ => Err(
            "9Router Local only supports GET, POST, PATCH, PUT, and DELETE requests from Gilbert."
                .to_string(),
        ),
    }
}

fn wait_for_nine_router(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if is_nine_router_listening() {
            return true;
        }

        thread::sleep(Duration::from_millis(250));
    }

    false
}

fn wait_for_nine_router_shutdown(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if !is_nine_router_listening() {
            return true;
        }

        thread::sleep(Duration::from_millis(150));
    }

    !is_nine_router_listening()
}

fn resolve_launch_spec(app: &AppHandle) -> Option<LaunchSpec> {
    if let Some(program) = env::var_os("GILBERT_CODEX_9ROUTER_EXE") {
        return Some(LaunchSpec {
            args: parse_launch_args(env::var("GILBERT_CODEX_9ROUTER_ARGS").ok()),
            cwd: None,
            program: expand_home_path(PathBuf::from(program)),
        });
    }

    let install_dir = nine_router_install_dir(app).ok()?;
    if install_dir.join("package.json").is_file() && install_dir.join(".next").is_dir() {
        return Some(LaunchSpec {
            args: vec!["run".to_string(), "start".to_string()],
            cwd: Some(install_dir),
            program: resolve_program_path("npm"),
        });
    }

    None
}

fn current_child_pid(state: &NineRouterLocalState) -> Result<Option<u32>, String> {
    let mut child_guard = state
        .shared
        .child
        .lock()
        .map_err(|_| "Could not lock the 9Router startup state.".to_string())?;

    if let Some(child) = child_guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => {
                *child_guard = None;
                Ok(None)
            }
            Ok(None) => Ok(Some(child.id())),
        }
    } else {
        Ok(None)
    }
}

fn nine_router_install_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("runtimes").join("9router"))
        .map_err(|error| format!("Could not resolve app data folder: {error}"))
}

fn nine_router_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = nine_router_data_dir_path(app)?;
    migrate_legacy_nine_router_data_dir(app, &data_dir)?;
    Ok(data_dir)
}

fn nine_router_data_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    account_scoped_app_data_dir(app, "9router-data")
}

fn nine_router_status_data_dir(app: &AppHandle) -> Option<PathBuf> {
    let scoped_data_dir = nine_router_data_dir_path(app).ok()?;
    if directory_has_local_entries(&scoped_data_dir) {
        return Some(scoped_data_dir);
    }

    legacy_nine_router_data_dir(app)
        .ok()
        .filter(|path| legacy_data_dir_has_migratable_entries(path))
}

fn nine_router_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    let preferences_path =
        account_scoped_app_data_dir(app, "nine-router")?.join("nine-router-local.json");
    migrate_legacy_nine_router_preferences(app, &preferences_path)?;
    Ok(preferences_path)
}

fn nine_router_pid_path(app: &AppHandle) -> Result<PathBuf, String> {
    account_scoped_app_data_dir(app, "nine-router").map(|path| path.join("nine-router-local.pid"))
}

fn account_scoped_app_data_dir(app: &AppHandle, folder: &str) -> Result<PathBuf, String> {
    let scope = active_nine_router_account_scope(app)?;
    app.path()
        .app_data_dir()
        .map(|path| path.join(folder).join("accounts").join(scope))
        .map_err(|error| format!("Could not resolve app data folder: {error}"))
}

fn active_nine_router_account_scope(app: &AppHandle) -> Result<String, String> {
    auth::current_user_storage_namespace(app).map(|namespace| sanitize_path_component(&namespace))
}

fn sanitize_path_component(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.trim().chars() {
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
        "local".to_string()
    } else {
        sanitized
    }
}

fn migrate_legacy_nine_router_data_dir(app: &AppHandle, target: &Path) -> Result<(), String> {
    if target.exists() {
        return Ok(());
    }

    let legacy_dir = legacy_nine_router_data_dir(app)?;
    if !legacy_dir.exists() {
        return Ok(());
    }

    copy_dir_contents(&legacy_dir, target, &["accounts"]).map_err(|error| {
        format!(
            "Could not migrate legacy subscription data into the signed-in account folder: {error}"
        )
    })
}

fn directory_has_local_entries(path: &Path) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };

    entries.filter_map(Result::ok).any(|entry| {
        entry
            .file_type()
            .map(|file_type| !file_type.is_symlink())
            .unwrap_or(false)
    })
}

fn legacy_data_dir_has_migratable_entries(path: &Path) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };

    entries.filter_map(Result::ok).any(|entry| {
        let is_accounts_dir = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case("accounts"));
        if is_accounts_dir {
            return false;
        }

        entry
            .file_type()
            .map(|file_type| !file_type.is_symlink())
            .unwrap_or(false)
    })
}

fn migrate_legacy_nine_router_preferences(app: &AppHandle, target: &Path) -> Result<(), String> {
    if target.exists() {
        return Ok(());
    }

    let legacy_path = legacy_nine_router_preferences_path(app)?;
    if !legacy_path.is_file() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Could not create subscription preferences folder: {error}")
        })?;
    }

    fs::copy(&legacy_path, target)
        .map(|_| ())
        .map_err(|error| format!("Could not migrate subscription preferences: {error}"))
}

fn copy_dir_contents(source: &Path, target: &Path, skip_names: &[&str]) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "Could not create target folder {}: {error}",
            path_to_string(target)
        )
    })?;

    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "Could not read source folder {}: {error}",
            path_to_string(source)
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Could not inspect source folder {}: {error}",
                path_to_string(source)
            )
        })?;
        let name = entry.file_name();
        if name.to_str().is_some_and(|name| {
            skip_names
                .iter()
                .any(|skip| skip.eq_ignore_ascii_case(name))
        }) {
            continue;
        }

        let source_path = entry.path();
        let target_path = target.join(&name);
        let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
            format!(
                "Could not inspect subscription data path {}: {error}",
                path_to_string(&source_path)
            )
        })?;

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            copy_dir_contents(&source_path, &target_path, &[])?;
        } else if metadata.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "Could not create target folder {}: {error}",
                        path_to_string(parent)
                    )
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "Could not copy subscription data from {} to {}: {error}",
                    path_to_string(&source_path),
                    path_to_string(&target_path)
                )
            })?;
        }
    }

    Ok(())
}

fn remove_legacy_nine_router_data(app: &AppHandle) -> Result<(), String> {
    let legacy_dir = legacy_nine_router_data_dir(app)?;
    if !legacy_dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(&legacy_dir).map_err(|error| {
        format!(
            "Could not read legacy subscription data folder {}: {error}",
            path_to_string(&legacy_dir)
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Could not inspect legacy subscription data folder {}: {error}",
                path_to_string(&legacy_dir)
            )
        })?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case("accounts"))
        {
            continue;
        }

        remove_app_data_path_if_exists(app, &entry.path(), "legacy subscription data")?;
    }

    Ok(())
}

fn legacy_nine_router_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("9router-data"))
        .map_err(|error| format!("Could not resolve app data folder: {error}"))
}

fn legacy_nine_router_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("nine-router-local.json"))
        .map_err(|error| format!("Could not resolve app data folder: {error}"))
}

fn legacy_nine_router_pid_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("nine-router-local.pid"))
        .map_err(|error| format!("Could not resolve app data folder: {error}"))
}

fn remove_app_data_path_if_exists(app: &AppHandle, path: &Path, label: &str) -> Result<(), String> {
    let mut last_error = None;

    for attempt in 0..NINE_ROUTER_UNINSTALL_REMOVE_RETRY_COUNT {
        match remove_app_data_path_once(app, path, label) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < NINE_ROUTER_UNINSTALL_REMOVE_RETRY_COUNT {
                    thread::sleep(Duration::from_millis(250));
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| format!("Could not remove {label}.")))
}

fn remove_app_data_path_once(app: &AppHandle, path: &Path, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not prepare app data folder: {error}"))?;

    let app_data_root = fs::canonicalize(&app_data_dir)
        .map_err(|error| format!("Could not inspect app data folder: {error}"))?;
    let target =
        fs::canonicalize(path).map_err(|error| format!("Could not inspect {label}: {error}"))?;

    if !target.starts_with(&app_data_root) {
        return Err(format!(
            "Refusing to remove {label} outside Gilbert app data."
        ));
    }

    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect {label}: {error}"))?;
    let file_type = metadata.file_type();

    if file_type.is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|error| format!("Could not remove {label}: {error}"))?;
        return Ok(());
    }

    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| format!("Could not remove {label}: {error}"))?;
    }

    Ok(())
}

fn read_preferences(app: &AppHandle) -> NineRouterLocalPreferences {
    let Ok(path) = nine_router_preferences_path(app) else {
        return NineRouterLocalPreferences::default();
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|value| serde_json::from_str::<NineRouterLocalPreferences>(&value).ok())
        .unwrap_or_default()
}

fn write_preferences(
    app: &AppHandle,
    preferences: &NineRouterLocalPreferences,
) -> Result<(), String> {
    let path = nine_router_preferences_path(app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create 9Router preferences folder: {error}"))?;
    }

    let content = serde_json::to_string_pretty(preferences)
        .map_err(|error| format!("Could not serialize 9Router preferences: {error}"))?;

    fs::write(&path, content)
        .map_err(|error| format!("Could not save 9Router preferences: {error}"))
}

fn read_pid_file(app: &AppHandle) -> Option<u32> {
    let path = nine_router_pid_path(app).ok()?;
    fs::read_to_string(path).ok()?.trim().parse::<u32>().ok()
}

fn write_pid_file(app: &AppHandle, pid: u32) {
    let Ok(path) = nine_router_pid_path(app) else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let _ = fs::write(path, pid.to_string());
}

fn remove_pid_file(app: &AppHandle) {
    if let Ok(path) = nine_router_pid_path(app) {
        let _ = fs::remove_file(path);
    }
}

fn launch_env(app: &AppHandle) -> Vec<(String, String)> {
    let data_dir = nine_router_data_dir(app)
        .map(|path| path_to_string(&path))
        .unwrap_or_default();

    let mut envs = vec![
        (
            "BASE_URL".to_string(),
            NINE_ROUTER_DASHBOARD_URL.to_string(),
        ),
        ("DATA_DIR".to_string(), data_dir),
        ("HOSTNAME".to_string(), NINE_ROUTER_BIND_HOST.to_string()),
        (
            "NEXT_PUBLIC_BASE_URL".to_string(),
            NINE_ROUTER_DASHBOARD_URL.to_string(),
        ),
        (
            "NINE_ROUTER_ALLOW_PRIVATE_LAN_API".to_string(),
            "true".to_string(),
        ),
        ("NODE_ENV".to_string(), "production".to_string()),
        ("PORT".to_string(), "20128".to_string()),
    ];

    push_native_runtime_env(&mut envs);
    envs
}

fn cached_tool_versions(state: &NineRouterLocalState) -> NineRouterToolVersions {
    if let Ok(mut versions_guard) = state.shared.tool_versions.lock() {
        if let Some(versions) = versions_guard.as_ref() {
            return versions.clone();
        }

        let versions = NineRouterToolVersions {
            docker: program_version("docker"),
            git: program_version("git"),
            node: program_version("node"),
            npm: program_version("npm"),
        };
        *versions_guard = Some(versions.clone());
        return versions;
    }

    NineRouterToolVersions {
        docker: program_version("docker"),
        git: program_version("git"),
        node: program_version("node"),
        npm: program_version("npm"),
    }
}

fn stop_stale_managed_process(app: &AppHandle) {
    if let Some(pid) = read_pid_file(app) {
        if !listening_pids_on_port(20128).contains(&pid) {
            let _ = stop_process_tree(pid);
            remove_pid_file(app);
        }
    }
}

fn stop_child(mut child: Child) {
    let pid = child.id();

    let _ = stop_process_tree(pid);
    let _ = wait_for_child_exit(
        &mut child,
        Duration::from_millis(NINE_ROUTER_PROCESS_STOP_WAIT_MS),
    );
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> bool {
    let started_at = Instant::now();

    while started_at.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
        }
    }

    let _ = child.kill();
    false
}

fn stop_process_tree(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(windows)]
    {
        Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    {
        let mut command = Command::new(resolve_program_executable("kill"));
        command
            .args(["-TERM", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_native_program_command(&mut command);
        command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn listening_pids_on_port(port: u16) -> Vec<u32> {
    #[cfg(windows)]
    {
        let output = Command::new("netstat.exe")
            .arg("-ano")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let Ok(output) = output else {
            return Vec::new();
        };

        let needle_v4 = format!(":{}", port);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut pids = Vec::new();

        for line in stdout.lines() {
            if !line.contains(&needle_v4) || !line.contains("LISTENING") {
                continue;
            }

            if let Some(pid) = line
                .split_whitespace()
                .last()
                .and_then(|value| value.parse::<u32>().ok())
            {
                if !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }

        pids
    }

    #[cfg(not(windows))]
    {
        let mut pids = Vec::new();

        append_unique_pids(&mut pids, listening_pids_from_lsof(port));
        if pids.is_empty() {
            append_unique_pids(&mut pids, listening_pids_from_fuser(port));
        }
        if pids.is_empty() {
            append_unique_pids(&mut pids, listening_pids_from_ss(port));
        }

        pids
    }
}

#[cfg(not(windows))]
fn listening_pids_from_lsof(port: u16) -> Vec<u32> {
    command_output("lsof", &["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
        .filter(|output| output.status.success())
        .map(|output| parse_pid_tokens(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn listening_pids_from_fuser(port: u16) -> Vec<u32> {
    command_output("fuser", &["-n", "tcp", &port.to_string()])
        .filter(|output| output.status.success())
        .map(|output| parse_pid_tokens(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn listening_pids_from_ss(port: u16) -> Vec<u32> {
    command_output("ss", &["-ltnp", "sport", "=", &format!(":{port}")])
        .filter(|output| output.status.success())
        .map(|output| parse_ss_pids(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn command_output(program: &str, args: &[&str]) -> Option<Output> {
    let mut command = Command::new(resolve_program_executable(program));
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_native_program_command(&mut command);
    command.output().ok()
}

#[cfg(not(windows))]
fn append_unique_pids(target: &mut Vec<u32>, pids: Vec<u32>) {
    for pid in pids {
        if pid != 0 && !target.contains(&pid) {
            target.push(pid);
        }
    }
}

#[cfg(not(windows))]
fn parse_pid_tokens(output: &str) -> Vec<u32> {
    output
        .split_whitespace()
        .filter_map(|token| token.trim().parse::<u32>().ok())
        .collect()
}

#[cfg(any(test, not(windows)))]
fn parse_ss_pids(output: &str) -> Vec<u32> {
    output
        .split("pid=")
        .skip(1)
        .filter_map(|part| {
            part.split(|ch: char| !ch.is_ascii_digit())
                .next()
                .and_then(|value| value.parse::<u32>().ok())
        })
        .collect()
}

fn require_program(name: &str) -> Result<(), String> {
    let program = program_name(name);

    program_version(name).map(|_| ()).ok_or_else(|| {
        format!("{program} is required to install 9Router Local. Install {name}, make sure it is available on PATH, and try again.")
    })
}

fn require_node_runtime() -> Result<(), String> {
    let version = program_version("node").ok_or_else(|| {
        "Node.js 20 or newer is required to install 9Router Local. Install Node.js and try again."
            .to_string()
    })?;

    match node_major_version(&version) {
        Some(major) if major >= 20 => Ok(()),
        Some(major) => Err(format!(
            "Node.js 20 or newer is required to install 9Router Local. Found Node.js {major} from `{version}`."
        )),
        None => Err(format!(
            "Could not determine the installed Node.js version from `{version}`. Install Node.js 20 or newer and try again."
        )),
    }
}

fn program_name(name: &str) -> &'static str {
    match name {
        "npm" if cfg!(windows) => "npm.cmd",
        "npx" if cfg!(windows) => "npx.cmd",
        "docker" if cfg!(windows) => "docker.exe",
        "git" if cfg!(windows) => "git.exe",
        "node" if cfg!(windows) => "node.exe",
        "npm" => "npm",
        "npx" => "npx",
        "docker" => "docker",
        "git" => "git",
        "node" => "node",
        _ => "node",
    }
}

fn resolve_program_path(name: &str) -> PathBuf {
    resolve_program_executable(program_name(name))
}

fn resolve_program_executable(program: &str) -> PathBuf {
    resolve_native_executable(program)
}

fn program_version(name: &str) -> Option<String> {
    let mut command = Command::new(resolve_program_path(name));
    command.arg("--version");
    configure_native_program_command(&mut command);

    let output = run_probe_command(
        command,
        Duration::from_millis(NINE_ROUTER_TOOL_VERSION_TIMEOUT_MS),
    )
    .ok()
    .flatten()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let version = if stdout.is_empty() { stderr } else { stdout };

    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn run_command_step(
    label: &str,
    program: &str,
    args: &[&str],
    cwd: &Path,
    envs: &[(String, String)],
    on_event: &Channel<NineRouterInstallEvent>,
) -> Result<(), String> {
    let _ = on_event.send(NineRouterInstallEvent::Step {
        message: label.to_string(),
    });

    let mut command = Command::new(resolve_program_executable(program));
    command
        .args(args)
        .current_dir(cwd)
        .envs(envs.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_native_program_command(&mut command);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("{label} failed to start: {error}"))?;
    let stdout = normalize_output(&output.stdout);
    let stderr = normalize_output(&output.stderr);

    let _ = on_event.send(NineRouterInstallEvent::Output {
        label: label.to_string(),
        stderr: stderr.clone(),
        stdout: stdout.clone(),
    });

    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "{label} failed with exit code {}. {}{}",
        format_exit_code(&output),
        stdout,
        stderr
    ))
}

fn normalize_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim()
        .chars()
        .take(12_000)
        .collect()
}

fn format_exit_code(output: &Output) -> String {
    output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn parse_launch_args(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

fn node_major_version(version: &str) -> Option<u32> {
    let normalized = version.trim().trim_start_matches('v');
    let major = normalized
        .split(|ch: char| !ch.is_ascii_digit())
        .next()
        .unwrap_or_default();

    major.parse().ok()
}

fn push_native_runtime_env(envs: &mut Vec<(String, String)>) {
    #[cfg(not(windows))]
    envs.push(("PATH".to_string(), native_runtime_path_string()));

    #[cfg(windows)]
    let _ = envs;
}

fn configure_native_program_command(command: &mut Command) {
    configure_native_path(command);
}

#[cfg(not(windows))]
fn native_runtime_path_string() -> String {
    env::join_paths(native_runtime_path_dirs())
        .unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default())
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::native_path::{common_linux_runtime_dirs, common_macos_runtime_dirs};

    #[test]
    fn cli_token_matches_current_nine_router_formula() {
        let expected = Sha256::digest("machine-1239r-cli-authsecret-456".as_bytes());
        let expected = format!("{expected:x}").chars().take(16).collect::<String>();

        assert_eq!(
            compute_nine_router_cli_token("machine-123", "secret-456"),
            expected
        );
    }

    #[test]
    fn nine_router_host_validation_allows_private_lan_urls() {
        assert!(validate_nine_router_http_url("http://127.0.0.1:20128/v1/models").is_ok());
        assert!(validate_nine_router_http_url("http://10.0.0.239:20128/v1/models").is_ok());
        assert!(validate_nine_router_http_url("http://192.168.1.20:20128/api/providers").is_ok());
        assert!(validate_nine_router_http_url("http://203.0.113.10:20128/v1/models").is_err());
        assert!(validate_nine_router_http_url("https://10.0.0.239:20128/v1/models").is_err());
        assert!(validate_nine_router_http_url("http://10.0.0.239:20129/v1/models").is_err());
    }

    #[test]
    fn directory_footprint_ignores_missing_and_empty_dirs() {
        let root = create_test_dir("empty-data-dir");
        let missing = root.join("missing");
        let empty = root.join("empty");

        fs::create_dir_all(&empty).expect("create empty test data dir");
        assert!(!directory_has_local_entries(&missing));
        assert!(!directory_has_local_entries(&empty));

        fs::write(empty.join("machine-id"), "machine-123").expect("write test data file");
        assert!(directory_has_local_entries(&empty));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_footprint_ignores_accounts_only_root() {
        let root = create_test_dir("legacy-accounts-only");

        fs::create_dir_all(root.join("accounts").join("local").join("auth"))
            .expect("create legacy accounts dir");
        assert!(!legacy_data_dir_has_migratable_entries(&root));

        fs::write(root.join("machine-id"), "machine-123").expect("write legacy data file");
        assert!(legacy_data_dir_has_migratable_entries(&root));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn node_major_version_accepts_standard_node_output() {
        assert_eq!(node_major_version("v20.19.0"), Some(20));
        assert_eq!(node_major_version("22.11.0"), Some(22));
        assert_eq!(node_major_version("node v24.0.0"), None);
        assert_eq!(node_major_version("not node"), None);
    }

    #[test]
    fn macos_runtime_dirs_include_gui_app_tool_locations() {
        let home = PathBuf::from("/Users/gilbert");
        let dirs = common_macos_runtime_dirs(Some(home.clone()));

        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
        assert!(dirs.contains(&PathBuf::from(
            "/Applications/Docker.app/Contents/Resources/bin"
        )));
        assert!(dirs.contains(&home.join(".volta").join("bin")));
        assert!(dirs.contains(&home.join(".asdf").join("shims")));
    }

    #[test]
    fn linux_runtime_dirs_include_desktop_app_tool_locations() {
        let home = PathBuf::from("/home/gilbert");
        let dirs = common_linux_runtime_dirs(Some(home.clone()));

        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/bin")));
        assert!(dirs.contains(&PathBuf::from("/snap/bin")));
        assert!(dirs.contains(&home.join(".local").join("bin")));
        assert!(dirs.contains(
            &home
                .join(".local")
                .join("share")
                .join("flatpak")
                .join("exports")
                .join("bin")
        ));
    }

    #[test]
    fn parses_linux_ss_listener_pids() {
        let output = r#"State  Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess
LISTEN 0      511          0.0.0.0:20128      0.0.0.0:*    users:(("node",pid=32145,fd=23),("npm",pid=32144,fd=19))
"#;

        assert_eq!(parse_ss_pids(output), vec![32145, 32144]);
    }

    fn create_test_dir(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "gilbert-codex-nine-router-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create test temp dir");
        path
    }
}
