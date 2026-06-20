/* StreakFit — reminders & nudges.
 * Uses a service worker (sw.js) for proper OS notifications on Android PWA.
 * Falls back to Notification API (foreground tab only), then in-app toast.
 * True background push when the app is CLOSED needs a server — these are best-effort.
 */
const Reminders = {
  DEFAULTS: [
    { id: "breakfast", label: "Log breakfast 🍳", time: "08:00", enabled: false },
    { id: "lunch", label: "Log lunch 🥗", time: "13:00", enabled: false },
    { id: "dinner", label: "Log dinner 🍽️", time: "19:00", enabled: false },
    { id: "water", label: "Drink water 💧", time: "15:00", enabled: false },
    { id: "workout", label: "Workout time 💪", time: "18:00", enabled: false },
  ],
  _fired: {}, // in-memory, per session (key: date|id|time)

  list() {
    const s = App.state;
    if (!s.reminders) s.reminders = this.DEFAULTS.map((r) => ({ ...r }));
    return s.reminders;
  },
  permission() {
    return typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  },
  async requestPermission() {
    if (typeof Notification === "undefined") return "unsupported";
    try { return await Notification.requestPermission(); } catch (e) { return "denied"; }
  },

  fire(r) {
    const granted = typeof Notification !== "undefined" && Notification.permission === "granted";
    if (granted) {
      // Service worker showNotification works on Android even when app is backgrounded.
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "NOTIFY", body: r.label, tag: r.id });
        return;
      }
      // Fallback: plain Notification API (requires foreground tab).
      try { new Notification("StreakFit", { body: r.label }); return; } catch (e) {}
    }
    if (App.celebrateMini) App.celebrateMini("🔔 " + r.label);
  },

  tick() {
    const now = new Date();
    const cur = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    this.list().forEach((r) => {
      if (!r.enabled || r.time !== cur) return;
      const k = App.todayStr() + "|" + r.id + "|" + r.time;
      if (!this._fired[k]) { this._fired[k] = 1; this.fire(r); }
    });
  },
  start() {
    if (this._timer) return;
    this.tick();
    this._timer = setInterval(() => this.tick(), 30000);
  },

  /* ---------- modal UI ---------- */
  open() {
    const perm = this.permission();
    const hasSW = "serviceWorker" in navigator;
    const rows = this.list()
      .map((r, i) => `
        <div class="rem-row">
          <label class="rem-toggle"><input type="checkbox" data-i="${i}" ${r.enabled ? "checked" : ""}></label>
          <input class="rem-label" data-i="${i}" value="${r.label.replace(/"/g, "&quot;")}">
          <input class="rem-time" type="time" data-i="${i}" value="${r.time}">
          <button class="del rem-del" data-i="${i}">✕</button>
        </div>`)
      .join("");

    let permLine;
    if (perm === "granted") {
      permLine = `<p class="muted small">✅ Notifications on.${hasSW ? " Works even when the app is in background on Android." : ""}</p>`;
    } else if (perm === "unsupported") {
      permLine = `<p class="muted small">Your browser doesn't support notifications — you'll get in-app nudges instead.</p>`;
    } else {
      permLine = `
        <button id="rem-perm" class="btn-primary" style="margin-bottom:8px">🔔 Enable phone notifications</button>
        <p class="muted small">Tap above to allow — StreakFit will send real phone alerts at the times you set.</p>`;
    }

    const modal = document.createElement("div");
    modal.id = "rem-modal";
    modal.innerHTML = `
      <div class="ex-modal-card">
        <button class="ex-close" aria-label="close">✕</button>
        <h3 class="ex-title">🔔 Reminders</h3>
        ${permLine}
        <div class="rem-list">${rows}</div>
        <button id="rem-add" class="btn-ghost">+ Add reminder</button>
        <p class="muted small">📱 Add StreakFit to your home screen for the best experience. Notifications fire while the app is open or backgrounded — not after it's fully closed (that needs a server).</p>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".ex-close")) modal.remove(); });

    const permBtn = modal.querySelector("#rem-perm");
    if (permBtn) permBtn.addEventListener("click", async () => {
      const result = await this.requestPermission();
      if (result === "granted") App.celebrateMini("🔔 Notifications enabled!");
      modal.remove();
      this.open();
    });

    modal.querySelector(".rem-list").addEventListener("input", (e) => {
      const el = e.target, i = +el.dataset.i, r = this.list()[i];
      if (el.type === "checkbox") r.enabled = el.checked;
      else if (el.type === "time") r.time = el.value;
      else r.label = el.value;
      App.save();
    });
    modal.querySelector(".rem-list").addEventListener("click", (e) => {
      const del = e.target.closest(".rem-del");
      if (del) { this.list().splice(+del.dataset.i, 1); App.save(); modal.remove(); this.open(); }
    });
    modal.querySelector("#rem-add").addEventListener("click", () => {
      this.list().push({ id: "r" + Date.now(), label: "New reminder", time: "12:00", enabled: true });
      App.save(); modal.remove(); this.open();
    });
  },
};
window.Reminders = Reminders;
