import init, { FromPaaResult, ToPaaResult } from './pkg/hemtt_paa.js';

// State
let wasmReady = false;
let wasmMemoryBuffer = null;
let allFiles = [];
let isProcessing = false;
let worker = null;
let conversionQueue = new Map(); // Track pending conversions

// Initialize Web Worker for WASM
function initWorker() {
    worker = new Worker('./worker.js', { type: 'module' });
    worker.onmessage = (event) => {
        const { id, type, error, outputData, outputExtension, conversionFormat, outputDimensions } = event.data;

        if (type === 'wasmReady') {
            wasmReady = true;
            console.log('Worker WASM ready');
        } else if (type === 'error') {
            const conversion = conversionQueue.get(id);
            if (conversion) {
                conversion.resolve({ error });
                conversionQueue.delete(id);
            }
        } else if (type === 'complete') {
            const conversion = conversionQueue.get(id);
            if (conversion) {
                conversion.resolve({ outputData: new Uint8Array(outputData), outputExtension, conversionFormat, outputDimensions });
                conversionQueue.delete(id);
            }
        }
    };
}

// Initialize WASM (kept for compatibility, but worker will handle it)
async function initWasm() {
    try {
        const wasmModule = await init();
        wasmMemoryBuffer = wasmModule.memory;
        if (!wasmMemoryBuffer) {
            throw new Error('WASM memory not available after initialization');
        }
        wasmReady = true;
        console.log('WASM initialized successfully');
    } catch (error) {
        console.error('Failed to initialize WASM:', error);
        showToast('Failed to initialize converter', 'error');
    }
}

// File size formatting
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Detect file type
function getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'paa') return 'paa';
    if (['png', 'jpg', 'jpeg', 'bmp', 'tga'].includes(ext)) return 'image';
    return 'unknown';
}

// Check if a number is a power of two
function isPowerOfTwo(n) {
    return n > 0 && (n & (n - 1)) === 0;
}

