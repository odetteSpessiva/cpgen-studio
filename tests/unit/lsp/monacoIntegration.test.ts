import { invoke } from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageConnection } from "vscode-jsonrpc/browser";
import { createMessageConnection } from "vscode-jsonrpc/browser";
import { getMonaco } from "../../../src/lsp/getMonaco";
import {
  getOrStartLSP,
  invalidateLspConnection,
  registerCompletion,
  registerDiagnostics,
  registerHover,
  startLSP,
} from "../../../src/lsp/monacoIntegration";

vi.mock("../../../src/lsp/getMonaco", () => ({
  getMonaco: vi.fn(),
}));

vi.mock("../../../src/lsp/tauriTransport", () => ({
  TauriMessageReader: vi.fn(),
  TauriMessageWriter: vi.fn(),
}));

vi.mock("vscode-jsonrpc/browser", () => ({
  createMessageConnection: vi.fn(),
}));

interface FakeConnection {
  listen: ReturnType<typeof vi.fn>;
  sendRequest: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
  onNotification: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createFakeConnection(): FakeConnection {
  return {
    listen: vi.fn(),
    sendRequest: vi.fn().mockResolvedValue(null),
    sendNotification: vi.fn(),
    onNotification: vi.fn(),
    dispose: vi.fn(),
  };
}

interface FakeMonaco {
  languages: {
    registerHoverProvider: ReturnType<typeof vi.fn>;
    registerCompletionItemProvider: ReturnType<typeof vi.fn>;
    CompletionItemKind: { Text: number };
  };
  editor: {
    getModels: ReturnType<typeof vi.fn>;
    setModelMarkers: ReturnType<typeof vi.fn>;
  };
  MarkerSeverity: {
    Error: number;
    Warning: number;
    Info: number;
    Hint: number;
  };
}

function createFakeMonaco(): FakeMonaco {
  return {
    languages: {
      registerHoverProvider: vi.fn(
        (_language: string, provider: unknown) => provider,
      ),
      registerCompletionItemProvider: vi.fn(
        (_language: string, provider: unknown) => provider,
      ),
      CompletionItemKind: { Text: 18 },
    },
    editor: {
      getModels: vi.fn(() => []),
      setModelMarkers: vi.fn(),
    },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  };
}

function createFakeModel(uri: string): Monaco.editor.ITextModel {
  return {
    uri: { toString: () => uri },
    getWordUntilPosition: () => ({ startColumn: 3, endColumn: 7 }),
  } as never;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(createMessageConnection).mockReset();
  vi.mocked(getMonaco).mockReset();
});

describe("startLSP", () => {
  it("starts the backend LSP process and completes the initialize handshake", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const fakeConnection = createFakeConnection();
    vi.mocked(createMessageConnection).mockReturnValue(
      fakeConnection as unknown as MessageConnection,
    );

    const connection = await startLSP("python", "file:///workspace");

    expect(invoke).toHaveBeenCalledWith("lsp_start", { language: "python" });
    expect(fakeConnection.listen).toHaveBeenCalledTimes(1);
    expect(fakeConnection.sendRequest).toHaveBeenCalledWith("initialize", {
      processId: null,
      rootUri: "file:///workspace",
      capabilities: {},
      initializationOptions: undefined,
    });
    expect(fakeConnection.sendNotification).toHaveBeenCalledWith(
      "initialized",
      {},
    );
    expect(connection).toBe(fakeConnection);
  });

  it("passes a clangd target-triple fallback flag for cpp when the backend resolves one", async () => {
    vi.mocked(invoke).mockResolvedValue("x86_64-pc-linux-gnu");
    const fakeConnection = createFakeConnection();
    vi.mocked(createMessageConnection).mockReturnValue(
      fakeConnection as unknown as MessageConnection,
    );

    await startLSP("cpp", "file:///workspace");

    expect(fakeConnection.sendRequest).toHaveBeenCalledWith(
      "initialize",
      expect.objectContaining({
        initializationOptions: {
          fallbackFlags: ["--target=x86_64-pc-linux-gnu"],
        },
      }),
    );
  });

  it("omits initializationOptions for cpp when no target triple is available", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const fakeConnection = createFakeConnection();
    vi.mocked(createMessageConnection).mockReturnValue(
      fakeConnection as unknown as MessageConnection,
    );

    await startLSP("cpp", "file:///workspace");

    expect(fakeConnection.sendRequest).toHaveBeenCalledWith(
      "initialize",
      expect.objectContaining({ initializationOptions: undefined }),
    );
  });
});

