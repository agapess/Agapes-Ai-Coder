import { spawn } from 'child_process';

const MANAGER_COMMANDS = {
  npm:   ['npm', 'install'],
  pip:   ['pip', 'install'],
  pip3:  ['pip3', 'install'],
  cargo: ['cargo', 'add'],
  gem:   ['gem', 'install'],
  go:    ['go', 'get'],
};

export async function installPackages({ manager, packages, cwd, onData }) {
  const cmds = MANAGER_COMMANDS[manager];
  if (!cmds) {
    return { success: false, output: `Unknown package manager: ${manager}` };
  }

  const [cmd, ...baseArgs] = cmds;
  const args = [...baseArgs, ...packages];

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: process.env, shell: true });
    let output = '';

    proc.stdout.on('data', d => { const s = d.toString(); output += s; onData?.(s); });
    proc.stderr.on('data', d => { const s = d.toString(); output += s; onData?.(s); });

    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });

    proc.on('error', (err) => {
      resolve({ success: false, output: `${cmd} not found: ${err.message}` });
    });
  });
}

export const INSTALL_PACKAGES_TOOL = {
  name:        'install_packages',
  description: 'Install missing packages for the current project',
  input_schema: {
    type:       'object',
    properties: {
      manager:  { type: 'string', enum: ['npm', 'pip', 'pip3', 'cargo', 'gem', 'go'] },
      packages: { type: 'array', items: { type: 'string' } },
    },
    required: ['manager', 'packages'],
  },
};
