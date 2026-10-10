const CACHE_NAME = "nudge-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const request = new URL(event.request.url);
  if (request.origin !== self.location.origin) return;
  const offlineFallback = new Request(new URL(request.pathname, self.location.origin));
  event.respondWith(
    caches.match(event.request)
      .then((cached) => cached || caches.match(offlineFallback))
      .then((cached) => cached || fetch(event.request)),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "./", self.registration.scope);
  const reminderId = event.notification.data?.reminderId;
  if (reminderId) destination.searchParams.set("reminder", reminderId);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const appWindow = windows.find((client) => new URL(client.url).origin === destination.origin);
        if (appWindow) {
          return appWindow.navigate(destination.href).then((client) => client.focus());
        }
        return self.clients.openWindow(destination.href);
      }),
  );
});
