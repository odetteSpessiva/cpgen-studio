import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

export function useAI() {
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const saveKey = useCallback(async (key: string, value: string) => {
    setError(null);
    try {
      await invoke("save_key", { key, value });
      setKeyStatus((prev) => ({ ...prev, [key]: true }));
      return true;
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      return false;
    }
  }, []);

  const hasKey = useCallback(async (key: string) => {
    setError(null);
    try {
      const present = await invoke<boolean>("has_key", { key });
      setKeyStatus((prev) => ({ ...prev, [key]: present }));
      return present;
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      return false;
    }
  }, []);

  const deleteKey = useCallback(async (key: string) => {
    setError(null);
    try {
      await invoke("delete_key", { key });
      setKeyStatus((prev) => ({ ...prev, [key]: false }));
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    }
  }, []);

  return { keyStatus, saveKey, hasKey, deleteKey, error, setError };
}
