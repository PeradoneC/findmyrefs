//! Per-token list prices used for *estimates* only.
//!
//! Source: Anthropic first-party API list prices (USD per million tokens), as of
//! 2026-10. Prices change - the Anthropic Console billing page is authoritative.
//! Keep in sync with `src/lib/models.ts`.
//!
//! When a model is not in this table, or the response does not include usage, the
//! estimate is `None` and the UI shows "Cost unavailable" instead of guessing.

pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
pub const PRICES_AS_OF: &str = "2026-10";

/// Models the user can select in Settings.
pub const SELECTABLE_MODELS: &[&str] =
    &["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

pub fn is_selectable_model(model: &str) -> bool {
    SELECTABLE_MODELS.contains(&model)
}

/// (input, output) USD per million tokens for a request with `input_tokens` input.
pub fn rates(model: &str, input_tokens: i64) -> Option<(f64, f64)> {
    match model {
        "claude-opus-5-5" => Some((4.0, 20.0)),
        "claude-sonnet-5-5" | "claude-sonnet-5" => Some((2.0, 10.0)),
        // Haiku 5.5 is priced higher for prompts over 100K tokens.
        "claude-haiku-5-5" if input_tokens > 100_000 => Some((0.50, 2.50)),
        "claude-haiku-5-5" => Some((0.10, 0.50)),
        // Possible server-side fallback models.
        "claude-opus-5" | "claude-opus-4-8" | "claude-opus-4-7" => Some((5.0, 25.0)),
        _ => None,
    }
}

pub fn estimate_cost_usd(
    model: &str,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
) -> Option<f64> {
    let (input, output) = (input_tokens?, output_tokens?);
    if input < 0 || output < 0 {
        return None;
    }
    let (in_rate, out_rate) = rates(model, input)?;
    Some((input as f64 * in_rate + output as f64 * out_rate) / 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_known_model() {
        let cost = estimate_cost_usd("claude-opus-5-5", Some(1_000_000), Some(100_000)).unwrap();
        assert!((cost - 6.0).abs() < 1e-9);
    }

    #[test]
    fn unknown_model_or_missing_usage_is_unavailable() {
        assert_eq!(
            estimate_cost_usd("some-future-model", Some(10), Some(10)),
            None
        );
        assert_eq!(estimate_cost_usd("claude-opus-5-5", None, Some(10)), None);
        assert_eq!(estimate_cost_usd("claude-opus-5-5", Some(10), None), None);
    }

    #[test]
    fn haiku_long_prompt_tier() {
        assert_eq!(rates("claude-haiku-5-5", 1_000), Some((0.10, 0.50)));
        assert_eq!(rates("claude-haiku-5-5", 200_000), Some((0.50, 2.50)));
    }

    #[test]
    fn default_model_is_selectable_and_priced() {
        assert!(is_selectable_model(DEFAULT_MODEL));
        for m in SELECTABLE_MODELS {
            assert!(rates(m, 0).is_some(), "{m} must have a price");
        }
    }
}
