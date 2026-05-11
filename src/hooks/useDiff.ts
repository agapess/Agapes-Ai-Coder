import type { DiffHunk } from '../types';

const MAX_LINES = 2000;

export function computeHunks(before: string, after: string): DiffHunk[] {
  const bLines = before ? before.split('\n') : [];
  const aLines = after  ? after.split('\n')  : [];

  // Fallback for very large files: single replace hunk
  if (bLines.length > MAX_LINES || aLines.length > MAX_LINES) {
    return [{
      type: 'replace',
      beforeStart: 0, beforeCount: bLines.length, beforeLines: bLines,
      afterStart:  0, afterCount:  aLines.length,  afterLines:  aLines,
    }];
  }

  const m = bLines.length, n = aLines.length;

  // LCS DP table (iterative)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = bLines[i - 1] === aLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack iteratively to produce ops
  type Op = { type: 'eq' | 'add' | 'del'; bi: number; ai: number };
  const ops: Op[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && bLines[i - 1] === aLines[j - 1]) {
      ops.unshift({ type: 'eq', bi: i - 1, ai: j - 1 });
      i--; j--;
    } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      ops.unshift({ type: 'del', bi: i - 1, ai: j });
      i--;
    } else {
      ops.unshift({ type: 'add', bi: i, ai: j - 1 });
      j--;
    }
  }

  // Group consecutive non-equal ops into hunks
  const hunks: DiffHunk[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'eq') { k++; continue; }
    const start = k;
    while (k < ops.length && ops[k].type !== 'eq') k++;
    const slice  = ops.slice(start, k);
    const delOps = slice.filter(o => o.type === 'del');
    const addOps = slice.filter(o => o.type === 'add');
    const hunkType: DiffHunk['type'] =
      delOps.length > 0 && addOps.length > 0 ? 'replace'
      : addOps.length > 0 ? 'add' : 'remove';
    const beforeStart = delOps.length > 0 ? delOps[0].bi : (addOps[0]?.bi ?? 0);
    const afterStart  = addOps.length  > 0 ? addOps[0].ai : (delOps[0]?.ai ?? 0);
    hunks.push({
      type:        hunkType,
      beforeStart, beforeCount: delOps.length, beforeLines: delOps.map(o => bLines[o.bi]),
      afterStart,  afterCount:  addOps.length,  afterLines:  addOps.map(o => aLines[o.ai]),
    });
  }
  return hunks;
}

export function applyAcceptedHunks(
  originalContent: string,
  hunks: DiffHunk[],
  resolved: ('accepted' | 'rejected' | 'pending')[],
): string {
  const lines = originalContent.split('\n');
  // Process in reverse to keep indices valid as lines are spliced
  for (let idx = hunks.length - 1; idx >= 0; idx--) {
    if (resolved[idx] === 'accepted') {
      lines.splice(hunks[idx].beforeStart, hunks[idx].beforeCount, ...hunks[idx].afterLines);
    }
  }
  return lines.join('\n');
}
