import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceFiles } from "../../../src/hooks/useWorkspace";
import type { WorkspaceFilePayload } from "../../../src/types";

const mockedInvoke = vi.mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useWorkspaceFiles", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    localStorage.clear();
  });

  describe("setWorkspaceFile(slot, null)", () => {
    it("clears activeFileSlot when nulling the currently active file", async () => {
      const appendLog = vi.fn();
      mockedInvoke
        .mockResolvedValueOnce({
          path: "/tmp/gen.cpp",
          name: "gen.cpp",
          language: "cpp",
          value: "generator code",
        })
        .mockResolvedValueOnce({
          path: "/tmp/sol.cpp",
          name: "sol.cpp",
          language: "cpp",
          value: "solution code",
        });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
        await result.current.loadWorkspaceFile("solution", "/tmp/sol.cpp");
      });

      expect(result.current.activeFileSlot).toBe("solution");

      act(() => {
        result.current.setWorkspaceFile("solution", null);
      });

      expect(result.current.solutionFile).toBeNull();
      expect(result.current.solutionPath).toBe("");
      expect(result.current.activeFileSlot).toBeNull();
      expect(result.current.generatorFile).not.toBeNull();
    });

    it("leaves activeFileSlot untouched when nulling a different, inactive slot", async () => {
      const appendLog = vi.fn();
      mockedInvoke
        .mockResolvedValueOnce({
          path: "/tmp/gen.cpp",
          name: "gen.cpp",
          language: "cpp",
          value: "generator code",
        })
        .mockResolvedValueOnce({
          path: "/tmp/sol.cpp",
          name: "sol.cpp",
          language: "cpp",
          value: "solution code",
        });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
        await result.current.loadWorkspaceFile("solution", "/tmp/sol.cpp");
      });

      expect(result.current.activeFileSlot).toBe("solution");

      act(() => {
        result.current.setWorkspaceFile("generator", null);
      });

      expect(result.current.generatorFile).toBeNull();
      expect(result.current.generatorPath).toBe("");
      expect(result.current.activeFileSlot).toBe("solution");
      expect(result.current.solutionFile).not.toBeNull();
    });
  });

  describe("loadWorkspaceFile", () => {
    it("calls read_workspace_file with the given path and stores the result", async () => {
      const appendLog = vi.fn();
      mockedInvoke.mockResolvedValueOnce({
        path: "/tmp/gen.cpp",
        name: "gen.cpp",
        language: "cpp",
        value: "int main() {}",
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      expect(mockedInvoke).toHaveBeenCalledWith("read_workspace_file", {
        path: "/tmp/gen.cpp",
      });
      expect(result.current.generatorFile).toEqual(
        expect.objectContaining({
          path: "/tmp/gen.cpp",
          name: "gen.cpp",
          value: "int main() {}",
          isDirty: false,
        }),
      );
      expect(result.current.activeFileSlot).toBe("generator");
    });

    it("logs an error and leaves state untouched when invoke rejects", async () => {
      const appendLog = vi.fn();
      mockedInvoke.mockRejectedValueOnce(new Error("file not found"));

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("solution", "/tmp/missing.cpp");
      });

      expect(result.current.solutionFile).toBeNull();
      expect(appendLog).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("/tmp/missing.cpp"),
      );
    });

    it("clears the slot instead of calling invoke when given an empty path", async () => {
      const appendLog = vi.fn();
      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "   ");
      });

      expect(mockedInvoke).not.toHaveBeenCalled();
      expect(result.current.generatorFile).toBeNull();
    });
  });

  describe("saveActiveFile", () => {
    it("returns false and does not call invoke when there is no active file", async () => {
      const appendLog = vi.fn();
      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      let success: boolean = true;
      await act(async () => {
        success = await result.current.saveActiveFile();
      });

      expect(success).toBe(false);
      expect(mockedInvoke).not.toHaveBeenCalled();
    });

    it("saves the active file, clears its dirty flag, and returns true on success", async () => {
      const appendLog = vi.fn();
      mockedInvoke
        .mockResolvedValueOnce({
          path: "/tmp/gen.cpp",
          name: "gen.cpp",
          language: "cpp",
          value: "int main() {}",
        })
        .mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      act(() => {
        result.current.setIsDirty("/tmp/gen.cpp", true);
      });
      expect(result.current.generatorFile?.isDirty).toBe(true);

      let success: boolean = false;
      await act(async () => {
        success = await result.current.saveActiveFile();
      });

      expect(success).toBe(true);
      expect(mockedInvoke).toHaveBeenCalledWith("save_workspace_file", {
        path: "/tmp/gen.cpp",
        content: "int main() {}",
      });
      expect(result.current.generatorFile?.isDirty).toBe(false);
      expect(appendLog).toHaveBeenCalledWith(
        "info",
        expect.stringContaining("gen.cpp"),
      );
    });

    it("returns false and logs an error when the save invoke rejects", async () => {
      const appendLog = vi.fn();
      mockedInvoke.mockImplementation((cmd: string) => {
        if (cmd === "read_workspace_file") {
          return Promise.resolve({
            path: "/tmp/gen.cpp",
            name: "gen.cpp",
            language: "cpp",
            value: "int main() {}",
          });
        }
        if (cmd === "save_workspace_file") {
          return Promise.reject(new Error("disk full"));
        }
        return Promise.resolve(undefined); // watch_file
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      let success: boolean = true;
      await act(async () => {
        success = await result.current.saveActiveFile();
      });

      expect(success).toBe(false);
      expect(appendLog).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("gen.cpp"),
      );
    });
  });

  describe("handleCodeChange", () => {
    it("updates the value of the matching file by path, and leaves the other slot untouched", async () => {
      const appendLog = vi.fn();
      mockedInvoke
        .mockResolvedValueOnce({
          path: "/tmp/gen.cpp",
          name: "gen.cpp",
          language: "cpp",
          value: "old value",
        })
        .mockResolvedValueOnce({
          path: "/tmp/sol.cpp",
          name: "sol.cpp",
          language: "cpp",
          value: "solution code",
        });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
        await result.current.loadWorkspaceFile("solution", "/tmp/sol.cpp");
      });

      act(() => {
        result.current.handleCodeChange("/tmp/gen.cpp", "new value");
      });

      expect(result.current.generatorFile?.value).toBe("new value");
      expect(result.current.solutionFile?.value).toBe("solution code");
    });

    it("is a no-op when the path does not match either open file", async () => {
      const appendLog = vi.fn();
      mockedInvoke.mockResolvedValueOnce({
        path: "/tmp/gen.cpp",
        name: "gen.cpp",
        language: "cpp",
        value: "unchanged",
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      act(() => {
        result.current.handleCodeChange("/tmp/unrelated.cpp", "ignored");
      });

      expect(result.current.generatorFile?.value).toBe("unchanged");
    });
  });

  describe("schema node state", () => {
    it("initializes schema nodes from the default state and persists updates", () => {
      const appendLog = vi.fn();
      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      expect(result.current.nodes).toHaveLength(2);
      expect(result.current.nodes[0]).toMatchObject({ kind: "int" });

      act(() => {
        result.current.setNodes([
          {
            id: "custom",
            kind: "loop",
            count: "T",
            children: [
              {
                id: "child",
                kind: "string",
                varName: "s",
                length: "5",
                charset: "lowercase",
              },
            ],
          },
        ]);
      });

      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.nodes[0]).toMatchObject({
        kind: "loop",
        count: "T",
      });
      expect(localStorage.getItem("cpgen_schema_nodes")).toContain("child");
    });
  });
});

