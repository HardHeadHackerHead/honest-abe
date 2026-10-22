/**
 * Transcription engine service.
 *
 * Thin wrapper around the Rust commands that do the actual work. Audio never
 * crosses IPC: `transcribe_recording` reads the capture buffer held in Rust
 * after `stop_recording`. API keys never enter the webview either; they are
 * stored and read by Rust only.
 *
 * Rust command contract (Tauri converts the camelCase invoke keys below to
 * snake_case parameter names; struct fields are camelCase via serde):
 *
 *   get_engine_status(config: EngineConfig) -> EngineStatus
 *   transcribe_recording(opts: TranscribeOptions) -> TranscribeResult
 *   transform_text(opts: TransformOptions) -> TransformResult
 *   set_api_key(provider: ProviderId, key: String) -> ()
 *   has_api_key(provider: ProviderId) -> bool
 *   delete_api_key(provider: ProviderId) -> ()
 *   test_api_key(provider: ProviderId, baseUrl: Option<String>) -> ()
 *   list_local_models() -> LocalModelInfo[]
 *   download_local_model(id: LocalModelId) -> 'completed' | 'cancelled'
 *     (emits 'local-model-download-progress' with DownloadProgress)
 *   cancel_local_model_download(id: LocalModelId) -> ()
 *   delete_local_model(id: LocalModelId) -> ()
 *
 * Failing commands reject with a ProviderErrorPayload ({ kind, message?, provider? }).
 */

import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  STORAGE_KEYS,
  GROQ_MIN_BILLED_SECONDS,
  TRANSCRIPTION_PRICES_PER_SECOND,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_TRANSCRIPTION_MODELS,
  DEFAULT_TRANSFORM_MODELS,
  DEFAULT_TRANSCRIPTION_LANGUAGE,
  DEFAULT_TRANSCRIPTION_STYLE,
} from '../constants';

export type EngineMode = 'local' | 'cloud';
export type ProviderId = 'openai' | 'groq' | 'custom';
export type LocalModelId = 'tiny' | 'base' | 'small' | 'large-v3-turbo';
export type TranscriptionStyle = 'formal' | 'balanced' | 'relaxed';

export type TransformPresetKey =
  | 'grammar'
  | 'formal'
  | 'casual'
  | 'concise'
  | 'expand'
  | 'bullets'
  | 'email'
  | 'code_comment'
  | 'summarize'
  | 'translate_spanish'
  | 'translate_french'
  | 'translate_german';

export interface ProviderEndpoint {
  provider: ProviderId;
  model: string;
  /** Only used when provider is 'custom' (OpenAI-compatible base URL). */
  baseUrl?: string;
}

/** Everything the user has configured. Built from localStorage. */
export interface EngineConfig {
  /** null until the user has picked how Abe transcribes. */
  mode: EngineMode | null;
  localModel: LocalModelId;
  transcription: ProviderEndpoint;
  transform: ProviderEndpoint;
}

export interface EngineStatus {
  ready: boolean;
  mode: EngineMode | 'none';
  /** Display name: "Groq", "Custom", "Local (base)" */
  provider?: string;
  /** Why the engine isn't ready, in words for the UI */
  detail?: string;
  /** The transform provider is configured (key stored, or a custom base URL) */
  transformReady: boolean;
}

export interface LocalModelInfo {
  id: LocalModelId;
  sizeBytes: number;
  downloaded: boolean;
  downloading: boolean;
}

export interface DownloadProgress {
  id: LocalModelId;
  downloaded: number;
  total: number;
  state: 'downloading' | 'verifying' | 'done' | 'cancelled' | 'error';
  /** Set when state is 'error' */
  message?: string;
}

export interface TranscribeOptions {
  mode: EngineMode;
  /** mode === 'local' */
  localModel?: LocalModelId;
  /** mode === 'cloud' */
  provider?: ProviderId;
  model?: string;
  baseUrl?: string;
  /** ISO 639-1 code, or 'auto' to let the engine detect it. */
  language: string;
  style: TranscriptionStyle;
}

export interface TranscribeResult {
  text: string;
  /** Length of the recording, for usage stats */
  durationSeconds: number;
  /** Length of the audio actually transcribed (long silences trimmed), for cost estimates */
  audioSeconds: number;
}

export interface TransformOptions extends ProviderEndpoint {
  text: string;
  instruction: string;
  preset?: TransformPresetKey;
  /** The user's standing transform prompt (Settings), prepended by Rust */
  customPrompt?: string;
}

export interface TransformResult {
  text: string;
  /** Set when the spoken instruction matched a preset */
  preset?: TransformPresetKey;
}

