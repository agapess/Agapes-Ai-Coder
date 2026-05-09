import { FlaskConical, Loader, CheckCircle, XCircle } from 'lucide-react';
import type { TestResult } from '../types';

interface Props {
  result: TestResult;
  onRun:  () => void;
  label?: string;
}

export function TestBadge({ result, onRun, label = 'Run Tests' }: Props) {
  const { status, passed, failed } = result;

  if (status === 'running') {
    return (
      <span className="test-badge test-badge--running">
        <Loader size={11} className="test-badge__spin" />
        Running…
      </span>
    );
  }

  if (status === 'passed') {
    return (
      <button className="test-badge test-badge--passed" onClick={onRun} title="Re-run tests">
        <CheckCircle size={11} />
        {passed} passed
      </button>
    );
  }

  if (status === 'failed') {
    return (
      <button className="test-badge test-badge--failed" onClick={onRun} title="Re-run tests">
        <XCircle size={11} />
        {failed} failed
      </button>
    );
  }

  return (
    <button className="test-badge test-badge--idle" onClick={onRun} title="Generate and run tests">
      <FlaskConical size={11} />
      {label}
    </button>
  );
}
