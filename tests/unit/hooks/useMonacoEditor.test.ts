import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMonacoEditor } from "../../../src/hooks/useMonacoEditor";
import type { WorkspaceFile } from "../../../src/types";
interface MockModel {
  _savedVersionId?: number;
  getValue: () => string;
  setValue: (v: string) => void;
  getAlternativeVersionId: () => number;
  getLanguageId: () => string;
  isDisposed: () => boolean;
  onDidChangeContent: (cb: () => void) => { dispose: () => void };
  // test-only helpers, not part of the real Monaco API
  __simulateUserEdit: (newValue: string) => void;
  __dispose: () => void;
  __getSetValueCallCount: () => number;
}

function createMockModel(
  initialValue: string,
  savedVersionId?: number,
  language = "cpp",
): MockModel {
  let value = initialValue;
  let versionId = 1;
  let disposed = false;
  let setValueCallCount = 0;
  const listeners = new Set<() => void>();

  return {
    _savedVersionId: savedVersionId,
    getValue: () => value,
    setValue: (v: string) => {
      setValueCallCount++;
      value = v;
      versionId++;
      listeners.forEach((l) => l());
    },
    getAlternativeVersionId: () => versionId,
    getLanguageId: () => language,
    isDisposed: () => disposed,
    onDidChangeContent: (cb) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
    __simulateUserEdit: (newValue: string) => {
      value = newValue;
      versionId++;
      listeners.forEach((l) => l());
    },
    __dispose: () => {
      disposed = true;
    },
    __getSetValueCallCount: () => setValueCallCount,
  };
}

interface MockEditorInstance {
  getModel: () => MockModel | null;
  getSelections: () => null;
  saveViewState: () => null;
  restoreViewState: (state: null) => void;
  getAction: (id: string) => { run: () => Promise<void> } | undefined;
  onDidChangeModel: (cb: () => void) => { dispose: () => void };
  onDidDispose: (cb: () => void) => void;
  addCommand: (keybinding: number, cb: () => void | Promise<void>) => void;
  __switchModel: (model: MockModel | null) => void;
  __triggerSaveCommand: () => Promise<void>;
  __triggerDispose: () => void;
}

const CTRL_S_KEYBINDING = 1 | 2; // matches monacoNs.KeyMod.CtrlCmd | monacoNs.KeyCode.KeyS below

function createMockEditorInstance(
  initialModel: MockModel | null,
  formatDocument?: () => Promise<void>,
): MockEditorInstance {
  let currentModel = initialModel;
  const modelChangeListeners = new Set<() => void>();
  const disposeListeners = new Set<() => void>();
  const commands = new Map<number, () => void | Promise<void>>();

  return {
    getModel: () => currentModel,
    getSelections: () => null,
    saveViewState: () => null,
    restoreViewState: () => {},
    getAction: (id) =>
      id === "editor.action.formatDocument" && formatDocument
        ? { run: formatDocument }
        : undefined,
    onDidChangeModel: (cb) => {
      modelChangeListeners.add(cb);
      return { dispose: () => modelChangeListeners.delete(cb) };
    },
    onDidDispose: (cb) => {
      disposeListeners.add(cb);
    },
    addCommand: (keybinding, cb) => {
      commands.set(keybinding, cb);
    },
    __switchModel: (model) => {
      currentModel = model;
      modelChangeListeners.forEach((l) => l());
    },
    __triggerSaveCommand: async () => {
      const cb = commands.get(CTRL_S_KEYBINDING);
      if (cb) await cb();
    },
    __triggerDispose: () => {
      disposeListeners.forEach((l) => l());
    },
  };
}

const monacoNs = {
  KeyMod: { CtrlCmd: 1 },
  KeyCode: { KeyS: 2 },
} as never; // shape-compatible enough for this hook's single use site

function makeActiveFile(overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    path: "/tmp/gen.cpp",
    name: "gen.cpp",
    language: "cpp",
    value: "initial content",
    isDirty: false,
    ...overrides,
  };
}

