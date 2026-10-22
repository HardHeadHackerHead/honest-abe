import { useState, useEffect } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { updater } from '../services/tauri';

export default function UpdateBanner() {
  const [update, setUpdate] = useState<{ version?: string; notes?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    updater.checkForUpdates().then((result) => {
      if (result.available) setUpdate({ version: result.version, notes: result.notes });
    });
  }, []);

  if (!update || dismissed) {
    return null;
  }

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await updater.installUpdateAndRestart();
    } catch (err) {
      console.error('[Updater] Install failed:', err);
    }
    setUpdating(false);
  };

  return (
    <div className="w-full bg-primary/10 rounded-xl p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ArrowUpCircle className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-on-surface font-medium text-sm truncate">
              v{update.version} available
            </p>
            {update.notes && (
              <p className="text-on-surface-variant text-xs truncate">{update.notes.split('\n')[0]}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="px-2 py-1 text-xs gradient-primary text-on-primary font-bold rounded-md transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updating ? '...' : 'Update'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 text-on-surface-variant hover:text-on-surface transition rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
