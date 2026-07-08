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
        try {
          const dev = await adapter.requestDevice();
          webgpu = "ok";
          details.push("WebGPU ready for real AI");
          try {
            dev.destroy?.();
          } catch {
            /* ignore */
          }
        } catch {
          webgpu = "warn";
          details.push("WebGPU adapter found but device request failed");
        }
      } else {
        webgpu = "warn";
        details.push("WebGPU API present but no adapter");
      }
    } catch (err) {
      webgpu = "warn";
      details.push(
        `WebGPU: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    details.push("No WebGPU — use desktop Chrome or Edge for AI");
  }

  const webgl: CapabilityStatus = hasWebGL() ? "ok" : "bad";
  if (webgl === "ok") details.push("WebGL available");

  const webcodecs: CapabilityStatus = hasWebCodecs() ? "ok" : "warn";
  const mediaRecorder: CapabilityStatus = hasMediaRecorder() ? "ok" : "warn";

  return { webgpu, webcodecs, webgl, mediaRecorder, details };
}

/** Allow Upscale click if WebGPU looks usable (ok or warn). */
export function canRunLocalUpscale(caps: BrowserCapabilities): boolean {
  return caps.webgpu === "ok" || caps.webgpu === "warn";
}

export function canEnhanceVideo(caps: BrowserCapabilities): boolean {
  return caps.webgl === "ok" && caps.mediaRecorder === "ok";
}
