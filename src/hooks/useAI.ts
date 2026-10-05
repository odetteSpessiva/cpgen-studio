import { Channel, invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePipelineContext } from "../context/PipelineContext";
import { useSettingsContext } from "../context/SettingsContext";
import type {
  AIInstance,
  ChatAttachment,
  ChatMessage,
  ChatTab,
  ModelInfo,
} from "../types";

const INSTANCES_STORAGE_KEY = "cpgen_ai_instances";

const notifyGenerationComplete = async (
  instanceName: string,
  instanceId: string,
  tab: ChatTab,
) => {
  let persisted: Partial<PersistedAIState> = {};
  try {
    persisted = JSON.parse(
      localStorage.getItem(INSTANCES_STORAGE_KEY) ?? "{}",
    ) as Partial<PersistedAIState>;
  } catch {
    // The completion still warrants a notification when persisted state is invalid.
  }
  const isCurrentInstance = persisted.activeInstanceId === instanceId;
  const isChatPageActive = persisted.activePage === "chat";
  const isCurrentChatTab = persisted.activeChatTab === tab;
  if (
    isChatPageActive &&
    isCurrentInstance &&
    isCurrentChatTab &&
    document.hasFocus()
  ) {
    return;
  }

  try {
    await invoke("send_generation_notification", {
      title: "Generation complete",
      body: `${instanceName} ${tab} generation is ready.`,
      instanceId,
      chatTab: tab,
    });
  } catch (err) {
    console.error("Failed to show generation notification:", err);
  }
};

const createDefaultInstance = (): AIInstance => ({
  id: crypto.randomUUID(),
  name: "New instance",
  problemFile: null,
  activeTab: "problem",
  messagesByTab: { problem: [], solution: [] },
});

const normalizeInstance = (value: AIInstance): AIInstance => ({
  id: value.id,
  name: value.name,
  problemFile: value.problemFile,
  activeTab: value.activeTab,
  messagesByTab: value.messagesByTab,
});

interface PersistedAIState {
  instances: AIInstance[];
  activeInstanceId: string;
  activePage: "editor" | "settings" | "chat";
  activeChatTab: ChatTab;
  pendingGeneration?: {
    instanceId: string;
    tab: ChatTab;
  };
}

const loadPersistedState = (): PersistedAIState => {
  try {
    const saved = localStorage.getItem(INSTANCES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as PersistedAIState;
      if (
        Array.isArray(parsed.instances) &&
        parsed.instances.length > 0 &&
        parsed.instances.some(
          (instance) => instance.id === parsed.activeInstanceId,
        ) &&
        ["editor", "settings", "chat"].includes(parsed.activePage) &&
        ["problem", "solution"].includes(parsed.activeChatTab)
      ) {
        const instances = parsed.instances.map(normalizeInstance);
        if (parsed.pendingGeneration) {
          const pendingInstance = instances.find(
            (instance) => instance.id === parsed.pendingGeneration?.instanceId,
          );
          if (pendingInstance) {
            const pendingMessages =
              pendingInstance.messagesByTab[parsed.pendingGeneration.tab];
            if (
              pendingMessages[pendingMessages.length - 1]?.role === "assistant"
            ) {
              pendingInstance.messagesByTab[parsed.pendingGeneration.tab] =
                pendingMessages.slice(0, -1);
            }
          }
        }
        return {
          ...parsed,
          instances,
          pendingGeneration: undefined,
        };
      }
    }
  } catch (err) {
    console.error("Failed to restore AI state:", err);
  }
  const fallback = createDefaultInstance();
  return {
    instances: [fallback],
    activeInstanceId: fallback.id,
    activePage: "editor",
    activeChatTab: "problem",
  };
};

