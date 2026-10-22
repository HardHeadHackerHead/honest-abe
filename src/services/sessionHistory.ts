/**
 * Session history service.
 *
 * Persists completed sessions to localStorage so users can review
 * previous session stats from the Usage dashboard.
 */

const STORAGE_KEY = 'abe_session_history';
const MAX_SESSIONS = 50;

export interface SavedSession {
  id: string;
  startTime: string;   // ISO timestamp — when the session began
  endTime: string;      // ISO timestamp — last transcription in the session
  totalWords: number;
  totalSeconds: number; // total recording duration
  transcriptionCount: number;
}

function loadSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedSession[];
  } catch {
    return [];
  }
}

function saveSessions(sessions: SavedSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export const sessionHistory = {
  /**
   * Get all saved sessions (most recent first).
   */
  getSessions(): SavedSession[] {
    return loadSessions();
  },

  /**
   * Save a completed session. Only saves if there were transcriptions.
   * Returns the saved session, or null if skipped (no transcriptions).
   */
  saveSession(session: Omit<SavedSession, 'id'>): SavedSession | null {
    if (session.transcriptionCount === 0) return null;

    const saved: SavedSession = {
      id: crypto.randomUUID(),
      ...session,
    };

    const sessions = loadSessions();
    sessions.unshift(saved);

    // Trim to max
    if (sessions.length > MAX_SESSIONS) {
      sessions.length = MAX_SESSIONS;
    }

    saveSessions(sessions);
    return saved;
  },

  /**
   * Delete a specific session by ID.
   */
  deleteSession(id: string): boolean {
    const sessions = loadSessions();
    const index = sessions.findIndex(s => s.id === id);
    if (index === -1) return false;
    sessions.splice(index, 1);
    saveSessions(sessions);
    return true;
  },

  /**
   * Clear all session history.
   */
  clearHistory(): void {
    saveSessions([]);
  },
};