export type EngineErrorKind =
  | 'invalid_key'
  | 'rate_limited'
  | 'insufficient_quota'
  | 'network'
  | 'timeout'
  | 'too_large'
  | 'model_missing'
  | 'unknown';

/** Shape of the error Rust rejects with. */
export interface ProviderErrorPayload {
  kind: EngineErrorKind;
  message?: string;
  provider?: string;
}

const ERROR_KINDS: EngineErrorKind[] = [
  'invalid_key', 'rate_limited', 'insufficient_quota', 'network',
  'timeout', 'too_large', 'model_missing', 'unknown',
];

const ERROR_MESSAGES: Record<EngineErrorKind, string> = {
  invalid_key: 'Your API key was rejected. Check it in Settings.',
  rate_limited: 'The provider is rate limiting you. Try again in a moment.',
  insufficient_quota: 'Your provider account is out of credit. Add credit or check your spend limit.',
  network: "Couldn't reach the provider. Check your connection.",
  timeout: 'The provider took too long to respond. Try again.',
  too_large: 'This recording is too long for the provider. Try a shorter one, or local mode.',
  model_missing: 'The selected model is not available. Check Settings.',
  unknown: 'Transcription failed.',
};

/** Error kinds the user fixes in Settings (shown with an "Open Settings" action). */
const SETTINGS_KINDS: EngineErrorKind[] = ['invalid_key', 'model_missing', 'insufficient_quota'];

export class EngineError extends Error {
  kind: EngineErrorKind;
  provider?: string;

  constructor(kind: EngineErrorKind, message?: string, provider?: string) {
    super(message || ERROR_MESSAGES[kind]);
    this.name = 'EngineError';
    this.kind = kind;
    this.provider = provider;
  }

  /**
   * Message suitable for the UI. Known kinds use our wording; unknown and
   * too_large keep Rust's more specific message when there is one.
   */
  get userMessage(): string {
    if (this.kind === 'unknown' || this.kind === 'too_large') return this.message;
    // Rust includes the provider's Retry-After wait when there is one
    if (this.kind === 'rate_limited' && /Try again in \d+ seconds/.test(this.message)) return this.message;
    return ERROR_MESSAGES[this.kind];
  }

  /** The fix is in Settings (key, model or provider account). */
  get pointsToSettings(): boolean {
    return SETTINGS_KINDS.includes(this.kind);
  }
}

/**
 * Estimated list-price cost of one transcription in USD. Local mode is free;
 * custom providers and unknown models aren't estimated (0).
 */
export function estimateTranscriptionCost(config: EngineConfig, audioSeconds: number): number {
  if (config.mode !== 'cloud') return 0;
  const { provider, model } = config.transcription;
  const perSecond = TRANSCRIPTION_PRICES_PER_SECOND[provider]?.[model];
  if (!perSecond) return 0;
  const billed = provider === 'groq' ? Math.max(audioSeconds, GROQ_MIN_BILLED_SECONDS) : audioSeconds;
  return billed * perSecond;
}

/** Second line for the overlay: how to fix the error. */
export function engineErrorHint(error: EngineError): string | undefined {
  if (error.pointsToSettings) return 'Open Abe to fix it in Settings.';
  if (error.kind === 'network') return 'Local mode works without internet.';
  return undefined;
}

/** Normalize anything a failed invoke can reject with into an EngineError. */
export function toEngineError(err: unknown): EngineError {
  if (err instanceof EngineError) return err;
  if (err && typeof err === 'object' && 'kind' in err) {
    const payload = err as ProviderErrorPayload;
    const kind = ERROR_KINDS.includes(payload.kind) ? payload.kind : 'unknown';
    return new EngineError(kind, payload.message, payload.provider);
  }
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  // Until the Rust side exists, invoke rejects with "command ... not found"
  if (/not found/i.test(message) && /command/i.test(message)) {
    return new EngineError('unknown', 'Transcription engine is not available in this build.');
  }
  return new EngineError('unknown', message || undefined);
}

const NOT_READY: EngineStatus = { ready: false, mode: 'none', transformReady: false };

function read(key: string): string | null {
  return localStorage.getItem(key);
}

function endpoint(providerKey: string, modelKey: string, baseUrlKey: string, defaults: Record<string, string>): ProviderEndpoint {
  const provider = (read(providerKey) as ProviderId) || DEFAULT_PROVIDER as ProviderId;
  const baseUrl = provider === 'custom' ? read(baseUrlKey) || undefined : undefined;
  return { provider, model: read(modelKey) || defaults[provider], baseUrl };
}

