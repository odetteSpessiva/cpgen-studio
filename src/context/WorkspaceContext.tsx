import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useWorkspaceFiles } from "../hooks/useWorkspace";
import type {
  GeneratorMode,
  SchemaNode,
  WorkspaceFile,
  WorkspaceFilePayload,
  WorkspaceSlot,
} from "../types";
import { useConsoleLogsContext } from "./ConsoleLogsContext";

interface WorkspaceFilesContextValue {
  generatorFile: WorkspaceFile | null;
  solutionFile: WorkspaceFile | null;
  generatorPath: string;
  solutionPath: string;
  outputPath: string;
  activeFileSlot: WorkspaceSlot | null;
  activeFile: WorkspaceFile | null;
  generatorMode: GeneratorMode;
  nodes: SchemaNode[];
  setNodes: (
    value: SchemaNode[] | ((prevState: SchemaNode[]) => SchemaNode[]),
  ) => void;
  setGeneratorMode: (mode: GeneratorMode) => void;
  setGeneratorPath: (path: string) => void;
  setSolutionPath: (path: string) => void;
  setOutputPath: (path: string) => void;
  setActiveFileSlot: (slot: WorkspaceSlot | null) => void;
  setWorkspaceFile: (
    slot: WorkspaceSlot,
    payload: WorkspaceFilePayload | null,
  ) => void;
  loadWorkspaceFile: (slot: WorkspaceSlot, path: string) => Promise<void>;
  browseWorkspaceFile: (slot: WorkspaceSlot) => Promise<void>;
  browseDirectory: (setter: (path: string) => void) => Promise<void>;
  handleCodeChange: (path: string, newValue: string) => void;
  saveActiveFile: (contentOverride?: string) => Promise<boolean>;
  setIsDirty: (path: string, isDirty: boolean) => void;
  handleSaveSchema: () => void;
  handleLoadSchema: () => void;
}

const WorkspaceFilesContext = createContext<WorkspaceFilesContextValue | null>(
  null,
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { appendLog } = useConsoleLogsContext();
  const value = useWorkspaceFiles(appendLog);

  return (
    <WorkspaceFilesContext.Provider value={value}>
      {children}
    </WorkspaceFilesContext.Provider>
  );
}

export function useWorkspaceContext() {
  const ctx = useContext(WorkspaceFilesContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceContext must be used within a WorkspaceProvider",
    );
  }
  return ctx;
}