describe("out-of-order responses", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    localStorage.clear();
  });

  it("shows the file that was opened last, even if it was requested first", async () => {
    const appendLog = vi.fn();
    const slowRequest = deferred<WorkspaceFilePayload>();
    const fastRequest = deferred<WorkspaceFilePayload>();

    mockedInvoke
      .mockImplementationOnce(() => slowRequest.promise)
      .mockImplementationOnce(() => fastRequest.promise);

    const { result } = renderHook(() => useWorkspaceFiles(appendLog));

    act(() => {
      result.current.loadWorkspaceFile("generator", "/a.cpp");
    });
    act(() => {
      result.current.loadWorkspaceFile("generator", "/b.cpp");
    });

    // b resolves first
    await act(async () => {
      fastRequest.resolve({
        path: "/b.cpp",
        name: "b.cpp",
        language: "cpp",
        value: "content of b",
      });
    });
    // a resolves later
    await act(async () => {
      slowRequest.resolve({
        path: "/a.cpp",
        name: "a.cpp",
        language: "cpp",
        value: "content of a",
      });
    });

    expect(result.current.generatorFile?.path).toBe("/b.cpp");
    expect(result.current.generatorFile?.value).toBe("content of b");
  });

  it("does not log an error for a superseded request that fails after the user moved on", async () => {
    const appendLog = vi.fn();
    const staleRequest = deferred<WorkspaceFilePayload>();
    const freshRequest = deferred<WorkspaceFilePayload>();

    mockedInvoke
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise);

    const { result } = renderHook(() => useWorkspaceFiles(appendLog));

    act(() => {
      result.current.loadWorkspaceFile("generator", "/a.cpp");
    });
    act(() => {
      result.current.loadWorkspaceFile("generator", "/b.cpp");
    });

    await act(async () => {
      freshRequest.resolve({
        path: "/b.cpp",
        name: "b.cpp",
        language: "cpp",
        value: "content of b",
      });
    });

    await act(async () => {
      staleRequest.reject(new Error("disk read failed"));
    });

    expect(appendLog).not.toHaveBeenCalledWith(
      "error",
      expect.stringContaining("/a.cpp"),
    );
    expect(result.current.generatorFile?.path).toBe("/b.cpp");
  });

  it("does not resurrect a cleared file when its in-flight load resolves afterward", async () => {
    const appendLog = vi.fn();
    const pendingRequest = deferred<WorkspaceFilePayload>();

    mockedInvoke.mockImplementationOnce(() => pendingRequest.promise);

    const { result } = renderHook(() => useWorkspaceFiles(appendLog));

    act(() => {
      result.current.loadWorkspaceFile("generator", "/a.cpp");
    });
    act(() => {
      result.current.loadWorkspaceFile("generator", "");
    });

    expect(result.current.generatorFile).toBeNull();

    await act(async () => {
      pendingRequest.resolve({
        path: "/a.cpp",
        name: "a.cpp",
        language: "cpp",
        value: "content of a",
      });
    });

    expect(result.current.generatorFile).toBeNull();
  });

  describe("file watching", () => {
    beforeEach(() => {
      mockedInvoke.mockReset();
      localStorage.clear();
    });

    function emitFileChanged(path: string) {
      (
        globalThis as unknown as {
          __emitTauriEvent: (event: string, payload: unknown) => void;
        }
      ).__emitTauriEvent("file-changed", path);
    }

    it("calls watch_file when a slot's path is set", async () => {
      const appendLog = vi.fn();
      mockedInvoke.mockResolvedValueOnce({
        path: "/tmp/gen.cpp",
        name: "gen.cpp",
        language: "cpp",
        value: "int main() {}",
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      expect(mockedInvoke).toHaveBeenCalledWith("watch_file", {
        path: "/tmp/gen.cpp",
      });
    });

    it("does not unwatch a path still in use by the other slot", async () => {
      const appendLog = vi.fn();
      mockedInvoke
        .mockResolvedValueOnce({
          path: "/tmp/shared.cpp",
          name: "shared.cpp",
          language: "cpp",
          value: "shared",
        })
        .mockResolvedValueOnce({
          path: "/tmp/shared.cpp",
          name: "shared.cpp",
          language: "cpp",
          value: "shared",
        })
        .mockResolvedValueOnce({
          path: "/tmp/other.cpp",
          name: "other.cpp",
          language: "cpp",
          value: "other",
        });

      const { result, rerender } = renderHook(() =>
        useWorkspaceFiles(appendLog),
      );

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/shared.cpp");
        await result.current.loadWorkspaceFile("solution", "/tmp/shared.cpp");
      });
      mockedInvoke.mockClear();

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/other.cpp");
      });
      rerender();

      expect(mockedInvoke).not.toHaveBeenCalledWith("unwatch_file", {
        path: "/tmp/shared.cpp",
      });
    });

    it("reloads a slot whose file changed on disk", async () => {
      const appendLog = vi.fn();
      const file = {
        path: "/tmp/gen.cpp",
        name: "gen.cpp",
        language: "cpp",
        value: "old content",
      };
      mockedInvoke.mockImplementation((cmd: string) => {
        if (cmd === "read_workspace_file") return Promise.resolve(file);
        return Promise.resolve(undefined); // watch_file / unwatch_file
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      file.value = "new content";

      await act(async () => {
        emitFileChanged("/tmp/gen.cpp");
        await Promise.resolve();
      });

      expect(mockedInvoke).toHaveBeenCalledWith("read_workspace_file", {
        path: "/tmp/gen.cpp",
      });
      expect(result.current.generatorFile?.value).toBe("new content");
    });

    it("reloads both slots when they share the same changed path", async () => {
      const appendLog = vi.fn();
      const file = {
        path: "/tmp/shared.cpp",
        name: "shared.cpp",
        language: "cpp",
        value: "old",
      };
      mockedInvoke.mockImplementation((cmd: string) => {
        if (cmd === "read_workspace_file") return Promise.resolve(file);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/shared.cpp");
        await result.current.loadWorkspaceFile("solution", "/tmp/shared.cpp");
      });

      file.value = "updated";

      await act(async () => {
        emitFileChanged("/tmp/shared.cpp");
        await Promise.resolve();
      });

      expect(result.current.generatorFile?.value).toBe("updated");
      expect(result.current.solutionFile?.value).toBe("updated");
    });

    it("ignores changes to paths that are not open in either slot", async () => {
      const appendLog = vi.fn();
      mockedInvoke.mockResolvedValueOnce({
        path: "/tmp/gen.cpp",
        name: "gen.cpp",
        language: "cpp",
        value: "unchanged",
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });
      mockedInvoke.mockClear();

      await act(async () => {
        emitFileChanged("/tmp/unrelated.cpp");
        await Promise.resolve();
      });

      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "read_workspace_file",
        expect.anything(),
      );
      expect(result.current.generatorFile?.value).toBe("unchanged");
    });

    it("logs an error when reloading a changed file fails", async () => {
      const appendLog = vi.fn();
      let readShouldFail = false;
      mockedInvoke.mockImplementation((cmd: string) => {
        if (cmd === "read_workspace_file") {
          return readShouldFail
            ? Promise.reject(new Error("permission denied"))
            : Promise.resolve({
                path: "/tmp/gen.cpp",
                name: "gen.cpp",
                language: "cpp",
                value: "content",
              });
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useWorkspaceFiles(appendLog));

      await act(async () => {
        await result.current.loadWorkspaceFile("generator", "/tmp/gen.cpp");
      });

      readShouldFail = true;

      await act(async () => {
        emitFileChanged("/tmp/gen.cpp");
        await Promise.resolve();
      });

      expect(appendLog).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("/tmp/gen.cpp"),
      );
    });
  });
});
