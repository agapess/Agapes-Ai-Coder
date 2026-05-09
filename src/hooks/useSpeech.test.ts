import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSpeech } from './useSpeech';

function makeMockRecog() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    continuous: false,
    interimResults: false,
    lang: '',
    onresult: null as any,
    onerror:  null as any,
    onend:    null as any,
  };
}

describe('useSpeech', () => {
  let mockRecog: ReturnType<typeof makeMockRecog>;

  beforeEach(() => {
    mockRecog = makeMockRecog();
    vi.stubGlobal('SpeechRecognition', vi.fn(function() { return mockRecog; }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('supported is true when SpeechRecognition is available', () => {
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(true);
  });

  it('supported is false when SpeechRecognition is absent', () => {
    vi.unstubAllGlobals();
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(false);
  });

  it('listening becomes true after start()', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start(() => {}));
    expect(result.current.listening).toBe(true);
    expect(mockRecog.start).toHaveBeenCalled();
  });

  it('listening becomes false after stop()', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start(() => {}));
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
    expect(mockRecog.stop).toHaveBeenCalled();
  });

  it('transcript updates when onresult fires', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start(() => {}));
    act(() => {
      mockRecog.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: 'hello world' }], { isFinal: true })],
      });
    });
    expect(result.current.transcript).toBe('hello world');
  });
});
