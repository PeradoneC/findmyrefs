//! Paid AI orchestration: guardrails -> request -> usage log -> validated result.
//!
//! The database lock is never held across an `.await`.

use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;

use crate::db::repo;
use crate::error::{AppError, AppResult};
use crate::guard::{self, GuardInput, PaidAiStatus};
use crate::models::{CachedAnalysis, MonthUsage, UsageRecord};
use crate::pricing;
use crate::providers::anthropic::{
    self, ANALYSIS_VERSION, AnthropicTransport, ImageAnalysisItem, MessageResult, ProviderError,
};
use crate::secrets::{ApiKey, SecretKind, SecretStore};
use crate::settings::{self, AppSettings};
use crate::url_check;

pub const PROVIDER_ID: &str = "anthropic";
const MAX_PROMPT_CHARS: usize = 8_000;

pub struct AiContext<'a, T: AnthropicTransport> {
    pub db: &'a Mutex<Connection>,
    pub secrets: &'a dyn SecretStore,
    pub transport: &'a T,
}

fn lock(db: &Mutex<Connection>) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
    db.lock()
        .map_err(|_| AppError::Internal("database lock poisoned".into()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub ai_provider: settings::AiProvider,
    pub model: String,
    pub has_api_key: bool,
    pub secure_storage: &'static str,
    pub paid: PaidAiStatus,
    pub month: MonthUsage,
    pub prices_as_of: &'static str,
}

pub fn status(db: &Mutex<Connection>, secrets: &dyn SecretStore) -> AppResult<AiStatus> {
    let has_api_key = secrets.get(SecretKind::AnthropicApiKey)?.is_some();
    let conn = lock(db)?;
    let settings = settings::load(&conn)?;
    let month = repo::month_usage(&conn, &repo::current_month())?;
    Ok(AiStatus {
        ai_provider: settings.ai_provider,
        model: settings.anthropic_model.clone(),
        has_api_key,
        secure_storage: secrets.description(),
        paid: guard::status(&settings, has_api_key, &month),
        month,
        prices_as_of: pricing::PRICES_AS_OF,
    })
}

struct Prepared {
    settings: AppSettings,
    key: ApiKey,
}

/// Loads settings/usage/key and runs the guard. Returns the key only when allowed.
fn prepare(
    db: &Mutex<Connection>,
    secrets: &dyn SecretStore,
    confirmed: bool,
    image_count: usize,
    planned_requests: u32,
) -> AppResult<Prepared> {
    let key = secrets.get(SecretKind::AnthropicApiKey)?;
    let conn = lock(db)?;
    let settings = settings::load(&conn)?;
    let month = repo::month_usage(&conn, &repo::current_month())?;
    guard::check(&GuardInput {
        settings: &settings,
        has_api_key: key.is_some(),
        user_confirmed: confirmed,
        image_count,
        planned_requests,
        month: &month,
    })?;
    let key = key.ok_or(AppError::Guard(guard::GuardError::MissingApiKey))?;
    Ok(Prepared { settings, key })
}

fn usage_record(
    model: &str,
    feature: &str,
    image_count: i64,
    result: &Result<MessageResult, ProviderError>,
) -> UsageRecord {
    let (input_tokens, output_tokens, cost, status, error_code, billed_model) = match result {
        Ok(m) => {
            let billed_model = if m.model.is_empty() {
                model.to_string()
            } else {
                m.model.clone()
            };
            let cost = if m.used_fallback {
                None
            } else {
                pricing::estimate_cost_usd(&billed_model, m.input_tokens, m.output_tokens)
            };
            (
                m.input_tokens,
                m.output_tokens,
                cost,
                "ok",
                None,
                billed_model,
            )
        }
        Err(e) => (
            None,
            None,
            None,
            "error",
            Some(e.code().to_string()),
            model.to_string(),
        ),
    };
    UsageRecord {
        id: repo::new_usage_id(),
        created_at: repo::now(),
        provider: PROVIDER_ID.into(),
        model: billed_model,
        feature: feature.into(),
        image_count,
        input_tokens,
        output_tokens,
        estimated_cost_usd: cost,
        status: status.into(),
        error_code,
    }
}

async fn send_and_record<T: AnthropicTransport>(
    ctx: &AiContext<'_, T>,
    prepared: &Prepared,
    request: &anthropic::AnthropicRequest,
    feature: &str,
    image_count: i64,
) -> AppResult<(MessageResult, UsageRecord)> {
    let result = match ctx.transport.send(&prepared.key, request).await {
        Ok(raw) => anthropic::interpret_response(&raw),
        Err(e) => Err(e),
    };
    // Every attempted request is logged (failed requests may still be billed).
    let record = usage_record(
        &prepared.settings.anthropic_model,
        feature,
        image_count,
        &result,
    );
    repo::insert_usage(&*lock(ctx.db)?, &record)?;
    Ok((result?, record))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefAnalysisOutput {
    /// Sanitized ArtBrief JSON; the frontend validates it again.
    pub brief_json: String,
    pub usage: UsageRecord,
}

pub async fn analyze_brief<T: AnthropicTransport>(
    ctx: &AiContext<'_, T>,
    prompt: &str,
    confirmed: bool,
) -> AppResult<BriefAnalysisOutput> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("Enter a brief first".into()));
    }
    if trimmed.chars().count() > MAX_PROMPT_CHARS {
        return Err(AppError::Invalid(format!(
            "The brief is too long for analysis (max {MAX_PROMPT_CHARS} characters)"
        )));
    }
    let prepared = prepare(ctx.db, ctx.secrets, confirmed, 0, 1)?;
    let request = anthropic::build_brief_request(&prepared.settings.anthropic_model, trimmed);
    let (message, usage) = send_and_record(ctx, &prepared, &request, "brief_analysis", 0).await?;
    let brief = anthropic::parse_brief(&message.text, prompt)?;
    let brief_json =
        serde_json::to_string(&brief).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(BriefAnalysisOutput { brief_json, usage })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysisResult {
    pub source_id: String,
    pub cache_key: String,
    /// "ok" | "error" | "skipped"
    pub status: String,
    pub from_cache: bool,
    pub analysis_json: Option<String>,
    pub error: Option<AppError>,
}

