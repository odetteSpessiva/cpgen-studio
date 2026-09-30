import { usePipelineContext } from "../../context/PipelineContext";

interface SchemaPreviewPanelProps {
  example: string | null;
  onGenerate: () => void;
}

const DISPLAY_LIMIT = 100_000;

export default function SchemaPreviewPanel({
  example,
  onGenerate,
}: SchemaPreviewPanelProps) {
  const { isGenerating } = usePipelineContext();

  const displayExample =
    example && example.length >= DISPLAY_LIMIT
      ? example.slice(0, DISPLAY_LIMIT)
      : example;

  const lines = displayExample ? displayExample.split("\n") : [];

  return (
    <div className="h-full min-h-0 flex flex-col bg-(--bg-primary)">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-(--border)">
        <span className="text-(--text-muted) text-[12px] uppercase tracking-wide">
          Example Output
        </span>
        <button
          type="button"
          onClick={onGenerate}
          className="px-2.5 py-1 bg-(--accent) hover:bg-(--accent-hover) text-white rounded text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          disabled={isGenerating}
        >
          Generate
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {example ? (
          <div className="flex flex-col min-h-full">
            <div className="flex-1 flex min-w-full w-max">
              <div className="sticky left-0 z-10 shrink-0 select-none text-right px-3 py-3 font-mono text-xs text-(--text-muted) opacity-60 bg-(--bg-secondary) border-r border-(--border) leading-5">
                {lines.map((_, idx) => (
                  <div key={idx}>{idx + 1}</div>
                ))}
              </div>
              <div className="flex-1 p-3 font-mono text-xs text-(--text-primary) whitespace-pre leading-5">
                {lines.map((line, idx) => (
                  <div key={idx}>{line || "\u00A0"}</div>
                ))}
              </div>
            </div>
            {example.length > DISPLAY_LIMIT && (
              <p className="shrink-0 text-(--text-muted) text-xs p-3 border-t border-(--border) bg-(--bg-primary)">
                Showing first {DISPLAY_LIMIT.toLocaleString()} of{" "}
                {example.length.toLocaleString()} characters.
              </p>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-(--text-muted) text-sm text-center">
            Click Generate to preview an example test case.
          </div>
        )}
      </div>
    </div>
  );
}
