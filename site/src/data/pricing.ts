/**
 * Provider list prices for speech-to-text, used by the home page cost section,
 * the docs Costs page and the calculator. Update `PRICES_AS_OF` whenever you
 * touch a number. Prices are the provider's public list price in USD; Abe adds
 * nothing on top.
 */

export const PRICES_AS_OF = '2026-10-22';

export interface TranscriptionPrice {
  provider: 'OpenAI' | 'Groq' | 'Local';
  model: string;
  /** USD per minute of audio. `null` means "check provider pricing". */
  perMinute: number | null;
  /** Short note shown under the price. */
  note?: string;
  /** Where the number came from. */
  source: string;
}

export const TRANSCRIPTION_PRICES: TranscriptionPrice[] = [
  {
    provider: 'Local',
    model: 'Whisper on your computer',
    perMinute: 0,
    note: 'Runs offline. You pay only for the electricity.',
    source: '',
  },
  {
    provider: 'Groq',
    model: 'whisper-large-v3-turbo',
    perMinute: 0.04 / 60,
    note: '$0.04 per audio hour. 10-second minimum per request.',
    source: 'https://console.groq.com/docs/models',
  },
  {
    provider: 'Groq',
    model: 'whisper-large-v3',
    perMinute: 0.111 / 60,
    note: '$0.111 per audio hour. 10-second minimum per request.',
    source: 'https://console.groq.com/docs/models',
  },
  {
    provider: 'OpenAI',
    model: 'gpt-transcribe',
    perMinute: 0.0045,
    note: "Abe's default for OpenAI. OpenAI's current transcription model.",
    source: 'https://developers.openai.com/api/docs/pricing',
  },
];

export const cloudPrices = TRANSCRIPTION_PRICES.filter((p) => p.provider !== 'Local');

export const perHour = (p: TranscriptionPrice) => (p.perMinute === null ? null : p.perMinute * 60);

export const formatUsd = (value: number) => {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${Number(value.toPrecision(2))}`;
  if (value < 1) return `$${value.toFixed(3).replace(/0$/, '')}`;
  return `$${value.toFixed(2)}`;
};

/** Cheapest and most expensive cloud price per hour, for the "a few cents an hour" teaser. */
const hourly = cloudPrices.map(perHour).filter((v): v is number => v !== null);
export const CLOUD_HOURLY_MIN = Math.min(...hourly);
export const CLOUD_HOURLY_MAX = Math.max(...hourly);
