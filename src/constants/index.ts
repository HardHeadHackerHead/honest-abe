// Project links
export const GITHUB_REPO_URL = 'https://github.com/HardHeadHackerHead/honest-abe';
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`;
export const WEBSITE_URL = 'https://getabe.app';

// TODO: replace with the real Stripe Payment Link once it exists. This is the only place the donate URL lives.
export const DONATE_URL = 'https://donate.stripe.com/REPLACE_ME';

// Audio constants
export const AUDIO_FREQUENCIES = {
  START: 880,  // High beep
  STOP: 440,   // Lower beep
} as const;

export const AUDIO_DURATIONS = {
  START: 0.1,
  STOP: 0.15,
} as const;

// LocalStorage keys
export const STORAGE_KEYS = {
  AUDIO_DEVICE: 'abe_audio_device',
  HOTKEY: 'abe_hotkey',
  PASTE_LAST_HOTKEY: 'abe_paste_last_hotkey',
  TRANSFORM_HOTKEY: 'abe_transform_hotkey',
  PUSH_TO_TALK: 'abe_push_to_talk',
  SOUND_ENABLED: 'abe_sound_enabled',
  OVERLAY_ENABLED: 'abe_overlay_enabled',
  MIN_DURATION: 'abe_min_duration',
  MAX_DURATION: 'abe_max_duration',
  OTHER_APPS_VOLUME: 'abe_other_apps_volume',
  ONBOARDING_COMPLETED: 'abe_onboarding_completed',
  USAGE_STATS: 'abe_usage_stats',

  // Output
  TRANSCRIPTION_STYLE: 'abe_transcription_style',
  TRANSCRIPTION_LANGUAGE: 'abe_transcription_language',
  OUTPUT_MODE: 'abe_output_mode',
  TYPING_SPEED: 'abe_typing_speed',
  TRANSFORM_PROMPT: 'abe_transform_prompt',

  // Transcription engine (read by services/engine.ts and passed to the Rust commands)
  ENGINE_MODE: 'abe_engine_mode',                         // 'local' | 'cloud'
  LOCAL_MODEL: 'abe_local_model',                         // LocalModelId
  TRANSCRIPTION_PROVIDER: 'abe_transcription_provider',   // ProviderId
  TRANSCRIPTION_MODEL: 'abe_transcription_model',         // free-form model id
  TRANSCRIPTION_BASE_URL: 'abe_transcription_base_url',   // only for 'custom'
  TRANSFORM_PROVIDER: 'abe_transform_provider',           // ProviderId
  TRANSFORM_MODEL: 'abe_transform_model',                 // free-form model id
  TRANSFORM_BASE_URL: 'abe_transform_base_url',           // only for 'custom'
} as const;

// Default hotkey values
export const DEFAULT_HOTKEY = 'Control+Alt+Space';
export const DEFAULT_PASTE_LAST_HOTKEY = 'Control+Alt+V';
export const DEFAULT_TRANSFORM_HOTKEY = 'Control+Alt+T';

// Recording defaults
export const DEFAULT_PUSH_TO_TALK = true;
export const DEFAULT_SOUND_ENABLED = true;
export const DEFAULT_OVERLAY_ENABLED = true;
export const DEFAULT_MIN_DURATION = 0; // seconds
export const DEFAULT_MAX_DURATION = 300; // 5 minutes
export const DEFAULT_OTHER_APPS_VOLUME = 20; // reduce other apps to 20%

// Output defaults
export const DEFAULT_TRANSCRIPTION_STYLE = 'balanced';
export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'en';
export const DEFAULT_OUTPUT_MODE = 'instant';
export const DEFAULT_TYPING_SPEED = 1500;

// Transcription engine defaults
export const DEFAULT_LOCAL_MODEL = 'base';
export const DEFAULT_PROVIDER = 'groq';
export const DEFAULT_TRANSCRIPTION_MODELS: Record<string, string> = {
  openai: 'gpt-transcribe',
  groq: 'whisper-large-v3-turbo',
  custom: 'whisper-1',
};
export const DEFAULT_TRANSFORM_MODELS: Record<string, string> = {
  openai: 'gpt-6-luna',
  groq: 'openai/gpt-oss-120b',
  custom: 'gpt-oss:20b',
};

// Model choices offered per provider (custom takes any model name)
export const TRANSCRIPTION_MODEL_OPTIONS: Record<string, { id: string; label: string }[]> = {
  groq: [
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (recommended)' },
    { id: 'whisper-large-v3', label: 'Whisper Large v3 (more accurate, pricier)' },
  ],
  openai: [
    { id: 'gpt-transcribe', label: 'GPT Transcribe (recommended)' },
    { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe (deprecated)' },
    { id: 'whisper-1', label: 'Whisper (deprecated)' },
  ],
};
export const TRANSFORM_MODEL_OPTIONS: Record<string, { id: string; label: string }[]> = {
  groq: [
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (recommended)' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (cheaper, faster)' },
  ],
  openai: [
    { id: 'gpt-6-luna', label: 'GPT-6 Luna (recommended)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini (deprecated)' },
  ],
};

// Step-by-step guides on the website for getting a key
export const API_KEY_DOCS_URLS: Record<string, string> = {
  groq: `${WEBSITE_URL}/docs/api-keys/groq`,
  openai: `${WEBSITE_URL}/docs/api-keys/openai`,
  custom: `${WEBSITE_URL}/docs/api-keys/custom`,
};

// Local Whisper models (sizes come from Rust; these are the descriptions)
export const LOCAL_MODEL_INFO: Record<string, { label: string; hint: string; speed: number; quality: number }> = {
  tiny: { label: 'Tiny', hint: 'Fastest. Fine for short, clear English.', speed: 4, quality: 1 },
  base: { label: 'Base', hint: 'Fast with good accuracy. A good start.', speed: 3, quality: 2 },
  small: { label: 'Small', hint: 'Noticeably more accurate. Slower on older CPUs.', speed: 2, quality: 3 },
  'large-v3-turbo': { label: 'Large v3 Turbo', hint: 'Best accuracy and languages. Needs a fast computer.', speed: 1, quality: 4 },
};

// Transcription list prices in USD per second of audio, for the estimated
// cost on the Usage tab. Prices as of 2026-10-22; custom providers aren't estimated.
export const TRANSCRIPTION_PRICES_AS_OF = '2026-10-22';
export const TRANSCRIPTION_PRICES_PER_SECOND: Record<string, Record<string, number>> = {
  groq: {
    'whisper-large-v3-turbo': 0.04 / 3600,
    'whisper-large-v3': 0.111 / 3600,
  },
  openai: {
    'gpt-transcribe': 0.0045 / 60,
    'whisper-1': 0.006 / 60,
    'gpt-4o-mini-transcribe': 0.003 / 60,
    'gpt-4o-transcribe': 0.006 / 60,
  },
};
// Groq bills every request as at least 10 seconds of audio
export const GROQ_MIN_BILLED_SECONDS = 10;

// Transform presets the user can pick by saying the phrase (matched in Rust)
export const TRANSFORM_PRESET_EXAMPLES: { label: string; say: string }[] = [
  { label: 'Fix grammar and spelling', say: '"Fix the grammar"' },
  { label: 'More formal', say: '"Make it more formal"' },
  { label: 'More casual', say: '"Make it casual"' },
  { label: 'Shorter', say: '"Make it shorter"' },
  { label: 'Longer, with detail', say: '"Expand this"' },
  { label: 'Bullet points', say: '"Bullet points"' },
  { label: 'Professional email', say: '"Turn this into an email"' },
  { label: 'Code comment', say: '"Make it a code comment"' },
  { label: 'Summary', say: '"Summarize"' },
  { label: 'Spanish / French / German', say: '"Translate to Spanish"' },
];

// Transform limits
export const TRANSFORM_MAX_CHARACTERS = 10000;

// Voice detection threshold
export const VOICE_DETECTION_THRESHOLD = 0.02; // ~2% of max level
