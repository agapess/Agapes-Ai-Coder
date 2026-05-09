import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Message, LlmConfig, LLMProvider, GeneratedFile,
  ProjectSummary, StoredProject,
} from '../types';
import { DEFAULT_LLM_CONFIG, DEFAULT_LLM_PROVIDER } from '../types';

// ── File parsing ──────────────────────────────────────────────
const EXT_LANG: Record<string, string> = {
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin',
  cpp: 'cpp', c: 'c', cs: 'csharp',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', sh: 'bash', bash: 'bash',
  sql: 'sql', graphql: 'graphql',
  xml: 'xml', svg: 'xml', toml: 'toml',
  env: 'bash', gitignore: 'bash',
};

export function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'text';
}

interface ParseResult {
  completedFiles: GeneratedFile[];
  streamingFile:  { path: string; lang: string; content: string } | null;
  explanation:    string;
}

/** Parse <forge-file> tags from (possibly partial) streamed text. */
function parseFiles(text: string): ParseResult {
  const completedFiles: GeneratedFile[] = [];
  const tag = /<forge-file\s+path="([^"]+)"(?:\s+lang="([^"]+)")?[^>]*>([\s\S]*?)<\/forge-file>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text)) !== null) {
    completedFiles.push({
      path:    m[1],
      lang:    m[2] || detectLang(m[1]),
      content: m[3].trim(),
    });
  }

  // Look for an in-progress file (open tag but no close tag yet)
  const lastOpen = text.lastIndexOf('<forge-file');
  let streamingFile: ParseResult['streamingFile'] = null;
  if (lastOpen !== -1) {
    const tail = text.slice(lastOpen);
    if (!tail.includes('</forge-file>')) {
      const pathM = tail.match(/path="([^"]+)"/);
      const langM = tail.match(/lang="([^"]+)"/);
      const gt    = tail.indexOf('>');
      if (pathM && gt !== -1) {
        const path    = pathM[1];
        const lang    = langM?.[1] || detectLang(path);
        const content = tail.slice(gt + 1).trim();
        streamingFile = { path, lang, content };
      }
    }
  }

  // Legacy <forge-code> backwards compat
  if (completedFiles.length === 0 && streamingFile === null) {
    const legacyM = text.match(/<forge-code>([\s\S]*?)(?:<\/forge-code>|$)/);
    if (legacyM) {
      const content    = legacyM[1].trim();
      const isComplete = text.includes('</forge-code>');
      if (isComplete) {
        completedFiles.push({ path: 'index.html', lang: 'html', content });
      } else {
        streamingFile = { path: 'index.html', lang: 'html', content };
      }
    }
  }

  // Explanation = everything before the first tag
  const firstTag = text.search(/<forge-file|<forge-code>/);
  const explanation = (firstTag === -1 ? text : text.slice(0, firstTag)).trim();

  return { completedFiles, streamingFile, explanation };
}

// ── Config helpers ────────────────────────────────────────────
function loadConfig(): LLMProvider {
  try {
    const raw = localStorage.getItem('forge_llm_config');
    if (raw) {
      const stored = JSON.parse(raw) as Record<string, unknown>;
      // Migrate legacy provider values
      if (stored.provider === 'local') stored.provider = 'lmstudio';
      if (!stored.provider && stored.anthropicKey) stored.provider = 'anthropic';
      // Migrate legacy key names to new shape
      if (!stored.apiKey && stored.anthropicKey) stored.apiKey = stored.anthropicKey;
      if (!stored.baseUrl && stored.anthropicBaseUrl) stored.baseUrl = stored.anthropicBaseUrl;
      if (!stored.model && stored.localModel) stored.model = stored.localModel;
      if (!stored.baseUrl && stored.localUrl) stored.baseUrl = stored.localUrl;
      return { ...DEFAULT_LLM_PROVIDER, ...stored } as LLMProvider;
    }
  } catch { /* ignore */ }
  // Check for legacy key
  const legacy = localStorage.getItem('forge_key');
  if (legacy) return { ...DEFAULT_LLM_PROVIDER, provider: 'anthropic', apiKey: legacy };
  return DEFAULT_LLM_PROVIDER;
}

function serializeMsgs(msgs: Message[]) {
  return msgs.map((m) => ({
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
  }));
}

function deserializeMsgs(msgs: StoredProject['messages']): Message[] {
  return msgs.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
}

