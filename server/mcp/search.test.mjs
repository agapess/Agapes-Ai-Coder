import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, parseResults } from './search.mjs';

test('buildSearchUrl encodes query correctly', () => {
  const url = buildSearchUrl('React useState hook');
  assert.ok(url.startsWith('https://api.duckduckgo.com/'));
  assert.ok(url.includes('React') || url.includes('React%20') || url.includes('React+'));
});

test('parseResults returns empty array for empty data', () => {
  const results = parseResults({}, 5);
  assert.deepEqual(results, []);
});

test('parseResults extracts AbstractText', () => {
  const data = {
    AbstractText:   'React is a JavaScript library for building UIs.',
    AbstractSource: 'Wikipedia',
    AbstractURL:    'https://en.wikipedia.org/wiki/React',
    RelatedTopics:  [],
  };
  const results = parseResults(data, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Wikipedia');
  assert.ok(results[0].snippet.includes('React'));
  assert.equal(results[0].url, 'https://en.wikipedia.org/wiki/React');
});

test('parseResults extracts RelatedTopics up to maxResults', () => {
  const data = {
    AbstractText:  '',
    RelatedTopics: [
      { Text: 'React hooks - Functions that let you use state', FirstURL: 'https://react.dev/hooks' },
      { Text: 'React state - Managing state',                  FirstURL: 'https://react.dev/state' },
      { Text: 'React props - Passing data',                   FirstURL: 'https://react.dev/props' },
    ],
  };
  const results = parseResults(data, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://react.dev/hooks');
});

test('parseResults skips RelatedTopics without URL', () => {
  const data = {
    AbstractText:  '',
    RelatedTopics: [{ Text: 'no url topic' }],
  };
  const results = parseResults(data, 5);
  assert.deepEqual(results, []);
});
