import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import RecordingButton from './components/RecordingButton';
import UsageDashboard from './components/UsageDashboard';
import AboutPanel from './components/AboutPanel';
import SettingsPanel from './components/SettingsPanel';
import CopyButton from './components/CopyButton';
import EngineBanner from './components/EngineBanner';
import UpdateBanner from './components/UpdateBanner';
import DictionaryToast, { DictionarySuggestion } from './components/DictionaryToast';
import OnboardingModal from './components/OnboardingModal';
import { localHistory } from './services/localHistory';
import { wordDictionary } from './services/wordDictionary';
import { tauriCommands } from './services/tauri';
import { EngineError } from './services/engine';
import { STORAGE_KEYS } from './constants';

// Hooks
import useSessionTimer from './hooks/useSessionTimer';
import SessionClock from './components/SessionClock';
import useStatusMessage from './hooks/useStatusMessage';
import useEngineStatus from './hooks/useEngineStatus';
import useRecording from './hooks/useRecording';
import useTransformRecording from './hooks/useTransformRecording';
import useHotkeyListeners from './hooks/useHotkeyListeners';

// Utils and constants
import { formatRelativeTime, getHotkey, getPushToTalk, formatHotkeyDisplay } from './utils';
import { Home, BarChart3, Info, Settings, Pencil } from 'lucide-react';

const appWindow = getCurrentWebviewWindow();

