import { useState, useCallback } from 'react';

export interface AdminUser {
  id:         string;
  username:   string;
  is_admin:   number;
  created_at: string;
  apiKeys?:   Record<string, string>;
}

export interface AdminPublishedApp {
  slug:         string;
  project_id:   string;
  user_id:      string;
  published_at: string;
  username:     string | null;
}

export interface AdminStats {
  port:           number;
  nodeVersion:    string;
  platform:       string;
  uptime:         number;
  userCount:      number;
  projectCount:   number;
  publishedCount: number;
}

interface AdminState {
  users:         AdminUser[];
  publishedApps: AdminPublishedApp[];
  stats:         AdminStats | null;
  isLoading:     boolean;
  error:         string | null;
}

const INIT: AdminState = {
  users:         [],
  publishedApps: [],
  stats:         null,
  isLoading:     false,
  error:         null,
};

export function useAdmin() {
  const [state, setState] = useState<AdminState>(INIT);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [usersRes, appsRes, statsRes] = await Promise.all([
        fetch('/api/admin/users',         { credentials: 'include' }),
        fetch('/api/admin/published-apps', { credentials: 'include' }),
        fetch('/api/admin/stats',          { credentials: 'include' }),
      ]);
      const [{ users }, { apps }, stats] = await Promise.all([
        usersRes.json(),
        appsRes.json(),
        statsRes.json(),
      ]);

      // Fetch API key providers for each user in parallel
      const usersWithKeys = await Promise.all(
        users.map(async (u: AdminUser) => {
          try {
            const r = await fetch(`/api/admin/users/${u.id}/api-keys`, { credentials: 'include' });
            const { apiKeys } = await r.json();
            return { ...u, apiKeys };
          } catch {
            return u;
          }
        })
      );

      setState({ users: usersWithKeys, publishedApps: apps, stats, isLoading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  const toggleAdmin = useCallback(async (id: string) => {
    await fetch(`/api/admin/users/${id}`, { method: 'PATCH', credentials: 'include' });
    setState((s) => ({
      ...s,
      users: s.users.map((u) =>
        u.id === id ? { ...u, is_admin: u.is_admin ? 0 : 1 } : u
      ),
    }));
  }, []);

  const deleteUser = useCallback(async (id: string) => {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
    setState((s) => ({ ...s, users: s.users.filter((u) => u.id !== id) }));
  }, []);

  const unpublishApp = useCallback(async (slug: string) => {
    await fetch(`/api/admin/published-apps/${slug}`, { method: 'DELETE', credentials: 'include' });
    setState((s) => ({ ...s, publishedApps: s.publishedApps.filter((a) => a.slug !== slug) }));
  }, []);

  return { ...state, refresh, toggleAdmin, deleteUser, unpublishApp };
}
