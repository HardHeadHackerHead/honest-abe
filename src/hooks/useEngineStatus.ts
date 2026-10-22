import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { engine, EngineStatus } from '../services/engine';

/**
 * Current engine status for this window. Re-checks whenever any window
 * emits 'engine-config-changed'.
 */
export default function useEngineStatus() {
  const [status, setStatus] = useState<EngineStatus | null>(null);

  const refresh = useCallback(async () => {
    const next = await engine.getStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen('engine-config-changed', () => { refresh(); });
    return () => { unlisten.then(fn => fn()); };
  }, [refresh]);

  return {
    status,
    /** False while the first check is in flight. */
    isReady: status?.ready ?? false,
    isChecking: status === null,
    refresh,
  };
}
