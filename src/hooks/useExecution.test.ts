import { describe, it, expect } from 'vitest';
import { buildCommand, isWebFile } from './useExecution';

describe('buildCommand', () => {
  it('python files', () => expect(buildCommand('script.py')).toBe('python script.py'));
  it('js files',     () => expect(buildCommand('app.js')).toBe('node app.js'));
  it('ts files',     () => expect(buildCommand('app.ts')).toBe('npx ts-node app.ts'));
  it('go files',     () => expect(buildCommand('main.go')).toBe('go run main.go'));
  it('unknown ext',  () => expect(buildCommand('file.xyz')).toBeNull());
});

describe('isWebFile', () => {
  it('.html is web', () => expect(isWebFile('index.html')).toBe(true));
  it('.htm is web',  () => expect(isWebFile('page.htm')).toBe(true));
  it('.js is not web', () => expect(isWebFile('app.js')).toBe(false));
});