describe("getOrStartLSP", () => {
  it("reuses the cached connection instead of starting a second one", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const fakeMonaco = createFakeMonaco();
    vi.mocked(getMonaco).mockResolvedValue(fakeMonaco as never);
    const fakeConnection = createFakeConnection();
    vi.mocked(createMessageConnection).mockReturnValue(
      fakeConnection as unknown as MessageConnection,
    );

    const first = await getOrStartLSP("cache-hit-lang", "file:///workspace");
    const second = await getOrStartLSP("cache-hit-lang", "file:///workspace");

    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fakeMonaco.languages.registerHoverProvider).toHaveBeenCalledTimes(1);
    expect(
      fakeMonaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledTimes(1);
  });

  it("registers diagnostics against the freshly started connection", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const fakeMonaco = createFakeMonaco();
    vi.mocked(getMonaco).mockResolvedValue(fakeMonaco as never);
    const fakeConnection = createFakeConnection();
    vi.mocked(createMessageConnection).mockReturnValue(
      fakeConnection as unknown as MessageConnection,
    );

    await getOrStartLSP("diagnostics-lang", "file:///workspace");
    await vi.waitFor(() =>
      expect(fakeConnection.onNotification).toHaveBeenCalledWith(
        "textDocument/publishDiagnostics",
        expect.any(Function),
      ),
    );
  });

  it("starts a new connection without re-registering hover/completion after invalidation", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const fakeMonaco = createFakeMonaco();
    vi.mocked(getMonaco).mockResolvedValue(fakeMonaco as never);
    const firstConnection = createFakeConnection();
    const secondConnection = createFakeConnection();
    vi.mocked(createMessageConnection)
      .mockReturnValueOnce(firstConnection as unknown as MessageConnection)
      .mockReturnValueOnce(secondConnection as unknown as MessageConnection);

    await getOrStartLSP("reconnect-lang", "file:///workspace");
    await invalidateLspConnection("reconnect-lang");
    const reconnected = await getOrStartLSP(
      "reconnect-lang",
      "file:///workspace",
    );

    expect(firstConnection.dispose).toHaveBeenCalledTimes(1);
    expect(reconnected).toBe(secondConnection);
    expect(invoke).toHaveBeenCalledTimes(2);
    // Hover/completion providers stay bound to the same connectionRef, so
    // they should only ever be registered once even across reconnects.
    expect(fakeMonaco.languages.registerHoverProvider).toHaveBeenCalledTimes(1);
    expect(
      fakeMonaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateLspConnection", () => {
  it("does nothing when no connection has been started for the language", async () => {
    await expect(
      invalidateLspConnection("never-started-lang"),
    ).resolves.toBeUndefined();
  });

  it("swallows an error thrown while disposing the old connection", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    vi.mocked(getMonaco).mockResolvedValue(createFakeMonaco() as never);
    const fakeConnection = createFakeConnection();
    fakeConnection.dispose.mockImplementation(() => {
      throw new Error("dispose failed");
    });
    vi.mocked(createMessageConnection).mockReturnValue(
      fakeConnection as unknown as MessageConnection,
    );

    await getOrStartLSP("dispose-fails-lang", "file:///workspace");

    await expect(
      invalidateLspConnection("dispose-fails-lang"),
    ).resolves.toBeUndefined();
    expect(fakeConnection.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("registerHover", () => {
  function setup(sendRequestResult: unknown) {
    const fakeMonaco = createFakeMonaco();
    const connection = createFakeConnection();
    connection.sendRequest.mockResolvedValue(sendRequestResult);
    const ref = {
      current: Promise.resolve(connection as unknown as MessageConnection),
      invalidated: false,
    };
    registerHover(fakeMonaco as never, ref, "cpp");
    const provider = fakeMonaco.languages.registerHoverProvider.mock.results[0]
      .value as Monaco.languages.HoverProvider;
    return { connection, provider };
  }

  it("returns null when the server has no hover contents", async () => {
    const { provider } = setup(null);
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideHover!(
      model,
      { lineNumber: 3, column: 5 } as never,
      {} as never,
      {} as never,
    );

    expect(result).toBeNull();
  });

  it("sends a 0-indexed textDocument/hover request for the model's LSP uri", async () => {
    const { connection, provider } = setup(null);
    const model = createFakeModel("file:///main.cpp");

    await provider.provideHover!(
      model,
      { lineNumber: 3, column: 5 } as never,
      {} as never,
      {} as never,
    );

    expect(connection.sendRequest).toHaveBeenCalledWith("textDocument/hover", {
      textDocument: { uri: "file:///main.cpp" },
      position: { line: 2, character: 4 },
    });
  });

  it("unwraps a plain-string hover contents value", async () => {
    const { provider } = setup({ contents: "just a string" });
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideHover!(
      model,
      { lineNumber: 1, column: 1 } as never,
      {} as never,
      {} as never,
    );

    expect(result).toEqual({ contents: [{ value: "just a string" }] });
  });

  it("unwraps a MarkupContent hover contents value", async () => {
    const { provider } = setup({
      contents: { kind: "markdown", value: "**bold**" },
    });
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideHover!(
      model,
      { lineNumber: 1, column: 1 } as never,
      {} as never,
      {} as never,
    );

    expect(result).toEqual({ contents: [{ value: "**bold**" }] });
  });

  it("joins an array of MarkedString hover contents", async () => {
    const { provider } = setup({
      contents: ["first", { language: "cpp", value: "int x;" }],
    });
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideHover!(
      model,
      { lineNumber: 1, column: 1 } as never,
      {} as never,
      {} as never,
    );

    expect(result).toEqual({ contents: [{ value: "first\n\nint x;" }] });
  });
});

describe("registerCompletion", () => {
  function setup(sendRequestResult: unknown) {
    const fakeMonaco = createFakeMonaco();
    const connection = createFakeConnection();
    connection.sendRequest.mockResolvedValue(sendRequestResult);
    const ref = {
      current: Promise.resolve(connection as unknown as MessageConnection),
      invalidated: false,
    };
    registerCompletion(fakeMonaco as never, ref, "cpp");
    const provider = fakeMonaco.languages.registerCompletionItemProvider.mock
      .results[0].value as Monaco.languages.CompletionItemProvider;
    return { connection, provider };
  }

  it("returns no suggestions when the server has nothing to offer", async () => {
    const { provider } = setup(null);
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 1, column: 1 } as never,
      {} as never,
      {} as never,
    );

    expect(result).toEqual({ suggestions: [] });
  });

  it("maps a bare CompletionItem[] result into Monaco suggestions", async () => {
    const { provider } = setup([{ label: "foo", detail: "int foo()" }]);
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 1, column: 5 } as never,
      {} as never,
      {} as never,
    );

    expect(result).toEqual({
      suggestions: [
        {
          label: "foo",
          kind: 18,
          insertText: "foo",
          detail: "int foo()",
          range: {
            startLineNumber: 1,
            endLineNumber: 1,
            startColumn: 3,
            endColumn: 7,
          },
        },
      ],
    });
  });

  it("unwraps a CompletionList result and prefers an explicit insertText", async () => {
    const { provider } = setup({
      isIncomplete: false,
      items: [{ label: "bar", insertText: "bar()" }],
    });
    const model = createFakeModel("file:///main.cpp");

    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 1, column: 5 } as never,
      {} as never,
      {} as never,
    );

    expect(result?.suggestions[0].insertText).toBe("bar()");
  });

  it("requests completions at the 0-indexed position for the model's LSP uri", async () => {
    const { connection, provider } = setup(null);
    const model = createFakeModel("file:///main.cpp");

    await provider.provideCompletionItems(
      model,
      { lineNumber: 4, column: 9 } as never,
      {} as never,
      {} as never,
    );

    expect(connection.sendRequest).toHaveBeenCalledWith(
      "textDocument/completion",
      {
        textDocument: { uri: "file:///main.cpp" },
        position: { line: 3, character: 8 },
      },
    );
  });
});

