use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use rubato::{Resampler, SincFixedIn, SincInterpolationType, SincInterpolationParameters, WindowFunction};
use std::io::Cursor;
use hound::{WavWriter, WavSpec, SampleFormat};
use tauri::{AppHandle, Emitter};

// Target sample rate for output (Whisper is optimized for 16kHz)
const TARGET_SAMPLE_RATE: u32 = 16000;

/// Hard cap on a single recording, whatever the frontend's max duration says (R12).
/// 15 minutes of 48 kHz mono f32 is about 170 MB.
pub const MAX_RECORDING_SECONDS: u32 = 15 * 60;

// Silence detection settings (conservative to avoid cutting speech).
// 0.005 RMS is about -46 dBFS: above a typical mic noise floor, well below speech (R19).
const SILENCE_THRESHOLD: f32 = 0.005;
const MIN_SILENCE_DURATION_MS: u32 = 500;  // Only trim silence longer than 500ms
const SILENCE_PAD_MS: u32 = 200;           // Keep 200ms silence around speech for natural pauses

/// Events emitted to the webview while recording
pub const EVENT_RECORDING_ERROR: &str = "recording-error";
pub const EVENT_RECORDING_LIMIT: &str = "recording-limit-reached";

static AUDIO_SAMPLES: Mutex<AudioSamples> = Mutex::new(AudioSamples::new());
static SELECTED_DEVICE: Mutex<Option<String>> = Mutex::new(None);
static EVENTS: OnceLock<AppHandle> = OnceLock::new();
static AUDIO_THREAD: OnceLock<mpsc::Sender<Command>> = OnceLock::new();

// Current audio level (0.0 to 1.0) stored as u64 bits for atomic access
static CURRENT_AUDIO_LEVEL: AtomicU64 = AtomicU64::new(0);
// Peak audio level during current recording session
static PEAK_AUDIO_LEVEL: AtomicU64 = AtomicU64::new(0);

struct AudioSamples {
    samples: Vec<f32>,
    sample_rate: u32,
    is_recording: bool,
    /// Incremented each time a new recording starts; callbacks only write
    /// samples when their captured epoch matches the current one.  This
    /// prevents zombie CoreAudio callback threads (which may survive after
    /// their cpal::Stream is dropped on macOS) from inflating the buffer.
    recording_epoch: u64,
    /// Mono samples allowed before the hard cap
    max_samples: usize,
    /// The cap or a stream error was already reported for this recording
    reported: bool,
}

impl AudioSamples {
    const fn new() -> Self {
        Self {
            samples: Vec::new(),
            sample_rate: 0,
            is_recording: false,
            recording_epoch: 0,
            max_samples: 0,
            reported: false,
        }
    }
}

/// A finished recording. It stays in Rust (in `AppState`) until the next
/// recording starts; the engine reads it from there, so audio never crosses IPC.
#[derive(Default)]
pub struct Capture {
    /// 16 kHz mono samples with long silences trimmed
    pub samples_16k: Vec<f32>,
    /// Recording length before trimming, used for usage stats
    pub original_duration_seconds: f32,
    pub silence_trimmed_seconds: f32,
}

impl Capture {
    pub fn duration_seconds(&self) -> f32 {
        self.samples_16k.len() as f32 / TARGET_SAMPLE_RATE as f32
    }

    pub fn is_empty(&self) -> bool {
        self.samples_16k.is_empty()
    }

    /// 16-bit PCM WAV for providers. Encoded on demand rather than kept.
    pub fn to_wav(&self) -> Result<Vec<u8>, String> {
        encode_wav(&self.samples_16k, TARGET_SAMPLE_RATE)
    }
}

/// What `stop_recording` returns to the webview: metadata only.
#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub original_duration_seconds: f32,
    pub trimmed_duration_seconds: f32,
    pub silence_trimmed_seconds: f32,
}

impl From<&Capture> for CaptureInfo {
    fn from(capture: &Capture) -> Self {
        Self {
            original_duration_seconds: capture.original_duration_seconds,
            trimmed_duration_seconds: capture.duration_seconds(),
            silence_trimmed_seconds: capture.silence_trimmed_seconds,
        }
    }
}

/// Lets the audio callbacks tell the webview about device errors and the length cap.
pub fn init(app: AppHandle) {
    let _ = EVENTS.set(app);
}

fn emit<S: serde::Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = EVENTS.get() {
        let _ = app.emit(event, payload);
    }
}

/// Get the current audio level (0.0 to 1.0)
pub fn get_audio_level() -> f32 {
    let bits = CURRENT_AUDIO_LEVEL.load(Ordering::Relaxed);
    f64::from_bits(bits) as f32
}

