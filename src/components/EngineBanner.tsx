import { AlertTriangle, X } from 'lucide-react';
import type { EngineError } from '../services/engine';

interface EngineBannerProps {
  /** No engine configured / ready: show the setup prompt. */
  notReady: boolean;
  /** Why it isn't ready (from Rust), e.g. "Download the base model to start." */
  notReadyDetail?: string;
  /** Last provider error, shown until dismissed or the next success. */
  error: EngineError | null;
  onOpenSetup: () => void;
  onDismissError: () => void;
}

export default function EngineBanner({ notReady, notReadyDetail, error, onOpenSetup, onDismissError }: EngineBannerProps) {
  if (notReady) {
    return (
      <div className="w-full bg-tertiary/10 rounded-xl p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-on-surface font-medium text-sm">Transcription isn't ready</p>
            <p className="text-on-surface-variant text-xs">
              {notReadyDetail ?? 'Pick local (offline) or add your own API key.'}
            </p>
          </div>
          <button
            onClick={onOpenSetup}
            className="px-2 py-1 text-xs gradient-primary text-on-primary font-bold rounded-md transition hover:brightness-110 flex-shrink-0"
          >
            Set up
          </button>
        </div>
      </div>
    );
  }

  if (!error) return null;


  return (
    <div className="w-full bg-error/10 rounded-xl p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <AlertTriangle className="w-4 h-4 text-error flex-shrink-0" />
          <p className="text-error text-xs">{error.userMessage}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {error.pointsToSettings && (
            <button
              onClick={onOpenSetup}
              className="px-2 py-1 text-xs text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              Open Settings
            </button>
          )}
          <button
            onClick={onDismissError}
            className="p-1 text-on-surface-variant hover:text-on-surface transition rounded"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
