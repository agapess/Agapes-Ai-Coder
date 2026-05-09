import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ImageAttachment } from './ImageAttachment';

const DATA_URL = 'data:image/png;base64,abc123';

describe('ImageAttachment', () => {
  it('renders the image thumbnail with the given src', () => {
    render(<ImageAttachment dataUrl={DATA_URL} onRemove={() => {}} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', DATA_URL);
  });

  it('calls onRemove when the remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<ImageAttachment dataUrl={DATA_URL} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('shows a different image when dataUrl changes', () => {
    const url = 'data:image/jpeg;base64,xyz789';
    render(<ImageAttachment dataUrl={url} onRemove={() => {}} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', url);
  });
});
