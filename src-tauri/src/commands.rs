//! Tauri commands exposed to the frontend. Thin wrappers over `db::repo`,
//! `settings` and `ai_service`.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::ai_service::{self, AiContext, AiStatus, BriefAnalysisOutput, ImageAnalysisResult};
use crate::db::repo;
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::providers::anthropic::{ImageAnalysisItem, ReqwestTransport};
use crate::providers::pinterest::{PinterestClient, PinterestError, SearchParams};
use crate::secrets::{ApiKey, SecretKind, SecretStore};
use crate::settings::{self, AppSettings, SettingsPatch};
use crate::url_check;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: PathBuf,
    pub secrets: Box<dyn SecretStore>,
    pub transport: ReqwestTransport,
    pub pinterest: PinterestClient,
}

impl AppState {
    fn conn(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::Internal("database lock poisoned".into()))
    }
}

type Cmd<T> = Result<T, AppError>;

// ----------------------------------------------------------------- app info

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub db_path: String,
    pub schema_version: i64,
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> Cmd<AppInfo> {
    let conn = state.conn()?;
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        db_path: state.db_path.display().to_string(),
        schema_version: crate::db::schema_version(&conn)?,
    })
}

// ----------------------------------------------------------------- projects

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Cmd<Vec<Project>> {
    repo::list_projects(&*state.conn()?)
}

#[tauri::command]
pub fn get_project(state: State<'_, AppState>, id: String) -> Cmd<Option<Project>> {
    repo::get_project(&*state.conn()?, &id)
}

#[tauri::command]
pub fn create_project(state: State<'_, AppState>, name: String) -> Cmd<Project> {
    repo::create_project(&*state.conn()?, &name)
}

#[tauri::command]
pub fn update_project(state: State<'_, AppState>, id: String, patch: ProjectPatch) -> Cmd<Project> {
    repo::update_project(&*state.conn()?, &id, &patch)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Cmd<()> {
    repo::delete_project(&*state.conn()?, &id)
}

// ---------------------------------------------------------- search sessions

#[tauri::command]
pub fn record_search_session(
    state: State<'_, AppState>,
    input: NewSearchSession,
) -> Cmd<SearchSession> {
    repo::insert_search_session(&*state.conn()?, &input)
}

#[tauri::command]
pub fn list_search_sessions(
    state: State<'_, AppState>,
    project_id: String,
) -> Cmd<Vec<SearchSession>> {
    repo::list_search_sessions(&*state.conn()?, &project_id)
}

// --------------------------------------------------------------- references

#[tauri::command]
pub fn save_reference(state: State<'_, AppState>, input: NewReference) -> Cmd<SavedReference> {
    repo::save_reference(&*state.conn()?, &input)
}

#[tauri::command]
pub fn list_references(state: State<'_, AppState>, project_id: String) -> Cmd<Vec<SavedReference>> {
    repo::list_references(&*state.conn()?, &project_id)
}

#[tauri::command]
pub fn update_reference_notes(
    state: State<'_, AppState>,
    id: String,
    notes: String,
) -> Cmd<SavedReference> {
    repo::update_reference_notes(&*state.conn()?, &id, &notes)
}

#[tauri::command]
pub fn set_reference_analysis(
    state: State<'_, AppState>,
    id: String,
    analysis_json: Option<String>,
) -> Cmd<()> {
    if let Some(json) = &analysis_json {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|_| AppError::Invalid("Analysis is not valid JSON".into()))?;
    }
    repo::set_reference_analysis(&*state.conn()?, &id, analysis_json.as_deref())
}

#[tauri::command]
pub fn delete_reference(state: State<'_, AppState>, id: String) -> Cmd<()> {
    repo::delete_reference(&*state.conn()?, &id)
}

// -------------------------------------------------------------------- board

#[tauri::command]
pub fn list_board_items(state: State<'_, AppState>, project_id: String) -> Cmd<Vec<BoardItem>> {
    repo::list_board_items(&*state.conn()?, &project_id)
}

