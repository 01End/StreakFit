# StreakFit Premium Redesign — Design Spec
**Date:** 2026-06-23  
**Status:** Approved by user  
**Approach:** Full redesign sprint — everything ships together as one cohesive release

---

## Vision

A fitness app so polished it looks like an Apple developer built it. Every pixel earns its place. The kind of app someone picks up, says "how did you do this", and immediately screenshots to send to a friend. Built to impress — could be sold to Apple.

---

## 1. Typography & Visual Foundation

### Font
- **Primary:** `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", system-ui`
- SF Pro loads automatically on iPhone/macOS (the actual Apple system font). Inter (Google Fonts) as cross-platform fallback.
- Remove Archivo and Outfit. SF Pro replaces both — it does heavy display numerals AND clean body text.

### Liquid Glass Material
Replace all `.card` surfaces with the Liquid Glass treatment from iOS 26:

```css
.lg {
  background: rgba(255,255,255,0.065);
  backdrop-filter: blur(52px) saturate(3) brightness(1.1);
  -webkit-backdrop-filter: blur(52px) saturate(3) brightness(1.1);
  border-radius: 24px;
  border: 0.5px solid rgba(255,255,255,0.18);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.25),
    inset 0 -1px 0 rgba(255,255,255,0.05),
    0 20px 60px rgba(0,0,0,0.45),
    0 2px 8px rgba(0,0,0,0.3);
}
/* Top specular highlight — simulates curved glass catching light */
.lg::before {
  content: ''; position: absolute; top: 0; left: 8%; right: 8%; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
}
/* Inner convex sheen */
.lg::after {
  content: ''; position: absolute; inset: 0; border-radius: 24px;
  background: linear-gradient(165deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 20%, transparent 45%);
}
```

Glass is **near-colorless** — the volcanic background gradients behind each card bleed through at full vibrancy. No warm tinting on the glass itself.

### Reactive Background
The background gradient mesh shifts hue based on the user's performance:
- **On track** — default volcanic palette (orange/magenta/violet/teal)
- **Crushed it** (under target, all goals met) — shifts to teal/green/blue
- **Over target** (significantly over calories) — shifts to deep red/crimson

Transition: `3s ease` so the shift feels organic, not jarring.

---

## 2. Dashboard Redesign

### Dynamic Island–Style Live Pill
A floating pill at the very top of the dashboard (below the notch):
- Shows: live kcal consumed + streak count
- **Tap to expand**: reveals remaining kcal, macro split
- Contracts back on second tap
- Styled like Apple's Dynamic Island: near-black glass, tight border-radius, pulsing dot

### Time-Aware Greeting
Replaces the static "Welcome back" header:
- 05:00–11:59 → "Good morning" + breakfast-focused sub-line
- 12:00–16:59 → "Good afternoon" + midday check-in
- 17:00–20:59 → "Good evening" + dinner/workout push
- 21:00–04:59 → "Still up?" + sleep reminder

### Apple Watch–Style Triple Activity Rings
Hero element below the greeting. Three concentric SVG rings:
1. **Outer (orange)** — calories consumed vs target
2. **Middle (teal)** — protein consumed vs target
3. **Inner (violet)** — water consumed vs target

Each ring: animated stroke-dashoffset on load, `stroke-linecap: round`, glow shadow matching the ring colour. Rings fill clockwise from 12 o'clock.

Ring legend to the right: value + percentage for each ring.

### Metric Cards (2×2 grid)
Below the rings: Steps, Body fat %, Streak heat gauge, Sleep. All liquid glass cards.

### Coach Insight Strip
A liquid glass card showing today's top coach insight. "At this pace you hit 78 kg in 11 weeks. Protein is your only gap." with a CTA button.

### Animations
- **Number count-up**: all big numbers animate from 0 on tab switch, easeOutCubic
- **Slot-machine flip**: numbers that update mid-session (e.g. after logging food) flip like a slot machine digit
- **3D gyroscope tilt**: `deviceorientation` API — cards tilt up to 8° on X/Y axis as user tilts phone. Subtle, premium.
- **Breathing rings**: rings pulse gently (scale 1→1.015→1) when within 5% of target
- **Haptic feedback**: `navigator.vibrate()` on every log action, stronger on goal completion and level-up

---

## 3. Food System — Three-Database Search

### Architecture
Every search fires against three sources in parallel via `Promise.allSettled`, results merged and deduplicated, ranked by relevance:

