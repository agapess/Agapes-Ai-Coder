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