describe("useMonacoEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds the initial model on mount and reports the correct initial dirty state", () => {
    const setIsDirty = vi.fn();
    const activeFile = makeActiveFile({ isDirty: false });
    const model = createMockModel(activeFile.value);
    const editorInstance = createMockEditorInstance(model as never);

    const { result } = renderHook(() =>
      useMonacoEditor({
        activeFile,
        handleCodeChange: vi.fn(),
        saveActiveFile: vi.fn(),
        setIsDirty,
      }),
    );

    act(() => {
      result.current.handleEditorMount(editorInstance as never, monacoNs);
    });

    expect(setIsDirty).toHaveBeenCalledWith("/tmp/gen.cpp", false);
  });

  it("only call handleCodeChange if there's no edit after debounceMs", () => {
    const handleCodeChange = vi.fn();
    const activeFile = makeActiveFile();
    const model = createMockModel(activeFile.value);
    const editorInstance = createMockEditorInstance(model as never);

    const { result } = renderHook(() =>
      useMonacoEditor({
        activeFile,
        handleCodeChange,
        saveActiveFile: vi.fn(),
        setIsDirty: vi.fn(),
        debounceMs: 300,
      }),
    );

    act(() => {
      result.current.handleEditorMount(editorInstance as never, monacoNs);
    });

    act(() => {
      model.__simulateUserEdit("new content");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handleCodeChange).not.toHaveBeenCalled();
    act(() => {
      model.__simulateUserEdit("other new content");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handleCodeChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(handleCodeChange).toHaveBeenCalledWith(
      "/tmp/gen.cpp",
      "other new content",
    );
  });

  it("reports dirty state immediately on edit, without waiting for the debounce", () => {
    const setIsDirty = vi.fn();
    const activeFile = makeActiveFile({ isDirty: false });
    const model = createMockModel(activeFile.value);
    const editorInstance = createMockEditorInstance(model as never);

    const { result } = renderHook(() =>
      useMonacoEditor({
        activeFile,
        handleCodeChange: vi.fn(),
        saveActiveFile: vi.fn(),
        setIsDirty,
        debounceMs: 300,
      }),
    );

    act(() => {
      result.current.handleEditorMount(editorInstance as never, monacoNs);
    });

    setIsDirty.mockClear(); // clear the initial-bind call so we isolate the edit's effect

    act(() => {
      model.__simulateUserEdit("changed");
    });

    expect(setIsDirty).toHaveBeenCalledWith("/tmp/gen.cpp", true);
  });

  it("does not call handleCodeChange when there is no pending edit", () => {
    const handleCodeChange = vi.fn();
    const activeFile = makeActiveFile({ isDirty: false });
    const model = createMockModel(activeFile.value);
    const editorInstance = createMockEditorInstance(model as never);

    const { result } = renderHook(() =>
      useMonacoEditor({
        activeFile,
        handleCodeChange,
        saveActiveFile: vi.fn(),
        setIsDirty: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleEditorMount(editorInstance as never, monacoNs);
    });

    act(() => {
      result.current.flush();
    });

    expect(handleCodeChange).not.toHaveBeenCalled();
  });

  describe("performSave / Ctrl+S", () => {
    it("formats the document before saving when format-on-save is enabled", async () => {
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const activeFile = makeActiveFile();
      const model = createMockModel(activeFile.value);
      const formatDocument = vi.fn(async () => {
        model.__simulateUserEdit("formatted content");
      });
      const editorInstance = createMockEditorInstance(
        model as never,
        formatDocument,
      );

      const { result } = renderHook(() =>
        useMonacoEditor({
          activeFile,
          formatOnSave: true,
          handleCodeChange: vi.fn(),
          saveActiveFile,
          setIsDirty: vi.fn(),
        }),
      );

      act(() => {
        result.current.handleEditorMount(editorInstance as never, monacoNs);
      });

      await act(async () => {
        await result.current.performSave();
      });

      expect(formatDocument).toHaveBeenCalledTimes(1);
      expect(saveActiveFile).toHaveBeenCalledWith("formatted content");
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
    });

    it("publishes one model snapshot and saves that exact snapshot", async () => {
      const handleCodeChange = vi.fn();
      const setIsDirty = vi.fn();
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const activeFile = makeActiveFile({ isDirty: false });
      const model = createMockModel(activeFile.value);
      const editorInstance = createMockEditorInstance(model as never);

      const { result } = renderHook(() =>
        useMonacoEditor({
          activeFile,
          handleCodeChange,
          saveActiveFile,
          setIsDirty,
        }),
      );

      act(() => {
        result.current.handleEditorMount(editorInstance as never, monacoNs);
      });

      act(() => {
        model.__simulateUserEdit("edited via ctrl+s");
      });

      await act(async () => {
        await editorInstance.__triggerSaveCommand();
      });

      expect(handleCodeChange).toHaveBeenCalledWith(
        "/tmp/gen.cpp",
        "edited via ctrl+s",
      );
      expect(handleCodeChange).toHaveBeenCalledTimes(1);
      expect(saveActiveFile).toHaveBeenCalledWith("edited via ctrl+s");
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
      expect(setIsDirty).toHaveBeenLastCalledWith("/tmp/gen.cpp", false);
    });

    it("saves the current model value even before the debounce expires", async () => {
      const handleCodeChange = vi.fn();
      const setIsDirty = vi.fn();
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const activeFile = makeActiveFile({ isDirty: false });
      const model = createMockModel(activeFile.value);
      const editorInstance = createMockEditorInstance(model as never);

      const { result } = renderHook(() =>
        useMonacoEditor({
          activeFile,
          handleCodeChange,
          saveActiveFile,
          setIsDirty,
        }),
      );

      act(() => {
        result.current.handleEditorMount(editorInstance as never, monacoNs);
      });

      act(() => {
        model.__simulateUserEdit("unsaved edit");
      });

      await act(async () => {
        await editorInstance.__triggerSaveCommand();
      });

      expect(handleCodeChange).toHaveBeenCalledWith(
        "/tmp/gen.cpp",
        "unsaved edit",
      );
      expect(handleCodeChange).toHaveBeenCalledTimes(1);
      expect(saveActiveFile).toHaveBeenCalledWith("unsaved edit");
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
      expect(setIsDirty).toHaveBeenLastCalledWith("/tmp/gen.cpp", false);

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(handleCodeChange).toHaveBeenCalledTimes(1);
    });

    it("does not replace the Monaco model when save state rerenders with the same content", async () => {
      const handleCodeChange = vi.fn();
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const activeFile = makeActiveFile({ isDirty: true });
      const model = createMockModel(activeFile.value);
      const editorInstance = createMockEditorInstance(model as never);

      const { result, rerender } = renderHook(
        (props: { activeFile: WorkspaceFile }) =>
          useMonacoEditor({
            activeFile: props.activeFile,
            handleCodeChange,
            saveActiveFile,
            setIsDirty: vi.fn(),
          }),
        { initialProps: { activeFile } },
      );

      act(() => {
        result.current.handleEditorMount(editorInstance as never, monacoNs);
        model.__simulateUserEdit("saved content");
      });

      await act(async () => {
        await result.current.performSave();
      });

      const setValueCallsAfterSave = model.__getSetValueCallCount();
      rerender({
        activeFile: makeActiveFile({
          value: "saved content",
          isDirty: false,
        }),
      });

      expect(model.getValue()).toBe("saved content");
      expect(model.__getSetValueCallCount()).toBe(setValueCallsAfterSave);
    });

    it("does not mark the file clean if saveActiveFile resolves false", async () => {
      const setIsDirty = vi.fn();
      const saveActiveFile = vi.fn().mockResolvedValue(false);
      const activeFile = makeActiveFile();
      const model = createMockModel(activeFile.value);
      const editorInstance = createMockEditorInstance(model as never);

      const { result } = renderHook(() =>
        useMonacoEditor({
          activeFile,
          handleCodeChange: vi.fn(),
          saveActiveFile,
          setIsDirty,
        }),
      );

      act(() => {
        result.current.handleEditorMount(editorInstance as never, monacoNs);
      });

      setIsDirty.mockClear();

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.performSave();
      });

      expect(success).toBe(false);
      expect(setIsDirty).not.toHaveBeenCalledWith(expect.anything(), false);
    });

    it("returns false and does not throw if saveActiveFile rejects", async () => {
      const appendLog = vi.fn();
      const saveActiveFile = vi.fn().mockRejectedValue(new Error("disk full"));
      const activeFile = makeActiveFile();
      const model = createMockModel(activeFile.value);
      const editorInstance = createMockEditorInstance(model as never);

      const { result } = renderHook(() =>
        useMonacoEditor({
          activeFile,
          appendLog,
          handleCodeChange: vi.fn(),
          saveActiveFile,
          setIsDirty: vi.fn(),
        }),
      );

      act(() => {
        result.current.handleEditorMount(editorInstance as never, monacoNs);
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.performSave();
      });

      expect(success).toBe(false);
      expect(appendLog).toHaveBeenCalledWith(
        "error",
        "Failed to save active file: Error: disk full",
      );
    });
  });

  it("applies an external value change to the model without re-triggering handleCodeChange", () => {
    const handleCodeChange = vi.fn();
    const setIsDirty = vi.fn();
    const activeFile = makeActiveFile({ value: "v1", isDirty: false });
    const model = createMockModel(activeFile.value);
    const editorInstance = createMockEditorInstance(model as never);

    const { result, rerender } = renderHook(
      (props: { activeFile: WorkspaceFile }) =>
        useMonacoEditor({
          activeFile: props.activeFile,
          handleCodeChange,
          saveActiveFile: vi.fn(),
          setIsDirty,
        }),
      { initialProps: { activeFile } },
    );

    act(() => {
      result.current.handleEditorMount(editorInstance as never, monacoNs);
    });

    handleCodeChange.mockClear();

    // Simulate the file's value changing from OUTSIDE the editor.
    rerender({
      activeFile: makeActiveFile({ value: "v2 from outside", isDirty: false }),
    });

    expect(model.getValue()).toBe("v2 from outside");
    // This was a programmatic update => must not loop back through handleCodeChange as if the user had typed it.
    expect(handleCodeChange).not.toHaveBeenCalled();
  });

  it("rebinds to the new model when the editor switches models", () => {
    const setIsDirty = vi.fn();
    const fileA = makeActiveFile({
      path: "/tmp/a.cpp",
      value: "A content",
      isDirty: false,
    });
    const modelA = createMockModel(fileA.value);
    const editorInstance = createMockEditorInstance(modelA as never);

    const { result, rerender } = renderHook(
      (props: { activeFile: WorkspaceFile }) =>
        useMonacoEditor({
          activeFile: props.activeFile,
          handleCodeChange: vi.fn(),
          saveActiveFile: vi.fn(),
          setIsDirty,
        }),
      { initialProps: { activeFile: fileA } },
    );

    act(() => {
      result.current.handleEditorMount(editorInstance as never, monacoNs);
    });

    setIsDirty.mockClear();

    const fileB = makeActiveFile({
      path: "/tmp/b.cpp",
      value: "B content",
      isDirty: false,
    });
    const modelB = createMockModel(fileB.value);

    rerender({ activeFile: fileB });
    editorInstance.__switchModel(modelB as never);

    act(() => {
      modelB.__simulateUserEdit("B content edited");
    });

    expect(setIsDirty).toHaveBeenCalledWith("/tmp/b.cpp", true);
  });
});
