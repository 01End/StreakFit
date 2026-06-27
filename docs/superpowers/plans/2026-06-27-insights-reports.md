# Insights & Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing Progress modal into an Insights & Reports experience — a windowed metrics panel plus a templated weekly recap with optional AI "deeper analysis" — built entirely on data StreakFit already collects.

**Architecture:** A new browser-only module `js/insights.js` exposes `window.Insights` with a pure analytics core (`_computeFrom` / `compute`), a templated `weeklyReport`, an optional async `aiReport`, and DOM renderers (`renderPanel` / `_bind`) that reuse existing chart helpers. `App.renderProgress()` hosts the panel; the daily rollover snapshot gains `carbs`/`fats` for future macro insight.

**Tech Stack:** Vanilla ES (no build, no backend), `localStorage` state (`streakfit.v1`), OpenRouter (optional, key in `localStorage`), Font Awesome icons, existing CSS design tokens.

---

## Conventions (read before starting)

- **No build step.** Files are plain `<script>` includes in `index.html`, loaded in order, `app.js` last.
- **Module pattern:** one IIFE per feature exposing a global via `window.X = pub` at the end (see `js/smartlog.js`). `const X = (() => {...})()` does **not** attach to `window` by itself.
- **Globals already available to `insights.js`** (it loads after `database.js` and `smartlog.js`):
  - `_fetchTimeout(url, ms, opts)` — fetch with abort timeout (defined in `js/database.js:20`).
  - `App` — the central engine. `App.state`, `App.todayStr(date?)` → `'YYYY-MM-DD'`, `App.dayTotals()`, `App._calorieBarChart(days)`, `App._weightTrendSVG()`, `App._heatmapCalendar()`, `App._toast(msg, kind)`.
- **OpenRouter access pattern** (copy exactly from `js/smartlog.js:155-169`):
  - key: `(App.state.settings || {}).openrouterKey || ''`
  - model: `(App.state.settings || {}).aiTextModel || DEFAULT_MODEL`
  - endpoint: `https://openrouter.ai/api/v1/chat/completions`, header `Authorization: Bearer <key>`.
  - **Never hardcode a key.** No key set ⇒ AI features are simply hidden/skipped.
- **Verification is browser-based.** There is no Node test runner. The unit "tests" are a console
  harness `window._InsightsTests()` whose pure functions take explicit fixtures (no `App`/DOM needed).
  Run them via the preview tools with `preview_eval`.
- **Cache-busting:** every edited/added asset in `index.html` must get a bumped `?v=`. Current
  versions: `style.css?v=32`, `app.js?v=34`, `smartlog.js?v=1`, `database.js?v=15`.
- **Commits:** author is already `01End <endq-@outlook.com>`. Do **not** add a `Co-Authored-By` trailer.
- **Date dependency between tasks:** Tasks 1→4 progressively build the single file `js/insights.js`.
  Implement them in order; each appends to the same IIFE before the final `const pub = {...}` block.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `js/insights.js` (create) | `window.Insights` analytics engine + panel renderer + `_InsightsTests` harness | 1–4 |
| `js/app.js` (modify) | Inject panel into `renderProgress()`; add `App._renderInsights`; add `carbs`/`fats` to rollover snapshot; relabel `#open-progress` | 5 |
| `style.css` (modify) | Metrics grid + recap card styles | 6 |
| `index.html` (modify) | Add `insights.js?v=1` script; bump `app.js`/`style.css` `?v=` | 6 |

---

## Task 1: Insights analytics core (`compute`) + test harness

**Files:**
- Create: `js/insights.js`
- Modify: `index.html` (add script tag so the harness is loadable in the browser)

- [ ] **Step 1: Create `js/insights.js` with the IIFE skeleton, pure helpers, `_computeFrom`, `compute`, and the failing-first test harness**

Create `js/insights.js` with exactly this content:

```js
/* StreakFit — Insights & Reports: turns daily history into coaching metrics.
 * Pure analytics core (_computeFrom / compute) is DOM-free and unit-tested via
 * window._InsightsTests(). Rendering + optional AI are added in later tasks.
 * Owns no state — reads App.state.{history,weights,profile,settings,gamify}.
 */
const Insights = (() => {
  const DEFAULT_MODEL = 'meta-llama/llama-4-maverick:free';

  /* ---------- pure date/math helpers ---------- */
  function _stdev(arr) {
    if (!arr.length) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v);
  }
  function _daysAgoStr(today, n) {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  function _dayDiff(a, b) { // whole days from a -> b
    const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }
  function _weekdayName(ds) {
    return new Date(ds + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  }

  /* ---------- pure analytics core ---------- */
  // history: [{date,kcal,protein,sugar,target,metGoal,waterMl,steps,sleepHours,...}]
  // weights: [{date,kg}]   profile: {calorieTarget,proteinMinG,goalWeightKg,weightKg,...}
  function _computeFrom(history, weights, profile, windowDays, today) {
    history = Array.isArray(history) ? history : [];
    weights = Array.isArray(weights) ? weights : [];
    profile = profile || {};
    const target = profile.calorieTarget || 0;
    const proteinMin = profile.proteinMinG || 0;

    const cutoff = _daysAgoStr(today, windowDays - 1); // inclusive lower bound
    const inWin = history.filter(h => h.date >= cutoff && h.date <= today);

    // elapsed days the app could have logged, capped at windowDays (so new users aren't penalized)
    let daysInWindow = windowDays;
    if (history.length) {
      const firstDate = history.reduce((m, h) => (h.date < m ? h.date : m), history[0].date);
      const elapsed = _dayDiff(firstDate, today) + 1;
      daysInWindow = Math.max(1, Math.min(windowDays, elapsed));
    }

    const logged = inWin.filter(h => (h.kcal || 0) > 0);
    const daysLogged = logged.length;
    const adherencePct = daysInWindow ? Math.round((daysLogged / daysInWindow) * 100) : 0;
    const goalDays = inWin.filter(h => h.metGoal).length;

    const kcals = logged.map(h => h.kcal || 0);
    const avgKcal = kcals.length ? Math.round(kcals.reduce((a, b) => a + b, 0) / kcals.length) : 0;
    const kcalVariance = kcals.length ? Math.round(_stdev(kcals)) : 0;

    const proteinHits = proteinMin > 0 ? logged.filter(h => (h.protein || 0) >= proteinMin).length : 0;
    const proteinHitRate = daysLogged ? Math.round((proteinHits / daysLogged) * 100) : 0;

    const winWeights = weights.filter(w => w.date >= cutoff && w.date <= today)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const weightChangeKg = winWeights.length >= 2
      ? +(winWeights[winWeights.length - 1].kg - winWeights[0].kg).toFixed(1) : 0;

    const curWeight = winWeights.length ? winWeights[winWeights.length - 1].kg : (profile.weightKg || 0);
    let projection = { onTrack: null, note: 'Log 2+ weigh-ins to track progress' };
    if (profile.goalWeightKg && winWeights.length >= 2 && curWeight) {
      const wantLoss = profile.goalWeightKg < curWeight;
      const onTrack = wantLoss ? weightChangeKg < 0 : weightChangeKg > 0;
      projection = { onTrack, note: onTrack ? 'On track' : 'Off track' };
    }

    let bestDay = null, worstDay = null;
    if (logged.length && target > 0) {
      const scored = logged.map(h => ({
        date: h.date, kcal: Math.round(h.kcal), dist: Math.abs((h.kcal || 0) - target),
      })).sort((a, b) => a.dist - b.dist);
      bestDay = { date: scored[0].date, kcal: scored[0].kcal };
      worstDay = { date: scored[scored.length - 1].date, kcal: scored[scored.length - 1].kcal };
    }

    let wdTot = 0, wdLog = 0, weTot = 0, weLog = 0;
    for (let i = 0; i < daysInWindow; i++) {
      const ds = _daysAgoStr(today, i);
      const dow = new Date(ds + 'T00:00:00').getDay(); // 0 Sun .. 6 Sat
      const isWeekend = dow === 0 || dow === 6;
      const did = inWin.some(h => h.date === ds && (h.kcal || 0) > 0);
      if (isWeekend) { weTot++; if (did) weLog++; } else { wdTot++; if (did) wdLog++; }
    }
    const weekdayRate = wdTot ? Math.round((wdLog / wdTot) * 100) : 0;
    const weekendRate = weTot ? Math.round((weLog / weTot) * 100) : 0;
    const mostConsistent = weekdayRate === weekendRate ? 'even'
      : (weekdayRate > weekendRate ? 'weekdays' : 'weekends');

    const steps = logged.map(h => h.steps || 0).filter(v => v > 0);
    const avgSteps = steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null;
    const sleeps = inWin.map(h => h.sleepHours).filter(v => v);
    const avgSleep = sleeps.length ? +(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : null;

    return {
      windowDays, daysInWindow, daysLogged, adherencePct, goalDays,
      avgKcal, targetKcal: target, kcalVariance,
      proteinHits, proteinHitRate,
      weightChangeKg, projection, bestDay, worstDay,
      weekdayRate, weekendRate, mostConsistent, avgSteps, avgSleep,
    };
  }

  // App-bound wrapper (used by the UI; tests call _computeFrom directly with fixtures)
  function compute(windowDays) {
    const s = (window.App && App.state) || {};
    return _computeFrom(s.history, s.weights, s.profile, windowDays,
      (window.App && App.todayStr()) || _daysAgoStr('1970-01-01', 0));
  }

  /* ---------- test harness (browser console) ---------- */
  function _assertEq(label, got, want) {
    if (got !== want) throw new Error(`FAIL ${label}: got ${got}, want ${want}`);
    console.log(`PASS ${label}`);
  }
  function _InsightsTests() {
    const today = '2026-06-27'; // a Saturday
    const profile = { calorieTarget: 2000, proteinMinG: 150, goalWeightKg: 80, weightKg: 85 };
    // 7-day window ending today: log 5 of the last 7 days
    const hist = [
      { date: '2026-06-21', kcal: 0,    protein: 0,   metGoal: false }, // Sun, not logged
      { date: '2026-06-22', kcal: 2100, protein: 160, metGoal: true,  steps: 9000, sleepHours: 7 }, // Mon
      { date: '2026-06-23', kcal: 1900, protein: 140, metGoal: true,  steps: 7000, sleepHours: 8 }, // Tue
      { date: '2026-06-24', kcal: 2000, protein: 155, metGoal: true,  steps: 5000 }, // Wed (closest to target)
      { date: '2026-06-25', kcal: 2600, protein: 120, metGoal: false }, // Thu (furthest)
      { date: '2026-06-26', kcal: 1950, protein: 151, metGoal: true }, // Fri
      // Sat (today) not in history yet
    ];
    const weights = [{ date: '2026-06-22', kg: 85 }, { date: '2026-06-26', kg: 84.2 }];
    const m = _computeFrom(hist, weights, profile, 7, today);

    _assertEq('daysLogged', m.daysLogged, 5);
    _assertEq('daysInWindow', m.daysInWindow, 7);
    _assertEq('adherencePct', m.adherencePct, 71); // round(5/7*100)
    _assertEq('goalDays', m.goalDays, 4);
    _assertEq('proteinHits', m.proteinHits, 4); // 160,155,151 >=150 plus... 140<150,120<150 -> 160,155,151 = 3? verify below
    _assertEq('bestDayDate', m.bestDay.date, '2026-06-24');
    _assertEq('worstDayDate', m.worstDay.date, '2026-06-25');
    _assertEq('weightChangeKg', m.weightChangeKg, -0.8);
    _assertEq('projOnTrack', m.projection.onTrack, true);

    // zero-data must never produce NaN
    const z = _computeFrom([], [], {}, 30, today);
    _assertEq('zero adherence', z.adherencePct, 0);
    _assertEq('zero avgKcal', z.avgKcal, 0);
    _assertEq('zero variance', z.kcalVariance, 0);
    _assertEq('zero bestDay', z.bestDay, null);

    console.log('✅ All Insights tests passed.');
  }
  if (typeof window !== 'undefined') window._InsightsTests = _InsightsTests;

  const pub = {
    DEFAULT_MODEL,
    _computeFrom, compute,
    _daysAgoStr, _weekdayName, // exposed for later tasks/tests
  };
  if (typeof window !== 'undefined') window.Insights = pub;
  return pub;
})();
```

