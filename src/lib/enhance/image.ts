import { canvasToBlob, WebGLEnhancer, type ProgressCb } from "./webgl";
import { enhanceWithWebSR, isWebSRAvailable } from "./websr-engine";

export interface ImageEnhanceResult {
  blob: Blob;
  objectUrl: string;
  /** Left side of compare: bilinear 2× original (fair apples-to-apples). */
  compareBeforeUrl: string;
  width: number;
  height: number;
  engine: "websr" | "webgl";
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

async function bilinear2xUrl(img: HTMLImageElement): Promise<string> {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth * 2;
  c.height = img.naturalHeight * 2;
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D context missing");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await canvasToBlob(c, "image/png");
  return URL.createObjectURL(blob);
}

/** Prefer WebSR Anime4K CNN (free.upscaler engine). WebGL only if WebGPU missing. */
export async function enhanceImage(
  file: File,
  onProgress?: ProgressCb,
): Promise<ImageEnhanceResult> {
  onProgress?.({ phase: "Reading image", progress: 4 });
  const img = await loadImage(file);

  const preferJpeg =
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  const usePng = !preferJpeg || /\.png$/i.test(file.name);

  // ——— Primary: WebSR neural engine (required for competitor-class quality) ———
  const available = await isWebSRAvailable();
  if (!available) {
    console.warn("WebGPU unavailable — WebGL fallback (weaker quality)");
  } else {
    try {
      const result = await enhanceWithWebSR(
        img,
        img.naturalWidth,
        img.naturalHeight,
        onProgress,
      );

      onProgress?.({ phase: "Encoding", progress: 94 });
      const blob = await canvasToBlob(
        result.canvas,
        usePng ? "image/png" : "image/jpeg",
        usePng ? undefined : 0.95,
      );

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
    } catch (e) {
      console.error("WebSR failed:", e);
      onProgress?.({
        phase: "AI engine error — trying fallback",
        progress: 15,
      });
      // fall through to WebGL
    }
  }

  // ——— Fallback WebGL (weaker — only if AI path fails) ———
  onProgress?.({ phase: "WebGL fallback enhance", progress: 30 });
  const compareBeforeUrl = await bilinear2xUrl(img);
  const engine = new WebGLEnhancer();
  try {
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long < 640 ? 4 : long < 1280 ? 3 : 2;
    let canvas = engine.enhanceSource(
      img,
      img.naturalWidth,
      img.naturalHeight,
      { scale, strength: 1.0 },
    );
    canvas = engine.enhanceSource(canvas, canvas.width, canvas.height, {
      scale: 1,
      strength: 0.85,
    });
    onProgress?.({ phase: "Encoding", progress: 90 });
    const blob = await canvasToBlob(
      canvas,
      usePng ? "image/png" : "image/jpeg",
      usePng ? undefined : 0.95,
    );
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
