/**
 * Real Anime4K CNN via WebSR (free.upscaler.video engine).
 *
 * Load order:
 * 1) dynamic import('@websr/websr') — Vite-friendly
 * 2) classic script /vendor/websr.js — UMD global fallback
 *
 * Capture: canvas.convertToBlob() (correct for WebGPU), not CSS-scaled drawImage.
 * Never call websr.destroy() — it destroys the GPU device.
 */

import type { ProgressCb } from "./webgl";
import weights2xL from "../../weights/anime4k/cnn-2x-l-an.json";
import weights2xM from "../../weights/anime4k/cnn-2x-m-an.json";

type NetworkName = "anime4k/cnn-2x-l" | "anime4k/cnn-2x-m";

type WebSRInstance = {
  canvas: HTMLCanvasElement;
  render: (source: ImageBitmap) => Promise<void>;
};

type WebSRStatic = {
  new (params: {
    canvas: HTMLCanvasElement;
    weights: unknown;
    network_name: NetworkName;
    gpu: GPUDevice;
    resolution?: { width: number; height: number };
  }): WebSRInstance;
  initWebGPU: () => Promise<GPUDevice | false>;
};

declare global {
  interface Window {
    WebSR?: WebSRStatic;
  }
}

let WebSRClass: WebSRStatic | null = null;
let device: GPUDevice | null = null;

function resolveWebSR(mod: unknown): WebSRStatic | null {
  if (!mod) return null;
  const m = mod as Record<string, unknown>;
  const cand = (m.default ?? m.WebSR ?? m) as WebSRStatic;
  if (cand && typeof cand.initWebGPU === "function") return cand;
  return null;
}

async function loadWebSRClass(): Promise<WebSRStatic> {
  if (WebSRClass) return WebSRClass;

  // 1) ESM / CJS import through Vite
  try {
    const mod = await import("@websr/websr");
    const resolved = resolveWebSR(mod);
    if (resolved) {
      WebSRClass = resolved;
      return resolved;
    }
  } catch (e) {
    console.warn("import(@websr/websr) failed, trying script tag", e);
  }

  // 2) UMD script tag
  if (window.WebSR && typeof window.WebSR.initWebGPU === "function") {
    WebSRClass = window.WebSR;
    return WebSRClass;
  }

  const base = import.meta.env.BASE_URL || "/";
  const src = `${base}vendor/websr.js`;

  await new Promise<void>((resolve, reject) => {
    const prev = document.querySelector<HTMLScriptElement>(
      'script[data-foxy-websr="1"]',
    );
    if (prev) {
      if (window.WebSR) {
        resolve();
        return;
      }
      prev.addEventListener("load", () => resolve(), { once: true });
      prev.addEventListener(
        "error",
        () => reject(new Error("WebSR script error")),
        { once: true },
      );
      // timeout if already loaded without global
      setTimeout(() => {
        if (window.WebSR) resolve();
        else reject(new Error("WebSR script present but global missing"));
      }, 3000);
      return;
    }

    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.foxyWebsr = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });

  // UMD may expose WebSR or default
  const fromWindow =
    resolveWebSR(window.WebSR) ||
    resolveWebSR((window as unknown as { default?: unknown }).default);

  if (!fromWindow) {
    throw new Error(
      "WebSR AI library failed to load. Hard-refresh (Cmd+Shift+R) and try Chrome/Edge.",
    );
  }
  WebSRClass = fromWindow;
  return fromWindow;
}

async function getDevice(WebSR: WebSRStatic): Promise<GPUDevice> {
  if (device) {
    try {
      void device.queue;
      return device;
    } catch {
      device = null;
    }
  }
  if (!navigator.gpu) {
    throw new Error(
      "No WebGPU — open this site in desktop Chrome or Edge (not Safari).",
    );
  }
  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error(
      "WebGPU device unavailable. Update Chrome, or visit chrome://flags and enable WebGPU.",
    );
  }
  device = gpu;
  try {
    gpu.lost.then(() => {
      device = null;
    });
  } catch {
    /* ignore */
  }
  return gpu;
}

export async function isWebSRAvailable(): Promise<boolean> {
  try {
    if (!navigator.gpu) return false;
    const WebSR = await loadWebSRClass();
    await getDevice(WebSR);
    return true;
  } catch (e) {
    console.warn("WebSR unavailable:", e);
    return false;
  }
}

