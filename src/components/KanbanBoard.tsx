import { useState, useEffect, useCallback } from 'react';
import { Plus, Inbox, Loader2, CheckCircle2, Trash2, X, Pencil, ChevronDown } from 'lucide-react';

type FeatureStatus = 'backlog' | 'in_progress' | 'completed';
type FeatureCategory = 'functional' | 'style';

interface Feature {
  id: number;
  project_id: string;
  title: string;
  description: string | null;
  status: FeatureStatus;
  category: FeatureCategory;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface Props {
  projectId: string;
}

const STATUS_LABELS: Record<FeatureStatus, string> = {
  backlog:     'Backlog',
  in_progress: 'In Progress',
  completed:   'Completed',
};

const STATUS_NEXT: Record<FeatureStatus, FeatureStatus> = {
  backlog:     'in_progress',
  in_progress: 'completed',
  completed:   'backlog',
};

const COLUMN_ORDER: FeatureStatus[] = ['backlog', 'in_progress', 'completed'];

function AddFeatureForm({ projectId, onAdded }: { projectId: string; onAdded: (f: Feature) => void }) {
  const [title, setTitle]       = useState('');
  const [category, setCategory] = useState<FeatureCategory>('functional');
  const [desc, setDesc]         = useState('');
  const [open, setOpen]         = useState(false);
  const [saving, setSaving]     = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/features`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: title.trim(), description: desc.trim() || null, category }),
      });
      const data = await res.json();
      if (data.feature) { onAdded(data.feature); setTitle(''); setDesc(''); setOpen(false); }
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
      <button className="kanban-add-btn" onClick={() => setOpen(true)}>
        <Plus size={12} /> Add feature
      </button>
    );
  }

  return (
    <form className="kanban-add-form" onSubmit={submit}>
      <input
        className="kanban-add-input"
        placeholder="Feature title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className="kanban-add-desc"
        placeholder="Description (optional)"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={2}
      />
      <div className="kanban-add-row">
        <select className="kanban-cat-select" value={category} onChange={(e) => setCategory(e.target.value as FeatureCategory)}>
          <option value="functional">Functional</option>
          <option value="style">Style</option>
        </select>
        <button type="submit" className="kanban-save-btn" disabled={saving || !title.trim()}>
          {saving ? '…' : 'Add'}
        </button>
        <button type="button" className="kanban-cancel-btn" onClick={() => { setOpen(false); setTitle(''); setDesc(''); }}>
          <X size={12} />
        </button>
      </div>
    </form>
  );
}

function FeatureCard({
  feature,
  onStatusChange,
  onDelete,
  onEdit,
}: {
  feature: Feature;
  onStatusChange: (id: number, status: FeatureStatus) => void;
  onDelete: (id: number) => void;
  onEdit: (feature: Feature) => void;
}) {
  const nextStatus = STATUS_NEXT[feature.status];

  return (
    <article className={`kanban-card kanban-card--${feature.status}`}>
      <div className="kanban-card-header">
        <span className={`kanban-cat-badge kanban-cat-badge--${feature.category}`}>
          {feature.category}
        </span>
        <div className="kanban-card-actions">
          <button className="kanban-card-btn" title="Edit" onClick={() => onEdit(feature)}>
            <Pencil size={11} />
          </button>
          <button className="kanban-card-btn kanban-card-btn--danger" title="Delete" onClick={() => onDelete(feature.id)}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      <p className="kanban-card-title">{feature.title}</p>

      {feature.description && (
        <p className="kanban-card-desc">{feature.description}</p>
      )}

      <button
        className="kanban-status-btn"
        onClick={() => onStatusChange(feature.id, nextStatus)}
        title={`Move to ${STATUS_LABELS[nextStatus]}`}
      >
        <ChevronDown size={10} />
        {STATUS_LABELS[nextStatus]}
      </button>
    </article>
  );
}

function EditModal({ feature, onSave, onClose }: { feature: Feature; onSave: (f: Feature) => void; onClose: () => void }) {
  const [title, setTitle]   = useState(feature.title);
  const [desc, setDesc]     = useState(feature.description ?? '');
  const [cat, setCat]       = useState(feature.category);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/features/${feature.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: title.trim(), description: desc.trim() || null, category: cat }),
      });
      const data = await res.json();
      if (data.feature) onSave(data.feature);
    } finally { setSaving(false); }
  };

  return (
    <div className="kanban-modal-backdrop" onClick={onClose}>
      <div className="kanban-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kanban-modal-header">
          <span>Edit Feature</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <input
          className="kanban-add-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          autoFocus
        />
        <textarea
          className="kanban-add-desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Description"
          rows={3}
        />
        <div className="kanban-add-row">
          <select className="kanban-cat-select" value={cat} onChange={(e) => setCat(e.target.value as FeatureCategory)}>
            <option value="functional">Functional</option>
            <option value="style">Style</option>
          </select>
          <button className="kanban-save-btn" onClick={save} disabled={saving || !title.trim()}>
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function KanbanBoard({ projectId }: Props) {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editTarget, setEditTarget] = useState<Feature | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/features`, { credentials: 'include' });
      const data = await res.json();
      setFeatures(data.features ?? []);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const handleAdded = (f: Feature) => setFeatures((prev) => [...prev, f]);

  const handleStatusChange = async (id: number, status: FeatureStatus) => {
    setFeatures((prev) => prev.map((f) => f.id === id ? { ...f, status } : f));
    await fetch(`/api/features/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status }),
    });
  };

  const handleDelete = async (id: number) => {
    setFeatures((prev) => prev.filter((f) => f.id !== id));
    await fetch(`/api/features/${id}`, { method: 'DELETE', credentials: 'include' });
  };

  const handleEdit = (updated: Feature) => {
    setFeatures((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setEditTarget(null);
  };

  const COLUMN_ICONS: Record<FeatureStatus, React.ReactNode> = {
    backlog:     <Inbox size={13} />,
    in_progress: <Loader2 size={13} />,
    completed:   <CheckCircle2 size={13} />,
  };

  if (loading) {
    return <div className="kanban-loading">Loading features…</div>;
  }

  return (
    <div className="kanban-board">
      {COLUMN_ORDER.map((status) => {
        const cards = features.filter((f) => f.status === status);
        return (
          <section key={status} className={`kanban-col kanban-col--${status}`}>
            <header className="kanban-col-header">
              <span className="kanban-col-icon">{COLUMN_ICONS[status]}</span>
              <span className="kanban-col-title">{STATUS_LABELS[status]}</span>
              <span className="kanban-col-count">{cards.length}</span>
            </header>

            <div className="kanban-col-body">
              {cards.length === 0 && (
                <p className="kanban-empty">No features here</p>
              )}
              {cards.map((f) => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onEdit={setEditTarget}
                />
              ))}
            </div>

            {status === 'backlog' && (
              <div className="kanban-col-footer">
                <AddFeatureForm projectId={projectId} onAdded={handleAdded} />
              </div>
            )}
          </section>
        );
      })}

      {editTarget && (
        <EditModal feature={editTarget} onSave={handleEdit} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}
