import pty from 'node-pty';
import fs  from 'fs/promises';
import os  from 'os';
import path from 'path';
import { detectRuntime } from './lang.mjs';

const TIMEOUT_MS = 60_000;

const IS_WINDOWS = os.platform() === 'win32';

/**
 * On Windows, node-pty requires full executable names (with .exe).
 * Resolve common runtime commands to their Windows-compatible forms.
 */
function resolveCmd(cmd) {
  if (!IS_WINDOWS) return cmd;
  const winExeMap = {
    node:   'node.exe',
    python: 'python.exe',
    ruby:   'ruby.exe',
    php:    'php.exe',
    bash:   'bash.exe',
    go:     'go.exe',
    cargo:  'cargo.exe',
    npx:    'npx.cmd',
    cmd:    'cmd.exe',
  };
  return winExeMap[cmd] ?? cmd;
}

export class ExecutionManager {
  #pty = null;
  #timeoutId = null;

  async run({ content, filePath, cwd, onData }) {
    const ext = path.extname(filePath).toLowerCase();
    const runtime = detectRuntime(filePath);

    if (!runtime) {
      onData(`\r\nNo runtime available for ${ext} files.\r\n`);
      return 127;
    }

    // Write the entry file to its actual relative path inside the project folder.
    // This is critical for multi-file projects: companion files live at their real
    // paths (e.g. src/game.js), so the entry must also be at its real path so that
    // require('./game') / import './game' resolve from the correct directory.
    const relPath = filePath.replace(/\\/g, '/');
    const diskPath = path.join(cwd, relPath);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, content, 'utf-8');

    const { cmd: rawCmd, args } = runtime;
    const cmd = resolveCmd(rawCmd);
    const finalArgs = ext === '.rs'
      ? [...args, '--manifest-path', path.join(cwd, 'Cargo.toml')]
      : ext === '.bat' || ext === '.cmd'
        ? [...args, diskPath]   // cmd /c needs the absolute path
        : [...args, relPath];

    return new Promise((resolve) => {
      try {
        this.#pty = pty.spawn(cmd, finalArgs, {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd,
          env: { ...process.env, FORCE_COLOR: '1' },
        });
      } catch (err) {
        onData(`\r\n${cmd} not found — install it and ensure it is in PATH.\r\n`);
        resolve(127);
        return;
      }

      this.#pty.onData((data) => onData(data));

      this.#pty.onExit(({ exitCode }) => {
        clearTimeout(this.#timeoutId);
        resolve(exitCode ?? 0);
      });

      this.#timeoutId = setTimeout(() => {
        onData('\r\nProcess timed out after 60s.\r\n');
        this.kill();
      }, TIMEOUT_MS);
    });
  }

  write(data) {
    this.#pty?.write(data);
  }

  resize(cols, rows) {
    this.#pty?.resize(cols, rows);
  }

  kill() {
    clearTimeout(this.#timeoutId);
    try { this.#pty?.kill(); } catch { /* already dead */ }
  }

  destroy() {
    this.kill();
  }
}
