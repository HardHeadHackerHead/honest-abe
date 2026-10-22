//! Transcription and transform engine: local Whisper or the user's own
//! provider key. The command contract mirrors `src/services/engine.ts`.
//!
//! - `error`: the `{ kind, message?, provider? }` rejection payload
//! - `provider`: OpenAI / Groq / custom base URLs and upload limits
//! - `keys`: API keys in the OS keychain
//! - `cloud`: HTTP requests to OpenAI-compatible providers
//! - `prompts`: style prompts, relaxed post-processing, transform presets
//! - `local`: Whisper model downloads and offline inference

mod cloud;
mod error;
mod keys;
mod local;
mod prompts;
mod provider;

use crate::commands::AppState;
use error::{EngineError, EngineResult, ErrorKind};
use local::{DownloadOutcome, LocalEngine, LocalModelId, LocalModelInfo};
use prompts::{Preset, TranscriptionStyle};
use provider::ProviderId;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

/// Managed state for the engine.
#[derive(Default)]
pub struct EngineState {
    local: LocalEngine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineMode {
    Local,
    Cloud,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEndpoint {
    pub provider: ProviderId,
    pub model: String,
    pub base_url: Option<String>,
}

impl ProviderEndpoint {
    /// Configured well enough to send a request: a key where one is required,
    /// a valid base URL for custom, and a model name.
    fn is_ready(&self) -> bool {
        !self.model.trim().is_empty()
            && self.provider.base_url(self.base_url.as_deref()).is_ok()
            && (!self.provider.requires_key() || keys::has(self.provider))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub mode: Option<EngineMode>,
    pub local_model: LocalModelId,
    pub transcription: ProviderEndpoint,
    pub transform: ProviderEndpoint,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub ready: bool,
    /// "local" | "cloud" | "none"
    pub mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Why the engine isn't ready, for the UI
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// The transform provider can take requests
    pub transform_ready: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeOptions {
    pub mode: EngineMode,
    pub local_model: Option<LocalModelId>,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub language: Option<String>,
    #[serde(default)]
    pub style: TranscriptionStyle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub text: String,
    /// Recording length, for usage stats
    pub duration_seconds: f32,
    /// Audio actually transcribed (long silences trimmed), for cost estimates
    pub audio_seconds: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    pub provider: ProviderId,
    pub model: String,
    pub base_url: Option<String>,
    pub text: String,
    pub instruction: String,
    pub preset: Option<Preset>,
    /// The user's standing transform prompt from Settings
    pub custom_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformResult {
    pub text: String,
    /// The preset that was applied, if the instruction matched one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<Preset>,
}

fn models_dir(app: &AppHandle) -> EngineResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("models"))
        .map_err(|e| EngineError::unknown(format!("Couldn't find the app data folder: {e}")))
}

/// Resolve where a provider request goes and load its key.
fn target(provider: ProviderId, base_url: Option<&str>) -> EngineResult<cloud::Target> {
    let base_url = provider.base_url(base_url).map_err(|e| e.with_provider(provider.as_str()))?;
    let key = keys::get(provider)?;
    if key.is_none() && provider.requires_key() {
        return Err(EngineError::new(
            ErrorKind::InvalidKey,
            format!("No API key saved for {}. Add one in Settings.", provider.display_name()),
        )
        .with_provider(provider.as_str()));
    }
    Ok(cloud::Target { provider, base_url, key })
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> EngineResult<T> + Send + 'static) -> EngineResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| EngineError::unknown(format!("Engine task failed: {e}")))?
}

#[tauri::command]
pub async fn get_engine_status(app: AppHandle, config: EngineConfig) -> EngineResult<EngineStatus> {
    let dir = models_dir(&app)?;
    blocking(move || {
        let engine = app.state::<EngineState>();
        let transform_ready = config.transform.is_ready();
        let status = match config.mode {
            None => EngineStatus {
                ready: false,
                mode: "none",
                provider: None,
                detail: Some("Choose how Abe transcribes.".into()),
                transform_ready,
            },
            Some(EngineMode::Local) => {
                let id = config.local_model;
                let downloading = engine.local.is_downloading(id);
                let ready = !downloading && local::is_downloaded(&dir, id);
                let detail = match (ready, downloading) {
                    (true, _) => None,
                    (false, true) => Some(format!("The {} model is still downloading.", id.as_str())),
                    (false, false) => Some(format!("Download the {} model to start.", id.as_str())),
                };
                EngineStatus {
                    ready,
                    mode: "local",
                    provider: Some(format!("Local ({})", id.as_str())),
                    detail,
                    transform_ready,
                }
            }
            Some(EngineMode::Cloud) => {
                let endpoint = &config.transcription;
                let provider = endpoint.provider;
                let ready = endpoint.is_ready();
                let detail = (!ready).then(|| {
                    if provider == ProviderId::Custom {
                        "Set a valid base URL for your custom provider.".to_string()
                    } else if endpoint.model.trim().is_empty() {
                        "Choose a transcription model.".to_string()
                    } else {
                        format!("Add your {} API key.", provider.display_name())
                    }
                });
                EngineStatus {
                    ready,
                    mode: "cloud",
                    provider: Some(match provider {
                        ProviderId::Custom => "Custom".to_string(),
                        p => p.display_name().to_string(),
                    }),
                    detail,
                    transform_ready,
                }
            }
        };
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn transcribe_recording(app: AppHandle, opts: TranscribeOptions) -> EngineResult<TranscribeResult> {
    let capture = app
        .state::<AppState>()
        .capture
        .lock()
        .map_err(|_| EngineError::unknown("Recording state is unavailable."))?
        .clone()
        .filter(|c| !c.is_empty())
        .ok_or_else(|| EngineError::unknown("Nothing was recorded."))?;

    let language = opts.language.clone().unwrap_or_else(|| "en".to_string());
    let style = opts.style;

    let text = match opts.mode {
        EngineMode::Local => {
            let id = opts.local_model.unwrap_or(LocalModelId::Base);
            let dir = models_dir(&app)?;
            let capture = capture.clone();
            blocking(move || {
                let engine = app.state::<EngineState>();
                engine.local.transcribe(&dir, id, &capture.samples_16k, &language, style)
            })
            .await?
        }
        EngineMode::Cloud => {
            let provider = opts.provider.ok_or_else(|| EngineError::unknown("No provider selected."))?;
            let model = opts
                .model
                .as_deref()
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .ok_or_else(|| EngineError::unknown("No transcription model selected.").with_provider(provider.as_str()))?;
            let target = target(provider, opts.base_url.as_deref())?;
            let wav = capture.to_wav().map_err(EngineError::unknown)?;
            let raw = cloud::transcribe(
                &target,
                cloud::TranscriptionRequest {
                    model,
                    wav,
                    audio_seconds: capture.duration_seconds(),
                    language: &language,
                    style,
                },
            )
            .await?;
            style.post_process(&raw)
        }
    };

    Ok(TranscribeResult {
        text,
        duration_seconds: capture.original_duration_seconds,
        audio_seconds: capture.duration_seconds(),
    })
}

#[tauri::command]
pub async fn transform_text(opts: TransformOptions) -> EngineResult<TransformResult> {
    let text_chars = opts.text.chars().count();
    if text_chars > prompts::TRANSFORM_MAX_CHARS {
        return Err(EngineError::new(
            ErrorKind::TooLarge,
            format!(
                "The selection is {text_chars} characters; transforms are limited to {}.",
                prompts::TRANSFORM_MAX_CHARS
            ),
        ));
    }
    if opts.text.trim().is_empty() {
        return Err(EngineError::unknown("There's no text to transform."));
    }

    let preset = opts.preset.or_else(|| prompts::match_preset(&opts.instruction));
    let instruction = match preset {
        Some(preset) => preset.instruction().to_string(),
        None => opts.instruction.trim().to_string(),
    };
    if instruction.is_empty() {
        return Err(EngineError::unknown("No instruction was given."));
    }
    let instruction = prompts::combine_instruction(opts.custom_prompt.as_deref(), &instruction);

    let model = opts.model.trim();
    if model.is_empty() {
        return Err(EngineError::unknown("No transform model selected.").with_provider(opts.provider.as_str()));
    }
    let target = target(opts.provider, opts.base_url.as_deref())?;
    let text = cloud::chat(
        &target,
        model,
        prompts::TRANSFORM_SYSTEM_PROMPT,
        &prompts::transform_user_message(&instruction, &opts.text),
        prompts::transform_max_tokens(&opts.text),
    )
    .await?;
    Ok(TransformResult { text, preset })
}

#[tauri::command]
pub async fn set_api_key(provider: ProviderId, key: String) -> EngineResult<()> {
    blocking(move || keys::set(provider, &key)).await
}

#[tauri::command]
pub async fn has_api_key(provider: ProviderId) -> EngineResult<bool> {
    blocking(move || Ok(keys::has(provider))).await
}

#[tauri::command]
pub async fn delete_api_key(provider: ProviderId) -> EngineResult<()> {
    blocking(move || keys::delete(provider)).await
}

#[tauri::command]
pub async fn test_api_key(provider: ProviderId, base_url: Option<String>) -> EngineResult<()> {
    let target = blocking(move || target(provider, base_url.as_deref())).await?;
    cloud::test_connection(&target).await
}

#[tauri::command]
pub async fn list_local_models(app: AppHandle) -> EngineResult<Vec<LocalModelInfo>> {
    let dir = models_dir(&app)?;
    blocking(move || Ok(app.state::<EngineState>().local.list(&dir))).await
}

/// Download, verify and install a model, emitting `local-model-download-progress`.
#[tauri::command]
pub async fn download_local_model(
    app: AppHandle,
    state: State<'_, EngineState>,
    id: LocalModelId,
) -> EngineResult<DownloadOutcome> {
    let dir = models_dir(&app)?;
    let outcome = state
        .local
        .download(&dir, id, |progress| {
            let _ = app.emit("local-model-download-progress", progress);
        })
        .await?;
    if outcome == DownloadOutcome::Completed {
        let _ = app.emit("engine-config-changed", ());
    }
    Ok(outcome)
}

#[tauri::command]
pub fn cancel_local_model_download(state: State<'_, EngineState>, id: LocalModelId) {
    state.local.cancel_download(id);
}

#[tauri::command]
pub async fn delete_local_model(app: AppHandle, id: LocalModelId) -> EngineResult<()> {
    let dir = models_dir(&app)?;
    let handle = app.clone();
    blocking(move || handle.state::<EngineState>().local.delete(&dir, id)).await?;
    let _ = app.emit("engine-config-changed", ());
    Ok(())
}
