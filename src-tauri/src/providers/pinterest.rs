//! Pinterest API v5 keyword search (`GET /v5/search/partner/pins`).
//!
//! This is Pinterest's official keyword search. Pinterest marks it as beta and "not
//! available to all apps": the user's Pinterest developer app must be approved for it,
//! otherwise Pinterest answers 403. Nothing here scrapes pinterest.com.
//!
//! The access token is read from the OS credential store and sent only to
//! api.pinterest.com. The raw JSON body is validated here (it must contain an `items`
//! array) and normalized in the frontend (`pinterestProvider.ts`), where it is treated
//! as untrusted data.

use std::time::Duration;

use serde::Deserialize;

use crate::secrets::ApiKey;

pub const API_URL: &str = "https://api.pinterest.com/v5/search/partner/pins";
/// Pinterest allows 1..=50 results per request.
pub const MAX_LIMIT: u32 = 50;
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum PinterestError {
    #[error("No Pinterest access token is configured. Add one in Settings → Pinterest.")]
    NoToken,
    #[error(
        "Pinterest rejected the access token (401). It may have expired; create a new token and paste it in Settings."
    )]
    TokenInvalid,
    #[error(
        "Pinterest refused the search (403). Keyword search is a beta Pinterest API feature: your Pinterest developer app must be approved for it, and the token needs the pins:read and boards:read scopes.{}",
        detail(.0)
    )]
    NotApproved(String),
    #[error("Pinterest rate limit reached (429).{}", retry_hint(.0))]
    RateLimited(Option<u64>),
    #[error("Pinterest rejected the request: {0}")]
    BadRequest(String),
    #[error("Pinterest returned a server error ({0}). Please retry.")]
    Server(u16),
    #[error("Could not reach Pinterest: {0}")]
    Network(String),
    #[error("The Pinterest search timed out. Please retry.")]
    Timeout,
    #[error("Pinterest returned an unexpected response: {0}")]
    InvalidResponse(String),
}

fn detail(msg: &str) -> String {
    if msg.is_empty() {
        String::new()
    } else {
        format!(" Pinterest said: \"{msg}\"")
    }
}

fn retry_hint(secs: &Option<u64>) -> String {
    match secs {
        Some(s) => format!(" Retry after about {s} seconds."),
        None => " Wait a moment and retry.".to_string(),
    }
}

impl PinterestError {
    pub fn code(&self) -> &'static str {
        match self {
            PinterestError::NoToken => "pinterest_no_token",
            PinterestError::TokenInvalid => "pinterest_token_invalid",
            PinterestError::NotApproved(_) => "pinterest_not_approved",
            PinterestError::RateLimited(_) => "pinterest_rate_limited",
            PinterestError::BadRequest(_) => "pinterest_bad_request",
            PinterestError::Server(_) => "pinterest_server_error",
            PinterestError::Network(_) => "pinterest_network",
            PinterestError::Timeout => "pinterest_timeout",
            PinterestError::InvalidResponse(_) => "pinterest_invalid_response",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    pub term: String,
    #[serde(default)]
    pub bookmark: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Validates a two-letter ISO 3166-1 country code (e.g. "US", "TH").
pub fn is_country_code(code: &str) -> bool {
    code.len() == 2 && code.chars().all(|c| c.is_ascii_uppercase())
}

pub fn build_search_url(
    params: &SearchParams,
    country_code: &str,
) -> Result<url::Url, PinterestError> {
    let term = params.term.trim();
    if term.is_empty() || term.chars().count() > 200 {
        return Err(PinterestError::BadRequest(
            "search term must be 1-200 characters".into(),
        ));
    }
    if !is_country_code(country_code) {
        return Err(PinterestError::BadRequest(
            "country code must be two capital letters, e.g. US".into(),
        ));
    }
    let mut url = url::Url::parse(API_URL).expect("valid constant URL");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("term", term);
        q.append_pair("country_code", country_code);
        q.append_pair(
            "limit",
            &params.limit.unwrap_or(25).clamp(1, MAX_LIMIT).to_string(),
        );
        if let Some(bookmark) = params.bookmark.as_deref().filter(|b| !b.is_empty()) {
            if bookmark.len() > 2000 {
                return Err(PinterestError::BadRequest("invalid page cursor".into()));
            }
            q.append_pair("bookmark", bookmark);
        }
    }
    Ok(url)
}

fn pinterest_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["message"].as_str().map(str::to_string))
        .unwrap_or_default()
        .chars()
        .take(300)
        .collect()
}