#[tauri::command]
pub fn add_board_item(state: State<'_, AppState>, input: NewBoardItem) -> Cmd<BoardItem> {
    repo::add_board_item(&*state.conn()?, &input)
}

#[tauri::command]
pub fn update_board_item(
    state: State<'_, AppState>,
    id: String,
    patch: BoardItemPatch,
) -> Cmd<BoardItem> {
    repo::update_board_item(&*state.conn()?, &id, &patch)
}

#[tauri::command]
pub fn remove_board_item(state: State<'_, AppState>, id: String) -> Cmd<()> {
    repo::remove_board_item(&*state.conn()?, &id)
}

// ----------------------------------------------------------- hidden results

#[tauri::command]
pub fn list_hidden_results(state: State<'_, AppState>, project_id: String) -> Cmd<Vec<String>> {
    repo::list_hidden_results(&*state.conn()?, &project_id)
}

#[tauri::command]
pub fn hide_result(state: State<'_, AppState>, project_id: String, result_key: String) -> Cmd<()> {
    repo::hide_result(&*state.conn()?, &project_id, &result_key)
}

#[tauri::command]
pub fn unhide_all_results(state: State<'_, AppState>, project_id: String) -> Cmd<()> {
    repo::unhide_all(&*state.conn()?, &project_id)
}

// ----------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Cmd<AppSettings> {
    settings::load(&*state.conn()?)
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, patch: SettingsPatch) -> Cmd<AppSettings> {
    settings::update(&*state.conn()?, patch)
}

// --------------------------------------------------------- secrets & status

#[tauri::command]
pub fn get_ai_status(state: State<'_, AppState>) -> Cmd<AiStatus> {
    ai_service::status(&state.db, state.secrets.as_ref())
}

/// Stores the key in the OS credential store. The key is never returned.
#[tauri::command]
pub fn set_api_key(state: State<'_, AppState>, key: String) -> Cmd<()> {
    state
        .secrets
        .set(SecretKind::AnthropicApiKey, ApiKey::new(&key)?)
}

#[tauri::command]
pub fn clear_api_key(state: State<'_, AppState>) -> Cmd<()> {
    state.secrets.clear(SecretKind::AnthropicApiKey)
}

// -------------------------------------------------------------------- usage

#[tauri::command]
pub fn list_usage(state: State<'_, AppState>) -> Cmd<Vec<UsageRecord>> {
    repo::list_usage(&*state.conn()?, 500)
}

#[tauri::command]
pub fn clear_usage(state: State<'_, AppState>) -> Cmd<()> {
    repo::clear_usage(&*state.conn()?)
}

// --------------------------------------------------------- analysis cache

#[tauri::command]
pub fn get_cached_analyses(
    state: State<'_, AppState>,
    cache_keys: Vec<String>,
) -> Cmd<Vec<CachedAnalysis>> {
    if cache_keys.len() > 500 {
        return Err(AppError::Invalid("Too many cache keys".into()));
    }
    repo::get_cached_analyses(&*state.conn()?, &cache_keys)
}

/// Stores a free (mock) analysis. Paid analyses are cached by the backend itself.
#[tauri::command]
pub fn put_cached_analysis(state: State<'_, AppState>, entry: CachedAnalysis) -> Cmd<()> {
    if entry.provider == ai_service::PROVIDER_ID {
        return Err(AppError::Invalid(
            "Paid analyses are cached by the backend".into(),
        ));
    }
    repo::put_cached_analysis(&*state.conn()?, &entry)
}

#[tauri::command]
pub fn clear_analysis_cache(state: State<'_, AppState>) -> Cmd<()> {
    state.conn()?.execute("DELETE FROM analysis_cache", [])?;
    Ok(())
}

// ---------------------------------------------------------------- paid AI

#[tauri::command]
pub async fn anthropic_analyze_brief(
    state: State<'_, AppState>,
    prompt: String,
    confirmed: bool,
) -> Cmd<BriefAnalysisOutput> {
    let ctx = AiContext {
        db: &state.db,
        secrets: state.secrets.as_ref(),
        transport: &state.transport,
    };
    ai_service::analyze_brief(&ctx, &prompt, confirmed).await
}

