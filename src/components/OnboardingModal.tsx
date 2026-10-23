import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { Mic, Keyboard, Cpu, CheckCircle, ChevronRight, X, Shield, Settings, AlertTriangle, Loader2, Wand2, Clipboard, BookA } from 'lucide-react';
import {
  formatHotkeyDisplay, formatKeyDisplay, getHotkey, getPushToTalk, getPasteLastHotkey, getTransformHotkey,
} from '../utils';
import { STORAGE_KEYS } from '../constants';
import type { EngineError } from '../services/engine';
import useEngineStatus from '../hooks/useEngineStatus';
import EngineSettings from './EngineSettings';
import useHotkeyCapture from '../hooks/useHotkeyCapture';
import { keyNameFromEvent } from '../utils/hotkeys';
import { acquireMic, releaseMic } from '../services/recordingMachine';

const appWindow = getCurrentWebviewWindow();

interface OnboardingModalProps {
  needsDesktopShortcuts?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  isRecording: boolean;
  isProcessing: boolean;
  engineReady: boolean;
  /** Why the engine isn't ready yet (e.g. the model is still downloading) */
  engineDetail?: string;
  /** Last transcription error, shown on the practice step */
  engineError: EngineError | null;
}

// Welcome, engine, microphone, practice, done
const TOTAL_STEPS = 5;
const STEP = { WELCOME: 0, ENGINE: 1, MIC: 2, PRACTICE: 3, DONE: 4 } as const;
const PRACTICE_PHRASE = 'Abe turns my voice into text, wherever my cursor is.';
const MIN_ONBOARDING_HEIGHT = 640;
const MIN_ONBOARDING_WIDTH = 480;