/// Analyzes the user's selected images (one request per uncached image).
pub async fn analyze_images<T: AnthropicTransport>(
    ctx: &AiContext<'_, T>,
    items: Vec<ImageAnalysisItem>,
    confirmed: bool,
    force_refresh: bool,
) -> AppResult<Vec<ImageAnalysisResult>> {
    if items.is_empty() {
        return Err(AppError::Invalid(
            "Select at least one image to analyze".into(),
        ));
    }
    for item in &items {
        if item.source_id.trim().is_empty() {
            return Err(AppError::Invalid(
                "Image is missing a source identifier".into(),
            ));
        }
        url_check::require_https_url(&item.image_url)?;
    }

    // Batch limit applies to the whole selection, before any cache lookup or request.
    let (model, cached) = {
        let conn = lock(ctx.db)?;
        let s = settings::load(&conn)?;
        if items.len() > s.max_images_per_batch as usize {
            return Err(guard::GuardError::BatchTooLarge {
                requested: items.len(),
                max: s.max_images_per_batch,
            }
            .into());
        }
        let keys: Vec<String> = items
            .iter()
            .map(|i| {
                anthropic::analysis_cache_key(
                    PROVIDER_ID,
                    &s.anthropic_model,
                    &i.source_id,
                    ANALYSIS_VERSION,
                )
            })
            .collect();
        let cached = if force_refresh {
            Vec::new()
        } else {
            repo::get_cached_analyses(&conn, &keys)?
        };
        (s.anthropic_model, cached)
    };
    let key_for = |item: &ImageAnalysisItem| {
        anthropic::analysis_cache_key(PROVIDER_ID, &model, &item.source_id, ANALYSIS_VERSION)
    };
    let uncached = items
        .iter()
        .filter(|i| !cached.iter().any(|c| c.cache_key == key_for(i)))
        .count();

    // Only run the paid-request guard when something will actually be sent.
    let prepared = if uncached > 0 {
        Some(prepare(
            ctx.db,
            ctx.secrets,
            confirmed,
            items.len(),
            uncached as u32,
        )?)
    } else {
        None
    };

    let mut results = Vec::with_capacity(items.len());
    let mut stop: Option<AppError> = None;
    for item in &items {
        let cache_key = key_for(item);
        if let Some(hit) = cached.iter().find(|c| c.cache_key == cache_key) {
            results.push(ImageAnalysisResult {
                source_id: item.source_id.clone(),
                cache_key,
                status: "ok".into(),
                from_cache: true,
                analysis_json: Some(hit.analysis_json.clone()),
                error: None,
            });
            continue;
        }
        let prepared = prepared
            .as_ref()
            .expect("prepared when uncached items exist");
        if let Some(reason) = &stop {
            results.push(ImageAnalysisResult {
                source_id: item.source_id.clone(),
                cache_key,
                status: "skipped".into(),
                from_cache: false,
                analysis_json: None,
                error: Some(AppError::Invalid(format!(
                    "Skipped after an earlier error: {reason}"
                ))),
            });
            continue;
        }
        let request = anthropic::build_image_request(&prepared.settings.anthropic_model, item);
        let outcome = match send_and_record(ctx, prepared, &request, "image_analysis", 1).await {
            Ok((message, _)) => anthropic::parse_analysis(&message.text).map_err(AppError::from),
            Err(e) => Err(e),
        };
        match outcome {
            Ok(analysis) => {
                let json = serde_json::to_string(&analysis)
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                repo::put_cached_analysis(
                    &*lock(ctx.db)?,
                    &CachedAnalysis {
                        cache_key: cache_key.clone(),
                        provider: PROVIDER_ID.into(),
                        model: prepared.settings.anthropic_model.clone(),
                        source_id: item.source_id.clone(),
                        analysis_version: ANALYSIS_VERSION,
                        analysis_json: json.clone(),
                        created_at: repo::now(),
                    },
                )?;
                results.push(ImageAnalysisResult {
                    source_id: item.source_id.clone(),
                    cache_key,
                    status: "ok".into(),
                    from_cache: false,
                    analysis_json: Some(json),
                    error: None,
                });
            }
            Err(err) => {
                if matches!(&err, AppError::Provider(p) if p.stops_batch()) {
                    stop = Some(AppError::Invalid(err.to_string()));
                }
                results.push(ImageAnalysisResult {
                    source_id: item.source_id.clone(),
                    cache_key,
                    status: "error".into(),
                    from_cache: false,
                    analysis_json: None,
                    error: Some(err),
                });
            }
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::providers::anthropic::{AnthropicRequest, RawResponse};
    use crate::secrets::MemorySecretStore;
    use crate::settings::{AiProvider, SettingsPatch};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TEST_KEY: &str = "sk-ant-test-TOPSECRET";

    type Responder =
        Box<dyn Fn(&AnthropicRequest) -> Result<RawResponse, ProviderError> + Send + Sync>;

    /// Fake transport: counts calls and returns a canned response.
    struct FakeTransport {
        calls: AtomicUsize,
        response: Responder,
    }

    impl FakeTransport {
        fn returning(body: serde_json::Value) -> Self {
            let text = body.to_string();
            Self {
                calls: AtomicUsize::new(0),
                response: Box::new(move |_| {
                    Ok(RawResponse {
                        status: 200,
                        body: json!({
                            "model": "claude-opus-5-5",
                            "stop_reason": "end_turn",
                            "content": [{"type": "text", "text": text}],
                            "usage": {"input_tokens": 1000, "output_tokens": 500}
                        })
                        .to_string(),
                        retry_after_secs: None,
                    })
                }),
            }
        }
        fn failing(status: u16) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                response: Box::new(move |_| {
                    Ok(RawResponse {
                        status,
                        body: "{}".into(),
                        retry_after_secs: None,
                    })
                }),
            }
        }
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl AnthropicTransport for FakeTransport {
        async fn send(
            &self,
            key: &ApiKey,
            request: &AnthropicRequest,
        ) -> Result<RawResponse, ProviderError> {
            assert_eq!(key.expose(), TEST_KEY);
            self.calls.fetch_add(1, Ordering::SeqCst);
            (self.response)(request)
        }
    }

    fn brief_json() -> serde_json::Value {
        json!({
            "originalPrompt": "x", "subject": ["fox"], "environment": [], "palette": [], "lighting": [],
            "mood": [], "composition": [], "cameraAngle": [], "style": [], "materialsOrTextures": [],
            "exclusions": [],
            "referenceCategories": [{"id": "subject", "name": "Subject", "purpose": "p",
                                      "searchQueries": ["red fox"], "priority": "high"}]
        })
    }

    fn analysis_json() -> serde_json::Value {
        json!({"summary": "s", "detectedCategories": [], "palette": [], "lighting": "soft",
               "composition": "c", "mood": [], "relevanceExplanation": "r"})
    }

    fn setup(paid: bool) -> (Mutex<Connection>, MemorySecretStore) {
        let conn = db::open_in_memory().unwrap();
        if paid {
            settings::update(
                &conn,
                SettingsPatch {
                    ai_provider: Some(AiProvider::Anthropic),
                    paid_warning_acknowledged: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        let secrets = MemorySecretStore::default();
        secrets
            .set(SecretKind::AnthropicApiKey, ApiKey::new(TEST_KEY).unwrap())
            .unwrap();
        (Mutex::new(conn), secrets)
    }

    fn items(n: usize) -> Vec<ImageAnalysisItem> {
        (0..n)
            .map(|i| ImageAnalysisItem {
                source_id: format!("openverse:{i}"),
                image_url: format!("https://example.org/thumb/{i}.jpg"),
                title: String::new(),
                category_hint: String::new(),
                brief_summary: String::new(),
            })
            .collect()
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    fn usage_count(db: &Mutex<Connection>) -> usize {
        repo::list_usage(&db.lock().unwrap(), 100).unwrap().len()
    }

    #[test]
    fn mock_mode_never_calls_the_api() {
        let (db, secrets) = setup(false);
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let err = block_on(analyze_brief(&ctx, "a fox", true)).unwrap_err();
        assert_eq!(err.code(), "not_selected");
        assert_eq!(t.calls(), 0);
        assert_eq!(usage_count(&db), 0);
    }

    #[test]
    fn disabled_paid_ai_blocks_requests() {
        let (db, secrets) = setup(true);
        settings::update(
            &db.lock().unwrap(),
            SettingsPatch {
                paid_ai_disabled: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        assert_eq!(
            block_on(analyze_brief(&ctx, "a fox", true))
                .unwrap_err()
                .code(),
            "paid_ai_disabled"
        );
        assert_eq!(
            block_on(analyze_images(&ctx, items(1), true, false))
                .unwrap_err()
                .code(),
            "paid_ai_disabled"
        );
        assert_eq!(t.calls(), 0);
    }

    #[test]
    fn requires_explicit_confirmation() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        assert_eq!(
            block_on(analyze_brief(&ctx, "a fox", false))
                .unwrap_err()
                .code(),
            "not_confirmed"
        );
        assert_eq!(t.calls(), 0);
    }

    #[test]
    fn missing_key_blocks_requests() {
        let (db, secrets) = setup(true);
        secrets.clear(SecretKind::AnthropicApiKey).unwrap();
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        assert_eq!(
            block_on(analyze_brief(&ctx, "a fox", true))
                .unwrap_err()
                .code(),
            "missing_api_key"
        );
        assert_eq!(t.calls(), 0);
    }

    #[test]
    fn successful_brief_analysis_records_usage_and_cost_estimate() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let out = block_on(analyze_brief(&ctx, "a red fox", true)).unwrap();
        assert_eq!(t.calls(), 1);
        assert!(out.brief_json.contains("red fox"));
        assert_eq!(out.usage.input_tokens, Some(1000));
        // 1000 * 4 / 1e6 + 500 * 20 / 1e6
        assert!((out.usage.estimated_cost_usd.unwrap() - 0.014).abs() < 1e-9);
        let month = repo::month_usage(&db.lock().unwrap(), &repo::current_month()).unwrap();
        assert_eq!(month.requests, 1);
    }

    #[test]
    fn invalid_ai_response_is_handled_and_still_logged() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::returning(json!({"unexpected": true}));
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let err = block_on(analyze_brief(&ctx, "a fox", true)).unwrap_err();
        assert_eq!(err.code(), "invalid_response");
        assert_eq!(usage_count(&db), 1);
    }

    #[test]
    fn provider_errors_are_logged_without_secrets() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::failing(401);
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let err = block_on(analyze_brief(&ctx, "a fox", true)).unwrap_err();
        assert_eq!(err.code(), "invalid_api_key");
        let serialized = serde_json::to_string(&err).unwrap();
        assert!(!serialized.contains("TOPSECRET"));
        let log = repo::list_usage(&db.lock().unwrap(), 10).unwrap();
        assert_eq!(log[0].status, "error");
        assert_eq!(log[0].estimated_cost_usd, None);
        assert!(!serde_json::to_string(&log).unwrap().contains("TOPSECRET"));
    }

    #[test]
    fn monthly_request_limit_is_enforced() {
        let (db, secrets) = setup(true);
        settings::update(
            &db.lock().unwrap(),
            SettingsPatch {
                monthly_request_limit: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        block_on(analyze_brief(&ctx, "a", true)).unwrap();
        block_on(analyze_brief(&ctx, "b", true)).unwrap();
        assert_eq!(
            block_on(analyze_brief(&ctx, "c", true)).unwrap_err().code(),
            "request_limit"
        );
        assert_eq!(t.calls(), 2);
        // An explicit override for this month lifts the limit.
        settings::update(
            &db.lock().unwrap(),
            SettingsPatch {
                limit_override_month: Some(Some(repo::current_month())),
                ..Default::default()
            },
        )
        .unwrap();
        block_on(analyze_brief(&ctx, "c", true)).unwrap();
        assert_eq!(t.calls(), 3);
    }

    #[test]
    fn spending_target_is_enforced() {
        let (db, secrets) = setup(true);
        settings::update(
            &db.lock().unwrap(),
            SettingsPatch {
                monthly_spend_target_usd: Some(0.02),
                ..Default::default()
            },
        )
        .unwrap();
        let t = FakeTransport::returning(brief_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        block_on(analyze_brief(&ctx, "a", true)).unwrap(); // ~$0.014
        block_on(analyze_brief(&ctx, "b", true)).unwrap(); // ~$0.028 total
        assert_eq!(
            block_on(analyze_brief(&ctx, "c", true)).unwrap_err().code(),
            "spend_target"
        );
        assert_eq!(t.calls(), 2);
    }

    #[test]
    fn image_batch_limit_is_enforced() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::returning(analysis_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let err = block_on(analyze_images(&ctx, items(4), true, false)).unwrap_err();
        assert_eq!(err.code(), "batch_too_large");
        assert_eq!(t.calls(), 0);
        let ok = block_on(analyze_images(&ctx, items(3), true, false)).unwrap();
        assert_eq!(ok.len(), 3);
        assert_eq!(t.calls(), 3);
    }

    #[test]
    fn cached_analyses_prevent_duplicate_requests() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::returning(analysis_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let first = block_on(analyze_images(&ctx, items(2), true, false)).unwrap();
        assert!(first.iter().all(|r| r.status == "ok" && !r.from_cache));
        assert_eq!(t.calls(), 2);

        let second = block_on(analyze_images(&ctx, items(2), true, false)).unwrap();
        assert!(second.iter().all(|r| r.from_cache));
        assert_eq!(t.calls(), 2, "cached results must not trigger new requests");

        // Cached results are returned even without confirmation (nothing is sent).
        assert!(block_on(analyze_images(&ctx, items(2), false, false)).is_ok());

        // Manual re-run bypasses the cache.
        block_on(analyze_images(&ctx, items(1), true, true)).unwrap();
        assert_eq!(t.calls(), 3);
    }

    #[test]
    fn non_https_images_are_never_sent() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::returning(analysis_json());
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let mut list = items(1);
        list[0].image_url = "file:///C:/Users/me/private.png".into();
        assert!(block_on(analyze_images(&ctx, list, true, false)).is_err());
        assert_eq!(t.calls(), 0);
    }

    #[test]
    fn rate_limit_stops_the_rest_of_the_batch() {
        let (db, secrets) = setup(true);
        let t = FakeTransport::failing(429);
        let ctx = AiContext {
            db: &db,
            secrets: &secrets,
            transport: &t,
        };
        let results = block_on(analyze_images(&ctx, items(3), true, false)).unwrap();
        assert_eq!(t.calls(), 1);
        assert_eq!(results[0].status, "error");
        assert_eq!(results[1].status, "skipped");
        assert_eq!(results[2].status, "skipped");
    }

    #[test]
    fn status_reports_availability_without_exposing_key() {
        let (db, secrets) = setup(true);
        let st = status(&db, &secrets).unwrap();
        assert!(st.has_api_key);
        assert!(st.paid.available);
        assert!(!serde_json::to_string(&st).unwrap().contains("TOPSECRET"));
    }
}
