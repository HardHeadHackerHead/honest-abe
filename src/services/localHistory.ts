/**
 * Local transcription history service.
 *
 * All transcription text is stored locally on the user's device only.
 */

import { emit, listen } from '@tauri-apps/api/event';
import { localStats } from './localStats';

export interface TranscriptionRecord {
  id: string;
  timestamp: string;
  text: string;
  durationSeconds: number;
  wordCount: number;
  /** Estimated provider cost in USD (0 for local) */
  costUsd?: number;
}

const STORAGE_KEY = 'abe_transcription_history';
const MAX_RECORDS = 500;
/** Tauri event sent after every change, so other windows refresh */
const CHANGED_EVENT = 'history-changed';

function loadRecords(): TranscriptionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as TranscriptionRecord[] : [];
  } catch {
    return [];
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/**
 * Write the records. If storage is full, drop the oldest records until they
 * fit, rather than failing the transcription (F16). Returns what was saved.
 */
export function saveRecords(
  records: TranscriptionRecord[],
  storage: Pick<Storage, 'setItem'> = localStorage,
): TranscriptionRecord[] {
  let toSave = records;
  for (;;) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      return toSave;
    } catch (error) {
      if (!isQuotaError(error) || toSave.length === 0) {
        console.error('[History] Could not save history:', error);
        return toSave;
      }
      // Drop the oldest quarter (records are most recent first)
      toSave = toSave.slice(0, Math.floor(toSave.length * 0.75));
    }
  }
}

/** Save, then tell every window (including this one) that history changed */
function commit(records: TranscriptionRecord[]): void {
  saveRecords(records);
  emit(CHANGED_EVENT, {}).catch(() => {
    // Not running in Tauri
  });
}

/**
 * History lives in localStorage, shared by every window. It is read fresh on
 * every call: a per-window cache went stale and wrote cleared or edited
 * records back (F1).
 */
export const localHistory = {
  /**
   * Get all transcription history records (most recent first).
   */
  getHistory(): TranscriptionRecord[] {
    return loadRecords();
  },

  /**
   * Call `onChange` whenever history changes in any window. Returns an unsubscribe function.
   */
  subscribe(onChange: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) onChange();
    };
    window.addEventListener('storage', onStorage);
    const unlisten = listen(CHANGED_EVENT, onChange).catch(() => () => {});
    return () => {
      window.removeEventListener('storage', onStorage);
      unlisten.then(fn => fn());
    };
  },

  /**
   * Add a new transcription record to local history and the usage aggregates.
   */
  addEntry(entry: {
    text: string;
    durationSeconds: number;
    wordCount: number;
    /** Estimated provider cost in USD, for the usage aggregates */
    costUsd?: number;
  }): TranscriptionRecord {
    const record: TranscriptionRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      text: entry.text,
      durationSeconds: entry.durationSeconds,
      wordCount: entry.wordCount,
      costUsd: entry.costUsd ?? 0,
    };

    localStats.recordTranscription(entry.wordCount, entry.durationSeconds, entry.costUsd);

    const records = this.getHistory();
    records.unshift(record);

    // Trim to max records
    if (records.length > MAX_RECORDS) {
      records.length = MAX_RECORDS;
    }

    commit(records);
    return record;
  },

  /**
   * Clear all local transcription history.
   */
  clearHistory(): number {
    const count = this.getHistory().length;
    commit([]);
    return count;
  },

  /**
   * Delete a specific record by ID.
   */
  deleteRecord(id: string): boolean {
    const records = this.getHistory();
    const index = records.findIndex(r => r.id === id);
    if (index === -1) return false;
    records.splice(index, 1);
    commit(records);
    return true;
  },

  /**
   * Update the text of an existing record (used when user edits a transcription).
   */
  updateRecord(id: string, newText: string): boolean {
    const records = this.getHistory();
    const record = records.find(r => r.id === id);
    if (!record) return false;
    record.text = newText;
    record.wordCount = newText.trim().split(/\s+/).filter(Boolean).length;
    commit(records);
    return true;
  },

  /**
   * Export history in a given format.
   */
  exportHistory(format: 'txt' | 'csv' | 'json'): string {
    const records = this.getHistory();

    if (format === 'json') {
      return JSON.stringify(records, null, 2);
    }

    if (format === 'csv') {
      const header = 'Timestamp,Text,Duration (s),Words';
      const rows = records.map(r =>
        `"${r.timestamp}","${r.text.replace(/"/g, '""')}",${r.durationSeconds},${r.wordCount}`
      );
      return [header, ...rows].join('\n');
    }

    // txt format
    return records.map(r =>
      `[${new Date(r.timestamp).toLocaleString()}]\n${r.text}\n---`
    ).join('\n\n');
  },
};
