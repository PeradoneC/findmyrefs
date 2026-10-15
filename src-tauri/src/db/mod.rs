//! SQLite connection setup and schema migrations.
//!
//! Migrations are applied in order and tracked with `PRAGMA user_version`. Add new
//! migrations to the end of `MIGRATIONS`; never edit one that has shipped.

pub mod repo;

use std::path::Path;

use rusqlite::Connection;

use crate::error::AppResult;

const MIGRATIONS: &[&str] = &[
    // 1: initial schema
    r#"
    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        original_prompt TEXT NOT NULL DEFAULT '',
        structured_brief_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE search_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        provider TEXT NOT NULL,
        category TEXT,
        result_count INTEGER,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_search_sessions_project ON search_sessions(project_id, created_at);

    CREATE TABLE saved_references (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_result_id TEXT NOT NULL,
        title TEXT NOT NULL,
        thumbnail_url TEXT,
        source_url TEXT NOT NULL,
        creator_name TEXT,
        width INTEGER,
        height INTEGER,
        license_label TEXT,
        category TEXT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        user_notes TEXT NOT NULL DEFAULT '',
        analysis_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, provider, provider_result_id)
    );
    CREATE INDEX idx_saved_references_project ON saved_references(project_id);

    CREATE TABLE board_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        reference_id TEXT NOT NULL REFERENCES saved_references(id) ON DELETE CASCADE,
        group_name TEXT NOT NULL DEFAULT '',
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, reference_id)
    );
    CREATE INDEX idx_board_items_project ON board_items(project_id);

    CREATE TABLE hidden_results (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        result_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, result_key)
    );

    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
    );

    CREATE TABLE usage_log (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        feature TEXT NOT NULL,
        image_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER,
        output_tokens INTEGER,
        estimated_cost_usd REAL,
        status TEXT NOT NULL,
        error_code TEXT
    );
    CREATE INDEX idx_usage_log_created ON usage_log(created_at);

    CREATE TABLE analysis_cache (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        source_id TEXT NOT NULL,
        analysis_version INTEGER NOT NULL,
        analysis_json TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    "#,
];

/// Open (or create) the database at `path` and bring the schema up to date.
pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            crate::error::AppError::Internal(format!("Cannot create data folder: {e}"))
        })?;
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// In-memory database for tests.
pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    Ok(())
}

pub fn schema_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let current = schema_version(conn)? as usize;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}
