import Alpine from 'alpinejs';
import ImageCompare from './lib/image-compare-viewer.min';
import WebSR from '@websr/websr';
import type { WorkerRequestMessage, WorkerResponseMessage } from './types/worker-messages';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import "./index.css";
import "./lib/image-compare-viewer.min.css";

const MAX_FILE_BLOB_SIZE=1900*1024*1024; //Just under 2GB, max ArrayBufferSize

// Web Worker for video processing
const worker = new Worker(new URL('./worker.ts', import.meta.url));

// Canvas and video elements
let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;

// Network selection
type NetworkSize = 'small' | 'medium' | 'large';
type ContentType = 'rl' | 'an' | '3d';

let size: NetworkSize = 'medium';
let content: ContentType = 'rl';

// Video data
let download_name: string;
let inputFile: File | null = null;
let inputFileHandle: FileSystemFileHandle | undefined;
let gpu: any;
let websr: WebSR;

// AI model weights for different network sizes and content types
type WeightsMap = {
    [K in NetworkSize]: {
        [C in ContentType]: any;
    };
};

const weights: WeightsMap = {
    'large': {
        'rl': require('./weights/cnn-2x-l-rl.json'),
        'an': require('./weights/cnn-2x-l-an.json'),
        '3d': require('./weights/cnn-2x-l-3d.json'),
    },
    'medium': {
        'rl': require('./weights/cnn-2x-m-rl.json'),
        'an': require('./weights/cnn-2x-m-an.json'),
        '3d': require('./weights/cnn-2x-m-3d.json'),
    },
    'small': {
        'rl': require('./weights/cnn-2x-s-rl.json'),
        'an': require('./weights/cnn-2x-s-an.json'),
        '3d': require('./weights/cnn-2x-s-3d.json'),
    }
};

// Network name mapping
const networks: Record<NetworkSize, { name: string }> = {
    'small': {
        name: "anime4k/cnn-2x-s",
    },
    'medium': {
        name: "anime4k/cnn-2x-m",
    },
    'large': {
        name: "anime4k/cnn-2x-l",
    }
};

// Declare global window functions for Alpine to call and File System Access API
declare global {
    interface Window {
        chooseFile: (e?: Event) => Promise<void>;
        initRecording: () => Promise<void>;
        fullScreenPreview: (e?: Event) => Promise<void>;
        switchNetworkSize: (el: HTMLInputElement) => Promise<void>;
        switchNetworkStyle: (el: HTMLInputElement) => Promise<void>;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        showOpenFilePicker: (options?: any) => Promise<FileSystemFileHandle[]>;
        togglePause: () => void;
    }
}

document.addEventListener("DOMContentLoaded", index);

//===================  Initial Load ===========================

/**
 * Main initialization function called on page load
 */
async function index(): Promise<void> {
    Alpine.store('state', 'init');
    Alpine.store('target', 'blob');
    Alpine.store('progress', 0);
    Alpine.store('eta', '');
    Alpine.store('error', '');
    Alpine.store('component', '');

    Alpine.start();
    document.body.style.display = "block";

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;

    // Wire hidden file input (works on all Chromium builds; no File System Access needed)
    const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (file) await loadVideoFromFile(file);
        });
    }

    worker.onerror = (err) => {
        console.error('Worker error', err);
        showError(err.message || 'Background worker failed to load. Hard-refresh the page.');
    };

    if (!("VideoEncoder" in window) || !("VideoDecoder" in window)) {
        return showUnsupported("WebCodecs (use latest Chrome or Edge)");
    }

    // WebGPU checked in worker — don't block on File System Access API (blob download works)
    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);

    window.chooseFile = chooseFile;
}

/**
 * Show unsupported browser feature message
 */
function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
}

/**
 * Open the system file picker. Prefer a plain <input type="file"> so it always
 * works in Chrome/Edge without special permissions.
 */
