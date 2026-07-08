/**
 * Fast ESRGAN via UpscalerJS + esrgan-slim 2×.
 * Thick models are too slow in-browser; slim (~1MB) is the speed/quality balance.
 *
 * Weights served from same origin: /models/esrgan-slim/x2/ (no 28MB CDN wait).
 */

import * as tf from "@tensorflow/tfjs";
import Upscaler from "upscaler";
import esrgan2x from "@upscalerjs/esrgan-slim/2x";
import type { ProgressCb } from "./webgl";

type Scale = 2;

let ready = false;
let upscaler: InstanceType<typeof Upscaler> | null = null;
let preloadPromise: Promise<void> | null = null;

function modelPath(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}models/esrgan-slim/x2/model.json`;
}

async function ensureTf(): Promise<void> {
  if (ready) return;
  await tf.ready();
  try {
    await tf.setBackend("webgl");
    await tf.ready();
  } catch {
    /* default backend */
  }
  try {
    // Prefer speed over perfect float precision
    tf.env().set("WEBGL_FORCE_F16_TEXTURES", true);
    tf.env().set("WEBGL_PACK", true);
  } catch {
    /* ignore */
  }
  ready = true;
}

function modelDef() {
  const base =
    typeof esrgan2x === "function"
      ? (esrgan2x as () => Record<string, unknown>)()
      : (esrgan2x as Record<string, unknown>);
  return {
    ...base,
    path: modelPath(),
  };
}

async function getUpscaler(): Promise<InstanceType<typeof Upscaler>> {
  await ensureTf();
  if (!upscaler) {
    upscaler = new Upscaler({ model: modelDef() as never });
  }
  return upscaler;
}

/** Call when user picks a file so model loads before they hit Upscale. */
export function preloadEsrgan(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const u = await getUpscaler();
      // Tiny warmup so first real image is faster
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#888";
        ctx.fillRect(0, 0, 32, 32);
      }
      try {
        const t = (await u.upscale(c, {
          output: "tensor",
          patchSize: 32,
          padding: 2,
        })) as tf.Tensor;
        t.dispose();
      } catch {
        /* warmup optional */
      }
    })().catch((e) => {
      preloadPromise = null;
      throw e;
    });
  }
  return preloadPromise;
}

export async function isEsrganAvailable(): Promise<boolean> {
  try {
    await ensureTf();
    return tf.getBackend() === "webgl" || tf.getBackend() === "webgpu";
  } catch {
    return false;
  }
}

export interface EsrganResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: Scale;
  network: string;
  bilinearCompare: HTMLCanvasElement;
}

async function tensorToCanvas(tensor: tf.Tensor3D): Promise<HTMLCanvasElement> {
  const [h, w] = tensor.shape;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  // Fast path: TF.js GPU→canvas
  await tf.browser.toPixels(tensor, canvas);
  return canvas;
}

function makeBilinear2x(
  source: CanvasImageSource,
  w: number,
  h: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w * 2;
  c.height = h * 2;
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D missing");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/**
 * Fast 2× ESRGAN-slim. Caps long edge so runtime stays snappy.
 */
export async function enhanceWithEsrgan(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
): Promise<EsrganResult> {
  onProgress?.({ phase: "Starting fast AI upscale…", progress: 5 });

  // Aggressive cap = fewer patches = much faster (still looks sharp at 2×)
  let input: HTMLCanvasElement | HTMLImageElement | ImageBitmap = source;
  let inW = srcW;
  let inH = srcH;
  const maxIn = 640;
  if (srcW > maxIn || srcH > maxIn) {
    const r = Math.min(maxIn / srcW, maxIn / srcH);
    inW = Math.max(2, Math.round(srcW * r));
    inH = Math.max(2, Math.round(srcH * r));
    const tmp = document.createElement("canvas");
    tmp.width = inW;
    tmp.height = inH;
    const tctx = tmp.getContext("2d", { alpha: false });
    if (!tctx) throw new Error("Canvas missing");
    tctx.drawImage(source as CanvasImageSource, 0, 0, inW, inH);
    input = tmp;
  }

  const scale: Scale = 2;
  const bilinearCompare = makeBilinear2x(
    input as CanvasImageSource,
    inW,
    inH,
  );

  onProgress?.({ phase: "Loading slim AI model…", progress: 12 });
  const u = await getUpscaler();

  onProgress?.({
    phase: `ESRGAN-slim 2× (${inW}×${inH} → ${inW * 2}×${inH * 2})…`,
    progress: 20,
  });

  // Larger patches = fewer passes = faster (slim model handles 128 well)
  const tensor = (await u.upscale(input, {
    output: "tensor",
    patchSize: 128,
    padding: 4,
    awaitNextFrame: false,
    progress: (amount: number) => {
      const pct = 20 + Math.round(Math.min(0.97, amount) * 70);
      onProgress?.({
        phase: `Upscaling ${Math.round(amount * 100)}%`,
        progress: pct,
      });
    },
  })) as tf.Tensor3D;

  try {
    onProgress?.({ phase: "Writing image…", progress: 95 });
    const canvas = await tensorToCanvas(tensor);
    onProgress?.({ phase: "Done", progress: 100 });
    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      scale,
      network: "esrgan-slim-2x",
      bilinearCompare,
    };
  } finally {
    tensor.dispose();
  }
}
