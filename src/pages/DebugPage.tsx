import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  type: 'log' | 'error' | 'warn' | 'info' | 'network' | 'rust';
  message: string;
  timestamp: Date;
}

// Access the shared log entries from the main window
const getLogEntries = (): LogEntry[] => {
  try {
    const stored = localStorage.getItem('abe_debug_logs');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((entry: any) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      }));
    }
  } catch {}
  return [];
};

export default function DebugPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Poll for new logs every 500ms
    const interval = setInterval(() => {
      setLogs(getLogEntries());
    }, 500);

    // Initial load
    setLogs(getLogEntries());

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(l => l.type === filter);

  const getColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return '#ff6b6b';
      case 'warn': return '#ffd93d';
      case 'info': return '#6bcfff';
      case 'network': return '#c9b3ff';
      case 'rust': return '#ff9f43';
      default: return '#ffffff';
    }
  };

  const clearLogs = () => {
    localStorage.removeItem('abe_debug_logs');
    setLogs([]);
  };

  return (
    <div className="h-screen bg-gray-900 flex flex-col font-mono text-xs">
      {/* Header */}
      <div className="p-2 border-b border-gray-700 flex justify-between items-center bg-gray-800">
        <div className="flex gap-2 items-center">
          <span className="text-white font-bold text-sm">Debug Console</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-xs"
          >
            <option value="all">All ({logs.length})</option>
            <option value="log">Log</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="network">Network</option>
            <option value="rust">Rust/Hotkeys</option>
          </select>
          <button
            onClick={clearLogs}
            className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
          >
            Clear
          </button>
        </div>
        <label className="flex items-center gap-1 text-gray-400 text-xs">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-3 h-3"
          />
          Auto-scroll
        </label>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-auto p-2">
        {filteredLogs.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No logs yet. Interact with the app to see logs here.
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className="py-1 border-b border-gray-800"
              style={{ color: getColor(entry.type) }}
            >
              <span className="text-gray-500 mr-2">
                {entry.timestamp.toLocaleTimeString()}
              </span>
              <span
                className="px-1 rounded mr-2 text-[10px]"
                style={{ backgroundColor: getColor(entry.type) + '33' }}
              >
                {entry.type.toUpperCase()}
              </span>
              <span className="whitespace-pre-wrap break-all">
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
