import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

interface DownloadProgress {
  downloaded: number;
  total: number;
}

interface MingwDownloadModalProps {
  onCancel: () => void;
  onDownload: () => Promise<void>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MingwDownloadModal({
  onCancel,
  onDownload,
}: MingwDownloadModalProps) {
  const downloadStarted = useRef(false);
  const [phase, setPhase] = useState<"downloading" | "extracting">(
    "downloading",
  );
  const [progress, setProgress] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unlisten = listen<DownloadProgress>(
      "mingw-install-progress",
      (event) => {
        if (active) {
          if (
            event.payload.total > 0 &&
            event.payload.downloaded >= event.payload.total
          ) {
            setPhase("extracting");
          }
          setProgress((current) =>
            event.payload.downloaded >= current.downloaded
              ? event.payload
              : current,
          );
        }
      },
    );

    if (downloadStarted.current)
      return () => {
        active = false;
        void unlisten.then((cleanup) => cleanup());
      };
    downloadStarted.current = true;
    void onDownload().catch((downloadError) => {
      if (active && String(downloadError) !== "Download canceled") {
        setError(String(downloadError));
      }
    });

    return () => {
      active = false;
      void unlisten.then((cleanup) => cleanup());
    };
  }, [onDownload]);

  const percentage =
    progress.total > 0
      ? Math.min(100, (progress.downloaded / progress.total) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mingw-download-title"
        className="w-full max-w-md rounded-lg border border-(--border-light) bg-(--bg-tertiary) p-5 shadow-2xl"
      >
        <h2 id="mingw-download-title" className="m-0 text-base font-medium">
          Download MinGW
        </h2>
        <p className="mt-2 text-[13px] text-(--text-secondary)">
          The configured compiler is unavailable or is not a working g++.
          Download the bundled compiler archive to continue.
        </p>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-(--bg-input)">
          <div
            className={`h-full bg-(--accent) ${phase === "extracting" ? "w-full animate-pulse" : "transition-[width] duration-150"}`}
            style={
              phase === "extracting" ? undefined : { width: `${percentage}%` }
            }
          />
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-(--text-muted)">
          <span>
            {phase === "extracting"
              ? "Download complete"
              : formatBytes(progress.downloaded)}
            {phase === "downloading" &&
              progress.total > 0 &&
              ` of ${formatBytes(progress.total)}`}
          </span>
          <span>
            {phase === "extracting"
              ? "Extracting compiler..."
              : progress.total > 0
                ? `${Math.round(percentage)}%`
                : "Starting..."}
          </span>
        </div>

        {error && <p className="mt-3 text-[13px] text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-(--border) px-3 py-1.5 text-[13px] text-(--text-secondary) hover:border-(--accent) hover:text-(--text-primary)"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
