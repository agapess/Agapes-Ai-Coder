import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRuntime, RUNNABLE_EXTENSIONS, WEB_EXTENSIONS, detectEntryPoint } from './lang.mjs';

test('detects python', () => {
  const r = detectRuntime('/tmp/script.py');
  assert.equal(r.cmd, 'python');
  assert.deepEqual(r.args, []);
});

test('detects node for .js', () => {
  const r = detectRuntime('app.js');
  assert.equal(r.cmd, 'node');
});

test('detects node for .mjs', () => {
  const r = detectRuntime('server.mjs');
  assert.equal(r.cmd, 'node');
});

test('detects ts-node for .ts', () => {
  const r = detectRuntime('index.ts');
  assert.equal(r.cmd, 'npx');
  assert.deepEqual(r.args, ['ts-node']);
});

test('detects bash for .sh', () => {
  const r = detectRuntime('setup.sh');
  assert.equal(r.cmd, 'bash');
});

test('detects go run for .go', () => {
  const r = detectRuntime('main.go');
  assert.equal(r.cmd, 'go');
  assert.deepEqual(r.args, ['run']);
});

test('returns null for .css', () => {
  assert.equal(detectRuntime('style.css'), null);
});

test('returns null for .json', () => {
  assert.equal(detectRuntime('data.json'), null);
});

test('.html is in WEB_EXTENSIONS', () => {
  assert.ok(WEB_EXTENSIONS.has('.html'));
});

test('.htm is in WEB_EXTENSIONS', () => {
  assert.ok(WEB_EXTENSIONS.has('.htm'));
});

test('.py is in RUNNABLE_EXTENSIONS', () => {
  assert.ok(RUNNABLE_EXTENSIONS.has('.py'));
});

test('detects entry point: main.py preferred', () => {
  const files = ['helper.py', 'main.py', 'utils.py'];
  assert.equal(detectEntryPoint(files), 'main.py');
});

test('detects entry point: index.js preferred', () => {
  const files = ['utils.js', 'index.js'];
  assert.equal(detectEntryPoint(files), 'index.js');
});

test('detects entry point: falls back to last file', () => {
  const files = ['helper.py', 'utils.py'];
  assert.equal(detectEntryPoint(files), 'utils.py');
});
