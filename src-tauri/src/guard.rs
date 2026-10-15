//! Spending guardrails for paid AI requests.
//!
//! Every request to a paid provider passes through [`check`] *before* any network
//! activity. These are local app limits: they stop this app from sending more
//! requests, but they are not a provider-side billing cap. The provider's billing
//! console remains authoritative.

use serde::Serialize;

use crate::models::MonthUsage;
use crate::settings::{AiProvider, AppSettings};

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum GuardError {
    #[error("Paid AI is not selected. The free Mock provider is active.")]
    NotSelected,
    #[error("Paid AI is disabled in Settings (\"Disable paid AI\" is on).")]
    Disabled,
    #[error("Paid AI requests need an explicit confirmation from you.")]
    NotConfirmed,
    #[error("Please read and accept the API billing notice before the first paid request.")]
    WarningNotAcknowledged,
    #[error("No Anthropic API key is configured. Add one in Settings.")]
    MissingApiKey,
    #[error("Too many images selected: {requested} (your batch limit is {max}).")]
    BatchTooLarge { requested: usize, max: u32 },
    #[error(
        "Monthly request limit reached ({used} of {limit}). Raise the limit or override it for this month in Settings."
    )]
    RequestLimit { used: i64, limit: u32 },
    #[error(
        "Local monthly spending target reached (estimated ${spent:.2} of ${target:.2}). Raise the target or override it for this month in Settings."
    )]
    SpendTarget { spent: f64, target: f64 },
}

impl GuardError {
    pub fn code(&self) -> &'static str {
        match self {
            GuardError::NotSelected => "not_selected",
            GuardError::Disabled => "paid_ai_disabled",
            GuardError::NotConfirmed => "not_confirmed",
            GuardError::WarningNotAcknowledged => "warning_not_acknowledged",
            GuardError::MissingApiKey => "missing_api_key",
            GuardError::BatchTooLarge { .. } => "batch_too_large",
            GuardError::RequestLimit { .. } => "request_limit",
            GuardError::SpendTarget { .. } => "spend_target",
        }
    }
}

pub struct GuardInput<'a> {
    pub settings: &'a AppSettings,
    pub has_api_key: bool,
    pub user_confirmed: bool,
    /// Number of images in the user's selection (0 for brief analysis).
    pub image_count: usize,
    /// Number of paid requests this action will send.
    pub planned_requests: u32,
    pub month: &'a MonthUsage,
}

/// Checks that apply regardless of user confirmation; used for status display.
fn check_configuration(input: &GuardInput) -> Result<(), GuardError> {
    let s = input.settings;
    if s.ai_provider != AiProvider::Anthropic {
        return Err(GuardError::NotSelected);
    }
    if s.paid_ai_disabled {
        return Err(GuardError::Disabled);
    }
    if !input.has_api_key {
        return Err(GuardError::MissingApiKey);
    }
    Ok(())
}

fn check_limits(input: &GuardInput) -> Result<(), GuardError> {
    let s = input.settings;
    if input.image_count > s.max_images_per_batch as usize {
        return Err(GuardError::BatchTooLarge {
            requested: input.image_count,
            max: s.max_images_per_batch,
        });
    }
    let overridden = s.limit_override_month.as_deref() == Some(input.month.month.as_str());
    if !overridden {
        if input.month.requests + i64::from(input.planned_requests)
            > i64::from(s.monthly_request_limit)
        {
            return Err(GuardError::RequestLimit {
                used: input.month.requests,
                limit: s.monthly_request_limit,
            });
        }
        if input.month.estimated_cost_usd >= s.monthly_spend_target_usd {
            return Err(GuardError::SpendTarget {
                spent: input.month.estimated_cost_usd,
                target: s.monthly_spend_target_usd,
            });
        }
    }
    Ok(())
}

