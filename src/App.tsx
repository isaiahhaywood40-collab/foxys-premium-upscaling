import { useEffect, useMemo, useRef, useState } from "react";
import {
  canEnhanceVideo,
  canRunLocalUpscale,
  detectCapabilities,
  type BrowserCapabilities,
} from "./lib/capabilities";
import {
  createJobFromFile,
  formatBytes,
  type UpscaleJob,
} from "./lib/job";
import {
  downloadBlob,
  enhanceMedia,
  type EnhanceResult,
} from "./lib/enhance";
import { CompareSlider } from "./ui/CompareSlider";
import { DetailCrops } from "./ui/DetailCrops";
import { DropZone } from "./ui/DropZone";
import { ProgressPanel } from "./ui/ProgressPanel";

function FoxMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 64 64" aria-hidden>
      <path d="M22 24l-6-8 10 4 6-6 6 6 10-4-6 8" fill="#f97316" />
      <path d="M18 38c0-8 6-14 14-14s14 6 14 14v2H18v-2z" fill="#ea580c" />
      <circle cx="28" cy="34" r="2" fill="#fff" />
      <circle cx="36" cy="34" r="2" fill="#fff" />
    </svg>
  );
}

function revokeQuiet(url: string | null | undefined) {
  if (!url || !url.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [caps, setCaps] = useState<BrowserCapabilities | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [result, setResult] = useState<EnhanceResult | null>(null);
  const [job, setJob] = useState<UpscaleJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const previewRef = useRef<string | null>(null);
  const afterRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectCapabilities().then((c) => {
      if (!cancelled) setCaps(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      revokeQuiet(previewRef.current);
      revokeQuiet(afterRef.current);
    };
  }, []);

  // Escape closes fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const ready = useMemo(
    () => (caps ? canRunLocalUpscale(caps) : false),
    [caps],
  );

  const setPreview = (url: string | null) => {
    if (previewRef.current && previewRef.current !== url) {
      revokeQuiet(previewRef.current);
    }
    previewRef.current = url;
    setPreviewUrl(url);
  };

  const setAfter = (url: string | null) => {
    if (afterRef.current && afterRef.current !== url) {
      revokeQuiet(afterRef.current);
    }
    afterRef.current = url;
    setAfterUrl(url);
  };

  const onFile = (f: File) => {
    setResult(null);
    setError(null);
    setAfter(null);
    setFullscreen(false);

    const isImage =
      f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);

    if (isImage) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }

    setFile(f);
    setJob(createJobFromFile(f));
  };

  const clear = () => {
    setPreview(null);
    setAfter(null);
    setResult(null);
    setFile(null);
    setJob(null);
    setBusy(false);
    setError(null);
    setFullscreen(false);
  };

  const start = async () => {
    if (!file || !job || busy || !caps) return;
    if (!ready) return;

    if (job.isVideo && !canEnhanceVideo(caps)) {
      setError("This browser cannot export video. Try Chrome or Edge.");
      return;
    }

    setBusy(true);
    setError(null);
    setAfter(null);
    setResult(null);

    setJob({
      ...job,
      status: "running",
      progress: 0,
      stageLabel: "Starting",
      message: "Preparing…",
    });

    try {
      if (job.isImage && !previewRef.current) {
        setPreview(URL.createObjectURL(file));
      }

      const enhanced = await enhanceMedia(file, (p) => {
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: "running",
                progress: p.progress,
                stageLabel: p.phase,
                message: `${p.phase}…`,
              }
            : prev,
        );
      });

      setAfter(enhanced.objectUrl);
      setResult(enhanced);

      // Free.upscaler style compare: left = bilinear 2× original, right = AI 2×
      if (
        "compareBeforeUrl" in enhanced &&
        typeof enhanced.compareBeforeUrl === "string" &&
        enhanced.compareBeforeUrl
      ) {
        setPreview(enhanced.compareBeforeUrl);
      } else if (job.isImage && !previewRef.current) {
        setPreview(URL.createObjectURL(file));
      }

      const eng =
        "engine" in enhanced ? (enhanced as { engine: string }).engine : "";
      const net =
        "network" in enhanced
          ? (enhanced as { network?: string }).network
          : undefined;
      const engineLabel =
        eng === "esrgan"
          ? ` · ESRGAN AI (${net || "thick"}) — strong`
          : eng === "websr"
            ? ` · WebSR (${net || "Anime4K"})`
            : " · WebGL fallback (mild)";

      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: "done",
              progress: 100,
              stageLabel: "Done",
              message: `Enhanced to ${enhanced.width}×${enhanced.height}${engineLabel}`,
            }
          : prev,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              progress: 0,
              stageLabel: "Error",
              message: msg,
            }
          : prev,
      );
    } finally {
      setBusy(false);
    }
  };

  const onDownload = () => {
    if (!result) return;
    downloadBlob(result.blob, result.downloadName);
  };

  const hasFile = Boolean(file && job);
  const done = job?.status === "done" && Boolean(result);

  return (
    <div className="app">
      <main className="app-main">
        <div className="landing">
          {/* Hide big title chrome once in result mode for cleaner competitor-like focus */}
          {!done && (
            <>
              <div className="landing-brand">
                <FoxMark />
                Foxy&apos;s Lab
              </div>
              <h1>Foxy&apos;s Premium Upscaling</h1>
              <p className="landing-lede">
                Upscale videos or images in your browser — free, private,
                automatic. Files never leave your device.
              </p>
            </>
          )}

          {done && (
            <div className="landing-brand result-brand">
              <FoxMark />
              Foxy&apos;s Premium Upscaling
            </div>
          )}

          {!hasFile ? (
            <>
              <DropZone onFile={onFile} disabled={busy} variant="landing" />
              <div className="landing-trust">
                <span className="trust-chip">
                  <strong>One click</strong> — no settings
                </span>
                <span className="trust-chip">
                  <strong>Local</strong> AI-style enhance
                </span>
                <span className="trust-chip">
                  <strong>No</strong> watermark
                </span>
              </div>
            </>
          ) : done ? (
            /* ——— Competitor-style result card ——— */
            <div className="result-card">
              <CompareSlider
                beforeUrl={previewUrl}
                afterUrl={afterUrl}
                compact
              />

              {"cropBeforeUrl" in (result ?? {}) &&
                result &&
                "cropBeforeUrl" in result &&
                result.cropBeforeUrl &&
                result.cropAfterUrl && (
                  <DetailCrops
                    beforeUrl={result.cropBeforeUrl}
                    afterUrl={result.cropAfterUrl}
                  />
                )}

              <button
                type="button"
                className="btn-fullscreen"
                onClick={() => setFullscreen(true)}
              >
                <span className="fs-icon" aria-hidden>
                  ⛶
                </span>
                View Fullscreen Comparison
              </button>

              <div className="result-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={clear}
                >
                  Upscale another
                  <span aria-hidden> ↻</span>
                </button>
                <button
                  type="button"
                  className="btn-primary-solid"
                  onClick={onDownload}
                >
                  Download upscaled {result?.kind === "video" ? "video" : "image"}
                  <span aria-hidden> ↓</span>
                </button>
              </div>

              {result && (
                <p className="result-meta">
                  {result.width}×{result.height}
                  {"engine" in result
                    ? result.engine === "websr"
                      ? ` · WebSR ${"network" in result && result.network ? result.network : ""}`
                      : " · WebGL fallback"
                    : ""}
                  {"elapsedMs" in result && result.elapsedMs
                    ? ` · ${(result.elapsedMs / 1000).toFixed(1)}s`
                    : ""}
                  {job?.fileName ? ` · ${job.fileName}` : ""}
                </p>
              )}
            </div>
          ) : (
            /* ——— Working state: file + enhance ——— */
            <div className="simple-workspace">
              <div className="file-chip simple-file">
                <div>
                  <strong>{job!.fileName}</strong>
                  <span>
                    {formatBytes(job!.fileSize)}
                    {job!.isVideo ? " · video" : " · image"}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost sm"
                  onClick={clear}
                  disabled={busy}
                >
                  Choose another
                </button>
              </div>

              {previewUrl && !busy && (
                <div className="pre-enhance-thumb">
                  <img src={previewUrl} alt="Selected" />
                </div>
              )}

              {job!.isVideo && !previewUrl && (
                <p className="simple-done-note">
                  Video selected. Runs fully on your device. Output: WebM.
                </p>
              )}

              <div className="simple-actions">
                <button
                  type="button"
                  className="dropzone-btn"
                  disabled={!ready || busy}
                  onClick={start}
                >
                  {busy ? "Upscaling…" : "Upscale"}
                </button>
              </div>

              <ProgressPanel job={job} />

              {error && (
                <div className="notice warn">
                  <strong>Could not enhance.</strong> {error}
                </div>
              )}

              {!ready && caps && (
                <div className="notice warn">
                  <strong>Browser not ready.</strong> Use Chrome or Edge.{" "}
                  <span className="muted">{caps.details.join(" · ")}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {fullscreen && (previewUrl || afterUrl) && (
        <div
          className="fs-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen comparison"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="fs-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fs-top">
              <span>Fullscreen comparison</span>
              <button
                type="button"
                className="ghost sm"
                onClick={() => setFullscreen(false)}
              >
                Close ✕
              </button>
            </div>
            <CompareSlider
              beforeUrl={previewUrl}
              afterUrl={afterUrl}
              compact
              className="fs-track"
            />
          </div>
        </div>
      )}

      <footer className="site-footer">
        <div className="site-footer-inner">
          <a
            href="https://github.com/foxys-lab/foxys-premium-upscaling"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
          <span className="sep">|</span>
          <a
            href="https://github.com/foxys-lab/foxys-premium-upscaling/issues"
            target="_blank"
            rel="noreferrer"
          >
            Feedback
          </a>
          <span className="sep">|</span>
          <span>© Foxy&apos;s Lab · Free · Private · On-device</span>
        </div>
      </footer>
    </div>
  );
}
