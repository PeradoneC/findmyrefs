//! Parameterized queries for every persisted entity.

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::models::*;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn current_month() -> String {
    chrono::Utc::now().format("%Y-%m").to_string()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn require_text(value: &str, field: &str, max_len: usize) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid(format!("{field} must not be empty")));
    }
    if trimmed.chars().count() > max_len {
        return Err(AppError::Invalid(format!(
            "{field} is too long (max {max_len} characters)"
        )));
    }
    Ok(trimmed.to_string())
}

// ---------------------------------------------------------------- projects

fn project_from_row(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        original_prompt: row.get("original_prompt")?,
        structured_brief_json: row.get("structured_brief_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_projects(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare("SELECT * FROM projects ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([], project_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_project(conn: &Connection, id: &str) -> AppResult<Option<Project>> {
    Ok(conn
        .query_row(
            "SELECT * FROM projects WHERE id = ?1",
            [id],
            project_from_row,
        )
        .optional()?)
}

pub fn create_project(conn: &Connection, name: &str) -> AppResult<Project> {
    let name = require_text(name, "Project name", 200)?;
    let ts = now();
    let project = Project {
        id: new_id(),
        name,
        original_prompt: String::new(),
        structured_brief_json: None,
        created_at: ts.clone(),
        updated_at: ts,
    };
    conn.execute(
        "INSERT INTO projects (id, name, original_prompt, structured_brief_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            project.id,
            project.name,
            project.original_prompt,
            project.structured_brief_json,
            project.created_at,
            project.updated_at
        ],
    )?;
    Ok(project)
}

pub fn update_project(conn: &Connection, id: &str, patch: &ProjectPatch) -> AppResult<Project> {
    let mut project =
        get_project(conn, id)?.ok_or_else(|| AppError::NotFound("Project not found".into()))?;
    if let Some(name) = &patch.name {
        project.name = require_text(name, "Project name", 200)?;
    }
    if let Some(prompt) = &patch.original_prompt {
        if prompt.chars().count() > 20_000 {
            return Err(AppError::Invalid(
                "The brief is too long (max 20,000 characters)".into(),
            ));
        }
        project.original_prompt = prompt.clone();
    }
    if let Some(brief) = &patch.structured_brief_json {
        if let Some(json) = brief {
            // Only well-formed JSON is stored; schema validation happens in the frontend.
            serde_json::from_str::<serde_json::Value>(json)
                .map_err(|_| AppError::Invalid("Structured brief is not valid JSON".into()))?;
        }
        project.structured_brief_json = brief.clone();
    }
    project.updated_at = now();
    conn.execute(
        "UPDATE projects SET name = ?2, original_prompt = ?3, structured_brief_json = ?4, updated_at = ?5
         WHERE id = ?1",
        params![
            project.id,
            project.name,
            project.original_prompt,
            project.structured_brief_json,
            project.updated_at
        ],
    )?;
    Ok(project)
}

fn touch_project(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    Ok(())
}

/// Deletes a project and (via ON DELETE CASCADE) all its sessions, references,
/// board items and hidden results.
pub fn delete_project(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

// ---------------------------------------------------------- search sessions

pub fn insert_search_session(
    conn: &Connection,
    input: &NewSearchSession,
) -> AppResult<SearchSession> {
    let session = SearchSession {
        id: new_id(),
        project_id: input.project_id.clone(),
        query: require_text(&input.query, "Query", 500)?,
        provider: require_text(&input.provider, "Provider", 100)?,
        category: input.category.clone(),
        result_count: input.result_count,
        created_at: now(),
    };
    conn.execute(
        "INSERT INTO search_sessions (id, project_id, query, provider, category, result_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session.id,
            session.project_id,
            session.query,
            session.provider,
            session.category,
            session.result_count,
            session.created_at
        ],
    )?;
    Ok(session)
}

pub fn list_search_sessions(conn: &Connection, project_id: &str) -> AppResult<Vec<SearchSession>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM search_sessions WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 500",
    )?;
    let rows = stmt.query_map([project_id], |row| {
        Ok(SearchSession {
            id: row.get("id")?,
            project_id: row.get("project_id")?,
            query: row.get("query")?,
            provider: row.get("provider")?,
            category: row.get("category")?,
            result_count: row.get("result_count")?,
            created_at: row.get("created_at")?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// --------------------------------------------------------------- references

fn reference_from_row(row: &Row) -> rusqlite::Result<SavedReference> {
    Ok(SavedReference {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        provider: row.get("provider")?,
        provider_result_id: row.get("provider_result_id")?,
        title: row.get("title")?,
        thumbnail_url: row.get("thumbnail_url")?,
        source_url: row.get("source_url")?,
        creator_name: row.get("creator_name")?,
        width: row.get("width")?,
        height: row.get("height")?,
        license_label: row.get("license_label")?,
        category: row.get("category")?,
        is_demo: row.get::<_, i64>("is_demo")? != 0,
        user_notes: row.get("user_notes")?,
        analysis_json: row.get("analysis_json")?,
        created_at: row.get("created_at")?,
    })
}

pub fn get_reference(conn: &Connection, id: &str) -> AppResult<Option<SavedReference>> {
    Ok(conn
        .query_row(
            "SELECT * FROM saved_references WHERE id = ?1",
            [id],
            reference_from_row,
        )
        .optional()?)
}

/// Saves a search result as a reference. Saving the same provider result twice in a
/// project returns the existing row (notes and analysis are preserved).
pub fn save_reference(conn: &Connection, input: &NewReference) -> AppResult<SavedReference> {
    crate::url_check::require_http_url(&input.source_url)?;
    if let Some(thumb) = &input.thumbnail_url {
        crate::url_check::require_image_src(thumb)?;
    }
    let existing = conn
        .query_row(
            "SELECT * FROM saved_references WHERE project_id = ?1 AND provider = ?2 AND provider_result_id = ?3",
            params![input.project_id, input.provider, input.provider_result_id],
            reference_from_row,
        )
        .optional()?;
    if let Some(existing) = existing {
        return Ok(existing);
    }
    let reference = SavedReference {
        id: new_id(),
        project_id: input.project_id.clone(),
        provider: require_text(&input.provider, "Provider", 100)?,
        provider_result_id: require_text(&input.provider_result_id, "Result id", 500)?,
        title: input.title.trim().chars().take(500).collect(),
        thumbnail_url: input.thumbnail_url.clone(),
        source_url: input.source_url.clone(),
        creator_name: input.creator_name.clone(),
        width: input.width,
        height: input.height,
        license_label: input.license_label.clone(),
        category: input.category.clone(),
        is_demo: input.is_demo,
        user_notes: String::new(),
        analysis_json: None,
        created_at: now(),
    };
    conn.execute(
        "INSERT INTO saved_references (id, project_id, provider, provider_result_id, title, thumbnail_url,
            source_url, creator_name, width, height, license_label, category, is_demo, user_notes,
            analysis_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            reference.id,
            reference.project_id,
            reference.provider,
            reference.provider_result_id,
            reference.title,
            reference.thumbnail_url,
            reference.source_url,
            reference.creator_name,
            reference.width,
            reference.height,
            reference.license_label,
            reference.category,
            reference.is_demo as i64,
            reference.user_notes,
            reference.analysis_json,
            reference.created_at
        ],
    )?;
    touch_project(conn, &reference.project_id)?;
    Ok(reference)
}

pub fn list_references(conn: &Connection, project_id: &str) -> AppResult<Vec<SavedReference>> {
    let mut stmt =
        conn.prepare("SELECT * FROM saved_references WHERE project_id = ?1 ORDER BY created_at")?;
    let rows = stmt.query_map([project_id], reference_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn update_reference_notes(
    conn: &Connection,
    id: &str,
    notes: &str,
) -> AppResult<SavedReference> {
    if notes.chars().count() > 10_000 {
        return Err(AppError::Invalid(
            "Notes are too long (max 10,000 characters)".into(),
        ));
    }
    let changed = conn.execute(
        "UPDATE saved_references SET user_notes = ?2 WHERE id = ?1",
        params![id, notes],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Reference not found".into()));
    }
    let reference =
        get_reference(conn, id)?.ok_or_else(|| AppError::NotFound("Reference not found".into()))?;
    touch_project(conn, &reference.project_id)?;
    Ok(reference)
}

pub fn set_reference_analysis(
    conn: &Connection,
    id: &str,
    analysis_json: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE saved_references SET analysis_json = ?2 WHERE id = ?1",
        params![id, analysis_json],
    )?;
    Ok(())
}

/// Deletes a saved reference and (via cascade) its board item.
pub fn delete_reference(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM saved_references WHERE id = ?1", [id])?;
    Ok(())
}

// -------------------------------------------------------------- board items

fn board_item_from_row(row: &Row) -> rusqlite::Result<BoardItem> {
    Ok(BoardItem {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        reference_id: row.get("reference_id")?,
        group_name: row.get("group_name")?,
        position_x: row.get("position_x")?,
        position_y: row.get("position_y")?,
        width: row.get("width")?,
        height: row.get("height")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const MAX_COORD: f64 = 100_000.0;

fn check_geometry(x: f64, y: f64, w: f64, h: f64) -> AppResult<()> {
    let finite = [x, y, w, h].iter().all(|v| v.is_finite());
    if !finite || x.abs() > MAX_COORD || y.abs() > MAX_COORD {
        return Err(AppError::Invalid("Board position is out of range".into()));
    }
    if !(40.0..=4000.0).contains(&w) || !(40.0..=4000.0).contains(&h) {
        return Err(AppError::Invalid("Card size is out of range".into()));
    }
    Ok(())
}

pub fn get_board_item(conn: &Connection, id: &str) -> AppResult<Option<BoardItem>> {
    Ok(conn
        .query_row(
            "SELECT * FROM board_items WHERE id = ?1",
            [id],
            board_item_from_row,
        )
        .optional()?)
}

/// Adds a reference to the board. A reference appears at most once per board; adding
/// it again returns the existing item.
pub fn add_board_item(conn: &Connection, input: &NewBoardItem) -> AppResult<BoardItem> {
    check_geometry(
        input.position_x,
        input.position_y,
        input.width,
        input.height,
    )?;
    let reference = get_reference(conn, &input.reference_id)?
        .ok_or_else(|| AppError::NotFound("Reference not found".into()))?;
    if reference.project_id != input.project_id {
        return Err(AppError::Invalid(
            "Reference belongs to a different project".into(),
        ));
    }
    if let Some(existing) = conn
        .query_row(
            "SELECT * FROM board_items WHERE project_id = ?1 AND reference_id = ?2",
            params![input.project_id, input.reference_id],
            board_item_from_row,
        )
        .optional()?
    {
        return Ok(existing);
    }
    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM board_items WHERE project_id = ?1",
        [&input.project_id],
        |r| r.get(0),
    )?;
    let ts = now();
    let item = BoardItem {
        id: new_id(),
        project_id: input.project_id.clone(),
        reference_id: input.reference_id.clone(),
        group_name: input.group_name.trim().chars().take(100).collect(),
        position_x: input.position_x,
        position_y: input.position_y,
        width: input.width,
        height: input.height,
        sort_order: next_order,
        created_at: ts.clone(),
        updated_at: ts,
    };
    conn.execute(
        "INSERT INTO board_items (id, project_id, reference_id, group_name, position_x, position_y, width,
            height, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            item.id,
            item.project_id,
            item.reference_id,
            item.group_name,
            item.position_x,
            item.position_y,
            item.width,
            item.height,
            item.sort_order,
            item.created_at,
            item.updated_at
        ],
    )?;
    touch_project(conn, &item.project_id)?;
    Ok(item)
}

pub fn update_board_item(
    conn: &Connection,
    id: &str,
    patch: &BoardItemPatch,
) -> AppResult<BoardItem> {
    let mut item = get_board_item(conn, id)?
        .ok_or_else(|| AppError::NotFound("Board item not found".into()))?;
    if let Some(g) = &patch.group_name {
        item.group_name = g.trim().chars().take(100).collect();
    }
    if let Some(x) = patch.position_x {
        item.position_x = x;
    }
    if let Some(y) = patch.position_y {
        item.position_y = y;
    }
    if let Some(w) = patch.width {
        item.width = w;
    }
    if let Some(h) = patch.height {
        item.height = h;
    }
    if let Some(o) = patch.sort_order {
        item.sort_order = o;
    }
    check_geometry(item.position_x, item.position_y, item.width, item.height)?;
    item.updated_at = now();
    conn.execute(
        "UPDATE board_items SET group_name = ?2, position_x = ?3, position_y = ?4, width = ?5, height = ?6,
            sort_order = ?7, updated_at = ?8 WHERE id = ?1",
        params![
            item.id,
            item.group_name,
            item.position_x,
            item.position_y,
            item.width,
            item.height,
            item.sort_order,
            item.updated_at
        ],
    )?;
    touch_project(conn, &item.project_id)?;
    Ok(item)
}

pub fn remove_board_item(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM board_items WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_board_items(conn: &Connection, project_id: &str) -> AppResult<Vec<BoardItem>> {
    let mut stmt =
        conn.prepare("SELECT * FROM board_items WHERE project_id = ?1 ORDER BY sort_order")?;
    let rows = stmt.query_map([project_id], board_item_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// ----------------------------------------------------------- hidden results

pub fn hide_result(conn: &Connection, project_id: &str, result_key: &str) -> AppResult<()> {
    let key = require_text(result_key, "Result key", 2000)?;
    conn.execute(
        "INSERT OR IGNORE INTO hidden_results (project_id, result_key, created_at) VALUES (?1, ?2, ?3)",
        params![project_id, key, now()],
    )?;
    Ok(())
}

pub fn list_hidden_results(conn: &Connection, project_id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT result_key FROM hidden_results WHERE project_id = ?1")?;
    let rows = stmt.query_map([project_id], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn unhide_all(conn: &Connection, project_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM hidden_results WHERE project_id = ?1",
        [project_id],
    )?;
    Ok(())
}

// --------------------------------------------------------------------- usage

pub fn insert_usage(conn: &Connection, record: &UsageRecord) -> AppResult<()> {
    conn.execute(
        "INSERT INTO usage_log (id, created_at, provider, model, feature, image_count, input_tokens,
            output_tokens, estimated_cost_usd, status, error_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            record.id,
            record.created_at,
            record.provider,
            record.model,
            record.feature,
            record.image_count,
            record.input_tokens,
            record.output_tokens,
            record.estimated_cost_usd,
            record.status,
            record.error_code
        ],
    )?;
    Ok(())
}

pub fn new_usage_id() -> String {
    new_id()
}

pub fn list_usage(conn: &Connection, limit: i64) -> AppResult<Vec<UsageRecord>> {
    let mut stmt = conn.prepare("SELECT * FROM usage_log ORDER BY created_at DESC LIMIT ?1")?;
    let rows = stmt.query_map([limit], |row| {
        Ok(UsageRecord {
            id: row.get("id")?,
            created_at: row.get("created_at")?,
            provider: row.get("provider")?,
            model: row.get("model")?,
            feature: row.get("feature")?,
            image_count: row.get("image_count")?,
            input_tokens: row.get("input_tokens")?,
            output_tokens: row.get("output_tokens")?,
            estimated_cost_usd: row.get("estimated_cost_usd")?,
            status: row.get("status")?,
            error_code: row.get("error_code")?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Usage totals for a "YYYY-MM" month (timestamps are stored in UTC).
pub fn month_usage(conn: &Connection, month: &str) -> AppResult<MonthUsage> {
    let pattern = format!("{month}-%");
    let (requests, cost, without_cost) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(estimated_cost_usd), 0.0),
                COALESCE(SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END), 0)
         FROM usage_log WHERE created_at LIKE ?1",
        [pattern],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        },
    )?;
    Ok(MonthUsage {
        month: month.to_string(),
        requests,
        estimated_cost_usd: cost,
        requests_without_cost: without_cost,
    })
}

pub fn clear_usage(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM usage_log", [])?;
    Ok(())
}

// ------------------------------------------------------------ analysis cache

pub fn get_cached_analyses(conn: &Connection, keys: &[String]) -> AppResult<Vec<CachedAnalysis>> {
    let mut stmt = conn.prepare("SELECT * FROM analysis_cache WHERE cache_key = ?1")?;
    let mut out = Vec::new();
    for key in keys {
        if let Some(found) = stmt
            .query_row([key], |row| {
                Ok(CachedAnalysis {
                    cache_key: row.get("cache_key")?,
                    provider: row.get("provider")?,
                    model: row.get("model")?,
                    source_id: row.get("source_id")?,
                    analysis_version: row.get("analysis_version")?,
                    analysis_json: row.get("analysis_json")?,
                    created_at: row.get("created_at")?,
                })
            })
            .optional()?
        {
            out.push(found);
        }
    }
    Ok(out)
}

pub fn put_cached_analysis(conn: &Connection, entry: &CachedAnalysis) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(&entry.analysis_json)
        .map_err(|_| AppError::Invalid("Analysis is not valid JSON".into()))?;
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (cache_key, provider, model, source_id, analysis_version,
            analysis_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entry.cache_key,
            entry.provider,
            entry.model,
            entry.source_id,
            entry.analysis_version,
            entry.analysis_json,
            entry.created_at
        ],
    )?;
    Ok(())
}
