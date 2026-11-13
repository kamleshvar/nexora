/* Nexora AI service worker — small, offline-friendly, low-bandwidth. */
const CACHE_NAME = "nexora-shell-v33";
const SHELL = [
  "/login",
  "/register",
  "/offline",
  "/static/css/style.css",
  "/static/js/common.js",
  "/static/js/auth.js",
  "/static/js/app.js",
  "/static/js/admin.js",
  "/static/img/logo-mark.png",
  "/static/img/logo-full.png",
  "/static/img/icon-192.png",
  "/static/img/icon-512.png",
  "/static/img/icon-maskable-512.png",
  "/static/img/apple-touch-icon.png",
  "/static/img/favicon.ico",
  "/static/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/offline")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match("/offline"));
    })
  );
});
