import { invoke } from "@tauri-apps/api/core";
import {
  Bot,
  Check,
  FileText,
  FileUp,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAIContext } from "../context/AIContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import type { ChatAttachment, ChatTab } from "../types";

interface GeneratedFile {
  language: "python" | "cpp";
  code: string;
}

interface TextResponse {
  language: "text";
  code: string;
}

type ParsedResponse = GeneratedFile | TextResponse;

const stripCodeFence = (value: string): string =>
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

const extractJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return value.slice(start, index + 1);
    }
  }
  return null;
};

const extractQuotedValue = (value: string, key: string): string | null => {
  const keyMatch = value.match(
    new RegExp(`[\"']${key}[\"']\\s*:\\s*([\"'])`, "i"),
  );
  if (!keyMatch || keyMatch.index === undefined) return null;
  const start = keyMatch.index + keyMatch[0].length;
  const quote = keyMatch[1];
  let result = "";
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      result += `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote) {
      return result;
    } else {
      result += character;
    }
  }
  return null;
};

const decodeExtractedString = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    try {
      return JSON.parse(
        `"${value.replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t")}"`,
      ) as string;
    } catch {
      return value
        .replace(/\\"/g, '"')
        .replace(/\\\\n/g, "\\n")
        .replace(/\\\\r/g, "\\r")
        .replace(/\\\\t/g, "\\t");
    }
  }
};

