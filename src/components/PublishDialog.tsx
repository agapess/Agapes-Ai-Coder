import { useState, useEffect, useRef } from 'react';
import { Globe, Copy, X, Loader } from 'lucide-react';
import type { PublishState } from '../hooks/usePublish';

interface Props {
  projectId:   string;
  state:       PublishState;
  onPublish:   (slug?: string) => void;
  onUnpublish: () => void;
  onClose:     () => void;
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export function PublishDialog({ projectId: _projectId, state, onPublish, onUnpublish, onClose }: Props) {
  const [slug,       setSlug]       = useState('');
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [copied,     setCopied]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current)    abortRef.current.abort();

    const trimmed = slug.trim();
    if (!trimmed) { setSlugStatus('idle'); return; }
    if (!SLUG_RE.test(trimmed)) { setSlugStatus('invalid'); return; }

    setSlugStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res  = await fetch(`/api/check-slug/${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const data = await res.json();
        setSlugStatus(data.available ? 'available' : 'taken');
      } catch {
        setSlugStatus('idle');
      }
    }, 400);
  }, [slug]);

  const slugHint: { text: string; color: string } | null =
    slugStatus === 'checking'  ? { text: 'Checking…',                                          color: '#888' }      :
    slugStatus === 'available' ? { text: '✓ Available',                                         color: '#7fff7f' }   :
    slugStatus === 'taken'     ? { text: '✗ Already taken',                                     color: '#ff7f7f' }   :
    slugStatus === 'invalid'   ? { text: '✗ Lowercase letters, numbers, hyphens only (3–50 chars)', color: '#ff7f7f' } :
    null;

  const canPublish = !state.isLoading && slugStatus !== 'checking' && slugStatus !== 'taken' && slugStatus !== 'invalid';

  const handlePublish = () => onPublish(slug.trim() || undefined);

  const copyUrl = () => {
    if (!state.url) return;
    navigator.clipboard.writeText(state.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="publish-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="publish-dialog">
        <div className="publish-header">
          <div className="publish-title">
            <Globe size={15} />
            Publish App
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="publish-body">
          {!state.isPublished ? (<>
            <p className="publish-desc">
              Publish this project as a static web app accessible at a public URL.
            </p>

            <div className="settings-row" style={{ marginBottom: 8 }}>
              <label className="settings-label">Custom URL (optional)</label>
              <input
                className="settings-input"
                type="text"
                placeholder="my-tetris"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                spellCheck={false}
                disabled={state.isLoading}
              />
              {slugHint && (
                <span style={{ fontSize: 10, color: slugHint.color, marginTop: 4, display: 'block' }}>
                  {slugHint.text}
                </span>
              )}
            </div>

            <p className="publish-note">
              Static only — visitors see the generated files. No AI generation, no data storage.
            </p>

            {state.error && <p className="publish-error">{state.error}</p>}

            <div className="publish-actions">
              <button className="publish-btn" onClick={handlePublish} disabled={!canPublish}>
                {state.isLoading ? <Loader size={13} className="clone-btn__spin" /> : <Globe size={13} />}
                {state.isLoading ? 'Publishing…' : 'Publish'}
              </button>
              <button className="publish-cancel" onClick={onClose}>Cancel</button>
            </div>
          </>) : (<>
            <p className="publish-desc publish-desc--success">Your app is live!</p>

            <div className="publish-url-row">
              <input
                className="publish-url-input"
                readOnly
                value={state.url ?? ''}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button className="icon-btn" onClick={copyUrl} title="Copy URL">
                <Copy size={13} />
              </button>
            </div>

            {copied && (
              <span style={{ fontSize: 10, color: '#7fff7f', marginTop: 4, display: 'block' }}>
                Copied!
              </span>
            )}

            <p className="publish-note">
              Static only — visitors see the generated files. No AI generation, no data storage.
            </p>

            {state.error && <p className="publish-error">{state.error}</p>}

            <div className="publish-actions">
              <a className="publish-open" href={state.url ?? ''} target="_blank" rel="noreferrer">
                Open App ↗
              </a>
              <button
                className="publish-unpublish"
                onClick={onUnpublish}
                disabled={state.isLoading}
              >
                {state.isLoading ? 'Unpublishing…' : 'Unpublish'}
              </button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
