import { useState, useRef, useEffect } from 'react';
import type React from 'react';
import { Plus, Code2, MonitorSmartphone, Columns2, Download, Settings, X, Cpu, Cloud, LogOut, ShieldCheck, Sun, Moon, LayoutList } from 'lucide-react';
import type { ViewMode, LLMProvider, GeneratedFile } from '../types';
import type { AuthUser } from '../hooks/useAuth';
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
  user?:              AuthUser | null;
  onLogout?:          () => void;
  onSaveApiKey?:      (provider: string, key: string, baseUrl?: string, model?: string) => void;
  onOpenAdmin?:       () => void;
}

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('agapes_theme') as 'dark' | 'light') || 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('agapes_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => t === 'dark' ? 'light' : 'dark') };
}

export function Header({
  projectName, onProjectNameChange,
  viewMode, onViewModeChange,
  onNewProject, isGenerating,
  files, activeFilePath,
  llmConfig, onLlmConfigChange,
  user, onLogout, onSaveApiKey, onOpenAdmin,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const activeFile = files.find((f) => f.path === activeFilePath) ?? files[0] ?? null;

  const handleProviderChange = (cfg: LLMProvider) => {
    onLlmConfigChange(cfg);
    // Auto-save is handled by the debounced effect in App.tsx
  };

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
    { id: 'code',     icon: <Code2 size={13} />,            label: 'Code'     },
    { id: 'split',    icon: <Columns2 size={13} />,         label: 'Split'    },
    { id: 'preview',  icon: <MonitorSmartphone size={13} />, label: 'Preview' },
    { id: 'features', icon: <LayoutList size={13} />,       label: 'Features' },
  ];

  return (
    <header className="header">
      <div className="logo">
        <div className="logo-mark">A</div>
        <span className="logo-text">Agapes Ai Coder</span>
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

      <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <button className="new-btn" onClick={onNewProject}>
        <Plus size={13} /> New
      </button>

      {/* Settings */}
      <div className="settings-wrap" ref={settingsRef}>
        <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Settings">
          {showSettings ? <X size={15} /> : <Settings size={15} />}
        </button>

        {showSettings && (
          <div className="settings-panel">
            <ProviderSettings
              config={llmConfig}
              onChange={handleProviderChange}
            />
          </div>
        )}
      </div>

      {user && (
        <div className="user-badge">
          <strong>{user.username}</strong>
          {user.isAdmin && <span style={{ color: '#FF5E1A', fontSize: 10 }}>admin</span>}
        </div>
      )}
      {user?.isAdmin && onOpenAdmin && (
        <button className="logout-btn" onClick={onOpenAdmin} title="Admin panel" style={{ color: '#FF5E1A', borderColor: 'rgba(255,94,26,.3)' }}>
          <ShieldCheck size={13} />
        </button>
      )}
      {user && onLogout && (
        <button className="logout-btn" onClick={onLogout} title="Sign out">
          <LogOut size={13} />
        </button>
      )}
    </header>
  );
}
