export type MessageRole = 'user' | 'assistant';
export type ViewMode    = 'code' | 'preview' | 'split';
export type Provider    = 'anthropic' | 'local';

export interface Message {
  id:        string;
  role:      MessageRole;
  content:   string;
  timestamp: Date;
}

export interface LlmConfig {
  provider:         Provider;
  anthropicKey:     string;
  anthropicBaseUrl: string;
  localUrl:         string;
  localModel:       string;
  localKey:         string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider:         'anthropic',
  anthropicKey:     '',
  anthropicBaseUrl: '',
  localUrl:         'http://localhost:1234/v1',
  localModel:       '',
  localKey:         '',
};

/** One file in a generated project */
export interface GeneratedFile {
  path:    string;  // e.g. "src/App.tsx"  or  "index.html"
  lang:    string;  // syntax highlight language id
  content: string;
}

/** Serialised to disk */
export interface StoredProject {
  id:        string;
  name:      string;
  messages:  (Omit<Message, 'timestamp'> & { timestamp: string })[];
  files:     GeneratedFile[];
  code?:     string;   // legacy — converted on load
  createdAt: string;
  updatedAt: string;
}

/** Lightweight summary used in the sidebar list */
export interface ProjectSummary {
  id:         string;
  name:       string;
  hasFiles:   boolean;
  updatedAt:  string;
  folderPath?: string;
}

// ── Execution / Sandbox ───────────────────────────────────────

export type ExecutionStatus = 'idle' | 'running' | 'exited';

export interface WsMessage {
  type: 'start' | 'input' | 'kill' | 'resize' | 'output' | 'exit' | 'error';
  // client → server
  file?: string;
  content?: string;
  lang?: string;
  cwd?: string;
  data?: string;
  cols?: number;
  rows?: number;
  // server → client
  code?: number;
  message?: string;
}

export interface ExecutionState {
  status: ExecutionStatus;
  exitCode: number | null;
  command: string;
}

// ── Multi-LLM Provider ────────────────────────────────────────

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export interface LLMProvider {
  provider: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

// ── Auto-Fix ──────────────────────────────────────────────────

export type AutoFixStatus =
  | 'idle'
  | 'fixing'
  | 'success'
  | 'failed';

export interface AutoFixState {
  status: AutoFixStatus;
  attempt: number;
  maxAttempts: number;
  lastError: string;
}
