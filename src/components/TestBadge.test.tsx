import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TestBadge } from './TestBadge';
import type { TestResult } from '../types';

const idle:    TestResult = { status: 'idle',    passed: 0, failed: 0, total: 0, output: '' };
const running: TestResult = { status: 'running', passed: 0, failed: 0, total: 0, output: '' };
const passed:  TestResult = { status: 'passed',  passed: 5, failed: 0, total: 5, output: 'ok' };
const failed:  TestResult = { status: 'failed',  passed: 3, failed: 2, total: 5, output: 'err' };

describe('TestBadge', () => {
  it('renders Run Tests button when idle', () => {
    render(<TestBadge result={idle} onRun={() => {}} />);
    expect(screen.getByRole('button', { name: /run tests/i })).toBeInTheDocument();
  });

  it('shows running indicator when status is running', () => {
    render(<TestBadge result={running} onRun={() => {}} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('shows passed count when all tests pass', () => {
    render(<TestBadge result={passed} onRun={() => {}} />);
    expect(screen.getByText(/5.*passed/i)).toBeInTheDocument();
  });

  it('shows failed count when tests fail', () => {
    render(<TestBadge result={failed} onRun={() => {}} />);
    expect(screen.getByText(/2.*failed/i)).toBeInTheDocument();
  });

  it('calls onRun when the run button is clicked', () => {
    const onRun = vi.fn();
    render(<TestBadge result={idle} onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: /run tests/i }));
    expect(onRun).toHaveBeenCalledOnce();
  });
});
