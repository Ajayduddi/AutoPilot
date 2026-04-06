// AutoPilot Service Worker (advanced runtime caching + push handling)
const SW_VERSION = "v3";
const CACHE_PREFIX = "autopilot";
const PRECACHE = `${CACHE_PREFIX}-precache-${SW_VERSION}`;
const NAVIGATION = `${CACHE_PREFIX}-navigation-${SW_VERSION}`;
const STATIC = `${CACHE_PREFIX}-static-${SW_VERSION}`;
const API = `${CACHE_PREFIX}-api-${SW_VERSION}`;
const EXTERNAL = `${CACHE_PREFIX}-external-${SW_VERSION}`;
const SYNC_TAG = "autopilot-sync-mutations";

const MUTE_DB = "autopilot-push";
const MUTE_STORE = "muted-tags";
const MUTE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const QUEUE_DB = "autopilot-sync";
const QUEUE_STORE = "pending-mutations";

const NAVIGATION_TIMEOUT_MS = 4000;
const MAX_STATIC_ENTRIES = 220;
const MAX_EXTERNAL_ENTRIES = 120;
const MAX_API_ENTRIES = 40;

const PRECACHE_ASSETS = [
  "/",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icons/icon-192-maskable.svg",
  "/icons/icon-512-maskable.svg",
  "/icons/badge-monochrome.svg",
];

const TRUSTED_EXTERNAL_HOSTS = new Set([
  "static.cloudflareinsights.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

const API_READ_CACHE_ALLOWLIST = [
  /^\/api\/health$/,
  /^\/api\/health\/ready$/,
  /^\/api\/health\/metrics$/,
];

const MUTATION_QUEUE_ALLOWLIST = [
  /^\/api\/approvals\/[^/]+\/resolve$/,
  /^\/api\/notifications\/[^/]+\/read$/,
  /^\/api\/notifications\/read-all$/,
];

const stats = {
  fetchTotal: 0,
  cacheHits: 0,
  networkSuccess: 0,
  networkFailure: 0,
  queuedMutations: 0,
  replayedMutations: 0,
  replayFailures: 0,
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await cache.addAll(PRECACHE_ASSETS);
      const manifestAssets = await discoverManifestAssets();
      await Promise.all(
        manifestAssets.map(async (assetPath) => {
          try {
            await cache.add(assetPath);
          } catch {
            // Keep install resilient even if an optional asset is missing.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && !isCurrentCache(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (type === "PUSH_UNMUTE_ALL") {
    event.waitUntil(clearMutedTags());
    return;
  }
  if (type === "CLEAR_RUNTIME_CACHES") {
    event.waitUntil(clearRuntimeCaches());
    return;
  }
  if (type === "RETRY_QUEUED_REQUESTS") {
    event.waitUntil(flushQueuedMutations());
    return;
  }
  if (type === "GET_SW_STATS") {
    event.waitUntil(postMessageToClients({ type: "SW_STATS", payload: { ...stats } }));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  stats.fetchTotal += 1;

  if (sameOrigin && url.pathname.startsWith("/api/") && request.method !== "GET") {
    if (shouldQueueMutation(url, request.method)) {
      event.respondWith(handleQueuedMutationRequest(request, url));
    }
    return;
  }

  if (request.method !== "GET") return;

  if (sameOrigin && request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (sameOrigin && url.pathname.startsWith("/api/")) {
    event.respondWith(handleApiRequest(request, url));
    return;
  }

  if (sameOrigin) {
    event.respondWith(handleSameOriginAsset(request));
    return;
  }

  if (isTrustedExternalAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request, EXTERNAL, MAX_EXTERNAL_ENTRIES));
  }
});

async function handleNavigation(request) {
  const network = fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        const cache = await caches.open(NAVIGATION);
        await cache.put(request, response.clone());
      }
      stats.networkSuccess += 1;
      return response;
    })
    .catch(() => {
      stats.networkFailure += 1;
      return null;
    });

  const fresh = await network;
  if (fresh) return fresh;

  const cachedExact = await caches.match(request);
  if (cachedExact) {
    stats.cacheHits += 1;
    return cachedExact;
  }

  const appShell = await caches.match("/");
  if (appShell) {
    stats.cacheHits += 1;
    return appShell;
  }

  return offlineHtml();
}

async function handleApiRequest(request, url) {
  const isCacheableRead = API_READ_CACHE_ALLOWLIST.some((rule) => rule.test(url.pathname));
  if (!isCacheableRead) {
    try {
      return await fetch(request);
    } catch {
      return offlineJson(503, "You appear to be offline.");
    }
  }

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(API);
      await cache.put(request, response.clone());
      await pruneCache(API, MAX_API_ENTRIES);
    }
    stats.networkSuccess += 1;
    return response;
  } catch {
    stats.networkFailure += 1;
    const cached = await caches.match(request);
    if (cached) {
      stats.cacheHits += 1;
      return cached;
    }
    return offlineJson(503, "You appear to be offline.");
  }
}

