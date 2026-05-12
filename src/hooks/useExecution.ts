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
  '.bat':  'cmd /c',
  '.cmd':  'cmd /c',
  '.sql':  'sqlite3 :memory:',
  '.rb':   'ruby',
  '.go':   'go run',
  '.rs':   'cargo run',
  '.php':  'php',
};

const WEB_EXTS = new Set(['.html', '.htm']);

const BROWSER_API_PATTERNS = [
  /\bdocument\s*\./,
  /\bwindow\s*\./,
  /\bnavigator\s*\./,
  /\blocation\s*\./,
  /\baddEventListener\s*\(/,
  /\bdocument\.getElementById\b/,
  /\bdocument\.querySelector\b/,
  /\bnew\s+XMLHttpRequest\b/,
  /\bcanvas\.getContext\b/,
];

function isBrowserScript(content: string): boolean {
  // Only check the file's own content — don't block a valid Node.js server just
  // because the project also happens to have an index.html companion file.
  return BROWSER_API_PATTERNS.some((p) => p.test(content));
}

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

export function useExecution(projectCwd: string, projectId?: string) {
  const [state, setState] = useState<ExecutionState>({
    status:   'idle',
    exitCode: null,
    command:  '',
  });

  const wsRef             = useRef<WebSocket | null>(null);
  const writeRef          = useRef<((data: string) => void) | null>(null);
  // Accumulated raw terminal output for the current run — used by auto-fix
  const terminalOutputRef = useRef('');

  const run = useCallback((filePath: string, content: string, allFiles?: { path: string; content: string }[]) => {
    if (isWebFile(filePath)) {
      setState({ status: 'running', exitCode: null, command: 'browser preview' });
      return;
    }

    // Detect browser-only JS — refuse to run with Node and surface a clear message
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    if ((ext === 'js' || ext === 'mjs' || ext === 'ts') && isBrowserScript(content)) {
      const errMsg =
        '\r\n\x1b[33mThis project uses browser APIs (document, window, DOM) and cannot run in Node.js.\r\n' +
        'Switch to Preview mode to view it in the browser, or open index.html directly.\x1b[0m\r\n';
      // Give the terminal a moment to mount, then write the message
      setTimeout(() => writeRef.current?.(errMsg), 50);
      setState({ status: 'exited', exitCode: 0, command: 'browser preview' });
      return;
    }

    const cmd = buildCommand(filePath);
    if (!cmd) return;

    wsRef.current?.close();
    terminalOutputRef.current = ''; // reset before each new run

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    setState({ status: 'running', exitCode: null, command: cmd });

    ws.onopen = () => {
      const dot = filePath.lastIndexOf('.');
      const ext = dot === -1 ? '' : filePath.slice(dot + 1).toLowerCase();
      const msg: WsMessage = {
        type:      'start',
        file:      filePath,
        content,
        lang:      ext,
        cwd:       projectCwd,
        projectId,
        allFiles,
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data as string);
      if (msg.type === 'output' && msg.data) {
        writeRef.current?.(msg.data);
        terminalOutputRef.current += msg.data;
      }
      if (msg.type === 'exit') {
        setState({ status: 'exited', exitCode: msg.code ?? 0, command: cmd });
        ws.close();
      }
      if (msg.type === 'error' && msg.message) {
        const errText = `\r\n\x1b[31m${msg.message}\x1b[0m\r\n`;
        writeRef.current?.(errText);
        terminalOutputRef.current += msg.message;
        setState({ status: 'exited', exitCode: 127, command: cmd });
        ws.close();
      }
    };

    ws.onerror = () => {
      const errText = '\r\n\x1b[31mCould not connect to execution server\x1b[0m\r\n';
      writeRef.current?.(errText);
      terminalOutputRef.current += 'Could not connect to execution server';
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

  return { state, run, stop, sendInput, resize, writeRef, terminalOutputRef };
}
