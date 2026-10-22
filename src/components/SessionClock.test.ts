import { describe, it, expect } from 'vitest';
import { formatSessionDuration } from './SessionClock';

describe('formatSessionDuration', () => {
  it('shows minutes and seconds, then hours', () => {
    expect(formatSessionDuration(0)).toBe('0:00');
    expect(formatSessionDuration(65_000)).toBe('1:05');
    expect(formatSessionDuration(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatSessionDuration(125 * 60_000 + 3_000)).toBe('2:05:03');
    expect(formatSessionDuration(-5)).toBe('0:00');
  });
});