// ── Hook ──────────────────────────────────────────────────────
export function useProject() {
  const [projectId,      setProjectId]  = useState<string>(() => crypto.randomUUID());
  const [projectName,    setProjName]   = useState('Untitled App');
  const [messages,       setMessages]   = useState<Message[]>([]);
  const [files,          setFiles]      = useState<GeneratedFile[]>([]);
  const [activeFilePath, setActive]     = useState('');
  const [streamingFile,  setStreamFile] = useState<{ path: string; lang: string; content: string } | null>(null);
  const [isGenerating,   setGenerating] = useState(false);
  const [streamingText,  setStreaming]  = useState('');
  const [error,          setError]      = useState<string | null>(null);
  const [llmConfig,      setLlmCfgSt]  = useState<LLMProvider>(loadConfig);
  const [projects,       setProjects]   = useState<ProjectSummary[]>([]);
  const [folderPath,     setFolderPath] = useState<string>('');

  const readerRef  = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const nameTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-fresh snapshot to avoid stale closures
  const snap       = useRef({ projectId, projectName, messages, files, activeFilePath });
  snap.current     = { projectId, projectName, messages, files, activeFilePath };

  // ── LLM config ──────────────────────────────────────────────
  const setLlmConfig = useCallback((cfg: LLMProvider) => {
    setLlmCfgSt(cfg);
    localStorage.setItem('forge_llm_config', JSON.stringify(cfg));
  }, []);

  // ── Project list ─────────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch { /* server offline */ }
  }, []);

  // ── Save ─────────────────────────────────────────────────────
  const saveProject = useCallback(async (override?: {
    id?:       string;
    name?:     string;
    messages?: Message[];
    files?:    GeneratedFile[];
  }) => {
    const s     = snap.current;
    const id    = override?.id    ?? s.projectId;
    const msgs  = override?.messages ?? s.messages;
    const fls   = override?.files    ?? s.files;
    if (msgs.length === 0 && fls.length === 0) return; // nothing to save
    try {
      await fetch(`/api/projects/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:     override?.name ?? s.projectName,
          messages: serializeMsgs(msgs),
          files:    fls,
        }),
      });
      await fetchProjects();
    } catch { /* silent */ }
  }, [fetchProjects]);

  // ── Load ─────────────────────────────────────────────────────
  const loadProject = useCallback(async (id: string) => {
    await saveProject();
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const proj: StoredProject = await res.json();
      // Legacy migration: code → files
      const loadedFiles: GeneratedFile[] =
        proj.files?.length
          ? proj.files
          : proj.code
          ? [{ path: 'index.html', lang: 'html', content: proj.code }]
          : [];
      setProjectId(proj.id);
      setProjName(proj.name);
      setMessages(deserializeMsgs(proj.messages));
      setFiles(loadedFiles);
      const firstHtml = loadedFiles.find((f) => f.path.endsWith('.html'));
      setActive(firstHtml?.path ?? loadedFiles[0]?.path ?? '');
      setFolderPath((proj as { folderPath?: string }).folderPath ?? '');
      setError(null);
      localStorage.setItem('forge_active_project', proj.id);
    } catch { /* silent */ }
  }, [saveProject]);

  // ── Delete ───────────────────────────────────────────────────
  const deleteProject = useCallback(async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      await fetchProjects();
      if (id === snap.current.projectId) {
        setProjectId(crypto.randomUUID());
        setProjName('Untitled App');
        setMessages([]);
        setFiles([]);
        setActive('');
        setError(null);
        localStorage.removeItem('forge_active_project');
      }
    } catch { /* silent */ }
  }, [fetchProjects]);

  // ── Project name (debounced save) ────────────────────────────
  const setProjectName = useCallback((name: string) => {
    setProjName(name);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => saveProject({ name }), 800);
  }, [saveProject]);

  // ── Active file (exposed so Sidebar + CodePanel can change it)
  const setActiveFilePath = useCallback((path: string) => setActive(path), []);

  // ── Update a single file's content (used by auto-fix) ────────
  const updateFileContent = useCallback((filePath: string, newContent: string) => {
    setFiles(prev => prev.map(f =>
      f.path === filePath ? { ...f, content: newContent } : f
    ));
  }, []);

  // ── Stop generation ──────────────────────────────────────────
  const stopGeneration = useCallback(() => {
    readerRef.current?.cancel().catch(() => undefined);
    readerRef.current = null;
    setGenerating(false);
    setStreaming('');
    setStreamFile(null);
  }, []);

  // ── Send message ─────────────────────────────────────────────
  const sendMessage = useCallback(async (userContent: string) => {
    if (isGenerating) return;

    const userMsg: Message = {
      id: crypto.randomUUID(), role: 'user',
      content: userContent, timestamp: new Date(),
    };
    const history = [...messages, userMsg];
    setMessages(history);
    setGenerating(true);
    setStreaming('');
    setStreamFile(null);
    setError(null);

    let fullText = '';

    try {
      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:  history.map((m) => ({ role: m.role, content: m.content })),
          llmConfig,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      readerRef.current = reader;
      const dec = new TextDecoder();

      outer: while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch { break; }
        if (chunk.done) break;

        const lines = dec.decode(chunk.value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break outer;
          try {
            const p = JSON.parse(payload) as { text?: string; error?: string };
            if (p.error) throw new Error(p.error);
            if (p.text) {
              fullText += p.text;
              setStreaming(fullText);
              // Live parse
              const { completedFiles, streamingFile: sf } = parseFiles(fullText);
              if (completedFiles.length) setFiles(completedFiles);
              setStreamFile(sf);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'JSON parse error') throw e;
          }
        }
      }

      // Final parse
      const { completedFiles, explanation } = parseFiles(fullText);
      const finalMsgs: Message[] = [
        ...history,
        { id: crypto.randomUUID(), role: 'assistant', content: explanation || fullText, timestamp: new Date() },
      ];
      setMessages(finalMsgs);
      setFiles(completedFiles);
      setStreamFile(null);

      // Set active file to first HTML or first file
      const firstHtml = completedFiles.find((f) => f.path.endsWith('.html'));
      const target    = firstHtml?.path ?? completedFiles[0]?.path ?? '';
      setActive(target);

      // Auto-save
      const id = snap.current.projectId;
      await saveProject({ id, messages: finalMsgs, files: completedFiles });
      localStorage.setItem('forge_active_project', id);

    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      setError(msg);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${msg}`, timestamp: new Date() },
      ]);
    } finally {
      setGenerating(false);
      setStreaming('');
      readerRef.current = null;
    }
  }, [messages, llmConfig, isGenerating, saveProject]);

  // ── New project ───────────────────────────────────────────────
  const newProject = useCallback(async () => {
    stopGeneration();
    await saveProject();
    setProjectId(crypto.randomUUID());
    setProjName('Untitled App');
    setMessages([]);
    setFiles([]);
    setActive('');
    setStreamFile(null);
    setError(null);
    localStorage.removeItem('forge_active_project');
  }, [stopGeneration, saveProject]);

  // ── Init: restore last session ────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) return;
        const list: ProjectSummary[] = await res.json();
        setProjects(list);
        const savedId = localStorage.getItem('forge_active_project');
        if (savedId && list.find((p) => p.id === savedId)) {
          const pr = await fetch(`/api/projects/${savedId}`);
          if (pr.ok) {
            const proj: StoredProject = await pr.json();
            const loadedFiles: GeneratedFile[] =
              proj.files?.length
                ? proj.files
                : proj.code
                ? [{ path: 'index.html', lang: 'html', content: proj.code }]
                : [];
            setProjectId(proj.id);
            setProjName(proj.name);
            setMessages(deserializeMsgs(proj.messages));
            setFiles(loadedFiles);
            const firstHtml = loadedFiles.find((f) => f.path.endsWith('.html'));
            setActive(firstHtml?.path ?? loadedFiles[0]?.path ?? '');
            setFolderPath((proj as { folderPath?: string }).folderPath ?? '');
          }
        }
      } catch { /* server offline */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived ───────────────────────────────────────────────────
  const streamingExplanation = streamingText ? parseFiles(streamingText).explanation : '';
  const needsSetup =
    (llmConfig.provider === 'anthropic' || llmConfig.provider === 'openai' || llmConfig.provider === 'gemini' || llmConfig.provider === 'custom')
      ? !llmConfig.apiKey
      : false; // ollama/lmstudio don't strictly need a key

  return {
    projectId,
    projectName,
    setProjectName,
    messages,
    files,
    activeFilePath,
    setActiveFilePath,
    streamingFile,
    isGenerating,
    streamingExplanation,
    error,
    llmConfig,
    setLlmConfig,
    needsSetup,
    projects,
    folderPath,
    sendMessage,
    stopGeneration,
    newProject,
    loadProject,
    deleteProject,
    updateFileContent,
  };
}
