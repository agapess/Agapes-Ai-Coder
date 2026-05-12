import type { ExecutionStatus, AutoFixStatus } from '../types';

interface Props {
  execStatus:      ExecutionStatus;
  exitCode:        number | null;
  autoFixStatus:   AutoFixStatus;
  autoFixAttempt:  number;
  autoFixMax:      number;
  lastMessage:     string;
  onFixWithAI?:    () => void;
}

function getMessage({
  execStatus, exitCode, autoFixStatus, autoFixAttempt, autoFixMax, lastMessage,
}: Props): { text: string; color: string } {
  if (autoFixStatus === 'fixing') {
    return { text: `Auto-fixing… (attempt ${autoFixAttempt}/${autoFixMax})`, color: '#f59e0b' };
  }
  if (autoFixStatus === 'success') {
    return { text: '✓ Fixed! Running the corrected code.', color: '#7fff7f' };
  }
  if (autoFixStatus === 'failed') {
    return { text: lastMessage || 'Could not fix automatically.', color: '#ff7f7f' };
  }
  if (execStatus === 'running') {
    return { text: 'Running…', color: '#00C4AA' };
  }
  if (execStatus === 'exited') {
    if (exitCode === 0) return { text: '✓ Finished successfully.', color: '#7fff7f' };
    return { text: 'Exited with errors.', color: '#ff7f7f' };
  }
  if (lastMessage) return { text: lastMessage, color: '#aaa' };
  return { text: '', color: '#aaa' };
}

export function StatusBar(props: Props) {
  const { text, color } = getMessage(props);
  const showFixBtn =
    props.onFixWithAI &&
    props.autoFixStatus !== 'fixing' &&
    props.execStatus === 'exited' &&
    props.exitCode !== 0 &&
    props.exitCode !== null;

  if (!text && !showFixBtn) return null;

  return (
    <div className="status-bar" style={{ color }}>
      <span className="status-bar__text">{text}</span>
      {showFixBtn && (
        <button className="status-bar__fix-btn" onClick={props.onFixWithAI}>
          Fix with AI
        </button>
      )}
    </div>
  );
}
