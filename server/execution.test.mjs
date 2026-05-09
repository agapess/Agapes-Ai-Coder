import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionManager } from './execution.mjs';

test('ExecutionManager: run and capture output', async () => {
  const mgr = new ExecutionManager();
  const chunks = [];
  const code = await mgr.run({
    content: 'console.log("hello forge")',
    filePath: 'test.js',
    cwd: process.cwd(),
    onData: (data) => chunks.push(data),
  });
  const output = chunks.join('');
  assert.ok(output.includes('hello forge'), `Expected "hello forge" in: ${output}`);
  assert.equal(code, 0);
  mgr.destroy();
});

test('ExecutionManager: non-zero exit for bad code', async () => {
  const mgr = new ExecutionManager();
  const code = await mgr.run({
    content: 'process.exit(1)',
    filePath: 'fail.js',
    cwd: process.cwd(),
    onData: () => {},
  });
  assert.equal(code, 1);
  mgr.destroy();
});

test('ExecutionManager: kill terminates process', async () => {
  const mgr = new ExecutionManager();
  let exited = false;
  const p = mgr.run({
    content: 'setTimeout(() => {}, 60000)',
    filePath: 'long.js',
    cwd: process.cwd(),
    onData: () => {},
  }).then((code) => { exited = true; return code; });
  await new Promise(r => setTimeout(r, 200));
  mgr.kill();
  await p;
  assert.ok(exited);
  mgr.destroy();
});
