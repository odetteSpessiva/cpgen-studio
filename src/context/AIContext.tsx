import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useAI } from "../hooks/useAI";

interface AIContextValue {
  keyStatus: Record<string, boolean>;
  saveKey: (key: string, value: string) => Promise<boolean>;
  hasKey: (key: string) => Promise<boolean>;
  deleteKey: (key: string) => Promise<void>;
  error: string | null;
  setError: (
    value: string | null | ((prev: string | null) => string | null),
  ) => void;
}

const AIContext = createContext<AIContextValue | null>(null);

export function AIProvider({ children }: { children: ReactNode }) {
  const value = useAI();

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAIContext() {
  const ctx = useContext(AIContext);
  if (!ctx) {
    throw new Error("useAIContext must be used within an AIProvider");
  }
  return ctx;
}
