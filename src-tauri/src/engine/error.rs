//! Engine errors. Every failing engine command rejects with an `EngineError`,
//! which serializes to `{ kind, message?, provider? }` for the frontend
//! (`ProviderErrorPayload` in `src/services/engine.ts`).

use serde::Serialize;
use std::fmt;

/// Longest provider message passed through to the UI.
const MAX_MESSAGE_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    InvalidKey,
    RateLimited,
    InsufficientQuota,
    Network,
    Timeout,
    TooLarge,
    ModelMissing,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineError {
    pub kind: ErrorKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

impl EngineError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: Some(message.into()), provider: None }
    }

    pub fn kind(kind: ErrorKind) -> Self {
        Self { kind, message: None, provider: None }
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unknown, message)
    }

    pub fn with_provider(mut self, provider: &str) -> Self {
        self.provider = Some(provider.to_string());
        self
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self.kind)?;
        if let Some(message) = &self.message {
            write!(f, ": {message}")?;
        }
        Ok(())
    }
}

impl std::error::Error for EngineError {}

pub type EngineResult<T> = Result<T, EngineError>;

/// OpenAI `error.code` values (and Groq's `blocked_api_access`) that mean the
/// account is out of credit or over a spend limit.
const QUOTA_CODES: &[&str] = &[
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "blocked_api_access",
];

/// Map a non-success provider response to an error. `key` is redacted from the
/// message in case the provider echoes it back. `retry_after` is the raw
/// `Retry-After` header, mentioned in rate-limit messages.
pub fn from_http_status(status: u16, body: &str, key: Option<&str>, retry_after: Option<&str>) -> EngineError {
    let message = provider_message(body).map(|m| sanitize_message(&m, key));
    let lower = body.to_ascii_lowercase();
    // error.code is more specific than error.type, so check it first
    let (code, error_type) = error_code_and_type(body);
    let is_quota = |s: &Option<String>| s.as_deref().is_some_and(|s| QUOTA_CODES.contains(&s));
    let quota = is_quota(&code) || (code.is_none() && is_quota(&error_type));

    let kind = match status {
        // OpenAI answers unsupported regions with 403; that's not a key problem
        403 if lower.contains("country, region, or territory") => ErrorKind::Unknown,
        401 | 403 => ErrorKind::InvalidKey,
        429 | 400 | 402 if quota => ErrorKind::InsufficientQuota,
        429 if code.is_none() && error_type.is_none() && lower.contains("insufficient_quota") => ErrorKind::InsufficientQuota,
        // Groq: 498 means flex-tier capacity is exhausted
        429 | 498 => ErrorKind::RateLimited,
        413 => ErrorKind::TooLarge,
        404 => ErrorKind::ModelMissing,
        _ if code.as_deref() == Some("model_not_found") || mentions_missing_model(&lower) => ErrorKind::ModelMissing,
        // Some OpenAI-compatible servers report quota problems with 402
        402 => ErrorKind::InsufficientQuota,
        _ => ErrorKind::Unknown,
    };

    let message = match (kind, message) {
        (ErrorKind::RateLimited, message) => match retry_after.and_then(retry_after_seconds) {
            Some(secs) => Some(format!("The provider is rate limiting you. Try again in {secs} seconds.")),
            None => message,
        },
        (ErrorKind::Unknown, None) => Some(format!("The provider returned HTTP {status}.")),
        (_, message) => message,
    };
    EngineError { kind, message, provider: None }
}

