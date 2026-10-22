import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { redactSecrets } from '../utils/redact';

interface DebugLoggerProps {
  onClose?: () => void;
}

interface LogEntry {
  id: number;
  type: 'log' | 'error' | 'warn' | 'info' | 'rust';
  message: string;
  timestamp: Date;
}

let logId = 0;
const logEntries: LogEntry[] = [];
const listeners: Set<() => void> = new Set();
let installed = false;

// Persist logs for the debug window. That window only exists in debug builds,
// so release builds never write logs to storage (F15).
function persistLogs() {
  if (!import.meta.env.DEV) return;
  try {
    const toStore = logEntries.slice(-200).map(entry => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    }));
    localStorage.setItem('abe_debug_logs', JSON.stringify(toStore));
  } catch {}
}

function addLog(type: LogEntry['type'], ...args: unknown[]) {
  const message = redactSecrets(args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.message}\n${arg.stack}`;
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' '));

  logEntries.push({
    id: logId++,
    type,
    message,
    timestamp: new Date(),
  });

  // Keep last 200 entries
  if (logEntries.length > 200) {
    logEntries.shift();
  }

  persistLogs();

  listeners.forEach(fn => fn());
}

/**
 * Start capturing console output and Rust hotkey debug events. Nothing is
 * captured until this runs: at startup in dev builds, or when the user opens
 * the debug log in Settings (F15).
 */
export function installDebugLogger() {
  if (installed) return;
  installed = true;

  listen<{ event: string; message: string }>('hotkey-debug', (event) => {
    addLog('rust', `[Hotkey] ${event.payload.message}`);
  }).catch(() => {
    // Not in Tauri environment
  });

  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  console.log = (...args) => { original.log(...args); addLog('log', ...args); };
  console.error = (...args) => { original.error(...args); addLog('error', ...args); };
  console.warn = (...args) => { original.warn(...args); addLog('warn', ...args); };
  console.info = (...args) => { original.info(...args); addLog('info', ...args); };
}

export function DebugLogger({ onClose }: DebugLoggerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    installDebugLogger();
    const update = () => setLogs([...logEntries]);
    listeners.add(update);
    update(); // Initial load
    return () => { listeners.delete(update); };
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(l => l.type === filter);

  const getColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return '#ff6b6b';
      case 'warn': return '#ffd93d';
      case 'info': return '#6bcfff';
      case 'rust': return '#ff9f43';
      default: return '#ffffff';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.95)',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Monaco, Consolas, monospace',
      fontSize: '12px',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
      }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ color: '#fff', fontWeight: 'bold' }}>Debug Logger</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              backgroundColor: '#333',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              padding: '4px 8px',
            }}
          >
            <option value="all">All</option>
            <option value="log">Log</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="rust">Rust/Hotkeys</option>
          </select>
          <button
            onClick={() => { logEntries.length = 0; setLogs([]); }}
            style={{
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
        <button
          onClick={onClose}
          style={{
            backgroundColor: '#ff4444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {/* Logs */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '10px',
      }}>
        {filteredLogs.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: '4px 0',
              borderBottom: '1px solid #222',
              color: getColor(entry.type),
            }}
          >
            <span style={{ color: '#666', marginRight: '8px' }}>
              {entry.timestamp.toLocaleTimeString()}
            </span>
            <span style={{
              backgroundColor: getColor(entry.type) + '33',
              padding: '1px 6px',
              borderRadius: '3px',
              marginRight: '8px',
              fontSize: '10px',
            }}>
              {entry.type.toUpperCase()}
            </span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {entry.message}
            </span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
