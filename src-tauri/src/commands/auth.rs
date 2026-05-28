use crate::core::{
    fs_utils::{delete_legacy_file_and_empty_parent as delete_legacy_file, path_to_string},
    storage::{self, SYSTEM_NAMESPACE},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use uuid::Uuid;

const AUTH_DATABASE_FILE: &str = "local-auth-db.json";
const AUTH_DATABASE_STORAGE_KEY: &str = "local-auth-db.v1";
const CLOUD_ACCOUNT_SCOPE_STORAGE_KEY: &str = "firebase-active-account.v1";
const AUTH_DATABASE_GENERATION: u32 = 2;
const PASSWORD_ALGORITHM: &str = "pbkdf2-sha256";
const MIN_PASSWORD_ITERATIONS: u32 = 100_000;

#[derive(Default)]
pub struct AuthState {
    lock: Mutex<()>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthDatabase {
    current_session: Option<AuthSessionRecord>,
    #[serde(default)]
    database_generation: u32,
    #[serde(default)]
    users: Vec<AuthUserRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthUserRecord {
    created_at: u64,
    display_name: String,
    email: String,
    id: String,
    last_login_at: Option<u64>,
    password_hash: String,
    password_hash_algorithm: String,
    password_iterations: u32,
    password_salt: String,
    updated_at: u64,
    username: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionRecord {
    created_at: u64,
    session_token: String,
    user_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub created_at: u64,
    pub display_name: String,
    pub email: String,
    pub id: String,
    pub last_login_at: Option<u64>,
    pub updated_at: u64,
    pub username: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub created_at: u64,
    pub session_token: String,
    pub user: AuthUser,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateResponse {
    pub has_accounts: bool,
    pub session: Option<AuthSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCreateAccountRequest {
    pub display_name: String,
    pub email: String,
    pub password_hash: String,
    pub password_hash_algorithm: String,
    pub password_iterations: u32,
    pub password_salt: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginChallengeRequest {
    pub login: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginChallenge {
    pub display_name: String,
    pub password_hash_algorithm: String,
    pub password_iterations: u32,
    pub password_salt: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginRequest {
    pub login: String,
    pub password_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCloudAccountScopeRequest {
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCloudAccountScopeResponse {
    pub configured: bool,
    pub namespace: Option<String>,
    pub user_id: Option<String>,
}

#[tauri::command]
pub fn auth_get_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<AuthStateResponse, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let database = load_database(&app)?;

    Ok(create_state_response(&database))
}

#[tauri::command]
pub fn auth_create_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
    request: AuthCreateAccountRequest,
) -> Result<AuthSession, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let display_name = normalize_display_name(&request.display_name)?;
    let username = normalize_username(&request.username)?;
    let email = normalize_email(&request.email)?;
    let password_material = normalize_password_material(
        request.password_hash,
        request.password_salt,
        request.password_hash_algorithm,
        request.password_iterations,
    )?;

    if database
        .users
        .iter()
        .any(|user| user.username.eq_ignore_ascii_case(&username))
    {
        return Err("That username is already used by another local account.".to_string());
    }

    if database
        .users
        .iter()
        .any(|user| user.email.eq_ignore_ascii_case(&email))
    {
        return Err("That email is already used by another local account.".to_string());
    }

    let now = now_millis();
    let user = AuthUserRecord {
        created_at: now,
        display_name,
        email,
        id: format!("user-{}", Uuid::new_v4()),
        last_login_at: Some(now),
        password_hash: password_material.hash,
        password_hash_algorithm: password_material.algorithm,
        password_iterations: password_material.iterations,
        password_salt: password_material.salt,
        updated_at: now,
        username,
    };
    let session_record = AuthSessionRecord {
        created_at: now,
        session_token: format!("session-{}", Uuid::new_v4()),
        user_id: user.id.clone(),
    };
    let session = AuthSession {
        created_at: session_record.created_at,
        session_token: session_record.session_token.clone(),
        user: AuthUser::from(&user),
    };

    database.users.push(user);
    database.current_session = Some(session_record);
    save_database(&app, &database)?;

    Ok(session)
}

#[tauri::command]
pub fn auth_get_login_challenge(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
    request: AuthLoginChallengeRequest,
) -> Result<AuthLoginChallenge, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let database = load_database(&app)?;
    let user = find_user(&database, &request.login)
        .ok_or_else(|| "No local account matches that username or email.".to_string())?;

    Ok(AuthLoginChallenge {
        display_name: user.display_name.clone(),
        password_hash_algorithm: user.password_hash_algorithm.clone(),
        password_iterations: user.password_iterations,
        password_salt: user.password_salt.clone(),
        username: user.username.clone(),
    })
}

#[tauri::command]
pub fn auth_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
    request: AuthLoginRequest,
) -> Result<AuthSession, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let user_index = find_user_index(&database, &request.login)
        .ok_or_else(|| "No local account matches that username or email.".to_string())?;
    let candidate_hash = request.password_hash.trim();

    if candidate_hash.is_empty() || candidate_hash != database.users[user_index].password_hash {
        return Err("The password did not match this local account.".to_string());
    }

    let now = now_millis();
    database.users[user_index].last_login_at = Some(now);
    database.users[user_index].updated_at = now;

    let session_record = AuthSessionRecord {
        created_at: now,
        session_token: format!("session-{}", Uuid::new_v4()),
        user_id: database.users[user_index].id.clone(),
    };
    let session = AuthSession {
        created_at: session_record.created_at,
        session_token: session_record.session_token.clone(),
        user: AuthUser::from(&database.users[user_index]),
    };

    database.current_session = Some(session_record);
    save_database(&app, &database)?;

    Ok(session)
}

#[tauri::command]
pub fn auth_logout(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;

    database.current_session = None;
    save_database(&app, &database)
}

#[tauri::command]
pub fn auth_get_cloud_account_scope(
    app: tauri::AppHandle,
) -> Result<AuthCloudAccountScopeResponse, String> {
    let configured_scope = read_configured_cloud_account_scope(&app)?;
    Ok(create_cloud_account_scope_response(configured_scope))
}

#[tauri::command]
pub fn auth_set_cloud_account_scope(
    app: tauri::AppHandle,
    request: AuthCloudAccountScopeRequest,
) -> Result<AuthCloudAccountScopeResponse, String> {
    let user_id = normalize_cloud_user_id(request.user_id.as_deref())?;
    let raw_value = user_id.as_deref().unwrap_or("");

    storage::write_value(
        &app,
        SYSTEM_NAMESPACE,
        CLOUD_ACCOUNT_SCOPE_STORAGE_KEY,
        raw_value,
    )?;

    Ok(create_cloud_account_scope_response(Some(user_id)))
}

pub fn current_user_storage_namespace(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(configured_scope) = read_configured_cloud_account_scope(app)? {
        let user_id = configured_scope
            .ok_or_else(|| "Sign in before opening account-scoped local data.".to_string())?;

        return storage::user_namespace(&user_id);
    }

    let database = load_database(app)?;
    let session = database
        .current_session
        .as_ref()
        .ok_or_else(|| "Sign in before opening account-scoped local data.".to_string())?;
    let user = database
        .users
        .iter()
        .find(|user| user.id == session.user_id)
        .ok_or_else(|| "The signed-in local account is no longer available.".to_string())?;

    storage::user_namespace(&user.id)
}

fn create_cloud_account_scope_response(
    configured_scope: Option<Option<String>>,
) -> AuthCloudAccountScopeResponse {
    let user_id = configured_scope.as_ref().and_then(|scope| scope.clone());
    let namespace = user_id
        .as_ref()
        .and_then(|id| storage::user_namespace(id).ok());

    AuthCloudAccountScopeResponse {
        configured: configured_scope.is_some(),
        namespace,
        user_id,
    }
}

fn read_configured_cloud_account_scope(
    app: &tauri::AppHandle,
) -> Result<Option<Option<String>>, String> {
    storage::read_value(app, SYSTEM_NAMESPACE, CLOUD_ACCOUNT_SCOPE_STORAGE_KEY)?
        .map(|value| normalize_cloud_user_id(Some(&value)))
        .transpose()
}

fn normalize_cloud_user_id(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.len() > 128 {
        return Err("Cloud account id is too long.".to_string());
    }

    if !trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
    }) {
        return Err("Cloud account id contains unsupported characters.".to_string());
    }

    Ok(Some(trimmed.to_string()))
}

impl From<&AuthUserRecord> for AuthUser {
    fn from(user: &AuthUserRecord) -> Self {
        Self {
            created_at: user.created_at,
            display_name: user.display_name.clone(),
            email: user.email.clone(),
            id: user.id.clone(),
            last_login_at: user.last_login_at,
            updated_at: user.updated_at,
            username: user.username.clone(),
        }
    }
}

struct PasswordMaterial {
    algorithm: String,
    hash: String,
    iterations: u32,
    salt: String,
}

fn create_state_response(database: &AuthDatabase) -> AuthStateResponse {
    AuthStateResponse {
        has_accounts: !database.users.is_empty(),
        session: database
            .current_session
            .as_ref()
            .and_then(|session| create_session(database, session)),
    }
}

fn create_session(database: &AuthDatabase, session: &AuthSessionRecord) -> Option<AuthSession> {
    let user = database
        .users
        .iter()
        .find(|user| user.id == session.user_id)?;

    Some(AuthSession {
        created_at: session.created_at,
        session_token: session.session_token.clone(),
        user: AuthUser::from(user),
    })
}

fn find_user<'a>(database: &'a AuthDatabase, login: &str) -> Option<&'a AuthUserRecord> {
    let normalized_login = login.trim().to_lowercase();

    database.users.iter().find(|user| {
        user.username.eq_ignore_ascii_case(&normalized_login)
            || user.email.eq_ignore_ascii_case(&normalized_login)
    })
}

fn find_user_index(database: &AuthDatabase, login: &str) -> Option<usize> {
    let normalized_login = login.trim().to_lowercase();

    database.users.iter().position(|user| {
        user.username.eq_ignore_ascii_case(&normalized_login)
            || user.email.eq_ignore_ascii_case(&normalized_login)
    })
}

fn normalize_display_name(value: &str) -> Result<String, String> {
    let display_name = value.trim();

    if display_name.len() < 2 {
        return Err("Enter a display name with at least 2 characters.".to_string());
    }

    if display_name.len() > 80 {
        return Err("Keep the display name under 80 characters.".to_string());
    }

    Ok(display_name.to_string())
}

fn normalize_username(value: &str) -> Result<String, String> {
    let username = value.trim().trim_start_matches('@').to_lowercase();

    if username.len() < 3 {
        return Err("Choose a username with at least 3 characters.".to_string());
    }

    if username.len() > 32 {
        return Err("Keep the username under 32 characters.".to_string());
    }

    if !username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
    {
        return Err(
            "Use only letters, numbers, dots, dashes, or underscores in the username.".to_string(),
        );
    }

    Ok(username)
}

fn normalize_email(value: &str) -> Result<String, String> {
    let email = value.trim().to_lowercase();

    if email.len() > 254
        || !email.contains('@')
        || !email
            .rsplit_once('@')
            .is_some_and(|(_, domain)| domain.contains('.'))
    {
        return Err("Enter a valid email address for this local account.".to_string());
    }

    Ok(email)
}

fn normalize_password_material(
    hash: String,
    salt: String,
    algorithm: String,
    iterations: u32,
) -> Result<PasswordMaterial, String> {
    let normalized_algorithm = algorithm.trim().to_lowercase();
    let normalized_hash = hash.trim().to_string();
    let normalized_salt = salt.trim().to_string();

    if normalized_algorithm != PASSWORD_ALGORITHM {
        return Err("Unsupported local password hashing algorithm.".to_string());
    }

    if iterations < MIN_PASSWORD_ITERATIONS {
        return Err("Local password hashing iterations are too low.".to_string());
    }

    if normalized_hash.len() < 32 || normalized_salt.len() < 16 {
        return Err("The local password verifier is incomplete.".to_string());
    }

    Ok(PasswordMaterial {
        algorithm: normalized_algorithm,
        hash: normalized_hash,
        iterations,
        salt: normalized_salt,
    })
}

fn load_database(app: &tauri::AppHandle) -> Result<AuthDatabase, String> {
    if let Some(content) = storage::read_value(app, SYSTEM_NAMESPACE, AUTH_DATABASE_STORAGE_KEY)? {
        let parsed = parse_database_content(&content, "Gilbert Database auth record")?;
        if parsed.repaired {
            save_database(app, &parsed.database)?;
        }
        cleanup_legacy_database(app);
        return Ok(parsed.database);
    }

    let database_path = legacy_database_path(app)?;

    if !database_path.exists() {
        return Ok(fresh_database());
    }

    let content = match fs::read_to_string(&database_path) {
        Ok(content) => content,
        Err(_) => {
            if preserve_legacy_database_copy(&database_path, "unreadable").is_ok() {
                let _ = delete_legacy_file(&database_path, "local auth database");
            }
            return Ok(fresh_database());
        }
    };

    if content.trim().is_empty() {
        let _ = delete_legacy_file(&database_path, "local auth database");
        return Ok(fresh_database());
    }

    let parsed = match parse_database_content(
        &content,
        &format!(
            "legacy local auth database at {}",
            path_to_string(&database_path)
        ),
    ) {
        Ok(database) => database,
        Err(_) => {
            if preserve_legacy_database_copy(&database_path, "invalid").is_ok() {
                let _ = delete_legacy_file(&database_path, "local auth database");
            }
            return Ok(fresh_database());
        }
    };
    let migrated_content = serde_json::to_string_pretty(&parsed.database).map_err(|error| {
        format!("Could not serialize the migrated local auth database: {error}")
    })?;
    storage::write_value(
        app,
        SYSTEM_NAMESPACE,
        AUTH_DATABASE_STORAGE_KEY,
        &migrated_content,
    )?;
    let _ = delete_legacy_file(&database_path, "local auth database");

    Ok(parsed.database)
}

fn save_database(app: &tauri::AppHandle, database: &AuthDatabase) -> Result<(), String> {
    let content = serde_json::to_string_pretty(database)
        .map_err(|error| format!("Could not serialize the local auth database: {}", error))?;

    storage::write_value(app, SYSTEM_NAMESPACE, AUTH_DATABASE_STORAGE_KEY, &content).map_err(
        |error| format!("Could not write the local auth database to Gilbert Database: {error}"),
    )
}

struct ParsedAuthDatabase {
    database: AuthDatabase,
    repaired: bool,
}

fn parse_database_content(content: &str, source: &str) -> Result<ParsedAuthDatabase, String> {
    let database = serde_json::from_str::<AuthDatabase>(content).map_err(|error| {
        format!("Could not parse the local auth database from {source}: {error}")
    })?;

    Ok(repair_database(database))
}

fn repair_database(mut database: AuthDatabase) -> ParsedAuthDatabase {
    let mut repaired = false;

    if database.database_generation < AUTH_DATABASE_GENERATION {
        database.database_generation = AUTH_DATABASE_GENERATION;
        repaired = true;
    }

    if let Some(session) = database.current_session.as_ref() {
        let session_has_user = database.users.iter().any(|user| user.id == session.user_id);
        let session_has_token = !session.session_token.trim().is_empty();

        if !session_has_user || !session_has_token {
            database.current_session = None;
            repaired = true;
        }
    }

    ParsedAuthDatabase { database, repaired }
}

fn legacy_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("auth").join(AUTH_DATABASE_FILE))
        .map_err(|error| format!("Could not resolve the local app data folder: {}", error))
}

