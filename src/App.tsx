import { useEffect, useMemo, useState } from "react";
import {
  canRunLocalUpscale,
  detectCapabilities,
  type BrowserCapabilities,
} from "./lib/capabilities";
import {
  createJobFromFile,
  formatBytes,
  runDemoPipeline,
  type UpscaleJob,
} from "./lib/job";
import {
  estimatePipelineCost,
  type StageId,
} from "./lib/pipeline";
import {
  getPreset,
  pipelineFromStrengths,
  PRESETS,
  type PresetId,
} from "./lib/presets";
import { CapabilityBadges } from "./ui/CapabilityBadges";
import { CompareSlider } from "./ui/CompareSlider";
import { DropZone } from "./ui/DropZone";
import { PresetCards } from "./ui/PresetCards";
import { ProgressPanel } from "./ui/ProgressPanel";
import { StageControls } from "./ui/StageControls";

const PRESET_STORAGE_KEY = "foxy-premium-upscaling-preset";

export default function App() {
  const [caps, setCaps] = useState<BrowserCapabilities | null>(null);
  const [presetId, setPresetId] = useState<PresetId>(() => {
    try {
      const saved = localStorage.getItem(PRESET_STORAGE_KEY) as PresetId | null;
      if (saved && PRESETS.some((p) => p.id === saved)) return saved;
    } catch {
      /* ignore */
    }
    return "balanced";
  });
  const [strengths, setStrengths] = useState(() => {
    try {
      const saved = localStorage.getItem(PRESET_STORAGE_KEY) as PresetId | null;
      if (saved && PRESETS.some((p) => p.id === saved)) {
        return { ...getPreset(saved).strengths };
      }
    } catch {
      /* ignore */
    }
    return { ...getPreset("balanced").strengths };
  });
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [job, setJob] = useState<UpscaleJob | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const ready = useMemo(
    () => (caps ? canRunLocalUpscale(caps) : false),
    [caps],
  );

  const scale = getPreset(presetId).scale;
  const pipeline = useMemo(
    () => pipelineFromStrengths(strengths, scale),
    [strengths, scale],
  );

  const cost = estimatePipelineCost(pipeline);
  const costLabel =
    cost < 2 ? "Light" : cost < 4 ? "Moderate" : cost < 6 ? "Heavy" : "Very heavy";

  const selectPreset = (id: PresetId) => {
    setPresetId(id);
    setStrengths({ ...getPreset(id).strengths });
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setJob((prev) => (prev ? { ...prev, presetId: id } : prev));
  };

  const onStageChange = (id: StageId, strength: number) => {
    setStrengths((prev) => ({ ...prev, [id]: strength }));
  };

  const onFile = (f: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    setPreviewUrl(url);
    setFile(f);
    setJob(createJobFromFile(f, presetId));
  };

  const clear = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setJob(null);
    setBusy(false);
  };

  const start = async () => {
    if (!file || !job || busy) return;
    if (!ready) return;

    setBusy(true);
    const base = { ...job, presetId };
    setJob(base);

    await runDemoPipeline(base, pipeline, (partial) => {
      setJob((prev) => (prev ? { ...prev, ...partial } : prev));
    });
    setBusy(false);
  };

  const isVideo = job?.isVideo ?? true;

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Foxy · Local · Private · Premium</p>
          <h1>Foxy&apos;s Premium Upscaling</h1>
          <p className="lede">
            Multi-stage enhancement — clean artifacts, super-resolve, calm
            flicker — polished enough to trust with real clips. Nothing leaves
            your device.
          </p>
        </div>
        <CapabilityBadges caps={caps} />
      </header>

      <section className="card hero-card">
        <DropZone
          onFile={onFile}
          fileName={file?.name}
          disabled={busy}
        />

        {file && job && (
          <div className="file-chip">
            <div>
              <strong>{job.fileName}</strong>
              <span>
                {formatBytes(job.fileSize)}
                {job.isVideo ? " · video" : job.isImage ? " · image" : ""}
                {" · "}
                {job.mimeType}
              </span>
            </div>
            <button type="button" className="ghost sm" onClick={clear} disabled={busy}>
              Clear
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h3>Presets</h3>
          <p>Start with a look, then fine-tune stages. Last choice is remembered.</p>
        </div>
        <PresetCards
          presets={PRESETS}
          value={presetId}
          onChange={selectPreset}
          disabled={busy}
        />
      </section>

      <div className="layout-split">
        <section className="card">
          <StageControls
            stages={pipeline.stages}
            isVideo={isVideo}
            disabled={busy}
            onChange={onStageChange}
          />
          <div className="cost-row">
            <span>
              Relative load: <strong>{costLabel}</strong>
            </span>
            <span className="muted">Scale {scale}× · browser GPU</span>
          </div>
        </section>

        <section className="card">
          <CompareSlider
            beforeUrl={previewUrl}
            afterUrl={null}
            emptyHint={
              file && !previewUrl
                ? "Video frame preview hooks up with WebCodecs next. Images show here immediately."
                : "Drop an image to scrub original vs enhanced after processing."
            }
          />
        </section>
      </div>

      <section className="card action-card">
        <div className="action-copy">
          <h3>Run enhancement</h3>
          <p>
            Pipeline UI is live. Next: real WebGPU stages (see{" "}
            <code>docs/quality-and-polish.md</code>). Preview a frame before long
            videos once Q2 ships.
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!file || !ready || busy}
            onClick={start}
          >
            {busy ? "Enhancing…" : "Enhance"}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!file || busy}
            onClick={clear}
          >
            Reset
          </button>
        </div>
        <ProgressPanel job={job} />

        {!ready && caps && (
          <div className="notice warn">
            <strong>Browser not ready for local AI.</strong> Use latest Chrome or
            Edge on desktop (WebGPU + WebCodecs).{" "}
            <span className="muted">{caps.details.join(" · ")}</span>
          </div>
        )}
      </section>

      <section className="pillars">
        <article>
          <h4>Better quality</h4>
          <p>
            Deblock before upscale, edge clarity after, temporal calm on video,
            optional face refine — not one mushy pass.
          </p>
        </article>
        <article>
          <h4>Real polish</h4>
          <p>
            Preset cards, stage sliders, comparison scrubber, stage-aware
            progress. Calm pro-tool UI, no mid-job guilt upsells.
          </p>
        </article>
        <article>
          <h4>Still free & private</h4>
          <p>
            MIT on GitHub. Files stay on-device. Match free.upscaler friction;
            beat it on output and craft.
          </p>
        </article>
      </section>

      <footer className="footer">
        <span>Foxy&apos;s Premium Upscaling · MIT</span>
        <span>
          <a
            href="https://github.com/foxys-lab/foxys-premium-upscaling"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          {" · "}
          <a
            href="https://github.com/foxys-lab/foxys-premium-upscaling/blob/main/docs/quality-and-polish.md"
            target="_blank"
            rel="noreferrer"
          >
            Quality plan
          </a>
        </span>
      </footer>
    </div>
  );
}
