import { useEffect, useState } from 'react';
import {
  X, RefreshCw, ShieldCheck, ShieldOff, Trash2,
  Users, Globe, Server, ExternalLink, Key,
} from 'lucide-react';
import { useAdmin } from '../hooks/useAdmin';

interface Props {
  currentUserId: string;
  onClose: () => void;
}

type Tab = 'users' | 'published' | 'system';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ── Users tab ─────────────────────────────────────────────────
function UsersTab({
  users, currentUserId, onToggleAdmin, onDeleteUser,
}: {
  users: ReturnType<typeof useAdmin>['users'];
  currentUserId: string;
  onToggleAdmin: (id: string) => void;
  onDeleteUser:  (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (confirmDelete === id) {
      onDeleteUser(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  if (users.length === 0) {
    return <div className="admin-empty">No users found.</div>;
  }

  return (
    <div className="admin-table">
      <div className="admin-row admin-row--header">
        <span style={{ width: 36 }} />
        <span style={{ flex: 2 }}>Username</span>
        <span style={{ flex: 1 }}>Role</span>
        <span style={{ flex: 1.5 }}>Created</span>
        <span style={{ flex: 2 }}>API Keys</span>
        <span style={{ width: 80 }}>Actions</span>
      </div>
      {users.map((u) => {
        const isSelf    = u.id === currentUserId;
        const isAdmin   = !!u.is_admin;
        const providers = Object.keys(u.apiKeys ?? {}).filter((k) => u.apiKeys![k]);
        return (
          <div key={u.id} className={`admin-row${isSelf ? ' admin-row--self' : ''}`}>
            <div className="admin-avatar">{u.username[0].toUpperCase()}</div>
            <span style={{ flex: 2, fontWeight: 500, color: '#eee' }}>
              {u.username}
              {isSelf && <span className="admin-self-tag">you</span>}
            </span>
            <span style={{ flex: 1 }}>
              {isAdmin
                ? <span className="admin-badge admin-badge--admin">admin</span>
                : <span className="admin-badge admin-badge--user">user</span>}
            </span>
            <span style={{ flex: 1.5, color: '#666', fontSize: 11 }}>{formatDate(u.created_at)}</span>
            <div style={{ flex: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {providers.length > 0
                ? providers.map((p) => (
                    <span key={p} className="admin-badge admin-badge--provider">
                      <Key size={9} />
                      {p}
                    </span>
                  ))
                : <span style={{ color: '#444', fontSize: 11 }}>none</span>}
            </div>
            <div style={{ width: 80, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button
                className={`admin-action-btn${isAdmin ? ' admin-action-btn--active' : ''}`}
                onClick={() => !isSelf && onToggleAdmin(u.id)}
                disabled={isSelf}
                title={isAdmin ? 'Revoke admin' : 'Make admin'}
              >
                {isAdmin ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
              </button>
              <button
                className={`admin-action-btn admin-danger-btn${confirmDelete === u.id ? ' admin-danger-btn--confirm' : ''}`}
                onClick={() => !isSelf && handleDelete(u.id)}
                disabled={isSelf}
                title={confirmDelete === u.id ? 'Click again to confirm' : 'Delete user'}
              >
                {confirmDelete === u.id ? '?' : <Trash2 size={13} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Published Apps tab ────────────────────────────────────────
function PublishedTab({
  apps, onUnpublish,
}: {
  apps: ReturnType<typeof useAdmin>['publishedApps'];
  onUnpublish: (slug: string) => void;
}) {
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);

  const handleUnpublish = (slug: string) => {
    if (confirmSlug === slug) {
      onUnpublish(slug);
      setConfirmSlug(null);
    } else {
      setConfirmSlug(slug);
      setTimeout(() => setConfirmSlug(null), 3000);
    }
  };

  if (apps.length === 0) {
    return <div className="admin-empty">No published apps yet.</div>;
  }

  return (
    <div className="admin-table">
      <div className="admin-row admin-row--header">
        <span style={{ flex: 2 }}>URL / Slug</span>
        <span style={{ flex: 1 }}>Owner</span>
        <span style={{ flex: 2 }}>Project ID</span>
        <span style={{ flex: 1.5 }}>Published</span>
        <span style={{ width: 80 }}>Actions</span>
      </div>
      {apps.map((a) => (
        <div key={a.slug} className="admin-row">
          <div style={{ flex: 2 }}>
            <a
              href={`/app/${a.slug}`}
              target="_blank"
              rel="noreferrer"
              className="admin-link"
            >
              /app/{a.slug}
              <ExternalLink size={10} style={{ marginLeft: 4 }} />
            </a>
          </div>
          <span style={{ flex: 1, color: '#aaa', fontSize: 12 }}>
            {a.username ?? <span style={{ color: '#444' }}>deleted</span>}
          </span>
          <span style={{ flex: 2, color: '#555', fontSize: 11, fontFamily: 'monospace' }}>
            {a.project_id.slice(0, 16)}…
          </span>
          <span style={{ flex: 1.5, color: '#666', fontSize: 11 }}>
            {formatDate(a.published_at)}
          </span>
          <div style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className={`admin-action-btn admin-danger-btn${confirmSlug === a.slug ? ' admin-danger-btn--confirm' : ''}`}
              onClick={() => handleUnpublish(a.slug)}
              title={confirmSlug === a.slug ? 'Click again to confirm' : 'Unpublish'}
            >
              {confirmSlug === a.slug ? '?' : <Trash2 size={13} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── System tab ────────────────────────────────────────────────
function SystemTab({ stats }: { stats: ReturnType<typeof useAdmin>['stats'] }) {
  if (!stats) return <div className="admin-empty">Loading stats…</div>;

  const cards = [
    { label: 'Server Port',      value: stats.port,                        icon: <Server size={14} /> },
    { label: 'Node.js Version',  value: stats.nodeVersion,                 icon: <Server size={14} /> },
    { label: 'Platform',         value: stats.platform,                    icon: <Server size={14} /> },
    { label: 'Uptime',           value: formatUptime(stats.uptime),        icon: <Server size={14} /> },
    { label: 'Total Users',      value: stats.userCount,                   icon: <Users size={14} /> },
    { label: 'Total Projects',   value: stats.projectCount,                icon: <Server size={14} /> },
    { label: 'Published Apps',   value: stats.publishedCount,              icon: <Globe size={14} /> },
  ];

  return (
    <div className="admin-stat-grid">
      {cards.map((c) => (
        <div key={c.label} className="admin-stat-card">
          <div className="admin-stat-icon">{c.icon}</div>
          <div className="admin-stat-label">{c.label}</div>
          <div className="admin-stat-value">{String(c.value)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────
export function AdminPanel({ currentUserId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('users');
  const admin = useAdmin();

  useEffect(() => {
    admin.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'users',     label: 'Users',          icon: <Users size={12} /> },
    { id: 'published', label: 'Published Apps',  icon: <Globe size={12} /> },
    { id: 'system',    label: 'System',          icon: <Server size={12} /> },
  ];

  return (
    <div className="admin-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-panel">
        {/* Header */}
        <div className="admin-panel-header">
          <div className="admin-panel-title">
            <ShieldCheck size={15} style={{ color: '#FF5E1A' }} />
            Admin Panel
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {admin.isLoading && (
              <span style={{ fontSize: 11, color: '#555' }}>Loading…</span>
            )}
            <button
              className="admin-action-btn"
              onClick={admin.refresh}
              disabled={admin.isLoading}
              title="Refresh"
            >
              <RefreshCw size={13} className={admin.isLoading ? 'admin-spin' : ''} />
            </button>
            <button className="admin-action-btn" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="admin-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`admin-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
              {t.id === 'users'     && <span className="admin-tab-count">{admin.users.length}</span>}
              {t.id === 'published' && <span className="admin-tab-count">{admin.publishedApps.length}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="admin-content">
          {admin.error && (
            <div className="admin-error">{admin.error}</div>
          )}
          {tab === 'users' && (
            <UsersTab
              users={admin.users}
              currentUserId={currentUserId}
              onToggleAdmin={admin.toggleAdmin}
              onDeleteUser={admin.deleteUser}
            />
          )}
          {tab === 'published' && (
            <PublishedTab
              apps={admin.publishedApps}
              onUnpublish={admin.unpublishApp}
            />
          )}
          {tab === 'system' && (
            <SystemTab stats={admin.stats} />
          )}
        </div>
      </div>
    </div>
  );
}
