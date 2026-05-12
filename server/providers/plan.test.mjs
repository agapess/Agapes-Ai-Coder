import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanJson } from './plan-utils.mjs';

test('parsePlanJson handles clean JSON', () => {
  const json = '{"summary":"A todo app","files":["index.html"],"uses":["React"],"features":["add items"]}';
  const plan = parsePlanJson(json);
  assert.equal(plan.summary, 'A todo app');
  assert.deepEqual(plan.files, ['index.html']);
  assert.deepEqual(plan.uses, ['React']);
});

test('parsePlanJson strips markdown code fences', () => {
  const json = '```json\n{"summary":"App","files":[],"uses":[],"features":[]}\n```';
  const plan = parsePlanJson(json);
  assert.equal(plan.summary, 'App');
  assert.deepEqual(plan.files, []);
});

test('parsePlanJson returns null for invalid JSON', () => {
  assert.equal(parsePlanJson('not valid json at all'), null);
});

test('parsePlanJson returns null when summary missing', () => {
  assert.equal(parsePlanJson('{"files":["x.html"],"uses":[],"features":[]}'), null);
});

test('parsePlanJson coerces array items to strings', () => {
  const plan = parsePlanJson('{"summary":"s","files":[1,2],"uses":[],"features":[]}');
  assert.deepEqual(plan.files, ['1', '2']);
});
