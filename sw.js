// NFSU2 Save Editor — service worker
// ASSET_VERSION must match the ?v= on index.html's scripts and stylesheets, so a page never runs
// one version's scripts with another's: the editor's modules depend on each other.
const ASSET_VERSION = '12';
const CACHE_NAME = 'nfsu2-save-editor-v' + ASSET_VERSION;

const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css?v=' + ASSET_VERSION,
  '/css/landing.css',
  '/css/visual-editor.css?v=' + ASSET_VERSION,
  '/js/app.bundle.min.js?v=' + ASSET_VERSION,
  '/js/rim-data.js?v=' + ASSET_VERSION,
  '/js/visual-editor.js?v=' + ASSET_VERSION,
  '/js/career-data.js?v=' + ASSET_VERSION,
  '/js/career.js?v=' + ASSET_VERSION,
  '/js/custom-cars.js?v=' + ASSET_VERSION,
  '/js/parts-data.js?v=' + ASSET_VERSION,
  '/assets/DEMO',
  '/assets/JANE',
  '/assets/favicon.svg',
  '/assets/favicon-48.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  // allSettled: one missing file must not make the whole install fail
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function putInCache(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Network first for everything, so an update is never mixed with cached files; the cache is the
  // offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => putInCache(req, res))
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
