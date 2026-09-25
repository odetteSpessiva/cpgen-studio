import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { useConsoleLogsContext } from "../context/ConsoleLogsContext";
import { usePipelineContext } from "../context/PipelineContext";
import { useSettingsContext } from "../context/SettingsContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import { useMonacoEditor } from "../hooks/useMonacoEditor";
import SchemaPreviewPanel from "./schema/SchemaPreviewPanel";
import TabBar, { PinnedTab } from "./TabBar";

const EDITOR_OPTIONS = {
  mouseWheelZoom: true,
  fontSize: 13,
  fontFamily:
    '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
  minimap: { enabled: false },
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
  lineNumbersMinChars: 3,
  automaticLayout: true,
  padding: { top: 10, bottom: 10 },
  renderValidationDecorations: "on" as const,
  fixedOverflowWidgets: true,
};

export default function EditorPanel() {
  const {
    generatorFile,
    solutionFile,
    activeFile,
    activePath,
    slotPaths,
    setActivePath,
    tabOrder,
    closeTab,
    reorderTabs,
    openFiles,
    handleCodeChange,
    saveActiveFile,
    setIsDirty,
    generatorMode,
    nodes,
    openFileDialog,
  } = useWorkspaceContext();

  const { appendLog } = useConsoleLogsContext();
  const { previewSchema } = usePipelineContext();
  const { fontSize, fontFamily, formatOnSave } = useSettingsContext();

  const { handleEditorMount } = useMonacoEditor({
    activeFile,
    appendLog,
    formatOnSave,
    handleCodeChange,
    saveActiveFile,
    setIsDirty,
  });

  const [previewExample, setPreviewExample] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isOpenShortcut =
        (event.ctrlKey || event.metaKey) && event.key === "o";
      if (!isOpenShortcut) return;
      event.preventDefault();
      openFileDialog();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openFileDialog]);

  const isGeneratorActive =
    activePath !== null && activePath === slotPaths.generator;
  const isSolutionActive =
    activePath !== null && activePath === slotPaths.solution;

  const showSchemaPreview = generatorMode === "visual" && isGeneratorActive;

  const showGeneratorTab = generatorMode === "visual" || !!generatorFile;
  const showSolutionTab = !!solutionFile;

  const pinnedPaths = new Set(
    [slotPaths.generator, slotPaths.solution].filter(Boolean),
  );

  return (
    <section className="h-full min-w-0 min-h-0 flex flex-col overflow-hidden bg-(--bg-primary)">
      <div className="h-9.5 shrink-0 flex items-stretch gap-0.5 bg-(--bg-secondary) border-b border-(--border) px-2 overflow-x-auto">
        {showGeneratorTab && (
          <PinnedTab
            label={
              generatorMode === "visual"
                ? "Generator (Schema)"
                : (generatorFile?.name ?? "Generator")
            }
            isActive={isGeneratorActive}
            isDirty={generatorMode === "files" && !!generatorFile?.isDirty}
            disabled={false}
            onClick={() => setActivePath(slotPaths.generator)}
          />
        )}

        {showSolutionTab && (
          <PinnedTab
            label={solutionFile?.name ?? "Solution"}
            isActive={isSolutionActive}
            isDirty={!!solutionFile?.isDirty}
            disabled={false}
            onClick={() => setActivePath(slotPaths.solution)}
          />
        )}

        <TabBar
          tabOrder={tabOrder}
          openFiles={openFiles}
          activePath={activePath}
          onSelect={setActivePath}
          onClose={closeTab}
          onReorder={reorderTabs}
          pinnedPaths={pinnedPaths}
        />

        <span className="flex-1" />
        {activeFile && !showSchemaPreview && (
          <span className="self-center text-(--text-muted) uppercase text-[12px] px-3.5">
            {activeFile.language}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Does not get unmounted on mode change */}
          {activeFile && (
            <div
              className={`min-h-0 ${showSchemaPreview ? "hidden" : "flex-1"}`}
            >
              <Editor
                height="100%"
                theme="vs-dark"
                path={activeFile.path}
                language={activeFile.language}
                defaultValue={activeFile.value}
                onMount={handleEditorMount}
                options={{
                  ...EDITOR_OPTIONS,
                  fontSize: fontSize,
                  fontFamily: fontFamily,
                }}
              />
            </div>
          )}

          {showSchemaPreview && (
            <div className="flex-1 min-h-0">
              <SchemaPreviewPanel
                example={previewExample}
                onGenerate={async () => {
                  try {
                    const result = await previewSchema(nodes);
                    if (result !== undefined) {
                      setPreviewExample(result);
                      appendLog("success", "Finished generating example");
                    } else throw new Error("Undefined output");
                  } catch (err) {
                    appendLog("error", "Failed to generate preview: " + err);
                  }
                }}
              />
            </div>
          )}

          {!activeFile && !showSchemaPreview && (
            <div className="h-full min-h-0 flex items-center justify-center p-6 text-(--text-muted) text-sm text-center bg-(--bg-primary)">
              Choose a generator or solution file to start editing.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