/// Update the current audio level and track peak
fn set_audio_level(level: f32) {
    let clamped = level.clamp(0.0, 1.0);
    CURRENT_AUDIO_LEVEL.store((clamped as f64).to_bits(), Ordering::Relaxed);

    // Update peak if this level is higher
    let current_peak = f64::from_bits(PEAK_AUDIO_LEVEL.load(Ordering::Relaxed)) as f32;
    if clamped > current_peak {
        PEAK_AUDIO_LEVEL.store((clamped as f64).to_bits(), Ordering::Relaxed);
    }
}

/// Reset peak audio level (call when starting a new recording)
fn reset_peak_level() {
    PEAK_AUDIO_LEVEL.store(0u64, Ordering::Relaxed);
}

/// Get the peak audio level from the recording session
pub fn get_peak_level() -> f32 {
    f64::from_bits(PEAK_AUDIO_LEVEL.load(Ordering::Relaxed)) as f32
}

/// Check if the recording had significant audio (threshold is configurable)
pub fn has_voice_detected(threshold: f32) -> bool {
    get_peak_level() > threshold
}

pub fn set_device(device_name: Option<String>) -> Result<(), String> {
    let mut selected = SELECTED_DEVICE.lock().map_err(|e| e.to_string())?;
    *selected = device_name;
    Ok(())
}

pub fn list_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

    let device_names: Vec<String> = devices
        .filter_map(|d| d.name().ok())
        .collect();

    Ok(device_names)
}

fn get_selected_device() -> Result<cpal::Device, String> {
    let host = cpal::default_host();

    let selected_name = SELECTED_DEVICE.lock().map_err(|e| e.to_string())?.clone();

    if let Some(ref name) = selected_name {
        // Find the device by name
        let devices = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

        for device in devices {
            if let Ok(device_name) = device.name() {
                if &device_name == name {
                    return Ok(device);
                }
            }
        }
    }

    // Fall back to default
    host.default_input_device()
        .ok_or_else(|| "No input device available".to_string())
}

// The cpal stream isn't Send on every platform, so one dedicated thread owns it
// and the commands talk to that thread over a channel (R11).
enum Command {
    Start(mpsc::Sender<Result<(), String>>),
    Stop(mpsc::Sender<()>),
}

fn audio_thread() -> &'static mpsc::Sender<Command> {
    AUDIO_THREAD.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Command>();
        thread::Builder::new()
            .name("abe-audio".into())
            .spawn(move || {
                let mut stream: Option<cpal::Stream> = None;
                for command in rx {
                    match command {
                        Command::Start(reply) => {
                            stream = None;
                            let result = open_stream().map(|s| stream = Some(s));
                            let _ = reply.send(result);
                        }
                        Command::Stop(reply) => {
                            stream = None;
                            let _ = reply.send(());
                        }
                    }
                }
                drop(stream);
            })
            .expect("failed to spawn the audio thread");
        tx
    })
}

const AUDIO_THREAD_GONE: &str = "The audio thread stopped";

pub fn start_capture() -> Result<(), String> {
    let (reply, result) = mpsc::channel();
    audio_thread()
        .send(Command::Start(reply))
        .map_err(|_| AUDIO_THREAD_GONE.to_string())?;
    result.recv().map_err(|_| AUDIO_THREAD_GONE.to_string())?
}

