import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

interface DownloadProgress {
  downloaded: number;
  total: number;
  elapsed_ms: number;
}

interface DownloadMeta {
  bytesPerSec: number;
  etaSec: number | null;
}

interface MingwDownloadModalProps {
  onCancel: () => void;
  onDownload: () => Promise<void>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatEta(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}

let prev: { downloaded: number; elapsed_ms: number } | null = null;

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
    elapsed_ms: 0,
  });
  const [downloadMeta, setDownloadMeta] = useState<DownloadMeta>({
    bytesPerSec: 0,
    etaSec: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unlisten = listen<DownloadProgress>(
      "mingw-install-progress",
      (event) => {
        if (!active) return;
        const { downloaded, total, elapsed_ms } = event.payload;
        if (prev && elapsed_ms > prev.elapsed_ms) {
          const bytesDelta = downloaded - prev.downloaded;
          const timeDeltaSec = (elapsed_ms - prev.elapsed_ms) / 1000;
          const bytesPerSec = bytesDelta / timeDeltaSec;
          const etaSec =
            total > 0 && bytesPerSec > 0
              ? (total - downloaded) / bytesPerSec
              : null;
          setDownloadMeta({ etaSec: etaSec, bytesPerSec: bytesPerSec });
        }
        if (!prev || elapsed_ms > prev.elapsed_ms)
          prev = { downloaded, elapsed_ms };
        if (total > 0 && downloaded >= total) {
          setPhase("extracting");
        }
        setProgress((current) =>
          elapsed_ms >= current.elapsed_ms ? event.payload : current,
        );
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
        {phase === "downloading" && (
          <div className="mt-1 flex justify-between text-[12px] text-(--text-muted)">
            <span>
              {downloadMeta.bytesPerSec > 0
                ? `${formatBytes(downloadMeta.bytesPerSec)}/s`
                : "Starting..."}
            </span>
            <span>{formatEta(downloadMeta.etaSec)}</span>
          </div>
        )}

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
