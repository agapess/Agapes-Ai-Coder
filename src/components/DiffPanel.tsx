import type { PendingDiff } from '../types';

const CONTEXT = 3;

interface Props {
  diff:          PendingDiff;
  onAcceptHunk:  (i: number) => void;
  onRejectHunk:  (i: number) => void;
  onAcceptAll:   () => void;
  onRejectAll:   () => void;
}

export function DiffPanel({ diff, onAcceptHunk, onRejectHunk, onAcceptAll, onRejectAll }: Props) {
  const origLines = diff.originalContent.split('\n');
  const filename  = diff.path.split('/').pop() ?? diff.path;
  const pending   = diff.resolvedHunks.filter(r => r === 'pending').length;

  type CtxSeg  = { kind: 'context'; lines: string[] };
  type HunkSeg = { kind: 'hunk';    idx: number };
  type Seg     = CtxSeg | HunkSeg;

  const segments: Seg[] = [];
  let prevEnd = 0;

  for (let i = 0; i < diff.hunks.length; i++) {
    const hunk     = diff.hunks[i];
    const ctxStart = Math.max(prevEnd, hunk.beforeStart - CONTEXT);
    if (ctxStart < hunk.beforeStart) {
      segments.push({ kind: 'context', lines: origLines.slice(ctxStart, hunk.beforeStart) });
    }
    segments.push({ kind: 'hunk', idx: i });
    prevEnd = hunk.beforeStart + hunk.beforeCount;
  }
  const lastCtxEnd = Math.min(origLines.length, prevEnd + CONTEXT);
  if (prevEnd < lastCtxEnd) {
    segments.push({ kind: 'context', lines: origLines.slice(prevEnd, lastCtxEnd) });
  }

  return (
    <div className="diff-panel">
      {/* Toolbar */}
      <div className="diff-toolbar">
        <span className="diff-filename">{filename}</span>
        <span className="diff-count">{diff.hunks.length} change{diff.hunks.length !== 1 ? 's' : ''}</span>
        <div className="diff-toolbar-actions">
          <button className="diff-btn diff-btn--accept" onClick={onAcceptAll} disabled={pending === 0}>
            Accept all
          </button>
          <button className="diff-btn diff-btn--reject" onClick={onRejectAll} disabled={pending === 0}>
            Reject all
          </button>
        </div>
      </div>

      {/* Split body */}
      <div className="diff-body">
        {/* Before column */}
        <div className="diff-col diff-col--before">
          {segments.map((seg, si) => {
            if (seg.kind === 'context') {
              return seg.lines.map((l, li) => (
                <div key={`${si}-${li}`} className="diff-line diff-line--context">{l || ' '}</div>
              ));
            }
            const hunk     = diff.hunks[seg.idx];
            const resolved = diff.resolvedHunks[seg.idx];
            const extra    = Math.max(0, hunk.afterLines.length - hunk.beforeLines.length);
            return (
              <div key={si} className={`diff-hunk-block${resolved !== 'pending' ? ' diff-hunk-block--resolved' : ''}`}>
                {hunk.beforeLines.map((l, li) => (
                  <div key={li} className="diff-line diff-line--remove">
                    <span className="diff-gutter">−</span>{l || ' '}
                  </div>
                ))}
                {Array.from({ length: extra }).map((_, li) => (
                  <div key={`p${li}`} className="diff-line diff-line--pad">&nbsp;</div>
                ))}
              </div>
            );
          })}
        </div>

        {/* After column */}
        <div className="diff-col diff-col--after">
          {segments.map((seg, si) => {
            if (seg.kind === 'context') {
              return seg.lines.map((l, li) => (
                <div key={`${si}-${li}`} className="diff-line diff-line--context">{l || ' '}</div>
              ));
            }
            const hunk     = diff.hunks[seg.idx];
            const resolved = diff.resolvedHunks[seg.idx];
            const extra    = Math.max(0, hunk.beforeLines.length - hunk.afterLines.length);
            return (
              <div key={si} className={`diff-hunk-block${resolved !== 'pending' ? ' diff-hunk-block--resolved' : ''}`}>
                {hunk.afterLines.map((l, li) => (
                  <div key={li} className="diff-line diff-line--add">
                    <span className="diff-gutter">+</span>{l || ' '}
                  </div>
                ))}
                {Array.from({ length: extra }).map((_, li) => (
                  <div key={`p${li}`} className="diff-line diff-line--pad">&nbsp;</div>
                ))}
                {resolved === 'pending' && (
                  <div className="diff-hunk-actions">
                    <button className="diff-hunk-btn diff-hunk-btn--accept" onClick={() => onAcceptHunk(seg.idx)}>✓ Accept</button>
                    <button className="diff-hunk-btn diff-hunk-btn--reject" onClick={() => onRejectHunk(seg.idx)}>✕ Reject</button>
                  </div>
                )}
                {resolved === 'accepted' && <div className="diff-resolved diff-resolved--accepted">✓ accepted</div>}
                {resolved === 'rejected'  && <div className="diff-resolved diff-resolved--rejected">✕ rejected</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
