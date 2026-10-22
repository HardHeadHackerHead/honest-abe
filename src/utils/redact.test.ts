import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('hides key-like strings', () => {
    expect(redactSecrets('key sk-proj-abcdefgh12345678 ok')).toBe('key [redacted] ok');
    expect(redactSecrets('gsk_ABCDEFGHijklmnop1234')).toBe('[redacted]');
    expect(redactSecrets('Authorization: Bearer abc.def-123456')).toBe('Authorization: Bearer [redacted]');
    expect(redactSecrets('token a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7')).toBe('token [redacted]');
  });

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('[HOTKEY] Attempting to set hotkey: Control+Alt+Space')).toBe('[HOTKEY] Attempting to set hotkey: Control+Alt+Space');
    expect(redactSecrets('task-based skills')).toBe('task-based skills');
  });
});
