use crate::commands;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime, WindowEvent,
};

#[cfg(target_os = "macos")]
use tauri::menu::{MenuItemBuilder, SubmenuBuilder};

const MAIN_WINDOW_LABEL: &str = "main";
const APP_MENU_COMMAND_EVENT: &str = "app-menu-command";
const MENU_NEW_CHAT_ID: &str = "app-new-chat";
const MENU_SEARCH_CHATS_ID: &str = "app-search-chats";
const MENU_SETTINGS_ID: &str = "app-settings";
const MENU_SHOW_CHAT_ID: &str = "app-show-chat";
const MENU_SHOW_APPS_ID: &str = "app-show-apps";
const MENU_SHOW_TASKS_ID: &str = "app-show-tasks";
const MENU_SHOW_RADAR_ID: &str = "app-show-radar";
const MENU_TOGGLE_SIDEBAR_ID: &str = "app-toggle-sidebar";
const MENU_TOGGLE_TERMINAL_ID: &str = "app-toggle-terminal";
const MENU_APPEARANCE_SYSTEM_ID: &str = "app-appearance-system";
const MENU_APPEARANCE_DARK_ID: &str = "app-appearance-dark";
const MENU_APPEARANCE_LIGHT_ID: &str = "app-appearance-light";
const MENU_CHECK_UPDATES_ID: &str = "app-check-updates";
const MENU_SHOW_ABOUT_ID: &str = "app-show-about";
const TRAY_ID: &str = "gilbert-codex-tray";
const TRAY_OPEN_ID: &str = "tray-open";
const TRAY_QUIT_ID: &str = "tray-quit";

#[derive(Default)]
pub(crate) struct AppLifecycleState {
    exiting: AtomicBool,
}

impl AppLifecycleState {
    fn is_exiting(&self) -> bool {
        self.exiting.load(Ordering::SeqCst)
    }

    fn request_exit(&self) {
        self.exiting.store(true, Ordering::SeqCst);
    }
}

