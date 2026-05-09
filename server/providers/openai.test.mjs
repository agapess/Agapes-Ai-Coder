import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from './openai.mjs';

test('OpenAIProvider: throws if no apiKey', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const p = new OpenAIProvider({ apiKey: '', baseUrl: 'http://localhost:1234/v1', model: 'x' });
    const fakeRes = { write: () => {}, end: () => {} };
    await assert.rejects(
      () => p.stream(fakeRes, [], 'system'),
      /api key/i
    );
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});
