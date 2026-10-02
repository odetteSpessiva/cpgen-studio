import { Channel, invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsContext } from "../context/SettingsContext";
import type {
  AIInstance,
  ChatAttachment,
  ChatMessage,
  ModelInfo,
} from "../types";

const SYSTEM_PROMPT = `You are a test generator assistant. Read the attached problem statement and write a generator program that outputs exactly one valid test case to stdout on every run. Return only a JSON object with this exact shape: {"language":"<language>","code":"<complete source code>"}. Do not wrap it in Markdown. User messages are small nudges about the generator, not the main task.`;
const INSTANCES_STORAGE_KEY = "cpgen_ai_instances";

const createDefaultInstance = (): AIInstance => ({
  id: crypto.randomUUID(),
  name: "New instance",
  problemFile: null,
  messages: [],
});

const loadInstances = (): AIInstance[] => {
  try {
    const saved = localStorage.getItem(INSTANCES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as AIInstance[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error("Failed to restore AI instances:", err);
  }
  return [createDefaultInstance()];
};

export function useAI() {
  const { aiProvider, aiBaseUrl, aiModel } = useSettingsContext();
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [instances, setInstances] = useState<AIInstance[]>(loadInstances);
  const [activeInstanceId, setActiveInstanceId] = useState(
    () => instances[0].id,
  );
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storePromiseRef = useRef<Promise<Store | null>>(null);

  const activeInstance =
    instances.find((instance) => instance.id === activeInstanceId) ?? instances[0];
  const messages = activeInstance.messages;

  useEffect(() => {
    localStorage.setItem(INSTANCES_STORAGE_KEY, JSON.stringify(instances));
  }, [instances]);

  const updateActiveInstance = useCallback(
    (update: (instance: AIInstance) => AIInstance) => {
      setInstances((prev) =>
        prev.map((instance) =>
          instance.id === activeInstanceId ? update(instance) : instance,
        ),
      );
    },
    [activeInstanceId],
  );

  const createInstance = useCallback(() => {
    const instance: AIInstance = {
      id: crypto.randomUUID(),
      name: "New instance",
      problemFile: null,
      messages: [],
    };
    setInstances((prev) => [...prev, instance]);
    setActiveInstanceId(instance.id);
    setError(null);
  }, []);

  const selectInstance = useCallback((id: string) => {
    setActiveInstanceId(id);
    setError(null);
  }, []);

  const renameInstance = useCallback((id: string, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setInstances((prev) =>
      prev.map((instance) =>
        instance.id === id ? { ...instance, name: trimmedName } : instance,
      ),
    );
  }, []);

  const deleteInstance = useCallback(
    (id: string) => {
      setInstances((prev) => {
        if (prev.length === 1) return prev;
        const index = prev.findIndex((instance) => instance.id === id);
        if (index === -1) return prev;
        const next = prev.filter((instance) => instance.id !== id);
        if (id === activeInstanceId) {
          setActiveInstanceId(next[Math.max(0, index - 1)].id);
        }
        return next;
      });
      setError(null);
    },
    [activeInstanceId],
  );

  const attachProblem = useCallback(
    (file: ChatAttachment) => {
      updateActiveInstance((instance) => ({
        ...instance,
        name: file.name,
        problemFile: file,
        messages: [],
      }));
      setError(null);
    },
    [updateActiveInstance],
  );

  useEffect(() => {
    const storePromise = Store.load("ai-models.json").catch((err) => {
      console.error("Failed to load AI models store:", err);
      return null;
    });
    storePromiseRef.current = storePromise;
    let canceled = false;
    (async () => {
      const store = await storePromise;
      if (!store || canceled) return;
      const entries = await store.entries<ModelInfo[]>();
      if (canceled) return;
      setModels((prev) => ({ ...Object.fromEntries(entries), ...prev }));
    })();
    return () => {
      canceled = true;
    };
  }, []);

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

  const getKey = useCallback(async (key: string) => {
    setError(null);
    try {
      const value = await invoke<string | null>("get_key", { key });
      setKeyStatus((prev) => ({ ...prev, [key]: value !== null }));
      return value ?? "";
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      return "";
    }
  }, []);

  const deleteKey = useCallback(async (key: string) => {
    setError(null);
    try {
      await invoke("delete_key", { key });
      setKeyStatus((prev) => ({ ...prev, [key]: false }));
      return true;
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      return false;
    }
  }, []);

  const fetchModels = useCallback(async (provider: string, baseUrl: string) => {
    setError(null);
    setIsFetchingModels(true);
    setModels((prev) => ({ ...prev, [provider]: [] }));
    const mergeModels = (page: ModelInfo[]) =>
      setModels((prev) => ({
        ...prev,
        [provider]: [
          ...new Map(
            [...(prev[provider] ?? []), ...page].map((m) => [m.id, m]),
          ).values(),
        ].sort((a, b) => a.id.localeCompare(b.id)),
      }));
    const onPage = new Channel<ModelInfo[]>();
    onPage.onmessage = mergeModels;
    try {
      const list = await invoke<ModelInfo[]>("list_models", {
        provider,
        baseUrl,
        onPage,
      });
      mergeModels(list);
      const store = await storePromiseRef.current;
      await store?.set(provider, list);
      await store?.save();
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setIsFetchingModels(false);
    }
  }, []);

  const sendMessageWithHistory = useCallback(
    async (content: string, baseMessages: ChatMessage[]) => {
      if (isSending) return;
      if (aiModel === "") {
        setError("No model selected.");
        return;
      }
      if (!activeInstance.problemFile) {
        setError("Attach a problem statement before sending a message.");
        return;
      }
      const history: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: activeInstance.problemFile.text
            ? `Attached problem statement (${activeInstance.problemFile.name}):\n\n${activeInstance.problemFile.text}`
            : `Attached problem document: ${activeInstance.problemFile.name} (${activeInstance.problemFile.mimeType}). Use the attached document content.`,
        },
        ...baseMessages,
        { role: "user", content },
      ];
      setError(null);
      setIsSending(true);
      const nextMessages = [
        ...baseMessages,
        { role: "user" as const, content },
      ];
      updateActiveInstance((instance) => ({
        ...instance,
        messages: [...nextMessages, { role: "assistant", content: "" }],
      }));

      const setReply = (update: (reply: string) => string) =>
        updateActiveInstance((instance) => ({
          ...instance,
          messages: instance.messages.map((m, i) =>
            i === instance.messages.length - 1
              ? { ...m, content: update(m.content) }
              : m,
          ),
        }));
      let done = false;
      const onDelta = new Channel<string>();
      onDelta.onmessage = (delta) => {
        if (!done) setReply((reply) => reply + delta);
      };
      try {
        const reply = await invoke<string>("send_message", {
          provider: aiProvider,
          baseUrl: aiBaseUrl,
          model: aiModel,
          messages: history,
          attachment: activeInstance.problemFile,
          onDelta,
        });
        done = true;
        setReply(() => reply);
      } catch (err) {
        done = true;
        setError(typeof err === "string" ? err : String(err));
        updateActiveInstance((instance) => ({
          ...instance,
          messages:
            instance.messages[instance.messages.length - 1]?.content === ""
              ? instance.messages.slice(0, -1)
              : instance.messages,
        }));
      } finally {
        setIsSending(false);
      }
    },
    [activeInstance, aiProvider, aiBaseUrl, aiModel, isSending, updateActiveInstance],
  );

  const sendMessage = useCallback(
    (content: string) => sendMessageWithHistory(content, messages),
    [messages, sendMessageWithHistory],
  );

  const resendMessage = useCallback(
    (index: number) => {
      const message = messages[index];
      if (!message || message.role !== "user") return Promise.resolve();
      return sendMessageWithHistory(message.content, messages.slice(0, index));
    },
    [messages, sendMessageWithHistory],
  );

  const clearMessages = useCallback(() => {
    updateActiveInstance((instance) => ({ ...instance, messages: [] }));
    setError(null);
  }, [updateActiveInstance]);

  return {
    keyStatus,
    models,
    isFetchingModels,
    messages,
    instances,
    activeInstanceId,
    isSending,
    saveKey,
    getKey,
    deleteKey,
    fetchModels,
    sendMessage,
    resendMessage,
    createInstance,
    selectInstance,
    renameInstance,
    deleteInstance,
    attachProblem,
    clearMessages,
    error,
    setError,
  };
}
