const APP_VERSION = "1.0.7";
const CACHE = `smart-care-v${APP_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  `./styles.css?v=${APP_VERSION}`,
  `./config.js?v=${APP_VERSION}`,
  `./app.js?v=${APP_VERSION}`,
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const request = event.request.mode === "navigate"
        ? new Request(event.request, { cache: "reload" })
        : event.request;
      const response = await fetch(request);
      if (response && response.ok) cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await cache.match(event.request)) || (await caches.match(event.request));
    }
  })());
});