async function chooseFile(_e?: Event): Promise<void> {
    try {
        const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
        if (fileInput) {
            fileInput.click();
            return;
        }

        // Fallback: File System Access API
        if (typeof window.showOpenFilePicker === 'function') {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Video Files',
                    accept: {
                        'video/mp4': ['.mp4'],
                        'video/webm': ['.webm'],
                        'video/quicktime': ['.mov'],
                    },
                }],
                multiple: false,
            });
            const file = await fileHandle.getFile();
            await loadVideoFromFile(file, fileHandle);
            return;
        }

        showError('This browser cannot open local files. Use Chrome or Edge on desktop.');
    } catch (e: any) {
        // User cancelled, or real error
        if (e?.name === 'AbortError') return;
        console.error(e);
        showError(e?.message || 'Could not open file picker');
    }
}

//===================  Preview ===========================

/**
 * Load a video File for preview + processing
 */
async function loadVideoFromFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
    try {
        Alpine.store('state', 'loading');
        Alpine.store('error', '');

        inputFile = file;
        inputFileHandle = handle;

        download_name = file.name.replace(/\.[^.]+$/, '') + '-upscaled.mp4';
        Alpine.store('download_name', download_name);
        Alpine.store('filename', file.name);

        const arrayBuffer = await file.arrayBuffer();
        await setupPreview(arrayBuffer);
    } catch (e: any) {
        console.error(e);
        showError(e?.message || 'Failed to load video. Try a different MP4.');
    }
}

/**
 * Set up the preview UI with before/after comparison
 */
