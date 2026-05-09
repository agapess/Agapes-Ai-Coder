import { useState, useRef, useCallback, useEffect } from 'react';
import type { ExecutionState, WsMessage } from '../types';

const WS_URL = 'ws://localhost:3001/terminal';

const LANG_COMMANDS: Record<string, string> = {
  '.py':   'python',
  '.js':   'node',
  '.mjs':  'node',
  '.ts':   'npx ts-node',
  '.sh':   'bash',
  '.bash': 'bash',
  '.sql':  'sqlite3 :memory:',
  '.rb':   'ruby',
  '.go':   'go run',
  '.rs':   'cargo run',
  '.php':  'php',
};

const WEB_EXTS = new Set(['.html', '.htm']);

/** Returns "python script.py" style label, or null if not runnable. */
export function buildCommand(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  const cmd = LANG_COMMANDS[ext];
  if (!cmd) return null;
  const name = filePath.split('/').pop() ?? filePath;
  return `${cmd} ${name}`;
}

export function isWebFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = filePath.slice(dot).toLowerCase();
  return WEB_EXTS.has(ext);
}

export function useExecution(projectCwd: string) {
  const [state, setState] = useState<ExecutionState>({
    status:   'idle',
    exitCode: null,
    command:  '',
  });

  const wsRef    = useRef<WebSocket | null>(null);
  const writeRef = useRef<((data: string) => void) | null>(null);

  const run = useCallback((filePath: string, content: string) => {
    if (isWebFile(filePath)) {
      setState({ status: 'running', exitCode: null, command: 'browser preview' });
      return;
    }

    const cmd = buildCommand(filePath);
    if (!cmd) return;

    wsRef.current?.close();

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    setState({ status: 'running', exitCode: null, command: cmd });

    ws.onopen = () => {
      const dot = filePath.lastIndexOf('.');
      const ext = dot === -1 ? '' : filePath.slice(dot + 1).toLowerCase();
      const msg: WsMessage = {
        type:    'start',
        file:    filePath,
        content,
        lang:    ext,
        cwd:     projectCwd,
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data as string);
      if (msg.type === 'output' && msg.data) {
        writeRef.current?.(msg.data);
      }
      if (msg.type === 'exit') {
        setState({ status: 'exited', exitCode: msg.code ?? 0, command: cmd });
        ws.close();
      }
      if (msg.type === 'error' && msg.message) {
        writeRef.current?.(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        setState({ status: 'exited', exitCode: 127, command: cmd });
        ws.close();
      }
    };

    ws.onerror = () => {
      writeRef.current?.('\r\n\x1b[31mCould not connect to execution server\x1b[0m\r\n');
      setState({ status: 'exited', exitCode: 1, command: cmd });
    };
  }, [projectCwd]);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'kill' }));
    wsRef.current?.close();
    wsRef.current = null;
    setState(s => ({ ...s, status: 'exited' }));
  }, []);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  return { state, run, stop, sendInput, resize, writeRef };
}
