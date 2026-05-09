import { describe, it, expect } from 'vitest';
import { buildFixPrompt } from './useAutoFix';

describe('buildFixPrompt', () => {
  it('includes error output', () => {
    const p = buildFixPrompt('print("hi")', 'script.py', 'NameError: name x not defined');
    expect(p).toContain('NameError');
    expect(p).toContain('script.py');
  });

  it('includes the original code', () => {
    const p = buildFixPrompt('let x = 1', 'app.js', 'SyntaxError');
    expect(p).toContain('let x = 1');
  });
});
