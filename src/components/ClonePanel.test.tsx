import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ClonePanel } from './ClonePanel';

describe('ClonePanel', () => {
  it('renders the URL input', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error={null} />);
    expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();
  });

  it('Clone button is disabled when input is empty', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error={null} />);
    expect(screen.getByRole('button', { name: /clone/i })).toBeDisabled();
  });

  it('Clone button is disabled for an invalid URL', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error={null} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-a-url' } });
    expect(screen.getByRole('button', { name: /clone/i })).toBeDisabled();
  });

  it('calls onClone with the URL when Clone is clicked', () => {
    const onClone = vi.fn();
    render(<ClonePanel onClone={onClone} isCloning={false} error={null} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /clone/i }));
    expect(onClone).toHaveBeenCalledWith('https://example.com');
  });

  it('shows the error message when error prop is set', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error="Could not reach the site" />);
    expect(screen.getByText(/could not reach the site/i)).toBeInTheDocument();
  });
});
