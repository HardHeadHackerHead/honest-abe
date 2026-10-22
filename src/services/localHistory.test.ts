import { describe, it, expect, vi } from 'vitest';
import { saveRecords, TranscriptionRecord } from './localHistory';

function records(n: number): TranscriptionRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    timestamp: new Date(2026, 0, 1, 0, 0, n - i).toISOString(),
    text: `entry ${i}`,
    durationSeconds: 1,
    wordCount: 2,
  }));
}

describe('saveRecords', () => {
  it('saves everything when there is room', () => {
    const setItem = vi.fn();
    expect(saveRecords(records(4), { setItem })).toHaveLength(4);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest records until they fit when storage is full', () => {
    const stored: string[] = [];
    const setItem = vi.fn((_key: string, value: string) => {
      if (value.length > 400) throw new DOMException('full', 'QuotaExceededError');
      stored.push(value);
    });
    const saved = saveRecords(records(20), { setItem });
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(20);
    // Most recent first: the newest records are the ones kept
    expect(saved[0].id).toBe('0');
    expect(JSON.parse(stored[0])).toHaveLength(saved.length);
  });

  it('does not loop on other errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItem = vi.fn(() => { throw new Error('denied'); });
    expect(saveRecords(records(3), { setItem })).toHaveLength(3);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
