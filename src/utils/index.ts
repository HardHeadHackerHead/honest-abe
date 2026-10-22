import {
  AUDIO_FREQUENCIES,
  AUDIO_DURATIONS,
  STORAGE_KEYS,
  DEFAULT_HOTKEY,
  DEFAULT_PASTE_LAST_HOTKEY,
  DEFAULT_TRANSFORM_HOTKEY,
  DEFAULT_PUSH_TO_TALK,
  DEFAULT_MIN_DURATION,
  DEFAULT_MAX_DURATION,
  DEFAULT_OTHER_APPS_VOLUME,
} from '../constants';

// Format relative time for display
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Count words the same way everywhere (empty or whitespace-only text is 0 words)
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Audio feedback using Web Audio API
const audioContext = typeof window !== 'undefined'
  ? new (window.AudioContext || (window as any).webkitAudioContext)()
  : null;

export function playSound(frequency: number, duration: number): void {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

export function playStartSound(): void {
  playSound(AUDIO_FREQUENCIES.START, AUDIO_DURATIONS.START);
}

export function playStopSound(): void {
  playSound(AUDIO_FREQUENCIES.STOP, AUDIO_DURATIONS.STOP);
}

// Settings getters from localStorage
export function getPushToTalk(): boolean {
  const saved = localStorage.getItem(STORAGE_KEYS.PUSH_TO_TALK);
  return saved === null ? DEFAULT_PUSH_TO_TALK : saved === 'true';
}

// Hotkey getters: the stored value, or the default. These are the single source of truth
// for hotkeys and are pushed to Rust at startup (see useHotkeyListeners).
export function getHotkey(): string {
  return localStorage.getItem(STORAGE_KEYS.HOTKEY) || DEFAULT_HOTKEY;
}

export function getPasteLastHotkey(): string {
  return localStorage.getItem(STORAGE_KEYS.PASTE_LAST_HOTKEY) || DEFAULT_PASTE_LAST_HOTKEY;
}

export function getTransformHotkey(): string {
  return localStorage.getItem(STORAGE_KEYS.TRANSFORM_HOTKEY) || DEFAULT_TRANSFORM_HOTKEY;
}

export function getSoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.SOUND_ENABLED) !== 'false';
}

export function getOverlayEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.OVERLAY_ENABLED) !== 'false';
}

export function getMinDuration(): number {
  const ABSOLUTE_MIN = 0.5;
  const userMin = parseFloat(localStorage.getItem(STORAGE_KEYS.MIN_DURATION) || String(DEFAULT_MIN_DURATION));
  return Math.max(ABSOLUTE_MIN, userMin);
}

export function getMaxDuration(): number {
  return parseFloat(localStorage.getItem(STORAGE_KEYS.MAX_DURATION) || String(DEFAULT_MAX_DURATION));
}

export function getOtherAppsVolume(): number {
  const saved = localStorage.getItem(STORAGE_KEYS.OTHER_APPS_VOLUME);
  return saved ? parseInt(saved, 10) : DEFAULT_OTHER_APPS_VOLUME;
}

const isMac = navigator.platform.includes('Mac');

/**
 * Format a hotkey string for display — replaces internal key names
 * with platform-appropriate labels (e.g. Super → Win on Windows, Cmd on Mac)
 */
export function formatHotkeyDisplay(hk: string): string {
  return hk
    .replace(/Control/g, 'Ctrl')
    .replace(/Super/g, isMac ? 'Cmd' : 'Win')
    .replace(/\+/g, ' + ');
}

/**
 * Format a single key part for display
 */
export function formatKeyDisplay(key: string): string {
  if (key === 'Control') return 'Ctrl';
  if (key === 'Super') return isMac ? 'Cmd' : 'Win';
  return key;
}
