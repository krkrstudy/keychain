const CACHE = 'keychain-shell-20261010-1';
const FILES = ['index.html', 'style.css', 'app.js', 'crypto.js', 'offline.js', 'pwa.js', 'manifest.webmanifest', 'icons/key.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const urls = FILES.map(file => new URL(file, self.registration.scope).href);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
  } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('keychain-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
  if (event.data?.type === 'CHECK_SHELL') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ complete });
  })());
});
self.addEventListener('fetch', event => {
  // Never intercept backend requests, credentials, or ciphertext vault records.
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const root = new URL(self.registration.scope);
  let match = request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html')
    ? new URL('index.html', root).href : urls.find(item => item === url.href);
  if (!match) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(match)) || fetch(request))());
});
