import Editor from "@monaco-editor/react";
import { useState } from "react";
import { useConsoleLogsContext } from "../context/ConsoleLogsContext";
import { usePipelineContext } from "../context/PipelineContext";
import { useSettingsContext } from "../context/SettingsContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import { useMonacoEditor } from "../hooks/useMonacoEditor";
import SchemaPreviewPanel from "./schema/SchemaPreviewPanel";

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

const TAB_CLASS =
  "flex items-center min-w-0 max-w-[200px] px-3.5 border-0 border-b-2 text-[13px] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const TAB_INACTIVE_CLASS =
  "border-transparent text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary)";
const TAB_ACTIVE_CLASS =
  "border-(--accent) text-(--text-primary) bg-(--bg-primary)";

export default function EditorPanel() {
  const {
    generatorFile,
    solutionFile,
    activeFile,
    activeFileSlot,
    setActiveFileSlot,
    handleCodeChange,
    saveActiveFile,
    setIsDirty,
    generatorMode,
    nodes,
  } = useWorkspaceContext();

  const { appendLog } = useConsoleLogsContext();
  const { previewSchema } = usePipelineContext();
  const { fontSize, fontFamily } = useSettingsContext();

  const { handleEditorMount } = useMonacoEditor({
    activeFile,
    handleCodeChange,
    saveActiveFile,
    setIsDirty,
  });

  const [previewExample, setPreviewExample] = useState<string | null>(null);

  const showSchemaPreview =
    generatorMode === "visual" && activeFileSlot === "generator";

  const generatorTabDisabled = generatorMode === "files" && !generatorFile;

  return (
    <section className="h-full min-w-0 min-h-0 flex flex-col overflow-hidden bg-(--bg-primary)">
      <div className="h-9.5 shrink-0 flex items-stretch gap-0.5 bg-(--bg-secondary) border-b border-(--border) px-2">
        <button
          type="button"
          className={`${TAB_CLASS} ${activeFileSlot === "generator" ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
          onClick={() => setActiveFileSlot("generator")}
          disabled={generatorTabDisabled}
        >
          {generatorMode === "visual"
            ? "Generator (Schema)"
            : (generatorFile?.name ?? "Generator")}
          {generatorMode === "files" && generatorFile?.isDirty && (
            <span className="ml-1.5">●</span>
          )}
        </button>

        <button
          type="button"
          className={`${TAB_CLASS} ${activeFileSlot === "solution" ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
          onClick={() => setActiveFileSlot("solution")}
          disabled={!solutionFile}
        >
          {solutionFile?.name ?? "Solution"}
          {solutionFile?.isDirty && <span className="ml-1.5">●</span>}
        </button>

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
