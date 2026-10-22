/**
 * Default global hotkeys. All of them can be changed in Settings → Hotkeys.
 * Each combination is a list of keys so pages can render them as <kbd>s.
 */

export interface Hotkey {
  id: 'dictate' | 'paste-last' | 'transform';
  action: string;
  description: string;
  windows: string[];
  macos: string[];
  linux: string[];
}

export const HOTKEYS: Hotkey[] = [
  {
    id: 'dictate',
    action: 'Dictate',
    description: 'Hold to talk (push-to-talk), or press once to start and again to stop (toggle mode).',
    windows: ['Ctrl', 'Alt', 'Space'],
    macos: ['Ctrl', 'Option', 'Space'],
    linux: ['Ctrl', 'Alt', 'Space'],
  },
  {
    id: 'paste-last',
    action: 'Paste last',
    description: 'Insert your most recent transcription again at the cursor.',
    windows: ['Ctrl', 'Alt', 'V'],
    macos: ['Ctrl', 'Option', 'V'],
    linux: ['Ctrl', 'Alt', 'V'],
  },
  {
    id: 'transform',
    action: 'Voice Transform',
    description: 'Select text, then hold and speak an instruction to rewrite it.',
    windows: ['Ctrl', 'Alt', 'T'],
    macos: ['Ctrl', 'Option', 'T'],
    linux: ['Ctrl', 'Alt', 'T'],
  },
];

export const DICTATE = HOTKEYS[0];
