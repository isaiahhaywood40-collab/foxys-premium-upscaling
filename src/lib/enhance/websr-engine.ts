/**
 * WebSR / Anime4K CNN engine — same stack as free.upscaler.video.
 *
 * Critical fixes vs first integration:
 * - Cache GPU device (never destroy on probe)
 * - Feed createImageBitmap sources like free.upscaler
 * - Wait for GPU queue + createImageBitmap readback (WebGPU canvas ≠ 2d copy)
 * - Optional restore (1×) then cnn-2x-l (2×) for stronger results
 * - Bundle weights so GitHub Pages always finds them
 */

import type { ProgressCb } from "./webgl";
import WebSR from "@websr/websr";

// Animation-tuned weights (best for AI anime / furry art)
import weights2xL from "../../weights/anime4k/cnn-2x-l-an.json";
import weights2xM from "../../weights/anime4k/cnn-2x-m-an.json";
import weights2xS from "../../weights/anime4k/cnn-2x-s-an.json";
import weightsRestoreL from "../../weights/anime4k/cnn-restore-l-an.json";

type NetworkName =
  | "anime4k/cnn-2x-l"
  | "anime4k/cnn-2x-m"
  | "anime4k/cnn-2x-s"
  | "anime4k/cnn-restore-l";

let cachedDevice: GPUDevice | null = null;
let deviceLost = false;

async function getDevice(): Promise<GPUDevice> {
  if (cachedDevice && !deviceLost) return cachedDevice;

  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU not available — use Chrome or Edge for AI upscaling");
  }

  cachedDevice = gpu;
  deviceLost = false;
  try {
    gpu.lost.then(() => {
      deviceLost = true;
      cachedDevice = null;
    });
  } catch {
    /* older browsers */
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

/** Wait until GPU work is visible on the canvas, then snapshot to a 2D canvas. */
async function snapshotWebGPUCanvas(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
): Promise<HTMLCanvasElement> {
  // Ensure all WebGPU commands have finished presenting
  try {
    await device.queue.onSubmittedWorkDone();
  } catch {
    // Fallback: give the browser a frame to present
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }

  // createImageBitmap is the reliable way to read a WebGPU canvas
  const bitmap = await createImageBitmap(canvas);
  const out = document.createElement("canvas");
  out.width = bitmap.width || canvas.width;
  out.height = bitmap.height || canvas.height;
  const ctx = out.getContext("2d", { alpha: false });
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not create 2D canvas for output");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Sanity: reject empty/black frames (broken readback)
  const sample = ctx.getImageData(
    Math.floor(out.width / 2),
    Math.floor(out.height / 2),
    1,
    1,
  ).data;
  const brightness = (sample[0]! + sample[1]! + sample[2]!) / 3;
  if (brightness < 2) {
    // might be a dark image legitimately — check variance in a strip
    const strip = ctx.getImageData(0, Math.floor(out.height / 2), Math.min(64, out.width), 1).data;
    let sum = 0;
    for (let i = 0; i < strip.length; i += 4) {
      sum += strip[i]! + strip[i + 1]! + strip[i + 2]!;
    }
    if (sum < 10) {
      throw new Error("WebGPU canvas readback empty — AI output not captured");
    }
  }

  return out;
}

async function runNetwork(opts: {
  network: NetworkName;
  weights: unknown;
  source: ImageBitmap;
  width: number;
  height: number;
  device: GPUDevice;
}): Promise<HTMLCanvasElement> {
  const { network, weights, source, width, height, device } = opts;

  const scale = network.includes("2x") ? 2 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, width * scale);
  canvas.height = Math.max(2, height * scale);

  // Attach to DOM (hidden) — helps some browsers present WebGPU correctly
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
  /** Bilinear 2× of original — use this on the LEFT of the compare slider (free.upscaler style). */
  bilinearCompare: HTMLCanvasElement;
}

/**
 * Full AI path: restore (clean) → 2× CNN upscale (large anime weights).
 */
export async function enhanceWithWebSR(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
): Promise<WebSREnhanceResult> {
  if (srcW < 2 || srcH < 2) throw new Error("Image too small");

  onProgress?.({ phase: "Preparing GPU", progress: 8 });
  const device = await getDevice();

  // Cap very large inputs for VRAM (tile later)
  let workW = srcW;
  let workH = srcH;
  let bitmap: ImageBitmap;

  const maxIn = 1536;
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

  // Bilinear 2× for fair compare (what free.upscaler puts on "original" side)
  const bilinearCompare = document.createElement("canvas");
  bilinearCompare.width = workW * 2;
  bilinearCompare.height = workH * 2;
  {
    const bctx = bilinearCompare.getContext("2d", { alpha: false });
    if (!bctx) throw new Error("2D context missing");
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(bitmap, 0, 0, bilinearCompare.width, bilinearCompare.height);
  }

  try {
    // Pass 1: restore at native res (Anime4K CNN restore — cleans mush before upscale)
    onProgress?.({ phase: "AI restore (Anime4K CNN)", progress: 25 });
    let current: ImageBitmap = bitmap;
    let curW = workW;
    let curH = workH;

    try {
      const restored = await runNetwork({
        network: "anime4k/cnn-restore-l",
        weights: weightsRestoreL,
        source: current,
        width: curW,
        height: curH,
        device,
      });
      current.close();
      current = await createImageBitmap(restored);
      curW = restored.width;
      curH = restored.height;
    } catch (e) {
      console.warn("Restore pass skipped:", e);
      // continue with original bitmap
    }

    // Pass 2: 2× super-resolution — large anime network (best quality)
    onProgress?.({ phase: "AI super-resolution 2× (cnn-2x-l)", progress: 55 });

    let upscaled: HTMLCanvasElement | null = null;
    const attempts: { network: NetworkName; weights: unknown }[] = [
      { network: "anime4k/cnn-2x-l", weights: weights2xL },
      { network: "anime4k/cnn-2x-m", weights: weights2xM },
      { network: "anime4k/cnn-2x-s", weights: weights2xS },
    ];

    let used = attempts[0]!.network;
    let lastErr: unknown;
    for (const a of attempts) {
      try {
        upscaled = await runNetwork({
          network: a.network,
          weights: a.weights,
          source: current,
          width: curW,
          height: curH,
          device,
        });
        used = a.network;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`${a.network} failed`, e);
      }
    }

    if (!upscaled) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error("All AI networks failed");
    }

    onProgress?.({ phase: "Encoding output", progress: 92 });
    current.close();

    return {
      canvas: upscaled,
      width: upscaled.width,
      height: upscaled.height,
      network: `restore + ${used}`,
      bilinearCompare,
    };
  } catch (e) {
    bitmap.close();
    throw e;
  }
}
