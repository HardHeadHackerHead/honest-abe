//! Cloud providers. All three speak the OpenAI API, so they differ only in
//! base URL, upload limit and whether a key is required.

use super::error::{EngineError, EngineResult, ErrorKind};
use serde::{Deserialize, Serialize};

/// OpenAI and Groq reject uploads over 25 MB. Custom servers get the same cap,
/// since most self-hosted servers copy OpenAI's limit.
pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Openai,
    Groq,
    Custom,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Groq => "groq",
            Self::Custom => "custom",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Openai => "OpenAI",
            Self::Groq => "Groq",
            Self::Custom => "your provider",
        }
    }

    /// Custom servers (Ollama, a local faster-whisper) often run without a key.
    pub fn requires_key(self) -> bool {
        !matches!(self, Self::Custom)
    }

    /// Resolve the API base URL. `custom_base_url` is only used for `Custom`.
    pub fn base_url(self, custom_base_url: Option<&str>) -> EngineResult<String> {
        match self {
            Self::Openai => Ok("https://api.openai.com/v1".to_string()),
            Self::Groq => Ok("https://api.groq.com/openai/v1".to_string()),
            Self::Custom => normalize_base_url(custom_base_url.unwrap_or_default()),
        }
    }
}

/// Trim whitespace and trailing slashes, and require an http(s) URL with a host.
pub fn normalize_base_url(raw: &str) -> EngineResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(EngineError::unknown("Set the base URL for your custom provider in Settings."));
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| EngineError::unknown("The custom base URL isn't a valid URL."))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(EngineError::unknown("The custom base URL must start with http:// or https://."));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(EngineError::unknown("The custom base URL can't contain ? or #."));
    }
    Ok(trimmed.to_string())
}

/// Join an endpoint path onto a normalized base URL.
pub fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'))
}

pub fn check_upload_size(bytes: usize) -> EngineResult<()> {
    if bytes > MAX_UPLOAD_BYTES {
        let minutes = MAX_UPLOAD_BYTES / (16_000 * 2 * 60);
        return Err(EngineError::new(
            ErrorKind::TooLarge,
            format!("Recordings over about {minutes} minutes are too large to upload. Try a shorter recording or local mode."),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_base_urls() {
        assert_eq!(ProviderId::Openai.base_url(Some("http://ignored")).unwrap(), "https://api.openai.com/v1");
        assert_eq!(ProviderId::Groq.base_url(None).unwrap(), "https://api.groq.com/openai/v1");
    }

    #[test]
    fn normalizes_custom_urls() {
        assert_eq!(normalize_base_url(" http://localhost:11434/v1/ ").unwrap(), "http://localhost:11434/v1");
        assert_eq!(normalize_base_url("https://example.com//").unwrap(), "https://example.com");
        assert_eq!(
            ProviderId::Custom.base_url(Some("http://127.0.0.1:8000/v1")).unwrap(),
            "http://127.0.0.1:8000/v1"
        );
    }

    #[test]
    fn rejects_bad_custom_urls() {
        for bad in ["", "   ", "localhost:8000", "ftp://example.com", "file:///etc/passwd", "http://", "https://x.com/v1?key=1"] {
            assert!(normalize_base_url(bad).is_err(), "{bad} should be rejected");
        }
        assert!(ProviderId::Custom.base_url(None).is_err());
    }

    #[test]
    fn joins_endpoints() {
        assert_eq!(endpoint("https://api.openai.com/v1", "/audio/transcriptions"), "https://api.openai.com/v1/audio/transcriptions");
        assert_eq!(endpoint("http://x/v1/", "models"), "http://x/v1/models");
    }

    #[test]
    fn upload_size_limit() {
        assert!(check_upload_size(MAX_UPLOAD_BYTES).is_ok());
        let err = check_upload_size(MAX_UPLOAD_BYTES + 1).unwrap_err();
        assert_eq!(err.kind, ErrorKind::TooLarge);
        assert!(err.message.unwrap().contains("13 minutes"));
    }

    #[test]
    fn provider_ids_round_trip() {
        let id: ProviderId = serde_json::from_str("\"groq\"").unwrap();
        assert_eq!(id, ProviderId::Groq);
        assert_eq!(serde_json::to_string(&ProviderId::Custom).unwrap(), "\"custom\"");
        assert!(serde_json::from_str::<ProviderId>("\"anthropic\"").is_err());
    }
}
