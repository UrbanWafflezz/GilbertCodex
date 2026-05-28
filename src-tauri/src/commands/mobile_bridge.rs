use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    env,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const PAIRING_KIND: &str = "gilbert-codex-mobile-pairing";
const MOBILE_BRIDGE_UPDATED_EVENT: &str = "mobile-bridge-updated";
const MAX_MOBILE_BRIDGE_BODY_BYTES: usize = 32 * 1024 * 1024;
const MAX_QUEUED_PAYLOADS: usize = 20;

#[derive(Default)]
pub struct MobileBridgeState {
    inner: Arc<Mutex<MobileBridgeInner>>,
}

#[derive(Default)]
struct MobileBridgeInner {
    desktop_payload: Option<Value>,
    desktop_sync_version: u64,
    last_mobile_sync_at: Option<u64>,
    mobile_payloads: VecDeque<Value>,
    mobile_requests: VecDeque<Value>,
    port: Option<u16>,
    running: bool,
    started_at: Option<u64>,
    stop: Option<Arc<AtomicBool>>,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileBridgeStartRequest {
    pub port: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileBridgeStatus {
    pub base_url: Option<String>,
    pub desktop_name: String,
    pub desktop_sync_version: u64,
    pub emulator_url: Option<String>,
    pub lan_urls: Vec<String>,
    pub last_mobile_sync_at: Option<u64>,
    pub pairing_payload: Option<String>,
    pub port: Option<u16>,
    pub queued_mobile_payloads: usize,
    pub queued_mobile_requests: usize,
    pub running: bool,
    pub started_at: Option<u64>,
    pub token: Option<String>,
}

#[tauri::command]
pub fn mobile_bridge_start(
    app: AppHandle,
    request: Option<MobileBridgeStartRequest>,
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;

    if inner.running {
        return Ok(status_from_inner(&inner));
    }

    let requested_port = request.and_then(|value| value.port).unwrap_or(0);
    let listener = TcpListener::bind(("0.0.0.0", requested_port))
        .map_err(|error| format!("Could not start mobile bridge: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure mobile bridge: {error}"))?;

    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read mobile bridge port: {error}"))?
        .port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_state = Arc::clone(&state.inner);

    if inner.token.trim().is_empty() {
        inner.token = Uuid::new_v4().simple().to_string();
    }
    inner.port = Some(port);
    inner.running = true;
    inner.started_at = Some(now_millis());
    inner.stop = Some(stop);

    thread::Builder::new()
        .name("gilbert-mobile-bridge".to_string())
        .spawn(move || run_bridge_server(listener, thread_state, thread_stop, app))
        .map_err(|error| format!("Could not launch mobile bridge thread: {error}"))?;

    Ok(status_from_inner(&inner))
}

#[tauri::command]
pub fn mobile_bridge_status(
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;
    Ok(status_from_inner(&inner))
}

#[tauri::command]
pub fn mobile_bridge_reset_pairing(
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;
    inner.token = Uuid::new_v4().simple().to_string();
    inner.mobile_payloads.clear();
    inner.mobile_requests.clear();
    Ok(status_from_inner(&inner))
}

#[tauri::command]
pub fn mobile_bridge_stop(
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;
    if let Some(stop) = inner.stop.take() {
        stop.store(true, Ordering::SeqCst);
    }
    inner.running = false;
    inner.port = None;
    inner.started_at = None;
    Ok(status_from_inner(&inner))
}

#[tauri::command]
pub fn mobile_bridge_update_desktop_payload(
    payload: Value,
    state: State<'_, MobileBridgeState>,
) -> Result<MobileBridgeStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;
    inner.desktop_payload = Some(payload);
    inner.desktop_sync_version = inner.desktop_sync_version.saturating_add(1);
    Ok(status_from_inner(&inner))
}

#[tauri::command]
pub fn mobile_bridge_take_mobile_payloads(
    state: State<'_, MobileBridgeState>,
) -> Result<Vec<Value>, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;
    Ok(inner.mobile_payloads.drain(..).collect())
}

#[tauri::command]
pub fn mobile_bridge_take_mobile_requests(
    state: State<'_, MobileBridgeState>,
) -> Result<Vec<Value>, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Mobile bridge state is unavailable.".to_string())?;
    Ok(inner.mobile_requests.drain(..).collect())
}

