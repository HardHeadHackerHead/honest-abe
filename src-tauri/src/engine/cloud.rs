//! Requests to OpenAI-compatible providers: transcription, chat completions
//! for transforms, and a cheap key check. The key is only placed in the
//! `Authorization` header and is never logged.

use super::error::{from_http_status, from_reqwest, EngineError, EngineResult, ErrorKind};
use super::keys::ApiKey;
use super::prompts::TranscriptionStyle;
use super::provider::{check_upload_size, endpoint, ProviderId};
use reqwest::multipart::{Form, Part};
use reqwest::{RequestBuilder, Response};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_TIMEOUT_SECS: f32 = 300.0;

/// Where a request goes and with which key.
#[derive(Debug, Clone)]
pub struct Target {
    pub provider: ProviderId,
    pub base_url: String,
    pub key: Option<ApiKey>,
}

impl Target {
    fn authorize(&self, request: RequestBuilder) -> RequestBuilder {
        match &self.key {
            Some(key) => request.bearer_auth(key.expose()),
            None => request,
        }
    }

    fn key_str(&self) -> Option<&str> {
        self.key.as_ref().map(ApiKey::expose)
    }

    fn tag(&self, err: EngineError) -> EngineError {
        err.with_provider(self.provider.as_str())
    }
}

/// Shared client. reqwest is built with rustls but no default crypto
/// provider (to avoid aws-lc's build requirements), so install ring once.
pub fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        install_crypto_provider();
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(concat!("Abe/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("failed to build HTTP client")
    })
}

pub fn install_crypto_provider() {
    // Errors only when a provider is already installed, which is fine.
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// 30 s plus twice the audio length, capped at 5 minutes.
pub fn transcription_timeout(audio_seconds: f32) -> Duration {
    let secs = (30.0 + 2.0 * audio_seconds.max(0.0)).min(MAX_TIMEOUT_SECS);
    Duration::from_secs_f32(secs)
}

fn chat_timeout(max_tokens: u32) -> Duration {
    let secs = (30.0 + max_tokens as f32 / 40.0).min(MAX_TIMEOUT_SECS);
    Duration::from_secs_f32(secs)
}

/// Send a request, retrying once only if the connection itself failed. A
/// request that may have reached the provider is never re-sent: on the user's
/// own key that would mean paying twice.
async fn send(build: impl Fn() -> RequestBuilder) -> Result<Response, reqwest::Error> {
    match build().send().await {
        Err(err) if err.is_connect() => {
            tokio::time::sleep(Duration::from_millis(300)).await;
            build().send().await
        }
        other => other,
    }
}

/// A failed response, read once: status, Retry-After and body.
struct Failure {
    status: u16,
    retry_after: Option<String>,
    body: String,
}

impl Failure {
    async fn read(response: Response) -> Self {
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = response.text().await.unwrap_or_default();
        Self { status, retry_after, body }
    }

    fn into_error(self, target: &Target) -> EngineError {
        target.tag(from_http_status(self.status, &self.body, target.key_str(), self.retry_after.as_deref()))
    }
}

async fn read_error(target: &Target, response: Response) -> EngineError {
    Failure::read(response).await.into_error(target)
}

/// Only Whisper models return `verbose_json`; newer OpenAI transcription
/// models (gpt-transcribe, gpt-4o*) accept `json` or `text`.
fn initial_response_format(model: &str) -> &'static str {
    let name = model.rsplit('/').next().unwrap_or(model);
    if name.starts_with("whisper") || name.contains("whisper") {
        "verbose_json"
    } else {
        "json"
    }
}

pub struct TranscriptionRequest<'a> {
    pub model: &'a str,
    pub wav: Vec<u8>,
    pub audio_seconds: f32,
    /// ISO 639-1 code or "auto"
    pub language: &'a str,
    pub style: TranscriptionStyle,
}

