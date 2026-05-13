import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Radar } from 'lucide-react';
import type { LLMProvider, ProviderType } from '../types';

interface Props {
  config: LLMProvider;
  onChange: (config: LLMProvider) => void;
}

const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic:   'Claude (Anthropic / Claude Code)',
  openai:      'OpenAI (GPT-4o, o1…)',
  gemini:      'Google Gemini',
  openrouter:  'OpenRouter (1000+ models)',
  ollama:      'Ollama (local)',
  lmstudio:    'LM Studio (local)',
  custom:      'Custom OpenAI-compatible',
};

const FALLBACK_MODELS: Record<ProviderType, string[]> = {
  anthropic: [
    'claude-opus-4-7', 'claude-opus-4-6',
    'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
  ],
  openai:      ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'gpt-4-turbo'],
  gemini:      ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  openrouter:  [
    'openai/gpt-4o', 'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet', 'anthropic/claude-3-haiku',
    'google/gemini-2.0-flash-001', 'google/gemini-flash-1.5',
    'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-large',
    'deepseek/deepseek-chat', 'qwen/qwen-2.5-coder-32b-instruct',
  ],
  ollama:      [],
  lmstudio:    [],
  custom:      [],
};

const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  ollama:   'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
};

const NEEDS_API_KEY: ProviderType[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'custom'];
const NEEDS_BASE_URL: ProviderType[] = ['ollama', 'lmstudio', 'custom', 'anthropic'];

const BASE_URL_LABELS: Partial<Record<ProviderType, string>> = {
  anthropic: 'Base URL (proxy / Claude Code CLI)',
  ollama:    'Base URL',
  lmstudio:  'Base URL',
  custom:    'Base URL',
};

const BASE_URL_PLACEHOLDERS: Partial<Record<ProviderType, string>> = {
  anthropic: 'https://api.anthropic.com  (leave blank for default)',
  ollama:    'http://localhost:11434',
  lmstudio:  'http://localhost:1234/v1',
  custom:    'http://...',
};

type ScanHit = { provider: ProviderType; label: string; url: string };

const LOCAL_SCAN_TARGETS: { provider: ProviderType; label: string; url: string }[] = [
  { provider: 'lmstudio', label: 'LM Studio', url: 'http://localhost:1234/v1' },
  { provider: 'ollama',   label: 'Ollama',    url: 'http://localhost:11434'   },
];

