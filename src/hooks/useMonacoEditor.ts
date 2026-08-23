import type { OnMount } from "@monaco-editor/react";
import { dirname } from "@tauri-apps/api/path";
import type { editor, IDisposable, Selection } from "monaco-editor";
import { useCallback, useEffect, useInsertionEffect, useRef } from "react";
import { getOrStartLSP } from "../lsp/monacoIntegration";
import type { WorkspaceFile } from "../types";

type TrackedModel = editor.ITextModel & {
  _savedVersionId?: number;
  _lspUri?: string;
};

interface UseMonacoEditorOptions {
  activeFile: WorkspaceFile | null;
  handleCodeChange: (path: string, newValue: string) => void;
  saveActiveFile: (contentOverride?: string) => Promise<boolean>;
  setIsDirty: (path: string, isDirty: boolean) => void;
  debounceMs?: number;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  // useInsertionEffect over useEffect to ensure all ref are updated before any inner function runs.
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}

async function toParentDirUri(filePath: string): Promise<string> {
  const parentDir = await dirname(filePath);
  return `file://${parentDir}`;
}
function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  return `file://${encodeURI(withLeadingSlash)}`;
}

function cleanCode(model: TrackedModel, selections: Selection[] | null) {
  const original = model.getValue();
  if (!original) return;
  const edits: editor.IIdentifiedSingleEditOperation[] = [];
  const toRange = (start: number, end: number) => ({
    startLineNumber: model.getPositionAt(start).lineNumber,
    startColumn: model.getPositionAt(start).column,
    endLineNumber: model.getPositionAt(end).lineNumber,
    endColumn: model.getPositionAt(end).column,
  });
  const trailingMatch = original.match(/\s+$/);
  const trailingMatchStart = trailingMatch?.index ?? original.length;

  for (const m of original.matchAll(/[ \t]+(?=\r?\n|$)/g)) {
    const start = m.index ?? -1;
    if (start >= 0 && start < trailingMatchStart) {
      edits.push({ range: toRange(start, start + m[0].length), text: "" });
    }
  }

  if (!trailingMatch || trailingMatch[0] !== "\n") {
    edits.push({
      range: toRange(trailingMatchStart, original.length),
      text: "\n",
    });
  }

  if (edits.length === 0) return;
  const before = selections ?? [];
  model.pushEditOperations(before, edits, () => before);
}