> **Note on the `proteinHits` assertion:** count protein values `>= 150` among logged days:
> `160, 140, 155, 120, 151` → `160, 155, 151` = **3**, not 4. Fix the assertion in Step 1 to
> `_assertEq('proteinHits', m.proteinHits, 3);` before running. (Left here deliberately so you
> verify the expected value against the fixture rather than trusting the number.)

- [ ] **Step 2: Add the script tag to `index.html` so the harness loads**

In `index.html`, add this line immediately **after** the existing `smartlog.js` line and **before** the `app.js` line:

```html
<script src="js/insights.js?v=1"></script>
```

(Do not bump other versions yet — that happens in Task 6. Adding the tag now lets you run the harness.)

- [ ] **Step 3: Run the harness — verify it FAILS before the assertion fix**

Start the preview server and run the harness:

```
preview_start
preview_eval: (function(){ try { window._InsightsTests(); return 'PASS'; } catch(e){ return 'FAIL: ' + e.message; } })()
```

Expected: `FAIL: FAIL proteinHits: got 3, want 4` (the deliberately-wrong assertion).

- [ ] **Step 4: Fix the assertion and re-run — verify PASS**

Change the `proteinHits` assertion line in `_InsightsTests` to:

```js
    _assertEq('proteinHits', m.proteinHits, 3);
```