pub async fn transcribe(target: &Target, request: TranscriptionRequest<'_>) -> EngineResult<String> {
    check_upload_size(request.wav.len()).map_err(|e| target.tag(e))?;

    let url = endpoint(&target.base_url, "audio/transcriptions");
    let timeout = transcription_timeout(request.audio_seconds);
    let language = request.language.trim();
    let language = (!language.is_empty() && language != "auto").then_some(language);

    let build_form = |response_format: &'static str| {
        let file = Part::bytes(request.wav.clone())
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .expect("static mime type is valid");
        let mut form = Form::new()
            .part("file", file)
            .text("model", request.model.to_string())
            .text("response_format", response_format)
            .text("prompt", request.style.prompt());
        if let Some(language) = language {
            form = form.text("language", language.to_string());
        }
        form
    };

    let mut response_format = initial_response_format(request.model);
    loop {
        let build = || {
            target
                .authorize(http_client().post(&url))
                .timeout(timeout)
                .multipart(build_form(response_format))
        };
        let response = send(build).await.map_err(|e| target.tag(from_reqwest(&e)))?;
        let status = response.status();

        if status.is_success() {
            let body = response.text().await.map_err(|e| target.tag(from_reqwest(&e)))?;
            return Ok(parse_transcription(&body));
        }

        // Some OpenAI-compatible servers don't support verbose_json. A rejected
        // request costs nothing, so retry once with plain json.
        if response_format == "verbose_json" && matches!(status.as_u16(), 400 | 415 | 422) {
            let failure = Failure::read(response).await;
            if failure.body.contains("response_format") || failure.body.contains("verbose_json") {
                response_format = "json";
                continue;
            }
            return Err(failure.into_error(target));
        }
        return Err(read_error(target, response).await);
    }
}

/// `{"text": ...}` from json/verbose_json, or the raw body from servers that
/// answer in plain text.
fn parse_transcription(body: &str) -> String {
    match serde_json::from_str::<Value>(body) {
        Ok(json) => json.get("text").and_then(Value::as_str).unwrap_or_default().trim().to_string(),
        Err(_) => body.trim().to_string(),
    }
}

/// Reasoning tokens count against `max_completion_tokens`, so reasoning
/// models get this much on top of the output budget.
const REASONING_HEADROOM: u32 = 2000;
const MAX_COMPLETION_TOKENS: u32 = 16_000;

/// Reasoning models take `max_completion_tokens` and reject `temperature`.
fn is_reasoning_model(model: &str) -> bool {
    let name = model.rsplit('/').next().unwrap_or(model);
    name.starts_with("gpt-oss") || ["o1", "o3", "o4", "gpt-5"].iter().any(|prefix| name.starts_with(prefix))
}

/// Models that rejected `temperature` / `max_tokens` this session (keyed by
/// base URL and model), so later requests skip the failed first attempt.
fn reasoning_param_models() -> &'static Mutex<HashSet<String>> {
    static MODELS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    MODELS.get_or_init(Default::default)
}

fn model_cache_key(target: &Target, model: &str) -> String {
    format!("{}|{model}", target.base_url)
}

/// A 400 complaining about `temperature` or `max_tokens` (e.g. "Unsupported
/// parameter: 'max_tokens' ... Use 'max_completion_tokens' instead").
fn rejects_classic_params(status: u16, body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    status == 400
        && (lower.contains("temperature") || lower.contains("max_tokens"))
        && ["unsupported", "not supported", "unrecognized", "unknown parameter", "does not support"]
            .iter()
            .any(|phrase| lower.contains(phrase))
}

pub fn chat_body(provider: ProviderId, model: &str, system: &str, user: &str, max_tokens: u32, reasoning_params: bool) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    if reasoning_params {
        let budget = if is_reasoning_model(model) { max_tokens + REASONING_HEADROOM } else { max_tokens };
        body["max_completion_tokens"] = json!(budget.min(MAX_COMPLETION_TOKENS));
        let name = model.rsplit('/').next().unwrap_or(model);
        if provider == ProviderId::Groq && name.starts_with("gpt-oss") {
            body["reasoning_effort"] = json!("low");
        }
    } else {
        body["max_tokens"] = json!(max_tokens);
        body["temperature"] = json!(0.3);
    }
    body
}

