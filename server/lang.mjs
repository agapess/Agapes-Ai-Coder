import path from 'path';

const RUNTIME_MAP = {
  '.py':   { cmd: 'python',  args: [] },
  '.js':   { cmd: 'node',    args: [] },
  '.mjs':  { cmd: 'node',    args: [] },
  '.ts':   { cmd: 'npx',     args: ['ts-node'] },
  '.sh':   { cmd: 'bash',    args: [] },
  '.bash': { cmd: 'bash',    args: [] },
  '.sql':  { cmd: 'sqlite3', args: [':memory:'] },
  '.rb':   { cmd: 'ruby',    args: [] },
  '.go':   { cmd: 'go',      args: ['run'] },
  '.rs':   { cmd: 'cargo',   args: ['run'] },
  '.php':  { cmd: 'php',     args: [] },
};

export const WEB_EXTENSIONS = new Set(['.html', '.htm']);

export const RUNNABLE_EXTENSIONS = new Set([
  ...Object.keys(RUNTIME_MAP),
  ...WEB_EXTENSIONS,
]);

export function detectRuntime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return RUNTIME_MAP[ext] ?? null;
}

const ENTRY_POINT_PRIORITY = [
  'main.py', 'app.py', 'index.py',
  'index.js', 'server.js', 'app.js', 'main.js',
  'main.ts', 'index.ts', 'server.ts', 'app.ts',
  'main.go', 'main.rs', 'main.rb',
];

export function detectEntryPoint(filePaths) {
  if (filePaths.length === 0) return null;
  if (filePaths.length === 1) return filePaths[0];
  for (const name of ENTRY_POINT_PRIORITY) {
    const match = filePaths.find(f => path.basename(f) === name);
    if (match) return match;
  }
  return filePaths[filePaths.length - 1];
}
