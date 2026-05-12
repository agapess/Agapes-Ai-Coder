import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, ExternalLink, MonitorSmartphone, Code2 } from 'lucide-react';
import type { GeneratedFile } from '../types';

// Used only during streaming (srcDoc mode) — after generation the server preview
// injects this script itself so console logs still reach the terminal.
const CONSOLE_INTERCEPTOR = `<script>
(function() {
  const _send = (level, args) => {
    const formatted = args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
      catch { return String(a); }
    }).join(' ');
    window.parent.postMessage({ type: 'console', level, text: formatted }, '*');
  };
  ['log','warn','error','info','debug'].forEach(l => {
    const orig = console[l].bind(console);
    console[l] = (...args) => { orig(...args); _send(l, args); };
  });
  window.onerror = (msg, src, line, col, err) => {
    _send('error', [\`\${msg} (line \${line})\${err?.stack ? '\\n' + err.stack : ''}\`]);
  };
  window.addEventListener('unhandledrejection', e => {
    _send('error', ['Unhandled Promise rejection: ' + (e.reason?.message || e.reason)]);
  });
})();
<\/script>`;

interface Props {
  files:        GeneratedFile[];
  isGenerating: boolean;
  onShowCode:   () => void;
  writeRef?:    React.MutableRefObject<((data: string) => void) | null>;
  projectId?:   string;
}

export function PreviewPanel({ files, isGenerating, onShowCode, writeRef, projectId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [loaded, setLoaded]         = useState(false);
  const iframeRef                   = useRef<HTMLIFrameElement>(null);

  // Find the previewable HTML file
  const htmlFile = files.find((f) => f.path === 'index.html')
    ?? files.find((f) => f.path.endsWith('.html'));

  const hasPreview = !!htmlFile;
  const hasFiles   = files.length > 0;

  // After streaming completes, use the server-side preview URL so all relative
  // imports (CSS, JS, ES modules, images) work without client-side inlining.
  // During streaming we fall back to srcDoc for immediate feedback.
  const serverPreviewUrl =
    !isGenerating && projectId && htmlFile
      ? `/api/projects/${projectId}/preview/${htmlFile.path}`
      : null;

  // Remount iframe when switching mode, on manual refresh, or when files change after generation
  const filesHash = files.map((f) => `${f.path}:${f.content.length}`).join('|');
  const iframeKey = serverPreviewUrl
    ? `srv-${projectId}-${refreshKey}-${filesHash}`
    : `doc-${refreshKey}`;

  useEffect(() => { setLoaded(false); }, [iframeKey]);

  useEffect(() => {
    if (!writeRef) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'console') return;
      const { level, text } = e.data as { level: string; text: string };
      const colors: Record<string, string> = {
        error: '\x1b[31m',
        warn:  '\x1b[33m',
        info:  '\x1b[36m',
        log:   '\x1b[37m',
        debug: '\x1b[90m',
      };
      const color = colors[level] ?? '\x1b[37m';
      writeRef.current?.(`${color}[${level}] ${text}\x1b[0m\r\n`);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [writeRef]);

  // Inline companion JS/CSS files into HTML for srcDoc mode (streaming)
  function inlineAssets(html: string): string {
    const fileMap = new Map(files.map((f) => [f.path, f.content]));

    // <script src="./foo.js"> → <script>...content...</script>
    html = html.replace(
      /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
      (_match, pre, src, post) => {
        const key = src.replace(/^\.\//, '');
        const content = fileMap.get(key) ?? fileMap.get(src);
        if (content == null) return _match;
        return `<script${pre}${post}>${content}<\/script>`;
      },
    );

    // <link rel="stylesheet" href="./foo.css"> → <style>...content...</style>
    html = html.replace(
      /<link\b([^>]*)\bhref=["']([^"']+)["']([^>]*)>/gi,
      (_match, pre, href, post) => {
        if (!/rel=["']stylesheet["']/i.test(pre + post)) return _match;
        const key = href.replace(/^\.\//, '');
        const content = fileMap.get(key) ?? fileMap.get(href);
        if (content == null) return _match;
        return `<style>${content}<\/style>`;
      },
    );

    return html;
  }

  const baseHtml     = htmlFile ? inlineAssets(htmlFile.content) : '';
  const injectedHtml = baseHtml
    ? (baseHtml.replace(/(<head[^>]*>)/i, `$1\n${CONSOLE_INTERCEPTOR}`) || (CONSOLE_INTERCEPTOR + baseHtml))
    : '';

  const refresh   = () => setRefreshKey((k) => k + 1);
  const openInTab = () => {
    if (!htmlFile) return;
    if (serverPreviewUrl) {
      window.open(serverPreviewUrl, '_blank');
      return;
    }
    const blob = new Blob([baseHtml], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <span className="preview-label">Preview</span>
        {hasPreview && (
          <>
            <button className="icon-btn" onClick={refresh} title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button className="icon-btn" onClick={openInTab} title="Open in new tab">
              <ExternalLink size={14} />
            </button>
          </>
        )}
      </div>

      <div className="preview-wrap">
        {hasPreview ? (
          <>
            {(isGenerating || !loaded) && (
              <div className="preview-loading">
                <div className="spinner" />
                {isGenerating ? 'Building…' : 'Loading preview…'}
              </div>
            )}
            <iframe
              key={iframeKey}
              ref={iframeRef}
              {...(serverPreviewUrl
                ? { src: serverPreviewUrl }
                : { srcDoc: injectedHtml }
              )}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
              title="App Preview"
              className="preview-iframe"
              onLoad={() => setLoaded(true)}
            />
          </>
        ) : (
          <div className="preview-empty">
            <div className="preview-empty-icon">
              <MonitorSmartphone size={26} />
            </div>
            {isGenerating ? (
              <>
                <p className="preview-empty-text">Generating your project…</p>
                <div className="spinner" />
              </>
            ) : hasFiles ? (
              <>
                <p className="preview-empty-text">
                  No HTML file to preview.<br />
                  Switch to <strong>Code</strong> view to explore the files.
                </p>
                <button className="no-preview-btn" onClick={onShowCode}>
                  <Code2 size={13} />
                  View Code
                </button>
              </>
            ) : (
              <p className="preview-empty-text">
                Start a conversation to see your app here.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
