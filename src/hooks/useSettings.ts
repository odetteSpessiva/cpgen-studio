import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { useEffect, useRef, useState } from "react";
import { invalidateLspConnection } from "../lsp/monacoIntegration";
import type { AIProvider, SettingKey, ThinkingEffort } from "../types";

type AIProviderSettings = Record<
  `${AIProvider}BaseUrl` | `${AIProvider}Model`,
  string
>;

type AIJsonModeSettings = Record<`${AIProvider}JsonMode`, boolean>;

type AIThinkingSettings = Record<`${AIProvider}Thinking`, boolean> &
  Record<`${AIProvider}ThinkingEffort`, ThinkingEffort> &
  Record<`${AIProvider}ThinkingBudget`, number>;

interface SettingsState
  extends AIProviderSettings, AIJsonModeSettings, AIThinkingSettings {
  fontSize: number;
  fontFamily: string;
  formatOnSave: boolean;
  gppPath: string;
  compilerArgs: string;
  pythonPath: string;
  clangdPath: string;
  aiProvider: AIProvider;
  aiAutoMode: boolean;
  anthropicMaxTokens: number;
}

const DEFAULT_SETTINGS: SettingsState = {
  fontSize: 13,
  fontFamily:
    '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
  formatOnSave: false,
  gppPath: "g++",
  compilerArgs: "-std=c++14 -O2",
  pythonPath: "python",
  clangdPath: "clangd",
  aiProvider: "openai",
  aiAutoMode: false,
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "",
  googleBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  googleModel: "",
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  anthropicModel: "",
  anthropicMaxTokens: 8192,
  openaiJsonMode: false,
  googleJsonMode: false,
  anthropicJsonMode: false,
  openaiThinking: false,
  openaiThinkingEffort: "medium",
  openaiThinkingBudget: 0,
  googleThinking: false,
  googleThinkingEffort: "medium",
  googleThinkingBudget: -1,
  anthropicThinking: false,
  anthropicThinkingEffort: "medium",
  anthropicThinkingBudget: 2048,
};

const LSP_SETTING_TO_LANGUAGE: Partial<Record<SettingKey, string>> = {
  clangdPath: "cpp",
  gppPath: "cpp",
  pythonPath: "python",
};

function assignSetting<K extends keyof SettingsState>(
  target: SettingsState,
  key: K,
  value: SettingsState[K],
) {
  target[key] = value;
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storePromiseRef = useRef<Promise<Store | null>>(null);

  useEffect(() => {
    const storePromise = Store.load("settings.json").catch((err) => {
      setError("Failed to load settings. Using defaults.");
      console.error("Failed to load settings store:", err);
      return null;
    });
    storePromiseRef.current = storePromise;
    let canceled = false;
    (async () => {
      const store = await storePromise;
      if (canceled) return;
      if (!store) {
        setIsLoaded(true);
        return;
      }
      const keys = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[];
      const entries = await Promise.all(
        keys.map(async (key) => [key, await store.get(key)] as const),
      );
      if (canceled) return;

      setSettings((prev) => {
        const next = { ...prev };
        for (const [key, value] of entries) {
          if (value !== undefined) {
            assignSetting(next, key, value as SettingsState[typeof key]);
          }
        }
        return next;
      });
      setIsLoaded(true);
    })();
    return () => {
      canceled = true;
    };
  }, []);

  const onSettingChange = async (
    key: SettingKey,
    value: number | string | boolean,
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setError(null);
    const language = LSP_SETTING_TO_LANGUAGE[key];
    if (language) {
      await invoke("lsp_kill", { language });
      await invalidateLspConnection(language);
    }
    try {
      const store = await storePromiseRef.current;
      if (!store) {
        setError("Settings could not be saved.");
        return;
      }
      await store.set(key, value);
      await store.save();
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError("Failed to save settings.");
    }
  };

  return {
    ...settings,
    aiBaseUrl: settings[`${settings.aiProvider}BaseUrl` as const],
    aiModel: settings[`${settings.aiProvider}Model` as const],
    aiJsonMode: settings[`${settings.aiProvider}JsonMode` as const],
    aiThinking: settings[`${settings.aiProvider}Thinking` as const],
    aiThinkingEffort: settings[`${settings.aiProvider}ThinkingEffort` as const],
    aiThinkingBudget: settings[`${settings.aiProvider}ThinkingBudget` as const],
    isLoaded,
    onSettingChange,
    error,
    setError,
  };
}
