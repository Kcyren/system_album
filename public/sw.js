// Surgthflur - Music service worker: makes the site installable and keeps the
// app shell available offline. Music/video and API data always come from
// the network so visitors never see stale tracks or fake numbers.
const VERSION = 'sa-v7';
const SHELL = [
  '/',
  '/css/site.css',
  '/js/app.js',
  '/js/ui.js',
  '/js/fx.js',
  '/js/story.js',
  '/js/edits.js',
  '/brand/logo-mark.svg',
  '/brand/logo-animated.svg',
  '/brand/wordmark-animated.svg',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/studio') || url.pathname === '/unsubscribe') return;

  // Pages: try the network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  // Static files: always try the network first so updates show immediately,
  // and fall back to the saved copy when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
