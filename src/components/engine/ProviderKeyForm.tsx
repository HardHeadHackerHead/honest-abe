import { useState, useEffect, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Eye, EyeOff, ClipboardPaste, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { engine, ProviderId, toEngineError } from '../../services/engine';
import { API_KEY_DOCS_URLS } from '../../constants';
import { PROVIDER_LABELS, inputClass, smallButtonClass } from './shared';

type TestState =
  | { type: 'idle' }
  | { type: 'testing' }
  | { type: 'ok'; text: string }
  | { type: 'error'; text: string };

interface ProviderKeyFormProps {
  provider: ProviderId;
  /** Custom provider base URL, used for the connection test */
  baseUrl?: string;
  /** Reports whether the last test of this provider's key passed */
  onTestResult?: (ok: boolean) => void;
  /** Reports whether a key is stored */
  onKeyStored?: (stored: boolean) => void;
}

/**
 * Masked API key entry with Show / Paste / Save & test / Test / Remove.
 * The key goes straight to Rust (system keychain) and is never read back.
 */
export default function ProviderKeyForm({ provider, baseUrl, onTestResult, onKeyStored }: ProviderKeyFormProps) {
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [test, setTest] = useState<TestState>({ type: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const isCustom = provider === 'custom';

  // Keep the latest callbacks without re-running effects when parents re-render
  const onTestResultRef = useRef(onTestResult);
  onTestResultRef.current = onTestResult;
  const onKeyStoredRef = useRef(onKeyStored);
  onKeyStoredRef.current = onKeyStored;

  useEffect(() => {
    let cancelled = false;
    setDraft('');
    setShow(false);
    setTest({ type: 'idle' });
    setHasKey(null);
    engine.hasApiKey(provider).then((stored) => {
      if (cancelled) return;
      setHasKey(stored);
      onKeyStoredRef.current?.(stored);
    });
    return () => { cancelled = true; };
  }, [provider]);

  // A different base URL needs a new test
  useEffect(() => {
    if (isCustom) setTest({ type: 'idle' });
  }, [baseUrl, isCustom]);

  const runTest = async () => {
    setTest({ type: 'testing' });
    try {
      await engine.testApiKey(provider, isCustom ? baseUrl : undefined);
      setTest({ type: 'ok', text: isCustom ? 'Connected' : 'Key works' });
      onTestResultRef.current?.(true);
    } catch (err) {
      const error = toEngineError(err);
      const text = error.kind === 'invalid_key' && !error.message.includes('No API key')
        ? 'This key was rejected. Check that you copied all of it.'
        : error.userMessage;
      setTest({ type: 'error', text });
      onTestResultRef.current?.(false);
    }
  };

  const saveAndTest = async () => {
    const key = draft.trim();
    if (!key) return;
    try {
      await engine.setApiKey(provider, key);
    } catch (err) {
      setTest({ type: 'error', text: toEngineError(err).userMessage });
      return;
    }
    setDraft('');
    setShow(false);
    setHasKey(true);
    onKeyStoredRef.current?.(true);
    await runTest();
  };

  const remove = async () => {
    try {
      await engine.deleteApiKey(provider);
      setHasKey(false);
      setTest({ type: 'idle' });
      onKeyStoredRef.current?.(false);
      onTestResultRef.current?.(false);
    } catch (err) {
      setTest({ type: 'error', text: toEngineError(err).userMessage });
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setDraft(text.trim());
        return;
      }
    } catch {
      // Clipboard read not permitted here; fall back to the keyboard shortcut
    }
    inputRef.current?.focus();
    setTest({ type: 'error', text: 'Press Ctrl+V (Cmd+V on Mac) in the key field to paste.' });
  };

  const placeholder = hasKey
    ? 'Saved. Paste a new key to replace it'
    : isCustom ? 'API key (leave empty if your server has none)' : `Paste your ${PROVIDER_LABELS[provider]} key`;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <label className="text-[10px] text-outline">API key</label>
        <div className="flex items-center gap-2">
          {hasKey && <span className="text-[10px] text-tertiary">Stored in your system keychain</span>}
          <button
            onClick={() => openUrl(API_KEY_DOCS_URLS[provider])}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            How do I get a key?
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type={show ? 'text' : 'password'}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (test.type === 'error') setTest({ type: 'idle' }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveAndTest(); }}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} pr-12 font-mono`}
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex">
            <button
              onClick={() => setShow(s => !s)}
              disabled={!draft}
              className="p-1 text-outline hover:text-on-surface disabled:opacity-30 transition-colors"
              title={show ? 'Hide' : 'Show'}
            >
              {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
            <button onClick={paste} className="p-1 text-outline hover:text-on-surface transition-colors" title="Paste">
              <ClipboardPaste className="w-3 h-3" />
            </button>
          </div>
        </div>
        {draft.trim() ? (
          <button onClick={saveAndTest} className={`${smallButtonClass} bg-primary/15 text-primary hover:bg-primary/25`}>
            Save &amp; test
          </button>
        ) : (
          (hasKey || isCustom) && (
            <button
              onClick={runTest}
              disabled={test.type === 'testing'}
              className={`${smallButtonClass} bg-surface-container-high text-on-surface hover:bg-surface-bright disabled:opacity-50`}
            >
              Test
            </button>
          )
        )}
        {hasKey && !draft && (
          <button onClick={remove} className={`${smallButtonClass} text-error hover:bg-error/10`}>
            Remove
          </button>
        )}
      </div>

      {test.type === 'testing' && (
        <p className="text-[10px] text-on-surface-variant flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Checking with {PROVIDER_LABELS[provider]}...
        </p>
      )}
      {test.type === 'ok' && (
        <p className="text-[10px] text-tertiary flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> {test.text}
        </p>
      )}
      {test.type === 'error' && (
        <p className="text-[10px] text-error flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" /> {test.text}
        </p>
      )}
    </div>
  );
}
