//! Non-secret application settings stored in the `settings` table.
//!
//! Defaults are zero-cost: mock AI, mock search, a conservative image batch limit.
//! API keys are NOT settings - see `secrets.rs`.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::pricing;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Mock,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub ai_provider: AiProvider,
    pub anthropic_model: String,
    /// Kill switch: when true no paid API request is sent, whatever else is configured.
    pub paid_ai_disabled: bool,
    /// Set once the user has read the "API usage is billed separately" warning.
    pub paid_warning_acknowledged: bool,
    pub max_images_per_batch: u32,
    pub monthly_request_limit: u32,
    pub monthly_spend_target_usd: f64,
    /// "YYYY-MM": the user explicitly chose to continue past the local limits this month.
    pub limit_override_month: Option<String>,
    /// "mock" | "openverse" | "pinterest"
    pub search_provider: String,
    pub safe_search: bool,
    pub queries_per_category: u32,
    /// Two-letter country code Pinterest requires for keyword search.
    pub pinterest_country: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ai_provider: AiProvider::Mock,
            anthropic_model: pricing::DEFAULT_MODEL.to_string(),
            paid_ai_disabled: false,
            paid_warning_acknowledged: false,
            max_images_per_batch: 3,
            monthly_request_limit: 50,
            monthly_spend_target_usd: 5.0,
            limit_override_month: None,
            search_provider: "mock".to_string(),
            safe_search: true,
            queries_per_category: 2,
            pinterest_country: "US".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub ai_provider: Option<AiProvider>,
    pub anthropic_model: Option<String>,
    pub paid_ai_disabled: Option<bool>,
    pub paid_warning_acknowledged: Option<bool>,
    pub max_images_per_batch: Option<u32>,
    pub monthly_request_limit: Option<u32>,
    pub monthly_spend_target_usd: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub limit_override_month: Option<Option<String>>,
    pub search_provider: Option<String>,
    pub safe_search: Option<bool>,
    pub queries_per_category: Option<u32>,
    pub pinterest_country: Option<String>,
}

fn deserialize_some<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

const KEY: &str = "app_settings";

pub fn load(conn: &Connection) -> AppResult<AppSettings> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [KEY],
            |r| r.get(0),
        )
        .ok();
    match raw {
        // Unknown or malformed values fall back to defaults field by field (serde default).
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(AppSettings::default()),
    }
}

pub fn validate(s: &AppSettings) -> AppResult<()> {
    if !pricing::is_selectable_model(&s.anthropic_model) {
        return Err(AppError::Invalid(format!(
            "Unsupported model: {}",
            s.anthropic_model
        )));
    }
    if !(1..=20).contains(&s.max_images_per_batch) {
        return Err(AppError::Invalid(
            "Images per batch must be between 1 and 20".into(),
        ));
    }
    if s.monthly_request_limit > 100_000 {
        return Err(AppError::Invalid(
            "Monthly request limit is too large".into(),
        ));
    }
    if !s.monthly_spend_target_usd.is_finite()
        || !(0.0..=100_000.0).contains(&s.monthly_spend_target_usd)
    {
        return Err(AppError::Invalid(
            "Monthly spending target must be between 0 and 100,000".into(),
        ));
    }
    if !["mock", "openverse", "pinterest"].contains(&s.search_provider.as_str()) {
        return Err(AppError::Invalid("Unknown search provider".into()));
    }
    if !(1..=8).contains(&s.queries_per_category) {
        return Err(AppError::Invalid(
            "Queries per category must be between 1 and 8".into(),
        ));
    }
    if !crate::providers::pinterest::is_country_code(&s.pinterest_country) {
        return Err(AppError::Invalid(
            "Pinterest country must be a two-letter code such as US or TH".into(),
        ));
    }
    Ok(())
}

pub fn apply_patch(mut s: AppSettings, p: SettingsPatch) -> AppSettings {
    if let Some(v) = p.ai_provider {
        s.ai_provider = v;
    }
    if let Some(v) = p.anthropic_model {
        s.anthropic_model = v;
    }
    if let Some(v) = p.paid_ai_disabled {
        s.paid_ai_disabled = v;
    }
    if let Some(v) = p.paid_warning_acknowledged {
        s.paid_warning_acknowledged = v;
    }
    if let Some(v) = p.max_images_per_batch {
        s.max_images_per_batch = v;
    }
    if let Some(v) = p.monthly_request_limit {
        s.monthly_request_limit = v;
    }
    if let Some(v) = p.monthly_spend_target_usd {
        s.monthly_spend_target_usd = v;
    }
    if let Some(v) = p.limit_override_month {
        s.limit_override_month = v;
    }
    if let Some(v) = p.search_provider {
        s.search_provider = v;
    }
    if let Some(v) = p.safe_search {
        s.safe_search = v;
    }
    if let Some(v) = p.queries_per_category {
        s.queries_per_category = v;
    }
    if let Some(v) = p.pinterest_country {
        s.pinterest_country = v.trim().to_uppercase();
    }
    s
}

pub fn update(conn: &Connection, patch: SettingsPatch) -> AppResult<AppSettings> {
    let next = apply_patch(load(conn)?, patch);
    validate(&next)?;
    let json = serde_json::to_string(&next).map_err(|e| AppError::Internal(e.to_string()))?;
    conn.execute(
        "INSERT INTO settings (key, value_json) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params![KEY, json],
    )?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn defaults_are_zero_cost() {
        let s = AppSettings::default();
        assert_eq!(s.ai_provider, AiProvider::Mock);
        assert_eq!(s.search_provider, "mock");
        assert_eq!(s.max_images_per_batch, 3);
        assert!(!s.paid_warning_acknowledged);
    }

    #[test]
    fn update_persists_and_validates() {
        let conn = db::open_in_memory().unwrap();
        let s = update(
            &conn,
            SettingsPatch {
                max_images_per_batch: Some(5),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(s.max_images_per_batch, 5);
        assert_eq!(load(&conn).unwrap().max_images_per_batch, 5);

        let err = update(
            &conn,
            SettingsPatch {
                max_images_per_batch: Some(0),
                ..Default::default()
            },
        );
        assert!(err.is_err());
        let err = update(
            &conn,
            SettingsPatch {
                anthropic_model: Some("gpt-9".into()),
                ..Default::default()
            },
        );
        assert!(err.is_err());
        // Failed updates do not change stored settings.
        assert_eq!(load(&conn).unwrap().max_images_per_batch, 5);
    }

    #[test]
    fn override_month_can_be_cleared() {
        let conn = db::open_in_memory().unwrap();
        update(
            &conn,
            SettingsPatch {
                limit_override_month: Some(Some("2026-10".into())),
                ..Default::default()
            },
        )
        .unwrap();
        let patch: SettingsPatch = serde_json::from_str(r#"{"limitOverrideMonth": null}"#).unwrap();
        let s = update(&conn, patch).unwrap();
        assert_eq!(s.limit_override_month, None);
    }
}
