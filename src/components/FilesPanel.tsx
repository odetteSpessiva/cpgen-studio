import { useWorkspaceContext } from "../context/WorkspaceContext";
import type { GeneratorMode } from "../types";
import ParametersForm from "./ParametersForm";
import PathPicker from "./PathPicker";
import VisualSchemaBuilder from "./schema/VisualSchemaBuilder";

const TABS: { id: GeneratorMode; label: string }[] = [
  { id: "files", label: "Code Files" },
  { id: "visual", label: "Visual Builder" },
];

export default function FilesPanel() {
  const {
    slotPaths,
    assignSlot,
    outputPath,
    generatorMode,
    setGeneratorMode,
    setOutputPath,
    loadWorkspaceFile,
    browseWorkspaceFile,
    browseDirectory,
    setWorkspaceFile,
  } = useWorkspaceContext();

  // Shared by both tabs, so it's built once instead of duplicated per-branch.
  const solutionAndOutputPickers = (
    <>
      <PathPicker
        label="Solution file"
        path={slotPaths.solution}
        placeholder="C:\path\to\solution.cpp"
        onChange={(path) => assignSlot("solution", path)}
        onSubmit={(path) => loadWorkspaceFile("solution", path)}
        onBrowse={() => browseWorkspaceFile("solution")}
        onClear={() => setWorkspaceFile("solution", null)}
      />

      <PathPicker
        label="Output path"
        path={outputPath}
        placeholder="C:\path\to\output"
        onChange={setOutputPath}
        onSubmit={() => {}}
        onBrowse={() => browseDirectory(setOutputPath)}
        onClear={() => setOutputPath("")}
      />
    </>
  );

  return (
    <aside className="flex flex-col h-full bg-(--bg-secondary) border-r border-(--border) text-(--text-primary) text-xs select-none">
      <div className="flex h-9.5 bg-(--bg-secondary) border-b border-(--border) px-2 gap-1 items-stretch">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex-1 flex items-center justify-center font-semibold transition-colors border-b-2 text-xs cursor-pointer ${
              generatorMode === tab.id
                ? "text-(--text-primary) border-(--accent) bg-(--bg-primary)"
                : "text-(--text-muted) border-transparent hover:text-(--text-primary) hover:bg-(--bg-tertiary)"
            }`}
            onClick={() => setGeneratorMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {generatorMode === "files" ? (
          <>
            <PathPicker
              label="Generator file"
              path={slotPaths.generator}
              placeholder="C:\path\to\generator.py"
              onChange={(path) => assignSlot("generator", path)}
              onSubmit={(path) => loadWorkspaceFile("generator", path)}
              onBrowse={() => browseWorkspaceFile("generator")}
              onClear={() => setWorkspaceFile("generator", null)}
            />
            {solutionAndOutputPickers}
            <ParametersForm />
          </>
        ) : (
          <>
            {solutionAndOutputPickers}
            <div className="h-px bg-(--border) my-3" />
            <VisualSchemaBuilder />
            <ParametersForm />
          </>
        )}
      </div>
    </aside>
  );
}