export default function OnboardingModal({
  needsDesktopShortcuts = false,
  isOpen,
  onClose,
  onComplete,
  isRecording,
  isProcessing,
  engineReady,
  engineDetail,
  engineError,
}: OnboardingModalProps) {
  const [step, setStep] = useState<number>(STEP.WELCOME);
  const [engineCanContinue, setEngineCanContinue] = useState(false);
  const { status: engineStatus } = useEngineStatus();

  // Step 2: Microphone
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>(() =>
    localStorage.getItem('abe_audio_device') || ''
  );
  const [audioLevel, setAudioLevel] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const testIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirrors isTesting so cleanup never sees a stale value (F5)
  const isTestingRef = useRef(false);

  // Step 3: Hotkey + Practice
  const [hotkey, setHotkey] = useState(getHotkey);
  const [pushToTalk, setPushToTalk] = useState(getPushToTalk);
  const [playgroundText, setPlaygroundText] = useState('');
  const [playgroundSuccess, setPlaygroundSuccess] = useState(false);
  const [showHotkeyOptions, setShowHotkeyOptions] = useState(false);
  // Track whether the user has ever started recording (to advance the guided flow)
  const [hasTriedRecording, setHasTriedRecording] = useState(false);
  // Track which hotkey keys are currently held (for visual feedback)
  const [heldPracticeKeys, setHeldPracticeKeys] = useState<Set<string>>(new Set());

  const saveHotkey = useCallback(async (newHotkey: string) => {
    try {
      await invoke('set_hotkey', { hotkey: newHotkey });
      setHotkey(newHotkey);
      localStorage.setItem(STORAGE_KEYS.HOTKEY, newHotkey);
    } catch (error) {
      console.error('Failed to set hotkey:', error);
    }
  }, []);

  // Global hotkeys are off while capturing and come back on however capture ends (F4)
  const {
    capturing,
    preview: hotkeyPreview,
    start: startCapture,
    cancel: cancelHotkeyRecording,
  } = useHotkeyCapture<'dictate'>(saveHotkey);
  const isRecordingHotkey = capturing !== null;
  const startHotkeyRecording = useCallback(() => startCapture('dictate'), [startCapture]);

  // Size before onboarding enlarged the window; restored when onboarding closes
  const prevSizeRef = useRef<{ width: number; height: number } | null>(null);

  // Ensure window is large enough for onboarding, and put it back afterwards
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const ensureMinSize = async () => {
      try {
        const factor = await appWindow.scaleFactor();
        const phys = await appWindow.innerSize();
        const w = phys.width / factor;
        const h = phys.height / factor;
        if (cancelled) return;
        if (w < MIN_ONBOARDING_WIDTH || h < MIN_ONBOARDING_HEIGHT) {
          prevSizeRef.current = { width: w, height: h };
          await appWindow.setSize(new LogicalSize(
            Math.max(w, MIN_ONBOARDING_WIDTH),
            Math.max(h, MIN_ONBOARDING_HEIGHT),
          ));
        }
      } catch (err) {
        console.error('Failed to resize window for onboarding:', err);
      }
    };
    ensureMinSize();
    return () => {
      cancelled = true;
      const prev = prevSizeRef.current;
      prevSizeRef.current = null;
      if (prev) {
        appWindow.setSize(new LogicalSize(prev.width, prev.height)).catch(console.error);
      }
    };
  }, [isOpen]);

  // Load audio devices
  useEffect(() => {
    if (isOpen) {
      invoke('get_audio_devices')
        .then((devices) => setAudioDevices(devices as string[]))
        .catch(console.error);
    }
  }, [isOpen]);

  // Audio level polling for mic test
  useEffect(() => {
    if (isTesting) {
      testIntervalRef.current = setInterval(async () => {
        try {
          const level = await invoke<number>('get_audio_level');
          setAudioLevel(level);
        } catch {
          setAudioLevel(0);
        }
      }, 50);
    } else {
      if (testIntervalRef.current) {
        clearInterval(testIntervalRef.current);
        testIntervalRef.current = null;
      }
      setAudioLevel(0);
    }
    return () => {
      if (testIntervalRef.current) clearInterval(testIntervalRef.current);
    };
  }, [isTesting]);

  // Start/stop mic test while on the mic step; stop it if the modal closes (F5).
  // If the step changes before start_recording resolves, stop right away.
  // The test shares the mic lock with dictation and transform, so a hotkey
  // press can't start a second recording on top of it (F6).
  useEffect(() => {
    if (!isOpen || step !== STEP.MIC) return;
    if (!acquireMic('mic-test')) return;
    let cancelled = false;
    invoke('start_recording')
      .then(() => {
        if (cancelled) {
          invoke('stop_recording').catch(console.error);
          return;
        }
        isTestingRef.current = true;
        setIsTesting(true);
      })
      .catch((error) => {
        console.error(error);
        releaseMic('mic-test');
      });
    return () => {
      cancelled = true;
      if (isTestingRef.current) {
        isTestingRef.current = false;
        invoke('stop_recording').catch(console.error);
      }
      releaseMic('mic-test');
      setIsTesting(false);
    };
  }, [isOpen, step]);

  // Track when the user starts recording (for guided flow on the practice step)
  useEffect(() => {
    if (step === STEP.PRACTICE && isRecording && !hasTriedRecording) {
      setHasTriedRecording(true);
    }
  }, [step, isRecording, hasTriedRecording]);

  // Listen for transcription events in practice step
  useEffect(() => {
    if (step !== STEP.PRACTICE) return;
    const unlisten = listen<{ text: string }>('transcription-added', (event) => {
      if (event.payload?.text) {
        setPlaygroundText(event.payload.text);
        setPlaygroundSuccess(true);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [step]);

  // Track held keys during practice step for visual feedback on hotkey parts
  useEffect(() => {
    if (step !== STEP.PRACTICE || isRecordingHotkey) {
      setHeldPracticeKeys(new Set());
      return;
    }

    const hotkeyParts = hotkey.split('+');

    const onDown = (e: KeyboardEvent) => {
      const k = keyNameFromEvent(e);
      if (k && hotkeyParts.includes(k)) {
        setHeldPracticeKeys(prev => new Set(prev).add(k));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = keyNameFromEvent(e);
      if (k) {
        setHeldPracticeKeys(prev => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }
    };
    // Clear on blur (user switches windows)
    const onBlur = () => setHeldPracticeKeys(new Set());

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [step, isRecordingHotkey, hotkey]);

  const handleDeviceChange = useCallback(async (deviceName: string) => {
    setSelectedDevice(deviceName);
    localStorage.setItem('abe_audio_device', deviceName);
    try {
      await invoke('set_audio_device', { deviceName: deviceName || null });
      if (isTestingRef.current) {
        await invoke('stop_recording');
        await invoke('start_recording');
      }
    } catch (err) {
      console.error('Failed to set audio device:', err);
    }
  }, []);


  const handlePushToTalkChange = useCallback((enabled: boolean) => {
    setPushToTalk(enabled);
    localStorage.setItem(STORAGE_KEYS.PUSH_TO_TALK, String(enabled));
    invoke('set_push_to_talk', { enabled }).catch(console.error);
  }, []);

  const nextStep = () => setStep(s => Math.min(s + 1, TOTAL_STEPS - 1));
  const prevStep = () => setStep(s => Math.max(s - 1, 0));

  if (!isOpen) return null;

  const isDownloading = !!engineDetail?.includes('downloading');

  // Determine the guided state for the practice step
  const practiceState: 'waiting' | 'recording' | 'processing' | 'success' =
    playgroundSuccess ? 'success' :
    isProcessing ? 'processing' :
    isRecording ? 'recording' :
    'waiting';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-surface/95 backdrop-blur-sm">
      <div className="relative w-full max-w-[440px] mx-4 bg-surface-container rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? 'bg-primary w-6'
                    : i < step
                    ? 'bg-primary/50 w-4'
                    : 'bg-outline-variant/20 w-4'
                }`}
              />
            ))}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant"
            title="Close (you can finish setup later)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">

          {/* ===== Step 1: Welcome ===== */}
          {step === 0 && (
            <div className="flex flex-col items-center text-center py-6 gap-4">
              <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center shadow-glow-primary">
                <Mic className="w-8 h-8 text-on-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-on-surface">Welcome to Abe</h2>
                <p className="text-sm text-on-surface-variant mt-2">
                  Voice-to-text that types as you speak. Free, open source, and no account needed.
                </p>
              </div>
              <div className="space-y-2 text-left w-full">
                <div className="flex items-start gap-2.5 bg-surface-container-high/50 rounded-xl p-3">
                  <Keyboard className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-on-surface">Press a hotkey, speak, done</p>
                    <p className="text-[10px] text-on-surface-variant">Text appears wherever your cursor is</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 bg-surface-container-high/50 rounded-xl p-3">
                  <Shield className="w-4 h-4 text-tertiary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-on-surface">Privacy by design</p>
                    <p className="text-[10px] text-on-surface-variant">Abe has no servers and no telemetry. Audio is processed on your device, or sent straight to the provider you choose.</p>
                  </div>
                </div>
              </div>
              <button
                onClick={nextStep}
                className="w-full mt-2 py-2.5 rounded-xl gradient-primary text-on-primary font-medium text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                Let's get set up
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ===== Step 3: Microphone ===== */}
          {step === STEP.MIC && (
            <div className="flex flex-col gap-4 py-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Mic className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-on-surface">Choose your microphone</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Select your mic and speak to make sure it's working
                </p>
              </div>

              <select
                value={selectedDevice}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="w-full bg-surface-container-high text-on-surface text-sm rounded-xl px-3 py-2.5 border border-outline-variant/20 focus:border-primary focus:outline-none transition-colors"
              >
                <option value="">System Default</option>
                {audioDevices.map((device) => (
                  <option key={device} value={device}>{device === 'pipewire' ? 'PipeWire (system microphone)' : device}</option>
                ))}
              </select>

              <p className="text-[11px] text-on-surface-variant">
                System Default follows the microphone selected in your desktop's sound settings.
              </p>

              {/* Audio level meter */}
              <div className="space-y-2">
                <p className="text-[10px] text-on-surface-variant text-center">
                  Speak now to test your microphone
                </p>
                <div className="w-full h-3 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-75"
                    style={{
                      width: `${Math.min(100, audioLevel * 200)}%`,
                      backgroundColor: audioLevel > 0.3 ? 'var(--md-sys-color-tertiary, #4CAF50)' : audioLevel > 0.05 ? 'var(--md-sys-color-primary, #6750A4)' : 'var(--md-sys-color-outline-variant, #999)',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-outline">
                  <span>Quiet</span>
                  <span>{audioLevel > 0.05 ? 'Mic is working!' : 'No audio detected'}</span>
                  <span>Loud</span>
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <button onClick={prevStep} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-colors">
                  Back
                </button>
                <button onClick={nextStep} className="flex-1 py-2 rounded-xl gradient-primary text-on-primary font-medium text-sm hover:brightness-110 transition-all">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ===== Step 2: Choose how Abe transcribes ===== */}
          {step === STEP.ENGINE && (
            <div className="flex flex-col gap-4 py-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Cpu className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-on-surface">Choose how Abe transcribes</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Run Whisper on this computer for free, or use your own API key for speed on any machine.
                  You can change this any time in Settings.
                </p>
              </div>

              <EngineSettings onCanContinueChange={setEngineCanContinue} />

              {engineCanContinue && engineStatus?.mode === 'local' && !engineReady && (
                <p className="text-[10px] text-on-surface-variant text-center">
                  You can continue while the model downloads. Recording starts working once it's done.
                </p>
              )}

              <div className="flex gap-2 mt-1">
                <button onClick={prevStep} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-colors">
                  Back
                </button>
                <button
                  onClick={nextStep}
                  disabled={!engineCanContinue}
                  className="flex-1 py-2 rounded-xl gradient-primary text-on-primary font-medium text-sm hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                >
                  Continue
                </button>
              </div>
              {!engineCanContinue && (
                <div className="text-center -mt-2">
                  <p className="text-[10px] text-outline">
                    {engineStatus?.mode === 'cloud'
                      ? 'Save and test your key to continue.'
                      : engineStatus?.mode === 'local'
                      ? 'Download a model to continue.'
                      : 'Pick one to continue.'}
                  </p>
                  <button onClick={nextStep} className="text-[10px] text-on-surface-variant hover:text-on-surface underline mt-1">
                    Skip for now
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== Step 4: Hotkey + Practice ===== */}
          {step === STEP.PRACTICE && (
            <div className="flex flex-col gap-4 py-4">
              {/* Title area */}
              <div className="text-center">
                <h2 className="text-lg font-bold text-on-surface">
                  {practiceState === 'waiting' && !hasTriedRecording ? (needsDesktopShortcuts ? 'Try dictation' : 'Try your hotkey') :
                   practiceState === 'waiting' && hasTriedRecording ? 'Try again or continue' :
                   practiceState === 'recording' ? 'Listening...' :
                   practiceState === 'processing' ? 'Transcribing...' :
                   'It works!'}
                </h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  {needsDesktopShortcuts ? 'Click to start recording, speak, then click again to stop.' :
                   practiceState === 'waiting' && !hasTriedRecording ? 'Press your hotkey to start recording, then speak' :
                   practiceState === 'waiting' && hasTriedRecording ? 'Press the hotkey again to try once more' :
                   practiceState === 'recording' ? (pushToTalk ? 'Release the hotkey when you\'re done speaking' : 'Press the hotkey again to stop') :
                   practiceState === 'processing' ? 'Converting your speech to text...' :
                   'Your voice was transcribed successfully'}
                </p>
              </div>

              {needsDesktopShortcuts && (
                <div className="space-y-2">
                  <button
                    onClick={() => { void emit('toggle-recording'); }}
                    disabled={!engineReady || isProcessing}
                    className="w-full py-3 rounded-xl gradient-primary text-on-primary font-medium text-sm disabled:opacity-50"
                  >
                    {isRecording ? 'Stop recording' : 'Start recording'}
                  </button>
                  <p className="text-[11px] text-on-surface-variant text-center">
                    Wayland shortcuts are configured in your desktop. You can also use Abe's tray menu.
                  </p>
                </div>
              )}

              {/* Hotkey display — prominent, with animated prompt */}
              <div className={`${needsDesktopShortcuts ? 'hidden' : ''} relative rounded-2xl p-5 text-center transition-all duration-300 ${
                isRecordingHotkey
                  ? 'bg-tertiary/10 border-2 border-tertiary/30'
                  : practiceState === 'recording'
                  ? 'bg-error/10 border-2 border-error/30'
                  : practiceState === 'success'
                  ? 'bg-tertiary/10 border-2 border-tertiary/20'
                  : 'bg-surface-container-high border-2 border-primary/20'
              }`}>
                {isRecordingHotkey ? (
                  <>
                    <div className="text-xl font-mono font-bold text-tertiary animate-pulse">
                      {hotkeyPreview || 'Press your keys...'}
                    </div>
                    <p className="text-[10px] text-on-surface-variant mt-2">
                      Press the key combination you want, then release all keys
                    </p>
                    <button onClick={cancelHotkeyRecording} className="mt-2 text-[10px] text-error hover:text-error/80">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-center gap-1.5">
                      {hotkey.split('+').map((part, i, arr) => (
                        <span key={part} className="flex items-center gap-1.5">
                          <span className={`inline-block px-3 py-1.5 rounded-lg font-mono font-bold text-lg transition-all duration-150 ${
                            practiceState === 'recording'
                              ? 'bg-error/20 text-error border border-error/30'
                              : practiceState === 'success'
                              ? 'bg-tertiary/20 text-tertiary border border-tertiary/30'
                              : heldPracticeKeys.has(part)
                              ? 'bg-tertiary/20 text-tertiary border border-tertiary/40 scale-95'
                              : 'bg-surface-container-highest/50 text-primary border border-outline-variant/20'
                          }`}>
                            {formatKeyDisplay(part)}
                          </span>
                          {i < arr.length - 1 && (
                            <span className={`text-sm transition-colors ${
                              practiceState === 'recording' ? 'text-error/40' :
                              practiceState === 'success' ? 'text-tertiary/40' :
                              'text-outline-variant'
                            }`}>+</span>
                          )}
                        </span>
                      ))}
                    </div>
                    {/* Animated prompt ring for waiting state */}
                    {practiceState === 'waiting' && !hasTriedRecording && (
                      <div className="mt-3 flex items-center justify-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                    {practiceState === 'recording' && (
                      <div className="mt-3 flex items-center justify-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
                        <span className="text-[10px] text-error font-medium">Recording</span>
                      </div>
                    )}
                    {practiceState === 'processing' && (
                      <div className="mt-3 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      </div>
                    )}
                    {practiceState === 'success' && (
                      <div className="mt-2">
                        <CheckCircle className="w-5 h-5 text-tertiary mx-auto" />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* What to say */}
              {!playgroundText && engineReady && (
                <div className="rounded-xl bg-surface-container-high/50 p-3 text-center">
                  <p className="text-[10px] text-outline uppercase tracking-wider">Try saying</p>
                  <p className="text-sm text-on-surface mt-1">“{PRACTICE_PHRASE}”</p>
                </div>
              )}

              {/* Engine not ready yet (still downloading, or skipped) */}
              {!engineReady && (
                <div className="rounded-xl bg-tertiary/10 p-3 flex items-start gap-2">
                  {isDownloading
                    ? <Loader2 className="w-4 h-4 text-tertiary animate-spin flex-shrink-0 mt-0.5" />
                    : <AlertTriangle className="w-4 h-4 text-tertiary flex-shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <p className="text-xs text-on-surface">
                      {isDownloading ? 'Waiting for the model to finish downloading...' : "Transcription isn't set up yet."}
                    </p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">
                      {isDownloading
                        ? 'Recording will be available as soon as it is ready.'
                        : engineDetail ?? 'Go back to choose local or cloud.'}
                    </p>
                    {!isDownloading && (
                      <button onClick={() => setStep(STEP.ENGINE)} className="text-[10px] text-primary hover:underline mt-1">
                        Back to transcription setup
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Last transcription failed */}
              {engineError && !playgroundSuccess && practiceState === 'waiting' && (
                <div className="rounded-xl bg-error/10 p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-error flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-error">{engineError.userMessage}</p>
                    {engineError.pointsToSettings && (
                      <button onClick={() => setStep(STEP.ENGINE)} className="text-[10px] text-primary hover:underline mt-1">
                        Back to transcription setup
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Transcription result */}
              {(playgroundText || practiceState === 'processing') && (
                <div className={`w-full rounded-xl p-3 transition-all ${
                  playgroundText ? 'bg-primary/5 border border-primary/20' : 'bg-surface-container-high/30 border border-transparent'
                }`}>
                  {playgroundText ? (
                    <p className="text-sm text-on-surface">{playgroundText}</p>
                  ) : (
                    <p className="text-xs text-on-surface-variant text-center italic">Transcribing...</p>
                  )}
                </div>
              )}

              {/* Options — collapsed by default */}
              <button
                onClick={() => setShowHotkeyOptions(!showHotkeyOptions)}
                className={`${needsDesktopShortcuts ? 'hidden' : ''} flex items-center justify-center gap-1.5 text-[10px] text-on-surface-variant hover:text-on-surface transition-colors`}
              >
                <Settings className="w-3 h-3" />
                <span>{showHotkeyOptions ? 'Hide options' : 'Change hotkey or mode'}</span>
                <svg className={`w-3 h-3 transition-transform ${showHotkeyOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showHotkeyOptions && (
                <div className="space-y-2">
                  {/* Change hotkey */}
                  <button
                    onClick={startHotkeyRecording}
                    className="w-full flex items-center justify-between bg-surface-container-high/50 rounded-xl p-3 hover:bg-surface-container-high transition-colors"
                  >
                    <span className="text-xs text-on-surface">Change hotkey</span>
                    <span className="text-xs text-primary font-mono">{formatHotkeyDisplay(hotkey)}</span>
                  </button>
                  {/* Push to Talk toggle */}
                  <div className="flex items-center justify-between bg-surface-container-high/50 rounded-xl p-3">
                    <div>
                      <p className="text-xs text-on-surface">Push to Talk</p>
                      <p className="text-[9px] text-on-surface-variant">
                        {pushToTalk ? 'Hold to record, release to stop' : 'Press to start, press again to stop'}
                      </p>
                    </div>
                    <button
                      onClick={() => handlePushToTalkChange(!pushToTalk)}
                      className={`relative w-9 h-[18px] rounded-full transition-colors ${
                        pushToTalk ? 'bg-primary' : 'bg-surface-container-highest'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all ${
                        pushToTalk ? 'left-[18px]' : 'left-0.5'
                      }`} />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={prevStep} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-colors">
                  Back
                </button>
                {playgroundSuccess ? (
                  <button onClick={nextStep} className="flex-1 py-2 rounded-xl gradient-primary text-on-primary font-medium text-sm hover:brightness-110 transition-all">
                    Continue
                  </button>
                ) : (
                  <button onClick={nextStep} className="flex-1 py-2 text-sm text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-colors">
                    Skip for now
                  </button>
                )}
              </div>
              {playgroundSuccess && (
                <p className="text-[10px] text-on-surface-variant text-center">
                  {needsDesktopShortcuts ? 'Record again to try another transcription, or continue' : 'Press your hotkey again to try another transcription, or continue'}
                </p>
              )}
            </div>
          )}

          {/* ===== Step 5: Done! ===== */}
          {step === STEP.DONE && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 rounded-full bg-tertiary/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-tertiary" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-on-surface">You're all set!</h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Here's a summary of your setup
                </p>
              </div>
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between bg-surface-container-high/50 rounded-xl p-3">
                  <span className="text-xs text-on-surface-variant">Microphone</span>
                  <span className="text-xs font-medium text-on-surface truncate ml-2">{selectedDevice || 'System Default'}</span>
                </div>
                <div className="flex items-center justify-between bg-surface-container-high/50 rounded-xl p-3">
                  <span className="text-xs text-on-surface-variant">Hotkey</span>
                  <span className="text-xs font-mono font-medium text-primary">{needsDesktopShortcuts ? 'Set in your desktop' : formatHotkeyDisplay(hotkey)}</span>
                </div>
                <div className="flex items-center justify-between bg-surface-container-high/50 rounded-xl p-3">
                  <span className="text-xs text-on-surface-variant">Mode</span>
                  <span className="text-xs font-medium text-on-surface">{!needsDesktopShortcuts && pushToTalk ? 'Push to Talk' : 'Toggle'}</span>
                </div>
                <div className="flex items-center justify-between bg-surface-container-high/50 rounded-xl p-3">
                  <span className="text-xs text-on-surface-variant">Transcription</span>
                  <span className={`text-xs font-medium ${engineReady ? 'text-tertiary' : 'text-on-surface-variant'}`}>
                    {engineReady
                      ? engineStatus?.provider ?? 'Ready'
                      : isDownloading ? 'Downloading model...' : 'Not set up yet'}
                  </span>
                </div>
              </div>

              <div className="w-full space-y-1.5">
                <p className="text-[10px] text-outline uppercase tracking-wider">Tips</p>
                <div className="flex items-start gap-2 text-[11px] text-on-surface-variant">
                  <Clipboard className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-px" />
                  <span>
                    <span className="font-mono text-primary">{formatHotkeyDisplay(getPasteLastHotkey())}</span> pastes your last transcription again.
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-on-surface-variant">
                  <Wand2 className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-px" />
                  <span>
                    {engineStatus?.transformReady ? (
                      <>Select text and hold <span className="font-mono text-primary">{formatHotkeyDisplay(getTransformHotkey())}</span>, then say “make it shorter” or “translate to Spanish”.</>
                    ) : (
                      <>Transform rewrites selected text by voice. It needs a cloud or custom model: set it up in Settings → Transform.</>
                    )}
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-on-surface-variant">
                  <BookA className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-px" />
                  <span>Fix a word in a recent transcription on the Home tab and Abe offers to remember the correction.</span>
                </div>
              </div>

              <button
                onClick={onComplete}
                className="w-full mt-1 py-2.5 rounded-xl gradient-primary text-on-primary font-medium text-sm hover:brightness-110 transition-all"
              >
                Start transcribing
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