| Source | Coverage | API |
|--------|----------|-----|
| **Nutritionix** | Fast food chains (McDonald's, KFC, Starbucks, Subway, Burger King, Pizza Hut, Domino's, Chipotle, Wendy's, Nando's, Five Guys, + 800 more) | `https://trackapi.nutritionix.com/v2/search/instant` |
| **USDA FoodData Central** | 500k+ foods — raw ingredients, generic foods, FNDDS branded items | `https://api.nal.usda.gov/fdc/v1/foods/search` |
| **Open Food Facts** | Packaged items — chocolate bars, crisps, supermarket snacks, anything with a barcode | `https://world.openfoodfacts.org/api/v2/search` |

All three run concurrently. Results show a source badge (Fast Food / USDA / Packaged). Users always see the best match regardless of which database it came from.

### Search UX
- **Category pills** at top: All · 🍔 Fast Food · 🥩 Protein · 🌾 Grains · 🍫 Snacks · 🥗 Vegetables · 🥛 Dairy
- **Recents** always pinned at top before search results
- **Source badge** on every result (colour-coded: gold=fast food, teal=USDA, purple=packaged)
- **Saved recipes** show as Custom badge (violet), always ranked first when matched
- Empty state: illustrated card with suggestions ("Try searching 'chicken', 'Big Mac', or 'Pringles'")

### Nutritionix API Key
Requires free developer key from nutritionix.com (500 calls/day free tier — sufficient for personal use). User enters it once in Settings → stored in `App.state.settings.nutritionixAppId` and `nutritionixAppKey`. Never hardcoded or committed.

If keys are not configured: Nutritionix is silently skipped; USDA + Open Food Facts still run. A one-time prompt appears in the Log tab: "Add a free Nutritionix key in Settings to unlock fast food search (McDonald's, KFC, etc.)." Dismissed permanently once tapped or keys are added.

---

## 4. Coach Tab (replaces Social)

The Social tab is removed. The fourth nav slot becomes **Coach**.

### Three modes — swipe or tap pill to switch

#### Mode 1: Daily Insights (default view)
- Summary mini-cards: today's deficit, goal pace, days to target
- Insight cards generated from math engine — rule-based, not AI:
  - Calorie status + projection ("at this pace, goal in N weeks")
  - Macro gap ("protein is 70g short — add chicken at dinner")
  - Hydration reminder if water < 60% of target after 3pm
  - Sleep/energy correlation ("you log higher energy on 7h+ sleep nights")
- Coach insights update when new food/workout data is logged

#### Mode 2: What-If Simulator
- Input: current weight, goal weight (pre-filled from profile)
- Sliders: daily kcal (800–3500), workouts per week (0–7), daily steps (2k–20k), body fat %
- Output updates in real-time: weeks to goal, kg per week, projected goal date
- Works **before profile setup** — new users land here first
- Warning if pace is too aggressive (>1kg/week deficit shown in red)

#### Mode 3: Reverse Planner
- Inputs: current weight, target weight, deadline date
- Outputs: required daily kcal, protein target, exercise burn needed, daily steps
- Warning card if the math is unrealistic ("this requires a 1,200 kcal deficit/day — not sustainable")
- "Apply this plan" button sets these as the user's active daily targets

### Onboarding Flow (new users)
New users skip the old profile form. Instead:
1. Land on Coach tab → Simulator mode automatically
2. Enter weight + goal (no account needed)
3. See projection update live — they're hooked before committing
4. "Start tracking" button leads to profile completion
5. Remove "it's free" language everywhere — premium products don't say that

---

## 5. Goals & Measurements

### Six Goal Types (replaces current 3)
1. **Lose fat** — calorie deficit, preserve muscle (current)
2. **Build muscle** — calorie surplus + protein target (current)
3. **Maintain** — TDEE maintenance (current)
4. **Body recomposition** — lose fat AND gain muscle; slight deficit + high protein
5. **Hit body fat %** — target a specific body fat percentage as primary metric
6. **Athletic performance** — maintain weight, maximise energy + carb timing

Each goal type adjusts the Coach's daily targets, macro splits, and insight messaging.

### Body Measurements Tracker
New section in the Progress tab. Log weekly:
- Waist (cm)
- Chest (cm)
- Arms / bicep (cm)
- Thighs (cm)
- Hips (cm)
- Body fat % (manual entry or estimated from measurements)
- **Lean mass** — auto-calculated: `weight × (1 - bodyFat%/100)`

All stored in `App.state.measurements[]` as `{date, waist, chest, arms, thighs, hips, bodyFat, leanMass}`.

Coach insight fires when lean mass rises while weight drops: "You're losing fat AND gaining lean mass — perfect recomposition."

