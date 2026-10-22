import { useState, useEffect, useCallback, useRef } from 'react';
import { localHistory } from '../services/localHistory';
import { sessionHistory } from '../services/sessionHistory';

interface UseSessionTimerOptions {
  onSessionSaved?: () => void;
}

interface UseSessionTimerReturn {
  sessionStart: string;
  resetSession: () => void;
}

/**
 * Compute and save the current session to sessionHistory.
 * Only saves if there were transcriptions in the session.
 */
function saveCurrentSession(sessionStart: string): void {
  const history = localHistory.getHistory();
  const sessionRecords = history.filter(
    r => new Date(r.timestamp) >= new Date(sessionStart)
  );

  if (sessionRecords.length === 0) return;

  // End time = timestamp of the most recent transcription in the session
  const endTime = sessionRecords[0].timestamp; // records are most-recent-first

  sessionHistory.saveSession({
    startTime: sessionStart,
    endTime,
    totalWords: sessionRecords.reduce((sum, r) => sum + (r.wordCount || 0), 0),
    totalSeconds: sessionRecords.reduce((sum, r) => sum + (r.durationSeconds || 0), 0),
    transcriptionCount: sessionRecords.length,
  });
}

export default function useSessionTimer(options?: UseSessionTimerOptions): UseSessionTimerReturn {
  const [sessionStart, setSessionStart] = useState(() => new Date().toISOString());
  const sessionStartRef = useRef(sessionStart);
  sessionStartRef.current = sessionStart;
  const onSessionSavedRef = useRef(options?.onSessionSaved);
  onSessionSavedRef.current = options?.onSessionSaved;

  // Save session on app close / refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentSession(sessionStartRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const resetSession = useCallback(() => {
    // Save the outgoing session before resetting
    saveCurrentSession(sessionStartRef.current);
    setSessionStart(new Date().toISOString());
    onSessionSavedRef.current?.();
  }, []);

  return {
    sessionStart,
    resetSession,
  };
}
