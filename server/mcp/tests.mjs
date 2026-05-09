/**
 * detectTestFramework — infer test runner from project file list.
 * @param {Array<{path:string, content:string}>} files
 * @returns {'jest'|'vitest'|'pytest'|null}
 */
export function detectTestFramework(files) {
  const paths = files.map((f) => f.path);

  // Python → pytest
  if (paths.some((p) => p.endsWith('.py'))) return 'pytest';

  // vite.config → vitest
  if (paths.some((p) => /vite\.config\.[tj]s$/.test(p))) return 'vitest';

  // package.json with jest dep
  const pkgFile = files.find((f) => f.path === 'package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.jest)   return 'jest';
      if (deps.vitest) return 'vitest';
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * parseTestOutput — extract pass/fail counts from runner output.
 * @param {string} raw
 * @param {'jest'|'vitest'|'pytest'|null} framework
 * @returns {{ passed: number, failed: number, total: number }}
 */
export function parseTestOutput(raw, _framework) {
  const zero = { passed: 0, failed: 0, total: 0 };

  // "2 failed, 5 passed, 7 total" (jest/vitest style)
  const jestMatch = raw.match(/(\d+)\s+failed[,\s]+(\d+)\s+passed[,\s]+(\d+)\s+total/);
  if (jestMatch) {
    return { failed: +jestMatch[1], passed: +jestMatch[2], total: +jestMatch[3] };
  }

  // "5 passed" only (no failures)
  const jestPassOnly = raw.match(/(\d+)\s+passed[,\s]+(\d+)\s+total/);
  if (jestPassOnly) {
    return { passed: +jestPassOnly[1], failed: 0, total: +jestPassOnly[2] };
  }

  // pytest: "3 passed, 1 failed in 0.42s"  or  "3 passed in 0.1s"
  const passM  = raw.match(/(\d+)\s+passed/);
  const failM  = raw.match(/(\d+)\s+failed/);
  if (passM || failM) {
    const passed = passM ? +passM[1] : 0;
    const failed = failM ? +failM[1] : 0;
    return { passed, failed, total: passed + failed };
  }

  return zero;
}

/**
 * buildTestGenPrompt — build LLM prompt asking for a test file.
 * @param {Array<{path:string, content:string}>} files
 * @param {string} framework
 * @returns {string}
 */
export function buildTestGenPrompt(files, framework) {
  if (framework === 'playwright') {
    const htmlFile = files.find((f) => /\.html?$/.test(f.path));
    const htmlPath = htmlFile?.path ?? 'index.html';
    const htmlSnippet = htmlFile ? htmlFile.content.slice(0, 2000) : '';
    return `You are a test engineer. Write a Playwright test using @playwright/test.
Open the HTML file with: await page.goto('file://' + path.join(__dirname, '${htmlPath}'));
Use page.click(), page.fill(), expect(page.locator(...)) assertions. Do not rely on a running server.
Output ONLY the test file content — no explanation, no markdown fences.

// ${htmlPath}
${htmlSnippet}`;
  }

  const snippets = files
    .filter((f) => !f.path.includes('test') && !f.path.includes('spec'))
    .slice(0, 5)
    .map((f) => `// ${f.path}\n${f.content.slice(0, 800)}`)
    .join('\n\n---\n\n');

  return `You are a test engineer. Write a complete ${framework} test file for the code below.
Use the ${framework} testing library. Cover the main happy paths and at least one edge/error case.
Output ONLY the test file content — no explanation, no markdown fences.

${snippets}`;
}