fn preserve_legacy_database_copy(path: &PathBuf, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let backup_path = path.with_file_name(format!("local-auth-db.{label}.{}.json", now_millis()));
    fs::copy(path, &backup_path).map(|_| ()).map_err(|error| {
        format!(
            "Could not preserve a recovery copy of the local auth database at {}: {error}",
            path_to_string(&backup_path)
        )
    })
}

fn cleanup_legacy_database(app: &tauri::AppHandle) {
    if let Ok(database_path) = legacy_database_path(app) {
        let _ = delete_legacy_file(&database_path, "local auth database");
    }
}

fn fresh_database() -> AuthDatabase {
    AuthDatabase {
        current_session: None,
        database_generation: AUTH_DATABASE_GENERATION,
        users: Vec::new(),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth_user(id: &str) -> AuthUserRecord {
        AuthUserRecord {
            created_at: 1,
            display_name: "Test User".to_string(),
            email: format!("{id}@example.com"),
            id: id.to_string(),
            last_login_at: Some(1),
            password_hash: "x".repeat(44),
            password_hash_algorithm: PASSWORD_ALGORITHM.to_string(),
            password_iterations: MIN_PASSWORD_ITERATIONS,
            password_salt: "s".repeat(24),
            updated_at: 1,
            username: id.to_string(),
        }
    }

    #[test]
    fn older_auth_generation_is_upgraded_without_dropping_users() {
        let content = serde_json::json!({
            "currentSession": {
                "createdAt": 1,
                "sessionToken": "session-existing",
                "userId": "user-a"
            },
            "databaseGeneration": 1,
            "users": [{
                "createdAt": 1,
                "displayName": "Test User",
                "email": "user-a@example.com",
                "id": "user-a",
                "lastLoginAt": 1,
                "passwordHash": "x".repeat(44),
                "passwordHashAlgorithm": PASSWORD_ALGORITHM,
                "passwordIterations": MIN_PASSWORD_ITERATIONS,
                "passwordSalt": "s".repeat(24),
                "updatedAt": 1,
                "username": "user-a"
            }]
        })
        .to_string();

        let parsed = parse_database_content(&content, "test auth db").unwrap();

        assert!(parsed.repaired);
        assert_eq!(
            parsed.database.database_generation,
            AUTH_DATABASE_GENERATION
        );
        assert_eq!(parsed.database.users.len(), 1);
        assert_eq!(parsed.database.current_session.unwrap().user_id, "user-a");
    }

    #[test]
    fn dangling_auth_session_is_cleared_without_dropping_accounts() {
        let database = AuthDatabase {
            current_session: Some(AuthSessionRecord {
                created_at: 1,
                session_token: "session-missing-user".to_string(),
                user_id: "user-missing".to_string(),
            }),
            database_generation: AUTH_DATABASE_GENERATION,
            users: vec![auth_user("user-a")],
        };
        let content = serde_json::to_string(&database).unwrap();

        let parsed = parse_database_content(&content, "test auth db").unwrap();

        assert!(parsed.repaired);
        assert_eq!(parsed.database.users.len(), 1);
        assert!(parsed.database.current_session.is_none());
    }
}
