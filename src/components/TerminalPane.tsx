import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import type { ExecutionStatus } from '../types';

interface Props {
  command: string;
  status: ExecutionStatus;
  exitCode: number | null;
  wsUrl: string;
  onStop: () => void;
  onClear: () => void;
  writeRef?: React.MutableRefObject<((data: string) => void) | null>;
}

export function TerminalPane({ command, status, exitCode, onStop, onClear, writeRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background:          '#060810',
        foreground:          '#EEEEF8',
        cursor:              '#FF5E1A',
        selectionBackground: '#FF5E1A44',
      },
      fontFamily: 'JetBrains Mono, Cascadia Code, monospace',
      fontSize:   13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current  = fit;

    if (writeRef) {
      writeRef.current = (data: string) => term.write(data);
    }

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      fit.dispose();
      term.dispose();
      if (writeRef) writeRef.current = null;
    };
  }, []);

  const handleClear = useCallback(() => {
    termRef.current?.clear();
    onClear();
  }, [onClear]);

  const exitLabel = exitCode === 0
    ? <span className="exit-badge exit-ok">● exit 0</span>
    : <span className="exit-badge exit-fail">● exit {exitCode}</span>;

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <span className="terminal-label">TERMINAL</span>
        <span className="terminal-command">{command}</span>
        <div className="terminal-controls">
          {status === 'exited' && exitLabel}
          <button
            className="terminal-btn"
            onClick={onStop}
            disabled={status !== 'running'}
            title="Stop process"
          >
            ⏹ Stop
          </button>
          <button className="terminal-btn" onClick={handleClear} title="Clear output">
            🗑 Clear
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-body" />
    </div>
  );
}