async function handleSameOriginAsset(request) {
  const url = new URL(request.url);
  const isBuildAsset = url.pathname.startsWith("/assets/");
  const destination = request.destination;
  const shouldUseSWR =
    isBuildAsset ||
    destination === "script" ||
    destination === "style" ||
    destination === "worker" ||
    destination === "font" ||
    destination === "image";

  if (!shouldUseSWR) {
    const cached = await caches.match(request);
    if (cached) {
      stats.cacheHits += 1;
      return cached;
    }
    try {
      const response = await fetch(request);
      if (isCacheableResponse(response)) {
        const cache = await caches.open(STATIC);
        await cache.put(request, response.clone());
      }
      stats.networkSuccess += 1;
      return response;
    } catch {
      stats.networkFailure += 1;
      return offlineHtml();
    }
  }

  return staleWhileRevalidate(request, STATIC, MAX_STATIC_ENTRIES);
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response) || response.type === "opaque") {
        await cache.put(request, response.clone());
        await pruneCache(cacheName, maxEntries);
      }
      stats.networkSuccess += 1;
      return response;
    })
    .catch(() => {
      stats.networkFailure += 1;
      return null;
    });

  if (cached) {
    // Keep cache warm in background while serving instantly.
    networkPromise.catch(() => {});
    stats.cacheHits += 1;
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;
  return offlineHtml();
}

function isTrustedExternalAsset(request, url) {
  if (!TRUSTED_EXTERNAL_HOSTS.has(url.hostname)) return false;
  const destination = request.destination;
  return (
    destination === "script" ||
    destination === "style" ||
    destination === "font" ||
    destination === "image"
  );
}

function isCurrentCache(name) {
  return [PRECACHE, NAVIGATION, STATIC, API, EXTERNAL].includes(name);
}

function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  const cacheControl = response.headers.get("cache-control") || "";
  if (/\bno-store\b/i.test(cacheControl)) return false;
  return true;
}

async function pruneCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const removeCount = keys.length - maxEntries;
  await Promise.all(keys.slice(0, removeCount).map((key) => cache.delete(key)));
}

async function clearRuntimeCaches() {
  await Promise.all([caches.delete(NAVIGATION), caches.delete(STATIC), caches.delete(API), caches.delete(EXTERNAL)]);
}

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function offlineJson(status, message) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

