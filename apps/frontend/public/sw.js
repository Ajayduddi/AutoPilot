// AutoPilot Service Worker
const CACHE_NAME = 'autopilot-v2';
const MUTE_DB = 'autopilot-push';
const MUTE_STORE = 'muted-tags';

// App shell to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
];

// On install - precache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// On activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy: Network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API calls, SSE streams, webhooks: always network-first, no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'You appear to be offline.' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503,
        })
      )
    );
    return;
  }

  // Static assets: cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PUSH_UNMUTE_ALL') {
    event.waitUntil(clearMutedTags());
  }
});

function openMuteDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MUTE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MUTE_STORE)) {
        db.createObjectStore(MUTE_STORE, { keyPath: 'tag' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function muteTag(tag) {
  if (!tag) return;
  const db = await openMuteDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MUTE_STORE, 'readwrite');
    tx.objectStore(MUTE_STORE).put({ tag, mutedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function isTagMuted(tag) {
  if (!tag) return false;
  const db = await openMuteDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(MUTE_STORE, 'readonly');
    const req = tx.objectStore(MUTE_STORE).get(tag);
    req.onsuccess = () => resolve(Boolean(req.result));
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function clearMutedTags() {
  const db = await openMuteDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MUTE_STORE, 'readwrite');
    tx.objectStore(MUTE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    const payload = event.data.json();
    const tag = payload.tag || 'autopilot-notification';
    if (await isTagMuted(tag)) return;

    const appLine = 'AutoPilot';
    const titleLine = (payload.title || 'Notification').replace(/\s+/g, ' ').trim();
    const summaryLine = (payload.body || 'New update available.').replace(/\s+/g, ' ').trim();
    const structuredBody = `${appLine}\n${summaryLine}`;

    const options = {
      body: structuredBody,
      icon: '/icons/icon-512.svg',
      badge: '/icons/badge-monochrome.svg',
      tag,
      renotify: true,
      actions: Array.isArray(payload.actions) ? payload.actions : [],
      data: {
        ...(payload.data || {}),
        url: payload.url || '/notifications',
        tag,
      },
    };
    await self.registration.showNotification(titleLine, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action || 'open';
  const data = event.notification.data || {};

  if (action === 'mute_topic') {
    event.waitUntil(muteTag(data.muteTag || data.tag));
    return;
  }

  const targetUrl = action === 'ask_followup'
    ? (data.followUpUrl || '/notifications')
    : (data.url || '/notifications');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
