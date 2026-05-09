import { useState } from 'react';
import { Copy, Check, FileCode } from 'lucide-react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import type { GeneratedFile } from '../types';

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
}

export function CodePanel({ files, activeFilePath, onSelectFile, streamingFile, isGenerating }: Props) {
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}