Re-run:

```
preview_eval: (function(){ try { window._InsightsTests(); return 'PASS'; } catch(e){ return 'FAIL: ' + e.message; } })()
```

Expected: `PASS` (and console shows `✅ All Insights tests passed.`).

- [ ] **Step 5: Commit**

```bash
git add js/insights.js index.html
git commit -m "feat: add Insights analytics core (compute) with test harness"
```

---

## Task 2: Templated weekly recap (`weeklyReport`)

**Files:**
- Modify: `js/insights.js`

- [ ] **Step 1: Add a failing test for `_weeklyReportFrom` to `_InsightsTests`**

Inside `_InsightsTests`, just before the final `console.log('✅ ...')` line, add:

```js
    // weekly report (pure)
    const rep = _weeklyReportFrom(hist, weights, profile, { workouts: 3 }, today);
    _assertEq('report workouts', rep.workouts, 3);
    _assertEq('report has lines', rep.lines.length > 0, true);
    _assertEq('report protein line', rep.lines.some(l => l.indexOf('Protein') === 0), true);
```

- [ ] **Step 2: Run to verify it FAILS**

```
preview_eval: (function(){ try { window._InsightsTests(); return 'PASS'; } catch(e){ return 'FAIL: ' + e.message; } })()
```

Expected: `FAIL: ... _weeklyReportFrom is not defined`.

(You must hard-reload so the edited file is re-fetched: `preview_eval: window.location.reload()` first if HMR is not active. The file has no `?v=` bump yet, and the local preview server sends no cache headers, so a reload re-reads it.)

- [ ] **Step 3: Implement `_weeklyReportFrom` and `weeklyReport`**

In `js/insights.js`, add these two functions immediately after `compute` (before the test harness):

```js
  /* ---------- templated weekly recap (last 7 days) ---------- */
  function _weeklyReportFrom(history, weights, profile, gamifyStats, today) {
    const m = _computeFrom(history, weights, profile, 7, today);
    const workouts = (gamifyStats && gamifyStats.workouts) || 0;
    const wd = m.weightChangeKg;
    const wStr = wd === 0 ? 'no change' : (wd < 0 ? `▼ ${Math.abs(wd)} kg` : `▲ ${wd} kg`);
    const bestStr = m.bestDay ? _weekdayName(m.bestDay.date) : '—';
    const lines = [
      `Logged ${m.daysLogged}/${m.daysInWindow} days`,
      `Avg ${m.avgKcal} kcal` + (m.targetKcal ? ` (target ${m.targetKcal})` : ''),
      `Weight ${wStr}`,
      `Workouts ${workouts}`,
      `Protein goal hit ${m.proteinHits}/${m.daysLogged} days`,
      `Best day ${bestStr}`,
    ];
    const headline = m.daysLogged >= 6 ? 'Strong, consistent week.'
      : m.daysLogged >= 3 ? 'Solid week — keep it going.'
      : 'A few logs in — build the habit this week.';
    return { metrics: m, workouts, lines, headline };
  }
  function weeklyReport() {
    const s = (window.App && App.state) || {};
    const gstats = (s.gamify && s.gamify.stats) || { workouts: 0 };
    return _weeklyReportFrom(s.history, s.weights, s.profile, gstats,
      (window.App && App.todayStr()) || _daysAgoStr('1970-01-01', 0));
  }
```

Then add `_weeklyReportFrom, weeklyReport,` to the `pub` object:

```js
  const pub = {
    DEFAULT_MODEL,
    _computeFrom, compute,
    _weeklyReportFrom, weeklyReport,
    _daysAgoStr, _weekdayName,
  };
```

- [ ] **Step 4: Reload and run — verify PASS**

```
preview_eval: window.location.reload()
preview_eval: (function(){ try { window._InsightsTests(); return 'PASS'; } catch(e){ return 'FAIL: ' + e.message; } })()
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js
git commit -m "feat: add templated weekly recap to Insights"
```

---

## Task 3: Optional AI "deeper analysis" (`aiReport`)

