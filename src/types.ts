export type MessageRole = 'user' | 'assistant';
export type ViewMode    = 'code' | 'preview' | 'split' | 'features';
export type Provider    = 'anthropic' | 'local';

export interface Message {
  id:        string;
  role:      MessageRole;
  content:   string;
  timestamp: Date;
  usage?:    { inputTokens: number; outputTokens: number };
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
  projectId?: string;
  allFiles?: { path: string; content: string }[];
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
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export interface LLMProvider {
  provider:      ProviderType;
  apiKey?:       string;
  baseUrl?:      string;
  model?:        string;
  autoRun?:      boolean;
  skipPlanning?: boolean;
}

export const DEFAULT_LLM_PROVIDER: LLMProvider = {
  provider: 'anthropic',
  apiKey:   '',
  baseUrl:  '',
  model:    '',
};

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

// ── Phase 2 ───────────────────────────────────────────────────

export interface ProjectPlan {
  summary:             string;    // "A weather dashboard with real-time data"
  files:               string[];  // ["index.html", "style.css", "app.js"]
  uses:                string[];  // ["OpenWeatherMap API", "Chart.js"]
  features:            string[];  // ["current temp", "5-day forecast", "city search"]
  clarifyingQuestion?: string;    // shown to user before confirming (e.g. "PWA or React Native?")
  clarifyOptions?:     string[];  // choices for the clarifying question
  suggestions?:        string[];  // quick-change chips shown in the "refine" mode
}

export type PlanStatus = 'idle' | 'loading' | 'ready';

export interface Snapshot {
  id:        string;  // safe folder name: ISO timestamp with : replaced by -
  label:     string;  // first 80 chars of the prompt that created it
  createdAt: string;  // ISO timestamp
  fileCount: number;
}

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed';

export interface TestResult {
  status:  TestStatus;
  passed:  number;
  failed:  number;
  total:   number;
  output:  string;
}

// ── Inline diff ───────────────────────────────────────────────

export interface DiffHunk {
  type:        'add' | 'remove' | 'replace';
  beforeStart: number;   // 0-based line index in original
  beforeCount: number;   // how many original lines this replaces
  afterStart:  number;   // 0-based line index in new version
  afterCount:  number;   // how many new lines this introduces
  beforeLines: string[]; // lines being removed/replaced
  afterLines:  string[]; // lines being added/replacing
}

export interface PendingDiff {
  path:            string;
  lang:            string;
  originalContent: string;
  newContent:      string;
  hunks:           DiffHunk[];
  resolvedHunks:   ('accepted' | 'rejected' | 'pending')[];
}
