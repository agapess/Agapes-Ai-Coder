import { useState, useCallback, useRef } from 'react';
import type { AutoFixState, LLMProvider } from '../types';

const MAX_ATTEMPTS = 5;

const RUNTIME_MAP: Record<string, string> = {
  js:   'Node.js', mjs: 'Node.js', cjs: 'Node.js',
  ts:   'Node.js (ts-node)',
  py:   'Python',
  rb:   'Ruby',
  go:   'Go',
  rs:   'Rust (cargo)',
  sh:   'Bash',
  bash: 'Bash',
  php:  'PHP',
  sql:  'SQLite',
};

export function buildFixPrompt(
  code: string,
  filePath: string,
  errorOutput: string,
  allFiles?: { path: string; content: string }[],
): string {
  const ext     = filePath.split('.').pop()?.toLowerCase() ?? '';
  const runtime = RUNTIME_MAP[ext] ?? 'the command-line runtime';
  const jsExtra = (ext === 'js' || ext === 'mjs')
    ? '\nIMPORTANT: The target runtime is plain Node.js. Do NOT use JSX syntax, React Native APIs, or browser-only APIs.'
    : '';

  const MAX_CHARS = 6000;
  const otherFiles = (allFiles ?? []).filter((f) => f.path !== filePath);

  const fileContext = otherFiles.length > 0
    ? '\n\nOther project files for context:\n\n' +
      otherFiles
        .map((f) => {
          const lang = f.path.split('.').pop() ?? '';
          return `<forge-file path="${f.path}" lang="${lang}">\n${f.content.slice(0, MAX_CHARS)}${f.content.length > MAX_CHARS ? '\n...(truncated)' : ''}\n</forge-file>`;
        })
        .join('\n\n')
    : '';

  return `The project produced this error when running "${filePath}" with ${runtime}:

\`\`\`
${errorOutput.slice(0, 3000)}
\`\`\`

Entry file "${filePath}":

\`\`\`
${code.slice(0, MAX_CHARS)}
\`\`\`
${fileContext}

Fix the error so the project runs without errors in ${runtime}.${jsExtra}
Output ONLY the files you changed using <forge-file path="..." lang="..."> tags. If the fix requires changing multiple files (e.g. circular imports, missing exports), output all affected files. Do not output unchanged files.`;
}

function isHtml(content: string): boolean {
  const s = content.trimStart();
  return s.startsWith('<!DOCTYPE') || s.startsWith('<html') || s.startsWith('<!doctype');
}

// Returns all fixed files from the response — handles multi-file fixes (e.g. circular imports)
function extractFixedFiles(rawResponse: string, entryFilePath: string): { path: string; content: string }[] | null {
  const ext = entryFilePath.split('.').pop()?.toLowerCase() ?? '';
  const results: { path: string; content: string }[] = [];

  // Extract all forge-file tags
  const forgeRe = /<forge-file[^>]*\bpath="([^"]+)"[^>]*>([\s\S]*?)<\/forge-file>/g;
  let m: RegExpExecArray | null;
  while ((m = forgeRe.exec(rawResponse)) !== null) {
    const fPath = m[1].trim();
    const content = m[2].trim();
    if (isHtml(content) && ext !== 'html' && ext !== 'htm' && fPath === entryFilePath) continue;
    results.push({ path: fPath, content });
  }

  if (results.length > 0) return results;

  // Fallback: single fenced code block → apply to entry file
  const codeBlock = rawResponse.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeBlock) {
    const c = codeBlock[1].trim();
    if (isHtml(c) && ext !== 'html' && ext !== 'htm') return null;
    return [{ path: entryFilePath, content: c }];
  }

  return null;
}

