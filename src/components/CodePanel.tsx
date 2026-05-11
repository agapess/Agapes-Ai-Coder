import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Copy, Check, FileCode, Clock, Globe, Pencil, X, Eye, BookOpen, Wrench, FileText, GitCompare } from 'lucide-react';
import { DiffPanel } from './DiffPanel';
import type { PendingDiff } from '../types';
import SyntaxHighlighter from 'react-syntax-highlighter';
import type { GeneratedFile, ExecutionState, LLMProvider, Snapshot, TestResult } from '../types';
import type { PublishState } from '../hooks/usePublish';
import { TerminalPane } from './TerminalPane';
import { StatusBar } from './StatusBar';
import { SnapshotTimeline } from './SnapshotTimeline';
import { TestBadge } from './TestBadge';
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
  files:              GeneratedFile[];
  activeFilePath:     string;
  onSelectFile:       (path: string) => void;
  streamingFile:      { path: string; lang: string; content: string } | null;
  isGenerating:       boolean;
  execState:          ExecutionState;
  onRun:              (filePath: string, content: string, allFiles?: { path: string; content: string }[]) => void;
  onStop:             () => void;
  writeRef:           React.MutableRefObject<((data: string) => void) | null>;
  terminalOutputRef:  React.MutableRefObject<string>;
  llmConfig:          LLMProvider;
  onUpdateFile:       (path: string, content: string) => void;
  snapshots?:         Snapshot[];
  onRestoreSnapshot?: (id: string) => void;
  testResult?:           TestResult;
  onRunTests?:           () => void;
  playwrightResult?:     TestResult;
  onRunPlaywrightTests?: () => void;
  publishState?:         PublishState;
  onPublish?:            () => void;
  onUnpublish?:          () => void;
  hasUser?:              boolean;
  onFixWithAI?:          () => void;
  disableAutoFix?:       boolean;
  onCodeAction?:         (action: 'explain' | 'refactor' | 'docs', content: string, filename: string) => void;
  reviewMode?:                  boolean;
  onToggleReviewMode?:          () => void;
  pendingDiffs?:                PendingDiff[];
  showReviewConfirm?:           boolean;
  onAcceptHunk?:                (path: string, i: number) => void;
  onRejectHunk?:                (path: string, i: number) => void;
  onAcceptAll?:                 (path: string) => void;
  onRejectAll?:                 (path: string) => void;
  onReviewConfirmAcceptAll?:    () => void;
  onReviewConfirmRejectAll?:    () => void;
  onReviewConfirmKeep?:         () => void;
}