#[tauri::command]
pub async fn anthropic_analyze_images(
    state: State<'_, AppState>,
    items: Vec<ImageAnalysisItem>,
    confirmed: bool,
    force_refresh: bool,
) -> Cmd<Vec<ImageAnalysisResult>> {
    let ctx = AiContext {
        db: &state.db,
        secrets: state.secrets.as_ref(),
        transport: &state.transport,
    };
    ai_service::analyze_images(&ctx, items, confirmed, force_refresh).await
}

// ----------------------------------------------------------------- opener

/// Opens an http(s) link in the user's default browser. Other schemes are refused.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Cmd<()> {
    let parsed = url_check::require_http_url(&url)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| AppError::Internal(format!("Could not open the link: {e}")))
}

// ---------------------------------------------------------------- Pinterest

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinterestStatus {
    pub has_token: bool,
    pub secure_storage: &'static str,
    pub country: String,
}

#[tauri::command]
pub fn get_pinterest_status(state: State<'_, AppState>) -> Cmd<PinterestStatus> {
    let has_token = state.secrets.get(SecretKind::PinterestToken)?.is_some();
    let country = settings::load(&*state.conn()?)?.pinterest_country;
    Ok(PinterestStatus {
        has_token,
        secure_storage: state.secrets.description(),
        country,
    })
}

/// Stores the Pinterest access token in the OS credential store. It is never returned.
#[tauri::command]
pub fn set_pinterest_token(state: State<'_, AppState>, token: String) -> Cmd<()> {
    state
        .secrets
        .set(SecretKind::PinterestToken, ApiKey::new(&token)?)
}

#[tauri::command]
pub fn clear_pinterest_token(state: State<'_, AppState>) -> Cmd<()> {
    state.secrets.clear(SecretKind::PinterestToken)
}

/// Loads the token and country for a Pinterest search (no network).
pub fn pinterest_request_context(
    db: &Mutex<Connection>,
    secrets: &dyn SecretStore,
) -> AppResult<(ApiKey, String)> {
    let token = secrets
        .get(SecretKind::PinterestToken)?
        .ok_or(AppError::Pinterest(PinterestError::NoToken))?;
    let conn = db
        .lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))?;
    Ok((token, settings::load(&conn)?.pinterest_country))
}

/// Official Pinterest keyword search. Returns the validated raw JSON body
/// (`{ items: [...], bookmark }`), which the frontend normalizes.
#[tauri::command]
pub async fn pinterest_search(state: State<'_, AppState>, params: SearchParams) -> Cmd<String> {
    let (token, country) = pinterest_request_context(&state.db, state.secrets.as_ref())?;
    state
        .pinterest
        .search(&token, &params, &country)
        .await
        .map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecretStore;

    #[test]
    fn pinterest_search_requires_a_token() {
        let db = Mutex::new(crate::db::open_in_memory().unwrap());
        let secrets = MemorySecretStore::default();
        let err = pinterest_request_context(&db, &secrets).unwrap_err();
        assert_eq!(err.code(), "pinterest_no_token");
        // The Anthropic key is a different secret and does not count.
        secrets
            .set(
                SecretKind::AnthropicApiKey,
                ApiKey::new("sk-ant-x").unwrap(),
            )
            .unwrap();
        assert!(pinterest_request_context(&db, &secrets).is_err());
        secrets
            .set(
                SecretKind::PinterestToken,
                ApiKey::new("pina_SECRET").unwrap(),
            )
            .unwrap();
        let (token, country) = pinterest_request_context(&db, &secrets).unwrap();
        assert_eq!(token.expose(), "pina_SECRET");
        assert_eq!(country, "US");
    }

    #[test]
    fn pinterest_errors_serialize_without_secrets() {
        let err = AppError::from(PinterestError::NotApproved("not permitted".into()));
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"code\":\"pinterest_not_approved\""));
        assert!(json.contains("\"kind\":\"provider\""));
        assert!(!json.contains("pina_"));
    }
}
