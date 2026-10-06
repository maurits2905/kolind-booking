// Service worker: makes the app installable and lets it open without network.
// Network first, so a new version on GitHub Pages is always picked up; the
// cache is only a fallback. Supabase and weather requests are never cached.

const CACHE = 'kolind-booking-v3';
const SHELL = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'vendor/supabase.js',
  'css/base.css',
  'css/components.css',
  'css/calendar.css',
  'css/pages.css',
  'assets/fonts/newsreader.woff2',
  'assets/fonts/newsreader-italic.woff2',
  'assets/fonts/hanken-grotesk.woff2',
  'assets/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // no-cache: always ask GitHub Pages whether the file changed (a cheap 304 when
  // not), so an update never mixes a new index.html with old CSS or JS from the
  // browser's 10-minute HTTP cache.
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  event.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
