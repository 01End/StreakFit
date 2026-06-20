/* StreakFit — reminders & nudges.
 *
 * Two notification modes:
 *  A. In-app / backgrounded  — service worker showNotification (no server needed).
 *     Works on Android + iOS 16.4+ PWA while the app is open or in recent apps.
 *  B. Fully-closed push      — Cloudflare Worker sends a real Web Push.
 *     Works even when the app is completely closed. Requires the push-worker to be deployed.
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
  isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
           (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },
  isPWA() {
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.navigator.standalone === true;
  },

  /* ── Mode A: fire while app is open / backgrounded ─────────────────────── */
  fire(r) {
    const granted = typeof Notification !== "undefined" && Notification.permission === "granted";
    if (granted && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "NOTIFY", body: r.label, tag: r.id });
      return;
    }
    if (granted) {
      try { new Notification("StreakFit", { body: r.label }); return; } catch (e) {}
    }
    if (App.celebrateMini) App.celebrateMini("🔔 " + r.label);
  },
  tick() {
    const now = new Date();
    const cur = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    this.list().forEach((r) => {
      if (!r.enabled || r.time !== cur) return;
      const k = `${App.todayStr()}|${r.id}|${r.time}`;
      if (!this._fired[k]) { this._fired[k] = 1; this.fire(r); }
    });
  },
  start() {
    if (this._timer) return;
    this.tick();
    this._timer = setInterval(() => this.tick(), 30000);
  },

  /* ── Mode B: server push helpers ────────────────────────────────────────── */
  workerUrl() {
    return (App.state.settings && App.state.settings.pushWorkerUrl) || "";
  },
  deviceId() {
    const s = App.state.settings;
    if (!s.pushDeviceId) {
      s.pushDeviceId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      App.save();
    }
    return s.pushDeviceId;
  },

  async getPushSubscription(workerUrl) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) return sub;

    // Fetch VAPID public key from the worker
    const vapidPublic = await fetch(`${workerUrl}/vapid-public`).then((r) => {
      if (!r.ok) throw new Error(`Worker returned ${r.status}`);
      return r.text();
    });

    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidPublic,
    });
    return sub;
  },

  async syncToWorker(workerUrl) {
    if (!workerUrl) return;
    const sub = await this.getPushSubscription(workerUrl);
    const tzOffset = -new Date().getTimezoneOffset(); // minutes east of UTC
    const res = await fetch(`${workerUrl}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: this.deviceId(),
        subscription: sub.toJSON(),
        reminders: this.list(),
        tzOffset,
      }),
    });
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  },

  async sendTestPush(workerUrl) {
    const res = await fetch(`${workerUrl}/test-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId() }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return text;
  },

  /* ── Modal UI ───────────────────────────────────────────────────────────── */
  open() {
    const perm    = this.permission();
    const ios     = this.isIOS();
    const pwa     = this.isPWA();
    const hasSW   = "serviceWorker" in navigator;
    const wUrl    = this.workerUrl();

    const rows = this.list()
      .map((r, i) => `
        <div class="rem-row">
          <label class="rem-toggle"><input type="checkbox" data-i="${i}" ${r.enabled ? "checked" : ""}></label>
          <input class="rem-label" data-i="${i}" value="${r.label.replace(/"/g, "&quot;")}">
          <input class="rem-time" type="time" data-i="${i}" value="${r.time}">
          <button class="del rem-del" data-i="${i}">✕</button>
        </div>`)
      .join("");

    // ── Permission / iOS guidance block ──
    let permLine;
    if (perm === "granted") {
      permLine = `<div class="rem-ok">✅ Notifications are on.</div>`;
    } else if (ios && !pwa) {
      permLine = `
        <div class="rem-ios-guide">
          <p class="rem-ios-title">📱 Add to Home Screen first</p>
          <p class="muted small">iOS only allows notifications from installed apps.</p>
          <div class="rem-ios-steps">
            <div class="ios-step"><span class="ios-step-ico">1</span><span>Tap <b>Share ↑</b> in Safari</span></div>
            <div class="ios-step"><span class="ios-step-ico">2</span><span>Tap <b>"Add to Home Screen"</b></span></div>
            <div class="ios-step"><span class="ios-step-ico">3</span><span>Open StreakFit from your home screen</span></div>
            <div class="ios-step"><span class="ios-step-ico">4</span><span>Come back here → tap Enable</span></div>
          </div>
        </div>`;
    } else if (perm === "unsupported" || (!hasSW)) {
      permLine = `<p class="muted small">Notifications aren't supported in this browser.</p>`;
    } else {
      const iosNote = ios ? `<p class="muted small">Requires iOS 16.4 or newer.</p>` : "";
      permLine = `
        <button id="rem-perm" class="btn-primary" style="margin-bottom:6px">🔔 Enable phone notifications</button>
        ${iosNote}`;
    }

    // ── Server push block (Mode B) ──
    const serverSection = hasSW ? `
      <details class="advanced" ${wUrl ? "open" : ""} style="margin-top:14px">
        <summary style="cursor:pointer;font-size:0.85rem;color:var(--muted)">🌐 Background push (works when app is closed)</summary>
        <p class="muted small" style="margin-top:8px">Paste your Cloudflare Worker URL to get notifications even when StreakFit is fully closed.</p>
        <div class="search-row" style="gap:8px;margin-top:8px">
          <input id="push-url-input" class="search" placeholder="https://streakfit-push.yourname.workers.dev" value="${wUrl}" style="font-size:0.8rem">
        </div>
        <div class="btn-row" style="margin-top:8px;gap:8px">
          <button id="push-connect" class="btn-primary" style="flex:1">Connect &amp; sync</button>
          <button id="push-test" class="btn-ghost" style="flex:1" ${wUrl ? "" : "disabled"}>Send test</button>
        </div>
        <p id="push-status" class="muted small" style="margin-top:6px"></p>
      </details>` : "";

    const modal = document.createElement("div");
    modal.id = "rem-modal";
    modal.innerHTML = `
      <div class="ex-modal-card">
        <button class="ex-close" aria-label="close">✕</button>
        <h3 class="ex-title">🔔 Reminders</h3>
        ${permLine}
        <div class="rem-list" style="margin-top:12px">${rows}</div>
        <button id="rem-add" class="btn-ghost">+ Add reminder</button>
        ${serverSection}
        <p class="muted small" style="margin-top:10px">While the app is open or backgrounded, notifications fire without a server.</p>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".ex-close")) modal.remove(); });

    // Enable notifications button
    const permBtn = modal.querySelector("#rem-perm");
    if (permBtn) permBtn.addEventListener("click", async () => {
      const result = await this.requestPermission();
      if (result === "granted") App.celebrateMini("🔔 Notifications enabled!");
      modal.remove(); this.open();
    });

    // Reminder list changes → save + sync
    const syncIfConnected = () => {
      const url = this.workerUrl();
      if (url && this.permission() === "granted") this.syncToWorker(url).catch(() => {});
    };

    modal.querySelector(".rem-list").addEventListener("input", (e) => {
      const el = e.target, i = +el.dataset.i, r = this.list()[i];
      if (el.type === "checkbox") r.enabled = el.checked;
      else if (el.type === "time") r.time = el.value;
      else r.label = el.value;
      App.save();
      if (el.type !== "text") syncIfConnected();
    });
    modal.querySelector(".rem-list").addEventListener("click", (e) => {
      const del = e.target.closest(".rem-del");
      if (del) { this.list().splice(+del.dataset.i, 1); App.save(); modal.remove(); this.open(); }
    });
    modal.querySelector("#rem-add").addEventListener("click", () => {
      this.list().push({ id: "r" + Date.now(), label: "New reminder", time: "12:00", enabled: true });
      App.save(); modal.remove(); this.open();
    });

    // Server push controls
    const connectBtn = modal.querySelector("#push-connect");
    const testBtn    = modal.querySelector("#push-test");
    const statusEl   = modal.querySelector("#push-status");
    const urlInput   = modal.querySelector("#push-url-input");

    if (connectBtn) connectBtn.addEventListener("click", async () => {
      const url = (urlInput.value || "").trim().replace(/\/$/, "");
      if (!url) return;
      statusEl.textContent = "Connecting…";
      statusEl.style.color = "var(--muted)";
      try {
        if (this.permission() !== "granted") {
          const r = await this.requestPermission();
          if (r !== "granted") { statusEl.textContent = "Notification permission denied."; return; }
        }
        await this.syncToWorker(url);
        App.state.settings.pushWorkerUrl = url;
        App.save();
        statusEl.textContent = "✅ Connected! Your reminder schedule is synced.";
        statusEl.style.color = "var(--good)";
        if (testBtn) testBtn.disabled = false;
      } catch (err) {
        statusEl.textContent = "❌ " + err.message;
        statusEl.style.color = "var(--danger)";
      }
    });

    if (testBtn) testBtn.addEventListener("click", async () => {
      const url = this.workerUrl();
      if (!url) return;
      statusEl.textContent = "Sending test…";
      statusEl.style.color = "var(--muted)";
      try {
        await this.sendTestPush(url);
        statusEl.textContent = "✅ Test sent — you should get a notification shortly!";
        statusEl.style.color = "var(--good)";
      } catch (err) {
        statusEl.textContent = "❌ " + err.message;
        statusEl.style.color = "var(--danger)";
      }
    });
  },
};
window.Reminders = Reminders;
