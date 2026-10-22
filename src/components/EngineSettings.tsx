import { useState, useEffect, useCallback, useRef } from 'react';
import { HardDrive, KeyRound, ShieldCheck } from 'lucide-react';
import { engine, EngineMode, LocalModelId, ProviderId } from '../services/engine';
import useLocalModels from '../hooks/useLocalModels';
import { STORAGE_KEYS, DEFAULT_TRANSCRIPTION_MODELS, TRANSCRIPTION_MODEL_OPTIONS } from '../constants';
import LocalModelPicker from './engine/LocalModelPicker';
import ProviderKeyForm from './engine/ProviderKeyForm';
import { ProviderPicker, ModelPicker, BaseUrlInput, PROVIDER_LABELS, saveSetting } from './engine/shared';

interface EngineSettingsProps {
  /**
   * Onboarding gate. True when the user can move on: a local model is
   * downloaded or downloading, or the cloud key passed a test.
   */
  onCanContinueChange?: (canContinue: boolean) => void;
}

/** Choose how Abe transcribes: local Whisper or the user's own provider key. */
export default function EngineSettings({ onCanContinueChange }: EngineSettingsProps) {
  const initial = engine.getConfig();
  const [mode, setMode] = useState<EngineMode | null>(initial.mode);
  const [localModel, setLocalModel] = useState<LocalModelId>(initial.localModel);
  const [provider, setProvider] = useState<ProviderId>(initial.transcription.provider);
  const [model, setModel] = useState(initial.transcription.model);
  const [baseUrl, setBaseUrl] = useState(initial.transcription.baseUrl || '');
  const [keyTested, setKeyTested] = useState(false);
  const localModels = useLocalModels();

  const handleModeChange = (next: EngineMode) => {
    setMode(next);
    saveSetting(STORAGE_KEYS.ENGINE_MODE, next);
  };

  const handleLocalModel = (id: LocalModelId) => {
    setLocalModel(id);
    saveSetting(STORAGE_KEYS.LOCAL_MODEL, id);
  };

  const handleProviderChange = (next: ProviderId) => {
    if (next === provider) return;
    setProvider(next);
    setModel(DEFAULT_TRANSCRIPTION_MODELS[next]);
    setKeyTested(false);
    localStorage.removeItem(STORAGE_KEYS.TRANSCRIPTION_MODEL);
    saveSetting(STORAGE_KEYS.TRANSCRIPTION_PROVIDER, next);
    if (next === 'custom') {
      setBaseUrl(localStorage.getItem(STORAGE_KEYS.TRANSCRIPTION_BASE_URL) || '');
    }
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    saveSetting(STORAGE_KEYS.TRANSCRIPTION_MODEL, next.trim());
  };

  const handleBaseUrl = useCallback((url: string) => {
    setBaseUrl(url);
    setKeyTested(false);
    saveSetting(STORAGE_KEYS.TRANSCRIPTION_BASE_URL, url);
  }, []);

  // Report whether onboarding may continue
  const selectedLocal = localModels.models.find((m) => m.id === localModel);
  const canContinue =
    mode === 'local' ? !!selectedLocal && (selectedLocal.downloaded || selectedLocal.downloading)
    : mode === 'cloud' ? keyTested
    : false;
  const onCanContinueRef = useRef(onCanContinueChange);
  onCanContinueRef.current = onCanContinueChange;
  useEffect(() => {
    onCanContinueRef.current?.(canContinue);
  }, [canContinue]);

  const modeButton = (value: EngineMode, Icon: typeof HardDrive, title: string, subtitle: string) => (
    <button
      onClick={() => handleModeChange(value)}
      className={`flex flex-col items-start gap-1 rounded-xl p-2.5 text-left transition-colors border ${
        mode === value ? 'bg-primary/10 border-primary/40' : 'bg-surface-container-high/50 border-transparent hover:bg-surface-container-high'
      }`}
    >
      <Icon className="w-4 h-4 text-primary" />
      <span className="text-xs font-medium text-on-surface">{title}</span>
      <span className="text-[10px] text-on-surface-variant leading-tight">{subtitle}</span>
    </button>
  );

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        {modeButton('local', HardDrive, 'Local (offline)', 'Free. Runs on this computer, works without internet.')}
        {modeButton('cloud', KeyRound, 'Use my own API key', 'Groq, OpenAI or compatible. Fast on any computer.')}
      </div>

      {mode === 'local' && (
        <div className="space-y-2">
          <LocalModelPicker selected={localModel} onSelect={handleLocalModel} localModels={localModels} />
          {selectedLocal && !selectedLocal.downloaded && !selectedLocal.downloading && (
            <p className="text-[10px] text-tertiary">Download the selected model to start transcribing.</p>
          )}
          <p className="text-[10px] text-outline flex items-start gap-1">
            <ShieldCheck className="w-3 h-3 flex-shrink-0 mt-px text-tertiary" />
            Free and offline. Your audio never leaves this computer. Models download once from Hugging Face.
          </p>
        </div>
      )}

      {mode === 'cloud' && (
        <div className="space-y-2">
          <ProviderPicker value={provider} onChange={handleProviderChange} />
          {provider === 'custom' && <BaseUrlInput value={baseUrl} onChange={handleBaseUrl} />}
          <ModelPicker
            provider={provider}
            value={model}
            options={TRANSCRIPTION_MODEL_OPTIONS}
            onChange={handleModelChange}
            placeholder="whisper-1"
          />
          <ProviderKeyForm
            provider={provider}
            baseUrl={provider === 'custom' ? baseUrl : undefined}
            onTestResult={setKeyTested}
          />
          <p className="text-[10px] text-outline flex items-start gap-1">
            <ShieldCheck className="w-3 h-3 flex-shrink-0 mt-px text-tertiary" />
            <span>
              Audio goes directly from your computer to {PROVIDER_LABELS[provider]}. Abe has no servers.
              {provider !== 'custom' && ' Setting a spend limit in your provider account is a good idea.'}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
