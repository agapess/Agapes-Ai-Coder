import { useState, useRef } from 'react';
import JSZip from 'jszip';
import {
  Plus, Trash2, Clock, FolderInput, Download, Upload,
  FolderOpen, Folder, FileCode, FileText, File,
} from 'lucide-react';
import type { ProjectSummary, GeneratedFile } from '../types';
import { detectLang } from '../hooks/useProject';
import { GitPanel }   from './GitPanel';

// ── File tree helpers ─────────────────────────────────────────
interface TreeNode {
  name:     string;
  fullPath: string;
  isDir:    boolean;
  children: TreeNode[];
  file?:    GeneratedFile;
}

function buildTree(files: GeneratedFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/');
    let level   = root;

    parts.forEach((name, i) => {
      const isLast = i === parts.length - 1;
      const fp     = parts.slice(0, i + 1).join('/');

      if (isLast) {
        level.push({ name, fullPath: file.path, isDir: false, children: [], file });
      } else {
        let dir = level.find((n) => n.name === name && n.isDir);
        if (!dir) {
          dir = { name, fullPath: fp, isDir: true, children: [] };
          level.push(dir);
        }
        level = dir.children;
      }
    });
  }

  // Sort: dirs first, then files, both alphabetical
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sort(n.children) }));

  return sort(root);
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['html', 'htm'].includes(ext))               return <FileCode size={12} style={{ color: '#FF7C45' }} />;
  if (['ts', 'tsx'].includes(ext))                 return <FileCode size={12} style={{ color: '#3178C6' }} />;
  if (['js', 'jsx'].includes(ext))                 return <FileCode size={12} style={{ color: '#F7DF1E' }} />;
  if (['py'].includes(ext))                        return <FileCode size={12} style={{ color: '#3572A5' }} />;
  if (['css', 'scss', 'less'].includes(ext))       return <FileCode size={12} style={{ color: '#563D7C' }} />;
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return <FileText size={12} style={{ color: '#6A8759' }} />;
  if (['md', 'txt'].includes(ext))                 return <FileText size={12} style={{ color: 'var(--t3)' }} />;
  if (['sql'].includes(ext))                       return <FileCode size={12} style={{ color: '#00C4AA' }} />;
  return <File size={12} style={{ color: 'var(--t3)' }} />;
}