export function useMonacoEditor({
  activeFile,
  handleCodeChange,
  saveActiveFile,
  setIsDirty,
  debounceMs = 300,
}: UseMonacoEditorOptions) {
  const handleCodeChangeRef = useLatest(handleCodeChange);
  const saveRef = useLatest(saveActiveFile);
  const setIsDirtyRef = useLatest(setIsDirty);
  const activeFileRef = useLatest(activeFile);
  const modelRef = useRef<TrackedModel | null>(null);
  const editorRef = useRef<editor.ICodeEditor | null>(null);
  // Path the *currently bound* model corresponds to (not necessarily activeFile.path,
  // which may already have moved on by the time an async flush runs).
  const boundPathRef = useRef<string | null>(null);

  const contentSubRef = useRef<IDisposable | null>(null);
  const modelChangeSubRef = useRef<IDisposable | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O(1) per keystroke: no getValue(), no string storage. The actual string is
  // only materialized once, lazily, when flush() runs.
  const hasPendingEditRef = useRef(false);
  const isProgrammaticUpdateRef = useRef(false);

  const lastSentValueRef = useRef<string | null>(activeFile?.value ?? null);
  const lastReportedIsDirtyRef = useRef<boolean | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!hasPendingEditRef.current) return;
    hasPendingEditRef.current = false;

    if (
      !modelRef.current ||
      modelRef.current.isDisposed() ||
      !boundPathRef.current
    )
      return;

    const value = modelRef.current.getValue();
    lastSentValueRef.current = value;
    handleCodeChangeRef.current(boundPathRef.current, value);

    const model = modelRef.current;
    const language = model.getLanguageId();
    getOrStartLSP(language, "").then((connection) => {
      connection.sendNotification("textDocument/didChange", {
        textDocument: { uri: model._lspUri, version: Date.now() },
        contentChanges: [{ text: value }],
      });
    });
  }, [handleCodeChangeRef]);

  const performSave = useCallback(async (): Promise<boolean> => {
    const currentModel = modelRef.current;
    const savePath = boundPathRef.current;
    if (!currentModel || currentModel.isDisposed() || !savePath) return false;
    isProgrammaticUpdateRef.current = true;
    try {
      cleanCode(currentModel, editorRef.current?.getSelections() ?? null);
    } finally {
      isProgrammaticUpdateRef.current = false;
    }
    const liveValue = currentModel.getValue();
    flush();

    const versionAtSave = currentModel.getAlternativeVersionId();

    try {
      const success = await saveRef.current(liveValue);
      if (success && !currentModel.isDisposed()) {
        currentModel._savedVersionId = versionAtSave;
        const isStillDirty =
          currentModel.getAlternativeVersionId() !==
          currentModel._savedVersionId;
        if (boundPathRef.current === savePath) {
          lastReportedIsDirtyRef.current = isStillDirty;
        }
        setIsDirtyRef.current(savePath, isStillDirty);
      }
      return success;
    } catch (err) {
      console.error("Failed to save active file:", err);
      return false;
    }
  }, [flush, saveRef, setIsDirtyRef]);

  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;

    const bindModel = (model: TrackedModel | null) => {
      // Flush whatever was pending on the *previous* model before losing the ref to it.
      flush();

      contentSubRef.current?.dispose();
      contentSubRef.current = null;

      modelRef.current = model;
      boundPathRef.current = activeFileRef.current?.path ?? null;

      if (!model) return;
      const language = model.getLanguageId();
      const filePath = activeFileRef.current?.path;

      if (filePath) {
        (async () => {
          const rootUri = await toParentDirUri(filePath);
          const fileUri = toFileUri(filePath);
          model._lspUri = fileUri;

          const connection = await getOrStartLSP(language, rootUri);
          connection.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: fileUri,
              languageId: language,
              version: 1,
              text: model.getValue(),
            },
          });
        })().catch((err) => {
          console.error("[lsp] failed:", err);
        });
      }

      const currentFile = activeFileRef.current;

      if (model._savedVersionId === undefined && currentFile) {
        model._savedVersionId = currentFile.isDirty
          ? -1
          : model.getAlternativeVersionId();
      }

      lastSentValueRef.current = currentFile?.value ?? null;

      const isDirty =
        model._savedVersionId !== undefined &&
        model.getAlternativeVersionId() !== model._savedVersionId;
      lastReportedIsDirtyRef.current = isDirty;
      if (boundPathRef.current) {
        setIsDirtyRef.current(boundPathRef.current, isDirty);
      }

      contentSubRef.current = model.onDidChangeContent(() => {
        if (isProgrammaticUpdateRef.current) return;

        const dirty = model.getAlternativeVersionId() !== model._savedVersionId;
        if (dirty !== lastReportedIsDirtyRef.current) {
          lastReportedIsDirtyRef.current = dirty;
          if (boundPathRef.current)
            setIsDirtyRef.current(boundPathRef.current, dirty);
        }

        hasPendingEditRef.current = true;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, debounceMs);
      });
    };

    bindModel(editorInstance.getModel() as TrackedModel | null);
    modelChangeSubRef.current = editorInstance.onDidChangeModel(() => {
      bindModel(editorInstance.getModel() as TrackedModel | null);
    });

    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      async () => {
        await performSave();
      },
    );

    editorInstance.onDidDispose(() => {
      contentSubRef.current?.dispose();
      contentSubRef.current = null;
      modelChangeSubRef.current?.dispose();
      modelChangeSubRef.current = null;
      modelRef.current = null;
      boundPathRef.current = null;
    });
  };

  // Safety net: if activeFile.path changes for reasons that don't route through
  // onDidChangeModel (e.g. the file is closed), make sure nothing pending is lost.
  // flush() is a no-op unless hasPendingEditRef is set, so this stays cheap.
  useEffect(() => {
    flush();
  }, [activeFile?.path, flush]);

  useEffect(() => {
    const path = activeFile?.path;
    const value = activeFile?.value;
    const isDirty = activeFile?.isDirty;

    if (!modelRef.current || path === undefined) return;
    if (boundPathRef.current !== path) return;

    // Cheap in practice: when this update originated from our own flush(),
    // value is the exact same string reference we sent, so this
    // is a pointer check, not a character-by-character scan.
    if (value === lastSentValueRef.current) return;

    const model = modelRef.current;
    if (model.isDisposed()) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    hasPendingEditRef.current = false;

    isProgrammaticUpdateRef.current = true;
    try {
      model.setValue(value ?? "");
    } finally {
      isProgrammaticUpdateRef.current = false;
    }

    if (!isDirty) {
      model._savedVersionId = model.getAlternativeVersionId();
      lastReportedIsDirtyRef.current = false;
      setIsDirtyRef.current(path, false);
    }

    lastSentValueRef.current = value ?? null;
  }, [activeFile?.value, activeFile?.isDirty, activeFile?.path, setIsDirtyRef]);

  // Flush on complete unmount.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  return { handleEditorMount, flush, performSave };
}
