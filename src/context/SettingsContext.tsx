import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useSettings } from "../hooks/useSettings";
import { SettingKey } from "../types";

interface SettingsContextValue {
  fontSize: number;
  fontFamily: string;
  formatOnSave: boolean;
  gppPath: string;
  compilerArgs: string;
  pythonPath: string;
  clangdPath: string;
  onSettingChange: (key: SettingKey, value: number | string | boolean) => void;
  error: string | null;
  setError: (
    value: string | null | ((prev: string | null) => string | null),
  ) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettings();

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error(
      "useSettingsContext must be used within a WorkspaceProvider",
    );
  }
  return ctx;
}
