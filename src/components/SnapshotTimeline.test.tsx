import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SnapshotTimeline } from './SnapshotTimeline';
import type { Snapshot } from '../types';

const SNAP: Snapshot = {
  id:        'abc-123',
  label:     'initial build',
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  fileCount: 2,
};

describe('SnapshotTimeline', () => {
  it('shows empty message when there are no snapshots', () => {
    render(<SnapshotTimeline snapshots={[]} onRestore={() => {}} />);
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
  });

  it('renders a snapshot label', () => {
    render(<SnapshotTimeline snapshots={[SNAP]} onRestore={() => {}} />);
    expect(screen.getByText('initial build')).toBeInTheDocument();
  });

  it('renders a relative timestamp', () => {
    render(<SnapshotTimeline snapshots={[SNAP]} onRestore={() => {}} />);
    expect(screen.getByText(/ago/i)).toBeInTheDocument();
  });

  it('calls onRestore with the snapshot id when restore is clicked', () => {
    const onRestore = vi.fn();
    render(<SnapshotTimeline snapshots={[SNAP]} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(onRestore).toHaveBeenCalledWith('abc-123');
  });

  it('renders a restore button for each snapshot', () => {
    const second: Snapshot = { ...SNAP, id: 'def-456', label: 'second snap' };
    render(<SnapshotTimeline snapshots={[SNAP, second]} onRestore={() => {}} />);
    expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(2);
  });
});