/// Builds the Tauri app, registers shared command state, and exposes command handlers.
pub fn builder() -> tauri::Builder<tauri::Wry> {
    let window_state_flags = tauri_plugin_window_state::StateFlags::SIZE
        | tauri_plugin_window_state::StateFlags::POSITION
        | tauri_plugin_window_state::StateFlags::MAXIMIZED
        | tauri_plugin_window_state::StateFlags::FULLSCREEN;

    tauri::Builder::default()
        // Keep first so secondary launches are rejected before other plugin setup runs.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppLifecycleState::default())
        .manage(commands::auth::AuthState::default())
        .manage(commands::computer::files::ComputerFileIndexState::default())
        .manage(commands::dictation::DictationState::default())
        .manage(commands::discord::DiscordBridgeState::default())
        .manage(commands::gmail::GmailState::default())
        .manage(commands::google_calendar::CalendarState::default())
        .manage(commands::github::GithubState::default())
        .manage(commands::mcp::McpState::default())
        .manage(commands::mobile_bridge::MobileBridgeState::default())
        .manage(commands::nine_router::NineRouterLocalState::default())
        .manage(commands::terminal::TerminalState::default())
        .manage(commands::updates::AppUpdateState::default())
        .setup(|app| {
            if let Some(icon) = app.default_window_icon().cloned() {
                for window in app.webview_windows().values() {
                    window.set_icon(icon.clone())?;
                }
            }

            setup_app_menu(app)?;
            setup_tray(app)?;
            show_main_window(app.handle());

            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some(command) = app_menu_command_for_id(event.id().as_ref()) {
                let _ = app.emit(APP_MENU_COMMAND_EVENT, command);
            }
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_exit = window
                    .app_handle()
                    .try_state::<AppLifecycleState>()
                    .map(|state| state.is_exiting())
                    .unwrap_or(false);

                if !should_exit {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent_runs::agent_run_delete,
            commands::agent_runs::agent_run_save,
            commands::agent_runs::agent_runs_list,
            commands::auth::auth_create_account,
            commands::auth::auth_get_cloud_account_scope,
            commands::auth::auth_get_login_challenge,
            commands::auth::auth_get_state,
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::auth::auth_set_cloud_account_scope,
            commands::app_info::get_app_info,
            commands::app_info::app_quit,
            commands::browser::browser_automation,
            commands::browser::browser_preview_capture,
            commands::browser::browser_preview_get_url,
            commands::browser::browser_preview_navigate,
            commands::browser::browser_preview_reload,
            commands::computer::files::computer_build_file_index,
            commands::computer::files::computer_copy_path,
            commands::computer::files::computer_create_directory,
            commands::computer::files::computer_delete_file,
            commands::computer::files::computer_get_default_workspace,
            commands::computer::files::computer_get_file_index_summary,
            commands::computer::files::computer_get_git_status,
            commands::computer::files::computer_git_init,
            commands::computer::files::computer_git_commit,
            commands::computer::files::computer_git_create_branch,
            commands::computer::files::computer_git_create_worktree,
            commands::computer::files::computer_git_diff,
            commands::computer::files::computer_git_pull,
            commands::computer::files::computer_git_push,
            commands::computer::files::computer_git_stage,
            commands::computer::files::computer_list_directory,
            commands::computer::files::computer_list_drives,
            commands::computer::files::computer_move_path,
            commands::computer::files::computer_pick_folder,
            commands::computer::files::computer_read_text_file,
            commands::computer::files::computer_read_text_file_range,
            commands::computer::files::computer_search_file_index,
            commands::computer::files::computer_search_text_files,
            commands::computer::files::computer_write_text_file,
            commands::computer::files::computer_write_text_files,
            commands::database::gilbert_database_auto_finalize_migration,
            commands::database::gilbert_database_backup,
            commands::database::gilbert_database_cleanup_legacy_storage,
            commands::database::gilbert_database_finalize_migration,
            commands::database::gilbert_database_get_overview,
            commands::database::gilbert_database_load,
            commands::database::gilbert_database_load_chat,
            commands::database::gilbert_database_reset,
            commands::database::gilbert_database_set_value,
            commands::database::gilbert_database_set_values,
            commands::dictation::dictation_cancel,
            commands::dictation::dictation_audio_level,
            commands::dictation::dictation_prepare,
            commands::dictation::dictation_start,
            commands::dictation::dictation_status,
            commands::dictation::dictation_stop,
            commands::discord::discord_bridge_send_channel_message,
            commands::discord::discord_bridge_send_interaction_response,
            commands::discord::discord_bridge_send_webhook_message,
            commands::discord::discord_bridge_start,
            commands::discord::discord_bridge_status,
            commands::discord::discord_bridge_stop,
            commands::discord::discord_register_slash_command,
            commands::gmail::gmail_connect_oauth,
            commands::gmail::gmail_batch_modify_messages,
            commands::gmail::gmail_create_draft,
            commands::gmail::gmail_create_label,
            commands::gmail::gmail_delete_draft,
            commands::gmail::gmail_disconnect,
            commands::gmail::gmail_disconnect_account,
            commands::gmail::gmail_get_state,
            commands::gmail::gmail_api,
            commands::gmail::gmail_get_message,
            commands::gmail::gmail_get_thread,
            commands::gmail::gmail_install_plugin,
            commands::gmail::gmail_list_labels,
            commands::gmail::gmail_list_messages,
            commands::gmail::gmail_modify_message_labels,
            commands::gmail::gmail_send_draft,
            commands::gmail::gmail_send_message,
            commands::gmail::gmail_send_separate_messages,
            commands::gmail::gmail_set_active_account,
            commands::gmail::gmail_trash_message,
            commands::gmail::gmail_untrash_message,
            commands::google_calendar::calendar_connect_oauth,
            commands::google_calendar::calendar_create_event,
            commands::google_calendar::calendar_delete_event,
            commands::google_calendar::calendar_disconnect,
            commands::google_calendar::calendar_disconnect_account,
            commands::google_calendar::calendar_free_busy,
            commands::google_calendar::calendar_get_event,
            commands::google_calendar::calendar_get_state,
            commands::google_calendar::calendar_google_api,
            commands::google_calendar::calendar_install_plugin,
            commands::google_calendar::calendar_list_calendars,
            commands::google_calendar::calendar_list_events,
            commands::google_calendar::calendar_set_active_account,
            commands::google_calendar::calendar_update_event,
            commands::github::github_api,
            commands::github::github_commit_files,
            commands::github::github_begin_device_login,
            commands::github::github_connect_token,
            commands::github::github_create_branch,
            commands::github::github_create_pull_request,
            commands::github::github_create_release,
            commands::github::github_disconnect,
            commands::github::github_dispatch_workflow,
            commands::github::github_generate_release_notes,
            commands::github::github_get_repository,
            commands::github::github_get_state,
            commands::github::github_install_plugin,
            commands::github::github_list_branches,
            commands::github::github_list_repositories,
            commands::github::github_list_releases,
            commands::github::github_list_tree,
            commands::github::github_list_workflow_runs,
            commands::github::github_list_workflows,
            commands::github::github_open_device_login,
            commands::github::github_poll_device_login,
            commands::github::github_read_file,
            commands::github::github_search_code,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_call_tool_stream,
            commands::mcp::mcp_get_state,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_remove_server,
            commands::mcp::mcp_save_server,
            commands::mcp::mcp_search_registry,
            commands::mcp::mcp_test_server,
            commands::mcp::mcp_test_server_stream,
            commands::mobile_bridge::mobile_bridge_reset_pairing,
            commands::mobile_bridge::mobile_bridge_start,
            commands::mobile_bridge::mobile_bridge_status,
            commands::mobile_bridge::mobile_bridge_stop,
            commands::mobile_bridge::mobile_bridge_take_mobile_payloads,
            commands::mobile_bridge::mobile_bridge_take_mobile_requests,
            commands::mobile_bridge::mobile_bridge_update_desktop_payload,
            commands::nine_router::nine_router_local_http,
            commands::nine_router::nine_router_local_install,
            commands::nine_router::nine_router_local_ensure,
            commands::nine_router::nine_router_local_set_auto_start,
            commands::nine_router::nine_router_local_status,
            commands::nine_router::nine_router_local_stop,
            commands::nine_router::nine_router_local_stream,
            commands::nine_router::nine_router_local_uninstall,
            commands::nine_router::nine_router_oauth_callback_finish,
            commands::nine_router::nine_router_oauth_callback_start,
            commands::notifications::desktop_notification_show,
            commands::app_info::open_external_url,
            commands::project_open::project_open_external_tool,
            commands::settings::settings_get_user_config,
            commands::settings::settings_open_user_config,
            commands::settings::workspace_dependencies_diagnose,
            commands::settings::workspace_dependencies_reinstall,
            commands::terminal::terminal_create_session,
            commands::terminal::terminal_drain_session,
            commands::terminal::terminal_get_default_working_directory,
            commands::terminal::terminal_kill_session,
            commands::terminal::terminal_resize_session,
            commands::terminal::terminal_run_command,
            commands::terminal::terminal_write_session,
            commands::updates::app_update_check,
            commands::updates::app_update_install,
            commands::web::brave_search,
            commands::web::duckduckgo_search,
            commands::weather::weather_fetch_json
        ])
}

fn app_menu_command_for_id(id: &str) -> Option<&'static str> {
    match id {
        MENU_NEW_CHAT_ID => Some("new-chat"),
        MENU_SEARCH_CHATS_ID => Some("search-chats"),
        MENU_SETTINGS_ID => Some("settings"),
        MENU_SHOW_CHAT_ID => Some("show-chat"),
        MENU_SHOW_APPS_ID => Some("show-apps"),
        MENU_SHOW_TASKS_ID => Some("show-tasks"),
        MENU_SHOW_RADAR_ID => Some("show-radar"),
        MENU_TOGGLE_SIDEBAR_ID => Some("toggle-sidebar"),
        MENU_TOGGLE_TERMINAL_ID => Some("toggle-terminal"),
        MENU_APPEARANCE_SYSTEM_ID => Some("appearance-system"),
        MENU_APPEARANCE_DARK_ID => Some("appearance-dark"),
        MENU_APPEARANCE_LIGHT_ID => Some("appearance-light"),
        MENU_CHECK_UPDATES_ID => Some("check-updates"),
        MENU_SHOW_ABOUT_ID => Some("show-about"),
        _ => None,
    }
}

