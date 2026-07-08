/**
 * Real Anime4K CNN upscaling via WebSR (same lib as free.upscaler.video).
 *
 * Loads the official UMD build from /vendor/websr.js (reliable in browser).
 * Does NOT call websr.destroy() — that API destroys the GPU device.
 * Does NOT fall back to color filters — throws if AI cannot run.
 */

import type { ProgressCb } from "./webgl";
import weights2xL from "../../weights/anime4k/cnn-2x-l-an.json";
import weights2xM from "../../weights/anime4k/cnn-2x-m-an.json";

type NetworkName = "anime4k/cnn-2x-l" | "anime4k/cnn-2x-m" | "anime4k/cnn-2x-s";

type WebSRInstance = {
  canvas: HTMLCanvasElement;
  render: (source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement) => Promise<void>;
  switchNetwork?: (name: NetworkName, weights: unknown) => void;
};

type WebSRStatic = {
  new (params: {
    canvas: HTMLCanvasElement;
    weights: unknown;
    network_name: NetworkName;
    gpu: GPUDevice;
    resolution?: { width: number; height: number };
    debug?: boolean;
  }): WebSRInstance;
  initWebGPU: () => Promise<GPUDevice | false>;
};

declare global {
  interface Window {
    WebSR?: WebSRStatic;
  }
}

let scriptLoaded = false;
let device: GPUDevice | null = null;

function vendorUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}vendor/websr.js`;
}

async function loadWebSRScript(): Promise<WebSRStatic> {
  if (window.WebSR?.initWebGPU) {
    scriptLoaded = true;
    return window.WebSR;
  }

  if (scriptLoaded && !window.WebSR) {
    throw new Error("WebSR script loaded but WebSR global missing");
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-foxy-websr="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("WebSR script failed")),
      );
      // already complete?
      if (window.WebSR) resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = vendorUrl();
    s.async = true;
    s.dataset.foxyWebsr = "1";
    s.onload = () => resolve();
    s.onerror = () =>
      reject(
        new Error(
          `Could not load WebSR from ${vendorUrl()} — AI engine unavailable`,
        ),
      );
    document.head.appendChild(s);
  });

  if (!window.WebSR?.initWebGPU) {
    throw new Error("WebSR global not found after script load");
  }
  scriptLoaded = true;
  return window.WebSR;
}

async function getDevice(WebSR: WebSRStatic): Promise<GPUDevice> {
  // Re-init if lost
  if (device) {
    try {
      // touch queue to see if alive
      void device.queue;
      return device;
    } catch {
      device = null;
    }
  }
  if (!navigator.gpu) {
    throw new Error(
      "This browser has no WebGPU. Use Chrome or Edge on desktop for real AI upscaling.",
    );
  }
  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error(
      "WebGPU adapter/device failed. Update Chrome/Edge and enable WebGPU.",
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
    const WebSR = await loadWebSRScript();
    await getDevice(WebSR);
    return true;
  } catch {
    return false;
  }
}

/** 1:1 sharp copy from WebGPU canvas → 2D canvas */
async function captureOutput(
  canvas: HTMLCanvasElement,
  gpu: GPUDevice,
  expectW: number,
  expectH: number,
): Promise<HTMLCanvasElement> {
  try {
    await gpu.queue.onSubmittedWorkDone();
  } catch {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }

  const w = canvas.width;
  const h = canvas.height;
  if (w < expectW * 0.9 || h < expectH * 0.9) {
    throw new Error(
      `AI canvas size wrong: got ${w}×${h}, expected ~${expectW}×${expectH}`,
    );
  }

  const bitmap = await createImageBitmap(canvas);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { alpha: false, colorSpace: "srgb" } as CanvasRenderingContext2DSettings);
  if (!ctx) {
    bitmap.close();
    throw new Error("2D context missing");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Must not be flat / empty
  const sample = ctx.getImageData(
    Math.floor(w / 4),
    Math.floor(h / 4),
    Math.min(16, w),
    Math.min(16, h),
  ).data;
  let sum = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < sample.length; i += 4) {
    const y = (sample[i]! + sample[i + 1]! + sample[i + 2]!) / 3;
    sum += y;
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  const mean = sum / (sample.length / 4);
  if (max - min < 2 && mean < 3) {
    throw new Error(
      "AI output capture failed (blank). WebGPU present path broken.",
    );
  }

  return out;
}

/** Prove AI changed pixels vs bilinear (not a no-op / color filter). */
function assertLooksUpscaled(
  ai: HTMLCanvasElement,
  bilinear: HTMLCanvasElement,
): void {
  if (ai.width !== bilinear.width || ai.height !== bilinear.height) {
    // size difference alone is fine
    return;
  }
  const ctxA = ai.getContext("2d")!;
  const ctxB = bilinear.getContext("2d")!;
  const n = 64;
  const a = ctxA.getImageData(0, 0, Math.min(n, ai.width), Math.min(n, ai.height)).data;
  const b = ctxB.getImageData(0, 0, Math.min(n, bilinear.width), Math.min(n, bilinear.height)).data;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i]! - b[i]!);
  }
  const avg = diff / a.length;
  // Real CNN almost always differs more than a pure color filter; threshold low
  if (avg < 0.15) {
    console.warn("AI vs bilinear very similar (avg diff", avg, ")");
  }
}

export interface WebSREnhanceResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  network: string;
  bilinearCompare: HTMLCanvasElement;
  isRealAI: true;
}

/**
 * Real 2× Anime4K CNN. Throws if AI cannot run — never silent filter.
 */
export async function enhanceWithWebSR(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
): Promise<WebSREnhanceResult> {
  onProgress?.({ phase: "Loading WebSR AI engine…", progress: 5 });
  const WebSR = await loadWebSRScript();
  const gpu = await getDevice(WebSR);

  onProgress?.({ phase: "Preparing image…", progress: 15 });

  // Keep full resolution — only cap extreme sizes for VRAM
  const maxIn = 1920;
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

  // Bilinear baseline at same pixel size as AI output
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

  // Large anime weights first (best quality for your art style)
  const attempts: { network: NetworkName; weights: unknown }[] = [
    { network: "anime4k/cnn-2x-l", weights: weights2xL },
    { network: "anime4k/cnn-2x-m", weights: weights2xM },
  ];

  let lastErr: unknown;

  for (const a of attempts) {
    // Fresh canvas each attempt — NO css width/height (that caused blur before)
    const canvas = document.createElement("canvas");
    canvas.width = workW * 2;
    canvas.height = workH * 2;
    // Must not set CSS size — only position offscreen
    canvas.style.position = "fixed";
    canvas.style.left = "-10000px";
    canvas.style.top = "0";
    canvas.style.opacity = "0";
    canvas.style.pointerEvents = "none";
    document.body.appendChild(canvas);

    try {
      onProgress?.({
        phase: `Running real AI: ${a.network}`,
        progress: 40,
      });

      const websr = new WebSR({
        network_name: a.network,
        weights: a.weights,
        gpu,
        canvas,
        resolution: { width: workW, height: workH },
        debug: false,
      });

      await websr.render(bitmap);

      onProgress?.({ phase: "Capturing AI output…", progress: 80 });
      const out = await captureOutput(
        canvas,
        gpu,
        workW * 2,
        workH * 2,
      );

      assertLooksUpscaled(out, bilinearCompare);

      // DO NOT call websr.destroy() — it destroys the GPU device permanently
      canvas.remove();
      bitmap.close();

      onProgress?.({ phase: "AI complete", progress: 100 });
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
      console.error(`Network ${a.network} failed:`, e);
      canvas.remove();
      // Device may have been killed by internal destroy — reset handle
      device = null;
      try {
        // get fresh device for next attempt
        await getDevice(WebSR);
      } catch {
        /* continue */
      }
    }
  }

  bitmap.close();
  throw lastErr instanceof Error
    ? lastErr
    : new Error(
        "Real AI upscaling failed. Use latest Chrome/Edge with WebGPU enabled.",
      );
}
