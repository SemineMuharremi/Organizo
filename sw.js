/**
 * Service worker: makes Organizo installable and usable offline, and shows
 * reminder notifications on browsers that only allow them from a service worker.
 *
 * Caching strategy: network first, cache as fallback.
 * - Online, every file comes from the server, so updates show up on the next
 *   load and the app never mixes old and new modules.
 * - Each successful response refreshes the cache. Offline, or when the network
 *   takes longer than NETWORK_TIMEOUT, the cached copy is used instead.
 * - The app shell is precached at install, so the app works offline after the
 *   first visit even for files that page never requested.
 *
 * Keep PRECACHE in sync with the app's files; tests/unit.test.mjs checks it.
 */
const CACHE = "organizo-v1";
const NETWORK_TIMEOUT = 4000;

const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/fonts.css",
  "css/tokens.css",
  "css/base.css",
  "css/layout.css",
  "css/components.css",
  "css/views.css",
  "js/main.js",
  "js/pwa.js",
  "js/reminders.js",
  "js/router.js",
  "js/storage.js",
  "js/store.js",
  "js/core/dates.js",
  "js/core/migrations.js",
  "js/core/model.js",
  "js/core/recurrence.js",
  "js/core/selectors.js",
  "js/ui/actions.js",
  "js/ui/dialog.js",
  "js/ui/dragSort.js",
  "js/ui/html.js",
  "js/ui/notificationCenter.js",
  "js/ui/projectCommands.js",
  "js/ui/sidebar.js",
  "js/ui/subtasks.js",
  "js/ui/taskCommands.js",
  "js/ui/taskDetail.js",
  "js/ui/taskForm.js",
  "js/ui/taskItem.js",
  "js/ui/toast.js",
  "js/views/calendar.js",
  "js/views/dashboard.js",
  "js/views/list.js",
  "js/views/settings.js",
  "assets/fonts/inter-latin.woff2",
  "assets/fonts/inter-latin-ext.woff2",
  "assets/fonts/material-symbols-rounded.woff2",
  "assets/icons/icon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Bypass the HTTP cache so the precache gets the current files.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("organizo-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  if (request.mode === "navigate") {
    // Any app URL (with ?query or #hash) is the same single page.
    return (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match("index.html")) ?? cache.match("./");
  }
  return cache.match(request, { ignoreSearch: true });
}

async function networkFirst(event) {
  const { request } = event;
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  });
  network.catch(() => {}); // handled below; avoids an unhandled rejection when the timeout wins

  const cached = fromCache(request);
  // Slow network: fall back to the cache after a timeout, if there's a cached copy.
  const timeout = new Promise((resolve) => setTimeout(async () => resolve(await cached), NETWORK_TIMEOUT));

  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
    return await network;
  } catch {
    const fallback = await cached;
    if (fallback) return fallback;
    return new Response("Organizo is offline and this file isn't cached yet.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});

/* ----------------------------- Notifications ----------------------------- */

// Clicking a reminder focuses an open Organizo window (or opens one) and shows the task.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { notificationId = null, taskId = null } = event.notification.data ?? {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      client.postMessage({ type: "notification-click", notificationId, taskId });
      return;
    }
    const params = new URLSearchParams();
    if (notificationId) params.set("notification", notificationId);
    if (taskId) params.set("task", taskId);
    await self.clients.openWindow(`./?${params}#/dashboard`);
  })());
});
