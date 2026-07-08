/**
 * WebSR Anime4K CNN — same engine family as free.upscaler.video.
 * Optimized for SPEED: medium network, no restore pass, solid GPU readback.
 */

import type { ProgressCb } from "./webgl";
import WebSR from "@websr/websr";

import weights2xM from "../../weights/anime4k/cnn-2x-m-an.json";
import weights2xL from "../../weights/anime4k/cnn-2x-l-an.json";
import weights2xS from "../../weights/anime4k/cnn-2x-s-an.json";

type NetworkName = "anime4k/cnn-2x-m" | "anime4k/cnn-2x-l" | "anime4k/cnn-2x-s";

let cachedDevice: GPUDevice | null = null;
let deviceLost = false;

async function getDevice(): Promise<GPUDevice> {
  if (cachedDevice && !deviceLost) return cachedDevice;
  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU not available — use Chrome or Edge");
  }
  cachedDevice = gpu;
  deviceLost = false;
  try {
    gpu.lost.then(() => {
      deviceLost = true;
      cachedDevice = null;
    });
  } catch {
    /* ignore */
  }
  return gpu;
}

export async function isWebSRAvailable(): Promise<boolean> {
  try {
    if (!navigator.gpu) return false;
    await getDevice();
    return true;
  } catch {
    return false;
  }
}

async function snapshotWebGPUCanvas(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
): Promise<HTMLCanvasElement> {
  try {
    await device.queue.onSubmittedWorkDone();
  } catch {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }

  const bitmap = await createImageBitmap(canvas);
  const out = document.createElement("canvas");
  out.width = bitmap.width || canvas.width;
  out.height = bitmap.height || canvas.height;
  const ctx = out.getContext("2d", { alpha: false });
  if (!ctx) {
    bitmap.close();
    throw new Error("2D canvas missing");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return out;
}

async function run2x(opts: {
  network: NetworkName;
  weights: unknown;
  source: ImageBitmap;
  width: number;
  height: number;
  device: GPUDevice;
}): Promise<HTMLCanvasElement> {
  const { network, weights, source, width, height, device } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  canvas.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(canvas);

  try {
    const websr = new WebSR({
      network_name: network,
      weights,
      gpu: device,
      canvas,
      resolution: { width, height },
    });
    await websr.render(source);
    const snapped = await snapshotWebGPUCanvas(canvas, device);
    await websr.destroy();
    return snapped;
  } finally {
    canvas.remove();
  }
}

export interface WebSREnhanceResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  network: string;
  bilinearCompare: HTMLCanvasElement;
}

/**
 * Fast 2× AI upscale (medium Anime4K CNN — free.upscaler default class).
 */
export async function enhanceWithWebSR(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
): Promise<WebSREnhanceResult> {
  onProgress?.({ phase: "Starting GPU…", progress: 10 });
  const device = await getDevice();

  // Cap for speed (still 2× out). free.upscaler also struggles on huge stills.
  const maxIn = 960;
  let workW = srcW;
  let workH = srcH;
  let bitmap: ImageBitmap;

  if (srcW > maxIn || srcH > maxIn) {
    const r = Math.min(maxIn / srcW, maxIn / srcH);
    workW = Math.max(2, Math.round(srcW * r));
    workH = Math.max(2, Math.round(srcH * r));
    bitmap = await createImageBitmap(source as ImageBitmapSource, {
      resizeWidth: workW,
      resizeHeight: workH,
      resizeQuality: "high",
    });
  } else {
    bitmap = await createImageBitmap(source as ImageBitmapSource);
    workW = bitmap.width;
    workH = bitmap.height;
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

  // Medium first (speed). Large if medium fails.
  const attempts: { network: NetworkName; weights: unknown }[] = [
    { network: "anime4k/cnn-2x-m", weights: weights2xM },
    { network: "anime4k/cnn-2x-l", weights: weights2xL },
    { network: "anime4k/cnn-2x-s", weights: weights2xS },
  ];

  let lastErr: unknown;
  try {
    for (const a of attempts) {
      try {
        onProgress?.({
          phase: `AI 2× ${a.network}…`,
          progress: 40,
        });
        const upscaled = await run2x({
          network: a.network,
          weights: a.weights,
          source: bitmap,
          width: workW,
          height: workH,
          device,
        });
        onProgress?.({ phase: "Done", progress: 100 });
        bitmap.close();
        return {
          canvas: upscaled,
          width: upscaled.width,
          height: upscaled.height,
          network: a.network,
          bilinearCompare,
        };
      } catch (e) {
        lastErr = e;
        console.warn(a.network, e);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("WebSR failed");
  } catch (e) {
    bitmap.close();
    throw e;
  }
}
