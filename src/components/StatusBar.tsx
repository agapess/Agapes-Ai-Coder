import React from 'react';
import type { ExecutionStatus, AutoFixStatus } from '../types';

interface Props {
  execStatus: ExecutionStatus;
  exitCode: number | null;
  autoFixStatus: AutoFixStatus;
  autoFixAttempt: number;
  autoFixMax: number;
  lastMessage: string;
}

function getMessage({
  execStatus, exitCode, autoFixStatus, autoFixAttempt, autoFixMax, lastMessage,
}: Props): { text: string; color: string } {
  if (autoFixStatus === 'fixing') {
    return {
      text:  `Fixing error automatically… (attempt ${autoFixAttempt}/${autoFixMax})`,
      color: '#f59e0b',
    };
  }
  if (autoFixStatus === 'success') {
    return { text: '✓ Fixed! Running the corrected code.', color: '#7fff7f' };
  }
  if (autoFixStatus === 'failed') {
    return {
      text:  lastMessage || 'Could not fix automatically. Try rephrasing your prompt.',
      color: '#ff7f7f',
    };
  }
  if (execStatus === 'running') {
    return { text: 'Running your code…', color: '#00C4AA' };
  }
  if (execStatus === 'exited') {
    if (exitCode === 0) return { text: '✓ Finished successfully.', color: '#7fff7f' };
    return { text: 'Something went wrong — checking if I can fix it automatically…', color: '#f59e0b' };
  }
  if (lastMessage) return { text: lastMessage, color: '#aaa' };
  return { text: '', color: '#aaa' };
}

export function StatusBar(props: Props) {
  const { text, color } = getMessage(props);
  if (!text) return null;
  return (
    <div className="status-bar" style={{ color }}>
      {text}
    </div>
  );
}
