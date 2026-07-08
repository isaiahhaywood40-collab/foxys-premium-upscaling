/// <reference types="vite/client" />

interface GPUDevice {
  destroy?: () => void;
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
}

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
}

interface Navigator {
  gpu?: GPU;
}

declare module "@websr/websr" {
  export default class WebSR {
    canvas: HTMLCanvasElement;
    constructor(params: {
      canvas: HTMLCanvasElement;
      weights: unknown;
      network_name: string;
      gpu: GPUDevice;
      resolution?: { width: number; height: number };
      debug?: boolean;
    });
    static initWebGPU(): Promise<GPUDevice | false>;
    render(source: CanvasImageSource): Promise<void>;
    destroy(): Promise<void>;
  }
}
