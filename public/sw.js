// Service Worker for DonateUZ PWA
const CACHE_NAME = 'donateuz-v3';
const OFFLINE_URL = '/offline.html';

// Files to cache on install
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js',
  '/styles.css',
  '/script.js',
  '/favicon.ico',
  // Static assets
  'https://cdn.jsdelivr.net/npm/lucide@0.577.0/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&family=Figtree:wght@400;500;600;700;800&display=swap'
];

// Install event - cache static assets. Each file is added independently so a
// single unreachable CDN doesn't fail the whole install.
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        Promise.all(
          FILES_TO_CACHE.map(url =>
            cache.add(url).catch(err => console.warn('[ServiceWorker] Could not cache', url, err.message))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(
    caches.keys().then(keyList =>
      Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            console.log(`[ServiceWorker] Removing old cache: ${key}`);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip cross-origin requests (like to APIs, Stripe, etc.)
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            // Return cached response
            return response;
          }
          // Otherwise fetch from network
          return fetch(event.request)
            .then(networkResponse => {
              // Cache successful requests for HTML/CSS/JS
              if (networkResponse.status === 200 &&
                  (event.request.destination === 'document' ||
                   event.request.destination === 'style' ||
                   event.request.destination === 'script' ||
                   event.request.url.endsWith('.png') ||
                   event.request.url.endsWith('.jpg') ||
                   event.request.url.endsWith('.jpeg') ||
                   event.request.url.endsWith('.gif') ||
                   event.request.url.endsWith('.svg') ||
                   event.request.url.endsWith('.ico') ||
                   event.request.url.endsWith('.webp'))) {
                return caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, networkResponse.clone());
                  return networkResponse;
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // If fetch fails (offline), try to serve offline.html for navigations
              if (event.request.mode === 'navigate') {
                return caches.match(OFFLINE_URL);
              }
            });
        })
    );
  } else {
    // For cross-origin requests (CDNs, Stripe, etc.), go to the network and
    // fall back to any copy cached at install time when offline.
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});

// Listen for messages from the client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
