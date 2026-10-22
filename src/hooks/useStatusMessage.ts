import { useState, useEffect, useRef, useCallback } from 'react';

export type StatusMessage = { type: 'error' | 'warning' | 'info'; text: string } | null;

/** Show a status message, optionally clearing it after `clearAfterMs`. */
export type ShowStatus = (message: StatusMessage, clearAfterMs?: number) => void;

/**
 * The main window's status line. One timer: a new message cancels the old
 * message's auto-clear, so an old timer never wipes a newer message.
 */
export default function useStatusMessage() {
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback<ShowStatus>((message, clearAfterMs) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatusMessage(message);
    if (message && clearAfterMs) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setStatusMessage(null);
      }, clearAfterMs);
    }
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { statusMessage, showStatus };
}
