import { useState, type FormEvent } from 'react';
import { Zap } from 'lucide-react';

interface Props {
  onLogin:    (username: string, password: string) => Promise<{ apiKeys: Record<string, string> }>;
  onRegister: (username: string, password: string) => Promise<{ apiKeys: Record<string, string> }>;
}

export function AuthPage({ onLogin, onRegister }: Props) {
  const [tab,      setTab]      = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await onLogin(username, password);
      } else {
        await onRegister(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-mark">A</div>
          <span className="logo-text">Agapes Ai Coder</span>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'login' ? ' active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab${tab === 'register' ? ' active' : ''}`}
            onClick={() => { setTab('register'); setError(''); }}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === 'register' && (
            <p className="auth-hint">
              <Zap size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
              {' '}First user registered becomes admin.
            </p>
          )}

          <label className="auth-label">
            Username
            <input
              className="auth-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete={tab === 'login' ? 'username' : 'new-password'}
              spellCheck={false}
              required
              minLength={2}
              maxLength={32}
            />
          </label>

          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading || !username.trim() || !password}
          >
            {loading
              ? (tab === 'login' ? 'Signing in…' : 'Creating account…')
              : (tab === 'login' ? 'Sign In'     : 'Create Account')}
          </button>
        </form>
      </div>
    </div>
  );
}
