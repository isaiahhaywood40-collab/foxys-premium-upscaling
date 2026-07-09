import WebSR from '@websr/websr';

import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  InitData,
  NetworkData,
  Resolution
} from './types/worker-messages';

// Processors
import pipelineProcessor from './processors/pipeline-processor';
 import mediabunnyProcessor from './processors/mediabunny-processor'; // Fallback if needed

// Worker state
let gpu: any | false;
let websr: WebSR;
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution;
let ctx: ImageBitmapRenderingContext | null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Default weights
const weights = require('./weights/cnn-2x-m-rl.json');

/**
 * Check if WebGPU is supported in this environment
 */
async function isSupported(): Promise<void> {
  gpu = await WebSR.initWebGPU();

  postMessage({
    cmd: 'isSupported',
    data: gpu !== false
  } satisfies WorkerResponseMessage);
}

/**
 * Initialize the worker with canvases and create WebSR instance
 */
async function init(config: InitData): Promise<void> {
  if (!gpu) {
    gpu = await WebSR.initWebGPU();
  }

  websr = new WebSR({
    network_name: "anime4k/cnn-2x-m",
    weights,
    resolution: config.resolution,
    gpu: gpu,
    canvas: config.upscaled as any // OffscreenCanvas is valid but types may be strict
  });

  resolution = config.resolution;
  upscaled_canvas = config.upscaled;
  original_canvas = config.original;

  ctx = original_canvas.getContext('bitmaprenderer');

  const bitmap2 = await createImageBitmap(config.bitmap, {
    resizeHeight: config.resolution.height * 2,
    resizeWidth: config.resolution.width * 2,
  });

  await websr.render(config.bitmap as any);

  if (ctx) {
    ctx.transferFromImageBitmap(bitmap2);
  }
}

/**
 * Switch to a different AI upscaling network
 */
async function switchNetwork(name: string, weights: any, bitmap: ImageBitmap): Promise<void> {
  websr.switchNetwork(name as any, weights);

  await websr.render(bitmap as any);
}






// Processing functions moved to processors/

/**
 * Worker message handler with type-safe message routing
 */
self.onmessage = async function (event: MessageEvent<WorkerRequestMessage>) {
  if (!event.data.cmd) return;

  switch (event.data.cmd) {
    case 'init':
      try {
        await init(event.data.data);
      } catch (err: any) {
        postMessage({
          cmd: 'error',
          data: err?.message || String(err) || 'WebGPU preview failed',
        } satisfies WorkerResponseMessage);
      }
      break;

    case 'isSupported':
      try {
        await isSupported();
      } catch {
        postMessage({ cmd: 'isSupported', data: false } satisfies WorkerResponseMessage);
      }
      break;

    case 'pause':
      if (!pauseLock) {
        pauseLock = new Promise(resolve => { resolvePause = resolve; });
        postMessage({ cmd: 'paused' } satisfies WorkerResponseMessage);
      }
      break;

    case 'resume':
      if (pauseLock && resolvePause) {
        resolvePause();
        pauseLock = null;
        resolvePause = null;
        postMessage({ cmd: 'resumed' } satisfies WorkerResponseMessage);
      }
      break;
    
    case 'process':
      try {
        if (!websr || !upscaled_canvas || !original_canvas || !resolution) {
          postMessage({
            cmd: 'error',
            data: 'Upscaler not ready. Reload the page and choose a file again.',
          } satisfies WorkerResponseMessage);
          break;
        }
        await pipelineProcessor({
          file: event.data.file,
          inputHandle: event.data.inputHandle,
          outputHandle: event.data.outputHandle,
          websr,
          upscaled_canvas,
          original_canvas,
          resolution,
          getPauseLock: () => pauseLock,
        });
      } catch (err: any) {
        postMessage({
          cmd: 'error',
          data: err?.message || String(err) || 'Processing failed',
        } satisfies WorkerResponseMessage);
      }
      break;

    case 'exportImage':
      try {
        if (!upscaled_canvas) {
          postMessage({
            cmd: 'error',
            data: 'No upscaled image ready. Choose a file again.',
          } satisfies WorkerResponseMessage);
          break;
        }
        postMessage({ cmd: 'progress', data: 50 });
        const blob = await upscaled_canvas.convertToBlob({ type: 'image/png' });
        postMessage({ cmd: 'progress', data: 100 });
        postMessage({ cmd: 'finished', data: blob } satisfies WorkerResponseMessage);
      } catch (err: any) {
        postMessage({
          cmd: 'error',
          data: err?.message || String(err) || 'Image export failed',
        } satisfies WorkerResponseMessage);
      }
      break;

    case 'network':
      try {
        await switchNetwork(
          event.data.data.name,
          event.data.data.weights,
          event.data.data.bitmap
        );
      } catch (err: any) {
        postMessage({
          cmd: 'error',
          data: err?.message || String(err) || 'Network switch failed',
        } satisfies WorkerResponseMessage);
      }
      break;
  }
};

self.onerror = (event) => {
  postMessage({
    cmd: 'error',
    data: typeof event === 'string' ? event : (event as ErrorEvent).message || 'Worker error',
  } satisfies WorkerResponseMessage);
};