// Find power-of-two resize options that maintain aspect ratio
function findPowerOfTwoResizeOptions(width, height) {
    if (isPowerOfTwo(width) && isPowerOfTwo(height)) {
        return []; // Already power of two
    }

    const aspectRatio = width / height;
    const options = [];
    const currentSize = width * height;

    // Check power-of-two sizes from 256 to 4096
    for (let pow = 8; pow <= 12; pow++) {
        const size = Math.pow(2, pow);
        
        // Try as width
        const heightFromWidth = Math.round(size / aspectRatio);
        if (isPowerOfTwo(heightFromWidth) && heightFromWidth >= 256 && heightFromWidth <= 4096) {
            const newSize = size * heightFromWidth;
            if (newSize < currentSize) { // Only smaller than original
                options.push({ width: size, height: heightFromWidth });
            }
        }
        
        // Try as height
        const widthFromHeight = Math.round(size * aspectRatio);
        if (isPowerOfTwo(widthFromHeight) && widthFromHeight >= 256 && widthFromHeight <= 4096) {
            const newSize = widthFromHeight * size;
            if (newSize < currentSize) { // Only smaller than original
                options.push({ width: widthFromHeight, height: size });
            }
        }
    }

    // Remove duplicates
    const seen = new Set();
    return options.filter(opt => {
        const key = `${opt.width}x${opt.height}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => (a.width * a.height) - (b.width * b.height));
}

// Get image dimensions
async function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
            };
            img.onerror = () => {
                reject(new Error('Could not determine image dimensions'));
            };
            img.src = e.target.result;
        };
        reader.onerror = () => {
            reject(new Error('Could not read file'));
        };
        reader.readAsDataURL(file);
    });
}

// DOM Elements
const uploadBox = document.getElementById('upload-box');
const fileInput = document.getElementById('file-input');
const queueContainer = document.getElementById('queue-container');
const clearBtn = document.getElementById('clear-btn');
const downloadZipBtn = document.getElementById('download-zip-btn');
const errorToast = document.getElementById('error-toast');

// Create modal for dimension confirmation
function createConfirmationModal() {
    let modal = document.getElementById('dimension-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dimension-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content">
                <h3 id="modal-title">Image Dimensions</h3>
                <p id="modal-message"></p>
                <div id="modal-options" class="modal-options"></div>
                <div class="modal-buttons">
                    <button id="modal-cancel" class="btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

// Show dimension confirmation modal
function showDimensionConfirmation(filename, width, height, options) {
    return new Promise((resolve) => {
        const modal = createConfirmationModal();
        const title = document.getElementById('modal-title');
        const message = document.getElementById('modal-message');
        const optionsDiv = document.getElementById('modal-options');
        const cancelBtn = document.getElementById('modal-cancel');

        title.textContent = `Resize ${filename}?`;
        message.innerHTML = `Current dimensions: <strong>${width}×${height}</strong><br>This is not a power of two. This can not be used as a standard texture, and should only be used if you know what you're doing.`;

        optionsDiv.innerHTML = '';

        if (options.length > 0) {
            message.innerHTML += `<br><br>This image can be resized to maintain its aspect ratio:`;
            options.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = 'btn-option';
                btn.textContent = `Resize to ${opt.width}×${opt.height}`;
                btn.onclick = () => {
                    modal.classList.add('hidden');
                    resolve({ resize: true, targetWidth: opt.width, targetHeight: opt.height });
                };
                optionsDiv.appendChild(btn);
            });
            
            // Add "Convert Anyway" as a warning option
            const asIsBtn = document.createElement('button');
            asIsBtn.className = 'btn-option btn-option-danger';
            asIsBtn.textContent = `Convert Anyway (${width}×${height})`;
            asIsBtn.onclick = () => {
                modal.classList.add('hidden');
                resolve({ resize: false });
            };
            optionsDiv.appendChild(asIsBtn);
        } else {
            message.innerHTML += `<br><br><span style="color: var(--warning-color);">⚠ This image cannot be resized to a power-of-two while maintaining its aspect ratio.</span>`;
            
            // Add "Convert Anyway" as a warning option
            const continueBtn = document.createElement('button');
            continueBtn.className = 'btn-option btn-option-danger';
            continueBtn.textContent = `Convert Anyway (${width}×${height})`;
            continueBtn.onclick = () => {
                modal.classList.add('hidden');
                resolve({ resize: false });
            };
            optionsDiv.appendChild(continueBtn);
        }

        cancelBtn.onclick = () => {
            modal.classList.add('hidden');
            resolve({ cancelled: true });
        };

        modal.classList.remove('hidden');
    });
}

// Event Listeners
uploadBox.addEventListener('click', () => fileInput.click());
uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
});
uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
});
uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

clearBtn.addEventListener('click', () => {
    allFiles = [];
    updateQueueUI();
});

downloadZipBtn.addEventListener('click', downloadAllAsZip);

// Handle file selection
async function handleFiles(files) {
    for (const file of files) {
        const fileType = getFileType(file.name);
        if (fileType === 'unknown') {
            showToast(`Skipped: ${file.name} - unsupported format`, 'error');
            continue;
        }

        let dimensionWarning = null;
        let dimensions = null;
        let targetDimensions = null;
        
        // Check dimensions for image files
        if (fileType === 'image') {
            try {
                const dims = await getImageDimensions(file);
                dimensions = dims;
                
                if (!isPowerOfTwo(dims.width) || !isPowerOfTwo(dims.height)) {
                    // Find resize options
                    const options = findPowerOfTwoResizeOptions(dims.width, dims.height);
                    
                    // Show confirmation modal
                    const result = await showDimensionConfirmation(file.name, dims.width, dims.height, options);
                    
                    if (result.cancelled) {
                        continue; // Skip this file
                    }
                    
                    if (result.resize) {
                        targetDimensions = { width: result.targetWidth, height: result.targetHeight };
                        dimensionWarning = `Will resize from ${dims.width}×${dims.height} to ${result.targetWidth}×${result.targetHeight}`;
                    } else {
                        dimensionWarning = `${dims.width}×${dims.height} (not power of 2)`;
                    }
                }
            } catch (error) {
                console.warn('Could not validate image dimensions:', error);
            }
        }

        allFiles.push({
            id: Math.random().toString(36).substr(2, 9),
            file,
            name: file.name,
            size: file.size,
            type: fileType,
            status: 'pending',
            error: null,
            result: null,
            outputData: null,
            dimensions,
            dimensionWarning,
            targetDimensions,
        });
    }

    updateQueueUI();
    // Add small delay to ensure UI updates before processing starts
    setTimeout(() => {
        if (wasmReady) {
            processQueue();
        } else {
            // Wait a bit more for WASM to initialize
            setTimeout(processQueue, 500);
        }
    }, 100);
}

