import { canvasToBlob, WebGLEnhancer, type ProgressCb } from "./webgl";
import { enhanceWithWebSR, isWebSRAvailable } from "./websr-engine";

export interface ImageEnhanceResult {
  blob: Blob;
  objectUrl: string;
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

/** Prefer WebSR (Anime4K CNN / same stack as free.upscaler). WebGL fallback. */
export async function enhanceImage(
  file: File,
  onProgress?: ProgressCb,
): Promise<ImageEnhanceResult> {
  onProgress?.({ phase: "Reading image", progress: 4 });
  const img = await loadImage(file);

  const preferJpeg =
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  const usePng = !preferJpeg || /\.png$/i.test(file.name);

  // ——— Primary: WebSR neural engine ———
  try {
    const available = await isWebSRAvailable();
    if (available) {
      const result = await enhanceWithWebSR(
        img,
        img.naturalWidth,
        img.naturalHeight,
        onProgress,
        "l",
      );

      onProgress?.({ phase: "Encoding", progress: 92 });
      const blob = await canvasToBlob(
        result.canvas,
        usePng ? "image/png" : "image/jpeg",
        usePng ? undefined : 0.95,
      );
      return {
        blob,
        objectUrl: URL.createObjectURL(blob),
        width: result.width,
        height: result.height,
        engine: "websr",
        network: result.network,
      };
    }
  } catch (e) {
    console.warn("WebSR path failed, falling back to WebGL", e);
    onProgress?.({
      phase: "AI engine unavailable — using fallback",
      progress: 20,
    });
  }

  // ——— Fallback: multi-pass WebGL ———
  onProgress?.({ phase: "WebGL enhance", progress: 30 });
  const engine = new WebGLEnhancer();
  try {
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long < 640 ? 4 : long < 1280 ? 3 : 2;
    let canvas = engine.enhanceSource(
      img,
      img.naturalWidth,
      img.naturalHeight,
      { scale, strength: 0.95 },
    );
    onProgress?.({ phase: "Clarity pass", progress: 70 });
    canvas = engine.enhanceSource(canvas, canvas.width, canvas.height, {
      scale: 1,
      strength: 0.75,
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
      width: canvas.width,
      height: canvas.height,
      engine: "webgl",
    };
  } finally {
    engine.destroy();
  }
}
