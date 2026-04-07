const CACHE_NAME = "grocery-v2";

self.addEventListener("install", (event) => {
self.skipWaiting();
});

self.addEventListener("activate", (event) => {
event.waitUntil(
caches.keys().then((keys) =>
Promise.all(
keys
.filter((key) => key !== CACHE_NAME)
.map((key) => caches.delete(key))
)
)
);
self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle same-origin requests to avoid dev server issues
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request).catch(() => new Response("", { status: 503, statusText: "Service Unavailable" }))
  );
});
