/* Zanobia Sewing — offline shell + safe deploys.
   Network-first for HTML/JS/CSS/API so new deploys show up immediately;
   cache-first for heavy static assets (images/icons) for speed.

   IMPORTANT: bump the CACHE string below on every deploy (v2 -> v3 -> ...).
   Changing the name makes activate() delete the old cache, guaranteeing
   every visitor gets fresh code instead of a stale cached bundle. */
const CACHE = 'zanobia-v3';
const SHELL = ['/', '/css/styles.css', '/js/store.js', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // API + admin: always live, never cached.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/admin')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // App shell (page navigations + JS + CSS + manifest): network-first so a new
  // deploy is seen right away; fall back to cache only when offline.
  const isShell =
    e.request.mode === 'navigate' ||
    /\.(?:js|css|webmanifest)$/.test(url.pathname);

  if (isShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('/')))
    );
    return;
  }

  // Everything else (images, icons, fonts): cache-first for speed.
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('/'))
    )
  );
});
