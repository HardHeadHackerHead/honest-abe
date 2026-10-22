import { useState, useEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { engine, EngineError, engineErrorHint, estimateTranscriptionCost, toEngineError } from '../services/engine';
import { localHistory } from '../services/localHistory';
import { tauriCommands } from '../services/tauri';
import { createRecordingMachine, RecordingMachine } from '../services/recordingMachine';
import { STORAGE_KEYS, VOICE_DETECTION_THRESHOLD } from '../constants';
import { wordDictionary } from '../services/wordDictionary';
import type { ShowStatus } from './useStatusMessage';
import {
  playStartSound,
  playStopSound,
  getSoundEnabled,
  getOverlayEnabled,
  getMinDuration,
  getMaxDuration,
  getOtherAppsVolume,
  countWords,
} from '../utils';

interface UseRecordingProps {
  onStatusMessage: ShowStatus;
  onEngineError: (error: EngineError | null) => void;
}

interface UseRecordingReturn {
  isRecording: boolean;
  isProcessing: boolean;
  /** Push-to-talk: true on press, false on release */
  requestRecording: (want: boolean) => void;
  /** Toggle mode and the record button */
  toggleRecording: () => void;
}

/** Restore other apps' volume. Safe to call when nothing was ducked. */
async function restoreVolume() {
  try {
    await tauriCommands.restoreOtherAppsVolume();
  } catch (error) {
    console.error('Could not restore other apps volume:', error);
  }
}

export default function useRecording({
  onStatusMessage,
  onEngineError,
}: UseRecordingProps): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const queryClient = useQueryClient();

  // Latest callbacks for the machine, which is created once
  const depsRef = useRef({ onStatusMessage, onEngineError, queryClient });
  depsRef.current = { onStatusMessage, onEngineError, queryClient };

  const recordingStartRef = useRef(0);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const machineRef = useRef<RecordingMachine | null>(null);

  const transcribe = async () => {
    const { onStatusMessage, onEngineError, queryClient } = depsRef.current;
    try {
      const result = await engine.transcribeRecording();
      onEngineError(null);

      // Apply word dictionary replacements before saving/pasting
      const correctedText = wordDictionary.applyReplacements(result.text).trim();

      if (!correctedText) {
        onStatusMessage({ type: 'warning', text: 'No speech recognized' }, 3000);
        if (getOverlayEnabled()) {
          await emit('overlay-warning', { message: 'No speech recognized' });
        }
        return;
      }

      // Save transcription to local history (text never leaves the device)
      localHistory.addEntry({
        text: correctedText,
        durationSeconds: result.durationSeconds,
        wordCount: countWords(correctedText),
        costUsd: estimateTranscriptionCost(engine.getConfig(), result.audioSeconds),
      });

      // Invalidate queries to refresh dashboard data
      queryClient.invalidateQueries({ queryKey: ['usage'] });

      // Notify other windows (like history window) and onboarding playground to refresh
      await emit('transcription-added', { text: correctedText });
      if (getOverlayEnabled()) {
        await emit('overlay-recording-stop', {});
      }

      // Auto-paste the transcription (with dictionary corrections applied)
      const outputMode = localStorage.getItem(STORAGE_KEYS.OUTPUT_MODE) || 'instant';
      const typingSpeed = parseInt(localStorage.getItem(STORAGE_KEYS.TYPING_SPEED) || '1500', 10);
      try {
        await invoke('paste_text', { text: correctedText, outputMode, typingSpeed });
      } catch (pasteError) {
        console.error('[Recording] Paste failed (transcription succeeded):', pasteError);
        onStatusMessage({ type: 'warning', text: 'Transcribed but paste failed - check Accessibility permissions' }, 5000);
      }
    } catch (error) {
      const engineError = toEngineError(error);
      console.error('[Recording] Transcription error:', engineError.kind, engineError.message);
      onEngineError(engineError);
      if (getOverlayEnabled()) {
        await emit('overlay-error', { message: engineError.userMessage, hint: engineErrorHint(engineError) });
      }
    }
  };

  const start = async (): Promise<boolean> => {
    const { onStatusMessage } = depsRef.current;

    // Reduce other apps volume if enabled
    const otherAppsVolume = getOtherAppsVolume();
    if (otherAppsVolume < 100) {
      try {
        await tauriCommands.reduceOtherAppsVolume(otherAppsVolume);
      } catch (error) {
        console.error('Could not reduce other apps volume:', error);
      }
    }

    if (getSoundEnabled()) {
      playStartSound();
    }

    try {
      await invoke('start_recording');
    } catch (error) {
      // Every failed start gives the volume back
      await restoreVolume();
      console.error('Failed to start recording:', error);
      onStatusMessage({ type: 'error', text: `Could not start recording: ${String(error)}` }, 5000);
      if (getOverlayEnabled()) {
        await emit('overlay-warning', { message: 'Could not open the microphone' });
      }
      return false;
    }

    recordingStartRef.current = Date.now();

    // Set up max duration auto-stop timer (0 = unlimited; Rust still caps at 15 minutes)
    const maxDuration = getMaxDuration();
    if (maxDuration > 0) {
      maxDurationTimerRef.current = setTimeout(() => {
        maxDurationTimerRef.current = null;
        machineRef.current?.request(false);
      }, maxDuration * 1000);
    }

    if (getOverlayEnabled()) {
      await emit('overlay-recording-start', {});
    }
    return true;
  };

  const stop = async () => {
    const { onStatusMessage } = depsRef.current;
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }

    // Restore other apps volume first, whatever happens next
    await restoreVolume();

    const overlayEnabled = getOverlayEnabled();
    // Every path below must leave the overlay in a final state (F10)
    let overlaySettled = false;
    const settleOverlay = async (event: string, payload: object = {}) => {
      overlaySettled = true;
      if (overlayEnabled) await emit(event, payload);
    };

    try {
      if (getSoundEnabled()) {
        playStopSound();
      }

      // Immediately show processing state - user should no longer see "Recording"
      if (overlayEnabled) {
        await emit('overlay-processing', {});
      }

      const recordingDuration = (Date.now() - recordingStartRef.current) / 1000;
      const captureResult = await tauriCommands.stopRecording();

      // Check if recording was too short
      if (recordingDuration < getMinDuration()) {
        onStatusMessage({ type: 'warning', text: 'Recording too short' }, 3000);
        await settleOverlay('overlay-warning', { message: 'Recording too short' });
        return;
      }

      // Check if voice was detected
      const voiceDetected = await invoke<boolean>('check_voice_detected', { threshold: VOICE_DETECTION_THRESHOLD });

      if (captureResult.originalDurationSeconds > 0 && voiceDetected) {
        await transcribe();
        overlaySettled = true; // transcribe() always ends with a stop, warning or error
      } else if (!voiceDetected) {
        onStatusMessage({ type: 'warning', text: 'No voice detected' }, 3000);
        await settleOverlay('overlay-warning', { message: 'No voice detected' });
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      onStatusMessage({ type: 'error', text: 'Recording failed' }, 3000);
    } finally {
      if (!overlaySettled) await settleOverlay('overlay-recording-stop');
    }
  };

  if (!machineRef.current) {
    machineRef.current = createRecordingMachine('dictation', {
      start: () => start(),
      stop: () => stop(),
      onPhase: (phase) => {
        setIsRecording(phase === 'recording');
        setIsProcessing(phase === 'stopping');
      },
      onBusy: () => depsRef.current.onStatusMessage({ type: 'warning', text: 'The microphone is already in use' }, 3000),
    });
  }
  const machine = machineRef.current;

  // The microphone failed or the hard length cap was hit: stop and keep what was recorded (R12, R13)
  useEffect(() => {
    const unlistenError = listen<string>('recording-error', (event) => {
      if (machine.phase !== 'recording') return;
      depsRef.current.onStatusMessage({ type: 'error', text: event.payload }, 6000);
      machine.request(false);
    });
    const unlistenLimit = listen<number>('recording-limit-reached', (event) => {
      if (machine.phase !== 'recording') return;
      const minutes = Math.round(event.payload / 60);
      depsRef.current.onStatusMessage({ type: 'warning', text: `Stopped at the ${minutes} minute limit` }, 6000);
      machine.request(false);
    });
    return () => {
      unlistenError.then(fn => fn());
      unlistenLimit.then(fn => fn());
    };
  }, [machine]);

  // Never leave the mic open or other apps ducked if this unmounts mid-recording
  useEffect(() => () => machine.request(false), [machine]);

  return {
    isRecording,
    isProcessing,
    requestRecording: machine.request,
    toggleRecording: machine.toggle,
  };
}