async function captureWebGPUCanvas(
  canvas: HTMLCanvasElement,
  gpu: GPUDevice,
): Promise<HTMLCanvasElement> {
  try {
    await gpu.queue.onSubmittedWorkDone();
  } catch {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }

  const w = canvas.width;
  const h = canvas.height;
  if (w < 2 || h < 2) throw new Error("AI canvas has zero size");

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D context missing");
  ctx.imageSmoothingEnabled = false;

  // Best: convertToBlob (works with WebGPU canvases in Chromium)
  const c = canvas as HTMLCanvasElement & {
    convertToBlob?: (o?: { type?: string }) => Promise<Blob>;
  };
  if (typeof c.convertToBlob === "function") {
    try {
      const blob = await c.convertToBlob({ type: "image/png" });
      const bmp = await createImageBitmap(blob);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return out;
    } catch (e) {
      console.warn("convertToBlob failed, trying createImageBitmap", e);
    }
  }

  const bmp = await createImageBitmap(canvas);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return out;
}

export interface WebSREnhanceResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  network: string;
  bilinearCompare: HTMLCanvasElement;
  isRealAI: true;
}

export async function enhanceWithWebSR(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
): Promise<WebSREnhanceResult> {
  onProgress?.({ phase: "Loading real AI (WebSR)…", progress: 6 });
  const WebSR = await loadWebSRClass();
  const gpu = await getDevice(WebSR);

  onProgress?.({ phase: "Preparing image…", progress: 18 });

  const maxIn = 1600;
  let workW = srcW;
  let workH = srcH;
  let bitmap: ImageBitmap;

  if (srcW > maxIn || srcH > maxIn) {
    const r = Math.min(maxIn / srcW, maxIn / srcH);
    workW = Math.max(2, Math.round(srcW * r));
    workH = Math.max(2, Math.round(srcH * r));
    const tmp = document.createElement("canvas");
    tmp.width = workW;
    tmp.height = workH;
    const tctx = tmp.getContext("2d", { alpha: false });
    if (!tctx) throw new Error("2D missing");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(source as CanvasImageSource, 0, 0, workW, workH);
    bitmap = await createImageBitmap(tmp);
  } else {
    bitmap = await createImageBitmap(source as ImageBitmapSource);
    workW = bitmap.width;
    workH = bitmap.height;
  }

  if (workW < 2 || workH < 2) {
    bitmap.close();
    throw new Error("Image too small to upscale");
  }

  const bilinearCompare = document.createElement("canvas");
  bilinearCompare.width = workW * 2;
  bilinearCompare.height = workH * 2;
  {
    const bctx = bilinearCompare.getContext("2d", { alpha: false });
    if (!bctx) throw new Error("2D missing");
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(bitmap, 0, 0, bilinearCompare.width, bilinearCompare.height);
  }

  const attempts: { network: NetworkName; weights: unknown }[] = [
    { network: "anime4k/cnn-2x-l", weights: weights2xL },
    { network: "anime4k/cnn-2x-m", weights: weights2xM },
  ];

  let lastErr: unknown;

  for (const a of attempts) {
    const canvas = document.createElement("canvas");
    canvas.width = workW * 2;
    canvas.height = workH * 2;
    // Do NOT set CSS width/height — that blurs WebGPU capture
    canvas.style.position = "fixed";
    canvas.style.left = "-10000px";
    canvas.style.top = "0";
    canvas.style.opacity = "0";
    canvas.style.pointerEvents = "none";
    document.body.appendChild(canvas);

    try {
      onProgress?.({
        phase: `Real AI running: ${a.network}`,
        progress: 45,
      });

      // Fresh device if previous attempt killed it
      const gpuNow = await getDevice(WebSR);

      const websr = new WebSR({
        network_name: a.network,
        weights: a.weights,
        gpu: gpuNow,
        canvas,
        resolution: { width: workW, height: workH },
      });

      await websr.render(bitmap);

      onProgress?.({ phase: "Capturing AI pixels…", progress: 82 });
      const out = await captureWebGPUCanvas(canvas, gpuNow);

      if (out.width < workW * 1.5) {
        throw new Error(`Output too small: ${out.width}×${out.height}`);
      }

      canvas.remove();
      bitmap.close();

      onProgress?.({ phase: "Real AI complete", progress: 100 });
      return {
        canvas: out,
        width: out.width,
        height: out.height,
        network: a.network,
        bilinearCompare,
        isRealAI: true,
      };
    } catch (e) {
      lastErr = e;
      console.error(`AI network ${a.network} failed:`, e);
      canvas.remove();
      device = null; // force new device next attempt
    }
  }

  bitmap.close();
  const detail =
    lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown");
  throw new Error(`Real AI upscaling failed: ${detail}`);
}
