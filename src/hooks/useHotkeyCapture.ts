import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { keyNameFromEvent, buildHotkeyString, MOUSE_BUTTON_NAMES } from '../utils/hotkeys';

function setGlobalHotkeysEnabled(enabled: boolean) {
  return invoke('set_hotkeys_enabled', { enabled }).catch(e =>
    console.error(`Failed to ${enabled ? 'enable' : 'disable'} hotkeys:`, e),
  );
}

/**
 * Records a new hotkey from the keyboard and mouse. Global hotkeys are off while
 * capturing and always come back on: after a capture, on Escape, and when the
 * component unmounts mid-capture (F4).
 *
 * `onCaptured` receives the hotkey and the target passed to `start`; global
 * hotkeys are re-enabled once it settles.
 */
export default function useHotkeyCapture<T extends string>(
  onCaptured: (hotkey: string, target: T) => Promise<void> | void,
) {
  const [target, setTarget] = useState<T | null>(null);
  const [preview, setPreview] = useState('');
  const targetRef = useRef<T | null>(null);
  const recordedRef = useRef<Set<string>>(new Set());
  const heldRef = useRef<Set<string>>(new Set());
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;

  const reset = () => {
    targetRef.current = null;
    recordedRef.current.clear();
    heldRef.current.clear();
    setTarget(null);
    setPreview('');
  };

  const start = useCallback(async (next: T) => {
    await setGlobalHotkeysEnabled(false);
    recordedRef.current.clear();
    heldRef.current.clear();
    targetRef.current = next;
    setPreview('');
    setTarget(next);
  }, []);

  const cancel = useCallback(() => {
    if (targetRef.current === null) return;
    reset();
    setGlobalHotkeysEnabled(true);
  }, []);

  useEffect(() => {
    if (target === null) return;

    const finish = async () => {
      const current = targetRef.current;
      const hotkey = buildHotkeyString(recordedRef.current);
      reset();
      try {
        if (current !== null && hotkey) await onCapturedRef.current(hotkey, current);
      } finally {
        await setGlobalHotkeysEnabled(true);
      }
    };

    const press = (name: string) => {
      recordedRef.current.add(name);
      heldRef.current.add(name);
      setPreview(buildHotkeyString(recordedRef.current));
    };

    const release = (name: string) => {
      heldRef.current.delete(name);
      if (heldRef.current.size === 0 && recordedRef.current.size > 0) finish();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Escape on its own cancels; it can't be a hotkey
      if (e.key === 'Escape' && heldRef.current.size === 0) {
        cancel();
        return;
      }
      const name = keyNameFromEvent(e);
      if (name) press(name);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const name = keyNameFromEvent(e);
      if (name) release(name);
    };
    // The left button is left alone so buttons like Cancel still work while capturing
    const onMouseDown = (e: MouseEvent) => {
      const name = e.button === 0 ? undefined : MOUSE_BUTTON_NAMES[e.button];
      if (!name) return;
      // Side buttons would otherwise navigate back/forward
      if (e.button >= 3) e.preventDefault();
      press(name);
    };
    const onMouseUp = (e: MouseEvent) => {
      const name = e.button === 0 ? undefined : MOUSE_BUTTON_NAMES[e.button];
      if (!name) return;
      if (e.button >= 3) e.preventDefault();
      release(name);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [target, cancel]);

  // Leaving Settings or onboarding mid-capture must not leave hotkeys off
  useEffect(() => () => {
    if (targetRef.current !== null) {
      targetRef.current = null;
      setGlobalHotkeysEnabled(true);
    }
  }, []);

  return { capturing: target, preview, start, cancel };
}
