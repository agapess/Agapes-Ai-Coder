import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from './gemini.mjs';

test('GeminiProvider: throws if no apiKey', async () => {
  const p = new GeminiProvider({ apiKey: '', model: 'gemini-2.0-flash' });
  const fakeRes = { write: () => {} };
  await assert.rejects(
    () => p.stream(fakeRes, [], 'system'),
    /api key/i
  );
});
