import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Square, Zap, Mic, MicOff, Paperclip } from 'lucide-react';
import type { Message, LLMProvider, ProjectPlan } from '../types';
import { PlanCard } from './PlanCard';
import { ClonePanel } from './ClonePanel';
import { useSpeech } from '../hooks/useSpeech';
import { supportsVision } from '../lib/visionProviders';

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
  messages:             Message[];
  isGenerating:         boolean;
  streamingExplanation: string;
  llmConfig:            LLMProvider;
  onLlmConfigChange:    (cfg: LLMProvider) => void;
  needsSetup:           boolean;
  onSend:               (text: string, imageData?: string) => void;
  onStop:               () => void;
  // Phase 2 — plan flow
  pendingPlan?:         ProjectPlan | null;
  isPlanLoading?:       boolean;
  onConfirmPlan?:       () => void;
  onRejectPlan?:        () => void;
  onClone?:             (url: string) => void;
  isCloning?:           boolean;
  cloneError?:          string | null;
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
  pendingPlan,
  isPlanLoading,
  onConfirmPlan,
  onRejectPlan,
  onClone,
  isCloning,
  cloneError,
}: Props) {
  const [activeTab, setActiveTab] = useState<'chat' | 'clone'>('chat');
  const [input, setInput]   = useState('');
  const endRef              = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);
  const fileInputRef        = useRef<HTMLInputElement>(null);

  const speech = useSpeech();

  const handleImageError = (msg: string) => {
    setInput(msg);
    setTimeout(() => setInput(''), 3000);
  };

  const handleImageSelect = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      handleImageError('Image too large — max 5MB');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      handleImageError('Only PNG, JPG, and WebP are supported');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      onSend(input.trim(), dataUrl);
      setInput('');
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items)
      .find((item) => item.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) handleImageSelect(file);
    }
  };

  useEffect(() => {
    if (speech.listening) setInput(speech.transcript);
  }, [speech.transcript, speech.listening]);

  const handleMicClick = () => {
    if (speech.listening) {
      speech.stop();
    } else {
      speech.start((text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setInput('');
      });
    }
  };

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
      {/* Tab bar */}
      <div className="chat-tabs">
        <button
          className={`chat-tab${activeTab === 'chat' ? ' active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          className={`chat-tab${activeTab === 'clone' ? ' active' : ''}`}
          onClick={() => setActiveTab('clone')}
        >
          Clone URL
        </button>
      </div>

      {activeTab === 'clone' ? (
        <ClonePanel
          onClone={onClone ?? (() => {})}
          isCloning={isCloning ?? false}
          error={cloneError ?? null}
        />
      ) : (<>

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

        {/* Plan loading indicator */}
        {isPlanLoading && (
          <div className="typing">
            <div className="msg-avatar">F</div>
            <div className="typing-dots">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
          </div>
        )}

        {/* Plan card — user must confirm before generation starts */}
        {pendingPlan && !isPlanLoading && (
          <PlanCard
            plan={pendingPlan}
            onConfirm={onConfirmPlan ?? (() => {})}
            onReject={onRejectPlan ?? (() => {})}
          />
        )}

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
      <form className="chat-input-wrap" onSubmit={handleSubmit} onPaste={handlePaste}>
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
          disabled={isGenerating || isPlanLoading || !!pendingPlan}
          rows={3}
        />
        <div className="input-row">
          {speech.supported && (
            <button
              type="button"
              className={`mic-btn${speech.listening ? ' mic-btn--recording' : ''}`}
              onClick={handleMicClick}
              disabled={isGenerating || isPlanLoading || !!pendingPlan}
              title={speech.listening ? 'Stop recording' : 'Voice input (auto-submits after 2s silence)'}
            >
              {speech.listening ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
          )}
          {supportsVision(llmConfig.provider) && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageSelect(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="attachment-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating || isPlanLoading || !!pendingPlan}
                title="Attach image (or paste from clipboard)"
              >
                <Paperclip size={13} />
              </button>
            </>
          )}
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
              disabled={!input.trim() || isPlanLoading || !!pendingPlan}
            >
              <Send size={13} />
              Send
            </button>
          )}
        </div>
      </form>
      </>)}
    </aside>
  );
}
