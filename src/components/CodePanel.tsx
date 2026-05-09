import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Copy, Check, FileCode } from 'lucide-react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import type { GeneratedFile, ExecutionState, LLMProvider } from '../types';
import { TerminalPane } from './TerminalPane';
import { StatusBar } from './StatusBar';
import { buildCommand, isWebFile } from '../hooks/useExecution';
import { useAutoFix } from '../hooks/useAutoFix';

// ── Custom FORGE syntax theme ─────────────────────────────────
const forgeTheme: Record<string, React.CSSProperties> = {
  'hljs':                   { display:'block', overflowX:'auto', padding:'20px 22px', background:'#040406', color:'#C0C0E0', fontSize:'13px', lineHeight:'1.75', fontFamily:"'JetBrains Mono', monospace" },
  'hljs-comment':           { color:'#33335A' },
  'hljs-quote':             { color:'#33335A' },
  'hljs-keyword':           { color:'#FF7C45' },
  'hljs-selector-tag':      { color:'#FF7C45' },
  'hljs-literal':           { color:'#FF7C45' },
  'hljs-section':           { color:'#EEEEF8', fontWeight:'bold' },
  'hljs-link':              { color:'#88CCFF' },
  'hljs-string':            { color:'#88DDBB' },
  'hljs-title':             { color:'#EEEEF8', fontWeight:'bold' },
  'hljs-name':              { color:'#FF7C45' },
  'hljs-type':              { color:'#00C4AA' },
  'hljs-attribute':         { color:'#00C4AA' },
  'hljs-number':            { color:'#AABB88' },
  'hljs-tag':               { color:'#FF5E1A' },
  'hljs-attr':              { color:'#00C4AA' },
  'hljs-meta':              { color:'#8888AA' },
  'hljs-emphasis':          { fontStyle:'italic' },
  'hljs-strong':            { fontWeight:'bold' },
  'hljs-built_in':          { color:'#00C4AA' },
  'hljs-addition':          { color:'#22C55E', background:'rgba(34,197,94,.08)' },
  'hljs-deletion':          { color:'#EF4444', background:'rgba(239,68,68,.08)' },
  'hljs-punctuation':       { color:'#8888AA' },
};

function filename(p: string) { return p.split('/').pop() ?? p; }

interface Props {
  files:          GeneratedFile[];
  activeFilePath: string;
  onSelectFile:   (path: string) => void;
  streamingFile:  { path: string; lang: string; content: string } | null;
  isGenerating:   boolean;
  execState:      ExecutionState;
  onRun:          (filePath: string, content: string) => void;
  onStop:         () => void;
  writeRef:       React.MutableRefObject<((data: string) => void) | null>;
  llmConfig:      LLMProvider;
  onUpdateFile:   (path: string, content: string) => void;
}

