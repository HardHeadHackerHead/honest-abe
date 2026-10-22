//! Offline transcription with whisper.cpp (via whisper-rs). Models are the
//! multilingual GGML files from huggingface.co/ggerganov/whisper.cpp, pinned
//! by SHA-256, downloaded into `<app data>/models/` on request.

use super::error::{from_reqwest, EngineError, EngineResult, ErrorKind};
use super::prompts::TranscriptionStyle;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
/// Whisper needs at least a second of audio; shorter clips are padded with silence.
const MIN_SAMPLES: usize = 16_000;
const MAX_THREADS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LocalModelId {
    #[serde(rename = "tiny")]
    Tiny,
    #[serde(rename = "base")]
    Base,
    #[serde(rename = "small")]
    Small,
    #[serde(rename = "large-v3-turbo")]
    LargeV3Turbo,
}

pub struct ModelSpec {
    pub id: LocalModelId,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// Sizes and SHA-256 hashes from the Hugging Face LFS metadata
/// (`/api/models/ggerganov/whisper.cpp/tree/main`, `lfs.oid`), 2026-10-22.
pub const MODELS: [ModelSpec; 4] = [
    ModelSpec {
        id: LocalModelId::Tiny,
        file: "ggml-tiny.bin",
        size: 77_691_713,
        sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    },
    ModelSpec {
        id: LocalModelId::Base,
        file: "ggml-base.bin",
        size: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    },
    ModelSpec {
        id: LocalModelId::Small,
        file: "ggml-small.bin",
        size: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    },
    ModelSpec {
        id: LocalModelId::LargeV3Turbo,
        file: "ggml-large-v3-turbo.bin",
        size: 1_624_555_275,
        sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    },
];

impl LocalModelId {
    pub fn spec(self) -> &'static ModelSpec {
        MODELS.iter().find(|m| m.id == self).expect("every model id has a spec")
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tiny => "tiny",
            Self::Base => "base",
            Self::Small => "small",
            Self::LargeV3Turbo => "large-v3-turbo",
        }
    }
}

impl ModelSpec {
    pub fn path(&self, models_dir: &Path) -> PathBuf {
        models_dir.join(self.file)
    }

    fn part_path(&self, models_dir: &Path) -> PathBuf {
        models_dir.join(format!("{}.part", self.file))
    }

    /// Written after a successful hash check so later checks only compare sizes.
    fn verified_marker(&self, models_dir: &Path) -> PathBuf {
        models_dir.join(format!("{}.sha256", self.file))
    }

