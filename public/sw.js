// Service Worker для PWA MathTest
const CACHE_NAME = 'mathtest-v3';
const STATIC_ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API, иконки, файлы и всё не-GET — всегда через сеть
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/favicon') ||
      url.pathname.startsWith('/apple-touch') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'MathTest', {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg'
    })
  );
});
