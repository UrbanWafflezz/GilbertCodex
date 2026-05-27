use crate::{app::request_app_exit, core::process::open_external_target};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub phase: String,
    pub runtime: String,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Gilbert Codex".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        phase: "Public alpha".to_string(),
        runtime: "Tauri desktop".to_string(),
        platform: host_platform().to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
pub fn app_quit(app: tauri::AppHandle) {
    request_app_exit(&app);
}

fn host_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();

    if !is_allowed_external_url(trimmed) {
        return Err("Only http, https, and mailto links can be opened externally.".to_string());
    }

    open_external_target(trimmed, "Could not open link in the default browser")
}

fn is_allowed_external_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_validation_allows_browser_protocols() {
        assert!(is_allowed_external_url("https://example.com"));
        assert!(is_allowed_external_url("http://localhost:4173/"));
        assert!(is_allowed_external_url("mailto:test@example.com"));
    }

    #[test]
    fn external_url_validation_rejects_local_or_script_protocols() {
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url(
            "file:///C:/Users/Example/secrets.txt"
        ));
        assert!(!is_allowed_external_url(""));
    }
}
