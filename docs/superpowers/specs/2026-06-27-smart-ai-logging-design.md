# Smart AI Logging — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning
**Part of roadmap:** (1) Smart AI logging ← *this spec* · (2) Engagement & habits · (3) Insights & data safety · (4) Nutrition depth

## Goal

Let users log meals by typing a plain sentence (*"2 eggs, toast and a banana"*) and get
macro-fit meal suggestions (*"what can I eat with 520 kcal and 40g protein left?"*) — both on the
Log tab, reusing StreakFit's existing free food database and online search, with no backend.

## Constraints (inherited from project)

- Vanilla JS + HTML + CSS, **no build step, no backend**, all state in `localStorage` (`streakfit.v1`).
- New feature modules follow the existing pattern: one file exposing a global object on `window`
  (like `Coach`, `Measurements`, `Gamify`, `Reminders`).
- Must work **fully free and offline** out of the box; AI is an optional enhancement.
- Food data is per-100 g; logged entries store totals as
  `{name, grams, kcal, protein, carbs, fats, sugar, fiber, sodium}` (summed by `App.dayTotals()`).
- Cache-busting: bump `?v=` for every edited/added asset in `index.html`.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| v1 scope | Natural-language logging **and** "what can I eat?" suggestions |
| Confirm flow | **Review-and-edit preview** before anything saves |
| Macro source | **Hybrid**: local DB → free online search → AI estimate fallback |
| No-key behavior | **Local parser fallback** (regex + portion table), AI enhances when a key is set |
| Suggestion source | **Hybrid + personalized**: rank user's own data first; AI adds variety when key set |
| Placement | **Both on the Log tab**, in a new card above the existing search |
| Pipeline architecture | **Two-stage: extract → resolve** |
| Module | New `js/smartlog.js` exposing `window.SmartLog` |

## Architecture

### New file: `js/smartlog.js` → `window.SmartLog`