export function CodePanel({ files, activeFilePath, onSelectFile, streamingFile, isGenerating, execState, onRun, onStop, writeRef, llmConfig, onUpdateFile }: Props) {
  const [copied, setCopied] = useState(false);
  const [termHeight, setTermHeight] = useState(0);

  const { state: autoFixState, attemptFix } = useAutoFix(
    llmConfig,
    onRun,
    onUpdateFile,
  );

  const terminalOutputRef = useRef('');

  // Wrap writeRef to also accumulate terminal output for auto-fix
  const wrappedWriteRef = useRef<((data: string) => void) | null>(null);
  useEffect(() => {
    wrappedWriteRef.current = (data: string) => {
      writeRef.current?.(data);
      terminalOutputRef.current += data;
    };
  }, [writeRef]);

  // Auto-fix: when execution exits with non-zero code, attempt fix
  useEffect(() => {
    if (execState.status === 'exited' && execState.exitCode !== 0 && execState.exitCode !== null) {
      const activeFile = files.find((f) => f.path === activeFilePath) ?? files[0];
      if (activeFile && terminalOutputRef.current) {
        attemptFix(activeFile.path, activeFile.content, terminalOutputRef.current);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execState.status, execState.exitCode]);

  // Reset terminal output accumulator when a new run starts
  useEffect(() => {
    if (execState.status === 'running') {
      terminalOutputRef.current = '';
    }
  }, [execState.status]);

  // Build the tab list: completed files + the in-progress one (if different)
  const tabs = streamingFile && !files.find((f) => f.path === streamingFile.path)
    ? [...files, streamingFile]
    : files;

  // Determine what to display
  const isStreamingActive = !!streamingFile && (
    !activeFilePath || activeFilePath === streamingFile.path
  );
  const displayFile: GeneratedFile | null = isStreamingActive
    ? streamingFile
    : (files.find((f) => f.path === activeFilePath) ?? files[0] ?? null);

  const copy = () => {
    if (!displayFile) return;
    navigator.clipboard.writeText(displayFile.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRunClick = useCallback(() => {
    const file = files.find((f) => f.path === activeFilePath) ?? files[0];
    if (!file) return;
    if (termHeight === 0) setTermHeight(220);
    onRun(file.path, file.content);
  }, [activeFilePath, files, onRun, termHeight]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = termHeight;
    const onMove = (ev: MouseEvent) => {
      setTermHeight(Math.max(0, Math.min(startH + (startY - ev.clientY), 600)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [termHeight]);

  return (
    <div className="code-panel">
      {/* Toolbar */}
      <div className="code-toolbar">
        <div className="code-tabs">
          {tabs.length === 0 && (
            <div className="code-tab active">
              <FileCode size={12} />
              —
            </div>
          )}
          {tabs.map((f) => {
            const isStreaming = streamingFile?.path === f.path;
            const isActive    = isStreamingActive
              ? isStreaming
              : f.path === (activeFilePath || files[0]?.path);
            return (
              <button
                key={f.path}
                className={`code-tab${isActive ? ' active' : ''}`}
                onClick={() => { if (!isStreaming) onSelectFile(f.path); }}
                title={f.path}
              >
                <FileCode size={11} />
                {filename(f.path)}
                {isStreaming && <span className="tab-pulse" />}
              </button>
            );
          })}
        </div>

        {/* Run button */}
        {(() => {
          const activeFile = files.find((f) => f.path === activeFilePath) ?? files[0];
          if (!activeFile) return null;
          const isWeb = isWebFile(activeFile.path);
          const cmd = buildCommand(activeFile.path);
          if (!isWeb && !cmd) return (
            <span className="run-btn run-btn--disabled" title={`No runtime for this file type`}>▶ Run</span>
          );
          const label = isWeb ? '▶ Preview' : `▶ Run (${cmd!.split(' ')[0]})`;
          return (
            <button
              className={`run-btn${execState.status === 'running' ? ' run-btn--running' : ''}`}
              onClick={handleRunClick}
              disabled={execState.status === 'running'}
              title={cmd ?? 'Refresh preview'}
            >
              {execState.status === 'running' ? '⏳ Running…' : label}
            </button>
          );
        })()}

        <div className="code-actions">
          {displayFile && (
            <button
              className={`icon-btn${copied ? ' icon-btn--ok' : ''}`}
              onClick={copy}
              title={copied ? 'Copied!' : 'Copy'}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="code-body">
        {displayFile ? (
          <SyntaxHighlighter
            language={displayFile.lang}
            style={forgeTheme}
            showLineNumbers
            lineNumberStyle={{
              color: 'var(--t4)', fontSize: '11px',
              paddingRight: '18px', userSelect: 'none', minWidth: '2.5em',
            }}
            wrapLines
          >
            {displayFile.content}
          </SyntaxHighlighter>
        ) : (
          <div className="code-placeholder">
            {isGenerating ? (
              <div className="code-generating">
                <span className="gen-ring" />
                Generating…
              </div>
            ) : (
              <>
                <FileCode size={28} style={{ opacity: .18 }} />
                <span>Code will appear here</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        execStatus={execState.status}
        exitCode={execState.exitCode}
        autoFixStatus={autoFixState.status}
        autoFixAttempt={autoFixState.attempt}
        autoFixMax={autoFixState.maxAttempts}
        lastMessage={autoFixState.lastError}
      />

      {/* Drag handle */}
      <div
        className="resize-handle"
        onMouseDown={handleDragStart}
        style={{ cursor: 'ns-resize' }}
      />

      {/* Terminal pane */}
      {termHeight > 0 && (
        <div style={{ height: termHeight, flexShrink: 0 }}>
          <TerminalPane
            command={execState.command}
            status={execState.status}
            exitCode={execState.exitCode}
            wsUrl="ws://localhost:3001/terminal"
            onStop={onStop}
            onClear={() => {}}
            writeRef={wrappedWriteRef}
          />
        </div>
      )}
    </div>
  );
}