function TreeItem({
  node,
  depth,
  activeFilePath,
  onSelectFile,
}: {
  node:           TreeNode;
  depth:          number;
  activeFilePath: string;
  onSelectFile:   (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isActive = !node.isDir && node.fullPath === activeFilePath;

  if (node.isDir) {
    return (
      <>
        <div
          className="sb-tree-dir"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <FolderOpen size={12} /> : <Folder size={12} />}
          <span>{node.name}</span>
        </div>
        {open && node.children.map((c) => (
          <TreeItem key={c.fullPath} node={c} depth={depth + 1}
            activeFilePath={activeFilePath} onSelectFile={onSelectFile} />
        ))}
      </>
    );
  }

  return (
    <div
      className={`sb-tree-file${isActive ? ' active' : ''}`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onSelectFile(node.fullPath)}
      title={node.fullPath}
    >
      {fileIcon(node.name)}
      <span>{node.name}</span>
    </div>
  );
}

// ── Time helper ───────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// ── Main component ────────────────────────────────────────────
interface Props {
  projects:        ProjectSummary[];
  activeProjectId: string;
  files:           GeneratedFile[];
  activeFilePath:  string;
  projectName:     string;
  isAdmin?:        boolean;
  onNewProject:    () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectFile:    (path: string) => void;
  onImport:        (files: GeneratedFile[], name: string) => void;
}

async function openFolder(projectId: string) {
  await fetch(`/api/projects/${projectId}/open-folder`, { method: 'POST', credentials: 'include' });
}

async function downloadZip(files: GeneratedFile[], name: string) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.content);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${name.replace(/[^a-z0-9_\-. ]/gi, '_') || 'project'}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Sidebar({
  projects, activeProjectId, files, activeFilePath,
  projectName, isAdmin,
  onNewProject, onSelectProject, onDeleteProject, onSelectFile, onImport,
}: Props) {
  const [hoveredId,    setHoveredId]    = useState<string | null>(null);
  const [confirmDelete,setConfirmDelete] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList);
    let imported: GeneratedFile[];
    let name: string;
    if (arr.length === 1 && arr[0].name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(arr[0]);
      const extracted: GeneratedFile[] = [];
      for (const [zipPath, entry] of Object.entries(zip.files)) {
        if ((entry as JSZip.JSZipObject).dir || zipPath.includes('__MACOSX') || zipPath.includes('.DS_Store')) continue;
        const content = await (entry as JSZip.JSZipObject).async('string');
        extracted.push({ path: zipPath, lang: detectLang(zipPath), content });
      }
      imported = extracted;
      name = arr[0].name.replace(/\.zip$/, '');
    } else {
      imported = await Promise.all(arr.map((f) => new Promise<GeneratedFile>((res) => {
        const reader = new FileReader();
        reader.onload = (ev) => res({ path: f.name, lang: detectLang(f.name), content: ev.target!.result as string });
        reader.readAsText(f);
      })));
      name = 'Imported Project';
    }
    if (imported.length > 0) onImport(imported, name);
    e.target.value = '';
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      onDeleteProject(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete((c) => (c === id ? null : c)), 3000);
    }
  };

  const tree = buildTree(files);

  return (
    <aside className="sidebar">
      {/* ── Projects ── */}
      <div className="sb-section">
        <div className="sb-header">
          <span className="sb-header-label">Projects</span>
          <button className="sb-icon-btn" onClick={onNewProject} title="New project">
            <Plus size={13} />
          </button>
          <button className="sb-icon-btn" onClick={() => importInputRef.current?.click()} title="Import project (ZIP or files)">
            <Upload size={13} />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,*"
            multiple
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
        </div>

        <div className="sb-list">
          {projects.length === 0 && (
            <p className="sb-empty">No saved projects yet.<br />Start building to save.</p>
          )}
          {projects.map((p) => {
            const isActive  = p.id === activeProjectId;
            const isHovered = hoveredId === p.id;
            const isConfirm = confirmDelete === p.id;
            return (
              <div
                key={p.id}
                className={`sb-project${isActive ? ' active' : ''}`}
                onClick={() => !isActive && onSelectProject(p.id)}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => { setHoveredId(null); setConfirmDelete(null); }}
              >
                <FolderOpen size={12} className="sb-project-icon" />
                <div className="sb-project-info">
                  <span className="sb-project-name">{p.name}</span>
                  <span className="sb-project-time">
                    <Clock size={9} /> {timeAgo(p.updatedAt)}
                  </span>
                </div>
                {isHovered && (
                  <button
                    className={`sb-delete-btn${isConfirm ? ' confirm' : ''}`}
                    onClick={(e) => handleDelete(e, p.id)}
                    title={isConfirm ? 'Click again to confirm' : 'Delete'}
                  >
                    <Trash2 size={11} />
                    {isConfirm && <span>sure?</span>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── File tree ── */}
      {files.length > 0 && (
        <div className="sb-section sb-files-section">
          <div className="sb-header">
            <span className="sb-header-label">Files</span>
            <span className="sb-file-count">{files.length}</span>
            <button
              className="sb-icon-btn"
              onClick={() => downloadZip(files, projectName)}
              title="Download project as ZIP"
            >
              <Download size={13} />
            </button>
            {isAdmin && activeProjectId && (
              <button
                className="sb-icon-btn"
                onClick={() => openFolder(activeProjectId)}
                title="Open project folder on server"
              >
                <FolderInput size={13} />
              </button>
            )}
          </div>
          <div className="sb-tree">
            {tree.map((n) => (
              <TreeItem
                key={n.fullPath}
                node={n}
                depth={0}
                activeFilePath={activeFilePath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        </div>
      )}
      {/* ── Git ── */}
      <GitPanel projectId={activeProjectId} />
    </aside>
  );
}

