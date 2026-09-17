import { Store } from "@tauri-apps/plugin-store";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettings } from "../../../src/hooks/useSettings";

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn() },
}));

const DEFAULTS = {
  fontSize: 13,
  fontFamily:
    '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
  formatOnSave: false,
};

function makeMockStore(data: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async (key: string) => data[key]),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  };
}

describe("useSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("starts with default settings before the store resolves", () => {
    const mockedLoad = vi.mocked(Store.load);
    mockedLoad.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSettings());

    expect(result.current.fontSize).toBe(DEFAULTS.fontSize);
    expect(result.current.fontFamily).toBe(DEFAULTS.fontFamily);
    expect(result.current.formatOnSave).toBe(DEFAULTS.formatOnSave);
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("loads persisted values from the store and marks isLoaded", async () => {
    const mockStore = makeMockStore({ fontSize: 18, fontFamily: "Fira Code" });
    vi.mocked(Store.load).mockResolvedValue(mockStore as never);

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.fontSize).toBe(18);
    expect(result.current.fontFamily).toBe("Fira Code");
    expect(result.current.error).toBeNull();
  });

  it("falls back to defaults for keys missing from the store", async () => {
    const mockStore = makeMockStore({ fontSize: 20 });
    vi.mocked(Store.load).mockResolvedValue(mockStore as never);

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.fontSize).toBe(20);
    expect(result.current.fontFamily).toBe(DEFAULTS.fontFamily);
  });

  it("sets an error and still marks isLoaded if Store.load rejects", async () => {
    vi.mocked(Store.load).mockRejectedValue(new Error("disk error"));

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.error).toBe(
      "Failed to load settings. Using defaults.",
    );
    expect(result.current.fontSize).toBe(DEFAULTS.fontSize);
    expect(result.current.fontFamily).toBe(DEFAULTS.fontFamily);
  });

  it("does not update state after unmount once the store resolves", async () => {
    let resolveLoad!: (store: unknown) => void;
    vi.mocked(Store.load).mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }) as never,
    );

    const { unmount } = renderHook(() => useSettings());
    unmount();
    await act(async () => {
      resolveLoad(makeMockStore());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("unmounted component"),
    );
  });

  it("optimistically updates state and persists via set + save", async () => {
    const mockStore = makeMockStore();
    vi.mocked(Store.load).mockResolvedValue(mockStore as never);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.onSettingChange("fontSize", 22);
    });

    expect(result.current.fontSize).toBe(22);
    expect(mockStore.set).toHaveBeenCalledWith("fontSize", 22);
    expect(mockStore.save).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("loads and persists format-on-save", async () => {
    const mockStore = makeMockStore({ formatOnSave: true });
    vi.mocked(Store.load).mockResolvedValue(mockStore as never);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.formatOnSave).toBe(true);
    await act(async () => {
      await result.current.onSettingChange("formatOnSave", false);
    });

    expect(result.current.formatOnSave).toBe(false);
    expect(mockStore.set).toHaveBeenCalledWith("formatOnSave", false);
  });

  it("clears a previous error at the start of a new change attempt", async () => {
    vi.mocked(Store.load).mockRejectedValue(new Error("disk error"));
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.error).not.toBeNull();
    await act(async () => {
      await result.current.onSettingChange("fontSize", 22);
    });

    expect(result.current.error).toBe("Settings could not be saved.");
  });

  it("sets an error and does not throw when the store never loaded", async () => {
    vi.mocked(Store.load).mockRejectedValue(new Error("disk error"));
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.onSettingChange("fontFamily", "Consolas");
    });

    expect(result.current.fontFamily).toBe("Consolas");
    expect(result.current.error).toBe("Settings could not be saved.");
  });

  it("sets an error if store.set or store.save throws", async () => {
    const mockStore = makeMockStore();
    mockStore.save.mockRejectedValueOnce(new Error("write failed"));
    vi.mocked(Store.load).mockResolvedValue(mockStore as never);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.onSettingChange("fontSize", 16);
    });

    expect(result.current.fontSize).toBe(16);
    expect(result.current.error).toBe("Failed to save settings.");
    expect(console.error).toHaveBeenCalled();
  });

  it("reuses the same store across multiple onSettingChange calls", async () => {
    const mockStore = makeMockStore();
    vi.mocked(Store.load).mockResolvedValue(mockStore as never);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.onSettingChange("fontSize", 14);
      await result.current.onSettingChange("fontFamily", "Consolas");
    });

    expect(Store.load).toHaveBeenCalledTimes(1);
    expect(mockStore.set).toHaveBeenNthCalledWith(1, "fontSize", 14);
    expect(mockStore.set).toHaveBeenNthCalledWith(2, "fontFamily", "Consolas");
  });
});
