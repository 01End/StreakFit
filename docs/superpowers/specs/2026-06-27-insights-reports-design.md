# Insights & Reports — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning
**Part of roadmap:** (1) Smart AI logging · (2) Engagement & habits · (3) Insights & data safety ← *this spec* · (4) Nutrition depth

## Goal

Turn the data StreakFit already collects into coaching insight. Expand the existing **Progress
modal** into an **Insights & Reports** experience: a windowed metrics panel (adherence, hit rates,
variance, best/worst day, projection accuracy) plus a weekly **recap report** that is templated by
default and gains an optional AI "deeper analysis" when a key is set.

## Constraints (inherited from project)

- Vanilla JS + HTML + CSS, **no build step, no backend**, all state in `localStorage` (`streakfit.v1`).
- New feature modules follow the existing pattern: one file exposing a global object on `window`
  (like `Coach`, `Measurements`, `Gamify`, `SmartLog`).
- Must work **fully free and offline** out of the box; AI is an optional enhancement.
- Reuse existing chart helpers — do **not** duplicate them: `App._calorieBarChart`,
  `App._weightTrendSVG`, `App._heatmapCalendar`, `App.sparkline`, `App.barsChart`, `App.adaptiveTDEE`.
- Cache-busting: bump `?v=` for every edited/added asset in `index.html`.
- API key (OpenRouter) lives **only** in `localStorage`; never hardcoded or committed.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Direction | **Insights & Reports dashboard** (chosen over streak insurance / meal planner / cloud sync) |
| Placement | **Expand the existing Progress modal** (no new bottom-nav tab; reached from the Dashboard button, relabeled "Insights") |
| Reports | **Templated recap + optional AI** "Deeper analysis" — offline-first, mirroring SmartLog / photo logging |
| Window | **7 / 30 / 90** day segmented toggle for the metrics panel; weekly recap is always last 7 days |
| Modal contents | Keep the existing **weigh-in** input and **adaptive-TDEE** action in the same modal |
| Macro depth | Add `carbs`/`fats` to the daily rollover snapshot so **future** insights are richer (past days can't be back-filled) |

## Data model (what's available)

Each `App.state.history[]` entry (pushed at rollover, app.js ~L408) currently holds:

```
{ date, kcal, protein, sugar, target, metGoal, waterMl, steps, sleepHours, mood, energy }
```

Plus `App.state.weights[] = [{date, kg}]` and `App.state.gamify.stats = {workouts, foods, photos}`.

**Implication:** historical macro insight is limited to **protein, sugar, and kcal-vs-target**.
Carbs/fats are not stored per day. This spec adds `carbs`/`fats` to the snapshot going forward
(forward-only; no back-fill).

## Architecture

New module **`js/insights.js`** exposing `window.Insights` (pure-first, render second):

| Member | Kind | Responsibility |
|---|---|---|
| `compute(windowDays)` | pure | Returns a metrics object over `history` + `weights` + `profile` for the last *N* days. No DOM. Fully unit-testable. |
| `weeklyReport()` | pure | Builds a deterministic templated recap object/string for the last 7 days. |
| `aiReport(metrics)` | async, optional | Sends **numeric stats only** to OpenRouter (`aiTextModel` setting); returns a short coaching narrative + tips. Graceful fallback when no key / offline / timeout. |
| `renderPanel(windowDays)` | render | Returns HTML for the metrics grid + report card, **reusing** the existing chart helpers. |
| `_bind(modal)` | render | Wires the window toggle + Share + Deeper-analysis buttons. |

`App.renderProgress()` (app.js:1057) remains the host modal. It keeps the weigh-in form and the
adaptive-TDEE card (those are *actions*), and delegates the analytics block to
`Insights.renderPanel()` + `Insights._bind()`. The Dashboard entry button (`#open-progress`,
app.js:985) is relabeled **"Insights"**.

### `compute(windowDays)` output shape

```js
{
  windowDays,                 // 7 | 30 | 90 (the selected window)
  daysInWindow,               // elapsed days the app could have logged = min(windowDays, daysSinceFirstHistory+1)
  daysLogged,                 // history days within the window with kcal > 0
  adherencePct,               // round(daysLogged / daysInWindow * 100) — denominator is daysInWindow, NOT windowDays,
                              //   so a new user with 5 days of data isn't penalized against a 30-day window
  goalDays,                   // count of metGoal === true
  avgKcal, targetKcal,        // mean logged kcal vs current target
  kcalVariance,               // population stdev of logged kcal (rounded)
  proteinHitRate,             // round(proteinHits / daysLogged * 100); proteinHits = protein >= profile.proteinMinG
  weightChangeKg,             // last weigh-in in window − first weigh-in in window (signed, 1 dp)
  projection,                 // { onTrack: bool, note } derived from App.adaptiveTDEE()
  bestDay,                    // { date, kcal } — logged day closest to (but not over) target; fallback closest abs
  worstDay,                   // { date, kcal } — logged day furthest from target
  weekdayRate, weekendRate,   // logging-rate % Mon–Fri vs Sat–Sun
  mostConsistent,             // "weekdays" | "weekends" | "even"
  avgSteps, avgSleep          // means where data present, else null
}
```

All fields guard for zero/insufficient data (return `0` / `null`, never `NaN`).

## Data flow

```
open Insights (Dashboard button)
  → App.renderProgress() builds modal shell (weigh-in, adaptive TDEE)
  → Insights.renderPanel(30) injected:
        Insights.compute(30) ──► metrics grid + windowed charts (reused helpers)
        Insights.weeklyReport() ──► templated recap card
  → Insights._bind(modal):
        window toggle 7/30/90 → re-run compute + re-render panel
        [Share recap]        → reuse social.js share-card pattern
        [✨ Deeper analysis]  → (only if key) Insights.aiReport(metrics)
                                  spinner → narrative, or fallback message
```

## UI

- **Window toggle:** segmented `7 / 30 / 90` control at the top of the analytics block. Extends the
  existing `_renderProgressSection`-style toggle already in `renderProgress`.
- **Metrics grid:** compact stat pills/cards (reuse `.prog-pill` / `.prog-grid` styles) — adherence,
  goal days, avg kcal ± variance, protein hit rate, weight change + on-track flag, best/worst day,
  most-consistent.
- **Charts:** existing calorie bars, weight trend SVG, activity heatmap — re-rendered for the chosen
  window.
- **Weekly recap card:** templated lines (days logged, avg kcal, weight Δ, workouts, protein hits,
  best day, streak note) with **[Share recap]** and, when a key is set, **[✨ Deeper analysis]**.

## Error handling

- **Empty / insufficient history:** friendly empty states per the existing pattern; every metric
  guards for 0 days and renders "—" rather than `NaN`.
- **AI report:** spinner while pending; on no-key the button is hidden; on network error/timeout show
  an inline "Couldn't reach AI — your recap above is still complete." The templated recap never
  depends on the AI call.
- **Security:** AI output is HTML-escaped (`_esc` pattern) before `innerHTML`; the prompt is built
  from numeric stats only (no free-text injection surface). Key read from `localStorage` only.

## Testing

`window._InsightsTests()` harness (mirrors `window._SmartLogTests`) — runs in the browser console,
no framework. Assertions over **synthetic history** fixtures:

- adherence % and `daysLogged` for a known mix of logged/empty days
- `kcalVariance` matches hand-computed stdev for a small fixture
- `proteinHitRate` against a known `proteinMinG`
- `bestDay` / `worstDay` selection (closest-under-target vs furthest)
- `weekdayRate` / `weekendRate` and `mostConsistent` classification
- zero-data input returns guarded `0`/`null` (no `NaN`)

## Out of scope (YAGNI)

- New bottom-nav tab, cloud sync, streak insurance, meal planner.
- Back-filling carbs/fats into historical days.
- Per-meal or per-food-level analytics (window is per-day).
- Persisting generated AI reports (regenerated on demand).

## File-level change summary

- **Create** `js/insights.js` — `window.Insights` analytics engine + panel renderer + tests.
- **Modify** `js/app.js` — add `carbs`/`fats` to the rollover snapshot; relabel `#open-progress`
  to "Insights"; have `renderProgress()` inject `Insights.renderPanel()` + `Insights._bind()`.
- **Modify** `style.css` — styles for the metrics grid + recap card (reuse existing tokens).
- **Modify** `index.html` — add `<script src="js/insights.js?v=1">`; bump `app.js`, `style.css` `?v=`.