pub(crate) fn request_app_exit<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(state) = app.try_state::<AppLifecycleState>() {
        state.request_exit();
    }

    app.exit(0);
}

#[cfg(target_os = "macos")]
fn setup_app_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let about = menu_item(handle, MENU_SHOW_ABOUT_ID, "About Gilbert Codex", None)?;
    let new_chat = menu_item(handle, MENU_NEW_CHAT_ID, "New Chat", Some("CmdOrCtrl+N"))?;
    let search_chats = menu_item(
        handle,
        MENU_SEARCH_CHATS_ID,
        "Search Chats",
        Some("CmdOrCtrl+K"),
    )?;
    let settings = menu_item(handle, MENU_SETTINGS_ID, "Settings", Some("CmdOrCtrl+,"))?;
    let show_chat = menu_item(handle, MENU_SHOW_CHAT_ID, "Chat", None)?;
    let show_apps = menu_item(handle, MENU_SHOW_APPS_ID, "Apps", None)?;
    let show_tasks = menu_item(handle, MENU_SHOW_TASKS_ID, "Tasks", None)?;
    let show_radar = menu_item(handle, MENU_SHOW_RADAR_ID, "Radar", None)?;
    let toggle_sidebar = menu_item(
        handle,
        MENU_TOGGLE_SIDEBAR_ID,
        "Show Sidebar",
        Some("CmdOrCtrl+B"),
    )?;
    let toggle_terminal = menu_item(handle, MENU_TOGGLE_TERMINAL_ID, "Terminal", None)?;
    let appearance_system = menu_item(handle, MENU_APPEARANCE_SYSTEM_ID, "System Theme", None)?;
    let appearance_dark = menu_item(handle, MENU_APPEARANCE_DARK_ID, "Dark Theme", None)?;
    let appearance_light = menu_item(handle, MENU_APPEARANCE_LIGHT_ID, "Light Theme", None)?;
    let check_updates = menu_item(handle, MENU_CHECK_UPDATES_ID, "Check for Updates", None)?;

    let app_menu = SubmenuBuilder::new(handle, "Gilbert Codex")
        .item(&about)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&new_chat)
        .item(&search_chats)
        .build()?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&toggle_sidebar)
        .item(&toggle_terminal)
        .separator()
        .item(&show_chat)
        .item(&show_apps)
        .item(&show_tasks)
        .item(&show_radar)
        .separator()
        .item(&appearance_system)
        .item(&appearance_dark)
        .item(&appearance_light)
        .build()?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .fullscreen()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .item(&check_updates)
        .build()?;
    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn setup_app_menu(_app: &mut tauri::App) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn menu_item<R: Runtime, M: Manager<R>>(
    manager: &M,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut item = MenuItemBuilder::with_id(id, text);
    if let Some(accelerator) = accelerator {
        item = item.accelerator(accelerator);
    }

    item.build(manager)
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_OPEN_ID, "Open Gilbert Codex")
        .separator()
        .text(TRAY_QUIT_ID, "Quit Gilbert Codex")
        .build()?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Gilbert Codex")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_OPEN_ID => show_main_window(app),
            TRAY_QUIT_ID => request_app_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_native_app_menu_ids_to_frontend_commands() {
        assert_eq!(app_menu_command_for_id(MENU_NEW_CHAT_ID), Some("new-chat"));
        assert_eq!(
            app_menu_command_for_id(MENU_SEARCH_CHATS_ID),
            Some("search-chats")
        );
        assert_eq!(app_menu_command_for_id(MENU_SETTINGS_ID), Some("settings"));
        assert_eq!(
            app_menu_command_for_id(MENU_SHOW_CHAT_ID),
            Some("show-chat")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_SHOW_APPS_ID),
            Some("show-apps")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_SHOW_TASKS_ID),
            Some("show-tasks")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_SHOW_RADAR_ID),
            Some("show-radar")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_TOGGLE_SIDEBAR_ID),
            Some("toggle-sidebar")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_TOGGLE_TERMINAL_ID),
            Some("toggle-terminal")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_APPEARANCE_SYSTEM_ID),
            Some("appearance-system")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_APPEARANCE_DARK_ID),
            Some("appearance-dark")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_APPEARANCE_LIGHT_ID),
            Some("appearance-light")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_CHECK_UPDATES_ID),
            Some("check-updates")
        );
        assert_eq!(
            app_menu_command_for_id(MENU_SHOW_ABOUT_ID),
            Some("show-about")
        );
    }

    #[test]
    fn leaves_tray_menu_events_to_the_tray_handler() {
        assert_eq!(app_menu_command_for_id(TRAY_OPEN_ID), None);
        assert_eq!(app_menu_command_for_id(TRAY_QUIT_ID), None);
        assert_eq!(app_menu_command_for_id("unknown-menu-item"), None);
    }
}
