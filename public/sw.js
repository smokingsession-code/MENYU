/*
 * Menyu service worker (scope /r/): keeps menus on the phone so a second
 * scan opens instantly, even on a weak connection.
 *
 *   menu pages      stale-while-revalidate (shown at once, refreshed in the
 *                   background; the page then checks for sold-out changes)
 *   /_next/static   cache-first (file names change with every build)
 *   menu photos     cache-first, at most 150 files
 *
 * Nothing else is cached: no API calls, no signed-in pages.
 */
const VERSION = "v1";
const PAGES = `menyu-pages-${VERSION}`;
const ASSETS = `menyu-assets-${VERSION}`;
const IMAGES = `menyu-images-${VERSION}`;
const MAX_IMAGES = 150;
const MAX_PAGES = 20;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, ASSETS, IMAGES]);
      for (const key of await caches.keys()) {
        if (key.startsWith("menyu-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** One cached copy per menu, whatever table (?t=) the QR code points at. */
function pageKey(url) {
  return new Request(`${url.origin}${url.pathname}`);
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function menuPage(event, url) {
  const cache = await caches.open(PAGES);
  const key = pageKey(url);
  const cached = await cache.match(key);
  const network = fetch(event.request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(key, response.clone());
        await trim(PAGES, MAX_PAGES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return new Response(
    "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;padding:24px'><h1>You're offline</h1><p>Connect to the internet and scan the QR code again.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function cacheFirst(event, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) {
    await cache.put(event.request, response.clone());
    if (max) event.waitUntil(trim(cacheName, max));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === self.location.origin && url.pathname.startsWith("/r/")) {
    event.respondWith(menuPage(event, url));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, ASSETS));
    return;
  }
  if (url.pathname.includes("/storage/v1/object/public/images/")) {
    event.respondWith(cacheFirst(event, IMAGES, MAX_IMAGES));
  }
});
