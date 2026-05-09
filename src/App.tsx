import { useState, useRef, useEffect } from 'react';
import { Header }       from './components/Header';
import { Sidebar }      from './components/Sidebar';
import { ChatPanel }    from './components/ChatPanel';
import { CodePanel }    from './components/CodePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { useProject }   from './hooks/useProject';
import { useExecution } from './hooks/useExecution';
import { useSnapshots } from './hooks/useSnapshots';
import { useAutoTest }  from './hooks/useAutoTest';
import { detectEntryPointFromFiles } from './lib/entryPoint';
import type { ViewMode, ProjectPlan } from './types';

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const project = useProject();

  const { state: execState, run: execRun, stop: execStop, writeRef } = useExecution(project.folderPath ?? '');
  const { snapshots, refresh: refreshSnapshots, createSnapshot, restoreSnapshot } = useSnapshots(project.projectId);
  const { result: testResult, runTests, reset: resetTest } = useAutoTest(project.projectId, project.llmConfig);

  const wasGeneratingRef  = useRef(false);
  const prevExecStatusRef = useRef(execState.status);

  // ── Plan flow ─────────────────────────────────────────────
  const [pendingPlan,   setPendingPlan]   = useState<ProjectPlan | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [isPlanLoading, setIsPlanLoading] = useState(false);

  const handleSend = async (text: string, imageData?: string) => {
    if (imageData) {
      project.sendMessage(text, imageData);
      return;
    }
    if (project.llmConfig.skipPlanning) {
      project.sendMessage(text);
      return;
    }
    setPendingPrompt(text);
    setIsPlanLoading(true);
    try {
      const res = await fetch('/api/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:  [{ role: 'user', content: text }],
          llmConfig: project.llmConfig,
        }),
      });
      if (!res.ok) throw new Error('plan failed');
      const { plan } = await res.json();
      setPendingPlan(plan);
    } catch {
      project.sendMessage(text);
    } finally {
      setIsPlanLoading(false);
    }
  };

  const handleConfirmPlan = () => {
    const prompt = pendingPrompt;
    setPendingPlan(null);
    setPendingPrompt('');
    project.sendMessage(prompt);
  };

  const handleRejectPlan = () => {
    setPendingPlan(null);
    setPendingPrompt('');
  };

  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = project.isGenerating;

    if (wasGenerating && !project.isGenerating && project.files.length > 0) {
      if (project.llmConfig.autoRun !== false) {
        const entryPath = detectEntryPointFromFiles(project.files.map((f) => f.path));
        if (entryPath) {
          const file = project.files.find((f) => f.path === entryPath);
          if (file) {
            execRun(file.path, file.content);
          }
        }
      }
    }
  }, [project.isGenerating, project.files, project.llmConfig.autoRun]);

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
  }, [refreshSnapshots, resetTest]);

  const handleSelectFile = (path: string) => {
    project.setActiveFilePath(path);
    setViewMode('code');
  };

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
      />

      <div className="main-layout">
        <Sidebar
          projects={project.projects}
          activeProjectId={project.projectId}
          files={project.files}
          activeFilePath={project.activeFilePath}
          onNewProject={project.newProject}
          onSelectProject={project.loadProject}
          onDeleteProject={project.deleteProject}
          onSelectFile={handleSelectFile}
        />

        <ChatPanel
          messages={project.messages}
          isGenerating={project.isGenerating}
          streamingExplanation={project.streamingExplanation}
          llmConfig={project.llmConfig}
          onLlmConfigChange={project.setLlmConfig}
          needsSetup={project.needsSetup}
          onSend={handleSend}
          onStop={project.stopGeneration}
          pendingPlan={pendingPlan}
          isPlanLoading={isPlanLoading}
          onConfirmPlan={handleConfirmPlan}
          onRejectPlan={handleRejectPlan}
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
              llmConfig={project.llmConfig}
              onUpdateFile={project.updateFileContent}
              snapshots={snapshots}
              onRestoreSnapshot={restoreSnapshot}
              testResult={testResult}
              onRunTests={() => runTests(project.files)}
            />
          )}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <PreviewPanel
              files={project.files}
              isGenerating={project.isGenerating}
              onShowCode={() => setViewMode('code')}
              writeRef={writeRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
