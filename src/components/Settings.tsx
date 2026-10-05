import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAIContext } from "../context/AIContext";
import { useSettingsContext } from "../context/SettingsContext";
import type { AIProvider, SettingKey, ThinkingEffort } from "../types";
import MingwDownloadModal from "./MingwDownloadModal";
import Section from "./Section";

const ROW_CLASS = "flex items-center gap-3 mb-3 items-start";
const LABEL_CLASS =
  "w-[85px] text-[13px] text-(--text-secondary) shrink-0 text-right pt-1.5";
const INPUT_CLASS =
  "w-full h-8 px-2.5 bg-(--bg-input) border border-(--border) rounded text-(--text-primary) text-[13px] outline-none focus:border-(--accent) focus:ring-2 focus:ring-[rgba(59,130,246,0.15)]";

const FONT_OPTIONS = [
  {
    label: "SF Mono",
    value:
      '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
  },
  {
    label: "JetBrains Mono",
    value: '"JetBrains Mono", "Fira Code", Consolas, monospace',
  },
  {
    label: "System Monospace",
    value: "ui-monospace, Menlo, Consolas, monospace",
  },
];

const AI_PROVIDERS = [
  { label: "OpenAI", value: "openai" },
  { label: "Google", value: "google" },
  { label: "Anthropic", value: "anthropic" },
];

const THINKING_EFFORTS: ThinkingEffort[] = ["low", "medium", "high"];

const THINKING_BUDGET_HINTS: Record<AIProvider, string> = {
  openai:
    "OpenRouter only. Reasoning max tokens; 0 uses the effort level instead.",
  google: "Thinking tokens. -1 lets the model decide, 0 disables thinking.",
  anthropic: "Budget tokens. At least 1024 and below max tokens.",
};

const COMPILER_ARGS_OPTIONS = [
  {
    label: "Legacy (C++98)",
    value: "-std=c++98 -O2",
  },
  {
    label: "Standard (C++14)",
    value: "-std=c++14 -O2",
  },
  {
    label: "Modern (C++20)",
    value: "-std=c++20 -O2",
  },
];

function useCommittedSetting<T extends number | string | boolean>(
  key: SettingKey,
  currentValue: T,
  onSettingChange: (key: SettingKey, value: number | string | boolean) => void,
  parse: (raw: string) => T | null,
  clamp?: (value: T) => T,
) {
  const [prevValue, setPrevValue] = useState(currentValue);
  const [inputValue, setInputValue] = useState(String(currentValue));

  if (currentValue !== prevValue) {
    setPrevValue(currentValue);
    setInputValue(String(currentValue));
  }

  const commit = (raw: string = inputValue) => {
    const parsed = parse(raw);
    const next =
      parsed === null ? currentValue : clamp ? clamp(parsed) : parsed;
    setInputValue(String(next));
    if (next !== currentValue) onSettingChange(key, next);
  };

  const commitValue = (value: T) => {
    if (value !== currentValue) onSettingChange(key, value);
  };

  return {
    inputValue,
    setInputValue,
    commit,
    value: currentValue,
    commitValue,
  };
}

const parseNumber = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
const clampFontSize = (n: number) => Math.min(32, Math.max(8, Math.round(n)));

const parseString = (raw: string): string | null => {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
};

type SettingValue = number | string | boolean;

interface SettingFieldProps<T extends SettingValue> {
  label: string;
  field: {
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    commit: (raw?: string) => void;
    value: T;
    commitValue: (value: T) => void;
  };
  boolean?: boolean;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  children?: React.ReactNode;
}

