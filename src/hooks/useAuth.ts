import { useState, useCallback, useEffect } from 'react';

export interface AuthUser {
  id:       string;
  username: string;
  isAdmin:  boolean;
}

export interface ProviderConfig {
  key:     string;
  baseUrl: string;
  model:   string;
}

interface AuthState {
  user:             AuthUser | null;
  isLoading:        boolean;
  providerSettings: Record<string, ProviderConfig>;
}

const SESSION_KEY = 'agapes_auth_user';

function saveSession(user: AuthUser | null) {
  if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else      sessionStorage.removeItem(SESSION_KEY);
}

function loadSession(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user:             loadSession(),
    isLoading:        true,
    providerSettings: {},
  });

  // Restore session from server on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          saveSession(data.user);
          setState({ user: data.user, isLoading: false, providerSettings: data.providerSettings ?? {} });
        } else {
          saveSession(null);
          setState({ user: null, isLoading: false, providerSettings: {} });
        }
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    let res: Response;
    try {
      res = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('Cannot reach server — make sure it is running on port 3001');
    }
    let data: { user?: AuthUser; providerSettings?: Record<string, ProviderConfig>; error?: string };
    try { data = await res.json(); } catch {
      throw new Error('Server returned an unexpected response. Try restarting the server.');
    }
    if (!res.ok) throw new Error(data.error ?? 'Login failed');
    saveSession(data.user);
    const providerSettings: Record<string, ProviderConfig> = data.providerSettings ?? {};
    setState({ user: data.user, isLoading: false, providerSettings });
    return providerSettings;
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    let res: Response;
    try {
      res = await fetch('/api/auth/register', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('Cannot reach server — make sure it is running on port 3001');
    }
    let data: { user?: AuthUser; providerSettings?: Record<string, ProviderConfig>; error?: string };
    try { data = await res.json(); } catch {
      throw new Error('Server returned an unexpected response. Try restarting the server.');
    }
    if (!res.ok) throw new Error(data.error ?? 'Registration failed');
    saveSession(data.user);
    const providerSettings: Record<string, ProviderConfig> = data.providerSettings ?? {};
    setState({ user: data.user, isLoading: false, providerSettings });
    return providerSettings;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    saveSession(null);
    setState({ user: null, isLoading: false, providerSettings: {} });
  }, []);

  const saveProviderConfig = useCallback(async (
    provider: string,
    key:      string,
    baseUrl:  string,
    model:    string,
  ) => {
    await fetch('/api/auth/apikeys', {
      method:      'PUT',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ provider, key, baseUrl, model }),
    });
  }, []);

  return {
    user:             state.user,
    isLoading:        state.isLoading,
    providerSettings: state.providerSettings,
    login,
    register,
    logout,
    saveProviderConfig,
  };
}
