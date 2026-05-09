import React, { useState } from 'react';
import type { LLMProvider, ProviderType } from '../types';

interface Props {
  config: LLMProvider;
  onChange: (config: LLMProvider) => void;
}

const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: 'Claude (Anthropic)',
  openai:    'OpenAI (GPT-4o, o1…)',
  gemini:    'Google Gemini',
  ollama:    'Ollama (local)',
  lmstudio:  'LM Studio (local)',
  custom:    'Custom OpenAI-compatible',
};

const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  gemini:    ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  ollama:    ['llama3', 'mistral', 'codellama', 'phi3'],
  lmstudio:  ['local-model'],
  custom:    [],
};

const NEEDS_BASE_URL: ProviderType[] = ['ollama', 'lmstudio', 'custom'];
const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  ollama:   'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
};

export function ProviderSettings({ config, onChange }: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = (patch: Partial<LLMProvider>) =>
    onChange({ ...config, ...patch });

  const provider = config.provider ?? 'anthropic';

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
          llmConfig: config,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();
      const text = new TextDecoder().decode(value);
      setTestResult(text.includes('error') ? '✗ Connection failed' : '✓ Connected');
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  const models = DEFAULT_MODELS[provider] ?? [];
  const needsBaseUrl = NEEDS_BASE_URL.includes(provider);

  return (
    <div className="provider-settings">
      <div className="settings-title">AI Provider</div>

      <div className="settings-row">
        <label className="settings-label">Provider</label>
        <select
          className="settings-input"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as ProviderType;
            update({ provider: p, model: DEFAULT_MODELS[p]?.[0] ?? '', apiKey: '', baseUrl: DEFAULT_BASE_URLS[p] ?? '' });
          }}
        >
          {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((k) => (
            <option key={k} value={k}>{PROVIDER_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {models.length > 0 && (
        <div className="settings-row">
          <label className="settings-label">Model</label>
          <select
            className="settings-input"
            value={config.model || models[0]}
            onChange={(e) => update({ model: e.target.value })}
          >
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      {provider !== 'ollama' && provider !== 'lmstudio' && (
        <div className="settings-row">
          <label className="settings-label">API Key</label>
          <input
            className="settings-input"
            type="password"
            placeholder={`Enter ${PROVIDER_LABELS[provider]} API key`}
            value={config.apiKey || ''}
            onChange={(e) => update({ apiKey: e.target.value })}
            autoComplete="off"
          />
        </div>
      )}

      {needsBaseUrl && (
        <div className="settings-row">
          <label className="settings-label">Base URL</label>
          <input
            className="settings-input"
            type="text"
            placeholder={DEFAULT_BASE_URLS[provider] ?? 'http://...'}
            value={config.baseUrl || ''}
            onChange={(e) => update({ baseUrl: e.target.value })}
            spellCheck={false}
          />
        </div>
      )}

      <div className="settings-row">
        <button
          className="btn-test"
          onClick={testConnection}
          disabled={testing}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {testResult && (
          <span style={{ fontSize: 10, color: testResult.startsWith('✓') ? '#7fff7f' : '#ff7f7f', marginLeft: 8 }}>
            {testResult}
          </span>
        )}
      </div>
    </div>
  );
}
