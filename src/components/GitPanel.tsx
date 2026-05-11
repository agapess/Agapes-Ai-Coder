import { useState } from 'react';
import { GitBranch, ChevronRight, ChevronDown, Upload, Download, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { useGit } from '../hooks/useGit';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return 'now';
}

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return <div className="sb-git-diff-empty">No uncommitted changes</div>;
  return (
    <div className="sb-git-diff">
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            'sb-git-diff-line' +
            (line.startsWith('+') && !line.startsWith('+++') ? ' add' :
             line.startsWith('-') && !line.startsWith('---') ? ' del' :
             line.startsWith('@@') ? ' hunk' : '')
          }
        >
          {line || ' '}
        </div>
      ))}
    </div>
  );
}

export function GitPanel({ projectId }: { projectId: string | null }) {
  const git = useGit(projectId);
  const [expanded,       setExpanded]       = useState(false);
  const [commitMsg,      setCommitMsg]      = useState('');
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteUrl,      setRemoteUrl]      = useState('');
  const [remoteToken,    setRemoteToken]    = useState('');
  const [showDiff,       setShowDiff]       = useState(false);
  const [opError,        setOpError]        = useState<string | null>(null);

  const clearErr = () => setOpError(null);

  const handleExpand = () => {
    if (!expanded) git.refresh();
    setExpanded((v) => !v);
  };

  const handleInit = async () => {
    clearErr();
    const r = await git.init();
    if (!r.ok) setOpError(r.error ?? 'Init failed');
  };

  const handleCommit = async () => {
    clearErr();
    if (!commitMsg.trim()) return;
    const r = await git.commit(commitMsg.trim());
    if (r.ok) setCommitMsg('');
    else setOpError(r.error ?? 'Commit failed');
  };

  const handleSaveRemote = async () => {
    clearErr();
    const r = await git.setRemote(remoteUrl.trim(), remoteToken.trim());
    if (r.ok) { setShowRemoteForm(false); setRemoteToken(''); }
    else setOpError(r.error ?? 'Failed to set remote');
  };

  const handlePush = async () => {
    clearErr();
    const r = await git.push();
    if (!r.ok) setOpError(r.error ?? 'Push failed');
  };

  const handlePull = async () => {
    clearErr();
    const r = await git.pull();
    if (!r.ok) setOpError(r.error ?? 'Pull failed');
  };

  const handleDiffToggle = async () => {
    if (!showDiff) await git.fetchDiff();
    setShowDiff((v) => !v);
  };

  const { status, log, diff, isLoading } = git;

  return (
    <div className="sb-section sb-git-section">
      {/* Header */}
      <div className="sb-header sb-git-header" onClick={handleExpand} style={{ cursor: 'pointer' }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <GitBranch size={12} />
        <span className="sb-header-label">Git</span>
        {status?.initialized && (
          <span className="sb-git-badge">
            {status.dirty > 0 ? `● ${status.dirty}` : <Check size={10} />}
          </span>
        )}
        {expanded && (
          <button
            className="sb-icon-btn"
            onClick={(e) => { e.stopPropagation(); git.refresh(); }}
            title="Refresh git status"
            disabled={isLoading}
          >
            <RefreshCw size={11} className={isLoading ? 'sb-git-spin' : ''} />
          </button>
        )}
      </div>

      {expanded && !!projectId && (
        <div className="sb-git-body">
          {/* Error */}
          {opError && (
            <div className="sb-git-error">
              <AlertCircle size={11} />
              <span>{opError}</span>
              <button className="sb-git-error-close" onClick={clearErr}>×</button>
            </div>
          )}

          {/* Not initialized */}
          {!status?.initialized && !isLoading && (
            <div className="sb-git-uninit">
              <p className="sb-git-hint">No git repository. Initialize to start tracking changes.</p>
              <button className="sb-git-btn sb-git-btn--primary" onClick={handleInit}>
                Initialize repository
              </button>
            </div>
          )}

          {/* Initialized */}
          {status?.initialized && (
            <>
              {/* Branch + status */}
              <div className="sb-git-status-row">
                <GitBranch size={11} />
                <span className="sb-git-branch">{status.branch}</span>
                {status.dirty > 0
                  ? <span className="sb-git-dirty">{status.dirty} change{status.dirty !== 1 ? 's' : ''}</span>
                  : <span className="sb-git-clean">up to date</span>
                }
              </div>

              {/* Commit area */}
              <div className="sb-git-commit">
                <textarea
                  className="sb-git-textarea"
                  placeholder="Commit message…"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  rows={2}
                  disabled={isLoading}
                />
                <button
                  className="sb-git-btn sb-git-btn--primary"
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || isLoading}
                >
                  Commit
                </button>
              </div>

              {/* Remote area */}
              <div className="sb-git-remote-area">
                {status.remote ? (
                  <>
                    <div className="sb-git-remote-row">
                      <span className="sb-git-remote-url" title={status.remote}>{status.remote}</span>
                      <button
                        className="sb-git-link"
                        onClick={() => { setRemoteUrl(''); setRemoteToken(''); setShowRemoteForm((v) => !v); }}
                      >
                        Edit
                      </button>
                    </div>
                    <div className="sb-git-push-pull">
                      <button className="sb-git-btn" onClick={handlePush} disabled={isLoading}>
                        <Upload size={11} /> Push
                      </button>
                      <button className="sb-git-btn" onClick={handlePull} disabled={isLoading}>
                        <Download size={11} /> Pull
                      </button>
                    </div>
                  </>
                ) : (
                  !showRemoteForm && (
                    <button className="sb-git-link" onClick={() => setShowRemoteForm(true)}>
                      + Set remote URL &amp; token
                    </button>
                  )
                )}

                {showRemoteForm && (
                  <div className="sb-git-form">
                    <input
                      className="sb-git-input"
                      type="url"
                      placeholder="https://github.com/user/repo.git"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                    />
                    <input
                      className="sb-git-input"
                      type="password"
                      placeholder="Personal access token"
                      value={remoteToken}
                      onChange={(e) => setRemoteToken(e.target.value)}
                    />
                    <div className="sb-git-form-actions">
                      <button
                        className="sb-git-btn sb-git-btn--primary"
                        onClick={handleSaveRemote}
                        disabled={!remoteUrl.trim() || isLoading}
                      >
                        Save
                      </button>
                      <button className="sb-git-btn" onClick={() => setShowRemoteForm(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Commit log */}
              {log.length > 0 && (
                <div className="sb-git-log">
                  <div className="sb-git-log-hd">
                    Recent commits
                    <button className="sb-git-link" onClick={handleDiffToggle}>
                      {showDiff ? 'Hide diff' : 'View diff'}
                    </button>
                  </div>
                  {log.map((c) => (
                    <div key={c.hash} className="sb-git-log-item">
                      <span className="sb-git-hash">{c.shortHash}</span>
                      <span className="sb-git-msg">{c.message}</span>
                      <span className="sb-git-date">{timeAgo(c.date)}</span>
                    </div>
                  ))}
                  {showDiff && <DiffViewer diff={diff} />}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