export const engine = {
  getConfig(): EngineConfig {
    const mode = read(STORAGE_KEYS.ENGINE_MODE);
    return {
      mode: mode === 'local' || mode === 'cloud' ? mode : null,
      localModel: (read(STORAGE_KEYS.LOCAL_MODEL) as LocalModelId) || DEFAULT_LOCAL_MODEL as LocalModelId,
      transcription: endpoint(
        STORAGE_KEYS.TRANSCRIPTION_PROVIDER, STORAGE_KEYS.TRANSCRIPTION_MODEL,
        STORAGE_KEYS.TRANSCRIPTION_BASE_URL, DEFAULT_TRANSCRIPTION_MODELS,
      ),
      transform: endpoint(
        STORAGE_KEYS.TRANSFORM_PROVIDER, STORAGE_KEYS.TRANSFORM_MODEL,
        STORAGE_KEYS.TRANSFORM_BASE_URL, DEFAULT_TRANSFORM_MODELS,
      ),
    };
  },

  /** Ask Rust whether the configured engine can transcribe right now. Never throws. */
  async getStatus(): Promise<EngineStatus> {
    const config = this.getConfig();
    try {
      return await invoke<EngineStatus>('get_engine_status', { config });
    } catch (err) {
      console.warn('[Engine] get_engine_status failed:', toEngineError(err).message);
      return NOT_READY;
    }
  },

  /** Transcribe the most recent capture (call after stop_recording). */
  async transcribeRecording(): Promise<TranscribeResult> {
    const config = this.getConfig();
    if (!config.mode) throw new EngineError('unknown', 'No transcription engine configured.');
    const opts: TranscribeOptions = {
      mode: config.mode,
      language: read(STORAGE_KEYS.TRANSCRIPTION_LANGUAGE) || DEFAULT_TRANSCRIPTION_LANGUAGE,
      style: (read(STORAGE_KEYS.TRANSCRIPTION_STYLE) as TranscriptionStyle) || DEFAULT_TRANSCRIPTION_STYLE as TranscriptionStyle,
      ...(config.mode === 'local'
        ? { localModel: config.localModel }
        : config.transcription),
    };
    try {
      return await invoke<TranscribeResult>('transcribe_recording', { opts });
    } catch (err) {
      throw toEngineError(err);
    }
  },

  async transformText(text: string, instruction: string, preset?: TransformPresetKey): Promise<TransformResult> {
    const customPrompt = read(STORAGE_KEYS.TRANSFORM_PROMPT)?.trim() || undefined;
    const opts: TransformOptions = { ...this.getConfig().transform, text, instruction, preset, customPrompt };
    try {
      return await invoke<TransformResult>('transform_text', { opts });
    } catch (err) {
      throw toEngineError(err);
    }
  },

  async setApiKey(provider: ProviderId, key: string): Promise<void> {
    try {
      await invoke('set_api_key', { provider, key });
    } catch (err) {
      throw toEngineError(err);
    }
    await this.notifyConfigChanged();
  },

  async hasApiKey(provider: ProviderId): Promise<boolean> {
    try {
      return await invoke<boolean>('has_api_key', { provider });
    } catch {
      return false;
    }
  },

  async deleteApiKey(provider: ProviderId): Promise<void> {
    try {
      await invoke('delete_api_key', { provider });
    } catch (err) {
      throw toEngineError(err);
    }
    await this.notifyConfigChanged();
  },

  async testApiKey(provider: ProviderId, baseUrl?: string): Promise<void> {
    try {
      await invoke('test_api_key', { provider, baseUrl });
    } catch (err) {
      throw toEngineError(err);
    }
  },

  async listLocalModels(): Promise<LocalModelInfo[]> {
    try {
      return await invoke<LocalModelInfo[]>('list_local_models');
    } catch (err) {
      console.warn('[Engine] list_local_models failed:', toEngineError(err).message);
      return [];
    }
  },

  /** Resolves when the download finishes or is cancelled. Progress arrives as events. */
  async downloadLocalModel(id: LocalModelId): Promise<'completed' | 'cancelled'> {
    try {
      return await invoke<'completed' | 'cancelled'>('download_local_model', { id });
    } catch (err) {
      throw toEngineError(err);
    }
  },

  async cancelLocalModelDownload(id: LocalModelId): Promise<void> {
    await invoke('cancel_local_model_download', { id }).catch(() => {});
  },

  async deleteLocalModel(id: LocalModelId): Promise<void> {
    try {
      await invoke('delete_local_model', { id });
    } catch (err) {
      throw toEngineError(err);
    }
  },

  onDownloadProgress(handler: (progress: DownloadProgress) => void): Promise<UnlistenFn> {
    return listen<DownloadProgress>('local-model-download-progress', (event) => handler(event.payload));
  },

  /** Tell every window to re-check engine status after a settings change. */
  async notifyConfigChanged(): Promise<void> {
    await emit('engine-config-changed', {});
  },
};
