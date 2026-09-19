import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { inferLanguage } from "../utils/language";

import type {
  GeneratorMode,
  LogLevel,
  SchemaNode,
  WorkspaceFile,
  WorkspaceFilePayload,
  WorkspaceSlot,
} from "../types";

const STORAGE_KEY = "cpgen_workspace_state";
const STORAGE_KEY_SCHEMA = "cpgen_schema_nodes";

interface StoredWorkspaceState {
  generatorPath: string;
  solutionPath: string;
  outputPath: string;
  activeFileSlot: WorkspaceSlot | null;
}

interface SchemaLoadPayload {
  path: string;
  contents: string;
}

const buildWorkspaceFile = (payload: WorkspaceFilePayload): WorkspaceFile => ({
  path: payload.path,
  name: payload.name,
  language: payload.language || inferLanguage(payload.name),
  value: payload.value,
  isDirty: false,
});

const DEFAULT_NODES: SchemaNode[] = [
  {
    id: crypto.randomUUID(),
    kind: "int",
    varName: "N",
    min: "1",
    max: "200",
  },
  {
    id: crypto.randomUUID(),
    kind: "loop",
    count: "N",
    children: [
      {
        id: crypto.randomUUID(),
        kind: "array",
        varName: "A",
        length: "N",
        separator: "space",
        element: {
          kind: "string",
          length: "10",
          charset: "alphanumeric",
        },
        unique: false,
      },
    ],
  },
];