fn error_code_and_type(body: &str) -> (Option<String>, Option<String>) {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body.trim()) else {
        return (None, None);
    };
    let field = |name: &str| {
        json.pointer(&format!("/error/{name}"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    (field("code"), field("type"))
}

/// `Retry-After` is either seconds or an HTTP date; only seconds are used.
fn retry_after_seconds(value: &str) -> Option<u64> {
    let secs: f64 = value.trim().parse().ok()?;
    (secs.is_finite() && secs >= 0.0).then(|| secs.ceil().max(1.0) as u64)
}

/// Map a transport-level failure (no HTTP response).
pub fn from_reqwest(err: &reqwest::Error) -> EngineError {
    if err.is_timeout() {
        EngineError::kind(ErrorKind::Timeout)
    } else if err.is_connect() || err.is_request() {
        EngineError::new(ErrorKind::Network, short_transport_message(err))
    } else if err.is_decode() || err.is_body() {
        EngineError::unknown("The provider sent a response Abe couldn't read.")
    } else {
        EngineError::new(ErrorKind::Network, short_transport_message(err))
    }
}

fn short_transport_message(err: &reqwest::Error) -> String {
    // reqwest's Display includes the URL but never headers, so the key can't
    // leak through here. Keep only the innermost cause, which is the useful part.
    let mut source: &dyn std::error::Error = err;
    while let Some(next) = source.source() {
        source = next;
    }
    truncate(&source.to_string())
}

fn mentions_missing_model(lower_body: &str) -> bool {
    lower_body.contains("model_not_found")
        || lower_body.contains("model_decommissioned")
        || (lower_body.contains("model")
            && (lower_body.contains("does not exist")
                || lower_body.contains("not found")
                || lower_body.contains("decommissioned")))
}

/// Pull a human-readable message out of an OpenAI-style error body
/// (`{"error": {"message": ...}}`, `{"error": "..."}`, `{"message": ...}` or
/// `{"detail": ...}`), falling back to short plain-text bodies.
fn provider_message(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let candidates = [
            json.pointer("/error/message"),
            json.get("error"),
            json.get("message"),
            json.get("detail"),
        ];
        return candidates
            .into_iter()
            .flatten()
            .find_map(|v| v.as_str().map(str::to_string));
    }
    // Plain text, but not an HTML error page
    if trimmed.starts_with('<') {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Redact anything that looks like an API key and cap the length.
pub fn sanitize_message(message: &str, key: Option<&str>) -> String {
    let mut text = message.to_string();
    if let Some(key) = key.filter(|k| k.len() >= 4) {
        text = text.replace(key, "[redacted]");
    }
    let redacted: Vec<String> = text
        .split(' ')
        .map(|word| {
            let looks_like_key = word.starts_with("sk-")
                || word.starts_with("gsk_")
                || word.contains("sk-proj-")
                || (word.len() >= 32 && word.chars().all(|c| c.is_ascii_alphanumeric() || "-_*".contains(c)));
            if looks_like_key { "[redacted]".to_string() } else { word.to_string() }
        })
        .collect();
    truncate(&redacted.join(" "))
}

fn truncate(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() <= MAX_MESSAGE_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(MAX_MESSAGE_CHARS).collect();
    format!("{}...", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_auth_errors() {
        assert_eq!(from_http_status(401, "", None, None).kind, ErrorKind::InvalidKey);
        assert_eq!(from_http_status(403, "{}", None, None).kind, ErrorKind::InvalidKey);
    }

    #[test]
    fn maps_429_by_body() {
        let quota = r#"{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}"#;
        assert_eq!(from_http_status(429, quota, None, None).kind, ErrorKind::InsufficientQuota);
        let rate = r#"{"error":{"message":"Rate limit reached","type":"requests"}}"#;
        let err = from_http_status(429, rate, None, None);
        assert_eq!(err.kind, ErrorKind::RateLimited);
        assert_eq!(err.message.as_deref(), Some("Rate limit reached"));
    }

    #[test]
    fn maps_missing_model() {
        assert_eq!(from_http_status(404, "", None, None).kind, ErrorKind::ModelMissing);
        let body = r#"{"error":{"message":"The model `nope` does not exist or you do not have access to it.","code":"model_not_found"}}"#;
        assert_eq!(from_http_status(400, body, None, None).kind, ErrorKind::ModelMissing);
    }

    #[test]
    fn maps_too_large_and_unknown() {
        assert_eq!(from_http_status(413, "<html>too big</html>", None, None).kind, ErrorKind::TooLarge);
        let err = from_http_status(500, "", None, None);
        assert_eq!(err.kind, ErrorKind::Unknown);
        assert_eq!(err.message.as_deref(), Some("The provider returned HTTP 500."));
    }

    #[test]
    fn redacts_keys_from_messages() {
        let key = "sk-test-1234567890abcdef";
        let body = format!(r#"{{"error":{{"message":"Incorrect API key provided: {key}. Find yours at platform"}}}}"#);
        let err = from_http_status(401, &body, Some(key), None);
        let message = err.message.unwrap();
        assert!(!message.contains(key), "{message}");
        assert!(message.contains("[redacted]"));

        let masked = sanitize_message("Incorrect API key provided: gsk_abc***xyz.", None);
        assert!(!masked.contains("gsk_abc"));
    }

    #[test]
    fn maps_quota_codes_before_types() {
        for code in ["credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"] {
            let body = format!(r#"{{"error":{{"message":"Out of credit","type":"requests","code":"{code}"}}}}"#);
            assert_eq!(from_http_status(429, &body, None, None).kind, ErrorKind::InsufficientQuota, "{code}");
        }
        let typed = r#"{"error":{"message":"quota","type":"insufficient_quota","code":null}}"#;
        assert_eq!(from_http_status(429, typed, None, None).kind, ErrorKind::InsufficientQuota);
        // A rate-limit code wins over a quota-looking type
        let coded = r#"{"error":{"message":"slow down","type":"insufficient_quota","code":"rate_limit_exceeded"}}"#;
        assert_eq!(from_http_status(429, coded, None, None).kind, ErrorKind::RateLimited);
    }

    #[test]
    fn maps_groq_specifics() {
        let blocked = r#"{"error":{"message":"Spend limit reached","type":"invalid_request_error","code":"blocked_api_access"}}"#;
        assert_eq!(from_http_status(400, blocked, None, None).kind, ErrorKind::InsufficientQuota);
        assert_eq!(from_http_status(498, "", None, None).kind, ErrorKind::RateLimited);
        assert_eq!(from_http_status(413, "", None, None).kind, ErrorKind::TooLarge);
    }

    #[test]
    fn mentions_retry_after() {
        let err = from_http_status(429, r#"{"error":{"message":"Rate limit reached"}}"#, None, Some("7.2"));
        assert_eq!(err.kind, ErrorKind::RateLimited);
        assert_eq!(err.message.as_deref(), Some("The provider is rate limiting you. Try again in 8 seconds."));
        let dated = from_http_status(429, r#"{"error":{"message":"Rate limit reached"}}"#, None, Some("Wed, 21 Oct 2026 07:28:00 GMT"));
        assert_eq!(dated.message.as_deref(), Some("Rate limit reached"));
    }

    #[test]
    fn unsupported_region_is_not_a_key_problem() {
        let body = r#"{"error":{"message":"Country, region, or territory not supported","code":"unsupported_country_region_territory"}}"#;
        let err = from_http_status(403, body, None, None);
        assert_eq!(err.kind, ErrorKind::Unknown);
        assert_eq!(err.message.as_deref(), Some("Country, region, or territory not supported"));
    }

    #[test]
    fn truncates_long_messages() {
        let long = "word ".repeat(200);
        let err = from_http_status(500, &long, None, None);
        assert!(err.message.unwrap().chars().count() <= MAX_MESSAGE_CHARS + 3);
    }

    #[test]
    fn serializes_as_payload() {
        let err = EngineError::new(ErrorKind::RateLimited, "slow down").with_provider("groq");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json, serde_json::json!({"kind": "rate_limited", "message": "slow down", "provider": "groq"}));
        let bare = serde_json::to_value(EngineError::kind(ErrorKind::Timeout)).unwrap();
        assert_eq!(bare, serde_json::json!({"kind": "timeout"}));
    }
}
