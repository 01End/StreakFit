/* StreakFit — Service Worker
 * Handles two notification paths:
 *   1. "message" NOTIFY  — in-app / backgrounded (Android + iOS PWA)
 *   2. "push" event      — real server push from Cloudflare Worker (app fully closed)
 */
const ICON  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%230f1115'/%3E%3Ctext x='96' y='130' font-size='110' text-anchor='middle' fill='%235b8cff'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E";
const BADGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='20' fill='%230f1115'/%3E%3Ctext x='48' y='66' font-size='60' text-anchor='middle' fill='%235b8cff'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function showNote(title, body, tag) {
  return self.registration.showNotification(title || "StreakFit", {
    body: body || "Time to check in!",
    icon: ICON,
    badge: BADGE,
    vibrate: [200, 100, 200],
    tag: tag || "streakfit",
    requireInteraction: false,
  });
}

/* Path 1: in-app message (when app is open / backgrounded) */
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "NOTIFY") return;
  e.waitUntil(showNote("StreakFit", e.data.body, e.data.tag));
});

/* Path 2: real server push from Cloudflare Worker (app fully closed) */
self.addEventListener("push", (e) => {
  let data = { title: "StreakFit", body: "Time to check in!" };
  if (e.data) {
    try { data = e.data.json(); } catch { data.body = e.data.text() || data.body; }
  }
  e.waitUntil(showNote(data.title, data.body, data.tag));
});

/* Tap notification → open / focus the app */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.registration.scope) || w.url.includes("localhost") || w.url.includes("127.0.0.1"))
          return w.focus();
      }
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