/// Runs on the audio thread.
fn open_stream() -> Result<cpal::Stream, String> {
    let device = get_selected_device()?;

    // Use the device's default input config instead of forcing specific settings
    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {}", e))?;

    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels() as usize;
    let sample_format = supported_config.sample_format();
    let config = supported_config.config();

    // Clear previous samples and set recording state
    let epoch = {
        let mut audio = AUDIO_SAMPLES.lock().map_err(|e| e.to_string())?;
        audio.samples.clear();
        audio.sample_rate = sample_rate;
        audio.recording_epoch += 1;
        audio.max_samples = sample_rate as usize * MAX_RECORDING_SECONDS as usize;
        audio.reported = false;
        audio.is_recording = true;
        audio.recording_epoch
    };

    // Reset peak level for new recording
    reset_peak_level();

    // Devices don't all deliver f32: plenty of USB and Linux devices default to
    // i16 or i32 (R7). Convert everything to f32 in the callback.
    use cpal::SampleFormat as F;
    let stream = match sample_format {
        F::F32 => build_stream::<f32>(&device, &config, channels, epoch),
        F::F64 => build_stream::<f64>(&device, &config, channels, epoch),
        F::I8 => build_stream::<i8>(&device, &config, channels, epoch),
        F::I16 => build_stream::<i16>(&device, &config, channels, epoch),
        F::I32 => build_stream::<i32>(&device, &config, channels, epoch),
        F::I64 => build_stream::<i64>(&device, &config, channels, epoch),
        F::U8 => build_stream::<u8>(&device, &config, channels, epoch),
        F::U16 => build_stream::<u16>(&device, &config, channels, epoch),
        F::U32 => build_stream::<u32>(&device, &config, channels, epoch),
        F::U64 => build_stream::<u64>(&device, &config, channels, epoch),
        other => Err(format!("Unsupported input sample format: {}", other)),
    }
    .and_then(|stream| {
        stream.play().map_err(|e| format!("Failed to start stream: {}", e))?;
        Ok(stream)
    });

    if stream.is_err() {
        if let Ok(mut audio) = AUDIO_SAMPLES.lock() {
            audio.is_recording = false;
        }
    }
    stream
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    epoch: u64,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let mut converted: Vec<f32> = Vec::new();
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                convert_samples(data, &mut converted);
                handle_input(&converted, channels, epoch);
            },
            move |err| handle_stream_error(err, epoch),
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))
}

/// Convert any cpal sample type to f32 in [-1, 1], reusing `out`.
fn convert_samples<T>(data: &[T], out: &mut Vec<f32>)
where
    T: SizedSample,
    f32: FromSample<T>,
{
    out.clear();
    out.extend(data.iter().map(|&s| f32::from_sample_(s)));
}

/// Average interleaved channels into mono.
fn downmix_into(out: &mut Vec<f32>, data: &[f32], channels: usize) {
    if channels <= 1 {
        out.extend_from_slice(data);
    } else {
        for frame in data.chunks(channels) {
            out.push(frame.iter().sum::<f32>() / frame.len() as f32);
        }
    }
}

fn handle_input(data: &[f32], channels: usize, epoch: u64) {
    if data.is_empty() {
        return;
    }
    let limit_reached = {
        let Ok(mut audio) = AUDIO_SAMPLES.lock() else { return };
        if !audio.is_recording || audio.recording_epoch != epoch {
            return;
        }

        // RMS of 0.1 = full scale (typical speech is around -20dB to -6dB)
        let sum_squares: f32 = data.iter().map(|&s| s * s).sum();
        let rms = (sum_squares / data.len() as f32).sqrt();
        set_audio_level((rms * 10.0).min(1.0));

        if audio.samples.len() >= audio.max_samples {
            !std::mem::replace(&mut audio.reported, true)
        } else {
            downmix_into(&mut audio.samples, data, channels);
            false
        }
    };
    if limit_reached {
        emit(EVENT_RECORDING_LIMIT, MAX_RECORDING_SECONDS);
    }
}

/// A device that disappears mid-recording reports a stream error. Tell the
/// webview once, so it can stop and say so instead of recording silence (R13).
fn handle_stream_error(err: cpal::StreamError, epoch: u64) {
    eprintln!("[AUDIO] Stream error: {}", err);
    let first = AUDIO_SAMPLES
        .lock()
        .map(|mut audio| {
            audio.is_recording
                && audio.recording_epoch == epoch
                && !std::mem::replace(&mut audio.reported, true)
        })
        .unwrap_or(false);
    if first {
        let message = match err {
            cpal::StreamError::DeviceNotAvailable => "The microphone was disconnected".to_string(),
            other => format!("Microphone error: {}", other),
        };
        emit(EVENT_RECORDING_ERROR, message);
    }
}

/// Resample mono audio. Feeds fixed-size chunks and then flushes the resampler,
/// so the end of the recording isn't cut off, and drops the filter delay at the
/// start (R19).
fn resample_audio(samples: Vec<f32>, source_rate: u32, target_rate: u32) -> Result<Vec<f32>, String> {
    if source_rate == target_rate || samples.is_empty() {
        return Ok(samples);
    }

    const CHUNK: usize = 4096;
    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = target_rate as f64 / source_rate as f64;
    let mut resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, CHUNK, 1)
        .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let expected = (samples.len() as f64 * ratio).round() as usize;
    let delay = resampler.output_delay();
    let mut output = Vec::with_capacity(expected + delay + resampler.output_frames_max());
    let failed = |e: rubato::ResampleError| format!("Resampling failed: {}", e);

    let mut position = 0;
    while samples.len() - position >= CHUNK {
        let chunk = resampler
            .process(&[&samples[position..position + CHUNK]], None)
            .map_err(failed)?;
        output.extend_from_slice(&chunk[0]);
        position += CHUNK;
    }
    if position < samples.len() {
        let chunk = resampler
            .process_partial(Some(&[&samples[position..]]), None)
            .map_err(failed)?;
        output.extend_from_slice(&chunk[0]);
    }
    while output.len() < expected + delay {
        let chunk = resampler.process_partial::<&[f32]>(None, None).map_err(failed)?;
        if chunk[0].is_empty() {
            break;
        }
        output.extend_from_slice(&chunk[0]);
    }

    output.drain(..delay.min(output.len()));
    output.truncate(expected);
    Ok(output)
}

