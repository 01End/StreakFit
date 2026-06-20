/* StreakFit — reminders & nudges.
 * Uses a service worker (sw.js) for proper OS notifications on Android + iOS PWA.
 * iOS requires the app to be added to the Home Screen (Safari → Share → Add to Home Screen).
 * iOS 16.4+ supports Web Push from PWA home-screen installs; older iOS gets in-app toasts only.
 * Falls back to plain Notification API (foreground tab), then in-app toast.
 */
const Reminders = {
  DEFAULTS: [
    { id: "breakfast", label: "Log breakfast 🍳", time: "08:00", enabled: false },
    { id: "lunch",    label: "Log lunch 🥗",     time: "13:00", enabled: false },
    { id: "dinner",   label: "Log dinner 🍽️",   time: "19:00", enabled: false },
    { id: "water",    label: "Drink water 💧",   time: "15:00", enabled: false },
    { id: "workout",  label: "Workout time 💪",  time: "18:00", enabled: false },
  ],
  _fired: {},

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

  /* Detect platform context. */
  isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
           (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },
  isPWA() {
    // true when launched from iOS/Android home screen or Android TWA
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.navigator.standalone === true;
  },

  fire(r) {
    const granted = typeof Notification !== "undefined" && Notification.permission === "granted";
    if (granted) {
      // Service worker showNotification — works on Android backgrounded + iOS PWA (16.4+).
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
    const perm   = this.permission();
    const ios    = this.isIOS();
    const pwa    = this.isPWA();
    const hasSW  = "serviceWorker" in navigator;

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
      permLine = `<div class="rem-ok">✅ Notifications are on — you'll get phone alerts at the times below.</div>`;

    } else if (ios && !pwa) {
      // iOS in regular Safari tab — must add to home screen first.
      permLine = `
        <div class="rem-ios-guide">
          <p class="rem-ios-title">📱 Add to Home Screen to enable notifications</p>
          <p class="muted small">iOS only allows notifications from installed apps. Tap <b>Share</b> in Safari then <b>"Add to Home Screen"</b>, open StreakFit from your home screen, then come back here to enable notifications.</p>
          <div class="rem-ios-steps">
            <div class="ios-step"><span class="ios-step-ico">1</span><span>Tap <b>Share</b> (the box ↑ with an arrow) in Safari's toolbar</span></div>
            <div class="ios-step"><span class="ios-step-ico">2</span><span>Scroll down → tap <b>"Add to Home Screen"</b></span></div>
            <div class="ios-step"><span class="ios-step-ico">3</span><span>Open StreakFit from your home screen</span></div>
            <div class="ios-step"><span class="ios-step-ico">4</span><span>Come back here → tap Enable</span></div>
          </div>
        </div>`;

    } else if (perm === "unsupported" || (ios && !hasSW)) {
      permLine = `<p class="muted small">Notifications aren't supported in this browser — you'll still get in-app nudges.</p>`;

    } else {
      // Android, or iOS PWA (16.4+) — show the enable button.
      const iosNote = ios ? `<p class="muted small">Requires iOS 16.4 or newer.</p>` : "";
      permLine = `
        <button id="rem-perm" class="btn-primary" style="margin-bottom:6px">🔔 Enable phone notifications</button>
        ${iosNote}
        <p class="muted small">Tap above — StreakFit will send real phone alerts at the times you set.</p>`;
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
        <p class="muted small">Notifications fire while the app is open or backgrounded. Fully closing the app stops them (that needs a server).</p>
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
