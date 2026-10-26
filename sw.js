// Офлайн-режим: сначала спрашиваем сервер (чтобы обновления приходили сами),
// без интернета отдаём сохранённую копию.
const CACHE = 'duyuspik-v1';
const FILES = ['./', 'index.html', 'style.css', 'data.js', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // no-cache: всегда спрашиваем сервер, не изменился ли файл (кэш браузера не подсовывает старьё)
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
