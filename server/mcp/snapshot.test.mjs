import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs/promises';
import path from 'path';
import os   from 'os';
import { createSnapshot, listSnapshots, restoreSnapshot } from './snapshot.mjs';

async function tmpProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-snap-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>Hello</h1>', 'utf-8');
  await fs.writeFile(path.join(dir, 'app.js'),     'console.log("hi")', 'utf-8');
  return dir;
}

test('createSnapshot copies files into .forge/snapshots/{id}/', async () => {
  const dir = await tmpProject();
  const { id } = await createSnapshot(dir, 'initial build');
  const html = await fs.readFile(path.join(dir, '.forge', 'snapshots', id, 'index.html'), 'utf-8');
  assert.equal(html, '<h1>Hello</h1>');
  await fs.rm(dir, { recursive: true });
});

test('createSnapshot writes snapshot.json with label and fileCount', async () => {
  const dir = await tmpProject();
  const { id } = await createSnapshot(dir, 'my label');
  const meta = JSON.parse(await fs.readFile(path.join(dir, '.forge', 'snapshots', id, 'snapshot.json'), 'utf-8'));
  assert.equal(meta.label, 'my label');
  assert.ok(meta.createdAt);
  assert.ok(meta.fileCount >= 2);
  await fs.rm(dir, { recursive: true });
});

test('listSnapshots returns most-recent-first sorted list', async () => {
  const dir = await tmpProject();
  await createSnapshot(dir, 'first');
  await new Promise((r) => setTimeout(r, 20));
  await createSnapshot(dir, 'second');
  const snaps = await listSnapshots(dir);
  assert.equal(snaps.length, 2);
  assert.equal(snaps[0].label, 'second');
  await fs.rm(dir, { recursive: true });
});

test('listSnapshots returns empty array when no snapshots', async () => {
  const dir = await tmpProject();
  const snaps = await listSnapshots(dir);
  assert.deepEqual(snaps, []);
  await fs.rm(dir, { recursive: true });
});

test('restoreSnapshot overwrites current files with snapshot files', async () => {
  const dir = await tmpProject();
  const { id } = await createSnapshot(dir, 'before change');
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>Changed</h1>', 'utf-8');
  await restoreSnapshot(dir, id);
  const html = await fs.readFile(path.join(dir, 'index.html'), 'utf-8');
  assert.equal(html, '<h1>Hello</h1>');
  await fs.rm(dir, { recursive: true });
});

test('restoreSnapshot rejects IDs with path traversal chars', async () => {
  const dir = await tmpProject();
  await assert.rejects(
    () => restoreSnapshot(dir, '../../../etc/passwd'),
    /invalid/i,
  );
  await fs.rm(dir, { recursive: true });
});
