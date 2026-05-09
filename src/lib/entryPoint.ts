const ENTRY_PRIORITY = [
  'main.py', 'app.py', 'index.py',
  'index.js', 'server.js', 'app.js', 'main.js',
  'main.ts', 'index.ts', 'server.ts', 'app.ts',
  'main.go', 'main.rs', 'main.rb',
];

export function detectEntryPointFromFiles(filePaths: string[]): string | null {
  if (!filePaths.length) return null;
  if (filePaths.length === 1) return filePaths[0];
  for (const name of ENTRY_PRIORITY) {
    const match = filePaths.find((f) => f.split('/').pop() === name);
    if (match) return match;
  }
  return filePaths[filePaths.length - 1];
}
