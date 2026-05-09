import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, checkRobotsDisallowed } from './clone.mjs';

test('stripHtml removes script tags and content', () => {
  const html = '<p>Hello</p><script>alert("hi")</script><p>World</p>';
  const result = stripHtml(html);
  assert.ok(!result.includes('alert'));
  assert.ok(result.includes('Hello'));
  assert.ok(result.includes('World'));
});

test('stripHtml removes style tags', () => {
  const html = '<p>Text</p><style>body { color: red; }</style>';
  const result = stripHtml(html);
  assert.ok(!result.includes('color: red'));
  assert.ok(result.includes('Text'));
});

test('stripHtml removes HTML tags leaving text', () => {
  const html = '<h1>Title</h1><p>Para</p>';
  const result = stripHtml(html);
  assert.ok(result.includes('Title'));
  assert.ok(result.includes('Para'));
  assert.ok(!result.includes('<h1>'));
});

test('checkRobotsDisallowed returns true for disallow all', () => {
  const txt = 'User-agent: *\nDisallow: /\n';
  assert.equal(checkRobotsDisallowed(txt), true);
});

test('checkRobotsDisallowed returns false when only specific paths disallowed', () => {
  const txt = 'User-agent: *\nDisallow: /admin\n';
  assert.equal(checkRobotsDisallowed(txt), false);
});

test('checkRobotsDisallowed returns false for empty robots.txt', () => {
  assert.equal(checkRobotsDisallowed(''), false);
});
