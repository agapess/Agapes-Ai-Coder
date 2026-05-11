import { describe, it, expect } from 'vitest';
import { computeHunks, applyAcceptedHunks } from './useDiff';

describe('computeHunks', () => {
  it('returns empty array for identical content', () => {
    expect(computeHunks('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('detects a single line replacement', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nX\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('replace');
    expect(hunks[0].beforeLines).toEqual(['b']);
    expect(hunks[0].afterLines).toEqual(['X']);
  });

  it('detects a pure addition', () => {
    const hunks = computeHunks('a\nc', 'a\nb\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].afterLines).toEqual(['b']);
    expect(hunks[0].beforeCount).toBe(0);
  });

  it('detects a pure removal', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('remove');
    expect(hunks[0].beforeLines).toEqual(['b']);
    expect(hunks[0].afterCount).toBe(0);
  });

  it('handles empty before (all adds)', () => {
    const hunks = computeHunks('', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].afterLines).toEqual(['a', 'b']);
  });

  it('handles empty after (all removes)', () => {
    const hunks = computeHunks('a\nb', '');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('remove');
    expect(hunks[0].beforeLines).toEqual(['a', 'b']);
  });

  it('produces multiple hunks for non-adjacent changes', () => {
    const hunks = computeHunks('a\nb\nc\nd\ne', 'a\nX\nc\nY\ne');
    expect(hunks).toHaveLength(2);
  });
});

describe('applyAcceptedHunks', () => {
  it('applies all accepted hunks', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nX\nc');
    const result = applyAcceptedHunks('a\nb\nc', hunks, ['accepted']);
    expect(result).toBe('a\nX\nc');
  });

  it('does not apply rejected hunks', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nX\nc');
    const result = applyAcceptedHunks('a\nb\nc', hunks, ['rejected']);
    expect(result).toBe('a\nb\nc');
  });

  it('applies only accepted hunks from multiple', () => {
    const before = 'a\nb\nc\nd\ne';
    const after  = 'a\nX\nc\nY\ne';
    const hunks  = computeHunks(before, after);
    expect(hunks).toHaveLength(2);
    // Accept first hunk only
    const result = applyAcceptedHunks(before, hunks, ['accepted', 'rejected']);
    expect(result).toBe('a\nX\nc\nd\ne');
  });
});
