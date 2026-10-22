import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { STORAGE_KEYS } from '../constants';
import type { ShowStatus } from './useStatusMessage';
import { getPushToTalk, getOverlayEnabled, getHotkey, getPasteLastHotkey, getTransformHotkey } from '../utils';

interface UseHotkeyListenersProps {
  /** True when a transcription engine is configured and ready. */
  canRecordRef: React.RefObject<boolean>;
  /** Called when the user tries to record but no engine is ready. */
  onEngineNotReady: () => void;
  /** True when the transform provider (a chat model) is configured. */
  canTransformRef: React.RefObject<boolean>;
  /** Called when the transform hotkey is pressed but no transform provider is set up. */
  onTransformNotReady: () => void;
  /** Dictation: push-to-talk press/release and toggle */
  requestRecording: (want: boolean) => void;
  toggleRecording: () => void;
  /** Transform: push-to-talk press/release and toggle */
  requestTransform: (want: boolean) => void;
  toggleTransform: () => void;
  onStatusMessage: ShowStatus;
}

export default function useHotkeyListeners({
  canRecordRef,
  onEngineNotReady,
  canTransformRef,
  onTransformNotReady,
  requestRecording,
  toggleRecording,
  requestTransform,
  toggleTransform,
  onStatusMessage,
}: UseHotkeyListenersProps): void {
  // Keep callbacks in refs so the listeners below are registered exactly once
  const onEngineNotReadyRef = useRef(onEngineNotReady);
  onEngineNotReadyRef.current = onEngineNotReady;
  const onTransformNotReadyRef = useRef(onTransformNotReady);
  onTransformNotReadyRef.current = onTransformNotReady;
  const onStatusMessageRef = useRef(onStatusMessage);
  onStatusMessageRef.current = onStatusMessage;

  useEffect(() => {
    // Track hotkey state to handle spurious keyboard/mouse button events from rdev on Windows
    // rdev fires rapid PRESS/RELEASE cycles while key/button is held
    // We debounce release: only process release if no press comes within debounce window
    const RELEASE_DEBOUNCE_MS = 100; // Wait this long after release before acting

    // Recording hotkey state
    let recordIsActive = false;
    let recordReleaseTimer: ReturnType<typeof setTimeout> | null = null;

    // Transform hotkey state
    let transformIsActive = false;
    let transformReleaseTimer: ReturnType<typeof setTimeout> | null = null;

    // Listen for hotkey press event
    const unlistenPress = listen('hotkey-pressed', () => {
      // Cancel any pending release - this press cancels the spurious release
      if (recordReleaseTimer) {
        clearTimeout(recordReleaseTimer);
        recordReleaseTimer = null;
      }

      // If already active, this is a spurious re-press - ignore
      if (recordIsActive) {
        return;
      }

      if (!canRecordRef.current) {
        onEngineNotReadyRef.current();
        return;
      }

      // Mark as active
      recordIsActive = true;

      const pushToTalk = getPushToTalk();
      if (pushToTalk) {
        // Push-to-talk: start recording on press
        requestRecording(true);
      } else {
        // Toggle mode: toggle on press, then reset active state
        toggleRecording();
        recordIsActive = false;
      }
    });

    // Listen for hotkey release event (only used in push-to-talk mode)
    const unlistenRelease = listen('hotkey-released', () => {
      // If not active (toggle mode), ignore
      if (!recordIsActive) {
        return;
      }

      // If there's already a pending release timer, ignore this one
      if (recordReleaseTimer) {
        return;
      }

      // Start a debounce timer - if no press comes within the window, process the release
      recordReleaseTimer = setTimeout(() => {
        recordReleaseTimer = null;
        recordIsActive = false;

        const pushToTalk = getPushToTalk();
        if (pushToTalk) {
          // Push-to-talk: stop recording on release
          requestRecording(false);
        }
      }, RELEASE_DEBOUNCE_MS);
    });

    // Legacy toggle event (from tray menu)
    const unlistenToggle = listen('toggle-recording', () => {
      if (!canRecordRef.current) {
        onEngineNotReadyRef.current();
        return;
      }
      toggleRecording();
    });

    // Listen for paste-last hotkey event
    const unlistenPasteLast = listen('paste-last-pressed', async () => {
      try {
        const success = await invoke<boolean>('paste_last_transcription');
        if (!success) {
          onStatusMessageRef.current({ type: 'warning', text: 'No transcription to paste' }, 2000);
        }
      } catch (error) {
        console.error('Failed to paste last transcription:', error);
      }
    });

    // Listen for transform hotkey press
    const unlistenTransformPress = listen('transform-hotkey-pressed', () => {
      // Cancel any pending release - this press cancels the spurious release
      if (transformReleaseTimer) {
        clearTimeout(transformReleaseTimer);
        transformReleaseTimer = null;
      }

      // If already active, this is a spurious re-press - ignore
      if (transformIsActive) {
        return;
      }

      if (!canRecordRef.current) {
        onEngineNotReadyRef.current();
        return;
      }
      if (!canTransformRef.current) {
        onTransformNotReadyRef.current();
        return;
      }

      // Mark as active
      transformIsActive = true;

      const pushToTalk = getPushToTalk();
      if (pushToTalk) {
        requestTransform(true);
      } else {
        // Toggle mode: toggle on press, then reset active state
        toggleTransform();
        transformIsActive = false;
      }
    });

    // Listen for transform hotkey release
    const unlistenTransformRelease = listen('transform-hotkey-released', () => {
      // If not active (toggle mode), ignore
      if (!transformIsActive) {
        return;
      }

      // If there's already a pending release timer, ignore this one
      if (transformReleaseTimer) {
        return;
      }

      // Start a debounce timer - if no press comes within the window, process the release
      transformReleaseTimer = setTimeout(() => {
        transformReleaseTimer = null;
        transformIsActive = false;

        const pushToTalk = getPushToTalk();
        if (pushToTalk) {
          requestTransform(false);
        }
      }, RELEASE_DEBOUNCE_MS);
    });

    // Push stored-or-default settings to Rust on startup so both sides always agree
    invoke('set_push_to_talk', { enabled: getPushToTalk() }).catch(console.error);
    invoke('set_hotkey', { hotkey: getHotkey() }).catch(console.error);
    invoke('set_paste_last_hotkey', { hotkey: getPasteLastHotkey() }).catch(console.error);
    invoke('set_transform_hotkey', { hotkey: getTransformHotkey() }).catch(console.error);

    const savedDevice = localStorage.getItem(STORAGE_KEYS.AUDIO_DEVICE);
    if (savedDevice) {
      invoke('set_audio_device', { deviceName: savedDevice }).catch(console.error);
    }


    // Show overlay on startup if enabled
    if (getOverlayEnabled()) {
      invoke('show_overlay').catch(console.error);
    }

    return () => {
      // Clear any pending release timers
      if (recordReleaseTimer) {
        clearTimeout(recordReleaseTimer);
      }
      if (transformReleaseTimer) {
        clearTimeout(transformReleaseTimer);
      }
      unlistenPress.then(fn => fn());
      unlistenRelease.then(fn => fn());
      unlistenToggle.then(fn => fn());
      unlistenPasteLast.then(fn => fn());
      unlistenTransformPress.then(fn => fn());
      unlistenTransformRelease.then(fn => fn());
    };
  }, [canRecordRef, canTransformRef, requestRecording, toggleRecording, requestTransform, toggleTransform]);
}
