import { useState, useCallback, useRef } from 'react';
import type { AutoFixState, LLMProvider } from '../types';

const MAX_ATTEMPTS = 5;

export function buildFixPrompt(code: string, filePath: string, errorOutput: string): string {
  return `The file "${filePath}" was executed and produced this error:

\`\`\`
${errorOutput.slice(0, 3000)}
\`\`\`

The current code is:

\`\`\`
${code.slice(0, 8000)}
\`\`\`

Fix the code so it runs without errors. Output only the corrected file using the same <forge-file> format. Do not add any explanation before or after the file tag.`;
}

function extractFixedContent(rawResponse: string): string | null {
  const match = rawResponse.match(/<forge-file[^>]*>([\s\S]*?)<\/forge-file>/);
  return match ? match[1].trim() : null;
}

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
  ) => {
    abortRef.current = false;
    let attempt = 0;
    let currentContent = fileContent;

    while (attempt < MAX_ATTEMPTS) {
      if (abortRef.current) break;
      attempt++;

      setState({ status: 'fixing', attempt, maxAttempts: MAX_ATTEMPTS, lastError: errorOutput });

      const prompt = buildFixPrompt(currentContent, filePath, errorOutput);
      let rawResponse = '';

      try {
        const res = await fetch('/api/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
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
            try {
              const parsed = JSON.parse(p);
              if (parsed.text) rawResponse += parsed.text;
              if (parsed.error) throw new Error(parsed.error);
            } catch { /* partial json */ }
          }
        }
      } catch (e) {
        setState({ status: 'failed', attempt, maxAttempts: MAX_ATTEMPTS, lastError: String(e) });
        return;
      }

      const fixedContent = extractFixedContent(rawResponse);
      if (!fixedContent) {
        setState({
          status:      'failed',
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          lastError:   'AI could not produce a fixed version. Try rephrasing your original prompt.',
        });
        return;
      }

      currentContent = fixedContent;
      updateFileFn(filePath, fixedContent);
      setState({ status: 'success', attempt, maxAttempts: MAX_ATTEMPTS, lastError: '' });
      runFn(filePath, fixedContent);
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