describe("registerDiagnostics", () => {
  it("converts diagnostics to 1-indexed Monaco markers on the matching model", () => {
    const fakeMonaco = createFakeMonaco();
    const model = createFakeModel("file:///main.cpp");
    fakeMonaco.editor.getModels.mockReturnValue([model]);
    const connection = createFakeConnection();

    registerDiagnostics(fakeMonaco as never, connection as never, "cpp");
    const [, handler] = connection.onNotification.mock.calls[0];

    handler({
      uri: "file:///main.cpp",
      diagnostics: [
        {
          severity: 1,
          range: {
            start: { line: 4, character: 2 },
            end: { line: 4, character: 10 },
          },
          message: "unused variable",
        },
      ],
    });

    expect(fakeMonaco.editor.setModelMarkers).toHaveBeenCalledWith(
      model,
      "cpp",
      [
        {
          severity: 8,
          startLineNumber: 5,
          startColumn: 3,
          endLineNumber: 5,
          endColumn: 11,
          message: "unused variable",
        },
      ],
    );
  });

  it("unwraps a MarkupContent diagnostic message", () => {
    const fakeMonaco = createFakeMonaco();
    const model = createFakeModel("file:///main.cpp");
    fakeMonaco.editor.getModels.mockReturnValue([model]);
    const connection = createFakeConnection();

    registerDiagnostics(fakeMonaco as never, connection as never, "cpp");
    const [, handler] = connection.onNotification.mock.calls[0];

    handler({
      uri: "file:///main.cpp",
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: { kind: "markdown", value: "**error**" },
        },
      ],
    });

    expect(fakeMonaco.editor.setModelMarkers.mock.calls[0][2][0].message).toBe(
      "**error**",
    );
  });

  it("ignores diagnostics for a uri with no open model", () => {
    const fakeMonaco = createFakeMonaco();
    fakeMonaco.editor.getModels.mockReturnValue([]);
    const connection = createFakeConnection();

    registerDiagnostics(fakeMonaco as never, connection as never, "cpp");
    const [, handler] = connection.onNotification.mock.calls[0];

    handler({ uri: "file:///missing.cpp", diagnostics: [] });

    expect(fakeMonaco.editor.setModelMarkers).not.toHaveBeenCalled();
  });
});
