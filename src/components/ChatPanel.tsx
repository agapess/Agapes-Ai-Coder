import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Square, Zap } from 'lucide-react';
import type { Message, LLMProvider } from '../types';

// ── Suggestions shown when chat is empty ─────────────────────
const SUGGESTIONS = [
  'Build a todo app with drag & drop',
  'Create a Pomodoro timer',
  'Make a weather dashboard',
  'Design a landing page for a SaaS',
  'Build a markdown previewer',
  'Create a personal finance tracker',
];

// ── Message bubble ────────────────────────────────────────────
function MessageBubble({
  message,
  isStreaming = false,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const isError = message.content.startsWith('Error:');

  return (
    <div className={`message message--${message.role}`}>
      {!isUser && (
        <div className="msg-meta">
          <div className="msg-avatar">F</div>
          <span className="msg-author">Forge</span>
        </div>
      )}
      {isUser && (
        <div className="msg-meta" style={{ justifyContent: 'flex-end' }}>
          <span className="msg-author">You</span>
        </div>
      )}
      <div className={`msg-body${isError ? ' msg-error' : ''}`}>
        {message.content || <>&nbsp;</>}
        {isStreaming && <span className="cursor" />}
      </div>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="typing">
      <div className="msg-avatar">F</div>
      <div className="typing-dots">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  return (
    <div className="chat-empty">
      <div className="chat-empty-icon">
        <Zap size={24} />
      </div>
      <h2 className="chat-empty-title">Build anything with AI</h2>
      <p className="chat-empty-sub">
        Describe your app in plain English and watch it come to life.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggestion-chip" onClick={() => onSuggest(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
interface Props {
  messages: Message[];
  isGenerating: boolean;
  streamingExplanation: string;
  llmConfig: LLMProvider;
  onLlmConfigChange: (cfg: LLMProvider) => void;
  needsSetup: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatPanel({
  messages,
  isGenerating,
  streamingExplanation,
  llmConfig,
  onLlmConfigChange,
  needsSetup,
  onSend,
  onStop,
}: Props) {
  const [input, setInput]   = useState('');
  const endRef              = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingExplanation]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [input]);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isGenerating) return;
    onSend(text);
    setInput('');
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <aside className="chat-panel">
      {/* Setup notice */}
      {needsSetup && (
        <div className="api-notice">
          <span className="api-notice-text">API Key</span>
          <input
            className="api-notice-input"
            type="password"
            placeholder="Enter API key…"
            value={llmConfig.apiKey || ''}
            onChange={(e) => onLlmConfigChange({ ...llmConfig, apiKey: e.target.value })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 && !isGenerating && (
          <EmptyState onSuggest={onSend} />
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {/* Streaming response */}
        {isGenerating && streamingExplanation && (
          <MessageBubble
            message={{
              id:        '__streaming__',
              role:      'assistant',
              content:   streamingExplanation,
              timestamp: new Date(),
            }}
            isStreaming
          />
        )}

        {/* Typing dots while waiting for first token */}
        {isGenerating && !streamingExplanation && <TypingIndicator />}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <form className="chat-input-wrap" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={
            messages.length === 0
              ? 'Describe the app you want to build…'
              : 'Ask for changes…'
          }
          disabled={isGenerating}
          rows={3}
        />
        <div className="input-row">
          <span className="input-hint">↵ send · shift+↵ newline</span>
          {isGenerating ? (
            <button type="button" className="stop-btn" onClick={onStop}>
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="send-btn"
              disabled={!input.trim()}
            >
              <Send size={13} />
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
