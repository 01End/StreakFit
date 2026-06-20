/* StreakFit — Service Worker
 * Enables proper OS-level notifications on Android/iOS PWA even when the app is backgrounded.
 * Also satisfies the PWA "installable" criteria so "Add to home screen" works with full icon.
 */
const CACHE = "streakfit-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/* Receive a NOTIFY message from the page → show a real OS notification. */
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "NOTIFY") return;
  e.waitUntil(
    self.registration.showNotification("StreakFit", {
      body: e.data.body || "Time to check in!",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%230f1115'/%3E%3Ctext x='96' y='130' font-size='110' text-anchor='middle' fill='%235b8cff'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E",
      badge: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='20' fill='%230f1115'/%3E%3Ctext x='48' y='66' font-size='60' text-anchor='middle' fill='%235b8cff'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E",
      vibrate: [200, 100, 200],
      tag: e.data.tag || "streakfit-reminder",
      requireInteraction: false,
      silent: false,
    })
  );
});

/* Clicking the notification opens/focuses the app. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes("streakfit") || w.url.includes("localhost") || w.url.includes("127.0.0.1")) {
          return w.focus();
        }
      }
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
