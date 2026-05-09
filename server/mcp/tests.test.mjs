import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTestFramework, parseTestOutput, buildTestGenPrompt } from './tests.mjs';

test('detectTestFramework returns jest for package.json with jest dep', () => {
  const files = [
    { path: 'package.json', content: JSON.stringify({ devDependencies: { jest: '^29' } }) },
    { path: 'index.js', content: 'function add(a,b){return a+b;}' },
  ];
  assert.equal(detectTestFramework(files), 'jest');
});

test('detectTestFramework returns pytest for python files', () => {
  const files = [
    { path: 'main.py', content: 'def add(a,b): return a+b' },
  ];
  assert.equal(detectTestFramework(files), 'pytest');
});

test('detectTestFramework returns vitest for vite projects', () => {
  const files = [
    { path: 'vite.config.ts', content: 'export default {}' },
    { path: 'src/App.tsx', content: 'export function App() {}' },
  ];
  assert.equal(detectTestFramework(files), 'vitest');
});

test('detectTestFramework returns null for unrecognised stack', () => {
  const files = [
    { path: 'README.md', content: '# hello' },
  ];
  assert.equal(detectTestFramework(files), null);
});

test('parseTestOutput extracts passed and failed counts from jest output', () => {
  const raw = `
Tests: 2 failed, 5 passed, 7 total
`;
  const result = parseTestOutput(raw, 'jest');
  assert.equal(result.passed, 5);
  assert.equal(result.failed, 2);
  assert.equal(result.total, 7);
});

test('parseTestOutput extracts counts from pytest output', () => {
  const raw = '3 passed, 1 failed in 0.42s';
  const result = parseTestOutput(raw, 'pytest');
  assert.equal(result.passed, 3);
  assert.equal(result.failed, 1);
});

test('parseTestOutput returns zeros when no match', () => {
  const result = parseTestOutput('', 'jest');
  assert.equal(result.passed, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.total, 0);
});

test('buildTestGenPrompt returns a non-empty string containing the framework', () => {
  const files = [{ path: 'add.js', content: 'function add(a,b){return a+b;} module.exports={add};' }];
  const prompt = buildTestGenPrompt(files, 'jest');
  assert.ok(typeof prompt === 'string' && prompt.length > 0);
  assert.ok(prompt.toLowerCase().includes('jest'));
});

test('buildTestGenPrompt handles playwright framework with HTML file', () => {
  const files = [{ path: 'index.html', content: '<h1>Hello</h1>' }];
  const prompt = buildTestGenPrompt(files, 'playwright');
  assert.ok(prompt.toLowerCase().includes('playwright'));
  assert.ok(prompt.includes('file://'));
  assert.ok(prompt.includes('index.html'));
});
