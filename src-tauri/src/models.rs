//! Data transfer types shared between the database layer and Tauri commands.
//! All types serialize with camelCase field names to match the TypeScript types in
//! `src/lib/types.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub original_prompt: String,
    /// Raw JSON. The frontend validates it against the ArtBrief schema before use.
    pub structured_brief_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub original_prompt: Option<String>,
    /// `Some(None)` clears the brief; `None` leaves it unchanged.
    #[serde(default, with = "double_option")]
    pub structured_brief_json: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSession {
    pub id: String,
    pub project_id: String,
    pub query: String,
    pub provider: String,
    pub category: Option<String>,
    pub result_count: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSearchSession {
    pub project_id: String,
    pub query: String,
    pub provider: String,
    pub category: Option<String>,
    pub result_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedReference {
    pub id: String,
    pub project_id: String,
    pub provider: String,
    pub provider_result_id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub source_url: String,
    pub creator_name: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub license_label: Option<String>,
    pub category: Option<String>,
    pub is_demo: bool,
    pub user_notes: String,
    pub analysis_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReference {
    pub project_id: String,
    pub provider: String,
    pub provider_result_id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub source_url: String,
    pub creator_name: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub license_label: Option<String>,
    pub category: Option<String>,
    pub is_demo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardItem {
    pub id: String,
    pub project_id: String,
    pub reference_id: String,
    pub group_name: String,
    pub position_x: f64,
    pub position_y: f64,
    pub width: f64,
    pub height: f64,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBoardItem {
    pub project_id: String,
    pub reference_id: String,
    pub group_name: String,
    pub position_x: f64,
    pub position_y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardItemPatch {
    pub group_name: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub id: String,
    pub created_at: String,
    pub provider: String,
    pub model: String,
    /// "brief_analysis" | "image_analysis"
    pub feature: String,
    pub image_count: i64,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    /// Estimate only; `None` means "Cost unavailable".
    pub estimated_cost_usd: Option<f64>,
    /// "ok" | "error"
    pub status: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonthUsage {
    /// "YYYY-MM" (UTC)
    pub month: String,
    pub requests: i64,
    /// Sum of the known estimates for the month.
    pub estimated_cost_usd: f64,
    /// Requests whose cost could not be estimated (not included in the sum above).
    pub requests_without_cost: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedAnalysis {
    pub cache_key: String,
    pub provider: String,
    pub model: String,
    pub source_id: String,
    pub analysis_version: i64,
    pub analysis_json: String,
    pub created_at: String,
}

/// Serde helper that distinguishes a missing field from an explicit `null`.
mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}
