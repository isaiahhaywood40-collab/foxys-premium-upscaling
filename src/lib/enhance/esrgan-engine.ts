/**
 * Real-ESRGAN class engine via UpscalerJS + @upscalerjs/esrgan-thick.
 * Much stronger detail recovery than Anime4K real-time CNNs (which look mild
 * on already-sharp AI art).
 *
 * Model weights load from jsDelivr CDN on first run (~28MB for 2× thick).
 */

import * as tf from "@tensorflow/tfjs";
import Upscaler from "upscaler";
import esrgan2x from "@upscalerjs/esrgan-thick/2x";
import esrgan4x from "@upscalerjs/esrgan-thick/4x";
import type { ProgressCb } from "./webgl";

const CDN = "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-thick@1.0.0";

type Scale = 2 | 4;

let ready = false;
const upscalers = new Map<Scale, InstanceType<typeof Upscaler>>();

async function ensureTf(): Promise<void> {
  if (ready) return;
  await tf.ready();
  // WebGL is the stable TF.js GPU path in browsers
  try {
    await tf.setBackend("webgl");
    await tf.ready();
  } catch {
    /* keep default */
  }
  // More memory for large patches when available
  try {
    tf.env().set("WEBGL_DELETE_TEXTURE_THRESHOLD", 0);
    tf.env().set("WEBGL_FORCE_F16_TEXTURES", true);
  } catch {
    /* ignore */
  }
  ready = true;
}

function modelFor(scale: Scale) {
  const base = scale === 4 ? esrgan4x : esrgan2x;
  // Ensure browser can fetch weights (package path alone fails in Vite/Pages)
  const def =
    typeof base === "function"
      ? (base as () => { path?: string; scale?: number })()
      : base;
  return {
    ...def,
    path: `${CDN}/models/x${scale}/model.json`,
  };
}

async function getUpscaler(scale: Scale): Promise<InstanceType<typeof Upscaler>> {
  await ensureTf();
  let u = upscalers.get(scale);
  if (!u) {
    u = new Upscaler({ model: modelFor(scale) as never });
    upscalers.set(scale, u);
  }
  return u;
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

function tensorToCanvas(tensor: tf.Tensor3D): HTMLCanvasElement {
  const [h, w] = tensor.shape;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  // tf.browser.toPixels expects 0-1 float or int32
  // upscaler returns float 0-1
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context missing");

  // toPixels is async and writes to canvas
  // We'll use data sync for reliability
  const data = tensor.dataSync();
  const imgData = ctx.createImageData(w, h);
  const out = imgData.data;
  const rank = tensor.shape.length;
  // Tensor3D [h,w,c]
  if (rank !== 3) throw new Error("Expected Tensor3D");
  const channels = tensor.shape[2] ?? 3;

  for (let i = 0, p = 0; i < w * h; i++) {
    const r = data[i * channels] ?? 0;
    const g = data[i * channels + 1] ?? r;
    const b = data[i * channels + 2] ?? r;
    // values may be 0-1 or 0-255
    const scale = r > 1.5 || g > 1.5 || b > 1.5 ? 1 : 255;
    out[p++] = Math.max(0, Math.min(255, Math.round(r * scale)));
    out[p++] = Math.max(0, Math.min(255, Math.round(g * scale)));
    out[p++] = Math.max(0, Math.min(255, Math.round(b * scale)));
    out[p++] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
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
 * ESRGAN thick super-resolution — strong detail (Real-ESRGAN class).
 * scale 4 for smaller sources, 2 for large.
 */
export async function enhanceWithEsrgan(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  srcW: number,
  srcH: number,
  onProgress?: ProgressCb,
): Promise<EsrganResult> {
  onProgress?.({ phase: "Loading ESRGAN AI model…", progress: 5 });

  // Downscale huge inputs so 2×/4× fits in GPU memory
  let input: HTMLCanvasElement | HTMLImageElement | ImageBitmap = source;
  let inW = srcW;
  let inH = srcH;
  const maxIn = 1024; // thick model is heavy
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

  const scale: Scale = Math.max(inW, inH) < 720 ? 4 : 2;
  const bilinearCompare = makeBilinear2x(
    input as CanvasImageSource,
    inW,
    inH,
  );
  // If 4× AI, also show bilinear at 4× for fair compare
  let compareCanvas = bilinearCompare;
  if (scale === 4) {
    compareCanvas = makeBilinear2x(bilinearCompare, inW * 2, inH * 2);
  }

  onProgress?.({
    phase: `Running ESRGAN-thick ${scale}× (strong AI)…`,
    progress: 15,
  });

  const upscaler = await getUpscaler(scale);

  // Warm model once
  onProgress?.({ phase: "Warming up neural net…", progress: 22 });

  const tensor = (await upscaler.upscale(input, {
    output: "tensor",
    patchSize: scale === 4 ? 48 : 64,
    padding: 6,
    awaitNextFrame: true,
    progress: (amount: number) => {
      const pct = 25 + Math.round(Math.min(0.95, amount) * 65);
      onProgress?.({
        phase: `ESRGAN patches ${Math.round(amount * 100)}%`,
        progress: pct,
      });
    },
  })) as tf.Tensor3D;

  try {
    onProgress?.({ phase: "Writing pixels", progress: 94 });
    const canvas = tensorToCanvas(tensor);
    onProgress?.({ phase: "Done", progress: 100 });
    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      scale,
      network: `esrgan-thick-${scale}x`,
      bilinearCompare: compareCanvas,
    };
  } finally {
    tensor.dispose();
  }
}
