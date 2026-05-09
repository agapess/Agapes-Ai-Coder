import { useState, useCallback } from 'react';
import type { GeneratedFile, LLMProvider, TestResult } from '../types';

const IDLE: TestResult = { status: 'idle', passed: 0, failed: 0, total: 0, output: '' };

export function usePlaywrightTest(projectId: string | null, llmConfig: LLMProvider) {
  const [result, setResult] = useState<TestResult>(IDLE);

  const runTests = useCallback(async (files: GeneratedFile[]) => {
    if (!projectId || !files.length) return;
    setResult({ status: 'running', passed: 0, failed: 0, total: 0, output: '' });

    try {
      const res = await fetch(`/api/projects/${projectId}/playwright-test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ llmConfig, files }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let   output = '';
      let   final: Partial<TestResult> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const obj = JSON.parse(line.slice(5).trim());
            if (obj.chunk)             output += obj.chunk;
            if (obj.status === 'done') final = obj;
            if (obj.error)             throw new Error(obj.error);
          } catch { /* skip parse errors */ }
        }
      }

      setResult({
        status: final.failed ? 'failed' : 'passed',
        passed: final.passed ?? 0,
        failed: final.failed ?? 0,
        total:  final.total  ?? 0,
        output,
      });
    } catch (err) {
      setResult({ status: 'failed', passed: 0, failed: 1, total: 1, output: String(err) });
    }
  }, [projectId, llmConfig]);

  const reset = useCallback(() => setResult(IDLE), []);

  return { result, runTests, reset };
}