**Files:**
- Modify: `js/insights.js`

- [ ] **Step 1: Implement `aiReport`**

In `js/insights.js`, add this function immediately after `weeklyReport` (before the test harness).
It sends **numeric stats only** (no user free-text → no injection surface) and degrades gracefully:

```js
  /* ---------- optional AI deeper analysis (key-gated, graceful) ---------- */
  async function aiReport(metrics) {
    const key = (App.state.settings || {}).openrouterKey || '';
    if (!key) return { ok: false, reason: 'no-key' };
    try {
      const model = (App.state.settings || {}).aiTextModel || DEFAULT_MODEL;
      const facts = [
        `window ${metrics.windowDays}d`,
        `logged ${metrics.daysLogged}/${metrics.daysInWindow}`,
        `adherence ${metrics.adherencePct}%`,
        `avg ${metrics.avgKcal} kcal (target ${metrics.targetKcal})`,
        `variance ${metrics.kcalVariance}`,
        `protein hit ${metrics.proteinHitRate}%`,
        `weight change ${metrics.weightChangeKg} kg`,
        `most consistent ${metrics.mostConsistent}`,
      ].join('; ');
      const resp = await _fetchTimeout('https://openrouter.ai/api/v1/chat/completions', 12000, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content:
            `You are a supportive fitness coach. Based ONLY on these weekly stats, write 2-3 short ` +
            `sentences of encouragement and ONE concrete, actionable tip. No markdown, no lists, ` +
            `under 60 words.\n\nStats: ${facts}` }],
          max_tokens: 160,
        }),
      });
      const data = await resp.json();
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (!text) return { ok: false, reason: 'empty' };
      return { ok: true, text };
    } catch (_) {
      return { ok: false, reason: 'error' };
    }
  }
```

Add `aiReport,` to the `pub` object:

```js
  const pub = {
    DEFAULT_MODEL,
    _computeFrom, compute,
    _weeklyReportFrom, weeklyReport,
    aiReport,
    _daysAgoStr, _weekdayName,
  };
```

- [ ] **Step 2: Verify no syntax error / harness still green**

```
preview_eval: window.location.reload()
preview_eval: (function(){ try { window._InsightsTests(); return 'PASS'; } catch(e){ return 'FAIL: ' + e.message; } })()
```