/// Trim silence from audio samples
/// Returns the trimmed samples along with time saved info
fn trim_silence(samples: &[f32], sample_rate: u32) -> (Vec<f32>, f32) {
    if samples.is_empty() {
        return (Vec::new(), 0.0);
    }

    let samples_per_ms = sample_rate as usize / 1000;
    let window_size = samples_per_ms * 20; // 20ms windows for RMS calculation
    let min_silence_samples = (MIN_SILENCE_DURATION_MS as usize) * samples_per_ms;
    let pad_samples = (SILENCE_PAD_MS as usize) * samples_per_ms;

    // Calculate RMS for each window
    let mut is_silent: Vec<bool> = Vec::with_capacity(samples.len() / window_size + 1);
    for chunk in samples.chunks(window_size) {
        let sum_squares: f32 = chunk.iter().map(|&s| s * s).sum();
        let rms = (sum_squares / chunk.len() as f32).sqrt();
        is_silent.push(rms < SILENCE_THRESHOLD);
    }

    // Find speech regions (non-silent windows)
    let mut speech_start = 0;
    let mut speech_end = is_silent.len();

    // Find first non-silent window
    for (i, &silent) in is_silent.iter().enumerate() {
        if !silent {
            speech_start = i;
            break;
        }
    }

    // Find last non-silent window
    for (i, &silent) in is_silent.iter().enumerate().rev() {
        if !silent {
            speech_end = i + 1;
            break;
        }
    }

    // Convert window indices back to sample indices with padding
    let start_sample = if speech_start > 0 {
        (speech_start * window_size).saturating_sub(pad_samples)
    } else {
        0
    };
    let end_sample = ((speech_end * window_size) + pad_samples).min(samples.len());

    let original_duration = samples.len() as f32 / sample_rate as f32;

    // Only trim if silence is longer than minimum threshold
    let effective_start = if start_sample >= min_silence_samples {
        start_sample
    } else {
        0
    };
    let effective_end = if (samples.len() - end_sample) >= min_silence_samples {
        end_sample
    } else {
        samples.len()
    };

    // Now compress long silence gaps in the middle
    let trimmed_edges = &samples[effective_start..effective_end];

    // For middle silence compression, we'll keep a small amount of each silent region
    let mut result = Vec::with_capacity(trimmed_edges.len());
    let mut in_silence = false;
    let mut silence_count = 0;
    let max_kept_silence = min_silence_samples; // Keep at most this much silence

    for chunk in trimmed_edges.chunks(window_size) {
        let sum_squares: f32 = chunk.iter().map(|&s| s * s).sum();
        let rms = (sum_squares / chunk.len() as f32).sqrt();
        let is_chunk_silent = rms < SILENCE_THRESHOLD;

        if is_chunk_silent {
            if !in_silence {
                in_silence = true;
                silence_count = 0;
            }
            silence_count += chunk.len();

            // Keep silence up to max threshold
            if silence_count <= max_kept_silence {
                result.extend_from_slice(chunk);
            }
            // Beyond threshold, we drop the chunk (compressing silence)
        } else {
            in_silence = false;
            silence_count = 0;
            result.extend_from_slice(chunk);
        }
    }

    let time_saved = original_duration - (result.len() as f32 / sample_rate as f32);

    (result, time_saved)
}

/// Encode audio samples to WAV format
fn encode_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut buffer, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        // Convert f32 samples to i16 for WAV
        for &sample in samples {
            let sample_i16 = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer.write_sample(sample_i16)
                .map_err(|e| format!("Failed to write WAV sample: {}", e))?;
        }

        writer.finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
    }

    Ok(buffer.into_inner())
}

