import { useState, useRef, useEffect } from 'react';
import { Header }       from './components/Header';
import { Sidebar }      from './components/Sidebar';
import { ChatPanel }    from './components/ChatPanel';
import type { ChatModeType } from './components/ChatPanel';
import { CodePanel }    from './components/CodePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { KanbanBoard }  from './components/KanbanBoard';
import { AuthPage }       from './components/AuthPage';
import { PublishDialog }  from './components/PublishDialog';
import { AdminPanel }     from './components/AdminPanel';
import { useProject }     from './hooks/useProject';
import { useExecution }   from './hooks/useExecution';
import { useSnapshots }   from './hooks/useSnapshots';
import { useAutoTest }    from './hooks/useAutoTest';
import { usePlaywrightTest } from './hooks/usePlaywrightTest';
import { useAuth }        from './hooks/useAuth';
import { usePublish }     from './hooks/usePublish';
import { detectEntryPointFromFiles } from './lib/entryPoint';
import { computeHunks, applyAcceptedHunks } from './hooks/useDiff';
import type { ViewMode, ProjectPlan, GeneratedFile, PendingDiff } from './types';

function buildAttachmentContext(paths: string[], files: GeneratedFile[]): string {
  const attached = paths.map((p) => files.find((f) => f.path === p)).filter(Boolean) as GeneratedFile[];
  if (attached.length === 0) return '';
  const MAX = 6000;
  const blocks = attached.map(
    (f) => `=== ${f.path} ===\n${f.content.slice(0, MAX)}${f.content.length > MAX ? '\n...(truncated)' : ''}`
  );
  return `[Attached files]\n${blocks.join('\n\n')}\n\n`;
}