A single module with pure helpers plus a small amount of DOM rendering. It **reuses** these
existing globals (all declared as top-level `function`s, so they're on `window`):

- `searchFoods(query)` — local DB search, returns per-100 g foods `{name, kcal, protein, carbs, fats, sugar, fiber, sodium, serving?:{label,g}}`
- `searchFoodsOnline(query)` — async, free OFF + USDA search, same shape
- `scaleMacros(food, grams)` — scales per-100 g macros to a gram amount
- `addScaledFood(food, grams)` — pushes a logged entry to `App.state.active.foods`, records recent, fires Gamify, saves
- `recordRecent`, `isFavorite`, `extractPlanJSON` (robust JSON parser from `workouts.js`)
- `renderLogTab()` — re-render the Log tab after logging
- `App.state` (`active`, `recentFoods`, `favoriteFoods`, `settings`), `App.dayTotals()`, `App.dailyMax()`, `App.save()`, `App.haptic()`

No new persistent state is required. One optional new setting: `App.state.settings.aiTextModel`.

### Pipeline (two-stage)

```
text ──parse()──▶ [{name, qty, unit}] ──resolve()──▶ [{food(per-100g), grams, macros, _source}] ──preview──▶ log
```

**Stage 1 — `SmartLog.parse(text)` → `Promise<[{name, qty, unit}]>`**

- If `settings.openrouterKey` is set: call OpenRouter chat completions with a strict prompt:
  *"Extract foods from this meal description. Return ONLY a JSON array of objects
  `{name, qty, unit}`. No nutrition, no prose."* Model = `settings.aiTextModel` or the default
  free constant `SmartLog.DEFAULT_MODEL = "meta-llama/llama-4-maverick:free"`. Response text is run
  through `extractPlanJSON()` to strip code fences / prose, then `JSON.parse`d. On any failure
  (network, timeout, bad JSON), fall back to the local parser.
- Else (no key) or on AI failure: `SmartLog.parseLocal(text)` — a pure function that:
  - lowercases, splits on `,` / ` and ` / `&` / newlines into fragments;
  - for each fragment, matches a leading quantity + optional unit via regex
    (`/^(\d+(?:\.\d+)?)\s*(g|kg|oz|ml|cup|cups|bowl|slice|slices|tbsp|tsp|scoop|handful|piece|pieces)?\s+(.*)$/`),
    plus number words ("two") → digits via a small map;
  - defaults `qty=1`, `unit="each"` when absent;
  - returns `[{name, qty, unit}]`, dropping empty fragments.

**Stage 2 — `SmartLog.resolve(item)` → `{food, grams, entry, _source}`**

- **Grams** via `SmartLog.unitToGrams(qty, unit, food)`:
  - if `unit` is a mass/volume (`g, kg, oz, ml`) → direct conversion (`oz→28.35g`, `kg→1000g`, `ml→1g` approx);
  - else if the matched `food.serving?.g` exists → `qty × serving.g`;
  - else look up `unit`/food in `SmartLog.PORTIONS` (e.g. `egg:50, banana:120, apple:180, bread/slice:30, cup:240, bowl:300, tbsp:15, tsp:5, scoop:30, handful:30`);
  - else default `qty × 100`.
- **Macros** (hybrid, in order):
  1. `searchFoods(item.name)` → take the best match (first result; name-similarity check). `_source:'db'`.
  2. else if online enabled: `await searchFoodsOnline(item.name)` → best match. `_source:'online'`.
  3. else if key set: AI estimate of **per-100 g** macros for `item.name` (single small JSON call,
     parsed via `extractPlanJSON`). `_source:'ai'`.
  4. else: synthesize an empty per-100 g food (zeros). `_source:'manual'`.
- Returns the per-100 g `food`, the computed `grams`, the scaled `entry = scaleMacros(food, grams)`,
  and `_source`.

`SmartLog.parseAndResolve(text)` orchestrates: parse → `Promise.all(items.map(resolve))` → returns
rows for the preview.

### Review-and-edit preview UI

Rendered into a container in the Quick-log card. One row per resolved item:

```
[name]  [grams input ✎]  [kcal]  [P/C/F]  [source badge]  [✕ remove]
```

- Editing the grams input recomputes that row (`scaleMacros(food, newGrams)`) and the footer totals live.
- Source badges reuse the base `.source-badge` style with four **new** modifier classes
  (`source-db` / `source-online` / `source-ai` / `source-manual`) added to `style.css`; the existing
  online-search badges (`source-fastfood` / `source-usda` / `source-packaged`) are left unchanged.
- `_source:'manual'` rows are visually flagged and show a "tap to fix" affordance that opens the
  existing food search (`food-search`) so the user can attach real data, or they can type macros
  directly (grams + a simple kcal field).
- **Footer:** total `kcal` + macros for the batch, and the resulting remaining budget
  ("leaves you 320 kcal · 12 g protein", from `dailyMax() − consumed` after the batch).
- **Buttons:** `Log all` → for each row `addScaledFood(row.food, row.grams)`, then `App.save()`,
  `renderLogTab()`, `App.renderDashboard()` if needed, haptic, clear the preview. `Cancel` → clear.

### "What can I eat?" suggestions — `SmartLog.suggest()`

- `remainingKcal = App.dailyMax() − Math.round(App.dayTotals().kcal)`;
  `remainingProtein = profile.proteinMinG − dayTotals().protein`.
- **Candidate pool:** `App.state.favoriteFoods` + `App.state.recentFoods` + saved recipes +
  a curated slice of the local food DB.
- **Score** each candidate with `SmartLog.scoreSuggestion(food, remainingKcal, remainingProtein, hour)`:
  pick a sensible portion (its `serving.g` or 100 g), prefer portions that fit within remaining kcal,
  reward protein density toward the remaining-protein gap, and apply a light time-of-day weight
  (breakfast-tagged foods boosted in the morning). Returns top ~3–5.
- Render suggestion cards: name, suggested grams, resulting macros, **Log it** (routes through the
  same resolver → preview, so the user still confirms).
- **AI variety (key set only):** an extra "AI ideas" group — one call asking for 2–3 meal ideas that
  fit `remainingKcal`/`remainingProtein` given recent foods; each idea, when tapped, is fed back
  through `parseAndResolve` → preview. Never logs without the preview confirm.

### Placement & markup (Log tab)

In `renderLogTab()` (in `database.js`), prepend a new card **above** the existing search block:

```html
<div class="card smartlog-card">
  <div class="smartlog-head">✨ Quick log</div>
  <input id="smartlog-input" placeholder="e.g. 2 eggs, toast and a banana">
  <div class="smartlog-actions">
    <button id="smartlog-go" class="btn-primary">Log</button>
    <button id="smartlog-suggest" class="btn-ghost">What can I eat?</button>
  </div>
  <div id="smartlog-preview"></div>
  <div id="smartlog-suggestions"></div>
</div>
```

Wiring is added in `renderLogTab()`'s listener section: `smartlog-go` (and Enter on the input) →
`SmartLog.run(input.value)`; `smartlog-suggest` → `SmartLog.suggest()`. Existing search / scan /
photo / recipe UI is untouched.

### Settings

- Reuses `App.state.settings.openrouterKey` (already used by the photo feature).
- Adds optional `App.state.settings.aiTextModel` (text input in the existing AI `<details>` block in
  `renderProfileForm`), defaulting to `SmartLog.DEFAULT_MODEL` when blank.
- Migration: in `App.load()` premium-fields block, `if (!s.settings.aiTextModel) s.settings.aiTextModel = ''`.

## Error handling & edge cases

- **AI parse fails / times out** → fall back to `parseLocal`; brief toast "Used basic parser."
- **Nothing parsed** → empty state in the preview area with example phrases (reuse `App._emptyState`).
- **Unresolved item** → Manual-flagged editable row; never silently logs zero-macro food.
- **Offline** → local parser + local DB only (`searchFoodsOnline` already swallows its own failures).
- **AI returns malformed JSON** → `extractPlanJSON` + try/catch → local fallback (logging) or skip (suggestions).
- All network calls use the existing `_fetchTimeout` helper with a sane timeout (~12 s).

## Module boundaries (so each unit is independently understandable)

- `parseLocal(text)` — pure: string → `[{name,qty,unit}]`. Testable in isolation.
- `unitToGrams(qty, unit, food)` — pure: number.
- `scoreSuggestion(food, kcal, protein, hour)` — pure: number.
- `resolve(item)` — async, depends on `searchFoods`/`searchFoodsOnline`/optional AI; returns a row object.
- Rendering functions (`renderPreview`, `renderSuggestions`) — depend only on row objects + DOM ids.

## Testing / verification

- Pure functions (`parseLocal`, `unitToGrams`, `scoreSuggestion`) are structured for direct
  assertion; a lightweight inline check is acceptable given the no-framework project.
- End-to-end is verified by driving the preview server: type a sentence → preview renders with
  correct items/macros → edit grams recomputes → Log all → entry appears in today's list and the
  dashboard rings/totals update; "What can I eat?" returns budget-fitting cards that log on tap.

## Out of scope (v1 — future follow-ups)

- Voice input (browser speech recognition).
- Multi-language parsing.
- Barcodes/URLs embedded in text.
- Saving a parsed batch as a reusable meal template.
- AI suggestions caching / history.

## Affected files

- **Create:** `js/smartlog.js`
- **Modify:** `js/database.js` (Quick-log card markup + wiring in `renderLogTab`), `js/app.js`
  (settings migration + optional `aiTextModel` field), `style.css` (smartlog card + preview/suggestion
  styles), `index.html` (script tag for `smartlog.js`, version bumps).
