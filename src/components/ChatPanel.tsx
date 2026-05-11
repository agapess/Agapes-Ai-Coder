import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Square, Zap, Mic, MicOff, Paperclip, MessageSquare, Hammer, Bug, BookOpen, Wrench, Globe, Wand2, Puzzle, FlaskConical, FileText, Shield, Rocket, GitBranch, TestTube, FolderOpen, X } from 'lucide-react';
import type { Message, LLMProvider, ProjectPlan, GeneratedFile } from '../types';
import { PlanCard } from './PlanCard';
import { ClonePanel } from './ClonePanel';
import { useSpeech } from '../hooks/useSpeech';
import { supportsVision } from '../lib/visionProviders';

// ── Suggestions shown when chat is empty ─────────────────────
const SUGGESTIONS = [
  { label: 'Todo app',         prompt: 'Build a todo app with drag & drop, priorities, and local storage' },
  { label: 'Dashboard',        prompt: 'Create a data dashboard with charts, stats cards, and dark theme' },
  { label: 'Pomodoro timer',   prompt: 'Build a Pomodoro timer with sessions, breaks, and sound alerts' },
  { label: 'Markdown editor',  prompt: 'Create a split-pane markdown editor with live preview and export' },
  { label: 'Landing page',     prompt: 'Design a modern SaaS landing page with hero, features, and CTA' },
  { label: 'Finance tracker',  prompt: 'Build a personal finance tracker with income, expenses, and charts' },
  { label: 'Kanban board',     prompt: 'Create a Kanban board with drag & drop cards and multiple columns' },
  { label: 'Password gen',     prompt: 'Build a secure password generator with strength meter and copy button' },
  { label: 'Python script',    prompt: 'Write a Python script that processes CSV files and outputs a summary' },
  { label: 'REST API',         prompt: 'Build a Node.js Express REST API with CRUD endpoints and JSON responses' },
  { label: 'Quiz game',        prompt: 'Create an interactive quiz game with scoring, timer, and categories' },
  { label: 'Color picker',     prompt: 'Build a color picker tool with hex, RGB, HSL converters and palette saver' },
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
          <div className="msg-avatar">A</div>
          <span className="msg-author">Agapes</span>
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
      {!isUser && message.usage && (
        <div className="msg-tokens">
          ↑ {message.usage.inputTokens.toLocaleString()} · ↓ {message.usage.outputTokens.toLocaleString()} tokens
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="typing">
      <div className="msg-avatar">A</div>
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
        Describe your app and watch it come to life — web apps, scripts, APIs, and more.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.label} className="suggestion-chip" onClick={() => onSuggest(s.prompt)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type ChatModeType = 'build' | 'chat' | 'explain' | 'debug' | 'refactor' | 'agent';

const CHAT_MODES: { id: ChatModeType; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'build',   label: 'Build',   icon: <Hammer size={11} />,      hint: 'Generate & edit code' },
  { id: 'chat',    label: 'Chat',    icon: <MessageSquare size={11} />,hint: 'Conversation, no code output' },
  { id: 'explain', label: 'Explain', icon: <BookOpen size={11} />,    hint: 'Explain code or concepts' },
  { id: 'debug',   label: 'Debug',   icon: <Bug size={11} />,         hint: 'Help find & fix bugs' },
  { id: 'refactor',label: 'Refactor',icon: <Wrench size={11} />,      hint: 'Improve existing code' },
  { id: 'agent',   label: 'Agent',   icon: <Wand2 size={11} />,       hint: 'Autonomous: generate → run → fix loop' },
];

export type ToolType = 'webSearch' | 'skipPlanning';

// ── Quick-action tools ────────────────────────────────────────
const QUICK_TOOLS = [
  { id: 'brainstorm', label: 'Brainstorm',   icon: <Puzzle size={11} />,     starter: 'Help me brainstorm ideas for: ' },
  { id: 'tests',      label: 'Write Tests',  icon: <TestTube size={11} />,   starter: 'Write comprehensive tests for: ' },
  { id: 'docs',       label: 'Add Docs',     icon: <FileText size={11} />,   starter: 'Generate documentation for: ' },
  { id: 'optimize',   label: 'Optimize',     icon: <Rocket size={11} />,     starter: 'Optimize this for performance: ' },
  { id: 'security',   label: 'Security',     icon: <Shield size={11} />,     starter: 'Check for security vulnerabilities in: ' },
  { id: 'review',     label: 'Review Code',  icon: <GitBranch size={11} />,  starter: 'Review my code and suggest improvements: ' },
  { id: 'flask',      label: 'Experiment',   icon: <FlaskConical size={11} />,starter: 'Let\'s experiment with: ' },
] as const;

// ── Main component ────────────────────────────────────────────
interface Props {
  messages:             Message[];
  isGenerating:         boolean;
  streamingExplanation: string;
  streamingFile?:       { path: string; lang: string; content: string } | null;
  llmConfig:            LLMProvider;
  onLlmConfigChange:    (cfg: LLMProvider) => void;
  files?:               GeneratedFile[];
  needsSetup:           boolean;
  onSend:               (text: string, imageData?: string, attachedFilePaths?: string[]) => void;
  onStop:               () => void;
  // Plan flow
  pendingPlan?:         ProjectPlan | null;
  isPlanLoading?:       boolean;
  onConfirmPlan?:       (clarifyChoice?: string) => void;
  onRejectPlan?:        () => void;
  onRefinePlan?:        (feedback: string) => void;
  onClone?:             (url: string) => void;
  isCloning?:           boolean;
  cloneError?:          string | null;
  // Mode & tools
  chatMode?:            ChatModeType;
  onChatModeChange?:    (mode: ChatModeType) => void;
  agentStatus?:         { iteration: number; maxIterations: number; phase: 'generating' | 'running' | 'fixing' } | null;
  reviewModeActive?:    boolean;
}

export function ChatPanel({
  files = [],
  messages,
  isGenerating,
  streamingExplanation,
  streamingFile,
  llmConfig,
  onLlmConfigChange,
  needsSetup,
  onSend,
  onStop,
  pendingPlan,
  isPlanLoading,
  onConfirmPlan,
  onRejectPlan,
  onRefinePlan,
  onClone,
  isCloning,
  cloneError,
  chatMode = 'build',
  onChatModeChange,
  agentStatus,
  reviewModeActive,
}: Props) {
  const [activeTab, setActiveTab]   = useState<'chat' | 'clone'>('chat');
  const [input, setInput]           = useState('');
  const [showTools, setShowTools]   = useState(false);
  const [attachedFiles,  setAttachedFiles]  = useState<string[]>([]);
  const [atQuery,        setAtQuery]        = useState<string | null>(null);
  const [atHighlight,    setAtHighlight]    = useState(0);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const endRef                      = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);
  const fileInputRef        = useRef<HTMLInputElement>(null);
  const filePickerRef       = useRef<HTMLDivElement>(null);

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
  }, [messages.length, streamingExplanation, pendingPlan]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [input]);

  // Close file picker when clicking outside
  useEffect(() => {
    if (!showFilePicker) return;
    const handler = (e: MouseEvent) => {
      if (filePickerRef.current && !filePickerRef.current.contains(e.target as Node)) {
        setShowFilePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFilePicker]);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text && attachedFiles.length === 0) return;
    if (isGenerating) return;
    onSend(text, undefined, attachedFiles.length > 0 ? attachedFiles : undefined);
    setInput('');
    setAttachedFiles([]);
    setAtQuery(null);
    setShowFilePicker(false);
  };

  const addFileFromAt = (path: string) => {
    if (!attachedFiles.includes(path)) setAttachedFiles((p) => [...p, path]);
    setInput((prev) => prev.replace(/@[\w./\-]*$/, ''));
    setAtQuery(null);
  };

  const toggleFilePicker = (path: string) => {
    setAttachedFiles((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : prev.length < 10 ? [...prev, path] : prev
    );
  };

  const removeAttached = (path: string) => setAttachedFiles((prev) => prev.filter((p) => p !== path));

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (atQuery !== null) {
      const filtered = files.filter((f) => f.path.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 8);
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtHighlight((h) => Math.min(h + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAtHighlight((h) => Math.max(h - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (filtered[atHighlight]) addFileFromAt(filtered[atHighlight].path); return; }
      if (e.key === 'Escape')    { setAtQuery(null); return; }
    }
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

      {/* Mode selector */}
      <div className="chat-mode-bar">
        {CHAT_MODES.map((m) => {
          const agentBlocked = m.id === 'agent' && reviewModeActive;
          return (
            <button
              key={m.id}
              className={`chat-mode-btn${chatMode === m.id ? ' active' : ''}`}
              onClick={() => { if (!agentBlocked) onChatModeChange?.(m.id); }}
              title={agentBlocked ? 'Finish reviewing diffs before using Agent mode' : m.hint}
              style={agentBlocked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              {m.icon}
              {m.label}
            </button>
          );
        })}
        {/* Quick-toggle tools */}
        <div className="chat-mode-divider" />
        <button
          className={`chat-mode-btn${llmConfig.skipPlanning ? ' active' : ''}`}
          onClick={() => onLlmConfigChange({ ...llmConfig, skipPlanning: !llmConfig.skipPlanning })}
          title="Skip the planning step and generate directly"
        >
          <Wand2 size={11} />
          Direct
        </button>
        <button
          className={`chat-mode-btn chat-mode-btn--clone`}
          onClick={() => setActiveTab('clone')}
          title="Clone a URL into a project"
        >
          <Globe size={11} />
          Clone
        </button>
      </div>

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

      {/* Agent progress banner */}
      {agentStatus && (
        <div className="agent-banner">
          <Wand2 size={12} />
          <span>Agent — Iteration {agentStatus.iteration}/{agentStatus.maxIterations} · {
            agentStatus.phase === 'generating' ? 'Generating…' :
            agentStatus.phase === 'running'    ? 'Running…'    : 'Fixing…'
          }</span>
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
            <div className="msg-avatar">A</div>
            <div className="typing-dots">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
          </div>
        )}

        {/* Plan card — user must confirm before generation starts */}
        {pendingPlan && !isPlanLoading && (
          <PlanCard
            plan={pendingPlan}
            onConfirm={(clarifyChoice) => (onConfirmPlan ?? (() => {}))(clarifyChoice)}
            onReject={onRejectPlan ?? (() => {})}
            onRefine={onRefinePlan}
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

        {/* Streaming file indicator */}
        {isGenerating && streamingFile && (
          <div className="streaming-file-indicator">
            ✦ Writing <span className="streaming-file-path">{streamingFile.path}</span>…
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <form className="chat-input-wrap" onSubmit={handleSubmit} onPaste={handlePaste}>
        {/* @ mention popup */}
        {atQuery !== null && (() => {
          const filtered = files
            .filter((f) => f.path.toLowerCase().includes(atQuery.toLowerCase()))
            .slice(0, 8);
          return (
            <div className="at-mention-popup">
              {filtered.length === 0 ? (
                <div className="at-mention-item at-mention-item--empty">No files match</div>
              ) : filtered.map((f, i) => (
                <button
                  key={f.path}
                  type="button"
                  className={`at-mention-item${i === atHighlight ? ' selected' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); addFileFromAt(f.path); }}
                >
                  {f.path}
                </button>
              ))}
            </div>
          );
        })()}
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
            const m = val.match(/@([\w./\-]*)$/);
            if (m) { setAtQuery(m[1]); setAtHighlight(0); }
            else { setAtQuery(null); }
          }}
          onKeyDown={handleKey}
          placeholder={
            chatMode === 'chat'    ? 'Ask anything…' :
            chatMode === 'explain' ? 'What would you like explained?' :
            chatMode === 'debug'   ? 'Describe the bug or error…' :
            chatMode === 'refactor'? 'What should be improved?' :
            messages.length === 0  ? 'Describe the app you want to build…' :
                                     'Ask for changes…'
          }
          disabled={isGenerating || isPlanLoading || !!pendingPlan}
          rows={3}
        />
        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div className="file-chips">
            {attachedFiles.map((path) => (
              <div key={path} className="file-chip">
                <span className="file-chip-name">{path.split('/').pop()}</span>
                <button
                  type="button"
                  className="file-chip-remove"
                  onClick={() => removeAttached(path)}
                  title={`Remove ${path}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

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
          {/* File-attach button */}
          <div className="file-attach-wrap" ref={filePickerRef}>
            <button
              type="button"
              className={`attachment-btn${showFilePicker ? ' active' : ''}`}
              onClick={() => setShowFilePicker((v) => !v)}
              disabled={isGenerating || isPlanLoading || !!pendingPlan || files.length === 0}
              title="Attach project files"
            >
              <FolderOpen size={13} />
            </button>
            {showFilePicker && (
              <div className="file-picker-dropdown">
                {files.map((f) => {
                  const checked = attachedFiles.includes(f.path);
                  const disabled = !checked && attachedFiles.length >= 10;
                  return (
                    <label key={f.path} className={`file-picker-item${disabled ? ' disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleFilePicker(f.path)}
                      />
                      <span>{f.path}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`chat-mode-btn${showTools ? ' active' : ''}`}
            onClick={() => setShowTools((v) => !v)}
            title="Quick-action tools"
            style={{ marginLeft: 'auto' }}
          >
            <Puzzle size={11} />
            Tools
          </button>
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

        {showTools && (
          <div className="tools-panel">
            {QUICK_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tool-chip"
                onClick={() => {
                  setInput(t.starter);
                  setShowTools(false);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        )}
      </form>
      </>)}
    </aside>
  );
}
