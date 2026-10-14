/* Service worker : fonctionnement hors ligne.
   Incrémenter CACHE_VERSION à chaque modification des fichiers pour forcer la mise à jour. */
const CACHE_VERSION = 'v12';
const CACHE = 'electroformules-' + CACHE_VERSION;
const FILES = [
  "./",
  "assets/app.js",
  "assets/fonts.css",
  "assets/fonts/KaTeX_AMS-Regular.woff2",
  "assets/fonts/KaTeX_Caligraphic-Bold.woff2",
  "assets/fonts/KaTeX_Caligraphic-Regular.woff2",
  "assets/fonts/KaTeX_Fraktur-Bold.woff2",
  "assets/fonts/KaTeX_Fraktur-Regular.woff2",
  "assets/fonts/KaTeX_Main-Bold.woff2",
  "assets/fonts/KaTeX_Main-BoldItalic.woff2",
  "assets/fonts/KaTeX_Main-Italic.woff2",
  "assets/fonts/KaTeX_Main-Regular.woff2",
  "assets/fonts/KaTeX_Math-BoldItalic.woff2",
  "assets/fonts/KaTeX_Math-Italic.woff2",
  "assets/fonts/KaTeX_SansSerif-Bold.woff2",
  "assets/fonts/KaTeX_SansSerif-Italic.woff2",
  "assets/fonts/KaTeX_SansSerif-Regular.woff2",
  "assets/fonts/KaTeX_Script-Regular.woff2",
  "assets/fonts/KaTeX_Size1-Regular.woff2",
  "assets/fonts/KaTeX_Size2-Regular.woff2",
  "assets/fonts/KaTeX_Size3-Regular.woff2",
  "assets/fonts/KaTeX_Size4-Regular.woff2",
  "assets/fonts/KaTeX_Typewriter-Regular.woff2",
  "assets/fonts/jetbrains-mono-latin-ext.woff2",
  "assets/fonts/jetbrains-mono-latin.woff2",
  "assets/katex.min.css",
  "assets/katex.min.js",
  "assets/schemas-symbols.js",
  "assets/schemas-materials.js",
  "assets/schemas.js",
  "assets/styles.css",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "index.html",
  "manifest.webmanifest"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('electroformules-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