const parseResponse = (content: string): ParsedResponse | null => {
  const normalizedContent = stripCodeFence(content);
  const fencedContent = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [
    normalizedContent,
    fencedContent ? stripCodeFence(fencedContent) : undefined,
    extractJsonObject(normalizedContent),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<GeneratedFile>;
      const language =
        parsed.language?.toLowerCase() === "python3"
          ? "python"
          : parsed.language?.toLowerCase() === "c++"
            ? "cpp"
            : parsed.language?.toLowerCase();
      if (
        (language === "python" || language === "cpp" || language === "text") &&
        typeof parsed.code === "string" &&
        parsed.code.trim() !== ""
      ) {
        return {
          language,
          code: parsed.code.trim(),
        };
      }
    } catch {
      // Some models emit JSON-like output with literal newlines in `code`.
    }
  }

  const rawLanguage = normalizedContent.match(
    /["']language["']\s*:\s*["']([^"']+)/i,
  )?.[1];
  const language =
    rawLanguage?.toLowerCase() === "python3"
      ? "python"
      : rawLanguage?.toLowerCase() === "c++"
        ? "cpp"
        : rawLanguage?.toLowerCase();
  const codeStart = normalizedContent.search(/["']code["']\s*:\s*/i);
  if (
    (language !== "python" && language !== "cpp" && language !== "text") ||
    codeStart < 0
  ) {
    return null;
  }
  const extractedCode = extractQuotedValue(normalizedContent, "code");
  if (extractedCode === null) return null;
  const code = decodeExtractedString(extractedCode);
  if (code.trim()) {
    return {
      language: language.toLowerCase() === "python3" ? "python" : language,
      code: code.trim(),
    };
  }
  return null;
};

const parseContent = (content: string): GeneratedFile | null => {
  const parsed = parseResponse(content);
  return parsed?.language === "python" || parsed?.language === "cpp"
    ? parsed
    : null;
};

const displayResponse = (content: string): string => {
  const parsed = parseResponse(content);
  return parsed ? parsed.code : content;
};

export default function Chat() {
  const {
    messages,
    instances,
    activeInstanceId,
    isSending,
    sendMessage,
    resendMessage,
    clearMessages,
    createInstance,
    selectInstance,
    renameInstance,
    deleteInstance,
    attachProblem,
    selectChatTab,
    error,
  } = useAIContext();
  const { saveGeneratedFile } = useWorkspaceContext();
  const [input, setInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isInstanceMenuOpen, setIsInstanceMenuOpen] = useState(false);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(
    null,
  );
  const [editingInstanceName, setEditingInstanceName] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef(
    new Map<string, { top: number; atBottom: boolean }>(),
  );
  const instanceMenuRef = useRef<HTMLDivElement>(null);
  const startedForAttachmentRef = useRef<string | null>(null);
  const activeInstance = instances.find(
    (instance) => instance.id === activeInstanceId,
  );
  const activeTab: ChatTab = activeInstance?.activeTab ?? "problem";

  const beginRename = (instanceId: string, currentName: string) => {
    setEditingInstanceId(instanceId);
    setEditingInstanceName(currentName);
  };

  const commitRename = () => {
    if (editingInstanceId) {
      renameInstance(editingInstanceId, editingInstanceName);
    }
    setEditingInstanceId(null);
  };

  useEffect(() => {
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(
        localStorage.getItem("cpgen_ai_instances") ?? "{}",
      ) as Record<string, unknown>;
    } catch {
      // Replace invalid persisted state with the current valid state.
    }
    localStorage.setItem(
      "cpgen_ai_instances",
      JSON.stringify({ ...previous, activeChatTab: activeTab }),
    );
  }, [activeTab]);

  const scrollKey = `${activeInstanceId}:${activeTab}`;

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const saved = scrollStateRef.current.get(scrollKey);
    if (!saved) {
      container.scrollTop = container.scrollHeight;
    } else if (saved.atBottom) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTop = saved.top;
    }
  }, [messages, scrollKey]);

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atBottom =
      container.scrollHeight - container.clientHeight - container.scrollTop <=
      4;
    scrollStateRef.current.set(scrollKey, {
      top: container.scrollTop,
      atBottom,
    });
  };

  useEffect(() => {
    if (!isInstanceMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !instanceMenuRef.current?.contains(event.target)
      ) {
        setIsInstanceMenuOpen(false);
        setEditingInstanceId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isInstanceMenuOpen]);

  useEffect(() => {
    const attachment = activeInstance?.problemFile;
    if (
      attachment &&
      messages.length === 0 &&
      startedForAttachmentRef.current !==
        `${activeInstanceId}:${activeTab}:${attachment.path}` &&
      !isSending
    ) {
      startedForAttachmentRef.current = `${activeInstanceId}:${activeTab}:${attachment.path}`;
      void sendMessage(
        activeTab === "problem"
          ? "Generate the test generator for the attached problem now. Return the requested structured generator output."
          : "Prepare the solution for the attached problem now. Return the requested structured solution output.",
      );
    }
  }, [
    activeInstance?.problemFile,
    activeInstanceId,
    activeTab,
    isSending,
    messages.length,
    sendMessage,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || isSending) return;
    setInput("");
    await sendMessage(content);
  };

  const handleAttachProblem = async () => {
    try {
      const file = await invoke<ChatAttachment | null>("pick_chat_attachment");
      if (file) attachProblem(file);
    } catch (attachError) {
      console.error("Failed to attach problem statement:", attachError);
    }
  };

  const handleSaveFile = async (content: string) => {
    const generated = parseContent(content);
    if (!generated) return;
    setIsSaving(true);
    try {
      await saveGeneratedFile(
        generated.code,
        generated.language,
        activeTab === "solution" ? "solution" : "generator",
      );
    } catch (saveError) {
      console.error("Failed to save generated file:", saveError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full h-full min-h-0 flex bg-(--bg-primary)">
      <aside className="w-28 shrink-0 border-r border-(--border) bg-(--bg-secondary) p-2 space-y-1">
        {(["problem", "solution"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => selectChatTab(tab)}
            className={`w-full px-2 py-2 rounded text-xs text-left capitalize transition-colors ${
              activeTab === tab
                ? "bg-(--accent-dim) text-(--text-primary)"
                : "text-(--text-muted) hover:bg-(--bg-tertiary) hover:text-(--text-primary)"
            }`}
          >
            {tab}
          </button>
        ))}
      </aside>
      <section className="flex-1 min-w-0 h-full min-h-0 flex flex-col">
        <header className="min-h-12 shrink-0 px-5 py-2 border-b border-(--border) flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-(--text-primary)">
              AI Chat
            </h1>
            <p className="text-[11px] text-(--text-muted)">
              {activeInstance?.problemFile
                ? activeInstance.problemFile.name
                : "Attach a problem statement to begin"}
            </p>
            {activeInstance?.problemFile && (
              <div className="mt-2 flex max-w-72 items-center gap-2 rounded border border-(--accent-dim) bg-(--bg-secondary) px-2 py-1.5 text-xs text-(--text-secondary)">
                <FileText className="h-4 w-4 shrink-0 text-(--accent)" />
                <span className="min-w-0 truncate">
                  {activeInstance.problemFile.name}
                </span>
                <span className="shrink-0 text-[10px] uppercase text-(--text-muted)">
                  {activeInstance.problemFile.mimeType.split("/").pop()}
                </span>
              </div>
            )}
          </div>
          <div
            ref={instanceMenuRef}
            className="relative flex items-center gap-1.5"
          >
            <button
              type="button"
              onClick={() => setIsInstanceMenuOpen((open) => !open)}
              className="max-w-40 h-8 px-2.5 bg-(--bg-input) border border-(--border) rounded text-xs text-(--text-primary) truncate hover:border-(--accent)"
              aria-haspopup="menu"
              aria-expanded={isInstanceMenuOpen}
            >
              {activeInstance?.name ?? "Select instance"}
            </button>
            {isInstanceMenuOpen && (
              <div
                className="absolute right-20 top-10 z-10 w-64 p-1.5 bg-(--bg-secondary) border border-(--border) rounded-lg shadow-xl"
                role="menu"
              >
                {instances.map((instance) => (
                  <div key={instance.id} className="flex items-center gap-1">
                    {editingInstanceId === instance.id ? (
                      <>
                        <input
                          value={editingInstanceName}
                          onChange={(event) =>
                            setEditingInstanceName(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename();
                            if (event.key === "Escape")
                              setEditingInstanceId(null);
                          }}
                          className="min-w-0 flex-1 h-7 px-2 bg-(--bg-input) border border-(--accent) rounded text-xs text-(--text-primary) outline-none"
                          autoFocus
                          aria-label="Instance name"
                        />
                        <button
                          type="button"
                          onClick={commitRename}
                          className="p-1 text-(--success) hover:bg-(--bg-tertiary) rounded"
                          aria-label="Save instance name"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingInstanceId(null)}
                          className="p-1 text-(--text-muted) hover:bg-(--bg-tertiary) rounded"
                          aria-label="Cancel rename"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            selectInstance(instance.id);
                            setIsInstanceMenuOpen(false);
                          }}
                          className={`min-w-0 flex-1 px-2 py-1.5 rounded text-left text-xs truncate ${
                            instance.id === activeInstanceId
                              ? "bg-(--accent-dim) text-(--text-primary)"
                              : "text-(--text-secondary) hover:bg-(--bg-tertiary)"
                          }`}
                          role="menuitem"
                        >
                          {instance.name}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            beginRename(instance.id, instance.name)
                          }
                          className="p-1 text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary) rounded"
                          aria-label={`Rename ${instance.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteInstance(instance.id)}
                          disabled={instances.length === 1 || isSending}
                          className="p-1 text-(--text-muted) hover:text-(--danger) hover:bg-(--bg-tertiary) rounded disabled:opacity-30 disabled:pointer-events-none"
                          aria-label={`Delete ${instance.name}`}
                          title="Delete instance"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={createInstance}
              className="p-2 rounded text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary)"
              title="New instance"
              aria-label="New instance"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleAttachProblem}
              disabled={isSending}
              className="p-2 rounded text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary) disabled:opacity-40"
              title="Attach problem statement"
              aria-label="Attach problem statement"
            >
              <FileUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={clearMessages}
              disabled={messages.length === 0 || isSending}
              className="p-2 rounded text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary) disabled:opacity-40 disabled:pointer-events-none"
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-h-0 overflow-y-auto p-5"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-(--text-muted)">
              <Bot className="w-8 h-8 mb-3 opacity-60" />
              <p className="text-sm">Send a message to start chatting.</p>
              <p className="text-xs mt-1">
                Select a model in Settings before sending.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((message, index) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={`${activeInstanceId}-${activeTab}-${message.role}-${index}`}
                    className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <Bot className="w-4 h-4 mt-2 shrink-0 text-(--accent)" />
                    )}
                    <div className="max-w-[80%]">
                      {!isUser && message.thinking && (
                        <details className="mb-2 rounded-lg border border-(--border) bg-(--bg-secondary) text-xs text-(--text-muted)">
                          <summary className="cursor-pointer select-none px-3 py-1.5">
                            Thinking
                          </summary>
                          <div className="border-t border-(--border) px-3 py-2 whitespace-pre-wrap wrap-break-word opacity-75">
                            {message.thinking}
                          </div>
                        </details>
                      )}
                      <div
                        className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word ${
                          isUser
                            ? "bg-(--accent) text-white"
                            : "bg-(--bg-secondary) border border-(--border) text-(--text-primary)"
                        }`}
                      >
                        {displayResponse(message.content) ||
                          (isSending && index === messages.length - 1
                            ? "Waiting for response..."
                            : "")}
                      </div>
                    </div>
                    {!isUser && !isSending && parseContent(message.content) && (
                      <button
                        type="button"
                        onClick={() => handleSaveFile(message.content)}
                        disabled={isSaving}
                        className="self-end p-2 rounded text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary) disabled:opacity-40"
                        title={`Save and use as ${activeTab}`}
                        aria-label={`Save and use as ${activeTab}`}
                      >
                        <Save className="w-4 h-4" />
                      </button>
                    )}
                    {isUser && (
                      <>
                        <button
                          type="button"
                          onClick={() => resendMessage(index)}
                          disabled={isSending}
                          className="self-end p-1.5 rounded text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary) disabled:opacity-40"
                          title="Resend message"
                          aria-label="Resend message"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <User className="w-4 h-4 mt-2 shrink-0 text-(--text-muted)" />
                      </>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {error && (
          <p className="px-5 pb-2 text-xs text-(--danger)" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="shrink-0 p-4 border-t border-(--border)"
        >
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message the AI..."
              rows={2}
              disabled={isSending}
              className="flex-1 min-h-10 max-h-32 resize-y px-3 py-2 bg-(--bg-input) border border-(--border) rounded text-(--text-primary) text-sm outline-none focus:border-(--accent) disabled:opacity-60"
              aria-label="Message"
            />
            <button
              type="submit"
              disabled={isSending || input.trim() === ""}
              className="self-stretch px-3 rounded bg-(--accent) text-white hover:bg-(--accent-hover) disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Send message"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="max-w-3xl mx-auto mt-1.5 text-[11px] text-(--text-muted)">
            Press Enter to send. Use Shift+Enter for a new line.
          </p>
        </form>
      </section>
    </div>
  );
}