pub async fn chat(target: &Target, model: &str, system: &str, user: &str, max_tokens: u32) -> EngineResult<String> {
    let url = endpoint(&target.base_url, "chat/completions");
    let cache_key = model_cache_key(target, model);
    let mut reasoning_params = is_reasoning_model(model)
        || reasoning_param_models().lock().map(|m| m.contains(&cache_key)).unwrap_or(false);
    let timeout = chat_timeout(max_tokens + REASONING_HEADROOM);

    let response = loop {
        let body = chat_body(target.provider, model, system, user, max_tokens, reasoning_params);
        let build = || target.authorize(http_client().post(&url)).timeout(timeout).json(&body);
        let response = send(build).await.map_err(|e| target.tag(from_reqwest(&e)))?;
        if response.status().is_success() {
            break response;
        }
        let failure = Failure::read(response).await;
        // Validation errors aren't charged, so retry once with reasoning-style
        // parameters and remember the model for the rest of the session.
        if !reasoning_params && rejects_classic_params(failure.status, &failure.body) {
            reasoning_params = true;
            if let Ok(mut models) = reasoning_param_models().lock() {
                models.insert(cache_key.clone());
            }
            continue;
        }
        return Err(failure.into_error(target));
    };
    let json: Value = response.json().await.map_err(|e| target.tag(from_reqwest(&e)))?;
    let content = json
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let text = strip_think_block(content).trim().to_string();
    if text.is_empty() {
        return Err(target.tag(EngineError::unknown("The model returned no text.")));
    }
    Ok(text)
}

/// Local reasoning models (e.g. via Ollama) may prefix `<think>...</think>`.
fn strip_think_block(content: &str) -> &str {
    let trimmed = content.trim_start();
    if trimmed.starts_with("<think>") {
        if let Some(end) = trimmed.find("</think>") {
            return &trimmed[end + "</think>".len()..];
        }
    }
    content
}

