export type CapabilityStatus = "ok" | "warn" | "bad" | "unknown";

export interface BrowserCapabilities {
  webgpu: CapabilityStatus;
  webcodecs: CapabilityStatus;
  webgl: CapabilityStatus;
  mediaRecorder: CapabilityStatus;
  details: string[];
}

function hasWebCodecs(): boolean {
  return (
    typeof VideoDecoder !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

function hasMediaRecorder(): boolean {
  return typeof MediaRecorder !== "undefined";
}

/** Probe browser features for client-side upscaling. */
export async function detectCapabilities(): Promise<BrowserCapabilities> {
  const details: string[] = [];

  let webgpu: CapabilityStatus = "bad";
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        webgpu = "ok";
        details.push("WebGPU available (future models)");
      } else {
        webgpu = "warn";
        details.push("WebGPU present but no adapter");
      }
    } catch (err) {
      webgpu = "warn";
      details.push(
        `WebGPU: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    details.push("WebGPU not required — using WebGL pipeline");
  }

  const webgl: CapabilityStatus = hasWebGL() ? "ok" : "bad";
  if (webgl === "ok") {
    details.push("WebGL ready for 2× enhance");
  } else {
    details.push("WebGL missing — enhancement unavailable");
  }

  const webcodecs: CapabilityStatus = hasWebCodecs() ? "ok" : "warn";
  if (webcodecs === "ok") details.push("WebCodecs available");

  const mediaRecorder: CapabilityStatus = hasMediaRecorder() ? "ok" : "warn";
  if (mediaRecorder === "ok") {
    details.push("MediaRecorder ready for video export");
  } else {
    details.push("MediaRecorder missing — video export limited");
  }

  return { webgpu, webcodecs, webgl, mediaRecorder, details };
}

/** Images need WebGL; video also needs MediaRecorder. */
export function canRunLocalUpscale(caps: BrowserCapabilities): boolean {
  // Real AI (WebSR) requires WebGPU — do not pretend WebGL filters are enough
  return caps.webgpu === "ok";
}

export function canEnhanceVideo(caps: BrowserCapabilities): boolean {
  return caps.webgl === "ok" && caps.mediaRecorder === "ok";
}
