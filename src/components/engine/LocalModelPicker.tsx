import { Download, Trash2, X, CheckCircle2, Loader2 } from 'lucide-react';
import type { LocalModelId } from '../../services/engine';
import type useLocalModels from '../../hooks/useLocalModels';
import { LOCAL_MODEL_INFO } from '../../constants';
import { formatBytes, smallButtonClass } from './shared';

function Dots({ filled, label }: { filled: number; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] text-outline" title={`${label}: ${filled}/4`}>
      {label}
      <span className="flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`w-1 h-1 rounded-full ${i <= filled ? 'bg-primary' : 'bg-outline-variant/40'}`} />
        ))}
      </span>
    </span>
  );
}

interface LocalModelPickerProps {
  selected: LocalModelId;
  onSelect: (id: LocalModelId) => void;
  localModels: ReturnType<typeof useLocalModels>;
}

export default function LocalModelPicker({ selected, onSelect, localModels }: LocalModelPickerProps) {
  const { models, progress, errors, download, cancel, remove } = localModels;

  if (models.length === 0) {
    return (
      <p className="text-[10px] text-on-surface-variant flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading models...
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {models.map((model) => {
        const info = LOCAL_MODEL_INFO[model.id];
        const isSelected = model.id === selected;
        const p = progress[model.id];
        const verifying = model.downloading && p?.state === 'verifying';
        const percent = p && p.total > 0 ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : 0;
        const error = errors[model.id];

        return (
          <div
            key={model.id}
            onClick={() => (model.downloaded ? onSelect(model.id) : undefined)}
            className={`rounded-xl p-2 border transition-colors ${
              isSelected ? 'bg-primary/10 border-primary/40' : 'bg-surface-container-high/50 border-transparent'
            } ${model.downloaded && !isSelected ? 'cursor-pointer hover:bg-surface-container-high' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-on-surface">{info?.label ?? model.id}</span>
                  <span className="text-[10px] text-outline">{formatBytes(model.sizeBytes)}</span>
                  {isSelected && (
                    <span className="text-[9px] font-medium text-primary bg-primary/15 rounded px-1">Selected</span>
                  )}
                </div>
                {info && <p className="text-[10px] text-on-surface-variant leading-tight mt-0.5">{info.hint}</p>}
                {info && (
                  <div className="flex gap-3 mt-1">
                    <Dots filled={info.speed} label="Speed" />
                    <Dots filled={info.quality} label="Accuracy" />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                {model.downloaded ? (
                  <>
                    {!isSelected && (
                      <button
                        onClick={() => onSelect(model.id)}
                        className={`${smallButtonClass} py-1 bg-primary/15 text-primary hover:bg-primary/25`}
                      >
                        Use
                      </button>
                    )}
                    <CheckCircle2 className="w-3.5 h-3.5 text-tertiary" aria-label="Downloaded" />
                    <button
                      onClick={() => remove(model.id)}
                      className="p-1 text-outline hover:text-error transition-colors"
                      title="Delete model"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                ) : model.downloading ? (
                  <button
                    onClick={() => cancel(model.id)}
                    disabled={verifying}
                    className={`${smallButtonClass} py-1 text-on-surface-variant hover:text-error hover:bg-error/10 flex items-center gap-0.5 disabled:opacity-40`}
                  >
                    <X className="w-3 h-3" /> Cancel
                  </button>
                ) : (
                  <button
                    onClick={() => { onSelect(model.id); download(model.id); }}
                    className={`${smallButtonClass} py-1 bg-primary/15 text-primary hover:bg-primary/25 flex items-center gap-1`}
                  >
                    <Download className="w-3 h-3" /> Download
                  </button>
                )}
              </div>
            </div>

            {model.downloading && (
              <div className="mt-1.5">
                <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-primary rounded-full transition-all duration-200 ${verifying ? 'animate-pulse' : ''}`}
                    style={{ width: `${verifying ? 100 : percent}%` }}
                  />
                </div>
                <p className="text-[9px] text-outline mt-0.5">
                  {verifying
                    ? 'Verifying...'
                    : p ? `${formatBytes(p.downloaded)} of ${formatBytes(p.total)} (${percent}%)` : 'Starting...'}
                </p>
              </div>
            )}
            {error && !model.downloading && <p className="text-[10px] text-error mt-1">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
