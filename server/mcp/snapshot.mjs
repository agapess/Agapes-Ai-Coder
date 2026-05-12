import fs   from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const SNAPSHOTS_DIR = '.forge/snapshots';
const EXCLUDE       = new Set(['.forge', 'node_modules', '.git']);

async function copyRecursive(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (EXCLUDE.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function countFiles(dir) {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

export async function createSnapshot(projectDir, label) {
  const id      = randomUUID();
  const snapDir = path.join(projectDir, SNAPSHOTS_DIR, id);
  await copyRecursive(projectDir, snapDir);
  const fileCount = await countFiles(snapDir);
  const meta = { id, label, createdAt: new Date().toISOString(), fileCount };
  await fs.writeFile(path.join(snapDir, 'snapshot.json'), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

export async function listSnapshots(projectDir) {
  const base = path.join(projectDir, SNAPSHOTS_DIR);
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    const snaps = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          try {
            const raw = await fs.readFile(path.join(base, e.name, 'snapshot.json'), 'utf-8');
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }),
    );
    return snaps
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {
    return [];
  }
}

export async function restoreSnapshot(projectDir, id) {
  if (/[/\\.]/.test(id) || id.includes('..')) {
    throw new Error('invalid snapshot id');
  }
  const snapDir = path.join(projectDir, SNAPSHOTS_DIR, id);
  await copyRecursive(snapDir, projectDir);
}
