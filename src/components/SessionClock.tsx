import { useState, useEffect } from 'react';

/** "4:05", or "2:05:09" once past an hour */
export function formatSessionDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${ss}`
    : `${minutes}:${ss}`;
}

/**
 * The session timer in the header. It owns its once-a-second tick, so only this
 * button re-renders, not the whole app (F9).
 */
export default function SessionClock({ sessionStart, onReset }: { sessionStart: string; onReset: () => void }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  return (
    <button
      onClick={onReset}
      className="text-xs text-outline font-mono hover:text-on-surface-variant transition-colors"
      title="Click to reset session"
    >
      {formatSessionDuration(now - new Date(sessionStart).getTime())}
    </button>
  );
}