/// Maps an HTTP response to the validated JSON body or a typed error.
pub fn interpret_response(
    status: u16,
    body: &str,
    retry_after: Option<u64>,
) -> Result<String, PinterestError> {
    match status {
        200 => {}
        400 => return Err(PinterestError::BadRequest(pinterest_message(body))),
        401 => return Err(PinterestError::TokenInvalid),
        403 => return Err(PinterestError::NotApproved(pinterest_message(body))),
        429 => return Err(PinterestError::RateLimited(retry_after)),
        s => return Err(PinterestError::Server(s)),
    }
    if body.len() > MAX_BODY_BYTES {
        return Err(PinterestError::InvalidResponse("response too large".into()));
    }
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|_| PinterestError::InvalidResponse("not JSON".into()))?;
    if !value["items"].is_array() {
        return Err(PinterestError::InvalidResponse("missing items".into()));
    }
    Ok(body.to_string())
}

pub struct PinterestClient {
    client: reqwest::Client,
}

impl PinterestClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("HTTP client");
        Self { client }
    }

    pub async fn search(
        &self,
        token: &ApiKey,
        params: &SearchParams,
        country_code: &str,
    ) -> Result<String, PinterestError> {
        let url = build_search_url(params, country_code)?;
        let response = self
            .client
            .get(url)
            .bearer_auth(token.expose())
            .header("accept", "application/json")
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let body = response.text().await.map_err(map_reqwest_error)?;
        interpret_response(status, &body, retry_after)
    }
}

impl Default for PinterestClient {
    fn default() -> Self {
        Self::new()
    }
}

// reqwest error messages contain the URL (search term), never request headers.
fn map_reqwest_error(e: reqwest::Error) -> PinterestError {
    if e.is_timeout() {
        PinterestError::Timeout
    } else if e.is_connect() {
        PinterestError::Network("could not connect to api.pinterest.com".into())
    } else {
        PinterestError::Network("the connection failed".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(term: &str) -> SearchParams {
        SearchParams {
            term: term.into(),
            bookmark: None,
            limit: None,
        }
    }

    #[test]
    fn builds_official_search_url() {
        let url = build_search_url(
            &SearchParams {
                term: " red fox & snow ".into(),
                bookmark: Some("abc==".into()),
                limit: Some(500),
            },
            "US",
        )
        .unwrap();
        assert_eq!(url.host_str(), Some("api.pinterest.com"));
        assert_eq!(url.path(), "/v5/search/partner/pins");
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs["term"], "red fox & snow");
        assert_eq!(pairs["country_code"], "US");
        assert_eq!(pairs["limit"], "50");
        assert_eq!(pairs["bookmark"], "abc==");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(build_search_url(&params("   "), "US").is_err());
        assert!(build_search_url(&params("fox"), "usa").is_err());
        assert!(build_search_url(&params("fox"), "us").is_err());
        assert!(is_country_code("TH"));
    }

    #[test]
    fn maps_errors() {
        assert_eq!(
            interpret_response(401, "{}", None),
            Err(PinterestError::TokenInvalid)
        );
        let forbidden = interpret_response(
            403,
            r#"{"code":29,"message":"You are not permitted"}"#,
            None,
        );
        assert_eq!(
            forbidden,
            Err(PinterestError::NotApproved("You are not permitted".into()))
        );
        assert!(forbidden.unwrap_err().to_string().contains("approved"));
        assert_eq!(
            interpret_response(429, "", Some(60)),
            Err(PinterestError::RateLimited(Some(60)))
        );
        assert_eq!(
            interpret_response(503, "", None),
            Err(PinterestError::Server(503))
        );
        assert!(matches!(
            interpret_response(400, "x", None),
            Err(PinterestError::BadRequest(_))
        ));
    }

    #[test]
    fn validates_success_body() {
        assert!(interpret_response(200, r#"{"items":[],"bookmark":null}"#, None).is_ok());
        assert!(matches!(
            interpret_response(200, "<html>", None),
            Err(PinterestError::InvalidResponse(_))
        ));
        assert!(matches!(
            interpret_response(200, r#"{"data":[]}"#, None),
            Err(PinterestError::InvalidResponse(_))
        ));
    }

    #[test]
    fn error_codes_are_distinct() {
        let all = [
            PinterestError::NoToken,
            PinterestError::TokenInvalid,
            PinterestError::NotApproved(String::new()),
            PinterestError::RateLimited(None),
            PinterestError::BadRequest(String::new()),
            PinterestError::Server(500),
            PinterestError::Network(String::new()),
            PinterestError::Timeout,
            PinterestError::InvalidResponse(String::new()),
        ];
        let codes: std::collections::HashSet<_> = all.iter().map(|e| e.code()).collect();
        assert_eq!(codes.len(), all.len());
    }
}