async function setupPreview(data: ArrayBuffer): Promise<void> {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    // Sniff type from loaded file when possible
    const mime = inputFile?.type || 'video/mp4';
    const fileBlob = new Blob([data], { type: mime });

    video.src = URL.createObjectURL(fileBlob);

    const imageCompare = document.getElementById('image-compare-outer') as HTMLElement;

    video.onerror = () => {
        showError('Could not decode this video in the browser. Try an H.264 MP4.');
    };

    video.onloadeddata = async function (){
        Alpine.store('width', video.videoWidth);
        Alpine.store('height', video.videoHeight);
        upscaled_canvas.width = video.videoWidth*2;
        upscaled_canvas.height = video.videoHeight*2;
        original_canvas.width = video.videoWidth*2;
        original_canvas.height = video.videoHeight*2;


        imageCompare.style.height = '318px';
        imageCompare.style.width =  `${Math.round(video.videoWidth/video.videoHeight*318)}px`
        imageCompare.style.margin = 'auto';
        imageCompare.style.position = 'relative';


        new ImageCompare(document.getElementById('image-compare')).mount();
        video.currentTime = video.duration * 0.2 || 0;
        if(video.requestVideoFrameCallback)  video.requestVideoFrameCallback(showPreview);
        else requestAnimationFrame(showPreview);

        window.togglePause = function () {
            const currentState = Alpine.store('state');
            if (currentState === 'processing') {
                worker.postMessage({ cmd: 'pause' } satisfies WorkerRequestMessage);
            } else if (currentState === 'paused') {
                worker.postMessage({ cmd: 'resume' } satisfies WorkerRequestMessage);
            }
        };

    }




    async function showPreview(){
        try {
        const fullScreenButton = document.getElementById('full-screen');


        window.initRecording = initRecording;
        window.fullScreenPreview = fullScreenPreview;

        const bitmap = await createImageBitmap(video);


        const upscaled = upscaled_canvas.transferControlToOffscreen();
        const original =    original_canvas.transferControlToOffscreen();


        worker.postMessage({cmd: "init", data: {
                bitmap,
                upscaled,
                original,
                resolution: {
                    width: video.videoWidth,
                    height: video.videoHeight
                }

            }}, [bitmap, upscaled, original]);


        // Default to 'rl' (real life) network
        content = 'rl';
        await updateNetwork();
        Alpine.store('style', 'rl');









        function setFullScreenLocation(){
            const containerWidth = Math.round(video.videoWidth/video.videoHeight*318);
            const containerHeight = 318;
            
            // Position at bottom-right of the preview container (with small padding)
            fullScreenButton.style.left = `${imageCompare.offsetLeft + containerWidth - 20}px`;
            fullScreenButton.style.top = `${imageCompare.offsetTop + containerHeight - 20}px`;
        }

        setTimeout(setFullScreenLocation, 20);
        setTimeout(setFullScreenLocation, 60);
        setTimeout(setFullScreenLocation, 200);





        imageCompare.addEventListener('fullscreenchange', function () {
            if(!document.fullscreenElement){
                // Reset canvas styles
                upscaled_canvas.style.width = ``;
                upscaled_canvas.style.height = ``;
                original_canvas.style.width = ``;
                original_canvas.style.height = ``;
                
                // Reset container styles to original preview dimensions
                const imageCompareOuter = document.getElementById('image-compare-outer');
                const imageCompareInner = document.getElementById('image-compare');
                
                // Reset outer container
                imageCompareOuter.style.width = ``;
                imageCompareOuter.style.height = ``;
                imageCompareOuter.style.backgroundColor = ``;
                imageCompareOuter.style.display = ``;
                imageCompareOuter.style.justifyContent = ``;
                imageCompareOuter.style.alignItems = ``;
                
                // Reset inner container to original preview size
                imageCompareInner.style.height = '318px';
                imageCompareInner.style.width = `${Math.round(video.videoWidth/video.videoHeight*318)}px`;
                imageCompareInner.style.margin = 'auto';
                imageCompareInner.style.position = 'relative';
            }
        });

        let bitrate = getBitrate();

        const estimated_size = (bitrate/8)*video.duration + (128/8)*video.duration; // Assume 128 kbps audio

        if(estimated_size > MAX_FILE_BLOB_SIZE){
            Alpine.store('target', 'writer');
        } else {
            Alpine.store('target', 'blob');
        }

        const quota = (await navigator.storage.estimate()).quota;

        if(estimated_size > quota){
            return showError(`The video is too big. It would output a file of ${humanFileSize(estimated_size)} but the browser can only write files up to ${humanFileSize(quota)}`);
        }


        Alpine.store('size', humanFileSize(estimated_size))


        function canvasFullScreen(){
            // Calculate aspect ratios
            const videoAspectRatio = video.videoWidth / video.videoHeight;
            const screenAspectRatio = window.innerWidth / window.innerHeight;
            
            let displayWidth, displayHeight;

            const imageCompareOuter = document.getElementById('image-compare-outer');
            const imageCompareInner = document.getElementById('image-compare');
            
            // If video is wider than screen, fit to width (letterbox on top/bottom)
            if (videoAspectRatio > screenAspectRatio) {
                displayWidth = window.innerWidth;
                displayHeight = window.innerWidth / videoAspectRatio;
            } 
            // If video is taller than screen, fit to height (pillarbox on sides)
            else {
                displayWidth = window.innerHeight * videoAspectRatio;
                displayHeight = window.innerHeight;
            }
            
            // Style the outer container to fill screen with black background and center content
            imageCompareOuter.style.width = `${window.innerWidth}px`;
            imageCompareOuter.style.height = `${window.innerHeight}px`;
            imageCompareOuter.style.backgroundColor = 'black';
            imageCompareOuter.style.display = 'flex';
            imageCompareOuter.style.justifyContent = 'center';
            imageCompareOuter.style.alignItems = 'center';
            

            console.log("Image Compare Outer", imageCompareOuter);
            console.log("Image Compare Inner", imageCompareInner);
            // Size the inner container to maintain aspect ratio
            imageCompareInner.style.width = `${displayWidth}px`;
            imageCompareInner.style.height = `${displayHeight}px`;
            
            // Let the canvases fill their parent container
            upscaled_canvas.style.width = `${displayWidth}px`;
            upscaled_canvas.style.height = `${displayHeight}px`;
            original_canvas.style.width = `${displayWidth}px`;
            original_canvas.style.height = `${displayHeight}px`;
        }

        async function fullScreenPreview(e) {
            imageCompare.requestFullscreen();
            setTimeout(canvasFullScreen, 20);
            setTimeout(canvasFullScreen, 60);
            setTimeout(canvasFullScreen, 200);

        }


        Alpine.store('state', 'preview');




        window.switchNetworkSize = async function(el: HTMLInputElement){
            if(el.value !== size){
                size = el.value as NetworkSize;

                await updateNetwork();
            }
        }

        window.switchNetworkStyle = async function(el: HTMLInputElement){
            if(el.value !== content){
                content = el.value as ContentType;

                await updateNetwork();
            }
        }

        } catch (e: any) {
            console.error(e);
            showError(e?.message || 'Failed to build preview. Your GPU/WebGPU may be blocked.');
        }
    }

}