const C = {
  reset:  '\x1b[0m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  dim:    '\x1b[2m',
};

export function useAutoFix(
  llmConfig: LLMProvider,
  runFn: (filePath: string, content: string) => void,
  updateFileFn: (filePath: string, newContent: string) => void,
) {
  const [state, setState] = useState<AutoFixState>({
    status:      'idle',
    attempt:     0,
    maxAttempts: MAX_ATTEMPTS,
    lastError:   '',
  });

  const abortRef = useRef(false);

  const attemptFix = useCallback(async (
    filePath:    string,
    fileContent: string,
    errorOutput: string,
    write?:      (data: string) => void,
    allFiles?:   { path: string; content: string }[],
  ) => {
    abortRef.current = false;
    let attempt = 0;
    let currentContent = fileContent;

    const print = (text: string) => write?.(`\r\n${text}${C.reset}`);

    // Browser APIs in Node — not fixable; tell user to use Preview instead
    if (/document is not defined|window is not defined|navigator is not defined/.test(errorOutput)) {
      print(`${C.yellow}[Auto-fix] This file uses browser APIs (document/window) which don't exist in Node.js.`);
      print(`${C.yellow}[Auto-fix] Switch to Preview mode or open index.html to run this project in the browser.`);
      setState({ status: 'failed', attempt: 0, maxAttempts: MAX_ATTEMPTS, lastError: 'Browser-only code — use Preview mode instead of Run.' });
      return;
    }

    while (attempt < MAX_ATTEMPTS) {
      if (abortRef.current) break;
      attempt++;

      setState({ status: 'fixing', attempt, maxAttempts: MAX_ATTEMPTS, lastError: errorOutput });
      print(`${C.yellow}[Auto-fix] Asking AI to fix the error (attempt ${attempt}/${MAX_ATTEMPTS}) via ${llmConfig.provider}…`);

      const prompt = buildFixPrompt(currentContent, filePath, errorOutput, allFiles);
      let rawResponse = '';

      try {
        const res = await fetch('/api/generate', {
          method:      'POST',
          headers:     { 'Content-Type': 'application/json' },
          credentials: 'include',
          body:        JSON.stringify({
            messages:  [{ role: 'user', content: prompt }],
            llmConfig,
          }),
        });

        const reader = res.body!.getReader();
        const dec    = new TextDecoder();
        let   buf    = '';

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const p = line.slice(6).trim();
            if (p === '[DONE]') break outer;
            let parsed: { text?: string; error?: string };
            try { parsed = JSON.parse(p); } catch { continue; } // skip malformed JSON only
            if (parsed.error) throw new Error(parsed.error);   // propagate server errors
            if (parsed.text) rawResponse += parsed.text;
          }
        }
      } catch (e) {
        print(`${C.red}[Auto-fix] Request failed: ${String(e)}`);
        setState({ status: 'failed', attempt, maxAttempts: MAX_ATTEMPTS, lastError: String(e) });
        return;
      }

      const fixedFiles = extractFixedFiles(rawResponse, filePath);
      if (!fixedFiles || fixedFiles.length === 0) {
        const aiSaid = rawResponse.trim().slice(0, 300);
        print(`${C.red}[Auto-fix] AI did not produce usable code.`);
        if (aiSaid) print(`${C.dim}AI said: ${aiSaid}${aiSaid.length >= 300 ? '…' : ''}`);
        setState({
          status:      'failed',
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          lastError:   'AI could not produce a fixed version. Try rephrasing your original prompt.',
        });
        return;
      }

      const entryFix = fixedFiles.find((f) => f.path === filePath);
      const fileWord = fixedFiles.length === 1 ? 'file' : `${fixedFiles.length} files`;
      print(`${C.green}[Auto-fix] Fix found (${fileWord}) — applying and rerunning…`);

      // Apply all fixed files
      for (const { path: p, content: c } of fixedFiles) {
        updateFileFn(p, c);
      }

      currentContent = entryFix?.content ?? currentContent;
      setState({ status: 'success', attempt, maxAttempts: MAX_ATTEMPTS, lastError: '' });
      runFn(filePath, entryFix?.content ?? currentContent);
      return;
    }

    setState({
      status:      'failed',
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      lastError:   `I tried ${MAX_ATTEMPTS} times but couldn't fix this automatically.`,
    });
  }, [llmConfig, runFn, updateFileFn]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    setState(s => ({ ...s, status: 'idle' }));
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle', attempt: 0, maxAttempts: MAX_ATTEMPTS, lastError: '' });
  }, []);

  return { state, attemptFix, cancel, reset };
}
