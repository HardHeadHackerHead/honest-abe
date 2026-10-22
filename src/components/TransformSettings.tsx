import { useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react';
import { engine, ProviderId } from '../services/engine';
import useEngineStatus from '../hooks/useEngineStatus';
import {
  STORAGE_KEYS,
  DEFAULT_TRANSFORM_MODELS,
  TRANSFORM_MODEL_OPTIONS,
  TRANSFORM_PRESET_EXAMPLES,
} from '../constants';
import { formatHotkeyDisplay, getTransformHotkey } from '../utils';
import ProviderKeyForm from './engine/ProviderKeyForm';
import { ProviderPicker, ModelPicker, BaseUrlInput, saveSetting } from './engine/shared';

/**
 * Transform: select text, hold the transform hotkey and say what to do with it.
 * Needs a chat model, so it always uses a cloud or custom (e.g. Ollama) provider,
 * even when transcription is local. Keys are shared with transcription.
 */
export default function TransformSettings() {
  const initial = engine.getConfig().transform;
  const [provider, setProvider] = useState<ProviderId>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl || '');
  const [showExamples, setShowExamples] = useState(false);
  const { status } = useEngineStatus();
  const transformReady = status?.transformReady ?? false;

  const handleProviderChange = (next: ProviderId) => {
    if (next === provider) return;
    setProvider(next);
    setModel(DEFAULT_TRANSFORM_MODELS[next]);
    localStorage.removeItem(STORAGE_KEYS.TRANSFORM_MODEL);
    saveSetting(STORAGE_KEYS.TRANSFORM_PROVIDER, next);
    if (next === 'custom') {
      setBaseUrl(localStorage.getItem(STORAGE_KEYS.TRANSFORM_BASE_URL) || '');
    }
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    saveSetting(STORAGE_KEYS.TRANSFORM_MODEL, next.trim());
  };

  const handleBaseUrl = useCallback((url: string) => {
    setBaseUrl(url);
    saveSetting(STORAGE_KEYS.TRANSFORM_BASE_URL, url);
  }, []);

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] text-on-surface-variant">
        Select text anywhere, hold <span className="font-mono text-primary">{formatHotkeyDisplay(getTransformHotkey())}</span> and
        say what to do with it. Abe replaces the selection with the result.
      </p>

      {status && (
        transformReady ? (
          <p className="text-[10px] text-tertiary flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Transform is ready
          </p>
        ) : (
          <div className="rounded-xl bg-tertiary/10 p-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-tertiary flex-shrink-0 mt-px" />
            <p className="text-[10px] text-on-surface leading-snug">
              Transform needs a cloud or custom model. Add a key below (the same key as transcription works when you use
              the same provider), or point it at a local server such as Ollama.
            </p>
          </div>
        )
      )}

      <ProviderPicker value={provider} onChange={handleProviderChange} />
      {provider === 'custom' && <BaseUrlInput value={baseUrl} onChange={handleBaseUrl} />}
      <ModelPicker
        provider={provider}
        value={model}
        options={TRANSFORM_MODEL_OPTIONS}
        onChange={handleModelChange}
        placeholder="gpt-oss:20b"
      />
      <ProviderKeyForm provider={provider} baseUrl={provider === 'custom' ? baseUrl : undefined} />

      <div className="rounded-xl bg-surface-container-high/50">
        <button
          onClick={() => setShowExamples((s) => !s)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-on-surface"
        >
          Things you can say
          <ChevronDown className={`w-3.5 h-3.5 text-on-surface-variant transition-transform ${showExamples ? 'rotate-180' : ''}`} />
        </button>
        {showExamples && (
          <div className="px-2 pb-2 space-y-1">
            {TRANSFORM_PRESET_EXAMPLES.map((example) => (
              <div key={example.label} className="flex justify-between gap-2 text-[10px]">
                <span className="text-on-surface-variant">{example.label}</span>
                <span className="text-primary text-right">{example.say}</span>
              </div>
            ))}
            <p className="text-[10px] text-outline pt-1">
              Anything else works too: "rewrite this as a haiku", "make it sound friendlier". Standing instructions for
              every transform go in Advanced → Transform Prompt.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