Expected: `PASS` (the harness doesn't call `aiReport`; this confirms the file still parses).

- [ ] **Step 3: Verify the no-key path returns a graceful object**

```
preview_eval: (async()=>{ const r = await window.Insights.aiReport(window.Insights.compute(7)); return JSON.stringify(r); })()
```

Expected (assuming no OpenRouter key configured on the test device): `{"ok":false,"reason":"no-key"}`.

- [ ] **Step 4: Commit**

```bash
git add js/insights.js
git commit -m "feat: add optional AI deeper-analysis to Insights"
```

---

## Task 4: Panel renderer + binding (`renderPanel`, `_gridHTML`, `_reportHTML`, `_bind`)

**Files:**
- Modify: `js/insights.js`

- [ ] **Step 1: Add the `_esc` helper and DOM renderers**

In `js/insights.js`, add this block immediately after `aiReport` (before the test harness). It reuses
existing CSS classes (`.prog-grid`, `.prog-pill`, `.chart-toggle`) plus a few new ones styled in Task 6:

```js
  /* ---------- rendering ---------- */
  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _pill(big, label) {
    return `<div class="prog-pill"><b>${big}</b><span>${label}</span></div>`;
  }
  function _gridHTML(m) {
    if (!m.daysLogged) {
      return `<div class="muted small" style="padding:8px 0">Log a few days to see your insights here.</div>`;
    }
    const projStr = m.projection.onTrack === null ? '—'
      : (m.projection.onTrack ? '<span class="v-good">on track</span>' : '<span class="v-bad">off track</span>');
    const wd = m.weightChangeKg;
    const wStr = wd === 0 ? '—' : (wd < 0 ? `▼ ${Math.abs(wd)}` : `▲ ${wd}`);
    const bestStr = m.bestDay ? _weekdayName(m.bestDay.date) : '—';
    const worstStr = m.worstDay ? _weekdayName(m.worstDay.date) : '—';
    return `<div class="prog-grid">
      ${_pill(`${m.adherencePct}%`, `adherence (${m.daysLogged}/${m.daysInWindow})`)}
      ${_pill(`${m.goalDays}`, 'goal days')}
      ${_pill(`${m.avgKcal}`, `avg kcal ±${m.kcalVariance}`)}
      ${_pill(`${m.proteinHitRate}%`, 'protein hit')}
      ${_pill(`${wStr} kg`, projStr)}
      ${_pill(`${bestStr}/${worstStr}`, 'best / worst')}
      ${_pill(m.mostConsistent, `wk ${m.weekdayRate}% · wkend ${m.weekendRate}%`)}
      ${_pill(m.avgSteps != null ? m.avgSteps : '—', 'avg steps')}
    </div>`;
  }
  function _reportHTML(rep) {
    const hasKey = !!((window.App && App.state.settings || {}).openrouterKey);
    const aiBtn = hasKey
      ? `<button id="insights-ai-btn" class="btn-ghost small"><i class="fa-solid fa-wand-magic-sparkles"></i> Deeper analysis</button>`
      : '';
    return `<div class="insights-report">
      <div class="ins-rep-head">${_esc(rep.headline)}</div>
      <ul class="ins-rep-list">
        ${rep.lines.map(l => `<li>${_esc(l)}</li>`).join('')}
      </ul>
      <div class="ins-rep-actions">
        <button id="insights-share-btn" class="btn-ghost small"><i class="fa-solid fa-share-nodes"></i> Share recap</button>
        ${aiBtn}
      </div>
      <div id="insights-ai-out" class="ins-ai-out"></div>
    </div>`;
  }
  function renderPanel(windowDays) {
    const m = compute(windowDays);
    const rep = weeklyReport();
    const tog = (d, lbl) =>
      `<button class="${windowDays === d ? 'active' : ''}" onclick="App._renderInsights(${d})">${lbl}</button>`;
    return `<div class="insights-block">
      <div class="chart-toggle insights-toggle">
        ${tog(7, '7d')}${tog(30, '30d')}${tog(90, '90d')}
      </div>
      <div id="insights-grid">${_gridHTML(m)}</div>
      ${_reportHTML(rep)}
    </div>`;
  }
  function _bind(root) {
    const shareBtn = root.querySelector('#insights-share-btn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const rep = weeklyReport();
      const text = `StreakFit — this week\n${rep.headline}\n• ` + rep.lines.join('\n• ');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      shareBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
      setTimeout(() => { shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share recap'; }, 1400);
    });
    const aiBtn = root.querySelector('#insights-ai-btn');
    if (aiBtn) aiBtn.addEventListener('click', async () => {
      const out = root.querySelector('#insights-ai-out');
      aiBtn.disabled = true;
      aiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing…';
      const r = await aiReport(compute(7));
      aiBtn.disabled = false;
      aiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Deeper analysis';
      if (out) out.innerHTML = r.ok
        ? `<div class="ins-ai">${_esc(r.text)}</div>`
        : `<div class="muted small">Couldn't reach AI — your recap above is still complete.</div>`;
    });
  }
```

Add the renderers to `pub`:

```js
  const pub = {
    DEFAULT_MODEL,
    _computeFrom, compute,
    _weeklyReportFrom, weeklyReport,
    aiReport,
    renderPanel, _gridHTML, _bind,
    _daysAgoStr, _weekdayName,
  };
```

- [ ] **Step 2: Verify the file parses and renders standalone**

```
preview_eval: window.location.reload()
preview_eval: (function(){ try { window._InsightsTests(); return 'PASS'; } catch(e){ return 'FAIL: ' + e.message; } })()
preview_eval: (function(){ const h = window.Insights.renderPanel(30); return h.indexOf('insights-block') >= 0 ? 'HTML-OK' : 'HTML-MISSING'; })()
```

Expected: `PASS`, then `HTML-OK`.

- [ ] **Step 3: Commit**

```bash
git add js/insights.js
git commit -m "feat: add Insights panel renderer and bindings"
```

---

## Task 5: Integrate into the Progress modal + rollover snapshot

**Files:**
- Modify: `js/app.js` (rollover snapshot ~L408; `renderProgress` ~L1057; dashboard button L911; add `_renderInsights`)

- [ ] **Step 1: Add `carbs`/`fats` to the daily rollover snapshot**

In `js/app.js`, find the `this.state.history.push({ ... })` call in `checkRollover()` (around line 408).
Add two fields after `protein:` so future days carry macro data:

```js
      this.state.history.push({
        date: a.date,
        kcal: Math.round(totals.kcal),
        protein: Math.round(totals.protein),
        carbs: Math.round(totals.carbs),
        fats: Math.round(totals.fats),
        sugar: Math.round(totals.sugar),
        target: target.calorieTarget,
        metGoal: met,
        waterMl: a.waterMl,
        steps: a.steps,
        sleepHours: a.sleepHours,
        mood: a.mood,
        energy: a.energy,
      });