// Update Queue UI
function updateQueueUI() {
    const hasItems = allFiles.length > 0;
    clearBtn.disabled = !hasItems;
    
    // Show download zip button if 2+ files completed
    const completedCount = allFiles.filter(f => f.status === 'completed').length;
    downloadZipBtn.disabled = completedCount < 2;
    downloadZipBtn.style.display = completedCount >= 2 ? 'block' : 'none';

    if (allFiles.length === 0) {
        queueContainer.innerHTML = '<div class="empty-state"><p>No files</p></div>';
        return;
    }

    queueContainer.innerHTML = allFiles.map(item => `
        <div class="queue-item ${item.status === 'processing' ? 'status-processing' : ''} ${item.status === 'completed' ? 'status-completed' : ''}" data-id="${item.id}">
            ${item.outputDimensions || (item.status === 'completed' && item.outputData) ? `<div class="queue-item-preview" id="preview-${item.id}"></div>` : ''}
            <div class="queue-item-info">
                ${item.status === "completed" ? `<div class="queue-item-name">${escapeHtml(item.result)} <span class="queue-item-from">from ${escapeHtml(item.name)}</span></div>` : `<div class="queue-item-name">${escapeHtml(item.name)}</div>`}
                <div class="queue-item-size">${formatFileSize(item.size)}</div>
                ${item.targetDimensions ? `<div class="queue-item-dimensions">${item.targetDimensions.width}×${item.targetDimensions.height} from ${item.dimensions.width}×${item.dimensions.height}</div>` : (item.outputDimensions ? `<div class="queue-item-dimensions">${item.outputDimensions.width}×${item.outputDimensions.height}</div>` : (item.dimensions ? `<div class="queue-item-dimensions ${item.dimensionWarning ? 'warning' : ''}">${item.dimensions.width}×${item.dimensions.height}${item.dimensionWarning ? ' (not power of 2)' : ''}</div>` : ''))}
                ${item.conversionFormat ? `<div class="queue-item-format">Format: ${escapeHtml(item.conversionFormat)}</div>` : ''}
            </div>
            <div class="queue-item-status">
                ${item.status === 'pending' ? '<span>Pending</span>' : ''}
                ${item.status === 'processing' ? '<span class="status-spinner"></span><span>Processing</span>' : ''}
                ${item.status === 'error' ? `<span class="status-error">!</span><span style="color: var(--error-color)">${escapeHtml(item.error)}</span>` : ''}
            </div>
            <div class="queue-item-actions">
                ${item.status === 'completed' ? `<button class="btn-icon" onclick="downloadResult('${item.id}')" title="Download">↓</button>` : ''}
                ${item.status !== 'processing' ? `<button class="btn-icon danger" onclick="removeFromQueue('${item.id}')" title="Remove">×</button>` : ''}
            </div>
        </div>
    `).join('');
    
    // Render previews for completed items
    allFiles.forEach(item => {
        if (item.status === 'completed' && item.outputData) {
            renderPreview(item);
        }
    });
}

// Render image preview
function renderPreview(item) {
    const previewEl = document.getElementById(`preview-${item.id}`);
    if (!previewEl) return;
    
    let url;
    
    if (item.type === 'paa') {
        // PAA→PNG: show the PNG output
        const blob = new Blob([item.outputData]);
        url = URL.createObjectURL(blob);
    } else {
        // Image→PAA: show the original input image
        url = URL.createObjectURL(item.file);
    }
    
    const img = document.createElement('img');
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    img.onerror = () => URL.revokeObjectURL(url);
    previewEl.appendChild(img);
}