    fn url(&self) -> String {
        format!("{MODEL_BASE_URL}/{}", self.file)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelInfo {
    pub id: LocalModelId,
    pub size_bytes: u64,
    pub downloaded: bool,
    pub downloading: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: LocalModelId,
    pub downloaded: u64,
    pub total: u64,
    /// downloading | verifying | done | cancelled | error
    pub state: &'static str,
    /// Set when state is "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl DownloadProgress {
    fn new(id: LocalModelId, downloaded: u64, state: &'static str) -> Self {
        Self { id, downloaded, total: id.spec().size, state, message: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadOutcome {
    Completed,
    Cancelled,
}

/// Whether the model file is present and verified. A file that has the right
/// size but was never verified (e.g. copied in by hand) is hashed once.
pub fn is_downloaded(models_dir: &Path, id: LocalModelId) -> bool {
    let spec = id.spec();
    let path = spec.path(models_dir);
    let Ok(meta) = std::fs::metadata(&path) else { return false };
    if meta.len() != spec.size {
        return false;
    }
    let marker = spec.verified_marker(models_dir);
    if std::fs::read_to_string(&marker).map(|h| h.trim() == spec.sha256).unwrap_or(false) {
        return true;
    }
    match sha256_file(&path) {
        Ok(hash) if hash == spec.sha256 => {
            let _ = std::fs::write(&marker, spec.sha256);
            true
        }
        _ => false,
    }
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Model downloads in flight and the loaded Whisper context.
#[derive(Default)]
pub struct LocalEngine {
    downloads: Mutex<std::collections::HashMap<LocalModelId, Arc<AtomicBool>>>,
    loaded: Mutex<Option<(LocalModelId, Arc<WhisperContext>)>>,
}

impl LocalEngine {
    pub fn is_downloading(&self, id: LocalModelId) -> bool {
        self.downloads.lock().map(|d| d.contains_key(&id)).unwrap_or(false)
    }

    fn downloading_ids(&self) -> HashSet<LocalModelId> {
        self.downloads.lock().map(|d| d.keys().copied().collect()).unwrap_or_default()
    }

    pub fn list(&self, models_dir: &Path) -> Vec<LocalModelInfo> {
        let downloading = self.downloading_ids();
        MODELS
            .iter()
            .map(|spec| LocalModelInfo {
                id: spec.id,
                size_bytes: spec.size,
                downloaded: !downloading.contains(&spec.id) && is_downloaded(models_dir, spec.id),
                downloading: downloading.contains(&spec.id),
            })
            .collect()
    }

    pub fn cancel_download(&self, id: LocalModelId) {
        if let Ok(downloads) = self.downloads.lock() {
            if let Some(flag) = downloads.get(&id) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Download, verify and install a model. `on_progress` is throttled.
    pub async fn download(
        &self,
        models_dir: &Path,
        id: LocalModelId,
        on_progress: impl Fn(DownloadProgress),
    ) -> EngineResult<DownloadOutcome> {
        let cancel = {
            let mut downloads = self.downloads.lock().map_err(|_| EngineError::unknown("Download state is unavailable."))?;
            if downloads.contains_key(&id) {
                return Err(EngineError::unknown("This model is already downloading."));
            }
            let flag = Arc::new(AtomicBool::new(false));
            downloads.insert(id, flag.clone());
            flag
        };

        let result = download_file(models_dir, id.spec(), &cancel, &on_progress).await;

        if let Ok(mut downloads) = self.downloads.lock() {
            downloads.remove(&id);
        }
        let last = match &result {
            Ok(DownloadOutcome::Completed) => DownloadProgress::new(id, id.spec().size, "done"),
            Ok(DownloadOutcome::Cancelled) => DownloadProgress::new(id, 0, "cancelled"),
            Err(err) => DownloadProgress {
                message: Some(err.message.clone().unwrap_or_else(|| "The download failed.".into())),
                ..DownloadProgress::new(id, 0, "error")
            },
        };
        on_progress(last);
        result
    }

    pub fn delete(&self, models_dir: &Path, id: LocalModelId) -> EngineResult<()> {
        self.cancel_download(id);
        self.unload_if(id);
        let spec = id.spec();
        for path in [spec.path(models_dir), spec.part_path(models_dir), spec.verified_marker(models_dir)] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(EngineError::unknown(format!("Couldn't delete the model: {e}"))),
            }
        }
        Ok(())
    }

    fn unload_if(&self, id: LocalModelId) {
        if let Ok(mut loaded) = self.loaded.lock() {
            if loaded.as_ref().is_some_and(|(loaded_id, _)| *loaded_id == id) {
                *loaded = None;
            }
        }
    }

    /// The cached context for `id`, loading it (and dropping any other model) if needed.
    fn context(&self, models_dir: &Path, id: LocalModelId) -> EngineResult<Arc<WhisperContext>> {
        let mut loaded = self.loaded.lock().map_err(|_| EngineError::unknown("Whisper state is unavailable."))?;
        if let Some((loaded_id, ctx)) = loaded.as_ref() {
            if *loaded_id == id {
                return Ok(ctx.clone());
            }
        }
        // Free the old model before loading the new one
        *loaded = None;

        if self.is_downloading(id) || !is_downloaded(models_dir, id) {
            return Err(EngineError::new(
                ErrorKind::ModelMissing,
                format!("The {} model isn't downloaded yet. Download it in Settings.", id.as_str()),
            ));
        }
        install_logging_hooks();
        let path = id.spec().path(models_dir);
        let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
            .map_err(|e| EngineError::unknown(format!("Couldn't load the Whisper model: {e}")))?;
        let ctx = Arc::new(ctx);
        *loaded = Some((id, ctx.clone()));
        Ok(ctx)
    }

    /// Blocking: run on a worker thread.
    pub fn transcribe(
        &self,
        models_dir: &Path,
        id: LocalModelId,
        samples_16k: &[f32],
        language: &str,
        style: TranscriptionStyle,
    ) -> EngineResult<String> {
        let ctx = self.context(models_dir, id)?;
        transcribe_with(&ctx, samples_16k, language, style)
    }
}

fn install_logging_hooks() {
    // Silences whisper.cpp's stderr logging (no log backend is enabled)
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(whisper_rs::install_logging_hooks);
}

pub fn thread_count() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(MAX_THREADS)
}

/// whisper.cpp language code, or None for auto-detect. Unknown codes fall back to auto.
fn whisper_language(language: &str) -> Option<String> {
    let language = language.trim().to_lowercase();
    if language.is_empty() || language == "auto" {
        return None;
    }
    whisper_rs::get_lang_id(&language).map(|_| language)
}

pub fn transcribe_with(
    ctx: &WhisperContext,
    samples_16k: &[f32],
    language: &str,
    style: TranscriptionStyle,
) -> EngineResult<String> {
    let mut samples = samples_16k.to_vec();
    if samples.len() < MIN_SAMPLES {
        samples.resize(MIN_SAMPLES, 0.0);
    }

    let mut state = ctx
        .create_state()
        .map_err(|e| EngineError::unknown(format!("Couldn't start Whisper: {e}")))?;

    let language = whisper_language(language);
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language.as_deref().unwrap_or("auto")));
    params.set_n_threads(thread_count() as i32);
    params.set_initial_prompt(style.prompt());
    params.set_no_context(true);
    params.set_suppress_nst(true);
    params.set_token_timestamps(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, &samples)
        .map_err(|e| EngineError::unknown(format!("Local transcription failed: {e}")))?;

    let segments: Vec<String> = state
        .as_iter()
        .filter_map(|segment| segment.to_str_lossy().ok().map(|s| s.trim().to_string()))
        .collect();
    Ok(style.post_process(&join_segments(&segments)))
}

/// Join segment texts, dropping non-speech markers like `[BLANK_AUDIO]` or `(music)`.
fn join_segments<S: AsRef<str>>(segments: &[S]) -> String {
    segments
        .iter()
        .map(|s| s.as_ref().trim())
        .filter(|s| !s.is_empty() && !is_non_speech_marker(s))
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_non_speech_marker(segment: &str) -> bool {
    let bracketed = |open: char, close: char| {
        segment.starts_with(open) && segment.ends_with(close) && segment[1..segment.len() - 1].chars().all(|c| c != open && c != close)
    };
    bracketed('[', ']') || bracketed('(', ')') || segment.chars().all(|c| c == '*' || c == '♪' || c.is_whitespace())
}

/// Client for model downloads: no overall timeout (files are up to 1.6 GB),
/// but a stalled connection fails after 30 s without data.
fn download_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        super::cloud::install_crypto_provider();
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .user_agent(concat!("Abe/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("failed to build HTTP client")
    })
}

async fn download_file(
    models_dir: &Path,
    spec: &ModelSpec,
    cancel: &AtomicBool,
    on_progress: &impl Fn(DownloadProgress),
) -> EngineResult<DownloadOutcome> {
    std::fs::create_dir_all(models_dir)
        .map_err(|e| EngineError::unknown(format!("Couldn't create the models folder: {e}")))?;
    let part = spec.part_path(models_dir);
    let _ = std::fs::remove_file(&part);

    let result = stream_to_file(spec, &part, cancel, on_progress).await;
    match result {
        Ok(DownloadOutcome::Completed) => {
            let target = spec.path(models_dir);
            std::fs::rename(&part, &target)
                .map_err(|e| EngineError::unknown(format!("Couldn't save the model: {e}")))?;
            let _ = std::fs::write(spec.verified_marker(models_dir), spec.sha256);
            Ok(DownloadOutcome::Completed)
        }
        other => {
            let _ = std::fs::remove_file(&part);
            other
        }
    }
}

async fn stream_to_file(
    spec: &ModelSpec,
    part: &Path,
    cancel: &AtomicBool,
    on_progress: &impl Fn(DownloadProgress),
) -> EngineResult<DownloadOutcome> {
    let response = download_client()
        .get(spec.url())
        .send()
        .await
        .map_err(|e| from_reqwest(&e))?;
    if !response.status().is_success() {
        return Err(EngineError::new(
            ErrorKind::Network,
            format!("The model download failed (HTTP {}).", response.status().as_u16()),
        ));
    }

    let mut file = std::fs::File::create(part)
        .map_err(|e| EngineError::unknown(format!("Couldn't write the model file: {e}")))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut stream = response.bytes_stream();

    on_progress(DownloadProgress::new(spec.id, 0, "downloading"));
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            return Ok(DownloadOutcome::Cancelled);
        }
        let chunk = chunk.map_err(|e| from_reqwest(&e))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| EngineError::unknown(format!("Couldn't write the model file: {e}")))?;
        downloaded += chunk.len() as u64;
        if downloaded > spec.size {
            return Err(EngineError::unknown("The model download is larger than expected."));
        }
        if last_emit.elapsed() >= Duration::from_millis(200) {
            last_emit = Instant::now();
            on_progress(DownloadProgress::new(spec.id, downloaded, "downloading"));
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(DownloadOutcome::Cancelled);
    }
    file.flush().map_err(|e| EngineError::unknown(format!("Couldn't write the model file: {e}")))?;
    drop(file);

    on_progress(DownloadProgress::new(spec.id, downloaded, "verifying"));
    let hash = hex(&hasher.finalize());
    if downloaded != spec.size || hash != spec.sha256 {
        return Err(EngineError::unknown("The downloaded model failed its integrity check. Try again."));
    }
    Ok(DownloadOutcome::Completed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_ids_match_frontend() {
        assert_eq!(serde_json::to_string(&LocalModelId::LargeV3Turbo).unwrap(), "\"large-v3-turbo\"");
        let id: LocalModelId = serde_json::from_str("\"base\"").unwrap();
        assert_eq!(id, LocalModelId::Base);
        for spec in &MODELS {
            assert_eq!(spec.id.spec().file, spec.file);
            assert_eq!(spec.sha256.len(), 64);
            assert!(spec.url().starts_with("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-"));
        }
    }

    #[test]
    fn missing_or_wrong_size_files_are_not_downloaded() {
        let dir = std::env::temp_dir().join(format!("abe-models-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!is_downloaded(&dir, LocalModelId::Tiny));
        std::fs::write(LocalModelId::Tiny.spec().path(&dir), b"not a model").unwrap();
        assert!(!is_downloaded(&dir, LocalModelId::Tiny));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn hashes_files() {
        let path = std::env::temp_dir().join(format!("abe-hash-test-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn languages() {
        assert_eq!(whisper_language("auto"), None);
        assert_eq!(whisper_language(""), None);
        assert_eq!(whisper_language("EN").as_deref(), Some("en"));
        assert_eq!(whisper_language("de").as_deref(), Some("de"));
        assert_eq!(whisper_language("xx"), None);
    }

    #[test]
    fn joins_segments_and_drops_markers() {
        assert_eq!(join_segments(&[" Hello there.", " How are you?"]), "Hello there. How are you?");
        assert_eq!(join_segments(&["[BLANK_AUDIO]"]), "");
        assert_eq!(join_segments(&["(music)", " Hi.", "[ Silence ]", "♪ ♪"]), "Hi.");
        assert_eq!(join_segments(&["[1] is a footnote"]), "[1] is a footnote");
    }

    #[test]
    fn threads_are_capped() {
        let n = thread_count();
        assert!((1..=MAX_THREADS).contains(&n));
    }

    /// Downloads and verifies the tiny model into ABE_TEST_MODEL_DIR (network, ~75 MB).
    #[tokio::test]
    #[ignore]
    async fn download_tiny_model() {
        let dir = PathBuf::from(std::env::var("ABE_TEST_MODEL_DIR").expect("set ABE_TEST_MODEL_DIR"));
        let engine = LocalEngine::default();
        let events = Mutex::new(Vec::new());
        let outcome = engine
            .download(&dir, LocalModelId::Tiny, |p| events.lock().unwrap().push((p.state, p.downloaded)))
            .await
            .unwrap();
        assert_eq!(outcome, DownloadOutcome::Completed);
        let events = events.into_inner().unwrap();
        println!("{} progress events, last {:?}", events.len(), events.last());
        assert_eq!(events.last(), Some(&("done", LocalModelId::Tiny.spec().size)));
        assert!(events.iter().any(|(state, _)| *state == "verifying"));
        assert!(is_downloaded(&dir, LocalModelId::Tiny));
        assert!(engine.list(&dir).iter().any(|m| m.id == LocalModelId::Tiny && m.downloaded));
    }

    /// Runs real inference when ABE_TEST_MODEL_DIR holds ggml-tiny.bin.
    #[test]
    fn local_inference_smoke() {
        let Ok(dir) = std::env::var("ABE_TEST_MODEL_DIR") else { return };
        let engine = LocalEngine::default();
        let dir = PathBuf::from(dir);
        // Half a second of a 440 Hz tone: must be padded and must not error
        let tone: Vec<f32> = (0..8000).map(|i| (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / 16_000.0).sin() * 0.1).collect();
        let text = engine.transcribe(&dir, LocalModelId::Tiny, &tone, "auto", TranscriptionStyle::Balanced).unwrap();
        println!("tone -> {text:?}");
        if let Ok(wav) = std::env::var("ABE_TEST_WAV") {
            let mut reader = hound::WavReader::open(wav).unwrap();
            let samples: Vec<f32> = reader.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
            let start = Instant::now();
            let text = engine.transcribe(&dir, LocalModelId::Tiny, &samples, "en", TranscriptionStyle::Balanced).unwrap();
            println!("wav -> {text:?} in {:?}", start.elapsed());
            assert!(!text.is_empty());
        }
    }
}