fn run_bridge_server(
    listener: TcpListener,
    state: Arc<Mutex<MobileBridgeInner>>,
    stop: Arc<AtomicBool>,
    app: AppHandle,
) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let connection_state = Arc::clone(&state);
                let app_handle = app.clone();
                let _ = thread::Builder::new()
                    .name("gilbert-mobile-bridge-connection".to_string())
                    .spawn(move || handle_connection(stream, &connection_state, Some(&app_handle)));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(60))
            }
            Err(_) => thread::sleep(Duration::from_millis(200)),
        }
    }

    if let Ok(mut inner) = state.lock() {
        inner.running = false;
        inner.port = None;
        inner.started_at = None;
        inner.stop = None;
    }
}

fn handle_connection(
    mut stream: TcpStream,
    state: &Arc<Mutex<MobileBridgeInner>>,
    app: Option<&AppHandle>,
) {
    let request = match read_http_request(&stream) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_json_response(&mut stream, 400, json!({ "ok": false, "error": error }));
            return;
        }
    };

    if request.method == "OPTIONS" {
        let _ = write_json_response(&mut stream, 204, json!({}));
        return;
    }

    if request.method == "GET" && request.path == "/health" {
        let status = state
            .lock()
            .map(|inner| status_json(&inner))
            .unwrap_or_else(|_| json!({ "ok": false, "error": "State unavailable" }));
        let _ = write_json_response(&mut stream, 200, json!({ "ok": true, "bridge": status }));
        return;
    }

    let authorized = state
        .lock()
        .map(|inner| token_matches(&inner, &request))
        .unwrap_or(false);

    if !authorized {
        let _ = write_json_response(
            &mut stream,
            401,
            json!({ "ok": false, "error": "Pairing token required." }),
        );
        return;
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/pair") => {
            let payload = state
                .lock()
                .ok()
                .and_then(|inner| pairing_payload_for_inner(&inner))
                .unwrap_or_else(|| json!({}));
            let _ =
                write_json_response(&mut stream, 200, json!({ "ok": true, "pairing": payload }));
        }
        ("GET", "/sync/pull") => {
            let (payload, version) = state
                .lock()
                .map(|inner| (inner.desktop_payload.clone(), inner.desktop_sync_version))
                .unwrap_or((None, 0));
            let _ = write_json_response(
                &mut stream,
                200,
                json!({ "ok": true, "payload": payload, "version": version }),
            );
        }
        ("GET", "/sync/watch") => {
            let since_version = query_u64(&request, "version").unwrap_or(0);
            let (payload, version) = wait_for_desktop_payload(state, since_version);
            let _ = write_json_response(
                &mut stream,
                200,
                json!({
                    "ok": true,
                    "changed": version > since_version,
                    "payload": payload,
                    "version": version
                }),
            );
        }
        ("POST", "/sync/push") => {
            let payload = parse_body_json(&request.body);
            match payload {
                Ok(payload) => {
                    let mut event_payload = None;
                    if let Ok(mut inner) = state.lock() {
                        let received_at = Some(now_millis());
                        inner.last_mobile_sync_at = received_at;
                        push_capped(
                            &mut inner.mobile_payloads,
                            json!({
                                "receivedAt": received_at,
                                "payload": payload
                            }),
                        );
                        event_payload = Some(mobile_bridge_event_json(&inner, "payload"));
                    }
                    emit_mobile_bridge_update(app, event_payload);
                    let _ = write_json_response(&mut stream, 200, json!({ "ok": true }));
                }
                Err(error) => {
                    let _ = write_json_response(
                        &mut stream,
                        400,
                        json!({ "ok": false, "error": error }),
                    );
                }
            }
        }
        ("POST", "/bridge/request") => {
            let payload = parse_body_json(&request.body);
            match payload {
                Ok(payload) => {
                    let mut event_payload = None;
                    if let Ok(mut inner) = state.lock() {
                        push_capped(
                            &mut inner.mobile_requests,
                            json!({
                                "receivedAt": now_millis(),
                                "request": payload
                            }),
                        );
                        event_payload = Some(mobile_bridge_event_json(&inner, "request"));
                    }
                    emit_mobile_bridge_update(app, event_payload);
                    let _ = write_json_response(
                        &mut stream,
                        200,
                        json!({ "ok": true, "status": "queued" }),
                    );
                }
                Err(error) => {
                    let _ = write_json_response(
                        &mut stream,
                        400,
                        json!({ "ok": false, "error": error }),
                    );
                }
            }
        }
        _ => {
            let _ = write_json_response(
                &mut stream,
                404,
                json!({ "ok": false, "error": "Unknown mobile bridge endpoint." }),
            );
        }
    }
}

