import { useState } from 'react';
import { Plus, Code2, MonitorSmartphone, Columns2, Download, Settings, X, Cpu, Cloud } from 'lucide-react';
import type { ViewMode, LlmConfig, GeneratedFile } from '../types';

interface Props {
  projectName:        string;
  onProjectNameChange:(n: string) => void;
  viewMode:           ViewMode;
  onViewModeChange:   (m: ViewMode) => void;
  onNewProject:       () => void;
  isGenerating:       boolean;
  files:              GeneratedFile[];
  activeFilePath:     string;
  llmConfig:          LlmConfig;
  onLlmConfigChange:  (cfg: LlmConfig) => void;
}

export function Header({
  projectName, onProjectNameChange,
  viewMode, onViewModeChange,
  onNewProject, isGenerating,
  files, activeFilePath,
  llmConfig, onLlmConfigChange,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);

  const set = (patch: Partial<LlmConfig>) => onLlmConfigChange({ ...llmConfig, ...patch });

  const activeFile = files.find((f) => f.path === activeFilePath) ?? files[0] ?? null;

  const download = () => {
    if (!activeFile) return;
    const mime = activeFile.lang === 'html'   ? 'text/html'
               : activeFile.lang === 'css'    ? 'text/css'
               : activeFile.lang === 'json'   ? 'application/json'
               : activeFile.lang === 'python' ? 'text/x-python'
               : 'text/plain';
    const blob = new Blob([activeFile.content], { type: mime });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = activeFile.path.split('/').pop() ?? 'file.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const views: { id: ViewMode; icon: React.ReactNode; label: string }[] = [
    { id: 'code',    icon: <Code2 size={13} />,             label: 'Code'    },
    { id: 'split',   icon: <Columns2 size={13} />,          label: 'Split'   },
    { id: 'preview', icon: <MonitorSmartphone size={13} />,  label: 'Preview' },
  ];

  const isLocal = llmConfig.provider === 'local';

  return (
    <header className="header">
      <div className="logo">
        <div className="logo-mark">F</div>
        <span className="logo-text">FORGE</span>
      </div>

      <div className="hdr-sep" />

      <input
        className="project-name"
        value={projectName}
        onChange={(e) => onProjectNameChange(e.target.value)}
        spellCheck={false}
        aria-label="Project name"
      />

      <div className="hdr-space" />

      {/* Provider pill */}
      <div className="provider-pill" title={isLocal ? llmConfig.localUrl : 'Anthropic Claude'}>
        {isLocal ? <Cpu size={11} /> : <Cloud size={11} />}
        {isLocal ? (llmConfig.localModel || 'Local LLM') : 'Claude'}
      </div>

      {isGenerating && (
        <div className="gen-badge">
          <span className="gen-badge-dot" />
          Generating…
        </div>
      )}

      <div className="view-toggle">
        {views.map((v) => (
          <button
            key={v.id}
            className={`vt-btn${viewMode === v.id ? ' active' : ''}`}
            onClick={() => onViewModeChange(v.id)}
          >
            {v.icon}
            {v.label}
          </button>
        ))}
      </div>

      {activeFile && (
        <button className="icon-btn" onClick={download} title={`Download ${activeFile.path.split('/').pop()}`}>
          <Download size={15} />
        </button>
      )}

      <button className="new-btn" onClick={onNewProject}>
        <Plus size={13} /> New
      </button>

      {/* Settings */}
      <div className="settings-wrap">
        <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Settings">
          {showSettings ? <X size={15} /> : <Settings size={15} />}
        </button>

        {showSettings && (
          <div className="settings-panel">
            <div className="settings-title">LLM Provider</div>

            <div className="provider-toggle">
              <button className={`provider-btn${!isLocal ? ' active' : ''}`} onClick={() => set({ provider: 'anthropic' })}>
                <Cloud size={13} /> Anthropic
              </button>
              <button className={`provider-btn${isLocal ? ' active' : ''}`} onClick={() => set({ provider: 'local' })}>
                <Cpu size={13} /> Local LLM
              </button>
            </div>

            {!isLocal && (
              <>
                <div className="settings-row">
                  <label className="settings-label">Base URL <span style={{ opacity: .5 }}>(optional)</span></label>
                  <input className="settings-input" type="url"
                    value={llmConfig.anthropicBaseUrl} onChange={(e) => set({ anthropicBaseUrl: e.target.value })}
                    placeholder="https://api.anthropic.com" spellCheck={false} />
                  <p className="settings-hint">Custom proxy endpoint. Leave blank for default.</p>
                </div>
                <div className="settings-row">
                  <label className="settings-label">API Key <span style={{ opacity: .5 }}>(optional)</span></label>
                  <input className="settings-input" type="password"
                    value={llmConfig.anthropicKey} onChange={(e) => set({ anthropicKey: e.target.value })}
                    placeholder="sk-ant-..." spellCheck={false} autoComplete="off" />
                  <p className="settings-hint">Leave blank to use server's <code>ANTHROPIC_API_KEY</code>.</p>
                </div>
              </>
            )}

            {isLocal && (
              <>
                <div className="settings-row">
                  <label className="settings-label">Base URL</label>
                  <input className="settings-input" type="url"
                    value={llmConfig.localUrl} onChange={(e) => set({ localUrl: e.target.value })}
                    placeholder="http://localhost:1234/v1" spellCheck={false} />
                  <p className="settings-hint">LM Studio default: <code>http://localhost:1234/v1</code></p>
                </div>
                <div className="settings-row">
                  <label className="settings-label">Model name</label>
                  <input className="settings-input" type="text"
                    value={llmConfig.localModel} onChange={(e) => set({ localModel: e.target.value })}
                    placeholder="e.g. llama-3.2-3b-instruct" spellCheck={false} />
                  <p className="settings-hint">Must match the model loaded in LM Studio.</p>
                </div>
                <div className="settings-row">
                  <label className="settings-label">API Key <span style={{ opacity: .5 }}>(optional)</span></label>
                  <input className="settings-input" type="password"
                    value={llmConfig.localKey} onChange={(e) => set({ localKey: e.target.value })}
                    placeholder="Leave blank for LM Studio" spellCheck={false} autoComplete="off" />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
