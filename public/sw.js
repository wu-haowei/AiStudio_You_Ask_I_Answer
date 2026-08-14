/*
 * Deliberately cache-free service worker.
 *
 * It exists only so the app qualifies as installable and can be added to a
 * phone's home screen. Every request goes straight to the network, so there is
 * no stale-content class of bug and a new deploy is live on the next load.
 */

self.addEventListener('install', () => {
  // Replace any previous worker immediately rather than waiting for a reload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clear anything an earlier version of this worker may have stored.
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  // Network only. Nothing is read from or written to a cache.
  event.respondWith(fetch(event.request));
});
