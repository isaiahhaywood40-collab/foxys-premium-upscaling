/**
 * WebSR engine — same family as free.upscaler.video:
 * Anime4K CNN super-resolution on WebGPU (@websr/websr).
 *
 * Default: anime4k/cnn-2x-l (large, animation weights) for best quality.
 * Falls back to medium/small if large fails, then throws for WebGL path.
 */

import type { ProgressCb } from "./webgl";

// Package ships CJS webpack build; Vite handles default import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSRCtor = {
  new (params: {
    canvas: HTMLCanvasElement;
    weights: unknown;
    network_name: string;
    gpu: GPUDevice;
    resolution?: { width: number; height: number };
  }): {
    canvas: HTMLCanvasElement;
    render: (source: CanvasImageSource) => Promise<void>;
    destroy: () => Promise<void>;
  };
  initWebGPU: () => Promise<GPUDevice | false>;
};

async function loadWebSR(): Promise<WebSRCtor> {
  const mod = await import("@websr/websr");
  // default export or module.exports
  const WebSR = (mod as { default?: WebSRCtor }).default ?? (mod as unknown as WebSRCtor);
  if (!WebSR?.initWebGPU) {
    throw new Error("WebSR module failed to load");
  }
  return WebSR;
}

export type NetworkSize = "s" | "m" | "l";

const NETWORKS: Record<
  NetworkSize,
  { name: string; weightsPath: string }
> = {
  s: {
    name: "anime4k/cnn-2x-s",
    weightsPath: "weights/anime4k/cnn-2x-s-an.json",
  },
  m: {
    name: "anime4k/cnn-2x-m",
    weightsPath: "weights/anime4k/cnn-2x-m-an.json",
  },
  l: {
    name: "anime4k/cnn-2x-l",
    weightsPath: "weights/anime4k/cnn-2x-l-an.json",
  },
};

const weightsCache = new Map<string, unknown>();

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path.replace(/^\//, "")}`;
}

async function loadWeights(path: string): Promise<unknown> {
  const key = assetUrl(path);
  if (weightsCache.has(key)) return weightsCache.get(key);
  const res = await fetch(key);
  if (!res.ok) throw new Error(`Failed to load SR weights (${res.status})`);
  const json = await res.json();
  weightsCache.set(key, json);
  return json;
}

export async function isWebSRAvailable(): Promise<boolean> {
  try {
    if (!navigator.gpu) return false;
    const WebSR = await loadWebSR();
    const gpu = await WebSR.initWebGPU();
    if (!gpu) return false;
    // don't keep device if we're only probing — destroy not always available
    try {
      (gpu as GPUDevice).destroy?.();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

export interface WebSREnhanceResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  network: string;
}

/**
 * Run Anime4K CNN 2× on an image-like source. Prefer large network.
 */
export async function enhanceWithWebSR(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
  preferred: NetworkSize = "l",
): Promise<WebSREnhanceResult> {
  if (srcW < 2 || srcH < 2) {
    throw new Error("Image too small to upscale");
  }

  // Cap input so we don't OOM on huge sources (tile later)
  const maxIn = 1920;
  let drawW = srcW;
  let drawH = srcH;
  let drawSource: CanvasImageSource = source;

  if (srcW > maxIn || srcH > maxIn) {
    const r = Math.min(maxIn / srcW, maxIn / srcH);
    drawW = Math.max(2, Math.round(srcW * r));
    drawH = Math.max(2, Math.round(srcH * r));
    const tmp = document.createElement("canvas");
    tmp.width = drawW;
    tmp.height = drawH;
    const ctx = tmp.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source as CanvasImageSource, 0, 0, drawW, drawH);
    drawSource = tmp;
  }

  onProgress?.({ phase: "Loading AI model (WebGPU)", progress: 10 });
  const WebSR = await loadWebSR();
  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU not available — need Chrome/Edge for AI engine");
  }

  const order: NetworkSize[] =
    preferred === "l" ? ["l", "m", "s"] : preferred === "m" ? ["m", "s"] : ["s"];

  let lastError: unknown;
  for (const size of order) {
    const net = NETWORKS[size];
    try {
      onProgress?.({
        phase: `Running ${net.name} super-resolution`,
        progress: 30,
      });

      const weights = await loadWeights(net.weightsPath);
      const canvas = document.createElement("canvas");
      // Initial size; WebSR resizes to 2× on render
      canvas.width = drawW * 2;
      canvas.height = drawH * 2;

      const websr = new WebSR({
        network_name: net.name,
        weights,
        gpu,
        canvas,
        resolution: { width: drawW, height: drawH },
      });

      onProgress?.({ phase: "AI upscaling 2×", progress: 55 });
      await websr.render(drawSource);

      onProgress?.({ phase: "Finalizing", progress: 90 });
      const outW = canvas.width;
      const outH = canvas.height;
      if (outW < 2 || outH < 2) {
        await websr.destroy();
        throw new Error("WebSR produced empty canvas");
      }

      // Copy off WebSR's canvas before destroy (in case it releases GPU resources)
      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("2D context missing");
      octx.drawImage(canvas, 0, 0);

      await websr.destroy();

      onProgress?.({ phase: "Done", progress: 100 });
      return {
        canvas: out,
        width: outW,
        height: outH,
        network: net.name,
      };
    } catch (e) {
      lastError = e;
      console.warn(`WebSR network ${net.name} failed`, e);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All WebSR networks failed");
}
