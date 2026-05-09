// Setup file for vitest
// xterm uses `self` global - ensure it's defined in jsdom
if (typeof self === 'undefined') {
  (global as any).self = global;
}