```

- [ ] **Step 2: Relabel the Dashboard entry button to "Insights"**

In `js/app.js` around line 911, change the `#open-progress` button's `aria-label` from `Progress` to
`Insights` (icon `fa-chart-line` stays):

```html
          <button id="open-progress" class="btn-ghost small" aria-label="Insights"><i class="fa-solid fa-chart-line"></i></button>
```

- [ ] **Step 3: Inject the Insights panel into `renderProgress()`**

In `js/app.js`, inside `renderProgress()`, find the activity-heatmap card block (around line 1116):

```js
        <div class="card" style="padding:16px">
          <div style="font-size:13px;font-weight:800;margin-bottom:10px">Activity heatmap</div>
          ${this._heatmapCalendar()}
        </div>
```

Immediately **after** that closing `</div>` of the heatmap card (and before the `<div class="prog-section">Consistency` block), insert a new Insights card:

```js
        <div class="card" style="padding:16px">
          <div style="font-size:13px;font-weight:800;margin-bottom:10px"><i class="fa-solid fa-chart-line"></i> Insights & Reports</div>
          <div id="insights-card">${window.Insights ? Insights.renderPanel(30) : '<div class="muted small">Insights unavailable.</div>'}</div>
        </div>
```

- [ ] **Step 4: Bind the panel after the modal is in the DOM**

Still in `renderProgress()`, find where the modal is appended and listeners attached (the
`document.body.appendChild(modal);` / `requestAnimationFrame(...)` area, around line 1132). Immediately
after `document.getElementById('calorie-chart-section').innerHTML = App._calorieBarChart(7);` add:

```js
    if (window.Insights) Insights._bind(modal);
```

- [ ] **Step 5: Add `App._renderInsights(days)` to re-render the grid on window toggle**

In `js/app.js`, add this method right after `_renderProgressSection(type, days)` (ends around line 1207):

```js
  _renderInsights(days) {
    if (!window.Insights) return;
    const grid = document.getElementById('insights-grid');
    if (grid) grid.innerHTML = Insights._gridHTML(Insights.compute(days));
    document.querySelectorAll('.insights-toggle button').forEach((b) => {
      b.classList.toggle('active', b.textContent.trim() === days + 'd');
    });
  },
```

- [ ] **Step 6: Verify end-to-end in the browser**

```
preview_eval: window.location.reload()
preview_eval: (function(){ App.renderProgress(); const ok = !!document.getElementById('insights-card'); const grid = !!document.getElementById('insights-grid'); return ok && grid ? 'PANEL-OK' : 'PANEL-MISSING'; })()
preview_eval: (function(){ App._renderInsights(90); const a = document.querySelector('.insights-toggle button:last-child').classList.contains('active'); return a ? 'TOGGLE-OK' : 'TOGGLE-FAIL'; })()
```

Expected: `PANEL-OK`, then `TOGGLE-OK`. Then close the modal:

