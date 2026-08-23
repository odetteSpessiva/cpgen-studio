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
export async function startLSP(
  language: string,
  rootUri: string,
): Promise<MessageConnection> {
  await invoke("lsp_start", { language: language });

  const connection: MessageConnection = createMessageConnection(
    new TauriMessageReader(language),
    new TauriMessageWriter(language),
  );
  connection.listen();

  await connection.sendRequest("initialize", {
    processId: null,
    rootUri,
    capabilities: {},
  });
  connection.sendNotification("initialized", {});
  return connection;
}

function markedStringToText(value: MarkedString): string {
  return typeof value === "string" ? value : value.value;
}

export function registerHover(
  monaco: typeof Monaco,
  connection: MessageConnection,
  language: string,
) {
  console.log("[lsp] registering hover for", language);
  return monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
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
      console.log("[lsp] hover result", result);
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
        .find((m) => m.uri.toString() === params.uri);
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
  connection: MessageConnection,
  language: string,
) {
  console.log("[lsp] registering completion for", language);
  return monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [".", ":", ">", '"'],
    async provideCompletionItems(model, position) {
      const result = await connection.sendRequest<
        CompletionItem[] | CompletionList | null
      >("textDocument/completion", {
        textDocument: { uri: getLspUri(model) },
        position: {
          line: position.lineNumber - 1,
          character: position.column - 1,
        },
      });
      console.log("[lsp] completion result", result);

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

const connectionCache = new Map<string, Promise<MessageConnection>>();

export async function getOrStartLSP(
  language: string,
  rootUri: string,
): Promise<MessageConnection> {
  let cached = connectionCache.get(language);
  const monaco = await getMonaco();
  if (!cached) {
    cached = startLSP(language, rootUri).then((connection) => {
      registerHover(monaco, connection, language);
      registerDiagnostics(monaco, connection, language);
      registerCompletion(monaco, connection, language);
      return connection;
    });
    connectionCache.set(language, cached);
  }
  return cached;
}