export function ProviderSettings({ config, onChange }: Props) {
  const [testing,       setTesting]       = useState(false);
  const [testResult,    setTestResult]    = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelError,    setModelError]    = useState<string | null>(null);
  const [scanning,      setScanning]      = useState(false);
  const [scanHits,      setScanHits]      = useState<ScanHit[]>([]);

  const update = (patch: Partial<LLMProvider>) => onChange({ ...config, ...patch });
  const provider = config.provider ?? 'anthropic';

  // Auto-detect running local providers (scan common ports)
  const scanProviders = useCallback(async () => {
    setScanning(true);
    setScanHits([]);
    const hits: ScanHit[] = [];
    await Promise.all(
      LOCAL_SCAN_TARGETS.map(async (target) => {
        try {
          const res = await fetch('/api/provider-models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ provider: target.provider, baseUrl: target.url, apiKey: '' }),
            signal: AbortSignal.timeout(3000),
          });
          const data = await res.json();
          if (res.ok && data.models?.length > 0) hits.push(target);
        } catch { /* not running */ }
      })
    );
    setScanHits(hits);
    setScanning(false);
  }, []);

  // Auto-fetch real models for local providers when panel opens or provider changes
  const lastAutoFetch = useRef('');
  useEffect(() => {
    if ((provider === 'ollama' || provider === 'lmstudio') && provider !== lastAutoFetch.current) {
      lastAutoFetch.current = provider;
      fetchModels();
    }
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always include the saved model so the dropdown never shows a blank/wrong value
  const savedModel = config.model || '';
  const baseList   = fetchedModels.length > 0 ? fetchedModels : FALLBACK_MODELS[provider] ?? [];
  const modelList  = savedModel && !baseList.includes(savedModel)
    ? [savedModel, ...baseList]
    : baseList;

  async function fetchModels() {
    setLoadingModels(true);
    setModelError(null);
    try {
      const res  = await fetch('/api/provider-models', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({
          provider,
          baseUrl: config.baseUrl || DEFAULT_BASE_URLS[provider] || '',
          apiKey:  config.apiKey  || '',
        }),
      });
      let data: { models?: string[]; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}). Try restarting the server.`);
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.models?.length) throw new Error('No models returned');
      setFetchedModels(data.models);
      // Auto-select first if no model set yet
      if (!config.model) update({ model: data.models[0] });
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/generate', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({
          messages:  [{ role: 'user', content: 'Say "ok" and nothing else.' }],
          llmConfig: config,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();
      const text = new TextDecoder().decode(value);
      setTestResult(text.includes('error') ? '✗ Connection failed' : '✓ Connected');
      // Auto-fetch models after successful test
      if (!text.includes('error')) fetchModels();
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="provider-settings">
      <div className="settings-title">AI Provider</div>

      {/* Auto-detect local providers */}
      <div className="settings-row" style={{ marginBottom: 4 }}>
        <button
          className="settings-fetch-btn"
          style={{ width: '100%', justifyContent: 'center', gap: 5, padding: '5px 10px' }}
          onClick={scanProviders}
          disabled={scanning}
          title="Scan for running local AI providers (LM Studio, Ollama)"
        >
          <Radar size={11} className={scanning ? 'admin-spin' : ''} />
          {scanning ? 'Scanning…' : 'Auto-detect local providers'}
        </button>
        {scanHits.length > 0 && (
          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {scanHits.map((h) => (
              <button
                key={h.provider}
                className="settings-fetch-btn"
                style={{ width: '100%', justifyContent: 'center', gap: 5, border: '1px solid var(--ok)', color: 'var(--ok)' }}
                onClick={() => { setFetchedModels([]); setModelError(null); lastAutoFetch.current = ''; update({ provider: h.provider, baseUrl: h.url, model: '' }); setScanHits([]); }}
              >
                ✓ {h.label} detected — switch to it
              </button>
            ))}
          </div>
        )}
        {!scanning && scanHits.length === 0 && (
          <span style={{ fontSize: 10, color: 'var(--t3)', display: 'none' }} />
        )}
      </div>

      {/* Provider selector */}
      <div className="settings-row">
        <label className="settings-label">Provider</label>
        <select
          className="settings-input"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as ProviderType;
            setFetchedModels([]);
            setModelError(null);
            lastAutoFetch.current = '';
            update({
              provider: p,
              model:    '',
              baseUrl:  DEFAULT_BASE_URLS[p] ?? '',
            });
          }}
        >
          {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((k) => (
            <option key={k} value={k}>{PROVIDER_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {/* Base URL (proxy / local) */}
      {NEEDS_BASE_URL.includes(provider) && (
        <div className="settings-row">
          <label className="settings-label">{BASE_URL_LABELS[provider] ?? 'Base URL'}</label>
          <input
            className="settings-input"
            type="text"
            placeholder={BASE_URL_PLACEHOLDERS[provider] ?? 'http://...'}
            value={config.baseUrl || ''}
            onChange={(e) => update({ baseUrl: e.target.value })}
            spellCheck={false}
          />
        </div>
      )}

      {/* API Key */}
      {NEEDS_API_KEY.includes(provider) && (
        <div className="settings-row">
          <label className="settings-label">API Key</label>
          <input
            className="settings-input"
            type="password"
            placeholder={
              provider === 'anthropic'  ? 'sk-ant-… or Claude Code CLI key' :
              provider === 'openrouter' ? 'sk-or-v1-…  (from openrouter.ai/keys)' :
              `Enter ${PROVIDER_LABELS[provider]} API key`
            }
            value={config.apiKey || ''}
            onChange={(e) => update({ apiKey: e.target.value })}
            autoComplete="off"
          />
        </div>
      )}

      {/* Model — dropdown + manual input + fetch button */}
      <div className="settings-row">
        <label className="settings-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Model</span>
          <button
            className="settings-fetch-btn"
            onClick={fetchModels}
            disabled={loadingModels}
            title="Fetch available models from provider"
          >
            <RefreshCw size={10} className={loadingModels ? 'admin-spin' : ''} />
            {loadingModels ? 'Loading…' : 'Load models'}
          </button>
        </label>

        {modelList.length > 0 ? (
          <select
            className="settings-input"
            value={config.model || modelList[0]}
            onChange={(e) => update({ model: e.target.value })}
          >
            {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input
            className="settings-input"
            type="text"
            placeholder={
              provider === 'lmstudio' ? 'Enter model name (or click Load models)' :
              provider === 'ollama'   ? 'llama3  (or click Load models)' :
              provider === 'custom'   ? 'Enter model name' :
              'Model name'
            }
            value={config.model || ''}
            onChange={(e) => update({ model: e.target.value })}
            spellCheck={false}
          />
        )}

        {modelError && (
          <span style={{ fontSize: 10, color: '#ff7f7f', marginTop: 4, display: 'block' }}>
            ✗ {modelError}
          </span>
        )}
      </div>

      {/* Test connection */}
      <div className="settings-row">
        <button className="btn-test" onClick={testConnection} disabled={testing}>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {testResult && (
          <span style={{ fontSize: 10, color: testResult.startsWith('✓') ? '#7fff7f' : '#ff7f7f', marginLeft: 8 }}>
            {testResult}
          </span>
        )}
      </div>

      {/* Options */}
      <div className="settings-row" style={{ marginTop: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: '#aaa' }}>
          <input
            type="checkbox"
            checked={config.autoRun !== false}
            onChange={(e) => update({ autoRun: e.target.checked })}
          />
          Auto-run code after generation
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: '#aaa', marginTop: 6 }}>
          <input
            type="checkbox"
            checked={!!config.skipPlanning}
            onChange={(e) => update({ skipPlanning: e.target.checked })}
          />
          Skip planning step
        </label>
      </div>
    </div>
  );
}