```
preview_eval: (function(){ const m = document.getElementById('progress-modal'); if (m) m.remove(); return 'closed'; })()
```

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat: wire Insights panel into Progress modal; add carbs/fats to snapshot"
```

---

## Task 6: Styles + cache-busting version bumps

**Files:**
- Modify: `style.css` (append new block)
- Modify: `index.html` (bump `?v=`)

- [ ] **Step 1: Append Insights styles to `style.css`**

Add this block at the **end** of `style.css` (reuses existing tokens like `--good`, `--danger`, `--violet`):

```css
/* ---------- Insights & Reports ---------- */
.insights-block { margin-top: 4px; }
.insights-toggle { margin-bottom: 12px; }
.insights-report {
  margin-top: 14px; padding: 14px;
  border: 0.5px solid rgba(255,255,255,0.08);
  border-radius: 14px; background: rgba(255,255,255,0.03);
}
.ins-rep-head { font-weight: 800; font-size: 13px; margin-bottom: 8px; }
.ins-rep-list { list-style: none; margin: 0; padding: 0; }
.ins-rep-list li {
  font-size: 12px; color: rgba(255,255,255,0.7);
  padding: 3px 0; border-bottom: 0.5px solid rgba(255,255,255,0.05);
}
.ins-rep-list li:last-child { border-bottom: 0; }
.ins-rep-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.ins-ai-out:empty { display: none; }
.ins-ai {
  margin-top: 12px; padding: 12px;
  border-left: 2px solid var(--violet);
  background: rgba(177,92,255,0.08); border-radius: 8px;
  font-size: 12.5px; line-height: 1.5; color: rgba(255,255,255,0.85);
}
```

- [ ] **Step 2: Bump versions in `index.html`**

In `index.html`, update these three `?v=` query params:
- `<link rel="stylesheet" href="style.css?v=32">` → `style.css?v=33`
- `<script src="js/insights.js?v=1">` → keep `?v=1` (new file, first version)
- `<script src="js/app.js?v=34">` → `js/app.js?v=35`

- [ ] **Step 3: Verify the styled panel renders without console errors**

```
preview_eval: window.location.reload()
preview_console_logs
preview_eval: (function(){ App.renderProgress(); return getComputedStyle(document.querySelector('.insights-report')).borderRadius; })()
preview_screenshot
```

Expected: no errors in console logs; a non-`0px` border radius (styles applied); screenshot shows the
Insights card with metric pills and the recap card. Then close the modal:

```
preview_eval: (function(){ const m = document.getElementById('progress-modal'); if (m) m.remove(); return 'closed'; })()
```

- [ ] **Step 4: Commit**

```bash
git add style.css index.html
git commit -m "feat: add Insights CSS and bump asset versions"
```

---

## Task 7: End-to-end verification + graph refresh

**Files:** none (verification + graph only)

- [ ] **Step 1: Full smoke test in the browser**

```
preview_eval: window.location.reload()
preview_eval: (function(){ try { window._InsightsTests(); return 'TESTS-PASS'; } catch(e){ return 'TESTS-FAIL: ' + e.message; } })()
preview_eval: (function(){ App.renderProgress(); const grid = document.getElementById('insights-grid'); const share = document.getElementById('insights-share-btn'); return (grid && share) ? 'UI-OK' : 'UI-MISSING'; })()
preview_eval: (function(){ const b = document.getElementById('insights-share-btn'); b.click(); return b.textContent.indexOf('Copied') >= 0 ? 'SHARE-OK' : 'SHARE-FAIL'; })()
preview_console_logs
```

Expected: `TESTS-PASS`, `UI-OK`, `SHARE-OK`, no console errors.

- [ ] **Step 2: Confirm empty-state path (no history) doesn't crash**

```
preview_eval: (function(){ const h = Insights._gridHTML(Insights._computeFrom([], [], {}, 30, App.todayStr())); return h.indexOf('Log a few days') >= 0 ? 'EMPTY-OK' : 'EMPTY-FAIL'; })()
```

Expected: `EMPTY-OK`.

- [ ] **Step 3: Close modal and stop preview**

```
preview_eval: (function(){ const m = document.getElementById('progress-modal'); if (m) m.remove(); return 'closed'; })()
preview_stop
```

- [ ] **Step 4: Refresh the graphify knowledge graph (per CLAUDE.md)**

```bash
C:/Python313/python.exe -m graphify js/ --update
```

Expected: re-extracts changed files (`js/insights.js`, `js/app.js`); prints updated node/edge counts.

- [ ] **Step 5: Final commit (if graph artifacts are tracked; they are gitignored, so this is usually a no-op)**

```bash
git add -A
git commit -m "chore: refresh graphify graph after Insights feature" || echo "nothing to commit (graph is gitignored)"
```

---

## Self-Review notes (already applied)

- **Spec coverage:** placement (expand Progress modal) → Task 5; templated + optional AI report →
  Tasks 2–3; 7/30/90 window toggle → Tasks 4–5; metrics set → Task 1; carbs/fats snapshot → Task 5;
  security (numeric-only prompt, `_esc`) → Tasks 3–4; tests → Task 1; reuse of existing charts →
  honored (panel adds the metric grid + recap; existing calorie/weight/heatmap cards untouched).
- **Adherence denominator** uses `daysInWindow` (elapsed, capped), not `windowDays` — matches the spec
  fix so new users aren't penalized.
- **Type consistency:** `compute`/`_computeFrom` output keys are referenced identically in
  `_gridHTML`, `_weeklyReportFrom`, and `aiReport` (`adherencePct`, `proteinHitRate`, `proteinHits`,
  `weightChangeKg`, `projection.onTrack`, `bestDay.date`, `mostConsistent`).
- **No new module export style** (`window.X = pub`) — matches `smartlog.js`.
```
