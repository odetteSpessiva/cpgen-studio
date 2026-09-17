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
  getPositionAt: (offset: number) => { lineNumber: number; column: number };
  pushEditOperations: (
    selections: unknown[],
    edits: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      text: string;
    }>,
    cursorStateComputer: (inverseEditOperations: unknown[]) => unknown,
  ) => void;
  // test-only helpers, not part of the real Monaco API
  __simulateUserEdit: (newValue: string) => void;
  __dispose: () => void;
}

function createMockModel(
  initialValue: string,
  savedVersionId?: number,
  language = "cpp",
): MockModel {
  let value = initialValue;
  let versionId = 1;
  let disposed = false;
  const listeners = new Set<() => void>();

  const getLineStartOffsets = () => {
    const offsets = [0];
    for (let index = 0; index < value.length; index++) {
      if (value[index] === "\n") offsets.push(index + 1);
    }
    return offsets;
  };

  const getOffsetAtPosition = (lineNumber: number, column: number) => {
    const lineStartOffsets = getLineStartOffsets();
    return (lineStartOffsets[lineNumber - 1] ?? value.length) + column - 1;
  };

  const getPositionAtOffset = (offset: number) => {
    const clampedOffset = Math.max(0, Math.min(offset, value.length));
    const lineStartOffsets = getLineStartOffsets();
    let lineIndex = 0;
    for (let index = 0; index < lineStartOffsets.length; index++) {
      if (lineStartOffsets[index] <= clampedOffset) lineIndex = index;
      else break;
    }
    return {
      lineNumber: lineIndex + 1,
      column: clampedOffset - lineStartOffsets[lineIndex] + 1,
    };
  };

  const applyEdits = (
    source: string,
    edits: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      text: string;
    }>,
  ) => {
    let nextValue = source;
    const sortedEdits = [...edits].sort((left, right) => {
      const leftStart = getOffsetAtPosition(
        left.range.startLineNumber,
        left.range.startColumn,
      );
      const rightStart = getOffsetAtPosition(
        right.range.startLineNumber,
        right.range.startColumn,
      );
      return rightStart - leftStart;
    });

    for (const edit of sortedEdits) {
      const startOffset = getOffsetAtPosition(
        edit.range.startLineNumber,
        edit.range.startColumn,
      );
      const endOffset = getOffsetAtPosition(
        edit.range.endLineNumber,
        edit.range.endColumn,
      );
      nextValue = `${nextValue.slice(0, startOffset)}${edit.text}${nextValue.slice(endOffset)}`;
    }

    return nextValue;
  };

  return {
    _savedVersionId: savedVersionId,
    getValue: () => value,
    setValue: (v: string) => {
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
    getPositionAt: getPositionAtOffset,
    pushEditOperations: (_selections, edits) => {
      value = applyEdits(value, edits);
      versionId++;
      listeners.forEach((listener) => listener());
    },
    __simulateUserEdit: (newValue: string) => {
      value = newValue;
      versionId++;
      listeners.forEach((l) => l());
    },
    __dispose: () => {
      disposed = true;
    },
  };
}

interface MockEditorInstance {
  getModel: () => MockModel | null;
  getSelections: () => null;
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
      const formatDocument = vi.fn().mockResolvedValue(undefined);
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const activeFile = makeActiveFile();
      const model = createMockModel(activeFile.value);
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
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
    });

    it("produces the same outcome whether triggered via Ctrl+S or by calling performSave directly", async () => {
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
        "edited via ctrl+s\n",
      );
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
      expect(setIsDirty).toHaveBeenLastCalledWith("/tmp/gen.cpp", false);
    });

    it("flushes pending edits, saves, and marks the file clean on success", async () => {
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
        "unsaved edit\n",
      );
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
      expect(setIsDirty).toHaveBeenLastCalledWith("/tmp/gen.cpp", false);
    });

    it("cleans trailing whitespace and appends a final newline before saving", async () => {
      const handleCodeChange = vi.fn();
      const setIsDirty = vi.fn();
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const activeFile = makeActiveFile({
        value: "first line   \nsecond line\t\t",
        isDirty: false,
      });
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
        model.__simulateUserEdit("first line   \nsecond line\t\t");
      });

      await act(async () => {
        await result.current.performSave();
      });

      expect(model.getValue()).toBe("first line\nsecond line\n");
      expect(handleCodeChange).toHaveBeenCalledWith(
        "/tmp/gen.cpp",
        "first line\nsecond line\n",
      );
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
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
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const saveActiveFile = vi.fn().mockRejectedValue(new Error("disk full"));
      const activeFile = makeActiveFile();
      const model = createMockModel(activeFile.value);
      const editorInstance = createMockEditorInstance(model as never);

      const { result } = renderHook(() =>
        useMonacoEditor({
          activeFile,
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to save active file:",
        expect.objectContaining({ message: "disk full" }),
      );
      consoleErrorSpy.mockRestore();
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
