import { Clock, RotateCcw } from 'lucide-react';
import type { Snapshot } from '../types';

interface Props {
  snapshots: Snapshot[];
  onRestore: (id: string) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs <  60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins <  60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  <  24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SnapshotTimeline({ snapshots, onRestore }: Props) {
  if (snapshots.length === 0) {
    return (
      <div className="snapshot-empty">
        <Clock size={12} />
        No snapshots yet — saved automatically on successful runs
      </div>
    );
  }

  return (
    <div className="snapshot-timeline">
      {snapshots.map((s) => (
        <div key={s.id} className="snapshot-item">
          <div className="snapshot-meta">
            <span className="snapshot-label">{s.label}</span>
            <span className="snapshot-time">{relativeTime(s.createdAt)}</span>
          </div>
          <button
            className="snapshot-restore-btn"
            onClick={() => onRestore(s.id)}
            title={`Restore "${s.label}"`}
          >
            <RotateCcw size={11} />
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}
