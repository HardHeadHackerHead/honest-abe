import { useState, useEffect } from 'react';
import type { ProviderId } from '../../services/engine';
import { engine } from '../../services/engine';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  custom: 'your server',
};

export const inputClass =
  'w-full bg-surface-container-high rounded-xl px-2 py-1.5 text-xs text-on-surface placeholder-outline focus:outline-none focus:shadow-[0_2px_0_0_#aec6ff]';

export const smallButtonClass = 'px-2 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap';

/** Write a setting (empty removes it) and tell every window to re-check the engine. */
export function saveSetting(key: string, value: string) {
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
  engine.notifyConfigChanged();
}

const PROVIDERS: { id: ProviderId; name: string; note: string; recommended?: boolean }[] = [
  { id: 'groq', name: 'Groq', note: 'Recommended — fast and cheap', recommended: true },
  { id: 'openai', name: 'OpenAI', note: 'Widely used, pay as you go' },
  { id: 'custom', name: 'Custom', note: 'OpenAI-compatible, e.g. Ollama' },
];

export function ProviderPicker({ value, onChange }: { value: ProviderId; onChange: (id: ProviderId) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {PROVIDERS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={`rounded-xl px-2 py-1.5 text-left border transition-colors ${
            value === p.id
              ? 'bg-primary/10 border-primary/40'
              : 'bg-surface-container-high/50 border-transparent hover:bg-surface-container-high'
          }`}
        >
          <span className="block text-xs font-medium text-on-surface">{p.name}</span>
          <span className={`block text-[9px] leading-tight ${p.recommended ? 'text-tertiary' : 'text-on-surface-variant'}`}>
            {p.note}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A dropdown of known models, or a free-text field for custom providers. */
export function ModelPicker({
  provider,
  value,
  options,
  onChange,
  placeholder,
}: {
  provider: ProviderId;
  value: string;
  options: Record<string, { id: string; label: string }[]>;
  onChange: (model: string) => void;
  placeholder: string;
}) {
  const known = options[provider];
  return (
    <div>
      <label className="text-[10px] text-outline mb-1 block">Model</label>
      {known ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          {!known.some((m) => m.id === value) && value && <option value={value}>{value}</option>}
          {known.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
      )}
    </div>
  );
}

/** Base URL input that only saves once the user stops typing. */
export function BaseUrlInput({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft.trim()), 400);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  const invalid = draft.trim() !== '' && !/^https?:\/\/[^\s/?#]+/i.test(draft.trim());
  return (
    <div>
      <label className="text-[10px] text-outline mb-1 block">Base URL</label>
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="http://localhost:11434/v1"
        spellCheck={false}
        className={`${inputClass} font-mono`}
      />
      <p className={`text-[10px] mt-0.5 ${invalid ? 'text-error' : 'text-outline'}`}>
        {invalid ? 'Must start with http:// or https://' : 'The OpenAI-compatible API root, usually ending in /v1.'}
      </p>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
