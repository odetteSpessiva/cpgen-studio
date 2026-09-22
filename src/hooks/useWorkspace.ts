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

const SLOTS: WorkspaceSlot[] = ["generator", "solution"];

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

  const requestOwnerRef = useRef<Record<WorkspaceSlot, string>>({
    generator: savedState.generatorPath,
    solution: savedState.solutionPath,
  });

  const pendingSelfWriteRef = useRef<Set<string>>(new Set());

  function markPendingSelfWrite(path: string) {
    pendingSelfWriteRef.current.add(path);
    setTimeout(() => pendingSelfWriteRef.current.delete(path), 10000);
  }

  const [openFiles, setOpenFiles] = useState<Map<string, WorkspaceFile>>(
    new Map(),
  );
  const [activePath, setActivePath] = useState<string | null>(null);
  const [slotPaths, setSlotPaths] = useState<Record<WorkspaceSlot, string>>({
    generator: savedState.generatorPath,
    solution: savedState.solutionPath,
  });

  const [outputPath, setOutputPath] = useState(savedState.outputPath);
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

  const generatorFile = openFiles.get(slotPaths.generator) ?? null;
  const solutionFile = openFiles.get(slotPaths.solution) ?? null;
  const generatorPath = slotPaths.generator;
  const solutionPath = slotPaths.solution;
  const activeFileSlot: WorkspaceSlot | null =
    activePath !== null && activePath === slotPaths.generator
      ? "generator"
      : activePath !== null && activePath === slotPaths.solution
        ? "solution"
        : null;
  const activeFile = activePath ? (openFiles.get(activePath) ?? null) : null;

  const openFile = (file: WorkspaceFile) => {
    setOpenFiles((prev) => {
      const next = new Map(prev);
      next.set(file.path, file);
      return next;
    });
  };

  const closeFileIfUnreferenced = (
    path: string,
    slotPathsSnapshot: Record<WorkspaceSlot, string>,
  ) => {
    const stillReferenced = SLOTS.some((s) => slotPathsSnapshot[s] === path);
    if (path && !stillReferenced) {
      setOpenFiles((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const assignSlot = (slot: WorkspaceSlot, path: string) => {
    setSlotPaths((prev) => ({ ...prev, [slot]: path }));
  };

  const updateFileByPath = (
    path: string,
    update: (file: WorkspaceFile) => WorkspaceFile,
  ) => {
    setOpenFiles((prev) => {
      const file = prev.get(path);
      if (!file) return prev;
      const next = new Map(prev);
      next.set(path, update(file));
      return next;
    });
  };

  const setWorkspaceFile = (
    slot: WorkspaceSlot,
    payload: WorkspaceFilePayload | null,
  ) => {
    if (!payload) {
      const previousPath = slotPaths[slot];
      assignSlot(slot, "");
      closeFileIfUnreferenced(previousPath, { ...slotPaths, [slot]: "" });
      setActivePath((prev) => (prev === previousPath ? null : prev));
      return;
    }

    const nextFile = buildWorkspaceFile(payload);
    openFile(nextFile);
    assignSlot(slot, nextFile.path);
    setActivePath(nextFile.path);
  };

  const loadWorkspaceFile = async (slot: WorkspaceSlot, path: string) => {
    const trimmedPath = path.trim();

    if (!trimmedPath) {
      setWorkspaceFile(slot, null);
      requestOwnerRef.current[slot] = "";
      return;
    }

    requestOwnerRef.current[slot] = trimmedPath;

    try {
      const payload = await invoke<WorkspaceFilePayload>(
        "read_workspace_file",
        { path: trimmedPath },
      );
      if (requestOwnerRef.current[slot] === payload.path)
        setWorkspaceFile(slot, payload);
    } catch (error) {
      if (requestOwnerRef.current[slot] === trimmedPath) {
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

  const setActiveFileSlot = (slot: WorkspaceSlot | null) => {
    setActivePath(slot ? slotPaths[slot] : null);
  };

  const setGeneratorPath = (path: string) => assignSlot("generator", path);
  const setSolutionPath = (path: string) => assignSlot("solution", path);

  const setIsDirty = (path: string, isDirty: boolean) =>
    updateFileByPath(path, (file) => ({ ...file, isDirty }));

  const handleCodeChange = (path: string, newValue: string) =>
    updateFileByPath(path, (file) => ({ ...file, value: newValue }));

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
    const stateToSave: StoredWorkspaceState = {
      generatorPath: slotPaths.generator,
      solutionPath: slotPaths.solution,
      outputPath,
      activeFileSlot,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [slotPaths, outputPath, activeFileSlot]);

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
          openFile(buildWorkspaceFile(payload));
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
          openFile(buildWorkspaceFile(payload));
        } catch {
          appendLog(
            "dim",
            `Could not restore solution file: ${savedState.solutionPath}`,
          );
        }
      }
    };

    restoreFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedState.generatorPath, savedState.solutionPath, appendLog]);

  useEffect(() => {
    const unlisten = listen<string>("file-changed", async (event) => {
      const changedPath = event.payload;

      if (pendingSelfWriteRef.current.has(changedPath)) {
        pendingSelfWriteRef.current.delete(changedPath);
        return;
      }

      if (!openFiles.has(changedPath)) return;

      try {
        const payload = await invoke<WorkspaceFilePayload>(
          "read_workspace_file",
          {
            path: changedPath,
          },
        );
        openFile(buildWorkspaceFile(payload));
      } catch (error) {
        appendLog("error", `Failed to reload ${changedPath}: ${String(error)}`);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, appendLog]);

  const watchedPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentPaths = new Set(openFiles.keys());
    const previouslyWatched = watchedPathsRef.current;

    for (const path of currentPaths) {
      if (!previouslyWatched.has(path)) {
        invoke("watch_file", { path });
      }
    }
    for (const path of previouslyWatched) {
      if (!currentPaths.has(path)) {
        invoke("unwatch_file", { path });
      }
    }

    watchedPathsRef.current = currentPaths;
  }, [openFiles]);

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