### Body Fat Estimation
If user doesn't have calipers, offer Navy Method estimate:
- Male: `495 / (1.0324 - 0.19077×log10(waist - neck) + 0.15456×log10(height)) - 450`
- Female: same formula with hip measurement added
Shown as an estimate, not a precise measurement.

---

## 6. Progress Charts

New charts in the Progress modal (or dedicated Progress tab section):

### Calorie History Bar Chart
- 7-day view (default) with toggle to 30-day
- Bars colour-coded: **orange** = on target (within 10%), **red** = over, **teal** = under
- Today's bar glows with a box-shadow
- Summary row: days on target / total, weekly deficit total, estimated kg lost

### Weight Trend Line
- Smooth SVG path over 30/60/90 days (toggle)
- Gradient fill beneath the line
- Projected goal line in dashed gold — extends from today to goal date
- Glowing dot at the current point
- Stats row: start weight, current weight, total lost

### Calorie Heatmap Calendar
- GitHub contribution graph style
- One cell per day for the last 90 days
- Cell colour: dark (no data), dim orange (logged but over), bright orange (on target), teal (great day)
- Tap a day to see that day's summary

---

## 7. Visual & Interaction Polish

### Micro-interactions
- **Skeleton loading**: shimmer placeholders (not blank screens) while data loads
- **Pull-to-refresh**: custom flame animation plays while recalculating totals
- **Empty states**: illustrated + guided — "No foods logged yet. Search above or tap Quick Add."
- **Spring physics**: all tab switches, modal opens, card expands use `cubic-bezier(0.34,1.56,0.64,1)`
- **Number slot-machine**: when a logged value updates mid-session, digits flip like a mechanical counter

### Haptic Feedback
- Light tap: every food/water log action
- Medium thump: hitting a daily goal (calories, protein, water, steps)
- Strong pulse: streak milestone, level-up, achievement unlock
- Implemented via `navigator.vibrate()` with pattern arrays

### 3D Gyroscope Tilt
On devices with `DeviceOrientationEvent`:
- Cards tilt up to 8° on X and Y axes as the phone tilts
- CSS `transform: perspective(800px) rotateX(Xdeg) rotateY(Ydeg)`
- Specular highlight position shifts with tilt (simulates real glass catching light)
- Graceful degradation: no tilt on devices without gyroscope or when `prefers-reduced-motion` is set

### Morning Brief Card
First card on dashboard between 05:00–09:00:
- Magazine editorial layout
- Shows: streak, goal pace, today's calorie target, yesterday's summary
- Disappears after 09:00 (or when first food is logged)

---

## 8. Data & State Changes

### New localStorage fields (added to `App.normalize()`)
```js
state.measurements = [];          // [{date, waist, chest, arms, thighs, hips, bodyFat, leanMass}]
state.settings.nutritionixAppId = "";
state.settings.nutritionixAppKey = "";
state.settings.goalType = "loseFat"; // loseFat | buildMuscle | maintain | recomp | bodyFat | athletic
state.settings.targetBodyFat = null;  // % target for bodyFat goal type
state.settings.deadline = null;       // ISO date string for reverse planner
```

### Removed
- `App.state.social` — social tab and all social data structures removed
- Social tab HTML, js/social.js — deleted

---

## 9. Files Changed

| File | Change |
|------|--------|
| `style.css` | Full Liquid Glass card system, SF Pro font stack, reactive background, ring animations, gyroscope tilt, new typography scale |
| `index.html` | Font link updated (Inter), Social nav → Coach nav, version bumps |
| `js/app.js` | Triple rings, Dynamic Island pill, time-aware greeting, reactive background, Coach tab render, measurements section, history charts |
| `js/database.js` | Three-database parallel search (Nutritionix + USDA + Open Food Facts), category pills, source badges, improved UX |
| `js/coach.js` | **New file** — Coach math engine: BMR/TDEE calculations, what-if simulator, reverse planner, insight rule engine |
| `js/measurements.js` | **New file** — body measurements tracker, Navy Method body fat estimate, lean mass calculation |
| `js/social.js` | **Deleted** |
| `js/gamify.js` | Haptic feedback on level-up, slot-machine number flip |
| `manifest.json` | Update theme-color to match new palette |

---

## 10. What Does Not Change
- All existing localStorage data is preserved — migration additive only
- Food logging shape `{name, grams, kcal, protein, carbs, fats, sugar, fiber, sodium}` unchanged
- Service worker / push notification system unchanged
- Cloudflare Worker unchanged
- Workout tracking unchanged
- Barcode scanner unchanged
- Photo meal import unchanged
