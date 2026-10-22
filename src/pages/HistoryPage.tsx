import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { localHistory, TranscriptionRecord } from '../services/localHistory';
import { wordDictionary } from '../services/wordDictionary';
import DictionaryToast, { DictionarySuggestion } from '../components/DictionaryToast';

// Create a separate query client for this window
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds - shorter for history window
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true, // Enable for history window
    },
  },
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
      title="Copy to clipboard"
    >
      {copied ? (
        <svg className="w-4 h-4 text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TranscriptionItem({ record, isExpanded, onToggle, isEditing, editText, onStartEdit, onEditChange, onSaveEdit, onCancelEdit }: {
  record: TranscriptionRecord;
  isExpanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  editText: string;
  onStartEdit: (id: string, text: string) => void;
  onEditChange: (text: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
}) {
  return (
    <div className="bg-surface-container rounded-xl overflow-hidden">
      {/* A div, not a button: it contains the copy button */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full p-3 text-left hover:bg-surface-container-high transition-colors cursor-pointer"
      >
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-on-surface truncate">
              {record.text || '(empty transcription)'}
            </p>
            <div className="flex gap-3 mt-1 text-xs text-outline">
              <span>{formatDate(record.timestamp)}</span>
              <span>{formatDuration(record.durationSeconds)}</span>
              <span>{record.wordCount} words</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0 flex items-center gap-2">
            {record.text && <CopyButton text={record.text} />}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-outline-variant">
          {isEditing ? (
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                value={editText}
                onChange={(e) => onEditChange(e.target.value)}
                className="w-full bg-surface rounded-lg p-2 text-sm text-on-surface border border-outline-variant focus:border-primary focus:outline-none resize-none"
                rows={4}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSaveEdit(record.id);
                  }
                  if (e.key === 'Escape') onCancelEdit();
                }}
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={onCancelEdit}
                  className="px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface rounded-md hover:bg-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onSaveEdit(record.id)}
                  className="px-2.5 py-1 text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-start mt-2">
              <p className="text-sm text-on-surface whitespace-pre-wrap flex-1">
                {record.text || '(empty transcription)'}
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                {record.text && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStartEdit(record.id, record.text); }}
                    className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
                    title="Edit transcription"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
                {record.text && <CopyButton text={record.text} />}
              </div>
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-outline-variant grid grid-cols-2 gap-2 text-xs text-on-surface-variant">
            <div>
              <span className="text-outline">Duration:</span>{' '}
              {formatDuration(record.durationSeconds)}
            </div>
            <div>
              <span className="text-outline">Words:</span> {record.wordCount}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function exportHistory(history: TranscriptionRecord[], format: 'txt' | 'csv' | 'json') {
  if (!history || history.length === 0) return;

  let content: string;
  let filename: string;

  const date = new Date().toISOString().split('T')[0];

  if (format === 'csv') {
    const headers = ['Timestamp', 'Text', 'Duration (seconds)', 'Word Count'];
    const rows = history.map(r => [
      r.timestamp,
      `"${(r.text || '').replace(/"/g, '""')}"`,
      r.durationSeconds.toString(),
      r.wordCount.toString(),
    ]);
    content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    filename = `transcriptions-${date}.csv`;
  } else if (format === 'json') {
    content = JSON.stringify(history, null, 2);
    filename = `transcriptions-${date}.json`;
  } else {
    content = history.map(r => {
      const dateStr = new Date(r.timestamp).toLocaleString();
      return `[${dateStr}]\n${r.text || '(empty)'}\n`;
    }).join('\n---\n\n');
    filename = `transcriptions-${date}.txt`;
  }

  // Rust shows a native save dialog and writes only to the path the user picks
  try {
    await invoke<boolean>('export_history', { contents: content, fileName: filename });
  } catch (error) {
    console.error('Failed to export history:', error);
  }
}

function HistoryContent() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editOriginalText, setEditOriginalText] = useState('');
  const [dictionarySuggestions, setDictionarySuggestions] = useState<DictionarySuggestion[]>([]);
  const queryClient = useQueryClient();

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
    localHistory.updateRecord(id, editText.trim());

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

  const handleClearAll = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    localHistory.clearHistory();
    setConfirmClear(false);
    setExpandedId(null);
    setSearchQuery('');
  }, [confirmClear]);

  const { data: history, isLoading, refetch } = useQuery({
    queryKey: ['transcription-history'],
    queryFn: () => localHistory.getHistory(),
  });

  // History changed here or in another window (F1)
  useEffect(() => localHistory.subscribe(() => {
    queryClient.invalidateQueries({ queryKey: ['transcription-history'] });
  }), [queryClient]);

  const filteredHistory = searchQuery.trim()
    ? history?.filter(record =>
        record.text?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : history;

  return (
    <div className="h-screen bg-surface text-on-surface flex flex-col">
      {/* Header */}
      <header className="p-3 border-b border-outline-variant flex items-center justify-between">
        <h1 className="text-lg font-bold">Transcription History</h1>
        <button
          onClick={() => refetch()}
          className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      {/* Search & Export Bar */}
      <div className="p-3 border-b border-outline-variant space-y-3">
        {/* Search Input */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcriptions..."
            className="w-full bg-surface-container rounded-xl pl-10 pr-8 py-2 text-sm text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-outline hover:text-on-surface"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Stats & Export Row */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-on-surface-variant">
            {searchQuery && filteredHistory
              ? `Found ${filteredHistory.length} result${filteredHistory.length !== 1 ? 's' : ''}`
              : history
              ? `${history.length} transcription${history.length !== 1 ? 's' : ''}`
              : ''}
          </div>
          {history && history.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-6 bg-surface-container-high rounded-xl shadow-lg py-1 z-10 min-w-[100px]">
                  <button
                    onClick={() => { exportHistory(history, 'txt'); setShowExportMenu(false); }}
                    className="w-full px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-bright"
                  >
                    Text (.txt)
                  </button>
                  <button
                    onClick={() => { exportHistory(history, 'csv'); setShowExportMenu(false); }}
                    className="w-full px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-bright"
                  >
                    CSV (.csv)
                  </button>
                  <button
                    onClick={() => { exportHistory(history, 'json'); setShowExportMenu(false); }}
                    className="w-full px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-bright"
                  >
                    JSON (.json)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="text-center py-8 text-on-surface-variant text-sm">Loading history...</div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-8 text-outline text-sm">
            No transcriptions yet. Start recording to see your history!
          </div>
        ) : !filteredHistory || filteredHistory.length === 0 ? (
          <div className="text-center py-8 text-outline text-sm">
            No transcriptions match your search.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredHistory.map((record) => (
              <TranscriptionItem
                key={record.id}
                record={record}
                isExpanded={expandedId === record.id}
                onToggle={() => setExpandedId(expandedId === record.id ? null : record.id)}
                isEditing={editingId === record.id}
                editText={editText}
                onStartEdit={handleStartEdit}
                onEditChange={setEditText}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="p-3 border-t border-outline-variant flex items-center justify-between">
        <p className="text-xs text-outline">
          Transcriptions are stored locally on your machine.
        </p>
        {history && history.length > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-error">Clear all?</span>
              <button
                onClick={handleClearAll}
                className="text-xs px-2 py-0.5 rounded bg-error/10 text-error hover:bg-error/20 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="text-xs px-2 py-0.5 rounded text-on-surface-variant hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleClearAll}
              className="text-xs text-error hover:text-error/80 flex items-center gap-1 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear All
            </button>
          )
        )}
      </footer>

      {/* Dictionary Toast */}
      {dictionarySuggestions.length > 0 && (
        <DictionaryToast
          suggestions={dictionarySuggestions}
          onDismiss={() => setDictionarySuggestions([])}
        />
      )}
    </div>
  );
}

// Wrap with QueryClientProvider since this is a separate window
export default function HistoryPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <HistoryContent />
    </QueryClientProvider>
  );
}
