/* StreakFit — Social tab: serverless challenges.
 * Encodes today's snapshot into a compact base64 token (or shareable URL #c=…),
 * and decodes a friend's token to render an offline side-by-side leaderboard.
 */
function mySnapshot() {
  const t = App.dayTotals();
  const p = App.state.profile || {};
  return {
    n: "You",
    s: App.state.streak,
    st: App.state.active.steps || 0,
    k: Math.round(t.kcal),
    t: p.calorieTarget || 0,
    d: App.state.active.date,
  };
}

function encodeToken(snap) {
  // encodeURIComponent first so non-ASCII names survive btoa.
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
  return diff >= 0
    ? { label: `${diff} under`, cls: "v-good" }
    : { label: `${Math.abs(diff)} over`, cls: "v-bad" };
}

function renderLeaderboard(friend) {
  const me = mySnapshot();
  if (friend) friend.n = friend.n || "Friend";
  const rows = [me, friend].filter(Boolean);
  // Rank by streak desc, then steps desc.
  rows.sort((a, b) => b.s - a.s || b.st - a.st);

  const board = document.getElementById("leaderboard");
  board.innerHTML = `
    <table class="board">
      <thead><tr><th></th><th>🔥 Streak</th><th>👟 Steps</th><th>Budget</th></tr></thead>
      <tbody>
        ${rows
          .map((r, i) => {
            const b = budgetStatus(r);
            const medal = i === 0 ? "🥇" : "🥈";
            return `<tr class="${r.n === "You" ? "me-row" : ""}">
              <td>${medal} ${r.n}</td>
              <td>${r.s}</td>
              <td>${r.st.toLocaleString()}</td>
              <td class="${b.cls}">${b.label}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    ${friend ? "" : `<p class="muted small">Paste a friend's token to compare.</p>`}`;
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
      <h3>📤 Share your day</h3>
      <p class="muted small">Send this token (or link) to a friend. No server, fully offline.</p>
      <textarea id="my-token" class="token" rows="3" readonly>${myToken}</textarea>
      <div class="btn-row">
        <button id="copy-token" class="btn-primary">Copy token</button>
        <button id="copy-link" class="btn-ghost">Copy link</button>
      </div>
    </div>

    <div class="card">
      <h3>📥 Compare with a friend</h3>
      <textarea id="friend-token" class="token" rows="3" placeholder="Paste your friend's token here…"></textarea>
      <button id="compare-btn" class="btn-primary">Compare</button>
      <p id="social-error" class="error"></p>
    </div>

    <div class="card">
      <h3>🏆 Leaderboard</h3>
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
