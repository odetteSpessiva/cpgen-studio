import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePipelineRunner } from "../../../src/hooks/usePipelineRunner";
import type {
  ConfigState,
  SchemaNode,
  WorkspaceFile,
} from "../../../src/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("usePipelineRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the schema generator path when visual mode is selected", async () => {
    const appendLog = vi.fn();
    const mockedInvoke = vi.mocked(invoke);
    const mockedListen = vi.mocked(listen);
    mockedListen.mockResolvedValueOnce(vi.fn());
    mockedInvoke.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      usePipelineRunner(
        null,
        { path: "/tmp/sol.cpp" } as WorkspaceFile,
        "/tmp/out",
        {
          batches: 3,
          problemName: "demo",
          indexDelivery: "stdin",
        } as ConfigState,
        appendLog,
        "visual",
        [
          {
            id: "node-1",
            kind: "int",
            varName: "n",
            min: "1",
            max: "10",
          } as SchemaNode,
        ],
      ),
    );

    await act(async () => {
      await result.current.executePipeline();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("generate_tests_from_schema", {
      schema: expect.any(Array),
      config: {
        solPath: "/tmp/sol.cpp",
        outputPath: "/tmp/out",
        testName: "demo",
        testCount: 3,
      },
      seed: null,
    });
    expect(appendLog).toHaveBeenCalledWith(
      "success",
      "All tests generated and saved successfully!",
    );
  });

  it("returns a preview string from the schema preview endpoint", async () => {
    const appendLog = vi.fn();
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockResolvedValueOnce("preview-output");

    const { result } = renderHook(() =>
      usePipelineRunner(
        null,
        null,
        null,
        {
          batches: 1,
          problemName: "demo",
          indexDelivery: "stdin",
        } as ConfigState,
        appendLog,
        "files",
        [],
      ),
    );

    let preview: string | undefined;
    await act(async () => {
      preview = await result.current.previewSchema([
        { id: "n", kind: "int", varName: "x", min: "1", max: "10" },
      ]);
    });

    expect(preview).toBe("preview-output");
    expect(mockedInvoke).toHaveBeenCalledWith("preview_schema", {
      schema: expect.any(Array),
      seed: null,
    });
  });
});

describe("concurrent invocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only starts one backend run when executePipeline fires twice before the first state update commits", async () => {
    const appendLog = vi.fn();
    const mockedInvoke = vi.mocked(invoke);
    const mockedListen = vi.mocked(listen);
    mockedListen.mockResolvedValue(vi.fn());
    mockedInvoke.mockResolvedValue(undefined);

    const nodes: SchemaNode[] = [
      { id: "n", kind: "int", varName: "n", min: "1", max: "10" },
    ];

    const { result } = renderHook(() =>
      usePipelineRunner(
        null,
        { path: "/tmp/sol.cpp" } as WorkspaceFile,
        "/tmp/out",
        {
          batches: 3,
          problemName: "demo",
          indexDelivery: "stdin",
        } as ConfigState,
        appendLog,
        "visual",
        nodes,
      ),
    );

    await act(async () => {
      const first = result.current.executePipeline();
      const second = result.current.executePipeline();
      await Promise.all([first, second]);
    });

    const backendCalls = mockedInvoke.mock.calls.filter(
      ([command]) => command === "generate_tests_from_schema",
    );
    expect(backendCalls).toHaveLength(1);
  });
});
