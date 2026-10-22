import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { DebugLogger } from './DebugLogger';
import useHotkeyCapture from '../hooks/useHotkeyCapture';
import EngineSettings from './EngineSettings';
import TransformSettings from './TransformSettings';
import { wordDictionary, DictionaryEntry } from '../services/wordDictionary';
import { openIssueReport } from '../services/appInfo';
import { formatHotkeyDisplay, getPushToTalk, getHotkey, getPasteLastHotkey, getTransformHotkey } from '../utils';
import {
  DEFAULT_HOTKEY,
  DEFAULT_PASTE_LAST_HOTKEY,
  DEFAULT_TRANSFORM_HOTKEY,
  DEFAULT_PUSH_TO_TALK,
  DEFAULT_SOUND_ENABLED,
  DEFAULT_OVERLAY_ENABLED,
  DEFAULT_MIN_DURATION,
  DEFAULT_MAX_DURATION,
  DEFAULT_OTHER_APPS_VOLUME,
  DEFAULT_TRANSCRIPTION_STYLE,
  DEFAULT_TRANSCRIPTION_LANGUAGE,
  DEFAULT_OUTPUT_MODE,
  DEFAULT_TYPING_SPEED,
} from '../constants';

// Reusable info tooltip component (module level, so it keeps its identity across renders)
function InfoTooltip({ content, show, onToggle }: { content: React.ReactNode; show: boolean; onToggle: (show: boolean) => void }) {
  return (
    <div
      className="relative"
      onMouseEnter={() => onToggle(true)}
      onMouseLeave={() => onToggle(false)}
    >
      <button
        className="text-outline hover:text-on-surface transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
      </button>
      {show && (
        <div className="absolute left-0 bottom-full pb-2 z-50">
          <div className="w-52 p-2 bg-surface glass rounded-xl shadow-lg relative">
            {content}
            <div className="absolute left-3 bottom-[-6px] w-2 h-2 bg-surface rotate-45"></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Toggle component for consistency
function Toggle({ enabled, onChange, disabled = false }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative w-9 h-[18px] rounded-full transition-colors ${
        disabled ? 'bg-surface-container-high cursor-not-allowed opacity-50' : enabled ? 'bg-primary' : 'bg-surface-container-highest'
      }`}
    >
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
        enabled && !disabled ? 'left-[18px]' : 'left-0.5'
      }`} />
    </button>
  );
}

type HotkeyTarget = 'recording' | 'paste-last' | 'transform';

interface SettingsPanelProps {
  onOpenOnboarding?: () => void;
  /** Scroll to and highlight the transcription engine section on mount. */
  focusEngine?: boolean;
}

export default function SettingsPanel({ onOpenOnboarding, focusEngine = false }: SettingsPanelProps = {}) {
  const engineSectionRef = useRef<HTMLDivElement>(null);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>(() =>
    localStorage.getItem('abe_audio_device') || ''
  );
  const [hotkey, setHotkey] = useState(getHotkey);
  const [pasteLastHotkey, setPasteLastHotkey] = useState(getPasteLastHotkey);
  const [transformHotkey, setTransformHotkey] = useState(getTransformHotkey);
  const [hotkeyStatus, setHotkeyStatus] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<string>('');
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pushToTalk, setPushToTalk] = useState(getPushToTalk);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('abe_sound_enabled') !== 'false');
  const [overlayEnabled, setOverlayEnabled] = useState(() => localStorage.getItem('abe_overlay_enabled') !== 'false');
  const [minDuration, setMinDuration] = useState(() => parseFloat(localStorage.getItem('abe_min_duration') || '0'));
  const [maxDuration, setMaxDuration] = useState(() => parseFloat(localStorage.getItem('abe_max_duration') || '300'));
  const [otherAppsVolume, setOtherAppsVolume] = useState(() => parseInt(localStorage.getItem('abe_other_apps_volume') || '20', 10));
  const [transformPrompt, setTransformPrompt] = useState(() =>
    localStorage.getItem('abe_transform_prompt') || ''
  );
  const [transcriptionStyle, setTranscriptionStyle] = useState<'formal' | 'balanced' | 'relaxed'>(() =>
    (localStorage.getItem('abe_transcription_style') as 'formal' | 'balanced' | 'relaxed') || 'balanced'
  );
  const [showTranscriptionStyleInfo, setShowTranscriptionStyleInfo] = useState(false);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState(() =>
    localStorage.getItem('abe_transcription_language') || 'en'
  );
  const [showLanguageInfo, setShowLanguageInfo] = useState(false);
  const [outputMode, setOutputMode] = useState<'instant' | 'typewriter'>(() =>
    (localStorage.getItem('abe_output_mode') as 'instant' | 'typewriter') || 'instant'
  );
  const [typingSpeed, setTypingSpeed] = useState(() =>
    parseInt(localStorage.getItem('abe_typing_speed') || '1500', 10)
  );
  const [showTypingInfo, setShowTypingInfo] = useState(false);
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);
  // Tooltip states for settings hints
  const [showPushToTalkInfo, setShowPushToTalkInfo] = useState(false);
  const [showMinDurationInfo, setShowMinDurationInfo] = useState(false);
  const [showMaxDurationInfo, setShowMaxDurationInfo] = useState(false);
  const [showAudioDuckingInfo, setShowAudioDuckingInfo] = useState(false);
  const [showSoundEffectsInfo, setShowSoundEffectsInfo] = useState(false);
  const [showRecordingIndicatorInfo, setShowRecordingIndicatorInfo] = useState(false);
  const [showIndicatorPositionInfo, setShowIndicatorPositionInfo] = useState(false);
  const [showTransformPromptInfo, setShowTransformPromptInfo] = useState(false);
  const [showTypingSpeedInfo, setShowTypingSpeedInfo] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const debugClicksRef = useRef(0);
  const debugClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Word Dictionary state
  const [showDictionary, setShowDictionary] = useState(false);
  const [dictionaryEntries, setDictionaryEntries] = useState<DictionaryEntry[]>([]);
  const [newDictFrom, setNewDictFrom] = useState('');
  const [newDictTo, setNewDictTo] = useState('');
  const [editingDictEntry, setEditingDictEntry] = useState<string | null>(null);
  const [editingDictFrom, setEditingDictFrom] = useState('');
  const [editingDictTo, setEditingDictTo] = useState('');

  // Load dictionary entries when section is shown
  useEffect(() => {
    if (showDictionary) {
      setDictionaryEntries(wordDictionary.getDictionary());
    }
  }, [showDictionary]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);

  useEffect(() => {
    if (focusEngine) {
      engineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusEngine]);

  useEffect(() => {
    // Load saved device from localStorage
    const saved = localStorage.getItem('abe_audio_device');
    if (saved) {
      setSelectedDevice(saved);
    }

    // Load sound setting (default true)
    const soundSaved = localStorage.getItem('abe_sound_enabled');
    setSoundEnabled(soundSaved !== 'false');

    // Load overlay setting (default true)
    const overlaySaved = localStorage.getItem('abe_overlay_enabled');
    setOverlayEnabled(overlaySaved !== 'false');

    // Load duration settings
    const minSaved = localStorage.getItem('abe_min_duration');
    if (minSaved) setMinDuration(parseFloat(minSaved));
    const maxSaved = localStorage.getItem('abe_max_duration');
    if (maxSaved) setMaxDuration(parseFloat(maxSaved));

    // Load other apps volume setting (default 100 = no reduction)
    const volumeSaved = localStorage.getItem('abe_other_apps_volume');
    if (volumeSaved) setOtherAppsVolume(parseInt(volumeSaved, 10));

    // Load custom transform prompt
    const savedTransformPrompt = localStorage.getItem('abe_transform_prompt');
    if (savedTransformPrompt) {
      setTransformPrompt(savedTransformPrompt);
    }

    // Load audio devices
    invoke('get_audio_devices')
      .then((devices) => setAudioDevices(devices as string[]))
      .catch(console.error);

    // Load transcription style (controls Whisper prompt for formatting)
    const transcriptionStyleSaved = localStorage.getItem('abe_transcription_style');
    if (transcriptionStyleSaved && ['formal', 'balanced', 'relaxed'].includes(transcriptionStyleSaved)) {
      setTranscriptionStyle(transcriptionStyleSaved as 'formal' | 'balanced' | 'relaxed');
    }

    // Load transcription language
    const transcriptionLanguageSaved = localStorage.getItem('abe_transcription_language');
    if (transcriptionLanguageSaved) {
      setTranscriptionLanguage(transcriptionLanguageSaved);
    }

    // Load output mode settings (default: instant)
    const outputModeSaved = localStorage.getItem('abe_output_mode');
    if (outputModeSaved && ['instant', 'typewriter'].includes(outputModeSaved)) {
      setOutputMode(outputModeSaved as 'instant' | 'typewriter');
    }
    const typingSpeedSaved = localStorage.getItem('abe_typing_speed');
    if (typingSpeedSaved) {
      setTypingSpeed(parseInt(typingSpeedSaved, 10));
    }
  }, []);

  const handlePushToTalkChange = async (enabled: boolean) => {
    setPushToTalk(enabled);
    localStorage.setItem('abe_push_to_talk', String(enabled));
    try {
      await invoke('set_push_to_talk', { enabled });
    } catch (error) {
      console.error('Failed to set push-to-talk:', error);
    }
  };

  const handleSoundEnabledChange = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('abe_sound_enabled', String(enabled));
  };

  const handleOverlayEnabledChange = async (enabled: boolean) => {
    setOverlayEnabled(enabled);
    localStorage.setItem('abe_overlay_enabled', String(enabled));
    // Show or hide the overlay immediately
    try {
      if (enabled) {
        await invoke('show_overlay');
      } else {
        await invoke('hide_overlay');
      }
    } catch (error) {
      console.error('Failed to toggle overlay:', error);
    }
  };

  const handleResetOverlayPosition = async () => {
    // Clear saved position from localStorage
    localStorage.removeItem('abe_overlay_position');
    // Re-show overlay which will reset it to default position (bottom center)
    try {
      if (overlayEnabled) await invoke('show_overlay', { reset: true });
    } catch (error) {
      console.error('Failed to reset overlay position:', error);
    }
  };

  const handleMinDurationChange = (value: number) => {
    setMinDuration(value);
    localStorage.setItem('abe_min_duration', String(value));
  };

  const handleMaxDurationChange = (value: number) => {
    setMaxDuration(value);
    localStorage.setItem('abe_max_duration', String(value));
  };

  const handleOtherAppsVolumeChange = (volume: number) => {
    setOtherAppsVolume(volume);
    localStorage.setItem('abe_other_apps_volume', String(volume));
  };

  const handleTransformPromptChange = (prompt: string) => {
    setTransformPrompt(prompt);
    localStorage.setItem('abe_transform_prompt', prompt);
  };

  const handleTranscriptionStyleChange = (style: 'formal' | 'balanced' | 'relaxed') => {
    setTranscriptionStyle(style);
    localStorage.setItem('abe_transcription_style', style);
  };

  const handleTranscriptionLanguageChange = (language: string) => {
    setTranscriptionLanguage(language);
    localStorage.setItem('abe_transcription_language', language);
  };

  const handleOutputModeChange = (mode: 'instant' | 'typewriter') => {
    setOutputMode(mode);
    localStorage.setItem('abe_output_mode', mode);
  };

  const handleTypingSpeedChange = (speed: number) => {
    setTypingSpeed(speed);
    localStorage.setItem('abe_typing_speed', String(speed));
  };


  const handleResetAllSettings = async () => {
    // Reset hotkeys
    setHotkey(DEFAULT_HOTKEY);
    localStorage.setItem('abe_hotkey', DEFAULT_HOTKEY);
    invoke('set_hotkey', { hotkey: DEFAULT_HOTKEY }).catch(console.error);

    setPasteLastHotkey(DEFAULT_PASTE_LAST_HOTKEY);
    localStorage.setItem('abe_paste_last_hotkey', DEFAULT_PASTE_LAST_HOTKEY);
    invoke('set_paste_last_hotkey', { hotkey: DEFAULT_PASTE_LAST_HOTKEY }).catch(console.error);

    setTransformHotkey(DEFAULT_TRANSFORM_HOTKEY);
    localStorage.setItem('abe_transform_hotkey', DEFAULT_TRANSFORM_HOTKEY);
    invoke('set_transform_hotkey', { hotkey: DEFAULT_TRANSFORM_HOTKEY }).catch(console.error);

    // Reset recording settings
    setPushToTalk(DEFAULT_PUSH_TO_TALK);
    localStorage.setItem('abe_push_to_talk', String(DEFAULT_PUSH_TO_TALK));
    invoke('set_push_to_talk', { enabled: DEFAULT_PUSH_TO_TALK }).catch(console.error);

    setMinDuration(DEFAULT_MIN_DURATION);
    localStorage.setItem('abe_min_duration', String(DEFAULT_MIN_DURATION));

    setMaxDuration(DEFAULT_MAX_DURATION);
    localStorage.setItem('abe_max_duration', String(DEFAULT_MAX_DURATION));

    setOtherAppsVolume(DEFAULT_OTHER_APPS_VOLUME);
    localStorage.setItem('abe_other_apps_volume', String(DEFAULT_OTHER_APPS_VOLUME));

    // Reset appearance settings
    setSoundEnabled(DEFAULT_SOUND_ENABLED);
    localStorage.setItem('abe_sound_enabled', String(DEFAULT_SOUND_ENABLED));

    setOverlayEnabled(DEFAULT_OVERLAY_ENABLED);
    localStorage.setItem('abe_overlay_enabled', String(DEFAULT_OVERLAY_ENABLED));
    try {
      if (DEFAULT_OVERLAY_ENABLED) {
        await invoke('show_overlay', { reset: true });
      } else {
        await invoke('hide_overlay');
      }
    } catch (e) { console.error('Failed to toggle overlay:', e); }

    // Reset output settings
    setTranscriptionStyle(DEFAULT_TRANSCRIPTION_STYLE as 'formal' | 'balanced' | 'relaxed');
    localStorage.setItem('abe_transcription_style', DEFAULT_TRANSCRIPTION_STYLE);

    setTranscriptionLanguage(DEFAULT_TRANSCRIPTION_LANGUAGE);
    localStorage.setItem('abe_transcription_language', DEFAULT_TRANSCRIPTION_LANGUAGE);

    setOutputMode(DEFAULT_OUTPUT_MODE as 'instant' | 'typewriter');
    localStorage.setItem('abe_output_mode', DEFAULT_OUTPUT_MODE);

    setTypingSpeed(DEFAULT_TYPING_SPEED);
    localStorage.setItem('abe_typing_speed', String(DEFAULT_TYPING_SPEED));

    setTransformPrompt('');
    localStorage.setItem('abe_transform_prompt', '');

    // Reset overlay position
    localStorage.removeItem('abe_overlay_position');

    setResetConfirm(false);
    flashHotkeyStatus('All settings reset!', 3000);
  };

  const handleDeviceChange = async (deviceName: string) => {
    setSelectedDevice(deviceName);
    localStorage.setItem('abe_audio_device', deviceName);

    // Tell Rust backend which device to use
    try {
      await invoke('set_audio_device', { deviceName: deviceName || null });
      setSaveStatus('Saved!');
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      console.error('Failed to set audio device:', error);
      setSaveStatus('Error saving');
    }
  };

  // Status line under the shortcuts; one timer, so an old message never clears a newer one
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashHotkeyStatus = useCallback((message: string, ms: number) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setHotkeyStatus(message);
    statusTimerRef.current = setTimeout(() => setHotkeyStatus(''), ms);
  }, []);
  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    if (debugClickTimerRef.current) clearTimeout(debugClickTimerRef.current);
  }, []);

  const saveCapturedHotkey = useCallback(async (newHotkey: string, target: HotkeyTarget) => {
    const config = {
      'recording': { command: 'set_hotkey', storageKey: 'abe_hotkey', apply: setHotkey },
      'paste-last': { command: 'set_paste_last_hotkey', storageKey: 'abe_paste_last_hotkey', apply: setPasteLastHotkey },
      'transform': { command: 'set_transform_hotkey', storageKey: 'abe_transform_hotkey', apply: setTransformHotkey },
    }[target];
    try {
      await invoke(config.command, { hotkey: newHotkey });
      config.apply(newHotkey);
      localStorage.setItem(config.storageKey, newHotkey);
      flashHotkeyStatus('Hotkey saved!', 2000);
    } catch (error: any) {
      console.error('[HOTKEY] Failed to set hotkey:', error);
      const errorMsg = typeof error === 'string' ? error : error?.message || 'Unknown error';
      flashHotkeyStatus(`Failed: ${errorMsg}`, 5000);
    }
  }, [flashHotkeyStatus]);

  // Global hotkeys are off while capturing and come back on however capture ends (F4)
  const {
    capturing: isRecordingHotkey,
    preview: hotkeyPreview,
    start: startHotkeyCapture,
    cancel: cancelRecordingHotkey,
  } = useHotkeyCapture<HotkeyTarget>(saveCapturedHotkey);

  const startRecordingHotkey = (target: HotkeyTarget) => {
    setHotkeyStatus('');
    startHotkeyCapture(target);
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-on-surface">Settings</h2>
        <p className="text-on-surface-variant text-sm">Customize your experience</p>
      </div>

      {/* ===== TRANSCRIPTION ENGINE ===== */}
      <div
        ref={engineSectionRef}
        className={`bg-surface-container rounded-xl p-3 space-y-2 scroll-mt-3 ${focusEngine ? 'ring-1 ring-primary/50' : ''}`}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-4 rounded-full bg-primary"></div>
          <h3 className="label-style text-on-surface-variant text-sm">Transcription</h3>
        </div>
        <EngineSettings />
      </div>

      {/* ===== TRANSFORM ===== */}
      <div className="bg-surface-container rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-4 rounded-full bg-primary"></div>
          <h3 className="label-style text-on-surface-variant text-sm">Transform</h3>
        </div>
        <TransformSettings />
      </div>

      {/* ===== SHORTCUTS ===== */}
      <div className="bg-surface-container rounded-xl p-3 space-y-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-4 rounded-full bg-primary"></div>
            <svg className="w-3.5 h-3.5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            <h3 className="label-style text-on-surface-variant text-sm">Shortcuts</h3>
          </div>
          {hotkeyStatus && (
            <span className={`text-xs ${hotkeyStatus.includes('Failed') ? 'text-error' : 'text-tertiary'}`}>
              {hotkeyStatus}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="text-[10px] text-outline mb-0.5 block">Record</label>
            {isRecordingHotkey === 'recording' ? (
              <div className="flex items-center gap-1">
                <span className={`flex-1 px-1 py-1 rounded text-[10px] font-mono text-center ${
                  hotkeyPreview ? 'bg-primary-container' : 'bg-primary-container/50 animate-pulse'
                }`}>
                  {hotkeyPreview ? formatHotkeyDisplay(hotkeyPreview) : '...'}
                </span>
                <button onClick={cancelRecordingHotkey} className="text-[10px] text-on-surface-variant">✕</button>
              </div>
            ) : (
              <button
                onClick={() => startRecordingHotkey('recording')}
                disabled={isRecordingHotkey !== null}
                className="w-full bg-surface-container-high hover:bg-surface-bright px-1 py-1 rounded text-[10px] font-mono transition-colors truncate"
              >
                {formatHotkeyDisplay(hotkey)}
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] text-outline mb-0.5 block">Paste Last</label>
            {isRecordingHotkey === 'paste-last' ? (
              <div className="flex items-center gap-1">
                <span className={`flex-1 px-1 py-1 rounded text-[10px] font-mono text-center ${
                  hotkeyPreview ? 'bg-primary-container' : 'bg-primary-container/50 animate-pulse'
                }`}>
                  {hotkeyPreview ? formatHotkeyDisplay(hotkeyPreview) : '...'}
                </span>
                <button onClick={cancelRecordingHotkey} className="text-[10px] text-on-surface-variant">✕</button>
              </div>
            ) : (
              <button
                onClick={() => startRecordingHotkey('paste-last')}
                disabled={isRecordingHotkey !== null}
                className="w-full bg-surface-container-high hover:bg-surface-bright px-1 py-1 rounded text-[10px] font-mono transition-colors truncate"
              >
                {formatHotkeyDisplay(pasteLastHotkey)}
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] text-outline mb-0.5 block">Transform</label>
            {isRecordingHotkey === 'transform' ? (
              <div className="flex items-center gap-1">
                <span className={`flex-1 px-1 py-1 rounded text-[10px] font-mono text-center ${
                  hotkeyPreview ? 'bg-primary-container' : 'bg-primary-container/50 animate-pulse'
                }`}>
                  {hotkeyPreview ? formatHotkeyDisplay(hotkeyPreview) : '...'}
                </span>
                <button onClick={cancelRecordingHotkey} className="text-[10px] text-on-surface-variant">✕</button>
              </div>
            ) : (
              <button
                onClick={() => startRecordingHotkey('transform')}
                disabled={isRecordingHotkey !== null}
                className="w-full bg-surface-container-high hover:bg-surface-bright px-1 py-1 rounded text-[10px] font-mono transition-colors truncate"
              >
                {formatHotkeyDisplay(transformHotkey)}
              </button>
            )}
          </div>
        </div>
        {isRecordingHotkey && (
          <p className="text-[10px] text-outline">Press keys, release all to save. Esc cancels.</p>
        )}
        <p className="text-[10px] text-outline">Click a shortcut to change it. Supports keyboard & mouse buttons.</p>
      </div>

      {/* ===== CORE SETTINGS ===== */}
      <div className="bg-surface-container rounded-xl p-3 space-y-2.5">
        {/* Language Selection */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            <span className="text-xs text-on-surface-variant">Language</span>
            <InfoTooltip
              show={showLanguageInfo}
              onToggle={setShowLanguageInfo}
              content={
                <>
                  <p className="text-[10px] text-on-surface leading-relaxed">
                    <strong className="text-on-surface">Select your language</strong> for best transcription accuracy.
                  </p>
                  <p className="text-[10px] text-on-surface-variant leading-relaxed mt-1">
                    <strong className="text-primary">Multilingual?</strong> If you frequently switch between languages, <em>Auto-detect</em> may work better for you.
                  </p>
                </>
              }
            />
          </div>
          <select
            value={transcriptionLanguage}
            onChange={(e) => handleTranscriptionLanguageChange(e.target.value)}
            className="bg-surface-container-high rounded-xl px-2 py-1 text-xs text-on-surface focus:outline-none focus:shadow-[0_2px_0_0_#aec6ff]"
          >
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="nl">Dutch</option>
            <option value="pl">Polish</option>
            <option value="ru">Russian</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
            <option value="ar">Arabic</option>
            <option value="hi">Hindi</option>
            <option value="tr">Turkish</option>
            <option value="vi">Vietnamese</option>
            <option value="th">Thai</option>
            <option value="id">Indonesian</option>
            <option value="sv">Swedish</option>
            <option value="da">Danish</option>
            <option value="no">Norwegian</option>
            <option value="fi">Finnish</option>
            <option value="he">Hebrew</option>
            <option value="uk">Ukrainian</option>
            <option value="cs">Czech</option>
            <option value="el">Greek</option>
            <option value="ro">Romanian</option>
            <option value="hu">Hungarian</option>
          </select>
        </div>

        {/* Push-to-Talk */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <span className="text-xs text-on-surface-variant">Push-to-Talk</span>
            <InfoTooltip
              show={showPushToTalkInfo}
              onToggle={setShowPushToTalkInfo}
              content={
                <p className="text-[10px] text-on-surface leading-relaxed">
                  <strong className="text-on-surface">Hold to record:</strong> When enabled, hold the hotkey to record and release to stop. When disabled, press once to start and once to stop.
                </p>
              }
            />
          </div>
          <Toggle enabled={pushToTalk} onChange={handlePushToTalkChange} />
        </div>

        {/* Microphone */}
        <div className="pt-2">
          <label className="text-[10px] text-outline mb-1 block">Microphone</label>
          {saveStatus && <span className="text-xs text-tertiary float-right -mt-4">{saveStatus}</span>}
          <select
            value={selectedDevice}
            onChange={(e) => handleDeviceChange(e.target.value)}
            className="w-full bg-surface-container-high rounded-xl px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:shadow-[0_2px_0_0_#aec6ff]"
          >
            <option value="">Default Microphone</option>
            {audioDevices.map((device) => (
              <option key={device} value={device}>{device}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ===== WORD DICTIONARY ===== */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        <button
          onClick={() => setShowDictionary(!showDictionary)}
          className="w-full flex items-center justify-between p-3 hover:bg-surface-container-high transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-4 rounded-full bg-tertiary"></div>
            <svg className="w-3.5 h-3.5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <h3 className="label-style text-on-surface-variant text-sm">Word Dictionary</h3>
            {dictionaryEntries.length > 0 && showDictionary && (
              <span className="text-[10px] text-outline">({dictionaryEntries.length})</span>
            )}
          </div>
          <svg className={`w-4 h-4 text-on-surface-variant transition-transform ${showDictionary ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDictionary && (
          <div className="px-3 pb-3 space-y-3">
            <p className="text-[11px] text-outline">
              Words added here will be auto-corrected in future transcriptions. Edit a transcription to learn new words.
            </p>

            {/* Add new entry */}
            <div className="flex gap-1.5 items-end">
              <div className="flex-1">
                <label className="text-[10px] text-outline mb-0.5 block">Misheard word</label>
                <input
                  type="text"
                  value={newDictFrom}
                  onChange={(e) => setNewDictFrom(e.target.value)}
                  placeholder="e.g. cue ball"
                  className="w-full bg-surface rounded-lg px-2 py-1.5 text-xs text-on-surface border border-outline-variant focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex-shrink-0 text-outline text-xs pb-1.5">&rarr;</div>
              <div className="flex-1">
                <label className="text-[10px] text-outline mb-0.5 block">Correct word</label>
                <input
                  type="text"
                  value={newDictTo}
                  onChange={(e) => setNewDictTo(e.target.value)}
                  placeholder="e.g. Kuball"
                  className="w-full bg-surface rounded-lg px-2 py-1.5 text-xs text-on-surface border border-outline-variant focus:border-primary focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newDictFrom.trim() && newDictTo.trim()) {
                      wordDictionary.addEntry(newDictFrom.trim(), newDictTo.trim());
                      setDictionaryEntries(wordDictionary.getDictionary());
                      setNewDictFrom('');
                      setNewDictTo('');
                    }
                  }}
                />
              </div>
              <button
                onClick={() => {
                  if (newDictFrom.trim() && newDictTo.trim()) {
                    wordDictionary.addEntry(newDictFrom.trim(), newDictTo.trim());
                    setDictionaryEntries(wordDictionary.getDictionary());
                    setNewDictFrom('');
                    setNewDictTo('');
                  }
                }}
                disabled={!newDictFrom.trim() || !newDictTo.trim()}
                className="px-2 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>

            {/* Entry list */}
            {dictionaryEntries.length === 0 ? (
              <p className="text-xs text-outline text-center py-2">
                No dictionary entries yet
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto overflow-x-hidden">
                {dictionaryEntries.map((entry) => (
                  <div
                    key={entry.from}
                    className="flex items-center gap-1.5 bg-surface rounded-lg px-2 py-1.5 group min-w-0"
                  >
                    {editingDictEntry === entry.from ? (
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingDictFrom}
                            onChange={(e) => setEditingDictFrom(e.target.value)}
                            className="flex-1 min-w-0 bg-surface-container rounded px-1.5 py-0.5 text-xs text-on-surface border border-outline-variant focus:border-primary focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editingDictFrom.trim() && editingDictTo.trim()) {
                                wordDictionary.updateEntry(entry.from, editingDictTo.trim(), editingDictFrom.trim());
                                setDictionaryEntries([...wordDictionary.getDictionary()]);
                                setEditingDictEntry(null);
                              }
                              if (e.key === 'Escape') setEditingDictEntry(null);
                            }}
                          />
                          <span className="text-outline text-xs flex-shrink-0">&rarr;</span>
                          <input
                            type="text"
                            value={editingDictTo}
                            onChange={(e) => setEditingDictTo(e.target.value)}
                            className="flex-1 min-w-0 bg-surface-container rounded px-1.5 py-0.5 text-xs text-on-surface border border-outline-variant focus:border-primary focus:outline-none"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editingDictFrom.trim() && editingDictTo.trim()) {
                                wordDictionary.updateEntry(entry.from, editingDictTo.trim(), editingDictFrom.trim());
                                setDictionaryEntries([...wordDictionary.getDictionary()]);
                                setEditingDictEntry(null);
                              }
                              if (e.key === 'Escape') setEditingDictEntry(null);
                            }}
                          />
                        </div>
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEditingDictEntry(null)}
                            className="px-2 py-0.5 text-[10px] text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-container-high transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              if (editingDictFrom.trim() && editingDictTo.trim()) {
                                wordDictionary.updateEntry(entry.from, editingDictTo.trim(), editingDictFrom.trim());
                                setDictionaryEntries([...wordDictionary.getDictionary()]);
                                setEditingDictEntry(null);
                              }
                            }}
                            className="px-2 py-0.5 text-[10px] text-primary bg-primary/10 hover:bg-primary/20 rounded transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="text-xs text-on-surface-variant flex-1 truncate">{entry.from}</span>
                        <span className="text-outline text-xs">&rarr;</span>
                        <span className="text-xs text-tertiary flex-1 truncate font-medium">{entry.to}</span>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingDictEntry(entry.from);
                              setEditingDictFrom(entry.from);
                              setEditingDictTo(entry.to);
                            }}
                            className="p-0.5 text-on-surface-variant hover:text-primary"
                            title="Edit"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              wordDictionary.removeEntry(entry.from);
                              setDictionaryEntries(wordDictionary.getDictionary());
                            }}
                            className="p-0.5 text-on-surface-variant hover:text-error"
                            title="Delete"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== ADVANCED SETTINGS ===== */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between p-3 hover:bg-surface-container-high transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="label-style text-on-surface-variant text-sm">Advanced</h3>
          </div>
          <svg className={`w-4 h-4 text-on-surface-variant transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAdvanced && (
          <div className="px-3 pb-3 space-y-3">
            {/* Recording Settings */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-4 rounded-full bg-tertiary"></div>
                <h4 className="text-[10px] text-outline uppercase tracking-wider">Recording</h4>
              </div>

              {/* Duration Limits */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-outline">Min Duration</span>
                      <InfoTooltip
                        show={showMinDurationInfo}
                        onToggle={setShowMinDurationInfo}
                        content={
                          <p className="text-[10px] text-on-surface leading-relaxed">
                            Recordings shorter than this will be discarded automatically.
                          </p>
                        }
                      />
                    </div>
                    <span className="text-[10px] font-mono text-on-surface-variant">
                      {minDuration === 0 ? 'None' : `${minDuration}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.5"
                    value={minDuration}
                    onChange={(e) => handleMinDurationChange(parseFloat(e.target.value))}
                    className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-outline">Max Duration</span>
                      <InfoTooltip
                        show={showMaxDurationInfo}
                        onToggle={setShowMaxDurationInfo}
                        content={
                          <p className="text-[10px] text-on-surface leading-relaxed">
                            Recording will automatically stop when this limit is reached.
                          </p>
                        }
                      />
                    </div>
                    <span className="text-[10px] font-mono text-on-surface-variant">
                      {maxDuration === 0 ? 'No limit' : `${Math.floor(maxDuration / 60)}m`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="600"
                    step="30"
                    value={maxDuration}
                    onChange={(e) => handleMaxDurationChange(parseFloat(e.target.value))}
                    className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
              </div>

              {/* Audio Ducking */}
              <div>
                <div className="flex justify-between items-center mb-0.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-outline">Audio Ducking</span>
                    <InfoTooltip
                      show={showAudioDuckingInfo}
                      onToggle={setShowAudioDuckingInfo}
                      content={
                        <p className="text-[10px] text-on-surface leading-relaxed">
                          Reduce other apps' volume while recording to minimize background noise.
                          On macOS, this lowers the system output volume instead.
                        </p>
                      }
                    />
                  </div>
                  <span className="text-[10px] font-mono text-on-surface-variant">
                    {otherAppsVolume === 100 ? 'Off' : otherAppsVolume === 0 ? 'Mute others' : `${otherAppsVolume}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={otherAppsVolume}
                  onChange={(e) => handleOtherAppsVolumeChange(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>
            </div>

            {/* Output Settings */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-4 rounded-full bg-primary"></div>
                <h4 className="text-[10px] text-outline uppercase tracking-wider">Output</h4>
              </div>

              {/* Transcription Style */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-on-surface-variant">Transcription Style</span>
                  <InfoTooltip
                    show={showTranscriptionStyleInfo}
                    onToggle={setShowTranscriptionStyleInfo}
                    content={
                      <>
                        <p className="text-[10px] text-on-surface leading-relaxed">
                          <strong className="text-on-surface">Controls how your speech is transcribed:</strong>
                        </p>
                        <ul className="text-[10px] text-on-surface-variant leading-relaxed mt-1 ml-2 list-disc">
                          <li><strong>Formal:</strong> Proper capitalization & punctuation</li>
                          <li><strong>Balanced:</strong> Natural, standard formatting</li>
                          <li><strong>Relaxed:</strong> Casual, lowercase style</li>
                        </ul>
                      </>
                    }
                  />
                </div>
                <div className="flex bg-surface-container-high rounded-xl p-0.5">
                  {(['formal', 'balanced', 'relaxed'] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => handleTranscriptionStyleChange(style)}
                      className={`px-2 py-0.5 text-[10px] rounded-md transition-colors capitalize ${
                        transcriptionStyle === style ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Output Mode */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-on-surface-variant">Typing Mode</span>
                  <InfoTooltip
                    show={showTypingInfo}
                    onToggle={setShowTypingInfo}
                    content={
                      <>
                        <p className="text-[10px] text-on-surface leading-relaxed">
                          <strong className="text-on-surface">Instant:</strong> Pastes text all at once (fastest)
                        </p>
                        <p className="text-[10px] text-on-surface leading-relaxed mt-1">
                          <strong className="text-on-surface">Typewriter:</strong> Types text word by word (looks more natural)
                        </p>
                      </>
                    }
                  />
                </div>
                <div className="flex bg-surface-container-high rounded-xl p-0.5">
                  {(['instant', 'typewriter'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => handleOutputModeChange(mode)}
                      className={`px-2 py-0.5 text-[10px] rounded-md transition-colors capitalize ${
                        outputMode === mode ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Typing Speed - only when typewriter mode */}
              {outputMode === 'typewriter' && (
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-outline">Typing Speed</span>
                      <InfoTooltip
                        show={showTypingSpeedInfo}
                        onToggle={setShowTypingSpeedInfo}
                        content={
                          <p className="text-[10px] text-on-surface leading-relaxed">
                            Controls how fast text is typed out in typewriter mode.
                          </p>
                        }
                      />
                    </div>
                    <span className="text-[10px] font-mono text-on-surface-variant">{typingSpeed} WPM</span>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="2000"
                    step="100"
                    value={typingSpeed}
                    onChange={(e) => handleTypingSpeedChange(parseInt(e.target.value, 10))}
                    className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
              )}

              {/* Transform Prompt */}
              <div className="pt-2">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[10px] text-outline">Transform Prompt</label>
                    <InfoTooltip
                      show={showTransformPromptInfo}
                      onToggle={setShowTransformPromptInfo}
                      content={
                        <p className="text-[10px] text-on-surface leading-relaxed">
                          Custom instructions added to every transform request to customize the output style.
                        </p>
                      }
                    />
                  </div>
                  <span className={`text-[10px] font-mono ${transformPrompt.length > 450 ? 'text-tertiary' : 'text-outline'}`}>
                    {transformPrompt.length}/500
                  </span>
                </div>
                <textarea
                  value={transformPrompt}
                  onChange={(e) => handleTransformPromptChange(e.target.value)}
                  placeholder="e.g., Keep it concise. Use professional tone."
                  className="w-full bg-surface-container-high rounded-xl px-2 py-1.5 text-xs text-on-surface placeholder-outline focus:outline-none focus:shadow-[0_2px_0_0_#aec6ff] resize-none"
                  rows={2}
                  maxLength={500}
                />
              </div>
            </div>

            {/* Appearance Settings */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-4 rounded-full bg-primary"></div>
                <h4 className="text-[10px] text-outline uppercase tracking-wider">Appearance</h4>
              </div>

              {/* Sound Effects */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-on-surface-variant">Sound Effects</span>
                  <InfoTooltip
                    show={showSoundEffectsInfo}
                    onToggle={setShowSoundEffectsInfo}
                    content={
                      <p className="text-[10px] text-on-surface leading-relaxed">
                        Play audio cues when recording starts and stops.
                      </p>
                    }
                  />
                </div>
                <Toggle enabled={soundEnabled} onChange={handleSoundEnabledChange} />
              </div>

              {/* Recording Overlay */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-on-surface-variant">Recording Indicator</span>
                  <InfoTooltip
                    show={showRecordingIndicatorInfo}
                    onToggle={setShowRecordingIndicatorInfo}
                    content={
                      <p className="text-[10px] text-on-surface leading-relaxed">
                        A floating dot appears on screen while recording is active.
                      </p>
                    }
                  />
                </div>
                <Toggle enabled={overlayEnabled} onChange={handleOverlayEnabledChange} />
              </div>

              {/* Reset Overlay Position */}
              {overlayEnabled && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-on-surface-variant">Indicator Position</span>
                    <InfoTooltip
                      show={showIndicatorPositionInfo}
                      onToggle={setShowIndicatorPositionInfo}
                      content={
                        <p className="text-[10px] text-on-surface leading-relaxed">
                          You can drag the indicator anywhere on your screen.
                        </p>
                      }
                    />
                  </div>
                  <button
                    onClick={handleResetOverlayPosition}
                    className="text-[10px] text-primary hover:bg-primary/10 px-2 py-0.5 rounded transition-colors"
                  >
                    Reset to Center
                  </button>
                </div>
              )}
            </div>

            {/* Setup Guide */}
            {onOpenOnboarding && (
              <div className="pt-2">
                <button
                  onClick={onOpenOnboarding}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-primary/5 rounded-xl hover:bg-primary/10 transition-colors text-xs"
                >
                  <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-primary">Restart Setup Guide</span>
                </button>
              </div>
            )}

            {/* Privacy */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-4 rounded-full bg-error"></div>
                <h4 className="text-[10px] text-outline uppercase tracking-wider">Privacy</h4>
                <InfoTooltip
                  show={showPrivacyInfo}
                  onToggle={setShowPrivacyInfo}
                  content={
                    <p className="text-[10px] text-on-surface leading-relaxed">
                      <strong className="text-on-surface">Abe has no servers and no telemetry.</strong> In local mode audio is processed on your device. With your own API key, audio is sent directly from your computer to the provider you chose, under their data policy.
                    </p>
                  }
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-[10px] text-on-surface-variant">Local mode: audio is processed on-device</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-[10px] text-on-surface-variant">API key mode: audio goes straight to your provider</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-[10px] text-on-surface-variant">No Abe servers, no telemetry; history stays on this device</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== RESET & ABOUT ===== */}
      <div className="bg-surface-container rounded-xl p-3 space-y-2">
        {!resetConfirm ? (
          <button
            onClick={() => setResetConfirm(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-surface-container-high/50 rounded-xl hover:bg-surface-container-high transition-colors text-xs"
          >
            <svg className="w-3.5 h-3.5 text-on-surface-variant" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-on-surface">Reset All Settings to Default</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-tertiary flex-1">Reset all settings?</span>
            <button
              onClick={handleResetAllSettings}
              className="text-xs text-error px-2 py-1 rounded bg-error/10 hover:bg-error/20 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setResetConfirm(false)}
              className="text-xs text-on-surface-variant hover:text-on-surface px-2 py-1 rounded hover:bg-surface-container-high transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <button
          onClick={() => openIssueReport()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-surface-container-high/50 rounded-xl hover:bg-surface-container-high transition-colors text-xs"
        >
          <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-on-surface">Report an Issue</span>
        </button>
        <button
          onClick={() => {
            // 5 clicks within a second each to show debug logs
            if (debugClickTimerRef.current) clearTimeout(debugClickTimerRef.current);
            debugClicksRef.current += 1;
            if (debugClicksRef.current >= 5) {
              debugClicksRef.current = 0;
              setShowDebugLogs(true);
              return;
            }
            debugClickTimerRef.current = setTimeout(() => { debugClicksRef.current = 0; }, 1000);
          }}
          className="w-full text-[10px] text-outline text-center hover:text-on-surface-variant transition-colors cursor-default"
        >
          {`Abe v${appVersion} · Built by Quads Lab`}
        </button>
      </div>

      {/* Debug logger - 5 clicks on version to show */}
      {showDebugLogs && (
        <DebugLogger onClose={() => setShowDebugLogs(false)} />
      )}
    </div>
  );
}