/// Stop the stream and process what it recorded. Blocking: resampling a long
/// recording takes a while, so call this off the async runtime.
pub fn stop_capture() -> Result<Capture, String> {
    // Stop accepting samples and reset audio level
    {
        let mut audio = AUDIO_SAMPLES.lock().map_err(|e| e.to_string())?;
        audio.is_recording = false;
    }
    set_audio_level(0.0);

    // Drop the stream on the audio thread
    let (reply, done) = mpsc::channel();
    if audio_thread().send(Command::Stop(reply)).is_ok() {
        let _ = done.recv();
    }

    // Get samples and source sample rate
    let (samples, source_rate) = {
        let mut audio = AUDIO_SAMPLES.lock().map_err(|e| e.to_string())?;
        let samples = std::mem::take(&mut audio.samples);
        (samples, audio.sample_rate)
    };

    if samples.is_empty() || source_rate == 0 {
        return Ok(Capture::default());
    }

    // Calculate original duration before any processing
    let original_duration_seconds = samples.len() as f32 / source_rate as f32;

    // Resample to 16kHz if necessary
    let resampled = resample_audio(samples, source_rate, TARGET_SAMPLE_RATE)?;

    // Short recordings (<=5s) aren't worth trimming, and trimming could cut speech
    let (samples_16k, silence_trimmed_seconds) = if original_duration_seconds <= 5.0 {
        (resampled, 0.0)
    } else {
        trim_silence(&resampled, TARGET_SAMPLE_RATE)
    };

    Ok(Capture {
        samples_16k,
        original_duration_seconds,
        silence_trimmed_seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn converted<T>(data: &[T]) -> Vec<f32>
    where
        T: SizedSample,
        f32: FromSample<T>,
    {
        let mut out = Vec::new();
        convert_samples(data, &mut out);
        out
    }

    #[test]
    fn converts_integer_formats_to_unit_range() {
        assert_eq!(converted(&[0i16, i16::MIN]), vec![0.0, -1.0]);
        assert!((converted(&[i16::MAX])[0] - 1.0).abs() < 1e-4);
        assert_eq!(converted(&[32768u16, 0u16]), vec![0.0, -1.0]);
        assert_eq!(converted(&[128u8]), vec![0.0]);
        assert_eq!(converted(&[0i32, i32::MIN]), vec![0.0, -1.0]);
        assert!((converted(&[i32::MAX / 2])[0] - 0.5).abs() < 1e-4);
        assert_eq!(converted(&[0.25f32]), vec![0.25]);
        assert_eq!(converted(&[-0.5f64]), vec![-0.5]);
    }

    #[test]
    fn downmixes_interleaved_channels() {
        let mut out = Vec::new();
        downmix_into(&mut out, &[1.0, 0.0, 0.5, 0.5], 2);
        assert_eq!(out, vec![0.5, 0.5]);

        out.clear();
        downmix_into(&mut out, &[0.1, 0.2, 0.3], 1);
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn resampling_keeps_length_and_tail() {
        // One second at 48 kHz, silent except the last 20 ms
        let mut input = vec![0.0f32; 48_000];
        for (i, s) in input.iter_mut().enumerate().skip(48_000 - 960) {
            *s = (i as f32 * 0.05).sin() * 0.5;
        }
        let output = resample_audio(input, 48_000, 16_000).unwrap();
        assert_eq!(output.len(), 16_000);

        let tail_energy: f32 = output[16_000 - 320..].iter().map(|s| s * s).sum();
        let head_energy: f32 = output[..15_000].iter().map(|s| s * s).sum();
        assert!(tail_energy > 1.0, "tail was dropped: {}", tail_energy);
        assert!(head_energy < 1e-3, "delay not removed: {}", head_energy);
    }

    #[test]
    fn resampling_odd_lengths_and_rates() {
        let output = resample_audio(vec![0.1; 44_100 * 2 + 17], 44_100, 16_000).unwrap();
        assert_eq!(output.len(), ((44_100 * 2 + 17) as f64 * 16_000.0 / 44_100.0).round() as usize);
        assert_eq!(resample_audio(vec![0.2; 10], 16_000, 16_000).unwrap(), vec![0.2; 10]);
        assert!(resample_audio(Vec::new(), 48_000, 16_000).unwrap().is_empty());
    }

    #[test]
    fn trims_long_silence_but_keeps_speech() {
        let rate = 16_000;
        let speech: Vec<f32> = (0..rate).map(|i| (i as f32 * 0.1).sin() * 0.3).collect();
        let mut samples = vec![0.0005f32; rate * 2];
        samples.extend_from_slice(&speech);
        samples.extend(vec![0.0005f32; rate * 2]);

        let (trimmed, saved) = trim_silence(&samples, rate as u32);
        assert!(saved > 3.0, "saved {}", saved);
        assert!(trimmed.len() >= speech.len());
    }
}
