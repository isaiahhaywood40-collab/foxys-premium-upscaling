import { canvasToBlob, WebGLEnhancer, type ProgressCb } from "./webgl";
import { enhanceWithWebSR, isWebSRAvailable } from "./websr-engine";

export interface ImageEnhanceResult {
  blob: Blob;
  objectUrl: string;
  /** Left side of compare: bilinear 2× original (same size as AI output). */
  compareBeforeUrl: string;
  /** 100% pixel crops (center) so difference is obvious at a glance. */
  cropBeforeUrl: string;
  cropAfterUrl: string;
  width: number;
  height: number;
  engine: "websr" | "webgl";
  network?: string;
  elapsedMs: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

async function loadImgFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load result image"));
    img.src = url;
  });
}

/** Center crop at native pixels (no resize) — shows real detail difference. */
async function centerCropUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  size = 280,
): Promise<string> {
  const w =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const side = Math.min(size, w, h);
  const sx = Math.max(0, Math.floor((w - side) / 2));
  const sy = Math.max(0, Math.floor((h - side) / 2));
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D missing");
  ctx.imageSmoothingEnabled = false; // true 100% pixels
  ctx.drawImage(source, sx, sy, side, side, 0, 0, side, side);
  const blob = await canvasToBlob(c, "image/png");
  return URL.createObjectURL(blob);
}

/**
 * Fast path only (no multi-minute ESRGAN):
 * 1) WebSR Anime4K CNN (free.upscaler engine) — seconds
 * 2) WebGL — instant fallback
 */
export async function enhanceImage(
  file: File,
  onProgress?: ProgressCb,
): Promise<ImageEnhanceResult> {
  const t0 = performance.now();
  onProgress?.({ phase: "Reading image", progress: 5 });
  const img = await loadImage(file);

  const preferJpeg =
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  const usePng = !preferJpeg || /\.png$/i.test(file.name);

  const encode = async (canvas: HTMLCanvasElement) =>
    canvasToBlob(
      canvas,
      usePng ? "image/png" : "image/jpeg",
      usePng ? undefined : 0.92,
    );

  const finish = async (
    canvas: HTMLCanvasElement,
    compareBefore: HTMLCanvasElement | string,
    engine: "websr" | "webgl",
    network?: string,
  ): Promise<ImageEnhanceResult> => {
    onProgress?.({ phase: "Saving…", progress: 90 });
    const blob = await encode(canvas);
    const objectUrl = URL.createObjectURL(blob);

    let compareBeforeUrl: string;
    if (typeof compareBefore === "string") {
      compareBeforeUrl = compareBefore;
    } else {
      const b = await canvasToBlob(compareBefore, "image/png");
      compareBeforeUrl = URL.createObjectURL(b);
    }

    // 100% crops from full-res before/after
    const beforeImg = await loadImgFromUrl(compareBeforeUrl);
    const afterImg = await loadImgFromUrl(objectUrl);
    const cropBeforeUrl = await centerCropUrl(beforeImg);
    const cropAfterUrl = await centerCropUrl(afterImg);

    onProgress?.({ phase: "Done", progress: 100 });
    return {
      blob,
      objectUrl,
      compareBeforeUrl,
      cropBeforeUrl,
      cropAfterUrl,
      width: canvas.width,
      height: canvas.height,
      engine,
      network,
      elapsedMs: Math.round(performance.now() - t0),
    };
  };

  // ——— WebSR first (fast AI, same family as free.upscaler) ———
  try {
    if (await isWebSRAvailable()) {
      onProgress?.({ phase: "AI upscale (WebSR / Anime4K)…", progress: 15 });
      const result = await enhanceWithWebSR(
        img,
        img.naturalWidth,
        img.naturalHeight,
        onProgress,
      );
      return await finish(
        result.canvas,
        result.bilinearCompare,
        "websr",
        result.network,
      );
    }
  } catch (e) {
    console.error("WebSR failed:", e);
    onProgress?.({ phase: "Falling back…", progress: 40 });
  }

  // ——— WebGL instant fallback ———
  onProgress?.({ phase: "Fast enhance…", progress: 50 });
  const engine = new WebGLEnhancer();
  try {
    const canvas = engine.enhanceSource(
      img,
      img.naturalWidth,
      img.naturalHeight,
      { scale: 2, strength: 1.0 },
    );
    // one clarity pass only (skip second heavy pass)
    const final = engine.enhanceSource(canvas, canvas.width, canvas.height, {
      scale: 1,
      strength: 0.85,
    });
    const bilinear = document.createElement("canvas");
    bilinear.width = final.width;
    bilinear.height = final.height;
    const bctx = bilinear.getContext("2d", { alpha: false });
    if (!bctx) throw new Error("2D missing");
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(img, 0, 0, bilinear.width, bilinear.height);
    return await finish(final, bilinear, "webgl");
  } finally {
    engine.destroy();
  }
}