export function useWorkspaceFiles(
  appendLog: (level: LogLevel, message: string) => void,
) {
  const initialWorkspaceState = (): StoredWorkspaceState => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to parse workspace state", e);
    }
    return {
      generatorPath: "",
      solutionPath: "",
      outputPath: "",
      activeFileSlot: null,
    };
  };

  const [savedState] = useState<StoredWorkspaceState>(initialWorkspaceState);

  const fileRef = useRef<Record<WorkspaceSlot, string>>({
    generator: savedState.generatorPath,
    solution: savedState.solutionPath,
  });

  const pendingSelfWriteRef = useRef<Set<string>>(new Set());

  function markPendingSelfWrite(path: string) {
    pendingSelfWriteRef.current.add(path);
    setTimeout(() => pendingSelfWriteRef.current.delete(path), 10000);
  }

  const [generatorFile, setGeneratorFile] = useState<WorkspaceFile | null>(
    null,
  );
  const [solutionFile, setSolutionFile] = useState<WorkspaceFile | null>(null);
  const [generatorPath, setGeneratorPath] = useState(savedState.generatorPath);
  const [solutionPath, setSolutionPath] = useState(savedState.solutionPath);
  const [outputPath, setOutputPath] = useState(savedState.outputPath);
  const [activeFileSlot, setActiveFileSlot] = useState<WorkspaceSlot | null>(
    savedState.activeFileSlot,
  );

  const [generatorMode, setGeneratorMode] = useState<GeneratorMode>("files");

  const [nodes, setNodes] = useState<SchemaNode[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCHEMA);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to parse saved schema nodes", e);
    }
    return DEFAULT_NODES;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SCHEMA, JSON.stringify(nodes));
  }, [nodes]);

  useEffect(() => {
    const stateToSave: StoredWorkspaceState = {
      generatorPath,
      solutionPath,
      outputPath,
      activeFileSlot,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [generatorPath, solutionPath, outputPath, activeFileSlot]);

  useEffect(() => {
    const restoreFiles = async () => {
      if (savedState.generatorPath) {
        try {
          const payload = await invoke<WorkspaceFilePayload>(
            "read_workspace_file",
            {
              path: savedState.generatorPath,
            },
          );
          setGeneratorFile(buildWorkspaceFile(payload));
        } catch {
          appendLog(
            "dim",
            `Could not restore generator file: ${savedState.generatorPath}`,
          );
        }
      }

      if (savedState.solutionPath) {
        try {
          const payload = await invoke<WorkspaceFilePayload>(
            "read_workspace_file",
            {
              path: savedState.solutionPath,
            },
          );
          setSolutionFile(buildWorkspaceFile(payload));
        } catch {
          appendLog(
            "dim",
            `Could not restore solution file: ${savedState.solutionPath}`,
          );
        }
      }
    };

    restoreFiles();
  }, [savedState.generatorPath, savedState.solutionPath, appendLog]);

  const activeFile =
    activeFileSlot === "generator"
      ? generatorFile
      : activeFileSlot === "solution"
        ? solutionFile
        : null;

  // Small helpers so the generator/solution branches below aren't repeated
  // for every operation (set, load, save, edit, ...).
  const setFile = (slot: WorkspaceSlot, file: WorkspaceFile | null) =>
    slot === "generator" ? setGeneratorFile(file) : setSolutionFile(file);

  const setPath = (slot: WorkspaceSlot, path: string) =>
    slot === "generator" ? setGeneratorPath(path) : setSolutionPath(path);

  const updateFileByPath = (
    path: string,
    update: (file: WorkspaceFile) => WorkspaceFile,
  ) => {
    setGeneratorFile((prev) =>
      prev && prev.path === path ? update(prev) : prev,
    );
    setSolutionFile((prev) =>
      prev && prev.path === path ? update(prev) : prev,
    );
  };

  const setWorkspaceFile = (
    slot: WorkspaceSlot,
    payload: WorkspaceFilePayload | null,
  ) => {
    if (!payload) {
      setFile(slot, null);
      setPath(slot, "");
      setActiveFileSlot((prev) => (prev === slot ? null : prev));
      return;
    }

    const nextFile = buildWorkspaceFile(payload);
    setFile(slot, nextFile);
    setPath(slot, nextFile.path);
    setActiveFileSlot(slot);
  };

  const loadWorkspaceFile = async (slot: WorkspaceSlot, path: string) => {
    const trimmedPath = path.trim();

    if (!trimmedPath) {
      setWorkspaceFile(slot, null);
      fileRef.current[slot] = "";
      return;
    }

    fileRef.current[slot] = trimmedPath;

    try {
      const payload = await invoke<WorkspaceFilePayload>(
        "read_workspace_file",
        { path: trimmedPath },
      );
      if (fileRef.current[slot] == payload.path)
        setWorkspaceFile(slot, payload);
    } catch (error) {
      if (fileRef.current[slot] === trimmedPath) {
        appendLog("error", `Could not open ${trimmedPath}: ${String(error)}`);
      }
    }
  };

  const browseWorkspacePath = async (slot: WorkspaceSlot) => {
    try {
      const payload = await invoke<WorkspaceFilePayload | null>(
        "pick_workspace_file",
      );
      if (payload) setWorkspaceFile(slot, payload);
    } catch (error) {
      appendLog("error", `File picker failed: ${String(error)}`);
    }
  };

  const browseDirectory = async (setter: (path: string) => void) => {
    try {
      const selectedDir = await invoke<string | null>("pick_directory");
      if (selectedDir) setter(selectedDir);
    } catch (error) {
      appendLog("error", `Directory picker failed: ${String(error)}`);
    }
  };

  const setIsDirty = (path: string, isDirty: boolean) =>
    updateFileByPath(path, (file) => ({ ...file, isDirty }));

  const handleCodeChange = (path: string, newValue: string) => {
    setGeneratorFile((prev) =>
      prev && prev.path === path ? { ...prev, value: newValue } : prev,
    );
    setSolutionFile((prev) =>
      prev && prev.path === path ? { ...prev, value: newValue } : prev,
    );
  };

  const saveActiveFile = async (contentOverride?: string): Promise<boolean> => {
    const fileToSave = activeFile;
    if (!fileToSave) return false;
    const content = contentOverride ?? fileToSave.value;

    try {
      markPendingSelfWrite(fileToSave.path);
      await invoke("save_workspace_file", {
        path: fileToSave.path,
        content,
      });
      updateFileByPath(fileToSave.path, (file) => ({
        ...file,
        value: content,
        isDirty: false,
      }));
      appendLog("info", `Saved ${fileToSave.name}`);
      return true;
    } catch (error) {
      appendLog("error", `Failed to save ${fileToSave.name}: ${String(error)}`);
      return false;
    }
  };

  const handleSaveSchema = async () => {
    try {
      const path = await invoke("save_file", {
        contents: JSON.stringify(nodes, null, 2),
      });
      if (path) appendLog("info", `Saved schema to ${path}`);
    } catch (error) {
      appendLog("error", `Failed to save schema: ${String(error)}`);
    }
  };

  const handleLoadSchema = async () => {
    try {
      const payload = await invoke<SchemaLoadPayload | null>(
        "load_schema_file",
      );
      if (!payload) return;

      const parsed = JSON.parse(payload.contents) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Invalid schema format: expected a top-level array");
      }

      setNodes(parsed as SchemaNode[]);
      appendLog("info", `Loaded schema from ${payload.path}`);
    } catch (error) {
      appendLog("error", `Failed to load schema: ${String(error)}`);
    }
  };

  useEffect(() => {
    const unlisten = listen<string>("file-changed", async (event) => {
      const changedPath = event.payload;

      if (pendingSelfWriteRef.current.has(changedPath)) {
        pendingSelfWriteRef.current.delete(changedPath);
        return;
      }

      const affectedSlots: WorkspaceSlot[] = [
        ...(changedPath === generatorPath ? (["generator"] as const) : []),
        ...(changedPath === solutionPath ? (["solution"] as const) : []),
      ];
      if (affectedSlots.length === 0) return;

      try {
        const payload = await invoke<WorkspaceFilePayload>(
          "read_workspace_file",
          {
            path: changedPath,
          },
        );
        affectedSlots.forEach((slot) => setWorkspaceFile(slot, payload));
      } catch (error) {
        appendLog("error", `Failed to reload ${changedPath}: ${String(error)}`);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [generatorPath, solutionPath, appendLog]);

  useEffect(() => {
    if (!generatorPath) return;
    invoke("watch_file", { path: generatorPath });
    return () => {
      if (generatorPath !== solutionPath)
        invoke("unwatch_file", { path: generatorPath });
    };
  }, [generatorPath, solutionPath]);

  useEffect(() => {
    if (!solutionPath) return;
    invoke("watch_file", { path: solutionPath });
    return () => {
      if (generatorPath !== solutionPath)
        invoke("unwatch_file", { path: solutionPath });
    };
  }, [generatorPath, solutionPath]);

  return {
    generatorFile,
    solutionFile,
    generatorPath,
    solutionPath,
    outputPath,
    activeFileSlot,
    activeFile,
    generatorMode,
    nodes,
    setNodes,
    setGeneratorMode,
    setGeneratorPath,
    setSolutionPath,
    setOutputPath,
    setActiveFileSlot,
    setWorkspaceFile,
    loadWorkspaceFile,
    browseWorkspaceFile: browseWorkspacePath,
    browseDirectory,
    handleCodeChange,
    saveActiveFile,
    setIsDirty,
    handleSaveSchema,
    handleLoadSchema,
  };
}
