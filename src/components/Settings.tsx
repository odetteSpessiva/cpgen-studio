import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useSettingsContext } from "../context/SettingsContext";
import type { SettingKey } from "../types";
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

const parseFontSize = (raw: string): number | null => {
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
    onSettingChange,
    error,
    setError,
  } = useSettingsContext();

  const fontSizeField = useCommittedSetting(
    "fontSize",
    fontSize,
    onSettingChange,
    parseFontSize,
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
