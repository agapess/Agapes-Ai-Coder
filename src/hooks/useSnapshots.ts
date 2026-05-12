import { useState, useCallback } from 'react';
import type { Snapshot } from '../types';

export function useSnapshots(projectId: string | null) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading]     = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots`, { credentials: 'include' });
      if (res.ok) {
        const { snapshots: list } = await res.json();
        setSnapshots(list ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const createSnapshot = useCallback(async (label: string) => {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/snapshots`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ label }),
    });
    await refresh();
  }, [projectId, refresh]);

  const restoreSnapshot = useCallback(async (id: string) => {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/snapshots/${id}/restore`, { method: 'POST', credentials: 'include' });
    await refresh();
  }, [projectId, refresh]);

  return { snapshots, loading, refresh, createSnapshot, restoreSnapshot };
}
