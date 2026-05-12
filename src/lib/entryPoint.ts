const ENTRY_PRIORITY = [
  'index.html', 'index.htm',
  'main.py', 'app.py', 'index.py',
  'index.js', 'server.js', 'app.js', 'main.js',
  'main.ts', 'index.ts', 'server.ts', 'app.ts',
  'main.go', 'main.rs', 'main.rb',
];

// Node.js server entry names — when these exist alongside HTML, run Node not the browser
const NODE_SERVER_NAMES = ['server.js', 'app.js', 'index.js', 'main.js', 'server.ts', 'app.ts'];

export function detectEntryPointFromFiles(filePaths: string[]): string | null {
  if (!filePaths.length) return null;
  if (filePaths.length === 1) return filePaths[0];

  const basenames = filePaths.map((f) => f.split('/').pop() ?? f);

  // If package.json exists it's a Node project — prefer the JS/TS server entry over HTML
  const hasPackageJson = basenames.includes('package.json');
  if (hasPackageJson) {
    for (const name of NODE_SERVER_NAMES) {
      const match = filePaths.find((f) => f.split('/').pop() === name);
      if (match) return match;
    }
    // Fall through to normal priority if no server entry found
  }

  // Check named priorities
  for (const name of ENTRY_PRIORITY) {
    const match = filePaths.find((f) => f.split('/').pop() === name);
    if (match) return match;
  }

  const anyHtml = filePaths.find((f) => /\.html?$/i.test(f));
  if (anyHtml) return anyHtml;

  return filePaths[filePaths.length - 1];
}
