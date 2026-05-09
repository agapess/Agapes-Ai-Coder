import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock ResizeObserver since jsdom doesn't support it
// Must use function keyword (not arrow) to be usable as a constructor
global.ResizeObserver = vi.fn(function MockResizeObserver(
  this: { observe: () => void; unobserve: () => void; disconnect: () => void },
) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
}) as unknown as typeof ResizeObserver;

// Mock xterm since jsdom doesn't support canvas
vi.mock('xterm', () => ({
  Terminal: vi.fn(function MockTerminal(
    this: {
      open: () => void;
      write: () => void;
      clear: () => void;
      dispose: () => void;
      loadAddon: () => void;
      onData: () => void;
    },
  ) {
    this.open = vi.fn();
    this.write = vi.fn();
    this.clear = vi.fn();
    this.dispose = vi.fn();
    this.loadAddon = vi.fn();
    this.onData = vi.fn();
  }),
}));
vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn(function MockFitAddon(
    this: { fit: () => void; dispose: () => void },
  ) {
    this.fit = vi.fn();
    this.dispose = vi.fn();
  }),
}));
vi.mock('xterm/css/xterm.css', () => ({}));

import { TerminalPane } from './TerminalPane';

describe('TerminalPane', () => {
  it('renders header with TERMINAL label', () => {
    render(
      <TerminalPane
        command="python script.py"
        status="idle"
        exitCode={null}
        wsUrl="ws://localhost:3001/terminal"
        onStop={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText('TERMINAL')).toBeTruthy();
  });

  it('shows exit badge when exited with code 0', () => {
    render(
      <TerminalPane
        command="python script.py"
        status="exited"
        exitCode={0}
        wsUrl="ws://localhost:3001/terminal"
        onStop={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/exit 0/)).toBeTruthy();
  });
});
