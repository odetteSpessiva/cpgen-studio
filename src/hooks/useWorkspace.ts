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
  slotPaths: Record<WorkspaceSlot, string>;
  openFiles: Map<string, WorkspaceFile>;
  tabOrder: string[];
  outputPath: string;
  activePath: string | null;
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
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<
          Omit<StoredWorkspaceState, "openFiles">
        > & {
          openFiles?:
            Array<[string, WorkspaceFile]> | Record<string, WorkspaceFile>;
        };
        const persistedFiles = parsed.openFiles ?? [];
        const openFiles = Array.isArray(persistedFiles)
          ? new Map(persistedFiles)
          : new Map(Object.entries(persistedFiles));

        return {
          slotPaths: parsed.slotPaths ?? { generator: "", solution: "" },
          openFiles,
          tabOrder: parsed.tabOrder ?? [],
          outputPath: parsed.outputPath ?? "",
          activePath: parsed.activePath ?? null,
        };
      }
    } catch (e) {
      console.error("Failed to parse workspace state", e);
    }
    return {
      slotPaths: { generator: "", solution: "" },
      openFiles: new Map(),
      tabOrder: [],
      outputPath: "",
      activePath: null,
    };
  };
  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(false);

  const [savedState] = useState<StoredWorkspaceState>(initialWorkspaceState);

  const requestOwnerRef = useRef<Record<WorkspaceSlot, string>>({
    generator: savedState.slotPaths.generator,
    solution: savedState.slotPaths.solution,
  });

  const pendingSelfWriteRef = useRef(
    new Map<string, { expiresAt: number }>(),
  );

  function markPendingSelfWrite(path: string) {
    const expiresAt = Number.POSITIVE_INFINITY;
    pendingSelfWriteRef.current.set(path, { expiresAt });
  }

  function completePendingSelfWrite(path: string) {
    const expiresAt = Date.now() + 1000;
    pendingSelfWriteRef.current.set(path, { expiresAt });
    setTimeout(() => {
      const pending = pendingSelfWriteRef.current.get(path);
      if (pending?.expiresAt === expiresAt) {
        pendingSelfWriteRef.current.delete(path);
      }
    }, 10000);
  }

  const [openFiles, setOpenFiles] = useState<Map<string, WorkspaceFile>>(
    savedState.openFiles,
  );
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const appendLogRef = useRef(appendLog);
  appendLogRef.current = appendLog;
  const [activePath, setActivePath] = useState<string | null>(
    savedState.activePath,
  );
  const [slotPaths, setSlotPaths] = useState<Record<WorkspaceSlot, string>>(
    savedState.slotPaths,
  );

  const [tabOrder, setTabOrder] = useState<string[]>(savedState.tabOrder);

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

  const exportTests = async (testName: string) => {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setIsExporting(true);
    try {
      await invoke("export_tests", { testsDir: outputPath, testName });
    } catch (err) {
      appendLog("error", typeof err === "string" ? err : String(err));
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
    }
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SCHEMA, JSON.stringify(nodes));
  }, [nodes]);

  const generatorFile = openFiles.get(slotPaths.generator) ?? null;
  const solutionFile = openFiles.get(slotPaths.solution) ?? null;
  const activeFile = activePath ? (openFiles.get(activePath) ?? null) : null;

  const openFile = (file: WorkspaceFile) => {
    setOpenFiles((prev) => {
      const next = new Map(prev);
      next.set(file.path, file);
      return next;
    });
    setTabOrder((prev) =>
      prev.includes(file.path) ? prev : [...prev, file.path],
    );
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
      setTabOrder((prev) => prev.filter((p) => p !== path));
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

  const closeTab = (path: string) => {
    if (SLOTS.some((s) => slotPaths[s] === path)) return;

    const index = tabOrder.indexOf(path);
    if (index === -1) return;

    if (activePath === path) {
      const nextActive = tabOrder[index + 1] ?? tabOrder[index - 1] ?? null;
      setActivePath(nextActive);
    }

    setTabOrder((prev) => prev.filter((p) => p !== path));
    setOpenFiles((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  };

  const reorderTabs = (fromPath: string, toPath: string) => {
    setTabOrder((prev) => {
      const fromIndex = prev.indexOf(fromPath);
      const toIndex = prev.indexOf(toPath);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
        return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
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

  const openFileDialog = async () => {
    try {
      const payload = await invoke<WorkspaceFilePayload | null>(
        "pick_workspace_file",
      );
      if (!payload) return;

      const nextFile = buildWorkspaceFile(payload);
      openFile(nextFile);
      setActivePath(nextFile.path);
    } catch (error) {
      appendLog("error", `File picker failed: ${String(error)}`);
    }
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
      completePendingSelfWrite(fileToSave.path);
      updateFileByPath(fileToSave.path, (file) => ({
        ...file,
        value: content,
        isDirty: false,
      }));
      appendLog("info", `Saved ${fileToSave.name}`);
      return true;
    } catch (error) {
      pendingSelfWriteRef.current.delete(fileToSave.path);
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

  const saveGeneratedGenerator = async (
    contents: string,
    language: string,
  ): Promise<boolean> => {
    const extensionByLanguage: Record<string, string> = {
      python: "py",
      cpp: "cpp",
      "c++": "cpp",
      javascript: "js",
      typescript: "ts",
    };
    const normalizedLanguage = language.trim().toLowerCase();
    const extension = extensionByLanguage[normalizedLanguage] ?? "txt";
    const path = await invoke<string | null>("save_file", {
      contents,
      fileName: `gen.${extension}`,
      extension,
    });
    if (!path) return false;
    await loadWorkspaceFile("generator", path);
    setGeneratorMode("files");
    appendLog("success", `Saved and assigned generator: ${path}`);
    return true;
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
      slotPaths,
      openFiles,
      tabOrder,
      outputPath,
      activePath,
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...stateToSave, openFiles: [...openFiles.entries()] }),
    );
  }, [slotPaths, openFiles, tabOrder, outputPath, activePath]);

  useEffect(() => {
    const restoreFiles = async () => {
      if (savedState.slotPaths.generator) {
        try {
          const payload = await invoke<WorkspaceFilePayload>(
            "read_workspace_file",
            {
              path: savedState.slotPaths.generator,
            },
          );
          openFile(buildWorkspaceFile(payload));
        } catch {
          appendLog(
            "dim",
            `Could not restore generator file: ${savedState.slotPaths.generator}`,
          );
        }
      }

      if (savedState.slotPaths.solution) {
        try {
          const payload = await invoke<WorkspaceFilePayload>(
            "read_workspace_file",
            {
              path: savedState.slotPaths.solution,
            },
          );
          openFile(buildWorkspaceFile(payload));
        } catch {
          appendLog(
            "dim",
            `Could not restore solution file: ${savedState.slotPaths.solution}`,
          );
        }
      }
    };

    restoreFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    savedState.slotPaths.generator,
    savedState.slotPaths.solution,
    appendLog,
  ]);

  useEffect(() => {
    const unlisten = listen<string>("file-changed", async (event) => {
      const changedPath = event.payload;
      const pendingSelfWrite =
        pendingSelfWriteRef.current.get(changedPath);
      if (!openFilesRef.current.has(changedPath)) return;

      if (pendingSelfWrite) {
        return;
      }

      try {
        const payload = await invoke<WorkspaceFilePayload>(
          "read_workspace_file",
          {
            path: changedPath,
          },
        );
        const currentFile = openFilesRef.current.get(changedPath);
        if (currentFile?.value === payload.value) {
          return;
        }
        openFile(buildWorkspaceFile(payload));
      } catch (error) {
        appendLogRef.current(
          "error",
          `Failed to reload ${changedPath}: ${String(error)}`,
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const watchedPathsRef = useRef<Set<string>>(new Set());
  const openFilePaths = [...openFiles.keys()].join("\u0000");

  useEffect(() => {
    const currentPaths = new Set(
      openFilePaths ? openFilePaths.split("\u0000") : [],
    );
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
  }, [openFilePaths]);

  return {
    openFiles,
    activePath,
    setActivePath,
    slotPaths,
    assignSlot,
    tabOrder,
    closeTab,
    reorderTabs,
    generatorFile,
    solutionFile,
    activeFile,
    outputPath,
    generatorMode,
    nodes,
    setNodes,
    setGeneratorMode,
    setOutputPath,
    setWorkspaceFile,
    openFileDialog,
    loadWorkspaceFile,
    browseWorkspaceFile: browseWorkspacePath,
    browseDirectory,
    handleCodeChange,
    saveActiveFile,
    setIsDirty,
    handleSaveSchema,
    handleLoadSchema,
    saveGeneratedGenerator,
    exportTests,
    isExporting,
  };
}