/// Cheap authenticated request (`GET /models`) to check a key or a server.
pub async fn test_connection(target: &Target) -> EngineResult<()> {
    let url = endpoint(&target.base_url, "models");
    let build = || target.authorize(http_client().get(&url)).timeout(TEST_TIMEOUT);
    let response = send(build).await.map_err(|e| target.tag(from_reqwest(&e)))?;
    let status = response.status().as_u16();

    if response.status().is_success() {
        return Ok(());
    }
    // A custom server that answers but doesn't implement /models is still reachable.
    if target.provider == ProviderId::Custom && !matches!(status, 401 | 403) {
        return Ok(());
    }
    let mut err = read_error(target, response).await;
    if err.kind == ErrorKind::ModelMissing {
        // /models itself missing is not a model problem
        err.kind = ErrorKind::Unknown;
    }
    Err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    fn target(server: &MockServer, provider: ProviderId, key: Option<&str>) -> Target {
        Target { provider, base_url: format!("{}/v1", server.uri()), key: key.map(ApiKey::new) }
    }

    fn wav() -> Vec<u8> {
        b"RIFF....WAVEfmt fake".to_vec()
    }

    fn request(model: &str) -> TranscriptionRequest<'_> {
        TranscriptionRequest { model, wav: wav(), audio_seconds: 3.0, language: "en", style: TranscriptionStyle::Balanced }
    }

    #[test]
    fn timeouts_scale_with_audio() {
        assert_eq!(transcription_timeout(0.0), Duration::from_secs(30));
        assert_eq!(transcription_timeout(60.0), Duration::from_secs(150));
        assert_eq!(transcription_timeout(1000.0), Duration::from_secs(300));
    }

    #[test]
    fn classic_models_use_max_tokens_and_temperature() {
        let body = chat_body(ProviderId::Openai, "gpt-6-luna", "sys", "user", 1000, is_reasoning_model("gpt-6-luna"));
        assert_eq!(body["max_tokens"], 1000);
        assert_eq!(body["temperature"], 0.3);
        assert!(body.get("max_completion_tokens").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
    }

    #[test]
    fn reasoning_models_use_max_completion_tokens_with_headroom() {
        for model in ["o3-mini", "o1", "o4-mini", "gpt-5", "gpt-5-mini", "openai/gpt-5", "openai/gpt-oss-120b", "gpt-oss:20b"] {
            assert!(is_reasoning_model(model), "{model}");
            let body = chat_body(ProviderId::Openai, model, "sys", "user", 2000, true);
            assert_eq!(body["max_completion_tokens"], 4000, "{model}");
            assert!(body.get("temperature").is_none(), "{model}");
            assert!(body.get("max_tokens").is_none(), "{model}");
            assert!(body.get("reasoning_effort").is_none(), "{model}");
        }
        assert!(!is_reasoning_model("gpt-6-luna"));
        assert!(!is_reasoning_model("llama-3.1-8b-instant"));
        let capped = chat_body(ProviderId::Openai, "o3", "s", "u", 16_000, true);
        assert_eq!(capped["max_completion_tokens"], 16_000);
    }

    #[test]
    fn groq_gpt_oss_gets_low_reasoning_effort() {
        let body = chat_body(ProviderId::Groq, "openai/gpt-oss-120b", "s", "u", 1000, true);
        assert_eq!(body["reasoning_effort"], "low");
        assert_eq!(body["max_completion_tokens"], 3000);
    }

    #[test]
    fn response_format_by_model() {
        assert_eq!(initial_response_format("whisper-1"), "verbose_json");
        assert_eq!(initial_response_format("whisper-large-v3-turbo"), "verbose_json");
        assert_eq!(initial_response_format("Systran/faster-whisper-small"), "verbose_json");
        assert_eq!(initial_response_format("gpt-transcribe"), "json");
        assert_eq!(initial_response_format("gpt-4o-mini-transcribe"), "json");
    }

    #[test]
    fn strips_think_blocks() {
        assert_eq!(strip_think_block("<think>hmm</think>\nAnswer").trim(), "Answer");
        assert_eq!(strip_think_block("Plain answer"), "Plain answer");
    }

    #[tokio::test]
    async fn transcription_request_shape() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/audio/transcriptions"))
            .and(header("authorization", "Bearer gsk_test"))
            .and(body_string_contains("name=\"model\"\r\n\r\nwhisper-large-v3-turbo"))
            .and(body_string_contains("name=\"response_format\"\r\n\r\nverbose_json"))
            .and(body_string_contains("name=\"language\"\r\n\r\nen"))
            .and(body_string_contains("So I was thinking we could try the new approach."))
            .and(body_string_contains("filename=\"audio.wav\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"text": " Hello there. ", "duration": 3.0})))
            .expect(1)
            .mount(&server)
            .await;

        let text = transcribe(&target(&server, ProviderId::Groq, Some("gsk_test")), request("whisper-large-v3-turbo"))
            .await
            .unwrap();
        assert_eq!(text, "Hello there.");
    }

    #[tokio::test]
    async fn omits_auto_language_and_uses_json_for_gpt_transcribe() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/audio/transcriptions"))
            .and(body_string_contains("name=\"response_format\"\r\n\r\njson"))
            .respond_with(|req: &Request| {
                let body = String::from_utf8_lossy(&req.body);
                assert!(!body.contains("name=\"language\""));
                ResponseTemplate::new(200).set_body_json(json!({"text": "ok"}))
            })
            .expect(1)
            .mount(&server)
            .await;

        let mut req = request("gpt-transcribe");
        req.language = "auto";
        let text = transcribe(&target(&server, ProviderId::Openai, Some("sk-x")), req).await.unwrap();
        assert_eq!(text, "ok");
    }

    #[tokio::test]
    async fn falls_back_to_json_when_verbose_json_is_rejected() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_string_contains("verbose_json"))
            .respond_with(ResponseTemplate::new(400).set_body_string("unsupported response_format verbose_json"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(body_string_contains("name=\"response_format\"\r\n\r\njson"))
            .respond_with(ResponseTemplate::new(200).set_body_string("plain text answer"))
            .expect(1)
            .mount(&server)
            .await;

        let text = transcribe(&target(&server, ProviderId::Custom, None), request("whisper-1")).await.unwrap();
        assert_eq!(text, "plain text answer");
    }

    #[tokio::test]
    async fn maps_provider_errors_without_retrying() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429).set_body_json(json!({
                "error": {"message": "You exceeded your current quota", "code": "insufficient_quota"}
            })))
            .expect(1)
            .mount(&server)
            .await;

        let err = transcribe(&target(&server, ProviderId::Openai, Some("sk-x")), request("whisper-1")).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::InsufficientQuota);
        assert_eq!(err.provider.as_deref(), Some("openai"));
    }

    #[tokio::test]
    async fn rejects_oversized_audio_before_sending() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(200)).expect(0).mount(&server).await;

        let mut req = request("whisper-1");
        req.wav = vec![0; super::super::provider::MAX_UPLOAD_BYTES + 1];
        let err = transcribe(&target(&server, ProviderId::Groq, Some("k")), req).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::TooLarge);
    }

    #[tokio::test]
    async fn network_errors_are_mapped() {
        // Nothing listens on port 9 (discard) on loopback
        let target = Target { provider: ProviderId::Custom, base_url: "http://127.0.0.1:9/v1".into(), key: None };
        let err = transcribe(&target, request("whisper-1")).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Network);
    }

    #[tokio::test]
    async fn chat_request_and_response() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer sk-x"))
            .respond_with(|req: &Request| {
                let body: Value = serde_json::from_slice(&req.body).unwrap();
                assert_eq!(body["model"], "gpt-4o-mini");
                assert_eq!(body["temperature"], 0.3);
                assert_eq!(body["max_tokens"], 1000);
                assert_eq!(body["messages"][1]["content"], "Instruction: x\n\nText to transform:\ny");
                ResponseTemplate::new(200).set_body_json(json!({
                    "choices": [{"message": {"role": "assistant", "content": "  Done.  "}}]
                }))
            })
            .expect(1)
            .mount(&server)
            .await;

        let text = chat(&target(&server, ProviderId::Openai, Some("sk-x")), "gpt-4o-mini", "sys", "Instruction: x\n\nText to transform:\ny", 1000)
            .await
            .unwrap();
        assert_eq!(text, "Done.");
    }

    #[tokio::test]
    async fn chat_retries_once_with_reasoning_params_and_remembers() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_string_contains("\"temperature\""))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "error": {"message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", "code": "unsupported_parameter"}
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(body_string_contains("max_completion_tokens"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "choices": [{"message": {"content": "Shorter.", "reasoning": "thinking..."}}]
            })))
            .expect(2)
            .mount(&server)
            .await;

        let target = target(&server, ProviderId::Openai, Some("sk-x"));
        assert_eq!(chat(&target, "new-model-x", "s", "u", 1000).await.unwrap(), "Shorter.");
        // Second call goes straight to reasoning params (the 400 mock expects one hit)
        assert_eq!(chat(&target, "new-model-x", "s", "u", 1000).await.unwrap(), "Shorter.");
    }

    #[tokio::test]
    async fn chat_does_not_retry_other_400s() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error": {"message": "Bad messages"}})))
            .expect(1)
            .mount(&server)
            .await;
        let err = chat(&target(&server, ProviderId::Openai, Some("k")), "plain-model", "s", "u", 1000).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Unknown);
    }

    #[tokio::test]
    async fn rate_limit_mentions_retry_after() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(429)
                    .insert_header("retry-after", "12")
                    .set_body_json(json!({"error": {"message": "Rate limit reached", "code": "rate_limit_exceeded"}})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let err = chat(&target(&server, ProviderId::Groq, Some("k")), "openai/gpt-oss-20b", "s", "u", 1000).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::RateLimited);
        assert_eq!(err.message.as_deref(), Some("The provider is rate limiting you. Try again in 12 seconds."));
    }

    async fn error_for(status: u16, body: Value) -> EngineError {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .expect(1)
            .mount(&server)
            .await;
        chat(&target(&server, ProviderId::Openai, Some("k")), "gpt-6-luna", "s", "u", 1000).await.unwrap_err()
    }

    #[tokio::test]
    async fn maps_openai_quota_codes_over_http() {
        for code in ["credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"] {
            let err = error_for(429, json!({"error": {"message": "limit", "type": "requests", "code": code}})).await;
            assert_eq!(err.kind, ErrorKind::InsufficientQuota, "{code}");
        }
        let err = error_for(429, json!({"error": {"message": "quota", "type": "insufficient_quota", "code": null}})).await;
        assert_eq!(err.kind, ErrorKind::InsufficientQuota);
        let err = error_for(429, json!({"error": {"message": "slow", "type": "insufficient_quota", "code": "rate_limit_exceeded"}})).await;
        assert_eq!(err.kind, ErrorKind::RateLimited, "code is checked before type");
    }

    #[tokio::test]
    async fn maps_groq_spend_limit_and_capacity_over_http() {
        let err = error_for(400, json!({"error": {"message": "Spend limit reached", "type": "invalid_request_error", "code": "blocked_api_access"}})).await;
        assert_eq!(err.kind, ErrorKind::InsufficientQuota);
        let err = error_for(498, json!({"error": {"message": "Flex tier capacity exceeded"}})).await;
        assert_eq!(err.kind, ErrorKind::RateLimited);
        let err = error_for(413, json!({"error": {"message": "Request too large"}})).await;
        assert_eq!(err.kind, ErrorKind::TooLarge);
    }

    #[tokio::test]
    async fn unsupported_region_over_http() {
        let err = error_for(403, json!({"error": {"message": "Country, region, or territory not supported", "code": "unsupported_country_region_territory"}})).await;
        assert_eq!(err.kind, ErrorKind::Unknown);
        assert_eq!(err.message.as_deref(), Some("Country, region, or territory not supported"));
        assert_eq!(err.provider.as_deref(), Some("openai"));
    }

    #[tokio::test]
    async fn chat_maps_missing_model() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                "error": {"message": "The model `nope` does not exist", "code": "model_not_found"}
            })))
            .mount(&server)
            .await;
        let err = chat(&target(&server, ProviderId::Groq, Some("k")), "nope", "s", "u", 1000).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::ModelMissing);
    }

    #[tokio::test]
    async fn key_test_results() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("authorization", "Bearer good"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": []})))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({"error": {"message": "Invalid API Key"}})))
            .mount(&server)
            .await;

        assert!(test_connection(&target(&server, ProviderId::Groq, Some("good"))).await.is_ok());
        let err = test_connection(&target(&server, ProviderId::Groq, Some("bad"))).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidKey);
    }

    #[tokio::test]
    async fn custom_server_without_models_endpoint_is_reachable() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).respond_with(ResponseTemplate::new(404)).mount(&server).await;
        assert!(test_connection(&target(&server, ProviderId::Custom, None)).await.is_ok());

        let err = test_connection(&target(&server, ProviderId::Openai, Some("k"))).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Unknown);
    }
}