/**
 * Handle messages from the video processing worker
 */
worker.onmessage = function (event: MessageEvent<WorkerResponseMessage>) {
    if (event.data.cmd === 'isSupported') {
        const supported = event.data.data;

        if (!supported) return showUnsupported("WebGPU");

    } else if (event.data.cmd === 'progress') {
        Alpine.store('progress', event.data.data);
        if (Alpine.store('state') !== 'paused') {
            Alpine.store('state', 'processing');
        }

    } else if (event.data.cmd === 'process') {
        // Processing started

    } else if (event.data.cmd === 'error') {
        showError(event.data.data);

    } else if (event.data.cmd === 'eta') {
        Alpine.store('eta', event.data.data);

    } else if (event.data.cmd === 'finished') {
        Alpine.store('state', 'complete');
        Alpine.store('download_url', event.data.data ? window.URL.createObjectURL(event.data.data) : null);
    }
    else if (event.data.cmd === 'paused') {
        Alpine.store('state', 'paused');
    } else if (event.data.cmd === 'resumed') {
        Alpine.store('state', 'processing');
    }
};



/**
 * Switch to a different upscaling network
 */
async function updateNetwork(): Promise<void> {
    const bitmap = await createImageBitmap(video);

    worker.postMessage({
        cmd: 'network',
        data: {
            name: networks[size].name,
            bitmap,
            weights: weights[size][content]
        }
    } satisfies WorkerRequestMessage);
}

//===================  Process ===========================

/**
 * Start the video upscaling process
 */
async function initRecording(): Promise<void> {
    try {
        if (!inputFile && !inputFileHandle) {
            return showError('No video loaded. Choose a video first.');
        }

        Alpine.store('state', 'loading');
        Alpine.store('progress', 0);
        Alpine.store('eta', 'starting…');

        const bitrate = getBitrate();
        const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration;

        let outputHandle: FileSystemFileHandle | undefined;

        // Huge files need File System Access write; smaller ones download as a blob
        if (estimated_size > MAX_FILE_BLOB_SIZE) {
            if (typeof window.showSaveFilePicker !== 'function') {
                return showError(
                    'This video is too large for in-browser download. Use Chrome/Edge desktop, or try a shorter clip.'
                );
            }
            try {
                outputHandle = await showFilePicker();
            } catch (e) {
                console.warn('User aborted save location');
                Alpine.store('state', 'preview');
                return;
            }
        }

        // Prefer File (cloneable); handle optional for huge-file path
        worker.postMessage({
            cmd: 'process',
            file: inputFile || undefined,
            inputHandle: inputFileHandle,
            outputHandle,
        } satisfies WorkerRequestMessage);
    } catch (e: any) {
        console.error(e);
        showError(e?.message || 'Failed to start upscaling');
    }
}

/**
 * Display error message to user
 */
function showError(message: string): void {
    Alpine.store('state', 'error');
    Alpine.store('error', message);
}

/**
 * Calculate target bitrate based on video resolution
 */
function getBitrate(): number {
    return 5e6 * Math.sqrt((video.videoWidth * video.videoHeight * 4) / (1280 * 720));
}

/**
 * Format bytes into human-readable file size
 */
function humanFileSize(bytes: number, si: boolean = false, dp: number = 1): string {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

    return bytes.toFixed(dp) + ' ' + units[u];
}

/**
 * Show native file picker for saving output video
 */
async function showFilePicker(): Promise<FileSystemFileHandle> {
    const handle = await window.showSaveFilePicker({
        startIn: 'downloads',
        suggestedName: download_name,
        types: [{
            description: 'Video File',
            accept: { 'video/mp4': ['.mp4'] }
        }],
    });

    return handle;
}












