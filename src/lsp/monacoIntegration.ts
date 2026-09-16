import { invoke } from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor";
import {
  createMessageConnection,
  type MessageConnection,
} from "vscode-jsonrpc/browser";
import type {
  CompletionItem,
  CompletionList,
  Diagnostic,
  Hover,
  MarkedString,
  MarkupContent,
  TextEdit,
} from "vscode-languageserver-types";
import { getMonaco } from "./getMonaco";
import { TauriMessageReader, TauriMessageWriter } from "./tauriTransport";

type ModelWithLspUri = Monaco.editor.ITextModel & { _lspUri?: string };

function getLspUri(model: Monaco.editor.ITextModel): string {
  return (model as ModelWithLspUri)._lspUri ?? model.uri.toString();
}

function getSeverityMap(
  monaco: typeof Monaco,
): Record<number, Monaco.MarkerSeverity> {
  return {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint,
  };
}

interface ConnectionRef {
  current: Promise<MessageConnection>;
  invalidated: boolean;
}

const connectionCache = new Map<string, ConnectionRef>();

export async function startLSP(
  language: string,
  rootUri: string,
): Promise<MessageConnection> {
  const targetTriple = await invoke<string | null>("lsp_start", {
    language: language,
  });

  const connection: MessageConnection = createMessageConnection(
    new TauriMessageReader(language),
    new TauriMessageWriter(language),
  );
  connection.listen();

  await connection.sendRequest("initialize", {
    processId: null,
    rootUri,
    capabilities: {},
    initializationOptions:
      language === "cpp" && targetTriple
        ? { fallbackFlags: [`--target=${targetTriple}`] }
        : undefined,
  });
  connection.sendNotification("initialized", {});
  return connection;
}

function markedStringToText(value: MarkedString): string {
  return typeof value === "string" ? value : value.value;
}

export function registerHover(
  monaco: typeof Monaco,
  connectionPromiseRef: ConnectionRef,
  language: string,
) {
  return monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
      const connection = await connectionPromiseRef.current;
      const result = await connection.sendRequest<Hover | null>(
        "textDocument/hover",
        {
          textDocument: { uri: getLspUri(model) },
          position: {
            line: position.lineNumber - 1,
            character: position.column - 1,
          },
        },
      );
      if (!result || !result.contents) return null;
      const { contents } = result;
      const value =
        typeof contents === "string"
          ? contents
          : Array.isArray(contents)
            ? contents.map(markedStringToText).join("\n\n")
            : contents.value;
      return { contents: [{ value }] };
    },
  });
}

function diagnosticMessageToText(message: string | MarkupContent): string {
  return typeof message === "string" ? message : message.value;
}

export function registerDiagnostics(
  monaco: typeof Monaco,
  connection: MessageConnection,
  language: string,
) {
  const severityMap = getSeverityMap(monaco);
  connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: { uri: string; diagnostics: Diagnostic[] }) => {
      const model = monaco.editor
        .getModels()
        .find((m) => getLspUri(m) === params.uri);
      if (!model) return;
      const markers: Monaco.editor.IMarkerData[] = params.diagnostics.map(
        (d: Diagnostic) => ({
          severity: severityMap[d.severity ?? 1],
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          message: diagnosticMessageToText(d.message),
        }),
      );
      monaco.editor.setModelMarkers(model, language, markers);
    },
  );
}

export function registerCompletion(
  monaco: typeof Monaco,
  connectionPromiseRef: ConnectionRef,
  language: string,
) {
  return monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [".", ":", ">", '"'],
    async provideCompletionItems(model, position) {
      const connection = await connectionPromiseRef.current;
      const result = await connection.sendRequest<
        CompletionItem[] | CompletionList | null
      >("textDocument/completion", {
        textDocument: { uri: getLspUri(model) },
        position: {
          line: position.lineNumber - 1,
          character: position.column - 1,
        },
      });

      const items = Array.isArray(result) ? result : result ? result.items : [];
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: items.map((item: CompletionItem) => ({
          label: item.label,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: item.insertText ?? item.label,
          detail: item.detail,
          range,
        })),
      };
    },
  });
}

export function registerFormatting(
  monaco: typeof Monaco,
  connectionPromiseRef: ConnectionRef,
  language: string,
) {
  return monaco.languages.registerDocumentFormattingEditProvider(language, {
    async provideDocumentFormattingEdits(model) {
      const connection = await connectionPromiseRef.current;
      const result = await connection.sendRequest<TextEdit[] | null>(
        "textDocument/formatting",
        {
          textDocument: { uri: getLspUri(model) },
          options: { tabSize: 4, insertSpaces: true },
        },
      );
      if (!result) return [];
      return result.map((edit) => ({
        range: {
          startLineNumber: edit.range.start.line + 1,
          startColumn: edit.range.start.character + 1,
          endLineNumber: edit.range.end.line + 1,
          endColumn: edit.range.end.character + 1,
        },
        text: edit.newText,
      }));
    },
  });
}

export async function getOrStartLSP(
  language: string,
  rootUri: string,
): Promise<MessageConnection> {
  let ref = connectionCache.get(language);
  if (!ref || ref.invalidated) {
    const monaco = await getMonaco();
    const newPromise = startLSP(language, rootUri);
    if (!ref) {
      ref = { current: newPromise, invalidated: false };
      connectionCache.set(language, ref);
      registerHover(monaco, ref, language);
      registerCompletion(monaco, ref, language);
      registerFormatting(monaco, ref, language);
    } else {
      ref.current = newPromise;
      ref.invalidated = false;
    }
    ref.current.then((connection) =>
      registerDiagnostics(monaco, connection, language),
    );
  }
  return ref.current;
}

export async function invalidateLspConnection(language: string) {
  const ref = connectionCache.get(language);
  if (!ref) return;
  const oldPromise = ref.current;
  ref.invalidated = true;
  try {
    const connection = await oldPromise;
    connection.dispose();
  } catch {
    // connection already disposed, ignore
  }
}
