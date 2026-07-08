import { canvasToBlob, type ProgressCb } from "./webgl";
import { enhanceWithWebSR, isWebSRAvailable } from "./websr-engine";

export interface ImageEnhanceResult {
  blob: Blob;
  objectUrl: string;
  compareBeforeUrl: string;
  cropBeforeUrl: string;
  cropAfterUrl: string;
  width: number;
  height: number;
  engine: "websr";
  network: string;
  elapsedMs: number;
  isRealAI: true;
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
    img.onerror = () => reject(new Error("Could not load result"));
    img.src = url;
  });
}

async function centerCropUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  size = 320,
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
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, side, side, 0, 0, side, side);
  const blob = await canvasToBlob(c, "image/png");
  return URL.createObjectURL(blob);
}

/**
 * REAL AI only (WebSR Anime4K CNN).
 * No WebGL color-filter fallback — fails with a clear error instead.
 */
export async function enhanceImage(
  file: File,
  onProgress?: ProgressCb,
): Promise<ImageEnhanceResult> {
  const t0 = performance.now();
  onProgress?.({ phase: "Reading image", progress: 4 });
  const img = await loadImage(file);

  const ok = await isWebSRAvailable();
  if (!ok) {
    throw new Error(
      "Real AI needs Chrome or Edge with WebGPU. Open chrome://gpu and check WebGPU is available.",
    );
  }

  onProgress?.({ phase: "Running Anime4K CNN (real AI)…", progress: 12 });
  const result = await enhanceWithWebSR(
    img,
    img.naturalWidth,
    img.naturalHeight,
    onProgress,
  );

  if (!result.isRealAI) {
    throw new Error("Internal error: AI flag missing");
  }

  onProgress?.({ phase: "Encoding PNG…", progress: 90 });
  const blob = await canvasToBlob(result.canvas, "image/png");
  const objectUrl = URL.createObjectURL(blob);
  const compareBeforeBlob = await canvasToBlob(result.bilinearCompare, "image/png");
  const compareBeforeUrl = URL.createObjectURL(compareBeforeBlob);

  const beforeImg = await loadImgFromUrl(compareBeforeUrl);
  const afterImg = await loadImgFromUrl(objectUrl);
  const cropBeforeUrl = await centerCropUrl(beforeImg);
  const cropAfterUrl = await centerCropUrl(afterImg);

  onProgress?.({ phase: "Done — real AI", progress: 100 });
  return {
    blob,
    objectUrl,
    compareBeforeUrl,
    cropBeforeUrl,
    cropAfterUrl,
    width: result.width,
    height: result.height,
    engine: "websr",
    network: result.network,
    elapsedMs: Math.round(performance.now() - t0),
    isRealAI: true,
  };
}