function offlineHtml() {
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AutoPilot Offline</title>
        <style>
          body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0a0a; color:#e5e7eb; font-family: ui-sans-serif, system-ui, sans-serif; }
          .card { max-width:420px; padding:24px; border:1px solid #262626; border-radius:16px; background:#121212; text-align:center; }
          h1 { margin:0 0 8px; font-size:20px; }
          p { margin:0; color:#9ca3af; line-height:1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>You are offline</h1>
          <p>AutoPilot could not reach the network. Reconnect and refresh to continue.</p>
        </div>
      </body>
    </html>
  `.trim();
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function openMuteDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MUTE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MUTE_STORE)) {
        db.createObjectStore(MUTE_STORE, { keyPath: "tag" });
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
    const tx = db.transaction(MUTE_STORE, "readwrite");
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
    const tx = db.transaction(MUTE_STORE, "readonly");
    const req = tx.objectStore(MUTE_STORE).get(tag);
    req.onsuccess = () => {
      const record = req.result;
      if (!record) return resolve(false);
      if (Date.now() - Number(record.mutedAt || 0) > MUTE_TTL_MS) {
        const cleanupTx = db.transaction(MUTE_STORE, "readwrite");
        cleanupTx.objectStore(MUTE_STORE).delete(tag);
        cleanupTx.oncomplete = () => resolve(false);
        cleanupTx.onerror = () => resolve(false);
        return;
      }
      resolve(true);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function clearMutedTags() {
  const db = await openMuteDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MUTE_STORE, "readwrite");
    tx.objectStore(MUTE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        payload = event.data.json() || {};
      } catch {
        payload = { body: event.data.text() };
      }

      const tag = String(payload.tag || "autopilot-notification");
      if (await isTagMuted(tag)) return;

      const titleLine = String(payload.title || "Notification").replace(/\s+/g, " ").trim();
      const summaryLine = String(payload.body || "New update available.").replace(/\s+/g, " ").trim();
      const structuredBody = `AutoPilot\n${summaryLine}`;

      const options = {
        body: structuredBody,
        icon: "/icons/icon-512.svg",
        badge: "/icons/badge-monochrome.svg",
        tag,
        renotify: true,
        actions: Array.isArray(payload.actions) ? payload.actions : [],
        data: {
          ...(payload.data || {}),
          url: payload.url || "/notifications",
          tag,
        },
      };

      await self.registration.showNotification(titleLine, options);
    })(),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueuedMutations());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action || "open";
  const data = event.notification.data || {};

  if (action === "mute_topic") {
    event.waitUntil(muteTag(data.muteTag || data.tag));
    return;
  }

  let target = action === "ask_followup" ? (data.followUpUrl || "/notifications") : (data.url || "/notifications");
  try {
    const parsed = new URL(target, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      target = "/notifications";
    } else {
      target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    target = "/notifications";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

async function discoverManifestAssets() {
  try {
    const response = await fetch("/manifest.json", { cache: "no-store" });
    if (!response.ok) return [];
    const manifest = await response.json();
    const iconPaths = Array.isArray(manifest?.icons)
      ? manifest.icons
          .map((entry) => (entry && typeof entry.src === "string" ? entry.src : null))
          .filter(Boolean)
      : [];
    const shortcutIconPaths = Array.isArray(manifest?.shortcuts)
      ? manifest.shortcuts.flatMap((shortcut) =>
          Array.isArray(shortcut?.icons)
            ? shortcut.icons
                .map((entry) => (entry && typeof entry.src === "string" ? entry.src : null))
                .filter(Boolean)
            : [],
        )
      : [];
    return [...new Set([...iconPaths, ...shortcutIconPaths])];
  } catch {
    return [];
  }
}

function shouldQueueMutation(url, method) {
  const m = String(method || "").toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(m)) return false;
  return MUTATION_QUEUE_ALLOWLIST.some((rule) => rule.test(url.pathname));
}

async function handleQueuedMutationRequest(request, url) {
  try {
    const response = await fetch(request);
    stats.networkSuccess += 1;
    return response;
  } catch {
    stats.networkFailure += 1;
    await enqueueMutationRequest(request, url);
    await registerSync();
    return offlineJson(503, "Request queued and will retry when connection returns.");
  }
}

async function enqueueMutationRequest(request, url) {
  const bodyText = await request.clone().text();
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const record = {
    id: createQueueId(),
    url: url.pathname + url.search,
    method: request.method,
    headers,
    bodyText,
    createdAt: Date.now(),
    attempts: 0,
  };
  const db = await openQueueDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  stats.queuedMutations += 1;
  await postMessageToClients({ type: "SW_QUEUE_EVENT", payload: { kind: "queued", url: record.url } });
}

async function flushQueuedMutations() {
  const db = await openQueueDb();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error);
  });

  for (const record of records) {
    try {
      const response = await fetch(record.url, {
        method: record.method,
        headers: record.headers,
        body: record.bodyText,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await deleteQueuedRecord(db, record.id);
      stats.replayedMutations += 1;
      await postMessageToClients({ type: "SW_QUEUE_EVENT", payload: { kind: "replayed", url: record.url } });
    } catch {
      await bumpQueuedRecordAttempts(db, record.id, Number(record.attempts || 0) + 1);
      stats.replayFailures += 1;
    }
  }
  db.close();
  await postMessageToClients({ type: "SW_STATS", payload: { ...stats } });
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteQueuedRecord(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bumpQueuedRecordAttempts(db, id, attempts) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const current = req.result;
      if (!current) return resolve();
      store.put({ ...current, attempts });
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function createQueueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function registerSync() {
  if (!self.registration || !("sync" in self.registration)) {
    return;
  }
  try {
    await self.registration.sync.register(SYNC_TAG);
  } catch {
    // Ignore unsupported or quota-limited sync registration.
  }
}

async function postMessageToClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}