/// Full check before sending a paid request.
pub fn check(input: &GuardInput) -> Result<(), GuardError> {
    check_configuration(input)?;
    if !input.user_confirmed {
        return Err(GuardError::NotConfirmed);
    }
    if !input.settings.paid_warning_acknowledged {
        return Err(GuardError::WarningNotAcknowledged);
    }
    check_limits(input)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaidAiStatus {
    /// True when a confirmed single request would be allowed right now.
    pub available: bool,
    pub blocked_code: Option<String>,
    pub blocked_reason: Option<String>,
    pub needs_warning_acknowledgement: bool,
}

/// Status for the UI: can the user make a paid request right now (with confirmation)?
pub fn status(settings: &AppSettings, has_api_key: bool, month: &MonthUsage) -> PaidAiStatus {
    let input = GuardInput {
        settings,
        has_api_key,
        user_confirmed: true,
        image_count: 0,
        planned_requests: 1,
        month,
    };
    let result = check_configuration(&input).and_then(|_| check_limits(&input));
    PaidAiStatus {
        available: result.is_ok(),
        blocked_code: result.as_ref().err().map(|e| e.code().to_string()),
        blocked_reason: result.err().map(|e| e.to_string()),
        needs_warning_acknowledgement: !settings.paid_warning_acknowledged,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paid_settings() -> AppSettings {
        AppSettings {
            ai_provider: AiProvider::Anthropic,
            paid_warning_acknowledged: true,
            ..AppSettings::default()
        }
    }

    fn month(requests: i64, cost: f64) -> MonthUsage {
        MonthUsage {
            month: "2026-10".into(),
            requests,
            estimated_cost_usd: cost,
            requests_without_cost: 0,
        }
    }

    fn input<'a>(s: &'a AppSettings, m: &'a MonthUsage) -> GuardInput<'a> {
        GuardInput {
            settings: s,
            has_api_key: true,
            user_confirmed: true,
            image_count: 0,
            planned_requests: 1,
            month: m,
        }
    }

    #[test]
    fn allows_fully_configured_confirmed_request() {
        let s = paid_settings();
        let m = month(0, 0.0);
        assert_eq!(check(&input(&s, &m)), Ok(()));
    }

    #[test]
    fn mock_provider_never_allows_paid_requests() {
        let s = AppSettings {
            ai_provider: AiProvider::Mock,
            ..paid_settings()
        };
        let m = month(0, 0.0);
        assert_eq!(check(&input(&s, &m)), Err(GuardError::NotSelected));
    }

    #[test]
    fn disabled_blocks_even_when_confirmed() {
        let s = AppSettings {
            paid_ai_disabled: true,
            ..paid_settings()
        };
        let m = month(0, 0.0);
        assert_eq!(check(&input(&s, &m)), Err(GuardError::Disabled));
    }

    #[test]
    fn requires_explicit_confirmation() {
        let s = paid_settings();
        let m = month(0, 0.0);
        let i = GuardInput {
            user_confirmed: false,
            ..input(&s, &m)
        };
        assert_eq!(check(&i), Err(GuardError::NotConfirmed));
    }

    #[test]
    fn requires_billing_warning_acknowledgement() {
        let s = AppSettings {
            paid_warning_acknowledged: false,
            ..paid_settings()
        };
        let m = month(0, 0.0);
        assert_eq!(
            check(&input(&s, &m)),
            Err(GuardError::WarningNotAcknowledged)
        );
    }

    #[test]
    fn requires_api_key() {
        let s = paid_settings();
        let m = month(0, 0.0);
        let i = GuardInput {
            has_api_key: false,
            ..input(&s, &m)
        };
        assert_eq!(check(&i), Err(GuardError::MissingApiKey));
    }

    #[test]
    fn enforces_batch_limit() {
        let s = paid_settings(); // default limit 3
        let m = month(0, 0.0);
        let ok = GuardInput {
            image_count: 3,
            planned_requests: 3,
            ..input(&s, &m)
        };
        assert_eq!(check(&ok), Ok(()));
        let too_many = GuardInput {
            image_count: 4,
            planned_requests: 4,
            ..input(&s, &m)
        };
        assert_eq!(
            check(&too_many),
            Err(GuardError::BatchTooLarge {
                requested: 4,
                max: 3
            })
        );
    }

    #[test]
    fn enforces_monthly_request_limit() {
        let s = AppSettings {
            monthly_request_limit: 10,
            ..paid_settings()
        };
        let m = month(9, 0.0);
        assert_eq!(check(&input(&s, &m)), Ok(()));
        let i = GuardInput {
            planned_requests: 2,
            ..input(&s, &m)
        };
        assert_eq!(
            check(&i),
            Err(GuardError::RequestLimit { used: 9, limit: 10 })
        );
        let full = month(10, 0.0);
        assert!(matches!(
            check(&input(&s, &full)),
            Err(GuardError::RequestLimit { .. })
        ));
    }

    #[test]
    fn enforces_local_spend_target() {
        let s = AppSettings {
            monthly_spend_target_usd: 1.0,
            ..paid_settings()
        };
        let m = month(1, 1.0);
        assert!(matches!(
            check(&input(&s, &m)),
            Err(GuardError::SpendTarget { .. })
        ));
        let zero_target = AppSettings {
            monthly_spend_target_usd: 0.0,
            ..paid_settings()
        };
        let fresh = month(0, 0.0);
        assert!(matches!(
            check(&input(&zero_target, &fresh)),
            Err(GuardError::SpendTarget { .. })
        ));
    }

    #[test]
    fn explicit_override_for_current_month_lifts_limits_only() {
        let s = AppSettings {
            monthly_request_limit: 1,
            limit_override_month: Some("2026-10".into()),
            ..paid_settings()
        };
        let m = month(5, 99.0);
        assert_eq!(check(&input(&s, &m)), Ok(()));
        // Override for a different month does not apply.
        let old = AppSettings {
            limit_override_month: Some("2026-09".into()),
            ..s.clone()
        };
        assert!(check(&input(&old, &m)).is_err());
        // The override never bypasses the kill switch or batch limit.
        let disabled = AppSettings {
            paid_ai_disabled: true,
            ..s.clone()
        };
        assert_eq!(check(&input(&disabled, &m)), Err(GuardError::Disabled));
        let i = GuardInput {
            image_count: 10,
            ..input(&s, &m)
        };
        assert!(matches!(check(&i), Err(GuardError::BatchTooLarge { .. })));
    }

    #[test]
    fn status_reports_reason() {
        let s = AppSettings::default();
        let st = status(&s, false, &month(0, 0.0));
        assert!(!st.available);
        assert_eq!(st.blocked_code.as_deref(), Some("not_selected"));
        let st = status(&paid_settings(), true, &month(0, 0.0));
        assert!(st.available);
    }
}
