/**
 * Turning browser key and mouse events into hotkey strings that match the key
 * names Rust reports (see keycode_to_string and hotkeys.rs).
 */

const MODIFIER_ORDER = ['Control', 'Shift', 'Alt', 'Super'];

// KeyboardEvent.code for keys whose name differs from Rust's
const CODE_NAMES: Record<string, string> = {
  ControlLeft: 'Control', ControlRight: 'Control',
  ShiftLeft: 'Shift', ShiftRight: 'Shift',
  AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Super', MetaRight: 'Super', OSLeft: 'Super', OSRight: 'Super',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Return', NumpadEnter: 'Return',
  Space: 'Space', Escape: 'Escape', Backspace: 'Backspace', Tab: 'Tab',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', CapsLock: 'CapsLock',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

/** Browser mouse buttons. 3 and 4 are the side buttons (back/forward). */
export const MOUSE_BUTTON_NAMES: Record<number, string> = {
  0: 'MouseLeft',
  1: 'MouseMiddle',
  2: 'MouseRight',
  3: 'Mouse4',
  4: 'Mouse5',
};

/**
 * Hotkey name for a key event. Uses the physical key (`code`), so Option+T on
 * macOS is "T" rather than "†" and Shift+1 is "1" rather than "!".
 */
export function keyNameFromEvent(e: Pick<KeyboardEvent, 'code' | 'key'>): string | null {
  const code = e.code ?? '';
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Numpad${m[1]}`;
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;

  // No usable code (some synthetic events): fall back to the key value
  const key = e.key ?? '';
  if (key === ' ') return 'Space';
  if (key === 'Control' || key === 'Shift' || key === 'Alt') return key;
  if (key === 'Meta') return 'Super';
  if (key.length === 1 && /[a-z0-9]/i.test(key)) return key.toUpperCase();
  return null;
}

/** "Control+Shift+V": modifiers first in a fixed order, then the other keys */
export function buildHotkeyString(keys: Iterable<string>): string {
  const modifiers: string[] = [];
  const others: string[] = [];
  for (const key of new Set(keys)) {
    (MODIFIER_ORDER.includes(key) ? modifiers : others).push(key);
  }
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, ...others].join('+');
}