function SettingField<T extends SettingValue>({
  label,
  field,
  boolean = false,
  inputProps,
  children,
}: SettingFieldProps<T>) {
  if (boolean) {
    return (
      <div className="flex items-center gap-3 mb-3 whitespace-nowrap">
        <label className="w-21.25 text-[13px] text-(--text-secondary) shrink-0 text-right whitespace-nowrap">
          {label}
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={field.value as boolean}
          aria-label={label}
          onClick={() => {
            const nextValue = !(field.value as boolean);
            field.commitValue(nextValue as T);
          }}
          className={`relative h-5 w-9 shrink-0 overflow-hidden rounded-full border transition-colors ${field.value ? "border-(--accent) bg-(--accent)" : "border-(--border) bg-(--bg-input)"}`}
        >
          <span
            className="absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform"
            style={{
              transform: `translateX(${field.value ? 20 : 2}px)`,
            }}
          />
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className={ROW_CLASS}>
      <label className={LABEL_CLASS}>{label}</label>
      <div className="flex-1 min-w-0">
        <input
          className={INPUT_CLASS}
          value={field.inputValue}
          onChange={(event) => field.setInputValue(event.target.value)}
          onBlur={() => field.commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          {...inputProps}
        />
        {children}
      </div>
    </div>
  );
}

export default function Settings() {
  const {
    fontSize,
    fontFamily,
    formatOnSave,
    gppPath,
    compilerArgs,
    pythonPath,
    clangdPath,
    aiProvider,
    aiAutoMode,
    aiBaseUrl,
    aiModel,
    aiJsonMode,
    aiThinking,
    aiThinkingEffort,
    aiThinkingBudget,
    anthropicMaxTokens,
    onSettingChange,
    error,
    setError,
  } = useSettingsContext();

  const {
    keyStatus,
    models,
    isFetchingModels,
    saveKey,
    getKey,
    deleteKey,
    fetchModels,
    error: aiError,
  } = useAIContext();

  const fontSizeField = useCommittedSetting(
    "fontSize",
    fontSize,
    onSettingChange,
    parseNumber,
    clampFontSize,
  );

  const fontFamilyField = useCommittedSetting(
    "fontFamily",
    fontFamily,
    onSettingChange,
    parseString,
  );

  const formatOnSaveField = useCommittedSetting(
    "formatOnSave",
    formatOnSave,
    onSettingChange,
    (raw) => (raw === "true" ? true : raw === "false" ? false : null),
  );

  const gppPathField = useCommittedSetting(
    "gppPath",
    gppPath,
    onSettingChange,
    parseString,
  );

  const compilerArgsField = useCommittedSetting(
    "compilerArgs",
    compilerArgs,
    onSettingChange,
    parseString,
  );

  const pythonPathField = useCommittedSetting(
    "pythonPath",
    pythonPath,
    onSettingChange,
    parseString,
  );

  const clangdPathField = useCommittedSetting(
    "clangdPath",
    clangdPath,
    onSettingChange,
    parseString,
  );

  const aiBaseUrlField = useCommittedSetting(
    `${aiProvider}BaseUrl`,
    aiBaseUrl,
    onSettingChange,
    parseString,
  );

  const aiJsonModeField = useCommittedSetting(
    `${aiProvider}JsonMode`,
    aiJsonMode,
    onSettingChange,
    (raw) => (raw === "true" ? true : raw === "false" ? false : null),
  );

  const aiAutoModeField = useCommittedSetting(
    "aiAutoMode",
    aiAutoMode,
    onSettingChange,
    (raw) => (raw === "true" ? true : raw === "false" ? false : null),
  );

  const aiThinkingField = useCommittedSetting(
    `${aiProvider}Thinking`,
    aiThinking,
    onSettingChange,
    (raw) => (raw === "true" ? true : raw === "false" ? false : null),
  );

  const aiThinkingBudgetField = useCommittedSetting(
    `${aiProvider}ThinkingBudget`,
    aiThinkingBudget,
    onSettingChange,
    parseNumber,
    (n) => Math.round(n),
  );

  const anthropicMaxTokensField = useCommittedSetting(
    "anthropicMaxTokens",
    anthropicMaxTokens,
    onSettingChange,
    parseNumber,
    (n) => Math.max(1, Math.round(n)),
  );

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const providerHasKey = keyStatus[aiProvider];
  const providerModels = models[aiProvider] ?? [];

  useEffect(() => {
    let cancelled = false;
    void getKey(aiProvider).then((key) => {
      if (!cancelled) setApiKeyInput(key);
    });
    return () => {
      cancelled = true;
    };
  }, [aiProvider, getKey]);

  const saveApiKey = async () => {
    const value = apiKeyInput.trim();
    if (value === "") return;
    if (await saveKey(aiProvider, value)) setApiKeyInput(value);
  };

  const [compilerIsValid, setCompilerIsValid] = useState(true);
  const [showMingwDownload, setShowMingwDownload] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke<boolean>("check_compiler", { gppPath }).then((valid) => {
      if (active) setCompilerIsValid(valid);
    });
    return () => {
      active = false;
    };
  }, [gppPath]);

  const downloadMingw = useCallback(async () => {
    const downloadedCompilerPath = await invoke<string>("download_mingw");
    await onSettingChange("gppPath", downloadedCompilerPath);
    setCompilerIsValid(true);
    setShowMingwDownload(false);
  }, [onSettingChange]);

  const cancelMingwDownload = useCallback(async () => {
    await invoke("cancel_mingw");
    setShowMingwDownload(false);
  }, []);

  return (
    <div className="h-full flex items-center justify-center p-6 bg-(--bg-primary)">
      <div className="w-full h-full rounded-lg border border-(--border) bg-(--bg-tertiary) p-6">
        {error && (
          <div className="mb-4 px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-[13px] flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 text-red-400/70 hover:text-red-400 leading-none"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
        <Section title="Editor">
          <SettingField
            label="Font size"
            field={fontSizeField}
            inputProps={{ type: "number", min: 8, max: 32 }}
          />

          <SettingField
            label="Font family"
            field={fontFamilyField}
            inputProps={{
              type: "text",
              autoComplete: "off",
              placeholder: '"Fira Code", monospace',
            }}
          >
            <div className="flex gap-1.5 mt-1.5">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => fontFamilyField.commit(opt.value)}
                  className="px-2 py-1 text-[11px] rounded border border-(--border) text-(--text-muted) hover:text-(--text-primary) hover:border-(--accent)"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </SettingField>

          <SettingField label="Auto format" field={formatOnSaveField} boolean />
        </Section>

        <Section title="Compiler">
          <SettingField
            label="G++ path"
            field={gppPathField}
            inputProps={{
              type: "text",
              autoComplete: "off",
              placeholder: "g++",
            }}
          />
          {!compilerIsValid && (
            <div className="ml-24.25 -mt-1 mb-3 flex items-center justify-between gap-3 text-[12px] text-(--warning)">
              <span>Compiler path is not a working g++.</span>
              <button
                type="button"
                onClick={() => setShowMingwDownload(true)}
                className="shrink-0 rounded border border-(--warning)/50 px-2 py-1 text-(--warning) hover:bg-(--warning)/10"
              >
                Download MinGW
              </button>
            </div>
          )}
          <SettingField
            label="Compiler args"
            field={compilerArgsField}
            inputProps={{
              type: "text",
              autoComplete: "off",
              placeholder: "-O2",
            }}
          >
            <div className="flex gap-1.5 mt-1.5">
              {COMPILER_ARGS_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => compilerArgsField.commit(opt.value)}
                  className="px-2 py-1 text-[11px] rounded border border-(--border) text-(--text-muted) hover:text-(--text-primary) hover:border-(--accent)"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </SettingField>
          <SettingField
            label="Python path"
            field={pythonPathField}
            inputProps={{
              type: "text",
              autoComplete: "off",
              placeholder: "python",
            }}
          />
        </Section>

        <Section title="Language Servers">
          <SettingField
            label="clangd path"
            field={clangdPathField}
            inputProps={{
              type: "text",
              autoComplete: "off",
              placeholder: "clangd",
            }}
          />
        </Section>

        <Section title="AI">
          <div className={ROW_CLASS}>
            <label className={LABEL_CLASS}>Provider</label>
            <div className="flex flex-1 min-w-0 gap-1.5 pt-1">
              {AI_PROVIDERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onSettingChange("aiProvider", opt.value);
                    setApiKeyInput("");
                  }}
                  className={`px-2 py-1 text-[11px] rounded border hover:text-(--text-primary) hover:border-(--accent) ${aiProvider === opt.value ? "border-(--accent) text-(--text-primary)" : "border-(--border) text-(--text-muted)"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <SettingField
            label="Base URL"
            field={aiBaseUrlField}
            inputProps={{
              type: "text",
              autoComplete: "off",
              placeholder: "https://api.example.com/v1",
            }}
          />

          <div className={ROW_CLASS}>
            <label className={LABEL_CLASS}>API key</label>
            <div className="flex flex-1 min-w-0 gap-1.5">
              <div className="relative flex-1 min-w-0">
                <input
                  className={`${INPUT_CLASS} pr-8 [&::-ms-reveal]:hidden`}
                  type={showApiKey ? "text" : "password"}
                  autoComplete="off"
                  value={apiKeyInput}
                  placeholder="Paste API key"
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveApiKey();
                  }}
                />
                <button
                  type="button"
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  onClick={() => setShowApiKey((prev) => !prev)}
                  className="absolute top-0 right-0 flex items-center justify-center w-8 h-8 text-(--text-muted) hover:text-(--text-primary)"
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                disabled={apiKeyInput.trim() === ""}
                onClick={() => void saveApiKey()}
                className="shrink-0 h-8 px-3 text-[12px] rounded border border-(--border) text-(--text-muted) hover:text-(--text-primary) hover:border-(--accent) disabled:opacity-50 disabled:pointer-events-none"
              >
                Save
              </button>
              {providerHasKey && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await deleteKey(aiProvider)) setApiKeyInput("");
                  }}
                  className="shrink-0 h-8 px-3 text-[12px] rounded border border-(--border) text-(--text-muted) hover:text-red-400 hover:border-red-400"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className={ROW_CLASS}>
            <label className={LABEL_CLASS}>Model</label>
            <div className="flex flex-1 min-w-0 gap-1.5">
              <select
                className={INPUT_CLASS}
                value={aiModel}
                onChange={(event) =>
                  onSettingChange(`${aiProvider}Model`, event.target.value)
                }
              >
                <option value="">
                  {providerModels.length === 0
                    ? "Fetch models to choose"
                    : "Select a model"}
                </option>
                {aiModel !== "" &&
                  !providerModels.some((m) => m.id === aiModel) && (
                    <option value={aiModel}>{aiModel}</option>
                  )}
                {providerModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!providerHasKey || isFetchingModels}
                onClick={() => void fetchModels(aiProvider, aiBaseUrl)}
                className="shrink-0 h-8 px-3 text-[12px] rounded border border-(--border) text-(--text-muted) hover:text-(--text-primary) hover:border-(--accent) disabled:opacity-50 disabled:pointer-events-none"
              >
                {isFetchingModels
                  ? `Fetching (${providerModels.length})`
                  : "Fetch"}
              </button>
            </div>
          </div>

          {aiProvider !== "anthropic" && (
            <SettingField label="JSON mode" field={aiJsonModeField} boolean>
              <span className="text-[11px] text-(--text-muted)">
                Force valid JSON output. Unsupported models may reject it
              </span>
            </SettingField>
          )}

          {aiError && (
            <div className="ml-24.25 mb-3 text-[12px] text-red-400">
              {aiError}
            </div>
          )}
          <SettingField label="Auto mode" field={aiAutoModeField} boolean>
            <span className="text-[11px] text-(--text-muted)">
              Save generated files under ~/cpgen-studio automatically
            </span>
          </SettingField>

          <SettingField label="Thinking" field={aiThinkingField} boolean>
            <span className="text-[11px] text-(--text-muted)">
              Unsupported models may reject the request
            </span>
          </SettingField>

          {aiProvider === "openai" && (
            <div className={ROW_CLASS}>
              <label className={LABEL_CLASS}>Effort</label>
              <div className="flex flex-1 min-w-0 gap-1.5 pt-1">
                {THINKING_EFFORTS.map((effort) => (
                  <button
                    key={effort}
                    type="button"
                    onClick={() =>
                      onSettingChange(`${aiProvider}ThinkingEffort`, effort)
                    }
                    className={`px-2 py-1 text-[11px] capitalize rounded border hover:text-(--text-primary) hover:border-(--accent) ${aiThinkingEffort === effort ? "border-(--accent) text-(--text-primary)" : "border-(--border) text-(--text-muted)"}`}
                  >
                    {effort}
                  </button>
                ))}
              </div>
            </div>
          )}

          <SettingField
            label="Budget"
            field={aiThinkingBudgetField}
            inputProps={{ type: "number", step: 1 }}
          >
            <div className="mt-1.5 text-[11px] text-(--text-muted)">
              {THINKING_BUDGET_HINTS[aiProvider]}
            </div>
          </SettingField>

          {aiProvider === "anthropic" && (
            <SettingField
              label="Max tokens"
              field={anthropicMaxTokensField}
              inputProps={{ type: "number", min: 1, step: 1 }}
            >
              <div className="mt-1.5 text-[11px] text-(--text-muted)">
                Output cap per reply, thinking included.
              </div>
            </SettingField>
          )}
        </Section>
      </div>
      {showMingwDownload && (
        <MingwDownloadModal
          onCancel={() => void cancelMingwDownload()}
          onDownload={downloadMingw}
        />
      )}
    </div>
  );
}