fn read_http_request(stream: &TcpStream) -> Result<HttpRequest, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|error| error.to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    if method.is_empty() || target.is_empty() {
        return Err("Malformed request line.".to_string());
    }

    let mut headers = Vec::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }

        let key = line
            .split(':')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let value = line
            .split_once(':')
            .map(|(_, value)| value.trim().to_string())
            .unwrap_or_default();
        if key == "content-length" {
            content_length = value.parse::<usize>().unwrap_or(0);
        }
        headers.push((key, value));
    }

    if content_length > MAX_MOBILE_BRIDGE_BODY_BYTES {
        return Err(format!(
            "Request body is too large. Gilbert Codex Mobile sync accepts up to {} MB.",
            MAX_MOBILE_BRIDGE_BODY_BYTES / 1024 / 1024
        ));
    }

    let mut body = vec![0u8; content_length];
    if !body.is_empty() {
        reader
            .read_exact(&mut body)
            .map_err(|error| error.to_string())?;
    }

    let (path, query) = split_target(&target);
    Ok(HttpRequest {
        body,
        headers,
        method,
        path,
        query,
    })
}

fn write_json_response(stream: &mut TcpStream, status: u16, payload: Value) -> std::io::Result<()> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "OK",
    };
    let body = if status == 204 {
        String::new()
    } else {
        payload.to_string()
    };
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type, X-Gilbert-Codex-Token\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    )
}

fn split_target(target: &str) -> (String, Vec<(String, String)>) {
    let (path, raw_query) = target.split_once('?').unwrap_or((target, ""));
    let query = raw_query
        .split('&')
        .filter_map(|pair| {
            if pair.is_empty() {
                return None;
            }
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some((url_decode(key), url_decode(value)))
        })
        .collect();
    (path.to_string(), query)
}

fn parse_body_json(body: &[u8]) -> Result<Value, String> {
    serde_json::from_slice::<Value>(body).map_err(|error| format!("Invalid JSON body: {error}"))
}

fn wait_for_desktop_payload(
    state: &Arc<Mutex<MobileBridgeInner>>,
    since_version: u64,
) -> (Option<Value>, u64) {
    let started_at = now_millis();
    loop {
        if let Ok(inner) = state.lock() {
            if inner.desktop_sync_version > since_version
                || now_millis().saturating_sub(started_at) >= 25_000
            {
                return (inner.desktop_payload.clone(), inner.desktop_sync_version);
            }
        } else {
            return (None, since_version);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn token_matches(inner: &MobileBridgeInner, request: &HttpRequest) -> bool {
    let token = inner.token.trim();
    if token.is_empty() {
        return false;
    }

    let query_token = request
        .query
        .iter()
        .find_map(|(key, value)| (key == "token").then_some(value.as_str()));
    let header_token = request
        .headers
        .iter()
        .find_map(|(key, value)| (key == "x-gilbert-codex-token").then_some(value.as_str()));

    query_token == Some(token) || header_token == Some(token)
}

fn query_u64(request: &HttpRequest, key: &str) -> Option<u64> {
    request
        .query
        .iter()
        .find_map(|(query_key, value)| (query_key == key).then_some(value))
        .and_then(|value| value.parse::<u64>().ok())
}

fn status_from_inner(inner: &MobileBridgeInner) -> MobileBridgeStatus {
    let lan_urls = bridge_urls(inner.port);
    let base_url = lan_urls
        .iter()
        .find(|url| {
            !url.contains("127.0.0.1") && !url.contains("localhost") && !url.contains("10.0.2.2")
        })
        .cloned()
        .or_else(|| lan_urls.first().cloned());
    let emulator_url = inner.port.map(|port| format!("http://10.0.2.2:{port}"));
    MobileBridgeStatus {
        base_url,
        desktop_name: desktop_name(),
        desktop_sync_version: inner.desktop_sync_version,
        emulator_url,
        lan_urls,
        last_mobile_sync_at: inner.last_mobile_sync_at,
        pairing_payload: pairing_payload_for_inner(inner).map(|payload| payload.to_string()),
        port: inner.port,
        queued_mobile_payloads: inner.mobile_payloads.len(),
        queued_mobile_requests: inner.mobile_requests.len(),
        running: inner.running,
        started_at: inner.started_at,
        token: (!inner.token.is_empty()).then(|| inner.token.clone()),
    }
}

fn status_json(inner: &MobileBridgeInner) -> Value {
    serde_json::to_value(status_from_inner(inner)).unwrap_or_else(|_| json!({}))
}

fn mobile_bridge_event_json(inner: &MobileBridgeInner, kind: &str) -> Value {
    json!({
        "kind": kind,
        "lastMobileSyncAt": inner.last_mobile_sync_at,
        "queuedMobilePayloads": inner.mobile_payloads.len(),
        "queuedMobileRequests": inner.mobile_requests.len()
    })
}

fn emit_mobile_bridge_update(app: Option<&AppHandle>, payload: Option<Value>) {
    if let (Some(app), Some(payload)) = (app, payload) {
        let _ = app.emit(MOBILE_BRIDGE_UPDATED_EVENT, payload);
    }
}

fn pairing_payload_for_inner(inner: &MobileBridgeInner) -> Option<Value> {
    if !inner.running || inner.token.is_empty() {
        return None;
    }

    let lan_urls = bridge_urls(inner.port);
    let base_url = lan_urls
        .iter()
        .find(|url| {
            !url.contains("127.0.0.1") && !url.contains("localhost") && !url.contains("10.0.2.2")
        })
        .cloned()
        .or_else(|| lan_urls.first().cloned());
    let emulator_url = inner.port.map(|port| format!("http://10.0.2.2:{port}"));
    Some(json!({
        "kind": PAIRING_KIND,
        "version": 1,
        "desktopName": desktop_name(),
        "baseUrl": base_url,
        "emulatorUrl": emulator_url,
        "lanUrls": lan_urls,
        "token": inner.token
    }))
}

fn bridge_urls(port: Option<u16>) -> Vec<String> {
    let Some(port) = port else {
        return Vec::new();
    };
    let mut urls = vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://10.0.2.2:{port}"),
    ];
    if let Some(ip) = primary_lan_ip() {
        urls.push(format!("http://{ip}:{port}"));
    }
    urls.sort();
    urls.dedup();
    urls
}

fn primary_lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    let ip = addr.ip();
    if ip.is_loopback() {
        return None;
    }
    Some(ip.to_string())
}

fn desktop_name() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Gilbert Codex Desktop".to_string())
}

