import { useState, useRef, useEffect } from 'react';
import { RefreshCw, ExternalLink, MonitorSmartphone, Code2 } from 'lucide-react';
import type { GeneratedFile } from '../types';

interface Props {
  files:        GeneratedFile[];
  isGenerating: boolean;
  onShowCode:   () => void;
}

export function PreviewPanel({ files, isGenerating, onShowCode }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [loaded, setLoaded]         = useState(false);
  const iframeRef                   = useRef<HTMLIFrameElement>(null);

  // Find the previewable HTML file
  const htmlFile = files.find((f) => f.path === 'index.html')
    ?? files.find((f) => f.path.endsWith('.html'));

  const hasPreview = !!htmlFile;
  const hasFiles   = files.length > 0;

  useEffect(() => { setLoaded(false); }, [htmlFile?.content, refreshKey]);

  const refresh    = () => setRefreshKey((k) => k + 1);
  const openInTab  = () => {
    if (!htmlFile) return;
    const blob = new Blob([htmlFile.content], { type: 'text/html' });
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
              key={refreshKey}
              ref={iframeRef}
              srcDoc={htmlFile!.content}
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
