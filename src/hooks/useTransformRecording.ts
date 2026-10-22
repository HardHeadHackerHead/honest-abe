import { useState, useEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { engine, EngineError, engineErrorHint, toEngineError } from '../services/engine';
import { localStats } from '../services/localStats';
import { tauriCommands } from '../services/tauri';
import { createRecordingMachine, RecordingMachine } from '../services/recordingMachine';
import { STORAGE_KEYS, TRANSFORM_MAX_CHARACTERS, VOICE_DETECTION_THRESHOLD } from '../constants';
import type { ShowStatus } from './useStatusMessage';
import {
  playStartSound,
  playStopSound,
  getSoundEnabled,
  getOverlayEnabled,
  countWords,
} from '../utils';

interface UseTransformRecordingProps {
  onStatusMessage: ShowStatus;
  onEngineError: (error: EngineError | null) => void;
}

interface UseTransformRecordingReturn {
  isTransformRecording: boolean;
  /** Push-to-talk: true on press, false on release */
  requestTransform: (want: boolean) => void;
  /** Toggle mode */
  toggleTransform: () => void;
}

export default function useTransformRecording({
  onStatusMessage,
  onEngineError,
}: UseTransformRecordingProps): UseTransformRecordingReturn {
  const [isTransformRecording, setIsTransformRecording] = useState(false);
  const queryClient = useQueryClient();

  // Latest callbacks for the machine, which is created once
  const depsRef = useRef({ onStatusMessage, onEngineError, queryClient });
  depsRef.current = { onStatusMessage, onEngineError, queryClient };
  const machineRef = useRef<RecordingMachine | null>(null);

  // Starting transform recording - just start recording, don't capture text yet.
  // We capture text when the user releases the hotkey (after modifiers are released).
  const start = async (): Promise<boolean> => {
    const { onStatusMessage } = depsRef.current;
    if (getSoundEnabled()) {
      playStartSound();
    }
    try {
      await invoke('start_recording');
    } catch (error) {
      console.error('Transform recording failed to start:', error);
      onStatusMessage({ type: 'error', text: `Could not start recording: ${String(error)}` }, 5000);
      if (getOverlayEnabled()) {
        await emit('overlay-warning', { message: 'Could not open the microphone' });
      }
      return false;
    }

    onStatusMessage({ type: 'info', text: 'Recording command... (keep text selected)' });
    if (getOverlayEnabled()) {
      await emit('overlay-transform-start', {});
    }
    return true;
  };

  const stop = async () => {
    const { onStatusMessage, onEngineError, queryClient } = depsRef.current;
    const overlayEnabled = getOverlayEnabled();

    // Every path below must leave the overlay in a final state (F10)
    let overlaySettled = false;
    const warn = async (text: string, clearAfterMs: number, type: 'warning' | 'error' = 'warning') => {
      onStatusMessage({ type, text }, clearAfterMs);
      overlaySettled = true;
      if (overlayEnabled) await emit('overlay-warning', { message: text });
    };

    try {
      if (getSoundEnabled()) {
        playStopSound();
      }

      const captureResult = await tauriCommands.stopRecording();

      if (captureResult.originalDurationSeconds <= 0) {
        await warn('No audio recorded', 2000);
        return;
      }

      // Check if voice was detected
      const voiceDetected = await invoke<boolean>('check_voice_detected', { threshold: VOICE_DETECTION_THRESHOLD });
      if (!voiceDetected) {
        await warn('No voice detected', 3000);
        return;
      }

      // NOW capture the selected text. Rust waits for the hotkey's modifiers to be released.
      onStatusMessage({ type: 'info', text: 'Capturing selection...' });
      const selectedText = await tauriCommands.getSelectedText();

      if (!selectedText || !selectedText.trim()) {
        await warn('No text selected', 2000);
        return;
      }

      // Validate selected text length against the limit
      if (selectedText.length > TRANSFORM_MAX_CHARACTERS) {
        await warn(
          `Selection too long: ${selectedText.length.toLocaleString()} chars (max ${TRANSFORM_MAX_CHARACTERS.toLocaleString()})`,
          4000,
          'error',
        );
        return;
      }

      onStatusMessage({ type: 'info', text: 'Processing...' });
      if (overlayEnabled) {
        await emit('overlay-transform-processing', {});
      }

      // Transcribe the voice command
      const transcription = await engine.transcribeRecording();
      const command = transcription.text.trim();

      if (!command) {
        await warn('Could not understand command', 2000);
        return;
      }

      // Transform the text using the voice command as the instruction. Rust
      // maps phrases like "make it shorter" to presets and prepends the
      // custom transform prompt from Settings.
      onStatusMessage({ type: 'info', text: 'Transforming...' });
      const transformResult = await engine.transformText(selectedText, command);
      onEngineError(null);

      if (!transformResult.text.trim()) {
        await warn('Transform returned no text', 2000);
        return;
      }

      // Paste the transformed text
      const outputMode = localStorage.getItem(STORAGE_KEYS.OUTPUT_MODE) || 'instant';
      const typingSpeed = parseInt(localStorage.getItem(STORAGE_KEYS.TYPING_SPEED) || '1500', 10);
      await invoke('paste_text', { text: transformResult.text, outputMode, typingSpeed });

      localStats.recordTransform(countWords(selectedText));
      queryClient.invalidateQueries({ queryKey: ['usage'] });

      onStatusMessage({ type: 'info', text: 'Text transformed!' }, 2000);
    } catch (error) {
      const engineError = toEngineError(error);
      console.error('[Transform] Error:', engineError.kind, engineError.message);
      onStatusMessage(null);
      onEngineError(engineError);
      overlaySettled = true;
      if (overlayEnabled) {
        await emit('overlay-error', { message: engineError.userMessage, hint: engineErrorHint(engineError) });
      }
    } finally {
      if (!overlaySettled && overlayEnabled) {
        await emit('overlay-transform-stop', {});
      }
    }
  };

  if (!machineRef.current) {
    machineRef.current = createRecordingMachine('transform', {
      start: () => start(),
      stop: () => stop(),
      onPhase: (phase) => setIsTransformRecording(phase === 'recording'),
      onBusy: () => depsRef.current.onStatusMessage({ type: 'warning', text: 'The microphone is already in use' }, 3000),
    });
  }
  const machine = machineRef.current;

  // The microphone failed or the hard length cap was hit (R12, R13)
  useEffect(() => {
    const stopOn = (text: string) => {
      if (machine.phase !== 'recording') return;
      depsRef.current.onStatusMessage({ type: 'error', text }, 6000);
      machine.request(false);
    };
    const unlistenError = listen<string>('recording-error', (event) => stopOn(event.payload));
    const unlistenLimit = listen<number>('recording-limit-reached', (event) =>
      stopOn(`Stopped at the ${Math.round(event.payload / 60)} minute limit`));
    return () => {
      unlistenError.then(fn => fn());
      unlistenLimit.then(fn => fn());
    };
  }, [machine]);

  // Never leave the mic open if this unmounts mid-recording
  useEffect(() => () => machine.request(false), [machine]);

  return {
    isTransformRecording,
    requestTransform: machine.request,
    toggleTransform: machine.toggle,
  };
}
