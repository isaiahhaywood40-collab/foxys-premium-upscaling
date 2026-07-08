import { enhanceImage, type ImageEnhanceResult } from "./image";
import { enhanceVideo, type VideoEnhanceResult } from "./video";
import type { ProgressCb } from "./webgl";

export type EnhanceResult = (
  | ImageEnhanceResult
  | (VideoEnhanceResult & {
      compareBeforeUrl?: string;
      cropBeforeUrl?: string;
      cropAfterUrl?: string;
      engine?: "websr" | "webgl";
      network?: string;
      elapsedMs?: number;
      isRealAI?: boolean;
    })
) & {
  kind: "image" | "video";
  downloadName: string;
};

export type { ProgressCb };

function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

function outName(file: File, kind: "image" | "video"): string {
  const base = file.name.replace(/\.[^.]+$/, "") || "foxy-enhanced";
  if (kind === "image") {
    const jpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
    return `${base}-foxy-2x.${jpeg ? "jpg" : "png"}`;
  }
  return `${base}-foxy-2x.webm`;
}

export async function enhanceMedia(
  file: File,
  onProgress?: ProgressCb,
): Promise<EnhanceResult> {
  if (isImageFile(file)) {
    const r = await enhanceImage(file, onProgress);
    return {
      ...r,
      kind: "image",
      downloadName: outName(file, "image"),
    };
  }
  if (isVideoFile(file)) {
    const r = await enhanceVideo(file, onProgress);
    return {
      ...r,
      kind: "video",
      downloadName: outName(file, "video"),
    };
  }
  throw new Error("Unsupported file type. Use MP4, WebM, PNG, JPG, or WebP.");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
