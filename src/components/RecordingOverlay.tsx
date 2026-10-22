import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import useEngineStatus from '../hooks/useEngineStatus';
import { formatSessionDuration } from './SessionClock';

const appWindow = getCurrentWebviewWindow();

function formatElapsedTime(seconds: number): string {
  return formatSessionDuration(seconds * 1000);
}

export default function RecordingOverlay() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTransformRecording, setIsTransformRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTransformProcessing, setIsTransformProcessing] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  // Blocked attempts and engine errors, with an optional second line saying how to fix it
  const [errorMessage, setErrorMessage] = useState<{ message: string; hint?: string } | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(20).fill(4));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Lock state is managed by interaction overlay, but we still display it
  const [isLocked, setIsLocked] = useState(() => {
    return localStorage.getItem('abe_overlay_locked') === 'true';
  });
  const [isHovering, setIsHovering] = useState(false);
  const { status: engineStatus, isChecking: isCheckingEngine } = useEngineStatus();
  const levelsRef = useRef<number[]>(Array(20).fill(4));

  // Hide scrollbars and set transparent background for overlay window
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    const root = document.getElementById('root');
    if (root) {
      root.style.overflow = 'hidden';
      root.style.background = 'transparent';
      root.style.height = '100%';
      root.style.width = '100%';
    }
  }, []);

  // Poll audio levels when recording (either regular or transform)
  const isAnyRecording = isRecording || isTransformRecording;

  // One poll loop per recording, stopped when recording ends (F3)
  useEffect(() => {
    if (!isAnyRecording) {
      // Reset levels when not recording
      levelsRef.current = Array(20).fill(4);
      setAudioLevels(Array(20).fill(4));
      setElapsedSeconds(0);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const level = await invoke<number>('get_audio_level');
        if (cancelled) return;
        // Convert level (0-1) to pixel height (4-40), shift left and add the new level
        levelsRef.current = [...levelsRef.current.slice(1), 4 + level * 36];
        setAudioLevels(levelsRef.current);
      } catch (error) {
        console.error('Failed to get audio level:', error);
      }
      if (!cancelled) pollTimer = setTimeout(poll, 50);
    };
    poll();

    // Elapsed time
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timerInterval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearInterval(timerInterval);
    };
  }, [isAnyRecording]);

  useEffect(() => {
    // Listen for regular recording state changes from main window
    const unlistenStart = listen('overlay-recording-start', () => {
      setIsRecording(true);
      setIsProcessing(false);
      setWarningMessage(null);  // Clear any existing warning
      setErrorMessage(null);    // Clear any existing error
    });

    const unlistenStop = listen('overlay-recording-stop', () => {
      setIsRecording(false);
      setIsProcessing(false);
    });

    const unlistenProcessing = listen('overlay-processing', () => {
      setIsRecording(false);
      setIsProcessing(true);
    });

    // Listen for transform recording state changes
    const unlistenTransformStart = listen('overlay-transform-start', () => {
      setIsTransformRecording(true);
      setIsTransformProcessing(false);
      setWarningMessage(null);  // Clear any existing warning
      setErrorMessage(null);    // Clear any existing error
    });

    const unlistenTransformStop = listen('overlay-transform-stop', () => {
      setIsTransformRecording(false);
      setIsTransformProcessing(false);
    });

    const unlistenTransformProcessing = listen('overlay-transform-processing', () => {
      setIsTransformRecording(false);
      setIsTransformProcessing(true);
    });

    // Show a transient message; a newer message replaces the older one and its timer
    const showMessage = (apply: () => void, clear: () => void, ms: number) => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      setIsRecording(false);
      setIsTransformRecording(false);
      setIsProcessing(false);
      setIsTransformProcessing(false);
      setWarningMessage(null);
      setErrorMessage(null);
      apply();
      messageTimerRef.current = setTimeout(() => {
        messageTimerRef.current = null;
        clear();
      }, ms);
    };

    const unlistenWarning = listen<{ message: string }>('overlay-warning', (event) => {
      showMessage(() => setWarningMessage(event.payload.message), () => setWarningMessage(null), 2500);
    });

    // Recording attempts that can't start (engine or transform not set up)
    const unlistenBlocked = listen<{ reason: string; hint?: string }>('overlay-blocked', (event) => {
      const { reason, hint } = event.payload;
      showMessage(() => setErrorMessage({ message: reason, hint }), () => setErrorMessage(null), 4000);
    });

    // Provider / engine errors after a recording
    const unlistenError = listen<{ message: string; hint?: string }>('overlay-error', (event) => {
      const { message, hint } = event.payload;
      showMessage(() => setErrorMessage({ message, hint }), () => setErrorMessage(null), 5000);
    });

    // Listen for hover state from interaction overlay
    const unlistenHover = listen<{ hovering: boolean }>('overlay-hover', (event) => {
      setIsHovering(event.payload.hovering);
    });

    return () => {
      unlistenStart.then(fn => fn());
      unlistenStop.then(fn => fn());
      unlistenProcessing.then(fn => fn());
      unlistenTransformStart.then(fn => fn());
      unlistenTransformStop.then(fn => fn());
      unlistenTransformProcessing.then(fn => fn());
      unlistenWarning.then(fn => fn());
      unlistenBlocked.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenHover.then(fn => fn());
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  // Set ignore cursor events so clicks pass through to apps behind
  // The interaction overlay (separate window) handles mouse events for dragging
  useEffect(() => {
    appWindow.setIgnoreCursorEvents(true).catch(console.error);
  }, []);

  // Listen for lock state changes from interaction overlay (via localStorage)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'abe_overlay_locked') {
        setIsLocked(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Determine if we're in active state (recording, processing, warning, or showing error)
  const isActive = isRecording || isTransformRecording || isProcessing || isTransformProcessing || !!warningMessage || !!errorMessage;
  const isAnyProcessing = isProcessing || isTransformProcessing;

  // Idle pill state: engine not ready is the only "issue"
  const hasIssue = !isCheckingEngine && !engineStatus?.ready;

  // Mini indicator when idle (always visible, small pill)
  // Note: Mouse events are handled by the interaction overlay, this overlay has setIgnoreCursorEvents(true)
  if (!isActive) {
    let statusColor = 'bg-tertiary';
    let statusText = 'Ready';
    const borderColor = 'ghost-border';

    if (isCheckingEngine) {
      statusColor = 'bg-outline';
      statusText = 'Abe';
    } else if (!engineStatus?.ready) {
      statusColor = 'bg-yellow-500';
      statusText = engineStatus?.mode === 'cloud' ? 'No API key'
        : engineStatus?.mode === 'local' ? (engineStatus.detail?.includes('downloading') ? 'Downloading' : 'No model')
        : 'Set up';
    } else if (engineStatus.mode === 'local') {
      statusText = 'Local';
    }

    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-1 select-none">
        <div
          className={`bg-surface/90 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2 shadow-lg ${borderColor} relative transition-all duration-150`}
        >
          {/* App icon/indicator */}
          <div className={`w-2 h-2 ${statusColor} rounded-full ${hasIssue ? 'animate-pulse' : ''}`} title={`Abe - ${statusText}`} />
          <span className={`text-xs ${
            hasIssue ? 'text-yellow-400' : 'text-on-surface-variant'
          } group-hover:text-on-surface transition-colors`}>
            {statusText}
          </span>

          {/* Click hint for issue states */}
          {hasIssue && (
            <svg className="w-3 h-3 text-outline group-hover:text-on-surface transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          )}

          {/* Lock indicator */}
          {isLocked && !hasIssue && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-surface-container-high rounded-full flex items-center justify-center" title="Position locked (right-click to unlock)">
              <svg className="w-2 h-2 text-on-surface-variant" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>
        {/* Hover hint - shown below the pill */}
        {isHovering && !isLocked && (
          <div className="text-[10px] text-on-surface-variant mt-1 bg-surface/95 px-2 py-0.5 rounded-full ghost-border whitespace-nowrap">
            Right-click to lock
          </div>
        )}
        {isHovering && isLocked && (
          <div className="text-[10px] text-on-surface-variant mt-1 bg-surface/95 px-2 py-0.5 rounded-full ghost-border whitespace-nowrap">
            Right-click to unlock
          </div>
        )}
      </div>
    );
  }

  // Full overlay when active
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-1 select-none">
      <div
        className={`bg-surface/95 backdrop-blur-sm rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl relative transition-all duration-150
          ${errorMessage ? 'border border-error/70' : 'ghost-border'}
        `}
      >
        {/* Recording indicator */}
        <div className="flex items-center gap-2">
          {isRecording && (
            <div className="w-3 h-3 bg-error rounded-full animate-pulse" />
          )}
          {isTransformRecording && (
            <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse" />
          )}
          {isProcessing && (
            <div className="w-3 h-3 bg-primary rounded-full animate-pulse" />
          )}
          {isTransformProcessing && (
            <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse" />
          )}
        </div>

        {/* Waveform visualization - purple bars for transform */}
        {isAnyRecording && (
          <div className="flex items-center gap-0.5 h-10">
            {audioLevels.map((height, i) => (
              <div
                key={i}
                className={`w-1 ${isTransformRecording ? 'bg-primary-container' : 'bg-primary'} rounded-full transition-all duration-75`}
                style={{
                  height: `${Math.max(4, height)}px`,
                  animationDelay: `${i * 20}ms`,
                }}
              />
            ))}
          </div>
        )}

        {/* Processing spinner */}
        {isAnyProcessing && (
          <div className="flex items-center gap-2">
            <svg
              className={`animate-spin h-5 w-5 ${isTransformProcessing ? 'text-primary-container' : 'text-primary'}`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm text-on-surface">
              {isTransformProcessing ? 'Transforming...' : 'Transcribing...'}
            </span>
          </div>
        )}

        {/* Status text with elapsed time */}
        {isRecording && (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-sm text-on-surface">Recording</span>
            <span className="text-sm text-on-surface-variant font-mono">{formatElapsedTime(elapsedSeconds)}</span>
          </div>
        )}
        {isTransformRecording && (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-sm text-primary-container">Transform</span>
            <span className="text-sm text-on-surface-variant font-mono">{formatElapsedTime(elapsedSeconds)}</span>
          </div>
        )}

        {/* Warning message */}
        {warningMessage && (
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm text-yellow-300">{warningMessage}</span>
          </div>
        )}

        {/* Error/blocked message */}
        {errorMessage && (
          <div className="flex items-center gap-2 max-w-[270px]">
            <svg className="w-5 h-5 text-error flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <div className="min-w-0">
              <p className="text-xs text-error leading-snug">{errorMessage.message}</p>
              {errorMessage.hint && <p className="text-[10px] text-on-surface-variant leading-snug">{errorMessage.hint}</p>}
            </div>
          </div>
        )}

        {/* Lock indicator */}
        {isLocked && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-surface-container-high rounded-full flex items-center justify-center" title="Position locked (right-click to unlock)">
            <svg className="w-2.5 h-2.5 text-on-surface-variant" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