export function useAI() {
  const {
    aiProvider,
    aiBaseUrl,
    aiModel,
    aiJsonMode,
    aiThinking,
    aiThinkingEffort,
    aiThinkingBudget,
    anthropicMaxTokens,
  } = useSettingsContext();
  const { config } = usePipelineContext();
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [persistedState] = useState(loadPersistedState);
  const [instances, setInstances] = useState<AIInstance[]>(
    persistedState.instances,
  );
  const [activeInstanceId, setActiveInstanceId] = useState(
    persistedState.activeInstanceId,
  );
  const [isSending, setIsSending] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<
    PersistedAIState["pendingGeneration"]
  >(persistedState.pendingGeneration);
  const [error, setError] = useState<string | null>(null);
  const storePromiseRef = useRef<Promise<Store | null>>(null);

  const activeInstance =
    instances.find((instance) => instance.id === activeInstanceId) ??
    instances[0];
  const messages = activeInstance.messagesByTab[activeInstance.activeTab];

  useEffect(() => {
    let previous: Partial<PersistedAIState> = {};
    try {
      previous = JSON.parse(
        localStorage.getItem(INSTANCES_STORAGE_KEY) ?? "{}",
      ) as Partial<PersistedAIState>;
    } catch {
      // Replace invalid persisted state with the current valid state.
    }
    localStorage.setItem(
      INSTANCES_STORAGE_KEY,
      JSON.stringify({
        ...previous,
        instances,
        activeInstanceId,
        pendingGeneration,
      }),
    );
  }, [activeInstanceId, instances, pendingGeneration]);

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
      activeTab: "problem",
      messagesByTab: { problem: [], solution: [] },
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

  const selectChatTab = useCallback(
    (tab: ChatTab) => {
      updateActiveInstance((instance) => ({ ...instance, activeTab: tab }));
      setError(null);
    },
    [updateActiveInstance],
  );

  const deleteInstance = useCallback(
    (id: string) => {
      setInstances((prev) => {
        if (prev.length === 1) return prev;
        const deleted = prev.find((instance) => instance.id === id);
        const index = prev.findIndex((instance) => instance.id === id);
        if (index === -1) return prev;
        if (deleted) {
          void invoke("delete_ai_instance_directory", {
            instanceId: deleted.id,
            instanceName: deleted.name,
          }).catch((err) =>
            console.error("Failed to remove AI instance directory:", err),
          );
        }
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
        messagesByTab: { problem: [], solution: [] },
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
      const responseFormat = `
OUTPUT FORMAT (strict). Your entire response is parsed by a program with
JSON.parse. Any character outside the JSON object makes the response fail.

Return exactly one JSON object:
{"language":"python"|"cpp","code":"<complete source code>"}

For explicit non-coding requests, return:
{"language":"text","code":"<response>"}

Rules:
- The first character of your response is { and the last is }.
- No Markdown, no code fences, no explanation, no text before or after.
- "code" is a single JSON string: escape newlines as \\n, quotes as \\", and
  backslashes as \\\\.
- Put all explanations inside code comments, never outside the object.
- Do not add anything outside of the provided format like explanation, notes, etc....
- Return the {"language":"text","code":"<response>"} block when you are unable
  to read the attatched problem or when any clarification is required, do not guess.

Example of a valid response:
{"language":"cpp","code":"#include <iostream>\\nint main() {\\n  std::cout << 1 << \\"\\\\n\\";\\n}\\n"}
`.trim();

      const systemPrompt =
        activeInstance.activeTab === "problem"
          ? `
You are a competitive-programming test generator assistant.

Read the attached problem statement and write a generator in Python or C++
that prints exactly one valid test case to stdout per run, with no other output.

The pipeline runs the generator ${config.batches} times.
Test index (1-based): ${config.indexDelivery}.
Read it, use it to pick the subtask or test category when the statement defines
subtasks, and scale size and difficulty across indices.

Requirements:
- Every test must satisfy all constraints and guarantees in the statement
  (value ranges, distinctness, connectivity, sum limits, guaranteed answer
  existence, etc.).
- Seed all randomness from the index so the same index always produces the
  same test.
- Cover edge cases and extremes: minimum sizes, maximum sizes, and special
  structures, while spreading the rest from small to maximal.
- Match the input format exactly: token order, whitespace, line breaks, and a
  trailing newline.
- Run fast enough for maximum constraints.

${responseFormat}
`.trim()
          : `
You are a competitive-programming solution assistant.

Read the attached problem statement and write a correct, efficient solution in
Python or C++ that reads from stdin and writes to stdout. Ignore any file I/O
instructions in the statement.

Requirements:
- Meet the time and memory limits at maximum constraints.
- Match the output format exactly.
- Handle edge cases such as minimum inputs, overflow (use 64-bit where needed),
  and degenerate structures.
- If there is ANY chance that there will be an overflow, use a larger data type,
  including inside any intermediate calculations

${responseFormat}
`.trim();
      const history: ChatMessage[] = [
        { role: "system", content: systemPrompt },
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
      setPendingGeneration({
        instanceId: activeInstance.id,
        tab: activeInstance.activeTab,
      });
      const nextMessages = [
        ...baseMessages,
        { role: "user" as const, content },
      ];
      updateActiveInstance((instance) => ({
        ...instance,
        messagesByTab: {
          ...instance.messagesByTab,
          [instance.activeTab]: [
            ...nextMessages,
            { role: "assistant", content: "" },
          ],
        },
      }));

      const setReply = (update: (reply: string) => string) =>
        updateActiveInstance((instance) => ({
          ...instance,
          messagesByTab: {
            ...instance.messagesByTab,
            [instance.activeTab]: instance.messagesByTab[
              instance.activeTab
            ].map((m, i) =>
              i === instance.messagesByTab[instance.activeTab].length - 1
                ? { ...m, content: update(m.content) }
                : m,
            ),
          },
        }));
      const setThinking = (update: (thinking: string) => string) =>
        updateActiveInstance((instance) => ({
          ...instance,
          messagesByTab: {
            ...instance.messagesByTab,
            [instance.activeTab]: instance.messagesByTab[
              instance.activeTab
            ].map((m, i) =>
              i === instance.messagesByTab[instance.activeTab].length - 1
                ? { ...m, thinking: update(m.thinking ?? "") }
                : m,
            ),
          },
        }));
      const onDelta = new Channel<{
        kind: "content" | "thinking";
        text: string;
      }>();
      onDelta.onmessage = (delta) => {
        console.log("[AI delta]", delta);
        if (delta.kind === "thinking") {
          setThinking((thinking) => thinking + delta.text);
        } else {
          setReply((reply) => reply + delta.text);
        }
      };
      try {
        const reply = await invoke<string>("send_message", {
          provider: aiProvider,
          baseUrl: aiBaseUrl,
          model: aiModel,
          messages: history,
          attachment: activeInstance.problemFile,
          options: {
            thinking: aiThinking,
            effort: aiThinkingEffort,
            thinkingBudget: aiThinkingBudget,
            maxTokens: anthropicMaxTokens,
            jsonMode: aiJsonMode,
          },
          onDelta,
        });
        setReply((current) => reply || current);
        await notifyGenerationComplete(
          activeInstance.name,
          activeInstance.id,
          activeInstance.activeTab,
        );
      } catch (err) {
        setError(typeof err === "string" ? err : String(err));
        updateActiveInstance((instance) => ({
          ...instance,
          messagesByTab: {
            ...instance.messagesByTab,
            [instance.activeTab]:
              instance.messagesByTab[instance.activeTab][
                instance.messagesByTab[instance.activeTab].length - 1
              ]?.content === ""
                ? instance.messagesByTab[instance.activeTab].slice(0, -1)
                : instance.messagesByTab[instance.activeTab],
          },
        }));
      } finally {
        setPendingGeneration(undefined);
        setIsSending(false);
      }
    },
    [
      activeInstance,
      aiProvider,
      aiBaseUrl,
      aiModel,
      aiJsonMode,
      aiThinking,
      aiThinkingEffort,
      aiThinkingBudget,
      anthropicMaxTokens,
      config,
      isSending,
      updateActiveInstance,
    ],
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
    updateActiveInstance((instance) => ({
      ...instance,
      messagesByTab: { ...instance.messagesByTab, [instance.activeTab]: [] },
    }));
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
    selectChatTab,
    clearMessages,
    error,
    setError,
  };
}
