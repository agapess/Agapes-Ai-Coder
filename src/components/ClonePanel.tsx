import { useState, type FormEvent } from 'react';
import { Link, Loader } from 'lucide-react';

interface Props {
  onClone:   (url: string) => void;
  isCloning: boolean;
  error:     string | null;
}

function isValidUrl(s: string) {
  try { new URL(s); return true; } catch { return false; }
}

export function ClonePanel({ onClone, isCloning, error }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !isValidUrl(trimmed) || isCloning) return;
    onClone(trimmed);
  };

  const canSubmit = url.trim() && isValidUrl(url.trim()) && !isCloning;

  return (
    <div className="clone-panel">
      <div className="clone-title">Clone a URL</div>
      <p className="clone-sub">
        Paste any URL — FORGE fetches it and rebuilds it as a clean, editable project.
      </p>
      <form className="clone-form" onSubmit={handleSubmit}>
        <input
          className="clone-input"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isCloning}
          spellCheck={false}
        />
        <button
          className="clone-btn"
          type="submit"
          disabled={!canSubmit}
        >
          {isCloning
            ? <><Loader size={13} className="clone-btn__spin" /> Cloning…</>
            : <><Link size={13} /> Clone</>
          }
        </button>
      </form>
      {error && <div className="clone-error">{error}</div>}
    </div>
  );
}
