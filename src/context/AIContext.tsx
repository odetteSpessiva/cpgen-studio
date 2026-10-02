import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useAI } from "../hooks/useAI";
import type { AIInstance, ChatAttachment, ChatMessage, ModelInfo } from "../types";

interface AIContextValue {
  keyStatus: Record<string, boolean>;
  models: Record<string, ModelInfo[]>;
  isFetchingModels: boolean;
  messages: ChatMessage[];
  instances: AIInstance[];
  activeInstanceId: string;
  isSending: boolean;
  saveKey: (key: string, value: string) => Promise<boolean>;
  getKey: (key: string) => Promise<string>;
  deleteKey: (key: string) => Promise<boolean>;
  fetchModels: (provider: string, baseUrl: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  resendMessage: (index: number) => Promise<void>;
  createInstance: () => void;
  selectInstance: (id: string) => void;
  renameInstance: (id: string, name: string) => void;
  deleteInstance: (id: string) => void;
  attachProblem: (file: ChatAttachment) => void;
  clearMessages: () => void;
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
