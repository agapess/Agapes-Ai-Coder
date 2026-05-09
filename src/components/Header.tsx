import { useState } from 'react';
import { Plus, Code2, MonitorSmartphone, Columns2, Download, Settings, X, Cpu, Cloud } from 'lucide-react';
import type { ViewMode, LLMProvider, GeneratedFile } from '../types';
import { ProviderSettings } from './ProviderSettings';

interface Props {
  projectName:        string;
  onProjectNameChange:(n: string) => void;
  viewMode:           ViewMode;
  onViewModeChange:   (m: ViewMode) => void;
  onNewProject:       () => void;
  isGenerating:       boolean;
  files:              GeneratedFile[];
  activeFilePath:     string;
  llmConfig:          LLMProvider;
  onLlmConfigChange:  (cfg: LLMProvider) => void;
}

export function Header({
  projectName, onProjectNameChange,
  viewMode, onViewModeChange,
  onNewProject, isGenerating,
  files, activeFilePath,
  llmConfig, onLlmConfigChange,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);

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
      <div className="provider-pill" title={llmConfig.provider}>
        {llmConfig.provider === 'ollama' || llmConfig.provider === 'lmstudio' ? <Cpu size={11} /> : <Cloud size={11} />}
        {llmConfig.model || llmConfig.provider}
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
            <ProviderSettings
              config={llmConfig}
              onChange={onLlmConfigChange}
            />
          </div>
        )}
      </div>
    </header>
  );
}
