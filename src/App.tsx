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

  // Keep latest blob URLs in refs so we only revoke on replace/unmount — not Strict Mode double-mount
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

  // Single unmount cleanup for blob URLs
  useEffect(() => {
    return () => {
      revokeQuiet(previewRef.current);
      revokeQuiet(afterRef.current);
    };
  }, []);

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
      // Ensure original preview still exists for images (recreate if needed)
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

      // Do not revoke enhanced.objectUrl here — owned by afterRef
      setAfter(enhanced.objectUrl);
      setResult(enhanced);

      // Recreate original preview if it was lost so compare works
      if (job.isImage && !previewRef.current) {
        setPreview(URL.createObjectURL(file));
      }

      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: "done",
              progress: 100,
              stageLabel: "Done",
              message:
                enhanced.kind === "image"
                  ? `Enhanced to ${enhanced.width}×${enhanced.height}. Drag to compare, then download.`
                  : `Enhanced video ${enhanced.width}×${enhanced.height}. Download when ready.`,
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
          <div className="landing-brand">
            <FoxMark />
            Foxy&apos;s Lab
          </div>

          <h1>Foxy&apos;s Premium Upscaling</h1>

          <p className="landing-lede">
            Upscale videos or images with AI-style enhancement in your browser —
            free, private, automatic. Files never leave your device.
          </p>

          {!hasFile ? (
            <>
              <DropZone onFile={onFile} disabled={busy} variant="landing" />

              <div className="landing-trust">
                <span className="trust-chip">
                  <strong>One click</strong> — no settings
                </span>
                <span className="trust-chip">
                  <strong>2×</strong> local enhance
                </span>
                <span className="trust-chip">
                  <strong>No</strong> upload · no watermark
                </span>
              </div>
            </>
          ) : (
            <div className="simple-workspace">
              <div className="file-chip simple-file">
                <div>
                  <strong>{job!.fileName}</strong>
                  <span>
                    {formatBytes(job!.fileSize)}
                    {job!.isVideo ? " · video" : job!.isImage ? " · image" : ""}
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

              {(previewUrl || afterUrl || job!.isImage) && (
                <div className="simple-compare">
                  <CompareSlider
                    beforeUrl={previewUrl}
                    afterUrl={afterUrl}
                    emptyHint={
                      job!.isVideo
                        ? "Video: press Enhance, then download. Frame compare works best for images."
                        : "Press Enhance, then drag — left original, right enhanced."
                    }
                  />
                </div>
              )}

              {job!.isVideo && !previewUrl && !afterUrl && (
                <p className="simple-done-note">
                  Video selected. Enhancement runs fully on your device (2× +
                  clarity). Output downloads as WebM.
                </p>
              )}

              <div className="simple-actions">
                <button
                  type="button"
                  className="dropzone-btn"
                  disabled={!ready || busy}
                  onClick={start}
                >
                  {busy ? "Enhancing…" : done ? "Enhance again" : "Enhance"}
                </button>
                {done && (
                  <button
                    type="button"
                    className="dropzone-btn download-btn"
                    onClick={onDownload}
                  >
                    Download
                  </button>
                )}
              </div>

              <ProgressPanel job={job} />

              {error && (
                <div className="notice warn">
                  <strong>Could not enhance.</strong> {error}
                </div>
              )}

              {!ready && caps && (
                <div className="notice warn">
                  <strong>Browser not ready.</strong> WebGL is required. Use
                  Chrome or Edge on a computer.{" "}
                  <span className="muted">{caps.details.join(" · ")}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

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
