// Service worker for offline field capture.
// It keeps a copy of the offline capture page and of the app's static files so the page can be
// opened without a connection. Nothing else is cached, and no data is sent from here: queued
// reports live in IndexedDB and are sent by the page itself once the device is online.
const CACHE = "cgs-offline-v1";
const OFFLINE_PAGE = "/dashboard/monitoring/offline";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Build files are content-hashed: serve from cache, fetch once.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // The capture page: fresh copy when online, last saved copy when offline.
  if (url.pathname === OFFLINE_PAGE && request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(OFFLINE_PAGE, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(OFFLINE_PAGE)) ?? Response.error()),
    );
  }
});
