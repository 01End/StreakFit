/* StreakFit — Social tab: serverless challenges.
 * Encodes a richer snapshot (streak, level, weight lost, workouts, budget) into a base64
 * token / URL, decodes a friend's token for an offline side-by-side leaderboard, and
 * renders a shareable progress card. No server — all client-side.
 */
function mySnapshot() {
  const t = App.dayTotals();
  const p = App.state.profile || {};
  const g = App.state.gamify || { xp: 0 };
  const lv = window.Gamify ? Gamify.levelInfo(g.xp || 0).level : 1;
  const ws = (App.state.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const wl = ws.length >= 2 ? +(ws[0].kg - ws[ws.length - 1].kg).toFixed(1) : 0;
  const wo = (g.stats && g.stats.workouts) || 0;
  return { n: "You", s: App.state.streak, st: App.state.active.steps || 0, k: Math.round(t.kcal), t: p.calorieTarget || 0, d: App.state.active.date, lv, wl, wo };
}

function encodeToken(snap) {
  return btoa(encodeURIComponent(JSON.stringify(snap)));
}

function decodeToken(token) {
  try {
    const obj = JSON.parse(decodeURIComponent(atob(token.trim())));
    if (typeof obj.s !== "number" || typeof obj.k !== "number") throw new Error();
    return obj;
  } catch (e) {
    throw new Error("Invalid or corrupted challenge token.");
  }
}

function budgetStatus(snap) {
  if (!snap.t) return { label: "—", cls: "" };
  const diff = snap.t - snap.k;
  return diff >= 0 ? { label: `${diff} under`, cls: "v-good" } : { label: `${Math.abs(diff)} over`, cls: "v-bad" };
}

function renderLeaderboard(friend) {
  const me = mySnapshot();
  if (friend) friend.n = friend.n || "Friend";
  const rows = [me, friend].filter(Boolean);
  // Rank by streak desc, then level, then weight lost.
  rows.sort((a, b) => b.s - a.s || (b.lv || 0) - (a.lv || 0) || (b.wl || 0) - (a.wl || 0));

  const board = document.getElementById("leaderboard");
  board.innerHTML = `
    <table class="board">
      <thead><tr><th></th><th><i class="fa-solid fa-fire i-ember"></i></th><th><i class="fa-solid fa-star i-lime"></i> Lvl</th><th><i class="fa-solid fa-arrow-trend-down"></i> kg</th><th><i class="fa-solid fa-dumbbell"></i> W/o</th></tr></thead>
      <tbody>
        ${rows
          .map((r, i) => {
            const medal = `<i class="fa-solid fa-medal" style="color:${i === 0 ? "#ffd24b" : "#c0c6cc"}"></i>`;
            return `<tr class="${r.n === "You" ? "me-row" : ""}">
              <td>${medal} ${r.n}</td>
              <td>${r.s}</td>
              <td>${r.lv || 1}</td>
              <td class="${(r.wl || 0) > 0 ? "v-good" : ""}">${r.wl || 0}</td>
              <td>${r.wo || 0}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    ${friend ? "" : `<p class="muted small">Paste a friend's token to compare.</p>`}`;
}

function shareCardHTML() {
  const s = mySnapshot();
  const cell = (icon, big, label) => `<div class="sc-stat"><span class="sc-icon"><i class="fa-solid ${icon}"></i></span><b>${big}</b><span class="sc-label">${label}</span></div>`;
  return `<div id="share-card" class="share-card">
      <div class="sc-head"><i class="fa-solid fa-fire"></i> StreakFit</div>
      <div class="sc-grid">
        ${cell("fa-fire", s.s, "day streak")}
        ${cell("fa-star", s.lv, "level")}
        ${cell("fa-arrow-trend-down", (s.wl > 0 ? s.wl : 0) + " kg", "lost")}
        ${cell("fa-dumbbell", s.wo, "workouts")}
      </div>
      <div class="sc-foot">${App.prettyDate(new Date())}</div>
    </div>`;
}

function loadSocialFromHash() {
  const token = location.hash.slice(3); // after "#c="
  renderSocialTab();
  try {
    const friend = decodeToken(token);
    renderLeaderboard(friend);
  } catch (e) {
    /* ignore bad hash */
  }
}

function renderSocialTab() {
  const root = document.getElementById("view-social");
  const myToken = encodeToken(mySnapshot());
  const shareUrl = `${location.origin}${location.pathname}#c=${myToken}`;

  root.innerHTML = `
    <h2>Social Challenges</h2>

    <div class="card">
      <h3><i class="fa-solid fa-id-card"></i> Your card</h3>
      ${shareCardHTML()}
      <p class="muted small">Screenshot to share your progress, or send the token below.</p>
    </div>

    <div class="card">
      <h3><i class="fa-solid fa-share-nodes"></i> Share / challenge a friend</h3>
      <textarea id="my-token" class="token" rows="3" readonly>${myToken}</textarea>
      <div class="btn-row">
        <button id="copy-token" class="btn-primary">Copy token</button>
        <button id="copy-link" class="btn-ghost">Copy link</button>
      </div>
    </div>

    <div class="card">
      <h3><i class="fa-solid fa-inbox"></i> Compare with a friend</h3>
      <textarea id="friend-token" class="token" rows="3" placeholder="Paste your friend's token here…"></textarea>
      <button id="compare-btn" class="btn-primary">Compare</button>
      <p id="social-error" class="error"></p>
    </div>

    <div class="card">
      <h3><i class="fa-solid fa-trophy"></i> Leaderboard</h3>
      <div id="leaderboard"></div>
    </div>`;

  renderLeaderboard(null);

  document.getElementById("copy-token").addEventListener("click", () => {
    navigator.clipboard?.writeText(myToken);
    flash("copy-token", "Copied!");
  });
  document.getElementById("copy-link").addEventListener("click", () => {
    navigator.clipboard?.writeText(shareUrl);
    flash("copy-link", "Copied!");
  });
  document.getElementById("compare-btn").addEventListener("click", () => {
    const errEl = document.getElementById("social-error");
    errEl.textContent = "";
    try {
      const friend = decodeToken(document.getElementById("friend-token").value);
      renderLeaderboard(friend);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function flash(id, text) {
  const el = document.getElementById(id);
  const original = el.textContent;
  el.textContent = text;
  setTimeout(() => (el.textContent = original), 1200);
}
