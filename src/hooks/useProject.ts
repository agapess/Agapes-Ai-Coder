import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Message, LLMProvider, GeneratedFile,
  ProjectSummary, StoredProject,
} from '../types';
import { DEFAULT_LLM_PROVIDER } from '../types';

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

  // Markdown code block fallback for local LLMs that don't follow forge-file format
  if (completedFiles.length === 0 && streamingFile === null) {
    const extForLang: Record<string, string> = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', css: 'css', html: 'html' };
    for (const [, hint = '', code] of text.matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
      const trimmed = code.trim();
      if (!trimmed) continue;
      const langHint = hint.toLowerCase();
      const lang = EXT_LANG[langHint] ?? (langHint || 'text');
      const nameM = trimmed.split('\n')[0].match(/^(?:\/\/|#|<!--|\/\*)\s*([\w./-]+\.\w+)/);
      const ext = extForLang[langHint] ?? (langHint || 'txt');
      completedFiles.push({ path: nameM?.[1] ?? `index.${ext}`, lang, content: trimmed });
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

  const readerRef   = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const nameTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUsageRef = useRef<{ inputTokens: number; outputTokens: number } | null>(null);
  // Always-fresh snapshot to avoid stale closures
  const snap       = useRef({ projectId, projectName, messages, files, activeFilePath });
  snap.current     = { projectId, projectName, messages, files, activeFilePath };

  // ── LLM config ──────────────────────────────────────────────
  const setLlmConfig = useCallback((cfgOrUpdater: LLMProvider | ((prev: LLMProvider) => LLMProvider)) => {
    setLlmCfgSt((prev) => {
      const next = typeof cfgOrUpdater === 'function' ? cfgOrUpdater(prev) : cfgOrUpdater;
      localStorage.setItem('forge_llm_config', JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Project list ─────────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { credentials: 'include' });
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
        method:      'PUT',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({
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
      const res = await fetch(`/api/projects/${id}`, { credentials: 'include' });
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
      await fetch(`/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
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
    setFiles(prev => {
      const exists = prev.some((f) => f.path === filePath);
      if (exists) return prev.map((f) => f.path === filePath ? { ...f, content: newContent } : f);
      // New file created by the fix (e.g. constants.py to break a circular import)
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      return [...prev, { path: filePath, lang: ext, content: newContent }];
    });
  }, []);

  // ── Remove a file (used by review mode to revert newly created files) ──
  const removeFile = useCallback((path: string) => {
    setFiles(prev => prev.filter(f => f.path !== path));
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
  const sendMessage = useCallback(async (userContent: string, imageData?: string, endpoint = '/api/generate', merge = false, displayContent?: string) => {
    if (isGenerating) return;

    const userMsg: Message = {
      id: crypto.randomUUID(), role: 'user',
      content: displayContent ?? userContent, timestamp: new Date(),
    };
    // Use snap.current.messages to avoid stale closure — snap is always current
    const history = [...snap.current.messages, userMsg];
    setMessages(history);
    setGenerating(true);
    setStreaming('');
    setStreamFile(null);
    setError(null);
    lastUsageRef.current = null;

    const isChatMode = endpoint === '/api/chat';
    let fullText = '';

    // Stream from endpoint, appending to fullText. Retries up to 3 times on transient failures
    // (network errors, 5xx, 429) before any bytes have streamed back.
    const streamRequest = async (msgs: { role: string; content: string }[]): Promise<void> => {
      let res: Response | null = null;
      let lastErr: unknown = null;
      const RETRYABLE = new Set([429, 500, 502, 503, 504]);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(endpoint, {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'include',
            body:        JSON.stringify({
              messages:  msgs,
              llmConfig,
              ...(imageData ? { imageData } : {}),
            }),
          });
          if (res.ok) break;
          if (!RETRYABLE.has(res.status)) break;
          lastErr = new Error(`HTTP ${res.status}`);
        } catch (e) {
          lastErr = e;
        }
        // Exponential backoff: 500ms, 1500ms, 4500ms
        await new Promise((r) => setTimeout(r, 500 * 3 ** attempt));
      }
      if (!res || !res.ok) {
        const err = res ? await res.json().catch(() => ({ error: `HTTP ${res!.status}` })) : { error: String(lastErr) };
        throw new Error((err as { error?: string }).error ?? 'Request failed after retries');
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
            const p = JSON.parse(payload) as { text?: string; error?: string; usage?: { inputTokens: number; outputTokens: number } };
            if (p.error) throw new Error(p.error);
            if (p.usage) lastUsageRef.current = p.usage;
            if (p.text) {
              fullText += p.text;
              setStreaming(fullText);
              const { completedFiles, streamingFile: sf } = parseFiles(fullText);
              if (completedFiles.length && !isChatMode) {
                if (merge) {
                  setFiles((prev) => {
                    const updatedPaths = new Set(completedFiles.map((f) => f.path));
                    return [...prev.filter((f) => !updatedPaths.has(f.path)), ...completedFiles];
                  });
                } else {
                  setFiles(completedFiles);
                }
              }
              setStreamFile(sf);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'JSON parse error') throw e;
          }
        }
      }
    };

    try {
      // Initial request
      await streamRequest(history.map((m) => ({ role: m.role, content: m.content })));

      // Auto-continuation: if the model truncated mid-file, ask it to continue (up to 3 times).
      // Local LLMs frequently hit max_tokens and stop in the middle of <forge-file>.
      if (!isChatMode) {
        for (let cont = 0; cont < 3; cont++) {
          const parsed = parseFiles(fullText);
          // Truncation indicators: unclosed forge-file tag, or message ends mid-tag
          const truncated = parsed.streamingFile !== null
            || /<forge-file[^>]*$/.test(fullText.slice(-200))
            || (fullText.includes('<forge-file') && !fullText.trimEnd().endsWith('</forge-file>') && parsed.completedFiles.length === 0);
          if (!truncated) break;
          // Append a continuation request: include partial assistant response so the model sees context
          const continuationMsgs = [
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'assistant', content: fullText },
            { role: 'user', content: 'Your previous response was cut off. Continue from EXACTLY where you stopped — do not repeat any text. Output the rest of the current file content, close it with </forge-file>, and output any remaining files.' },
          ];
          await streamRequest(continuationMsgs);
        }
      }

      // Final parse — always rescue streamingFile even when other files completed
      const finalParse = isChatMode ? { completedFiles: [], streamingFile: null, explanation: fullText } : parseFiles(fullText);
      const sf = finalParse.streamingFile;
      const completedFiles = sf && !finalParse.completedFiles.some((f) => f.path === sf.path)
        ? [...finalParse.completedFiles, { path: sf.path, lang: sf.lang, content: sf.content }]
        : finalParse.completedFiles;
      const explanation = finalParse.explanation;
      const assistantContent = isChatMode
        ? (explanation || fullText)
        : explanation ||
          (completedFiles.length > 0
            ? `Generated ${completedFiles.length} file${completedFiles.length !== 1 ? 's' : ''}: ${completedFiles.map((f) => f.path).join(', ')}.`
            : 'Done.');
      const finalMsgs: Message[] = [
        ...history,
        { id: crypto.randomUUID(), role: 'assistant', content: assistantContent, timestamp: new Date(), usage: lastUsageRef.current ?? undefined },
      ];
      setMessages(finalMsgs);
      if (!isChatMode) {
        if (merge && completedFiles.length > 0) {
          // Merge: update files the AI touched, keep the rest unchanged
          setFiles((prev) => {
            const updatedPaths = new Set(completedFiles.map((f) => f.path));
            const kept = prev.filter((f) => !updatedPaths.has(f.path));
            return [...kept, ...completedFiles];
          });
          // Keep current active file unless the AI updated it — then switch to first updated
          const currentActive = snap.current.activeFilePath;
          if (!completedFiles.find((f) => f.path === currentActive)) {
            const firstHtml = completedFiles.find((f) => f.path.endsWith('.html'));
            const target    = firstHtml?.path ?? completedFiles[0]?.path;
            if (target) setActive(target);
          }
        } else if (!merge) {
          // Fresh project: replace the whole file list
          setFiles(completedFiles);
          const firstHtml = completedFiles.find((f) => f.path.endsWith('.html'));
          const target    = firstHtml?.path ?? completedFiles[0]?.path ?? '';
          setActive(target);
        }
        // merge=true + no files → AI answered a question without generating code; keep existing files
      }
      setStreamFile(null);

      const id = snap.current.projectId;
      let filesToSave: GeneratedFile[];
      if (isChatMode) {
        filesToSave = snap.current.files;
      } else if (merge && completedFiles.length > 0) {
        const updatedPaths = new Set(completedFiles.map((f) => f.path));
        filesToSave = [...snap.current.files.filter((f) => !updatedPaths.has(f.path)), ...completedFiles];
      } else if (!merge) {
        filesToSave = completedFiles;
      } else {
        // merge=true but AI returned no files (answered a question) → keep existing
        filesToSave = snap.current.files;
      }
      await saveProject({ id, messages: finalMsgs, files: filesToSave });
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
  }, [llmConfig, isGenerating, saveProject]);

  // ── Import project ────────────────────────────────────────────
  const importProject = useCallback((importedFiles: GeneratedFile[], name: string) => {
    stopGeneration();
    const newId = crypto.randomUUID();
    setProjectId(newId);
    setProjName(name);
    setMessages([]);
    setFiles(importedFiles);
    const firstHtml = importedFiles.find((f) => f.path.endsWith('.html'));
    setActive(firstHtml?.path ?? importedFiles[0]?.path ?? '');
    setStreamFile(null);
    setError(null);
    saveProject({ id: newId, name, messages: [], files: importedFiles });
    localStorage.setItem('forge_active_project', newId);
  }, [stopGeneration, saveProject]);

  // ── New project ───────────────────────────────────────────────
  const newProject = useCallback(() => {
    stopGeneration();
    saveProject(); // fire-and-forget — don't block UI on network
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
        const res = await fetch('/api/projects', { credentials: 'include' });
        if (!res.ok) return;
        const list: ProjectSummary[] = await res.json();
        setProjects(list);
        const savedId = localStorage.getItem('forge_active_project');
        if (savedId && list.find((p) => p.id === savedId)) {
          const pr = await fetch(`/api/projects/${savedId}`, { credentials: 'include' });
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
    (['anthropic', 'openai', 'gemini', 'openrouter', 'custom'] as const).includes(llmConfig.provider as never)
      ? !llmConfig.apiKey
      : false; // ollama/lmstudio don't need a key

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
    importProject,
    loadProject,
    deleteProject,
    updateFileContent,
    removeFile,
    fetchProjects,
  };
}