fn push_capped(queue: &mut VecDeque<Value>, value: Value) {
    while queue.len() >= MAX_QUEUED_PAYLOADS {
        queue.pop_front();
    }
    queue.push_back(value);
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn url_decode(value: &str) -> String {
    let mut bytes = Vec::with_capacity(value.len());
    let mut index = 0;
    let raw = value.as_bytes();
    while index < raw.len() {
        match raw[index] {
            b'+' => {
                bytes.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < raw.len() => {
                if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                    bytes.push(hex);
                    index += 3;
                } else {
                    bytes.push(raw[index]);
                    index += 1;
                }
            }
            byte => {
                bytes.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

struct HttpRequest {
    body: Vec<u8>,
    headers: Vec<(String, String)>,
    method: String,
    path: String,
    query: Vec<(String, String)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_matches_query_or_header_only() {
        let inner = MobileBridgeInner {
            token: "pair-token".to_string(),
            ..Default::default()
        };

        let query_request = HttpRequest {
            body: Vec::new(),
            headers: Vec::new(),
            method: "GET".to_string(),
            path: "/sync/pull".to_string(),
            query: vec![("token".to_string(), "pair-token".to_string())],
        };
        let header_request = HttpRequest {
            body: Vec::new(),
            headers: vec![(
                "x-gilbert-codex-token".to_string(),
                "pair-token".to_string(),
            )],
            method: "POST".to_string(),
            path: "/sync/push".to_string(),
            query: Vec::new(),
        };
        let wrong_request = HttpRequest {
            body: Vec::new(),
            headers: Vec::new(),
            method: "GET".to_string(),
            path: "/sync/pull".to_string(),
            query: vec![("token".to_string(), "wrong".to_string())],
        };

        assert!(token_matches(&inner, &query_request));
        assert!(token_matches(&inner, &header_request));
        assert!(!token_matches(&inner, &wrong_request));
    }

    #[test]
    fn pairing_payload_includes_urls_without_recursing_status() {
        let inner = MobileBridgeInner {
            port: Some(41234),
            running: true,
            token: "pair-token".to_string(),
            ..Default::default()
        };

        let payload = pairing_payload_for_inner(&inner).expect("payload");

        assert_eq!(payload["kind"], PAIRING_KIND);
        assert_eq!(payload["token"], "pair-token");
        assert!(payload["lanUrls"]
            .as_array()
            .expect("urls")
            .iter()
            .any(|url| { url.as_str().unwrap_or_default().contains("127.0.0.1:41234") }));
    }

    #[test]
    fn capped_queue_drops_oldest_values() {
        let mut queue = VecDeque::new();
        for index in 0..(MAX_QUEUED_PAYLOADS + 3) {
            push_capped(&mut queue, json!({ "index": index }));
        }

        assert_eq!(queue.len(), MAX_QUEUED_PAYLOADS);
        assert_eq!(
            queue.front().and_then(|value| value["index"].as_u64()),
            Some(3)
        );
        assert_eq!(
            queue.back().and_then(|value| value["index"].as_u64()),
            Some((MAX_QUEUED_PAYLOADS + 2) as u64)
        );
    }

    #[test]
    fn target_query_decodes_pair_token() {
        let (path, query) = split_target("/pair?token=abc%20123&other=value+two");

        assert_eq!(path, "/pair");
        assert_eq!(
            query,
            vec![
                ("token".to_string(), "abc 123".to_string()),
                ("other".to_string(), "value two".to_string())
            ]
        );
    }

    #[test]
    fn query_u64_reads_sync_version() {
        let request = HttpRequest {
            body: Vec::new(),
            headers: Vec::new(),
            method: "GET".to_string(),
            path: "/sync/watch".to_string(),
            query: vec![("version".to_string(), "42".to_string())],
        };

        assert_eq!(query_u64(&request, "version"), Some(42));
        assert_eq!(query_u64(&request, "missing"), None);
    }

    #[test]
    fn watch_waits_until_desktop_payload_version_changes() {
        let state = Arc::new(Mutex::new(MobileBridgeInner {
            desktop_payload: Some(json!({ "value": "old" })),
            desktop_sync_version: 1,
            ..Default::default()
        }));
        let update_state = Arc::clone(&state);

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            let mut inner = update_state.lock().expect("bridge state");
            inner.desktop_payload = Some(json!({ "value": "new" }));
            inner.desktop_sync_version = 2;
        });

        let (payload, version) = wait_for_desktop_payload(&state, 1);

        assert_eq!(version, 2);
        assert_eq!(
            payload.and_then(|value| value["value"].as_str().map(str::to_string)),
            Some("new".to_string())
        );
    }

    #[test]
    fn http_watch_endpoint_returns_changed_payload() {
        let state = Arc::new(Mutex::new(MobileBridgeInner {
            desktop_payload: Some(json!({ "value": "old" })),
            desktop_sync_version: 1,
            token: "pair-token".to_string(),
            ..Default::default()
        }));
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener");
        let port = listener.local_addr().expect("addr").port();
        let server_state = Arc::clone(&state);
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("connection");
            handle_connection(stream, &server_state, None);
        });
        let update_state = Arc::clone(&state);
        let updater = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            let mut inner = update_state.lock().expect("bridge state");
            inner.desktop_payload = Some(json!({ "value": "new" }));
            inner.desktop_sync_version = 2;
        });

        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("client");
        client
            .write_all(
                b"GET /sync/watch?token=pair-token&version=1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            )
            .expect("write request");
        let mut response = String::new();
        client.read_to_string(&mut response).expect("read response");
        server.join().expect("server");
        updater.join().expect("updater");

        assert!(response.contains("HTTP/1.1 200 OK"));
        assert!(response.contains("\"changed\":true"));
        assert!(response.contains("\"version\":2"));
        assert!(response.contains("\"value\":\"new\""));
    }

    #[test]
    fn http_push_accepts_large_image_sync_payloads() {
        let state = Arc::new(Mutex::new(MobileBridgeInner {
            token: "pair-token".to_string(),
            ..Default::default()
        }));
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener");
        let port = listener.local_addr().expect("addr").port();
        let server_state = Arc::clone(&state);
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("connection");
            handle_connection(stream, &server_state, None);
        });
        let data_url = format!("data:image/png;base64,{}", "A".repeat(2_200_000));
        let body = json!({
            "kind": "gilbert-codex-mobile-sync",
            "source": "mobile",
            "workspace": {
                "chats": [{
                    "id": "chat-image",
                    "messages": [{
                        "id": "message-image",
                        "attachments": [{ "id": "attachment-image", "kind": "image", "dataUrl": data_url }]
                    }]
                }]
            }
        })
        .to_string();

        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("client");
        let request = format!(
            "POST /sync/push HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Gilbert-Codex-Token: pair-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.as_bytes().len(),
            body
        );
        client.write_all(request.as_bytes()).expect("write request");
        let mut response = String::new();
        client.read_to_string(&mut response).expect("read response");
        server.join().expect("server");

        assert!(response.contains("HTTP/1.1 200 OK"));
        let inner = state.lock().expect("bridge state");
        assert_eq!(inner.mobile_payloads.len(), 1);
    }
}