// Remove from queue
window.removeFromQueue = (id) => {
    allFiles = allFiles.filter(item => item.id !== id);
    updateQueueUI();
};

// Process queue
function processQueue() {
    if (!wasmReady) {
        showToast('Converter not ready yet', 'error');
        return;
    }

    if (allFiles.length === 0) {
        return;
    }

    if (isProcessing) {
        return; // Already processing
    }

    isProcessing = true;

    const processNext = async () => {
        for (let i = 0; i < allFiles.length; i++) {
            const item = allFiles[i];
            
            if (item.status !== 'pending') {
                continue; // Skip already processed items
            }

            item.status = 'processing';
            updateQueueUI();
            
            // Check if item was removed while processing
            if (!allFiles.includes(item)) {
                continue;
            }

            try {
                const fileData = await item.file.arrayBuffer();
                
                // Send to worker for conversion
                const conversionId = item.id;
                const result = await new Promise(resolve => {
                    conversionQueue.set(conversionId, { resolve });
                    const messageData = {
                        id: conversionId,
                        fileData,
                        fileType: item.type
                    };
                    
                    // Add resize dimensions if available
                    if (item.targetDimensions) {
                        messageData.targetWidth = item.targetDimensions.width;
                        messageData.targetHeight = item.targetDimensions.height;
                    }
                    
                    worker.postMessage(messageData, [fileData]);
                });

                if (result.error) {
                    throw new Error(result.error);
                }

                const baseName = item.name.replace(/\.[^.]+$/, '');
                const outputName = `${baseName}.${result.outputExtension}`;

                item.status = 'completed';
                item.result = outputName;
                item.outputData = result.outputData;
                if (result.conversionFormat) {
                    item.conversionFormat = result.conversionFormat;
                }
                if (result.outputDimensions) {
                    item.outputDimensions = result.outputDimensions;
                }
            } catch (error) {
                console.error('Conversion error:', error);
                item.status = 'error';
                item.error = error.message || 'Unknown error';
                showToast(`Failed to convert ${item.name}: ${item.error}`, 'error');
            }
            updateQueueUI();
        }

        isProcessing = false;
        updateQueueUI();
    };

    processNext();
}

// Download single result
window.downloadResult = (id) => {
    const file = allFiles.find(f => f.id === id);
    if (!file || !file.outputData) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const outputExt = ext === 'paa' ? 'png' : 'paa';
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const outputName = `${baseName}.${outputExt}`;

    const blob = new Blob([file.outputData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// Download all results as zip
async function downloadAllAsZip() {
    const completed = allFiles.filter(f => f.status === 'completed');
    if (completed.length === 0) return;

    try {
        const zip = new JSZip();
        
        completed.forEach(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            const outputExt = ext === 'paa' ? 'png' : 'paa';
            const baseName = file.name.replace(/\.[^.]+$/, '');
            const outputName = `${baseName}.${outputExt}`;
            
            zip.file(outputName, file.outputData);
        });

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'conversions.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Downloaded as ZIP', 'success');
    } catch (error) {
        console.error('Error creating ZIP:', error);
        showToast('Failed to create ZIP file', 'error');
    }
}

// Download all results
function downloadAllResults() {
    const completed = allFiles.filter(f => f.status === 'completed');
    if (completed.length === 0) return;

    if (completed.length === 1) {
        downloadResult(completed[0].id);
        return;
    }

    // For multiple files, download each one
    completed.forEach(file => {
        setTimeout(() => {
            window.downloadResult(file.id);
        }, 100);
    });

    showToast('Downloading files...', 'success');
}

// Show toast notification
function showToast(message, type = 'error') {
    errorToast.textContent = message;
    errorToast.className = `toast active ${type}`;
    setTimeout(() => {
        errorToast.classList.remove('active');
    }, 3000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle online/offline
window.addEventListener('online', () => {
    console.log('Connection restored');
});
window.addEventListener('offline', () => {
    console.log('Connection lost');
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
        console.log('Service Worker registration failed:', err);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initWorker();
    initWasm();
});
