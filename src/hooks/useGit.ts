import { useState, useCallback, useEffect } from 'react';

export interface GitCommit {
  hash:      string;
  shortHash: string;
  message:   string;
  date:      string;
}

export interface GitStatus {
  initialized: boolean;
  branch:      string;
  dirty:       number;
  ahead:       number;
  remote:      string | null;
  lastCommit:  GitCommit | null;
}

interface GitState {
  status:    GitStatus | null;
  log:       GitCommit[];
  diff:      string;
  isLoading: boolean;
  error:     string | null;
}

const INIT: GitState = { status: null, log: [], diff: '', isLoading: false, error: null };

export function useGit(projectId: string | null) {
  const [state, setState] = useState<GitState>(INIT);

  const refresh = useCallback(async () => {
    if (!projectId) { setState(INIT); return; }
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/git/status`, { credentials: 'include' }),
        fetch(`/api/projects/${projectId}/git/log`,    { credentials: 'include' }),
      ]);
      const status: GitStatus = await sRes.json();
      const log: GitCommit[]  = lRes.ok ? await lRes.json() : [];
      setState((s) => ({ ...s, status, log, isLoading: false }));
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const gitAction = useCallback(async (
    endpoint: string,
    opts: RequestInit = {},
  ): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> => {
    if (!projectId) return { ok: false, error: 'No project' };
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res  = await fetch(`/api/projects/${projectId}/git/${endpoint}`, { credentials: 'include', ...opts });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      await refresh();
      return { ok: true, ...data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, isLoading: false, error: msg }));
      return { ok: false, error: msg };
    }
  }, [projectId, refresh]);

  const init   = useCallback(() => gitAction('init', { method: 'POST' }), [gitAction]);

  const commit = useCallback((message: string) => gitAction('commit', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message }),
  }), [gitAction]);

  const setRemote = useCallback((url: string, token: string) => gitAction('remote', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url, token }),
  }), [gitAction]);

  const push = useCallback(() => gitAction('push', { method: 'POST' }), [gitAction]);
  const pull = useCallback(() => gitAction('pull', { method: 'POST' }), [gitAction]);

  const fetchDiff = useCallback(async () => {
    if (!projectId) return;
    try {
      const res  = await fetch(`/api/projects/${projectId}/git/diff`, { credentials: 'include' });
      const data = await res.json() as { diff?: string };
      setState((s) => ({ ...s, diff: data.diff ?? '' }));
    } catch { /* silent */ }
  }, [projectId]);

  return { ...state, refresh, init, commit, setRemote, push, pull, fetchDiff };
}