export function App() {
  const auth    = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const project = useProject();

  const { state: execState, run: execRun, stop: execStop, writeRef, terminalOutputRef } = useExecution(project.folderPath ?? '', project.projectId);
  const { snapshots, refresh: refreshSnapshots, createSnapshot, restoreSnapshot } = useSnapshots(project.projectId);
  const { result: testResult, runTests, reset: resetTest } = useAutoTest(project.projectId, project.llmConfig);
  const { result: playwrightResult, runTests: runPlaywrightTests, reset: resetPlaywright } =
    usePlaywrightTest(project.projectId, project.llmConfig);

  const publishHook = usePublish(project.projectId);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showAdminPanel,    setShowAdminPanel]    = useState(false);
  const [chatMode,          setChatMode]          = useState<ChatModeType>('build');

  const wasGeneratingRef   = useRef(false);
  const lastPlanFilesRef   = useRef<string[]>([]); // files the plan promised — used to verify completeness after generation
  const prevExecStatusRef  = useRef(execState.status);
  // Local cache of ALL providers' saved settings so we can restore on switch
  const providerCacheRef   = useRef<Record<string, { key: string; baseUrl: string; model: string }>>({});
  const prevProviderRef    = useRef(project.llmConfig.provider);

  // ── Agent mode state machine ──────────────────────────────
  type AgentPhase = 'idle' | 'generating' | 'running' | 'fixing';
  const agentPhaseRef = useRef<AgentPhase>('idle');
  const agentIterRef  = useRef(0);
  const AGENT_MAX     = 5;
  const [agentStatus, setAgentStatus] = useState<{
    iteration: number; maxIterations: number; phase: 'generating' | 'running' | 'fixing';
  } | null>(null);

  // ── Review mode ───────────────────────────────────────────
  const [reviewMode,         setReviewMode]         = useState(false);
  const [pendingDiffs,       setPendingDiffs]        = useState<PendingDiff[]>([]);
  const [showReviewConfirm,  setShowReviewConfirm]  = useState(false);
  const beforeSnapshotRef = useRef<GeneratedFile[]>([]);
  const reviewModeRef     = useRef(false);
  reviewModeRef.current   = reviewMode;

  // ── Clone flow ────────────────────────────────────────────
  const [isCloning,  setIsCloning]  = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const handleClone = async (url: string) => {
    setIsCloning(true);
    setCloneError(null);
    try {
      const res  = await fetch('/api/clone', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const prompt =
        `Recreate this app/page as a clean, editable Agapes project. ` +
        `Match the design, colors, layout, and functionality.\n\n` +
        `Source URL: ${url}\n\n${data.content}`;
      project.sendMessage(prompt);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCloning(false);
    }
  };

  // ── Plan flow ─────────────────────────────────────────────
  const [pendingPlan,   setPendingPlan]   = useState<ProjectPlan | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [isPlanLoading, setIsPlanLoading] = useState(false);

  const handleSend = async (text: string, imageData?: string, attachedFilePaths: string[] = []) => {
    // Capture snapshot before send when review mode is on
    if (reviewModeRef.current) {
      beforeSnapshotRef.current = project.files.map(f => ({ ...f }));
    }

    // Agent mode — start autonomous generate → run → fix loop
    if (chatMode === 'agent') {
      const MAX_CHARS = 4000;
      const fileCtx = project.files.length > 0
        ? project.files
            .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, MAX_CHARS)}\n</forge-file>`)
            .join('\n\n')
        : '';
      const fullPrompt = fileCtx ? `${fileCtx}\n\nUser request: ${text}` : text;
      agentPhaseRef.current = 'generating';
      agentIterRef.current  = 1;
      setAgentStatus({ iteration: 1, maxIterations: AGENT_MAX, phase: 'generating' });
      project.sendMessage(
        fullPrompt, undefined,
        project.files.length > 0 ? '/api/generate' : undefined,
        project.files.length > 0,
      );
      return;
    }

    const attachCtx = buildAttachmentContext(attachedFilePaths, project.files);
    const displayText = attachedFilePaths.length > 0
      ? `${text}\n\n[Attached: ${attachedFilePaths.map((p) => p.split('/').pop()).join(', ')}]`
      : undefined;

    const activeFile = project.files.find((f) => f.path === project.activeFilePath) ?? project.files[0];

    // Non-build modes → conversational endpoint, inject active file as context
    if (chatMode !== 'build') {
      const MODE_PREFIXES: Partial<Record<ChatModeType, string>> = {
        chat:     '',
        explain:  'Explain the following code in clear terms:\n\n',
        debug:    'Help me find and fix this bug or error in this code:\n\n',
        refactor: 'Suggest improvements and refactor this code:\n\n',
      };
      const prefix = MODE_PREFIXES[chatMode] ?? '';
      const fileCtx = activeFile
        ? `\n\nFile: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 6000)}\n\`\`\`\n\nUser message: `
        : '';
      const aiText = chatMode === 'chat'
        ? (attachCtx ? `${attachCtx}User message: ${text}` : text)
        : `${attachCtx}${prefix}${fileCtx}${text}`;
      project.sendMessage(aiText, imageData, '/api/chat', false, displayText);
      return;
    }

    // Build mode with image → generate directly
    if (imageData) {
      const aiText = attachCtx ? `${attachCtx}User message: ${text}` : text;
      project.sendMessage(aiText, imageData, undefined, undefined, displayText);
      return;
    }

    // Build mode, follow-up on existing project → include current files, merge result
    if (project.files.length > 0 || project.llmConfig.skipPlanning) {
      if (project.files.length > 0) {
        const MAX_CHARS = 4000;
        const fileContext = project.files
          .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, MAX_CHARS)}${f.content.length > MAX_CHARS ? '\n...(truncated)' : ''}\n</forge-file>`)
          .join('\n\n');
        const fullPrompt = `${attachCtx}Current project files:\n\n${fileContext}\n\nUser request: ${text}`;
        project.sendMessage(fullPrompt, undefined, '/api/generate', true, displayText);
      } else {
        const aiText = attachCtx ? `${attachCtx}User message: ${text}` : text;
        project.sendMessage(aiText, undefined, undefined, undefined, displayText);
      }
      return;
    }

    // Build mode, fresh project → show planner
    const aiText = attachCtx ? `${attachCtx}User message: ${text}` : text;
    setPendingPrompt(aiText);
    setIsPlanLoading(true);
    try {
      const res = await fetch('/api/plan', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({
          messages:  [{ role: 'user', content: aiText }],
          llmConfig: project.llmConfig,
        }),
      });
      if (!res.ok) throw new Error('plan failed');
      const { plan } = await res.json();
      setPendingPlan(plan);
    } catch {
      project.sendMessage(aiText, undefined, undefined, undefined, displayText);
    } finally {
      setIsPlanLoading(false);
    }
  };

  const handleConfirmPlan = (clarifyChoice?: string) => {
    let prompt = pendingPrompt;

    // Append the confirmed plan so the AI generates exactly what was shown
    if (pendingPlan) {
      const planLines: string[] = ['\n\nFollow this plan exactly:'];
      if (pendingPlan.files.length)    planLines.push(`Files to create: ${pendingPlan.files.join(', ')}`);
      if (pendingPlan.uses.length)     planLines.push(`Use: ${pendingPlan.uses.join(', ')}`);
      if (pendingPlan.features.length) planLines.push(`Features: ${pendingPlan.features.join(', ')}`);
      if (pendingPlan.files.length) {
        planLines.push(
          `\nCRITICAL: You MUST output every single file listed above using <forge-file> tags. ` +
          `Do NOT skip, combine, or omit any file — output all ${pendingPlan.files.length} file(s) completely.`
        );
      }
      prompt += planLines.join('\n');
    }

    if (clarifyChoice) prompt += `\n\nTarget platform: ${clarifyChoice}`;

    // Remember what files were planned so we can verify completeness after generation
    lastPlanFilesRef.current = pendingPlan?.files ?? [];
    setPendingPlan(null);
    setPendingPrompt('');
    project.sendMessage(prompt);
  };

  const handleRejectPlan = () => {
    setPendingPlan(null);
    setPendingPrompt('');
  };

  const handleRefinePlan = async (feedback: string) => {
    setPendingPlan(null);
    setIsPlanLoading(true);
    try {
      const res = await fetch('/api/plan', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({
          messages:  [{ role: 'user', content: `${pendingPrompt}\n\nPlease adjust the plan: ${feedback}` }],
          llmConfig: project.llmConfig,
        }),
      });
      if (!res.ok) throw new Error('plan failed');
      const { plan } = await res.json();
      setPendingPlan(plan);
    } catch {
      project.sendMessage(`${pendingPrompt}\n\nPlease adjust: ${feedback}`);
      setPendingPrompt('');
    } finally {
      setIsPlanLoading(false);
    }
  };

  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = project.isGenerating;

    if (wasGenerating && !project.isGenerating && project.files.length > 0) {
      // Plan-verify: check that every file the plan promised was actually created.
      // If any are missing, auto-prompt the AI to output them.
      const planned = lastPlanFilesRef.current;
      if (planned.length > 0) {
        const generatedPaths = new Set(project.files.map((f) => f.path));
        const missing = planned.filter((p) => !generatedPaths.has(p));
        lastPlanFilesRef.current = []; // consume — only verify once per generation
        if (missing.length > 0) {
          // Inject current files as context and request the missing ones
          const fileContext = project.files
            .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, 4000)}\n</forge-file>`)
            .join('\n\n');
          const prompt = `Current project files:\n\n${fileContext}\n\n` +
            `You forgot to create these files from the plan: ${missing.join(', ')}. ` +
            `Output ONLY the missing files using <forge-file> tags. Do NOT re-output any file already shown above.`;
          project.sendMessage(prompt, undefined, '/api/generate', true);
          return; // skip auto-run until missing files arrive
        }
      }

      if (project.llmConfig.autoRun !== false) {
        const entryPath = detectEntryPointFromFiles(project.files.map((f) => f.path));
        if (entryPath) {
          const file = project.files.find((f) => f.path === entryPath);
          if (file) {
            const isWeb = /\.(html?|htm)$/i.test(file.path);
            if (!isWeb) setViewMode('split');
            execRun(file.path, file.content, project.files.map(f => ({ path: f.path, content: f.content })));
          }
        }
      }
    }
  }, [project.isGenerating, project.files, project.llmConfig.autoRun]);

  // Agent: when generation finishes, auto-run
  useEffect(() => {
    const phase = agentPhaseRef.current;
    if (phase !== 'generating' && phase !== 'fixing') return;
    if (project.isGenerating) return;

    const entryPath = detectEntryPointFromFiles(project.files.map((f) => f.path));
    if (!entryPath) {
      agentPhaseRef.current = 'idle';
      setAgentStatus(null);
      return;
    }
    const file = project.files.find((f) => f.path === entryPath);
    if (!file) { agentPhaseRef.current = 'idle'; setAgentStatus(null); return; }

    const isWeb = /\.(html?|htm)$/i.test(file.path);
    if (!isWeb) setViewMode('split');

    agentPhaseRef.current = 'running';
    setAgentStatus((s) => s ? { ...s, phase: 'running' } : null);
    execRun(file.path, file.content, project.files.map((f) => ({ path: f.path, content: f.content })));
  }, [project.isGenerating]);

  // Agent: when run exits, fix or declare success
  useEffect(() => {
    if (agentPhaseRef.current !== 'running') return;
    if (execState.status !== 'exited') return;

    if (execState.exitCode === 0) {
      agentPhaseRef.current = 'idle';
      setAgentStatus(null);
      return;
    }

    if (agentIterRef.current >= AGENT_MAX) {
      agentPhaseRef.current = 'idle';
      setAgentStatus(null);
      writeRef.current?.(`\r\n\x1b[31m[Agent] Stopped after ${AGENT_MAX} iterations.\x1b[0m\r\n`);
      return;
    }

    agentIterRef.current += 1;
    agentPhaseRef.current = 'fixing';
    setAgentStatus({ iteration: agentIterRef.current, maxIterations: AGENT_MAX, phase: 'fixing' });

    const MAX_CHARS = 4000;
    const fileContext = project.files
      .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, MAX_CHARS)}\n</forge-file>`)
      .join('\n\n');
    const errorOutput = terminalOutputRef.current.slice(0, 3000) || `Exit code ${execState.exitCode}`;
    const fixPrompt =
      `Current files:\n\n${fileContext}\n\n` +
      `Error output:\n\`\`\`\n${errorOutput}\n\`\`\`\n\n` +
      `Fix the code so it runs without errors. Output only corrected file(s) using <forge-file> tags.`;
    project.sendMessage(fixPrompt, undefined, '/api/generate', true);
  }, [execState.status, execState.exitCode]);

  // Review mode: compute diffs after generation completes
  useEffect(() => {
    if (!reviewModeRef.current) return;
    if (project.isGenerating) return;
    const before = beforeSnapshotRef.current;
    if (before.length === 0 && project.files.length === 0) return;

    const diffs: PendingDiff[] = [];

    for (const newFile of project.files) {
      const orig        = before.find(f => f.path === newFile.path);
      const origContent = orig?.content ?? '';
      if (origContent === newFile.content) continue;
      const hunks = computeHunks(origContent, newFile.content);
      if (hunks.length === 0) continue;
      diffs.push({
        path: newFile.path, lang: newFile.lang,
        originalContent: origContent, newContent: newFile.content,
        hunks, resolvedHunks: hunks.map(() => 'pending' as const),
      });
      project.updateFileContent(newFile.path, origContent);
    }

    // Brand-new files not present in before snapshot
    for (const newFile of project.files) {
      if (before.find(f => f.path === newFile.path)) continue;
      const hunks = computeHunks('', newFile.content);
      diffs.push({
        path: newFile.path, lang: newFile.lang,
        originalContent: '', newContent: newFile.content,
        hunks, resolvedHunks: hunks.map(() => 'pending' as const),
      });
      project.removeFile(newFile.path);
    }

    if (diffs.length > 0) setPendingDiffs(diffs);
    beforeSnapshotRef.current = [];
  }, [project.isGenerating]);

  // Auto-snapshot on successful run (exit code 0)
  useEffect(() => {
    const prev = prevExecStatusRef.current;
    prevExecStatusRef.current = execState.status;
    if (prev === 'running' && execState.status === 'exited' && execState.exitCode === 0) {
      createSnapshot('auto-save').catch(() => {});
    }
  }, [execState.status, execState.exitCode]);

  // Refresh snapshots when project changes; reset test result
  useEffect(() => {
    refreshSnapshots();
    resetTest();
    resetPlaywright();
    setPendingDiffs([]);
    beforeSnapshotRef.current = [];
  }, [refreshSnapshots, resetTest, resetPlaywright]);

  // Sync providerSettings from server (fires on login / session restore)
  useEffect(() => {
    const ps = auth.providerSettings;
    if (!ps || !Object.keys(ps).length) return;
    // Merge into local cache
    providerCacheRef.current = { ...providerCacheRef.current, ...ps };
    // Apply current provider's saved values
    const saved = ps[project.llmConfig.provider];
    if (saved && (saved.key || saved.baseUrl || saved.model)) {
      project.setLlmConfig((prev) => ({
        ...prev,
        ...(saved.key     ? { apiKey:  saved.key }     : {}),
        ...(saved.baseUrl ? { baseUrl: saved.baseUrl }  : {}),
        ...(saved.model   ? { model:   saved.model }    : {}),
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.providerSettings]);

  // When provider changes, restore saved settings for the new provider
  useEffect(() => {
    const p = project.llmConfig.provider;
    if (p === prevProviderRef.current) return;
    prevProviderRef.current = p;
    const saved = providerCacheRef.current[p];
    if (saved) {
      project.setLlmConfig((prev) => ({
        ...prev,
        apiKey:  saved.key     ?? '',
        baseUrl: saved.baseUrl ?? '',
        model:   saved.model   || prev.model || '',
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.llmConfig.provider]);

  // Auto-save provider settings to server (debounced 800ms); also updates local cache
  const saveConfigTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!auth.user) return;
    clearTimeout(saveConfigTimer.current);
    saveConfigTimer.current = setTimeout(() => {
      const cfg = {
        key:     project.llmConfig.apiKey  ?? '',
        baseUrl: project.llmConfig.baseUrl ?? '',
        model:   project.llmConfig.model   ?? '',
      };
      providerCacheRef.current[project.llmConfig.provider] = cfg;
      auth.saveProviderConfig(project.llmConfig.provider, cfg.key, cfg.baseUrl, cfg.model);
    }, 800);
    return () => clearTimeout(saveConfigTimer.current);
  }, [project.llmConfig.provider, project.llmConfig.apiKey, project.llmConfig.baseUrl, project.llmConfig.model, auth.user?.id]);

  const handleSelectFile = (path: string) => {
    project.setActiveFilePath(path);
    setViewMode('code');
  };

  const handleFixWithAI = () => {
    const errorOutput = terminalOutputRef.current.trim();
    if (!errorOutput && execState.exitCode === 0) return;

    const MAX_CHARS = 4000;
    const fileContext = project.files
      .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, MAX_CHARS)}${f.content.length > MAX_CHARS ? '\n...(truncated)' : ''}\n</forge-file>`)
      .join('\n\n');

    const prompt =
      `The following project produced an error when executed.\n\n` +
      `Current files:\n\n${fileContext}\n\n` +
      `Error output:\n\`\`\`\n${errorOutput.slice(0, 3000)}\n\`\`\`\n\n` +
      `Please fix the code so it runs without errors. Output only the corrected file(s) using the <forge-file> format.`;

    project.sendMessage(prompt, undefined, '/api/generate', true);
    setViewMode('split');
  };

  const handleCodeAction = (action: 'explain' | 'refactor' | 'docs', content: string, filename: string) => {
    const MODE_MAP = { explain: 'explain', refactor: 'refactor', docs: 'chat' } as const;
    const PROMPT_MAP = {
      explain:  `Explain the following code from \`${filename}\` in clear terms:\n\n\`\`\`\n${content}\n\`\`\``,
      refactor: `Refactor the following code from \`${filename}\`. Improve readability, maintainability, and performance:\n\n\`\`\`\n${content}\n\`\`\``,
      docs:     `Add documentation comments to the following code from \`${filename}\`. Use appropriate doc-comment style for the language:\n\n\`\`\`\n${content}\n\`\`\``,
    };
    setChatMode(MODE_MAP[action]);
    const endpoint = action === 'docs' ? '/api/generate' : '/api/chat';
    project.sendMessage(PROMPT_MAP[action], undefined, endpoint, action === 'docs');
  };

  const handleAcceptHunk = (path: string, hunkIdx: number) => {
    setPendingDiffs(prev => {
      const next = prev.map(d => {
        if (d.path !== path) return d;
        const resolvedHunks = [...d.resolvedHunks];
        resolvedHunks[hunkIdx] = 'accepted';
        const merged = applyAcceptedHunks(d.originalContent, d.hunks, resolvedHunks);
        project.updateFileContent(path, merged);
        if (resolvedHunks.every(r => r !== 'pending')) return null;
        return { ...d, resolvedHunks };
      });
      return next.filter(Boolean) as PendingDiff[];
    });
  };

  const handleRejectHunk = (path: string, hunkIdx: number) => {
    setPendingDiffs(prev => {
      const next = prev.map(d => {
        if (d.path !== path) return d;
        const resolvedHunks = [...d.resolvedHunks];
        resolvedHunks[hunkIdx] = 'rejected';
        if (resolvedHunks.every(r => r !== 'pending')) return null;
        return { ...d, resolvedHunks };
      });
      return next.filter(Boolean) as PendingDiff[];
    });
  };

  const handleAcceptAll = (path: string) => {
    const diff = pendingDiffs.find(d => d.path === path);
    if (!diff) return;
    project.updateFileContent(path, diff.newContent);
    setPendingDiffs(prev => prev.filter(d => d.path !== path));
  };

  const handleRejectAll = (path: string) => {
    setPendingDiffs(prev => prev.filter(d => d.path !== path));
  };

  const handleToggleReviewMode = () => {
    if (reviewMode && pendingDiffs.length > 0) {
      setShowReviewConfirm(true);
      return;
    }
    setReviewMode(v => !v);
  };

  const handleReviewConfirmAcceptAll = () => {
    pendingDiffs.forEach(d => project.updateFileContent(d.path, d.newContent));
    setPendingDiffs([]);
    setShowReviewConfirm(false);
    setReviewMode(false);
  };

  const handleReviewConfirmRejectAll = () => {
    setPendingDiffs([]);
    setShowReviewConfirm(false);
    setReviewMode(false);
  };

  // ── Auth gate ─────────────────────────────────────────────
  if (auth.isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a14', color: '#666', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (!auth.user) {
    const handleLogin = async (username: string, password: string) => {
      await auth.login(username, password);
      await project.fetchProjects();
    };
    const handleRegister = async (username: string, password: string) => {
      await auth.register(username, password);
      await project.fetchProjects();
    };
    return <AuthPage onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return (
    <div className="app">
      <Header
        projectName={project.projectName}
        onProjectNameChange={project.setProjectName}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNewProject={project.newProject}
        isGenerating={project.isGenerating}
        files={project.files}
        activeFilePath={project.activeFilePath}
        llmConfig={project.llmConfig}
        onLlmConfigChange={project.setLlmConfig}
        user={auth.user}
        onLogout={auth.logout}
        onOpenAdmin={() => setShowAdminPanel(true)}
      />

      <div className="main-layout">
        <Sidebar
          projects={project.projects}
          activeProjectId={project.projectId}
          files={project.files}
          activeFilePath={project.activeFilePath}
          projectName={project.projectName}
          isAdmin={!!auth.user?.isAdmin}
          onNewProject={project.newProject}
          onSelectProject={project.loadProject}
          onDeleteProject={project.deleteProject}
          onSelectFile={handleSelectFile}
          onImport={project.importProject}
        />

        <ChatPanel
          files={project.files}
          messages={project.messages}
          isGenerating={project.isGenerating}
          streamingExplanation={project.streamingExplanation}
          streamingFile={project.streamingFile}
          llmConfig={project.llmConfig}
          onLlmConfigChange={project.setLlmConfig}
          needsSetup={project.needsSetup}
          onSend={handleSend}
          onStop={project.stopGeneration}
          pendingPlan={pendingPlan}
          isPlanLoading={isPlanLoading}
          onConfirmPlan={handleConfirmPlan}
          onRejectPlan={handleRejectPlan}
          onRefinePlan={handleRefinePlan}
          onClone={handleClone}
          isCloning={isCloning}
          cloneError={cloneError}
          chatMode={chatMode}
          onChatModeChange={setChatMode}
          agentStatus={agentStatus}
          reviewModeActive={reviewMode}
        />

        <div className="editor-area">
          {(viewMode === 'code' || viewMode === 'split') && (
            <CodePanel
              files={project.files}
              activeFilePath={project.activeFilePath}
              onSelectFile={project.setActiveFilePath}
              streamingFile={project.streamingFile}
              isGenerating={project.isGenerating}
              execState={execState}
              onRun={execRun}
              onStop={execStop}
              writeRef={writeRef}
              terminalOutputRef={terminalOutputRef}
              llmConfig={project.llmConfig}
              onUpdateFile={project.updateFileContent}
              snapshots={snapshots}
              onRestoreSnapshot={restoreSnapshot}
              testResult={testResult}
              onRunTests={() => runTests(project.files)}
              playwrightResult={playwrightResult}
              onRunPlaywrightTests={() => runPlaywrightTests(project.files)}
              publishState={publishHook}
              onPublish={() => setShowPublishDialog(true)}
              onUnpublish={() => publishHook.unpublish(project.projectId)}
              hasUser={!!auth.user}
              onFixWithAI={handleFixWithAI}
              disableAutoFix={agentPhaseRef.current !== 'idle'}
              onCodeAction={handleCodeAction}
              reviewMode={reviewMode}
              onToggleReviewMode={handleToggleReviewMode}
              pendingDiffs={pendingDiffs}
              showReviewConfirm={showReviewConfirm}
              onAcceptHunk={handleAcceptHunk}
              onRejectHunk={handleRejectHunk}
              onAcceptAll={handleAcceptAll}
              onRejectAll={handleRejectAll}
              onReviewConfirmAcceptAll={handleReviewConfirmAcceptAll}
              onReviewConfirmRejectAll={handleReviewConfirmRejectAll}
              onReviewConfirmKeep={() => setShowReviewConfirm(false)}
            />
          )}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <PreviewPanel
              files={project.files}
              isGenerating={project.isGenerating}
              onShowCode={() => setViewMode('code')}
              writeRef={writeRef}
              projectId={project.projectId}
            />
          )}
          {viewMode === 'features' && (
            <KanbanBoard projectId={project.projectId} />
          )}
        </div>
      </div>

      {showAdminPanel && auth.user && (
        <AdminPanel
          currentUserId={auth.user.id}
          onClose={() => setShowAdminPanel(false)}
        />
      )}

      {showPublishDialog && (
        <PublishDialog
          projectId={project.projectId}
          state={publishHook}
          onPublish={(slug) => publishHook.publish(project.projectId, slug)}
          onUnpublish={() => {
            publishHook.unpublish(project.projectId);
            setShowPublishDialog(false);
          }}
          onClose={() => setShowPublishDialog(false)}
        />
      )}
    </div>
  );
}
