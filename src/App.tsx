import { useState } from 'react';
import { Header }       from './components/Header';
import { Sidebar }      from './components/Sidebar';
import { ChatPanel }    from './components/ChatPanel';
import { CodePanel }    from './components/CodePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { useProject }   from './hooks/useProject';
import { useExecution } from './hooks/useExecution';
import type { ViewMode } from './types';

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const project = useProject();

  const { state: execState, run: execRun, stop: execStop, writeRef } = useExecution(project.folderPath ?? '');

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
          onSend={project.sendMessage}
          onStop={project.stopGeneration}
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
