//! FindMyRefs desktop backend: SQLite persistence, secure key storage and the
//! optional paid Anthropic API adapter.

pub mod ai_service;
pub mod commands;
pub mod db;
pub mod error;
pub mod guard;
pub mod models;
pub mod pricing;
pub mod providers;
pub mod secrets;
pub mod settings;
pub mod url_check;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

use commands::AppState;

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(custom) = std::env::var("FINDMYREFS_DB_PATH")
        && !custom.trim().is_empty()
    {
        return Ok(PathBuf::from(custom));
    }
    Ok(app.path().app_data_dir()?.join("findmyrefs.sqlite"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = database_path(app.handle())?;
            let conn = db::open(&db_path)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
                secrets: Box::new(secrets::KeyringStore),
                transport: providers::anthropic::ReqwestTransport::new(),
                pinterest: providers::pinterest::PinterestClient::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::list_projects,
            commands::get_project,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::record_search_session,
            commands::list_search_sessions,
            commands::save_reference,
            commands::list_references,
            commands::update_reference_notes,
            commands::set_reference_analysis,
            commands::delete_reference,
            commands::list_board_items,
            commands::add_board_item,
            commands::update_board_item,
            commands::remove_board_item,
            commands::list_hidden_results,
            commands::hide_result,
            commands::unhide_all_results,
            commands::get_settings,
            commands::update_settings,
            commands::get_ai_status,
            commands::set_api_key,
            commands::clear_api_key,
            commands::list_usage,
            commands::clear_usage,
            commands::get_cached_analyses,
            commands::put_cached_analysis,
            commands::clear_analysis_cache,
            commands::anthropic_analyze_brief,
            commands::anthropic_analyze_images,
            commands::get_pinterest_status,
            commands::set_pinterest_token,
            commands::clear_pinterest_token,
            commands::pinterest_search,
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FindMyRefs");
}
