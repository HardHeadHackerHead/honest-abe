import { describe, it, expect } from 'vitest';
import { keyNameFromEvent, buildHotkeyString } from './hotkeys';

describe('keyNameFromEvent', () => {
  it('uses the physical key', () => {
    expect(keyNameFromEvent({ code: 'KeyT', key: '†' })).toBe('T');
    expect(keyNameFromEvent({ code: 'Digit1', key: '!' })).toBe('1');
    expect(keyNameFromEvent({ code: 'Space', key: ' ' })).toBe('Space');
    expect(keyNameFromEvent({ code: 'AltRight', key: 'AltGraph' })).toBe('Alt');
    expect(keyNameFromEvent({ code: 'MetaLeft', key: 'Meta' })).toBe('Super');
    expect(keyNameFromEvent({ code: 'Enter', key: 'Enter' })).toBe('Return');
    expect(keyNameFromEvent({ code: 'ArrowUp', key: 'ArrowUp' })).toBe('Up');
    expect(keyNameFromEvent({ code: 'F12', key: 'F12' })).toBe('F12');
    expect(keyNameFromEvent({ code: 'Numpad7', key: '7' })).toBe('Numpad7');
    expect(keyNameFromEvent({ code: 'Slash', key: '?' })).toBe('/');
  });

  it('falls back to the key value', () => {
    expect(keyNameFromEvent({ code: '', key: 'v' })).toBe('V');
    expect(keyNameFromEvent({ code: '', key: 'Control' })).toBe('Control');
    expect(keyNameFromEvent({ code: '', key: 'Unidentified' })).toBeNull();
  });
});

describe('buildHotkeyString', () => {
  it('orders modifiers first', () => {
    expect(buildHotkeyString(['V', 'Shift', 'Control'])).toBe('Control+Shift+V');
    expect(buildHotkeyString(new Set(['Space', 'Alt', 'Control']))).toBe('Control+Alt+Space');
    expect(buildHotkeyString(['Mouse4'])).toBe('Mouse4');
    expect(buildHotkeyString([])).toBe('');
  });
});
