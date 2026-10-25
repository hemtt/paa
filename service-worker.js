const CACHE_NAME = 'paa-converter-v4';
const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/pkg/hemtt_paa.js',
    '/pkg/hemtt_paa.d.ts',
    '/pkg/hemtt_paa_bg.wasm',
    '/pkg/hemtt_paa_bg.wasm.d.ts',
    '/pkg/package.json',
];

// Install Service Worker
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Caching app shell');
            return cache.addAll(FILES_TO_CACHE).catch(err => {
                console.log('Some files failed to cache:', err);
                // Continue even if some files fail to cache
            });
        })
    );
    self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event - Network First, then Cache
// Every response gets cross-origin isolation headers so SharedArrayBuffer (needed for threaded wasm) is available on hosts that can't set them, such as GitHub Pages
function withIsolationHeaders(response) {
    if (!response || response.status === 0) {
        return response;
    }
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response && response.status === 200) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return withIsolationHeaders(response);
            })
            .catch(() => {
                // Return cached response on network failure
                return caches.match(event.request).then((response) => {
                    if (response) {
                        return withIsolationHeaders(response);
                    }
                    // Return offline page if needed
                    if (event.request.destination === 'document') {
                        return caches.match('/index.html').then((page) => page && withIsolationHeaders(page));
                    }
                });
            })
    );
});
