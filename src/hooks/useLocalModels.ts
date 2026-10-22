import { useState, useEffect, useCallback } from 'react';
import { engine, DownloadProgress, LocalModelId, LocalModelInfo } from '../services/engine';

/**
 * Local Whisper models and their download progress. Rust owns the downloads,
 * so this works across remounts: a download started during onboarding keeps
 * reporting progress in Settings.
 */
export default function useLocalModels() {
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [progress, setProgress] = useState<Partial<Record<LocalModelId, DownloadProgress>>>({});
  const [errors, setErrors] = useState<Partial<Record<LocalModelId, string>>>({});

  const refresh = useCallback(async () => {
    setModels(await engine.listLocalModels());
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = engine.onDownloadProgress((p) => {
      setProgress(prev => ({ ...prev, [p.id]: p }));
      if (p.state === 'error') {
        setErrors(prev => ({ ...prev, [p.id]: p.message || 'The download failed.' }));
      }
      if (p.state === 'done' || p.state === 'cancelled' || p.state === 'error') {
        refresh();
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [refresh]);

  const download = useCallback(async (id: LocalModelId) => {
    setErrors(prev => ({ ...prev, [id]: undefined }));
    setModels(prev => prev.map(m => (m.id === id ? { ...m, downloading: true } : m)));
    try {
      await engine.downloadLocalModel(id);
    } catch (err) {
      // The final progress event normally carries the message; this covers
      // failures before the download starts (e.g. already downloading).
      const message = err instanceof Error ? err.message : 'The download failed.';
      setErrors(prev => ({ ...prev, [id]: prev[id] || message }));
    } finally {
      refresh();
    }
  }, [refresh]);

  const cancel = useCallback((id: LocalModelId) => engine.cancelLocalModelDownload(id), []);

  const remove = useCallback(async (id: LocalModelId) => {
    try {
      await engine.deleteLocalModel(id);
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Could not delete the model.' }));
    }
    setProgress(prev => ({ ...prev, [id]: undefined }));
    refresh();
  }, [refresh]);

  return { models, progress, errors, download, cancel, remove, refresh };
}