function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'usage' | 'about' | 'settings'>('home');
  const { statusMessage, showStatus } = useStatusMessage();
  const [engineError, setEngineError] = useState<EngineError | null>(null);
  const [focusEngineSetup, setFocusEngineSetup] = useState(false);
  const appQueryClient = useQueryClient();

  // Editable transcription state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editOriginalText, setEditOriginalText] = useState('');
  const [dictionarySuggestions, setDictionarySuggestions] = useState<DictionarySuggestion[]>([]);

  // Track window height for responsive transcription list
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Easter egg trigger state
  const [titleClickCount, setTitleClickCount] = useState(0);
  const [showTitleSparkle, setShowTitleSparkle] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sparkleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (sparkleTimerRef.current) clearTimeout(sparkleTimerRef.current);
  }, []);

  // Reset click count after 1 second of no clicks
  useEffect(() => {
    if (titleClickCount > 0) {
      if (clickResetRef.current) clearTimeout(clickResetRef.current);
      clickResetRef.current = setTimeout(() => setTitleClickCount(0), 1000);
    }
    return () => {
      if (clickResetRef.current) clearTimeout(clickResetRef.current);
    };
  }, [titleClickCount]);

  const handleTitleMouseDown = useCallback(() => {
    const newCount = titleClickCount + 1;
    setTitleClickCount(newCount);
    setShowTitleSparkle(true);
    if (sparkleTimerRef.current) clearTimeout(sparkleTimerRef.current);
    sparkleTimerRef.current = setTimeout(() => setShowTitleSparkle(false), 300);

    // On third click, start hold timer
    if (newCount >= 3) {
      holdTimerRef.current = setTimeout(() => {
        tauriCommands.openGardenWindow();
        setTitleClickCount(0);
      }, 2000);
    }
  }, [titleClickCount]);

  const handleTitleMouseUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handleTitleMouseLeave = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // Custom hooks
  const { sessionStart, resetSession } = useSessionTimer({
    onSessionSaved: () => appQueryClient.invalidateQueries({ queryKey: ['session-history'] }),
  });

  // The single gate for recording: is a transcription engine ready?
  const { status: engineStatus, isReady: engineReady, isChecking: isCheckingEngine } = useEngineStatus();
  const canRecordRef = useRef(false);
  canRecordRef.current = engineReady;
  const canTransformRef = useRef(false);
  canTransformRef.current = engineStatus?.transformReady ?? false;
  const engineDetailRef = useRef<string | undefined>(undefined);
  engineDetailRef.current = engineStatus?.detail;

  // Onboarding state: shown until completed once
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED) !== 'true'
  );
  const showOnboardingRef = useRef(showOnboarding);
  showOnboardingRef.current = showOnboarding;

  // Open Settings scrolled to the transcription engine section
  const openEngineSetup = useCallback(async () => {
    setShowOnboarding(false);
    setActiveTab('settings');
    setFocusEngineSetup(true);
    try {
      await appWindow.show();
      await appWindow.setFocus();
    } catch {
      // Window may already be visible
    }
  }, []);

  // Recording was attempted without a ready engine. During onboarding the
  // practice step explains this itself, so don't navigate away from it.
  const handleEngineNotReady = useCallback(() => {
    const detail = engineDetailRef.current;
    emit('overlay-blocked', {
      reason: detail?.includes('downloading') ? 'Still downloading the model' : 'Set up transcription first',
      hint: detail,
    });
    if (!showOnboardingRef.current) openEngineSetup();
  }, [openEngineSetup]);

  // Transform hotkey pressed without a chat model configured
  const handleTransformNotReady = useCallback(() => {
    emit('overlay-blocked', {
      reason: 'Transform needs a cloud or custom model',
      hint: 'Set it up in Abe → Settings → Transform.',
    });
    showStatus({ type: 'warning', text: 'Transform needs a cloud or custom model. Set it up in Settings → Transform.' }, 6000);
  }, [showStatus]);

  // The overlay pill asks for engine setup when clicked in the "not set up" state
  useEffect(() => {
    const unlisten = listen('open-engine-setup', () => { openEngineSetup(); });
    return () => { unlisten.then(fn => fn()); };
  }, [openEngineSetup]);

  // Clear the "focus" highlight once the user leaves Settings
  useEffect(() => {
    if (activeTab !== 'settings') setFocusEngineSetup(false);
  }, [activeTab]);

  // Recording hooks
  const { isRecording, isProcessing, requestRecording, toggleRecording } = useRecording({
    onStatusMessage: showStatus,
    onEngineError: setEngineError,
  });

  const { requestTransform, toggleTransform } = useTransformRecording({
    onStatusMessage: showStatus,
    onEngineError: setEngineError,
  });

  // Hotkey listeners
  useHotkeyListeners({
    canRecordRef,
    onEngineNotReady: handleEngineNotReady,
    canTransformRef,
    onTransformNotReady: handleTransformNotReady,
    requestRecording,
    toggleRecording,
    requestTransform,
    toggleTransform,
    onStatusMessage: showStatus,
  });

  // Fetch recent transcriptions from local history
  const { data: recentTranscriptions } = useQuery({
    queryKey: ['transcription-history'],
    queryFn: () => localHistory.getHistory(),
    select: (data) => data?.slice(0, 5),
  });

  // History changed here or in another window (F1)
  useEffect(() => localHistory.subscribe(() => {
    appQueryClient.invalidateQueries({ queryKey: ['transcription-history'] });
  }), [appQueryClient]);

  // Handle editing a transcription
  const handleStartEdit = useCallback((id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
    setEditOriginalText(text);
  }, []);

  const handleSaveEdit = useCallback((id: string) => {
    if (editText.trim() === editOriginalText.trim()) {
      setEditingId(null);
      return;
    }
    // Save the edited text
    localHistory.updateRecord(id, editText.trim());

    // Diff and suggest dictionary entries
    const changes = wordDictionary.diffWords(editOriginalText, editText);
    if (changes.length > 0) {
      setDictionarySuggestions(changes);
    }
    setEditingId(null);
  }, [editText, editOriginalText]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
    setEditOriginalText('');
  }, []);

  // Handle recording button click
  const handleRecordingClick = () => {
    if (!engineReady) {
      openEngineSetup();
      return;
    }
    toggleRecording();
  };

  // Get recording status text
  const getRecordingStatusText = () => {
    if (isCheckingEngine) return '';
    if (!engineReady) return 'Set up transcription to start';
    if (isProcessing) return 'Transcribing...';
    if (isRecording) {
      return `Recording... ${getPushToTalk() ? 'Release hotkey to stop' : 'Press hotkey to stop'}`;
    }
    return `Press ${formatHotkeyDisplay(getHotkey())} to start`;
  };

  const tabIcons = {
    home: Home,
    usage: BarChart3,
    about: Info,
    settings: Settings,
  };

  return (
    <div className="h-screen bg-surface text-on-surface flex flex-col overflow-hidden">
      {/* Header — hidden at very small heights */}
      <header className={`p-2 bg-surface-container ${windowHeight < 250 ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1
              className={`text-lg font-bold tracking-tight transition-all duration-200 select-none
                text-primary hover:scale-105 hover:brightness-110
                ${showTitleSparkle ? 'animate-pulse brightness-125' : ''}
                ${titleClickCount >= 3 ? 'animate-pulse text-tertiary' : ''}`}
              onMouseDown={handleTitleMouseDown}
              onMouseUp={handleTitleMouseUp}
              onMouseLeave={handleTitleMouseLeave}
            >
              Abe
            </h1>
            <SessionClock sessionStart={sessionStart} onReset={resetSession} />
          </div>
          <div
            className={`w-2 h-2 rounded-full ${
              isCheckingEngine ? 'bg-outline' : engineReady ? 'bg-tertiary' : 'bg-yellow-500 animate-pulse'
            }`}
            title={
              isCheckingEngine ? 'Checking transcription engine...'
                : engineReady ? `Ready (${engineStatus?.provider ?? 'cloud'})`
                : engineStatus?.detail ?? 'Transcription not set up'
            }
          />
        </div>
      </header>

      {/* Onboarding nudge banner — shown on all tabs until setup is complete */}
      {localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED) !== 'true' && !showOnboarding && (
        <button
          onClick={() => setShowOnboarding(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-primary/15 hover:bg-primary/25 transition-colors border-b border-primary/10"
        >
          <span className="text-xs font-medium text-primary">Click here to finish setup</span>
          <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      )}

      {/* Main Content */}
      <main className={`flex-1 p-3 overflow-y-auto flex flex-col ${windowHeight < 250 ? 'pb-2' : 'pb-14'}`}>
        {activeTab === 'home' && (
          <div className="flex flex-col items-center gap-3 py-4 h-full">
            {/* Update Banner (soft update notification) */}
            <UpdateBanner />

            <EngineBanner
              notReady={!isCheckingEngine && !engineReady}
              notReadyDetail={engineStatus?.detail}
              error={engineError}
              onOpenSetup={openEngineSetup}
              onDismissError={() => setEngineError(null)}
            />
            <RecordingButton
              isRecording={isRecording}
              onClick={handleRecordingClick}
              disabled={!engineReady}
              size="medium"
            />
            <p className="text-on-surface-variant text-center text-xs">
              {getRecordingStatusText()}
            </p>

            {/* Status Message */}
            {statusMessage && (
              <div className={`rounded-xl px-4 py-2 text-sm ${
                statusMessage.type === 'error' ? 'bg-error/10 text-error' :
                statusMessage.type === 'warning' ? 'bg-tertiary/10 text-tertiary' :
                'bg-primary/10 text-primary'
              }`}>
                {statusMessage.text}
              </div>
            )}

            {/* Recent Transcriptions — steps down 5→4→3→2→1→0 as window shrinks */}
            {(() => {
              const maxVisible = windowHeight >= 580 ? 5
                : windowHeight >= 535 ? 4
                : windowHeight >= 490 ? 3
                : windowHeight >= 440 ? 2
                : windowHeight >= 380 ? 1
                : 0;
              const visible = recentTranscriptions?.slice(0, maxVisible);
              if (!visible || visible.length === 0) return null;
              return (
              <div className="w-full mt-4 flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2 flex-shrink-0">
                  <h3 className="label-style text-on-surface-variant">Recent Transcriptions</h3>
                  <button
                    onClick={() => tauriCommands.openHistoryWindow()}
                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    View all
                  </button>
                </div>
                <div className="space-y-2 overflow-y-auto flex-1 min-h-0 scrollbar-hide">
                  {visible.map((record) => (
                    <div
                      key={record.id}
                      className="bg-surface-container rounded-xl p-2.5 text-sm hover:bg-surface-container-high transition-all"
                    >
                      {editingId === record.id ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full bg-surface rounded-lg p-2 text-sm text-on-surface border border-outline-variant focus:border-primary focus:outline-none resize-none"
                            rows={3}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveEdit(record.id);
                              }
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={handleCancelEdit}
                              className="px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface rounded-md hover:bg-surface-container-high transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(record.id)}
                              className="px-2 py-1 text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-on-surface-variant flex-1 line-clamp-2">
                            {record.text || '(empty)'}
                          </p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {record.text && (
                              <button
                                onClick={() => handleStartEdit(record.id, record.text)}
                                className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
                                title="Edit transcription"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {record.text && <CopyButton text={record.text} />}
                            <span className="text-xs text-outline">
                              {formatRelativeTime(record.timestamp)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'usage' && <UsageDashboard sessionStart={sessionStart} />}
        {activeTab === 'about' && <AboutPanel />}
        {activeTab === 'settings' && (
          <SettingsPanel onOpenOnboarding={() => setShowOnboarding(true)} focusEngine={focusEngineSetup} />
        )}
      </main>

      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
          onComplete={() => {
            localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, 'true');
            setShowOnboarding(false);
          }}
          isRecording={isRecording}
          isProcessing={isProcessing}
          engineReady={engineReady}
          engineDetail={engineStatus?.detail}
          engineError={engineError}
        />
      )}

      {/* Dictionary Toast */}
      {dictionarySuggestions.length > 0 && (
        <DictionaryToast
          suggestions={dictionarySuggestions}
          onDismiss={() => setDictionarySuggestions([])}
        />
      )}

      {/* Navigation — hidden at very small heights */}
      <nav className={`fixed bottom-0 left-0 right-0 z-50 bg-surface-container/70 backdrop-blur-md ${windowHeight < 250 ? 'hidden' : ''}`}>
        <div className="flex">
          {(['home', 'usage', 'about', 'settings'] as const).map((tab) => {
            const Icon = tabIcons[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-[10px] capitalize transition-all ${
                  activeTab === tab
                    ? 'text-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab}
              </button>
            );
          })}
        </div>
      </nav>

    </div>
  );
}

export default App;
