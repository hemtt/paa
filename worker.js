import init, { FromPaaResult, ToPaaResult } from './pkg/hemtt_paa.js';

let wasmReady = false;
let wasmMemoryBuffer = null;

// Resize image to target dimensions
async function resizeImage(uint8Array, targetWidth, targetHeight) {
    return new Promise((resolve, reject) => {
        // Create blob and read as image
        const blob = new Blob([uint8Array]);
        const url = URL.createObjectURL(blob);
        
        // Use bitmap to avoid DOM access in worker
        createImageBitmap(blob).then(bitmap => {
            const canvas = new OffscreenCanvas(targetWidth, targetHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            
            canvas.convertToBlob({ type: 'image/png' }).then(resultBlob => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve(new Uint8Array(e.target.result));
                    URL.revokeObjectURL(url);
                };
                reader.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to read resized image'));
                };
                reader.readAsArrayBuffer(resultBlob);
            }).catch(err => {
                URL.revokeObjectURL(url);
                reject(err);
            });
        }).catch(err => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to create image bitmap: ' + err.message));
        });
    });
}

// Extract dimensions from PNG data
function extractPngDimensions(uint8Array) {
    // PNG signature: 137 80 78 71 13 10 26 10
    // Width and height are at bytes 16-24 (big-endian)
    if (uint8Array.length < 24) return null;
    
    const view = new DataView(uint8Array.buffer, uint8Array.byteOffset);
    const width = view.getUint32(16, false); // big-endian
    const height = view.getUint32(20, false); // big-endian
    
    return { width, height };
}

// Initialize WASM in worker
async function initWasm() {
    try {
        const wasmModule = await init();
        wasmMemoryBuffer = wasmModule.memory;
        if (!wasmMemoryBuffer) {
            throw new Error('WASM memory not available after initialization');
        }
        wasmReady = true;
        self.postMessage({ type: 'wasmReady' });
    } catch (error) {
        console.error('Failed to initialize WASM in worker:', error);
        self.postMessage({ type: 'wasmError', error: error.message });
    }
}

// Handle conversion requests
self.onmessage = async (event) => {
    const { id, fileData, fileType, targetWidth, targetHeight } = event.data;

    if (!wasmReady) {
        self.postMessage({ id, type: 'error', error: 'WASM not ready' });
        return;
    }

    try {
        let uint8Array = new Uint8Array(fileData);
        
        // Resize if needed
        if (targetWidth && targetHeight && fileType === 'image') {
            uint8Array = await resizeImage(uint8Array, targetWidth, targetHeight);
        }
        
        let outputData;
        let outputExtension;
        let conversionFormat = null;
        let outputDimensions = null;

        if (fileType === 'paa') {
            // Convert PAA to image
            const result = new FromPaaResult(uint8Array);
            const len = result.data_len();
            const ptr = result.data_ptr();
            const wasmBuffer = wasmMemoryBuffer.buffer;
            outputData = new Uint8Array(wasmBuffer, ptr, len).slice();
            result.free?.();
            outputExtension = 'png';
            
            // Extract dimensions from PNG
            outputDimensions = extractPngDimensions(outputData);
        } else {
            // Convert image to PAA
            const result = new ToPaaResult(uint8Array);
            const len = result.data_len();
            const ptr = result.data_ptr();
            conversionFormat = result.format();
            const wasmBuffer = wasmMemoryBuffer.buffer;
            outputData = new Uint8Array(wasmBuffer, ptr, len).slice();
            result.free?.();
            outputExtension = 'paa';
        }

        self.postMessage({
            id,
            type: 'complete',
            outputData: outputData.buffer,
            outputExtension,
            conversionFormat,
            outputDimensions
        }, [outputData.buffer]);
    } catch (error) {
        self.postMessage({
            id,
            type: 'error',
            error: error.message || 'Unknown error'
        });
    }
};

// Initialize WASM when worker loads
initWasm();
