# Agent Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Agent" chat mode that autonomously loops generate → run → fix up to 5 iterations.

**Architecture:** A state machine in App.tsx drives the loop by watching `project.isGenerating` and `execState.status`. ChatPanel gains an `agentStatus` prop to render a progress banner. CodePanel gains `disableAutoFix` to avoid double-fixing while the agent runs.

**Tech Stack:** React hooks, existing `sendMessage`/`execRun` functions, no new server endpoints.

---

## File Map

| File | Change |
|------|--------|
| `src/components/ChatPanel.tsx` | Add `'agent'` to type + CHAT_MODES; add `agentStatus` prop + banner |
| `src/components/CodePanel.tsx` | Add `disableAutoFix` prop; guard auto-fix effect |
| `src/App.tsx` | Agent state machine: refs + effects + wire props |

---

## Task 1: ChatPanel — agent mode entry + banner

**Files:**
- Modify: `src/components/ChatPanel.tsx`

- [ ] **Step 1: Add 'agent' to ChatModeType and CHAT_MODES**

In `src/components/ChatPanel.tsx`, line 98 change:
```ts
export type ChatModeType = 'build' | 'chat' | 'explain' | 'debug' | 'refactor';
```
to:
```ts
export type ChatModeType = 'build' | 'chat' | 'explain' | 'debug' | 'refactor' | 'agent';
```

Add to `CHAT_MODES` array after the `refactor` entry:
```ts
  { id: 'agent', label: 'Agent', icon: <Wand2 size={11} />, hint: 'Autonomous: generate → run → fix loop' },
```

- [ ] **Step 2: Add agentStatus prop and banner**

Add to the `Props` interface (after `onChatModeChange?:`):
```ts
  agentStatus?: { iteration: number; maxIterations: number; phase: 'generating' | 'running' | 'fixing' } | null;
```

Add `agentStatus` to the destructured params of `ChatPanel`.

Directly above the `<div className="chat-messages">` (or the first element in the return's main content area), insert the banner:
```tsx
{agentStatus && (
  <div className="agent-banner">
    <Wand2 size={12} />
    <span>Agent — Iteration {agentStatus.iteration}/{agentStatus.maxIterations} · {
      agentStatus.phase === 'generating' ? 'Generating…' :
      agentStatus.phase === 'running'    ? 'Running…'    : 'Fixing…'
    }</span>
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors

---

## Task 2: CodePanel — disableAutoFix prop

**Files:**
- Modify: `src/components/CodePanel.tsx`

- [ ] **Step 1: Add disableAutoFix to Props interface**

Add to the `Props` interface:
```ts
  disableAutoFix?: boolean;
```

Add `disableAutoFix` to the destructured params.

- [ ] **Step 2: Guard the auto-fix useEffect**

Find the auto-fix `useEffect` (around line 102) that starts with:
```ts
  useEffect(() => {
    if (execState.status === 'exited' && execState.exitCode === 0) {
```

Add an early return at the top of that effect body:
```ts
    if (disableAutoFix) return;
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors

---

## Task 3: App.tsx — agent state machine + wiring

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add agent state refs**

After the existing refs (around line 47–51), add:
```ts
  type AgentPhase = 'idle' | 'generating' | 'running' | 'fixing';
  const agentPhaseRef      = useRef<AgentPhase>('idle');
  const agentIterRef       = useRef(0);
  const AGENT_MAX          = 5;
  const [agentStatus, setAgentStatus] = useState<{
    iteration: number; maxIterations: number; phase: 'generating' | 'running' | 'fixing'
  } | null>(null);
```

- [ ] **Step 2: Start agent loop on send**

In `handleSend`, at the very top (before any other logic), add:
```ts
    if (chatMode === 'agent') {
      // Build a standard build-mode prompt with file context
      const MAX_CHARS = 4000;
      const fileCtx = project.files.length > 0
        ? project.files
            .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, MAX_CHARS)}\n</forge-file>`)
            .join('\n\n')
        : '';
      const fullPrompt = fileCtx
        ? `${fileCtx}\n\nUser request: ${text}`
        : text;
      agentPhaseRef.current = 'generating';
      agentIterRef.current  = 1;
      setAgentStatus({ iteration: 1, maxIterations: AGENT_MAX, phase: 'generating' });
      project.sendMessage(fullPrompt, undefined, project.files.length > 0 ? '/api/generate' : undefined, project.files.length > 0);
      return;
    }
```

- [ ] **Step 3: Watch generation finish → auto-run**

Add a new `useEffect` after the existing generation watcher (around line 217):
```ts
  // Agent: when generation finishes, auto-run
  useEffect(() => {
    if (agentPhaseRef.current !== 'generating' && agentPhaseRef.current !== 'fixing') return;
    if (project.isGenerating) return; // still generating

    // Generation just finished — auto-run
    const entryPath = detectEntryPointFromFiles(project.files.map((f) => f.path));
    if (!entryPath) {
      // Can't run (e.g. web-only) — declare success
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
```

- [ ] **Step 4: Watch execution exit → fix or stop**

Add another `useEffect` after the one above:
```ts
  // Agent: when run exits, fix or declare success
  useEffect(() => {
    if (agentPhaseRef.current !== 'running') return;
    if (execState.status !== 'exited') return;

    if (execState.exitCode === 0) {
      // Success!
      agentPhaseRef.current = 'idle';
      setAgentStatus(null);
      return;
    }

    // Non-zero — try to fix
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
```

- [ ] **Step 5: Wire props — agentStatus → ChatPanel, disableAutoFix → CodePanel**

In the `<ChatPanel ...>` JSX, add:
```tsx
          agentStatus={agentStatus}
```

In the `<CodePanel ...>` JSX, add:
```tsx
              disableAutoFix={agentPhaseRef.current !== 'idle'}
```

- [ ] **Step 6: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors

---

## Task 4: Agent banner CSS

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add .agent-banner styles**

Append to index.css:
```css
/* ── Agent banner ──────────────────────────────────────────── */
.agent-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: linear-gradient(90deg, rgba(124,58,237,.18), rgba(124,58,237,.08));
  border-bottom: 1px solid rgba(124,58,237,.3);
  color: #a78bfa;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Final TypeScript check**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors
