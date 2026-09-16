// Service Worker для PWA MathTest
const CACHE_NAME = 'mathtest-v1';
const STATIC_ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/icon.svg',
  '/manifest.json'
];

// Установка — кешируем статику
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // если что-то не закешировалось — не падаем
      });
    }).then(() => self.skipWaiting())
  );
});

// Активация — удаляем старые кеши
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — не кешируем API, остальное отдаём из кеша с фолбэком в сеть
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API и загрузки — всегда через сеть
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/icon') ||
      event.request.method !== 'GET') {
    return;
  }

  // Для статики: сначала кеш, потом сеть
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        // Обновляем кеш свежей версией
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

// Обработка клика по push (на будущее)
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'MathTest', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg'
    })
  );
});