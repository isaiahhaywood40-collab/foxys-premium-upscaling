import { canvasToBlob, WebGLEnhancer, type ProgressCb } from "./webgl";
import { enhanceWithWebSR, isWebSRAvailable } from "./websr-engine";

export interface ImageEnhanceResult {
  blob: Blob;
  objectUrl: string;
  /** Left side of compare: bilinear upscale of original (fair compare). */
  compareBeforeUrl: string;
  width: number;
  height: number;
  engine: "esrgan" | "websr" | "webgl";
  network?: string;
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

async function bilinearUrl(
  img: HTMLImageElement,
  scale: number,
): Promise<string> {
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D context missing");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await canvasToBlob(c, "image/png");
  return URL.createObjectURL(blob);
}

/**
 * Quality order (strongest first):
 * 1. ESRGAN-thick (Real-ESRGAN class) — dramatic detail
 * 2. WebSR Anime4K CNN — free.upscaler family
 * 3. WebGL filters — last resort
 */
export async function enhanceImage(
  file: File,
  onProgress?: ProgressCb,
): Promise<ImageEnhanceResult> {
  onProgress?.({ phase: "Reading image", progress: 3 });
  const img = await loadImage(file);

  const preferJpeg =
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  const usePng = !preferJpeg || /\.png$/i.test(file.name);

  const encode = async (canvas: HTMLCanvasElement) => {
    const blob = await canvasToBlob(
      canvas,
      usePng ? "image/png" : "image/jpeg",
      usePng ? undefined : 0.95,
    );
    return blob;
  };

  // ——— 1) ESRGAN thick (strong Real-ESRGAN class) ———
  try {
    onProgress?.({ phase: "Loading strong AI engine (ESRGAN)…", progress: 5 });
    const { enhanceWithEsrgan, isEsrganAvailable } = await import(
      "./esrgan-engine"
    );
    if (await isEsrganAvailable()) {
      const result = await enhanceWithEsrgan(
        img,
        img.naturalWidth,
        img.naturalHeight,
        onProgress,
      );
      const blob = await encode(result.canvas);
      const compareBeforeBlob = await canvasToBlob(
        result.bilinearCompare,
        "image/png",
      );
      onProgress?.({ phase: "Done", progress: 100 });
      return {
        blob,
        objectUrl: URL.createObjectURL(blob),
        compareBeforeUrl: URL.createObjectURL(compareBeforeBlob),
        width: result.width,
        height: result.height,
        engine: "esrgan",
        network: result.network,
      };
    }
  } catch (e) {
    console.error("ESRGAN path failed:", e);
    onProgress?.({ phase: "ESRGAN failed — trying WebSR…", progress: 12 });
  }

  // ——— 2) WebSR Anime4K ———
  try {
    if (await isWebSRAvailable()) {
      const result = await enhanceWithWebSR(
        img,
        img.naturalWidth,
        img.naturalHeight,
        onProgress,
      );
      const blob = await encode(result.canvas);
      const compareBeforeBlob = await canvasToBlob(
        result.bilinearCompare,
        "image/png",
      );
      onProgress?.({ phase: "Done", progress: 100 });
      return {
        blob,
        objectUrl: URL.createObjectURL(blob),
        compareBeforeUrl: URL.createObjectURL(compareBeforeBlob),
        width: result.width,
        height: result.height,
        engine: "websr",
        network: result.network,
      };
    }
  } catch (e) {
    console.error("WebSR path failed:", e);
    onProgress?.({ phase: "WebSR failed — WebGL fallback…", progress: 18 });
  }

  // ——— 3) WebGL last resort ———
  onProgress?.({ phase: "WebGL enhance", progress: 30 });
  const compareBeforeUrl = await bilinearUrl(img, 2);
  const engine = new WebGLEnhancer();
  try {
    let canvas = engine.enhanceSource(
      img,
      img.naturalWidth,
      img.naturalHeight,
      { scale: 2, strength: 1.0 },
    );
    canvas = engine.enhanceSource(canvas, canvas.width, canvas.height, {
      scale: 1,
      strength: 0.9,
    });
    const blob = await encode(canvas);
    onProgress?.({ phase: "Done", progress: 100 });
    return {
      blob,
      objectUrl: URL.createObjectURL(blob),
      compareBeforeUrl,
      width: canvas.width,
      height: canvas.height,
      engine: "webgl",
    };
  } finally {
    engine.destroy();
  }
}
