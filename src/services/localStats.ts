/**
 * Local usage aggregates.
 *
 * History is capped (see localHistory.ts), so all-time numbers are kept here
 * as running totals plus per-month buckets. Always read from localStorage so
 * every window sees the latest values.
 */

import { STORAGE_KEYS } from '../constants';

export interface UsageBucket {
  words: number;
  seconds: number;
  count: number;
  transforms: number;
  transformWords: number;
  /** Estimated provider cost in USD (cloud transcription only; see constants) */
  costUsd?: number;
}

export interface UsageStats {
  total: UsageBucket;
  /** Keyed by 'YYYY-MM' (local time). */
  months: Record<string, UsageBucket>;
}

function emptyBucket(): UsageBucket {
  return { words: 0, seconds: 0, count: 0, transforms: 0, transformWords: 0 };
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function load(): UsageStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USAGE_STATS);
    if (raw) return JSON.parse(raw) as UsageStats;
  } catch {
    // fall through to empty stats
  }
  return { total: emptyBucket(), months: {} };
}

function update(apply: (bucket: UsageBucket) => void): void {
  const stats = load();
  const key = monthKey();
  const month = stats.months[key] ?? emptyBucket();
  apply(stats.total);
  apply(month);
  stats.months[key] = month;
  localStorage.setItem(STORAGE_KEYS.USAGE_STATS, JSON.stringify(stats));
}

export const localStats = {
  get(): UsageStats {
    return load();
  },

  getMonth(key: string = monthKey()): UsageBucket {
    return load().months[key] ?? emptyBucket();
  },

  recordTranscription(words: number, seconds: number, costUsd = 0): void {
    update(b => {
      b.words += words;
      b.seconds += seconds;
      b.count += 1;
      b.costUsd = (b.costUsd ?? 0) + costUsd;
    });
  },

  recordTransform(words: number): void {
    update(b => {
      b.transforms += 1;
      b.transformWords += words;
    });
  },
};