export function CodePanel({ files, activeFilePath, onSelectFile, streamingFile, isGenerating, execState, onRun, onStop, writeRef, terminalOutputRef, llmConfig, onUpdateFile, snapshots = [], onRestoreSnapshot, testResult, onRunTests, playwrightResult, onRunPlaywrightTests, publishState, onPublish, onUnpublish, hasUser, onFixWithAI, disableAutoFix, onCodeAction, reviewMode, onToggleReviewMode, pendingDiffs = [], showReviewConfirm, onAcceptHunk, onRejectHunk, onAcceptAll, onRejectAll, onReviewConfirmAcceptAll, onReviewConfirmRejectAll, onReviewConfirmKeep }: Props) {
  const [copied, setCopied]           = useState(false);
  const [termHeight, setTermHeight]   = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  // ── Inline editor state ────────────────────────────────────
  const [editMode, setEditMode]     = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isDirty, setIsDirty]       = useState(false);
  const editContentRef              = useRef('');
  const editingPathRef              = useRef('');
  const editorRef                   = useRef<HTMLTextAreaElement>(null);
  editContentRef.current = editContent;

  // Wrap onRun so auto-fix re-runs always carry the full file set
  const runWithAllFiles = useCallback((filePath: string, content: string) => {
    const allFiles = files.map(f =>
      f.path === filePath ? { path: f.path, content } : { path: f.path, content: f.content }
    );
    onRun(filePath, content, allFiles);
  }, [files, onRun]);

  const { state: autoFixState, attemptFix } = useAutoFix(
    llmConfig,
    runWithAllFiles,
    onUpdateFile,
  );

  // Auto-fix loop tracking — preserved across useEffect re-fires so we can stop after 3 attempts
  const autoFixAttemptsRef = useRef(0);
  const autoFixErrorsRef   = useRef<string[]>([]);
  const MAX_AUTO_FIX_ATTEMPTS = 3;

  // Auto-fix: when execution exits with non-zero code, attempt fix
  useEffect(() => {
    if (disableAutoFix) return;
    if (execState.status === 'exited' && execState.exitCode === 0) {
      // Successful run — reset auto-fix counter
      autoFixAttemptsRef.current = 0;
      autoFixErrorsRef.current = [];
      return;
    }
    if (execState.status === 'exited' && execState.exitCode !== 0 && execState.exitCode !== null) {
      const activeFile = files.find((f) => f.path === activeFilePath) ?? files[0];
      if (!activeFile) return;
      const errorOutput = terminalOutputRef.current || `Exit code ${execState.exitCode}`;

      autoFixAttemptsRef.current += 1;
      if (autoFixAttemptsRef.current > MAX_AUTO_FIX_ATTEMPTS) {
        writeRef.current?.(`\r\n\x1b[31m[Auto-fix] Stopped after ${MAX_AUTO_FIX_ATTEMPTS} attempts. Try fixing manually or rephrasing your request.\x1b[0m\r\n`);
        autoFixAttemptsRef.current = 0;
        autoFixErrorsRef.current = [];
        return;
      }

      // Build error history so the AI sees what previous attempts produced
      autoFixErrorsRef.current.push(errorOutput.slice(0, 500));
      const history = autoFixErrorsRef.current.slice(0, -1);
      const augmentedError = history.length > 0
        ? `Current error:\n${errorOutput}\n\nPrevious failed fix attempts had these errors:\n${history.map((e, i) => `--- Attempt ${i + 1} ---\n${e}`).join('\n')}\n\nThe previous fixes did not work. Try a DIFFERENT approach this time.`
        : errorOutput;

      const allFiles = files.map((f) => ({ path: f.path, content: f.content }));
      attemptFix(activeFile.path, activeFile.content, augmentedError, (data) => writeRef.current?.(data), allFiles);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execState.status, execState.exitCode]);

  // ── Edit mode handlers ─────────────────────────────────────
  const enterEditMode = useCallback(() => {
    const file = files.find(f => f.path === activeFilePath) ?? files[0];
    if (!file) return;
    setEditContent(file.content);
    setIsDirty(false);
    editingPathRef.current = file.path;
    setEditMode(true);
    setTimeout(() => editorRef.current?.focus(), 0);
  }, [files, activeFilePath]);

  const exitEditMode = useCallback((save: boolean) => {
    if (save && editingPathRef.current) {
      onUpdateFile(editingPathRef.current, editContentRef.current);
    }
    setIsDirty(false);
    setEditMode(false);
  }, [onUpdateFile]);

  const handleEditorChange = (val: string) => {
    setEditContent(val);
    setIsDirty(val !== (files.find(f => f.path === editingPathRef.current)?.content ?? ''));
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = editorRef.current!;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next  = editContent.slice(0, start) + '  ' + editContent.slice(end);
      handleEditorChange(next);
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.selectionStart = editorRef.current.selectionEnd = start + 2;
        }
      });
    }
    if (e.key === 'Escape') exitEditMode(false);
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      exitEditMode(true);
    }
  };

  // When the active file changes while in edit mode — auto-save then reload
  useEffect(() => {
    if (!editMode) return;
    const newPath = activeFilePath || files[0]?.path || '';
    if (editingPathRef.current && editingPathRef.current !== newPath) {
      if (isDirty) onUpdateFile(editingPathRef.current, editContentRef.current);
      editingPathRef.current = newPath;
      const newFile = files.find(f => f.path === newPath);
      setEditContent(newFile?.content ?? '');
      setIsDirty(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  // When AI updates the file content while NOT dirty, sync the editor
  useEffect(() => {
    if (!editMode || isDirty) return;
    const cur = files.find(f => f.path === editingPathRef.current);
    if (cur && cur.content !== editContent) {
      setEditContent(cur.content);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Exit edit mode when streaming starts
  useEffect(() => {
    if (isGenerating && editMode) exitEditMode(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating]);

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
    const allFiles = files.map(f => ({ path: f.path, content: f.content }));
    onRun(file.path, file.content, allFiles);
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

  useEffect(() => {
    if (execState.status === 'running' && termHeight === 0) setTermHeight(220);
  }, [execState.status]);

  const getActionContent = (): { content: string; filename: string } => {
    const file = displayFile;
    if (!file) return { content: '', filename: '' };
    const fname = file.path.split('/').pop() ?? file.path;
    if (editMode && editorRef.current) {
      const { selectionStart, selectionEnd } = editorRef.current;
      if (selectionStart !== selectionEnd) {
        return { content: editorRef.current.value.slice(selectionStart, selectionEnd), filename: fname };
      }
    }
    return { content: file.content, filename: fname };
  };

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
                className={`code-tab${isActive ? ' active' : ''}${isActive && editMode && isDirty ? ' dirty' : ''}`}
                onClick={() => { if (!isStreaming) onSelectFile(f.path); }}
                title={f.path}
              >
                <FileCode size={11} />
                {filename(f.path)}
                {isStreaming && <span className="tab-pulse" />}
                {pendingDiffs.some(d => d.path === f.path) && (
                  <span className="tab-diff-badge">●</span>
                )}
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
          {/* Review mode toggle */}
          {onToggleReviewMode && (
            <>
              <button
                className={`icon-btn${reviewMode ? ' icon-btn--active' : ''}`}
                onClick={onToggleReviewMode}
                title={reviewMode ? 'Review Mode ON — click to toggle off' : 'Enable Review Mode (hold AI edits for approval)'}
                style={reviewMode ? { color: '#a78bfa' } : undefined}
              >
                <GitCompare size={13} />
              </button>
              {pendingDiffs.length > 1 && (
                <span className="diff-multi-badge">{pendingDiffs.length} pending</span>
              )}
            </>
          )}
          {/* Code Intelligence */}
          {displayFile && !isStreamingActive && onCodeAction && (
            <>
              <button
                className="icon-btn"
                title="Explain this code"
                onClick={() => { const { content, filename } = getActionContent(); if (content) onCodeAction('explain', content, filename); }}
              >
                <BookOpen size={13} />
              </button>
              <button
                className="icon-btn"
                title="Refactor this code"
                onClick={() => { const { content, filename } = getActionContent(); if (content) onCodeAction('refactor', content, filename); }}
              >
                <Wrench size={13} />
              </button>
              <button
                className="icon-btn"
                title="Add documentation"
                onClick={() => { const { content, filename } = getActionContent(); if (content) onCodeAction('docs', content, filename); }}
              >
                <FileText size={13} />
              </button>
            </>
          )}
          {/* Edit / View toggle */}
          {displayFile && !isStreamingActive && (
            editMode ? (
              <>
                <button
                  className={`run-btn${isDirty ? '' : ' run-btn--disabled'}`}
                  onClick={() => exitEditMode(true)}
                  title="Save changes (Ctrl+S)"
                  style={{ fontSize: 11, padding: '0 10px', gap: 4 }}
                >
                  <Check size={11} />
                  {isDirty ? 'Save' : 'Saved'}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => exitEditMode(false)}
                  title="Discard changes (Esc)"
                >
                  <X size={13} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => { exitEditMode(true); }}
                  title="Switch to view mode"
                  style={{ opacity: 0.6 }}
                >
                  <Eye size={13} />
                </button>
              </>
            ) : (
              <button
                className="icon-btn"
                onClick={enterEditMode}
                title="Edit file (Pencil)"
              >
                <Pencil size={13} />
              </button>
            )
          )}
          {testResult && onRunTests && files.length > 0 && (
            <TestBadge result={testResult} onRun={onRunTests} />
          )}
          {playwrightResult && onRunPlaywrightTests && files.some((f) => isWebFile(f.path)) && (
            <TestBadge
              result={playwrightResult}
              onRun={onRunPlaywrightTests}
              label="Browser Test"
            />
          )}
          {hasUser && files.length > 0 && publishState && (
            publishState.isPublished ? (
              <button
                className="publish-toolbar-btn publish-toolbar-btn--live"
                onClick={onPublish}
                title={`Published at ${publishState.url}`}
              >
                <Globe size={11} />
                Published
              </button>
            ) : (
              <button
                className="publish-toolbar-btn"
                onClick={onPublish}
                title="Publish this app"
              >
                <Globe size={11} />
                Publish
              </button>
            )
          )}
          <button
            className={`snapshot-toggle-btn${showHistory ? ' active' : ''}`}
            onClick={() => setShowHistory((v) => !v)}
            title="Version history"
          >
            <Clock size={12} />
            {snapshots.length > 0 ? snapshots.length : ''}
          </button>
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

      {/* Review confirm bar */}
      {reviewMode && showReviewConfirm && (
        <div className="review-confirm-bar">
          <span className="review-confirm-label">
            {pendingDiffs.length} file{pendingDiffs.length !== 1 ? 's' : ''} changed — review and accept or reject
          </span>
          <div className="review-confirm-actions">
            <button className="review-confirm-btn review-confirm-btn--accept" onClick={onReviewConfirmAcceptAll}>
              Accept all files
            </button>
            <button className="review-confirm-btn review-confirm-btn--reject" onClick={onReviewConfirmRejectAll}>
              Reject all files
            </button>
            <button className="review-confirm-btn review-confirm-btn--keep" onClick={onReviewConfirmKeep}>
              Keep reviewing
            </button>
          </div>
        </div>
      )}

      {/* Snapshot timeline */}
      {showHistory && (
        <SnapshotTimeline
          snapshots={snapshots}
          onRestore={(id) => { onRestoreSnapshot?.(id); setShowHistory(false); }}
        />
      )}

      {/* Body */}
      <div className="code-body">
        {(() => {
          const activeDiff = pendingDiffs.find(d => d.path === (activeFilePath || files[0]?.path));
          if (activeDiff) {
            return (
              <DiffPanel
                diff={activeDiff}
                onAcceptHunk={(i) => onAcceptHunk?.(activeDiff.path, i)}
                onRejectHunk={(i) => onRejectHunk?.(activeDiff.path, i)}
                onAcceptAll={() => onAcceptAll?.(activeDiff.path)}
                onRejectAll={() => onRejectAll?.(activeDiff.path)}
              />
            );
          }
          return displayFile ? (
            editMode ? (
              <textarea
                ref={editorRef}
                className="code-editor-textarea"
                value={editContent}
                onChange={(e) => handleEditorChange(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            ) : (
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
            )
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
          );
        })()}
      </div>

      {/* Status bar */}
      <StatusBar
        execStatus={execState.status}
        exitCode={execState.exitCode}
        autoFixStatus={autoFixState.status}
        autoFixAttempt={autoFixState.attempt}
        autoFixMax={autoFixState.maxAttempts}
        lastMessage={autoFixState.lastError}
        onFixWithAI={onFixWithAI}
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
            writeRef={writeRef}
          />
        </div>
      )}
    </div>
  );
}
