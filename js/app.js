/* StreakFit — core state, TDEE engine, dashboard, date rollover, persistence.
 * Loaded LAST. Exposes a global `App`. Other modules (database/workouts/social/scanner)
 * attach their render functions to `window` and read/write `App.state` + call `App.save()`.
 */
const App = {
  STORAGE_KEY: "streakfit.v1",

  ACTIVITY_FACTORS: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9,
  },

  // ~0.0004 kcal per step per kg → 10k steps ≈ 320 kcal for an 80 kg person.
  KCAL_PER_STEP_PER_KG: 0.0004,
  KCAL_PER_KG_FAT: 7700, // energy in 1 kg of body fat

  MOTIVATION: [
    "Discipline beats motivation. Show up.",
    "The deficit is won in the kitchen, the shape is built in training.",
    "Small daily wins compound into a new body.",
    "You don't have to be extreme, just consistent.",
    "Hunger is temporary. Regret lasts longer.",
    "One workout won't change you. Forty will.",
    "Drink the water. Hit the protein. Trust the process.",
    "Future you is watching what you do today.",
    "Cravings pass whether you feed them or not.",
    "Strong is the goal. Lean is the bonus.",
  ],

  // Mood scale 1–5 → Font Awesome face icons (sad → ecstatic).
  MOOD_ICONS: ["fa-face-sad-tear", "fa-face-frown", "fa-face-meh", "fa-face-smile", "fa-face-grin-stars"],

  state: null,

  /* ---------- persistence ---------- */
  blankActive(date) {
    return { date, foods: [], waterMl: 0, steps: 0, exerciseBurn: 0, workout: [], workoutTitle: "", sleepHours: null, mood: null, energy: null };
  },

  defaultState() {
    return {
      profile: null,
      active: this.blankActive(this.todayStr()),
      history: [],
      streak: 0,
      customFoods: [],
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this.state = raw ? JSON.parse(raw) : this.defaultState();
    } catch (e) {
      console.error("StreakFit: corrupt state, resetting.", e);
      this.state = this.defaultState();
    }
    this.normalize();
  },

  // Fill in any missing fields (forward/backward compatibility, imports, schema upgrades).
  normalize() {
    const s = this.state;
    if (!s.active) s.active = this.blankActive(this.todayStr());
    if (!s.history) s.history = [];
    if (!s.customFoods) s.customFoods = [];
    if (!s.weights) s.weights = [];
    if (!s.settings) s.settings = {};
    // migrate the now-dead default model id → a currently-valid free vision model
    if (!s.settings.visionModel || s.settings.visionModel === "meta-llama/llama-4-maverick:free")
      s.settings.visionModel = "google/gemma-4-31b-it:free";
    if (!s.recentFoods) s.recentFoods = [];
    if (!s.favoriteFoods) s.favoriteFoods = [];
    if (!s.customPlans) s.customPlans = [];
    if (!s.gamify) s.gamify = { xp: 0, achievements: {}, quests: null };
    if (typeof s.streak !== "number") s.streak = 0;
    // migrate old 8-glass water → ml (250 ml per glass)
    if (s.active.waterMl == null) s.active.waterMl = (s.active.water || 0) * 250;
    if (s.active.steps == null) s.active.steps = 0;
    if (s.active.exerciseBurn == null) s.active.exerciseBurn = 0;
    if (!s.active.workout) s.active.workout = [];
    // profile defaults for new fields
    if (s.profile) {
      const p = s.profile;
      if (p.waterTargetMl == null) p.waterTargetMl = Math.round(p.weightKg * 35);
      if (p.goalWeightKg == null) p.goalWeightKg = null;
      if (p.goalWeeks == null) p.goalWeeks = null;
      if (p.goalType == null) p.goalType = "lose"; // migrate "aggressiveCut" → lose
      if (p.ratePct == null) p.ratePct = null;
      if (p.fiberTargetG == null) p.fiberTargetG = Math.max(25, Math.round((p.calorieTarget / 1000) * 14));
      if (p.sodiumMaxMg == null) p.sodiumMaxMg = 2300;
    }
  },

  save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error("StreakFit: failed to save.", e);
    }
  },

  /* ---------- date helpers ---------- */
  todayStr(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  addDays(date, n) {
    const d = new Date(date.getTime() + n * 86400000);
    return d;
  },

  prettyDate(d) {
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  },

  // US Navy body-fat estimate from tape measurements (cm). Returns % or null.
  navyBodyFat(p) {
    const { gender, heightCm: h, neckCm: nk, waistCm: wa, hipCm: hp } = p;
    if (!h || !nk || !wa) return null;
    const log10 = Math.log10;
    let bf;
    if (gender === "female") {
      if (!hp) return null;
      bf = 495 / (1.29579 - 0.35004 * log10(wa + hp - nk) + 0.22100 * log10(h)) - 450;
    } else {
      if (wa - nk <= 0) return null;
      bf = 495 / (1.0324 - 0.19077 * log10(wa - nk) + 0.15456 * log10(h)) - 450;
    }
    return bf > 0 && bf < 70 ? +bf.toFixed(1) : null;
  },
  // Effective body fat: explicit value, else the Navy estimate, else null.
  effectiveBodyFat(p) {
    if (p.bodyFatPct) return +p.bodyFatPct;
    return this.navyBodyFat(p);
  },

  /* ---------- TDEE / macro engine (goal-timeframe driven) ---------- */
  computeTargets(profile) {
    const { weightKg: kg, heightCm: cm, age, gender, activityLevel } = profile;
    // Katch-McArdle (lean-mass based) when body fat is known — more accurate; else Mifflin-St Jeor.
    const bf = this.effectiveBodyFat(profile);
    let bmr, bmrMethod;
    if (bf != null && bf > 0 && bf < 70) {
      const lean = kg * (1 - bf / 100);
      bmr = 370 + 21.6 * lean;
      bmrMethod = "Katch-McArdle";
    } else {
      bmr = gender === "female" ? 10 * kg + 6.25 * cm - 5 * age - 161 : 10 * kg + 6.25 * cm - 5 * age + 5;
      bmrMethod = "Mifflin-St Jeor";
    }
    const tdee = bmr * (this.ACTIVITY_FACTORS[activityLevel] || 1.2);
    const floor = gender === "female" ? 1200 : 1500;
    const goalType = profile.goalType || "lose";

    // Resolve the calorie target per goal type.
    let calorieTarget, appliedDeficit = 0, requestedDeficit = 0, surplus = 0, proteinPerKg = 2.0;
    if (goalType === "maintain") {
      calorieTarget = Math.round(tdee);
      proteinPerKg = 1.8;
    } else if (goalType === "gain") {
      let weeklyKg;
      if (profile.goalWeightKg && profile.goalWeeks && profile.goalWeightKg > kg) {
        weeklyKg = (profile.goalWeightKg - kg) / profile.goalWeeks;
      } else {
        weeklyKg = kg * ((profile.ratePct || 0.25) / 100);
      }
      surplus = Math.min(Math.round((weeklyKg * this.KCAL_PER_KG_FAT) / 7), 500); // cap lean-gain surplus
      calorieTarget = Math.round(tdee + surplus);
    } else {
      // lose
      let weeklyKg;
      if (profile.goalWeightKg && profile.goalWeeks && profile.goalWeightKg < kg) {
        weeklyKg = (kg - profile.goalWeightKg) / profile.goalWeeks;
      } else {
        weeklyKg = kg * ((profile.ratePct || 0.75) / 100);
      }
      requestedDeficit = Math.round((weeklyKg * this.KCAL_PER_KG_FAT) / 7);
      const maxDeficit = Math.max(0, Math.round(tdee - floor));
      appliedDeficit = Math.min(requestedDeficit, maxDeficit);
      calorieTarget = Math.max(Math.round(tdee - appliedDeficit), floor);
    }

    const proteinMinG = Math.round(proteinPerKg * kg);
    const sugarMaxG = 36;
    const fatTargetG = Math.round(0.8 * kg);
    const remaining = calorieTarget - proteinMinG * 4 - fatTargetG * 9;
    const carbTargetG = Math.max(Math.round(remaining / 4), 0);
    const fiberTargetG = Math.max(25, Math.round((calorieTarget / 1000) * 14)); // ~14 g / 1000 kcal
    const sodiumMaxMg = 2300;
    const waterTargetMl = Math.round(kg * 35);

    return {
      bmr: Math.round(bmr),
      bmrMethod,
      bodyFat: bf,
      tdee: Math.round(tdee),
      goalType,
      requestedDeficit,
      appliedDeficit,
      surplus,
      calorieTarget,
      proteinMinG,
      sugarMaxG,
      fatTargetG,
      carbTargetG,
      fiberTargetG,
      sodiumMaxMg,
      waterTargetMl,
    };
  },

  /* ---------- daily totals & burn ---------- */
  dayTotals() {
    const t = { kcal: 0, protein: 0, carbs: 0, fats: 0, sugar: 0, fiber: 0, sodium: 0 };
    for (const f of this.state.active.foods) {
      t.kcal += +f.kcal || 0;
      t.protein += +f.protein || 0;
      t.carbs += +f.carbs || 0;
      t.fats += +f.fats || 0;
      t.sugar += +f.sugar || 0;
      t.fiber += +f.fiber || 0;
      t.sodium += +f.sodium || 0;
    }
    return t;
  },

  stepsBurn() {
    const kg = (this.state.profile && this.state.profile.weightKg) || 75;
    return Math.round((this.state.active.steps || 0) * kg * this.KCAL_PER_STEP_PER_KG);
  },

  activityBurn() {
    return (this.state.active.exerciseBurn || 0) + this.stepsBurn();
  },

  // Max calories you can eat today = base target + whatever you burned through activity.
  dailyMax() {
    return Math.round((this.state.profile?.calorieTarget || 0) + this.activityBurn());
  },

  metGoal(totals, target) {
    return totals.kcal <= target.calorieTarget && totals.protein >= target.proteinMinG;
  },

  /* ---------- goal projection (timeframe-based, lose or gain) ---------- */
  goalProjection() {
    const p = this.state.profile;
    if (!p || (p.goalType || "lose") === "maintain") return null;
    const gaining = (p.goalType || "lose") === "gain";
    if (!p.goalWeightKg) return null;
    if (gaining && p.goalWeightKg <= p.weightKg) return null;
    if (!gaining && p.goalWeightKg >= p.weightKg) return null;

    const kgToGo = +Math.abs(p.weightKg - p.goalWeightKg).toFixed(1);
    // Calorie gap the plan actually applies (deficit for lose, surplus for gain).
    const gap = Math.abs(p.calorieTarget - p.tdee);
    const achievableWeeklyKg = (gap * 7) / this.KCAL_PER_KG_FAT;
    const achievableWeeks = achievableWeeklyKg > 0 ? Math.ceil(kgToGo / achievableWeeklyKg) : Infinity;

    const chosenWeeks = p.goalWeeks || achievableWeeks;
    const requestedWeeklyKg = kgToGo / chosenWeeks;
    const maxSafeWeeklyKg = p.weightKg * (gaining ? 0.005 : 0.01); // gain slower than loss
    const safe = requestedWeeklyKg <= maxSafeWeeklyKg + 0.001;
    const floored = achievableWeeks > chosenWeeks;

    const etaWeeks = Math.max(chosenWeeks, achievableWeeks === Infinity ? chosenWeeks : achievableWeeks);
    const target = this.addDays(new Date(), etaWeeks * 7);

    return {
      gaining,
      kgToGo,
      chosenWeeks,
      etaWeeks,
      requestedWeeklyKg: +requestedWeeklyKg.toFixed(2),
      achievableWeeklyKg: +achievableWeeklyKg.toFixed(2),
      maxSafeWeeklyKg: +maxSafeWeeklyKg.toFixed(2),
      safe,
      floored,
      gap,
      target,
    };
  },

  /* ---------- weigh-ins & adaptive TDEE (MacroFactor-style) ---------- */
  logWeight(kg) {
    kg = +kg;
    if (!kg || kg <= 0) return;
    if (!this.state.weights) this.state.weights = [];
    const today = this.todayStr();
    const existing = this.state.weights.find((w) => w.date === today);
    if (existing) existing.kg = kg;
    else this.state.weights.push({ date: today, kg });
    this.state.weights.sort((a, b) => a.date.localeCompare(b.date));
    // Recalibrate formula targets to the new bodyweight (keeps goal + timeframe).
    this.state.profile.weightKg = kg;
    const t = this.computeTargets(this.state.profile);
    Object.assign(this.state.profile, {
      bmr: t.bmr, tdee: t.tdee, calorieTarget: t.calorieTarget,
      proteinMinG: t.proteinMinG, fatTargetG: t.fatTargetG, carbTargetG: t.carbTargetG,
      fiberTargetG: t.fiberTargetG, waterTargetMl: t.waterTargetMl,
    });
    this.save();
    if (window.Gamify) Gamify.onWeighIn();
  },

  // Estimate real TDEE from weight trend vs logged intake over the recent window.
  adaptiveTDEE() {
    const ws = (this.state.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (ws.length < 2) return { insufficient: true, reason: "Log your weight on at least 2 days." };
    const first = ws[0], last = ws[ws.length - 1];
    const spanDays = Math.round((new Date(last.date) - new Date(first.date)) / 86400000);
    if (spanDays < 7) return { insufficient: true, reason: "Need ~1 week between first and latest weigh-in." };
    // average logged intake across history days within the window
    const inWindow = this.state.history.filter((h) => h.date >= first.date && h.date <= last.date && h.kcal > 0);
    if (inWindow.length < 4) return { insufficient: true, reason: "Log your food on more days to calibrate." };
    const avgIntake = inWindow.reduce((s, h) => s + h.kcal, 0) / inWindow.length;
    const weightChange = last.kg - first.kg; // negative = lost
    const tdee = Math.round(avgIntake - (weightChange * this.KCAL_PER_KG_FAT) / spanDays);
    return { tdee, formula: this.state.profile.tdee, spanDays, weightChange: +weightChange.toFixed(1), avgIntake: Math.round(avgIntake), loggedDays: inWindow.length };
  },

  applyAdaptiveTDEE() {
    const a = this.adaptiveTDEE();
    if (a.insufficient) return;
    const p = this.state.profile;
    const deficit = p.tdee - p.calorieTarget;
    const floor = p.gender === "female" ? 1200 : 1500;
    p.tdee = a.tdee;
    p.calorieTarget = Math.max(a.tdee - deficit, floor);
    p.carbTargetG = Math.max(Math.round((p.calorieTarget - p.proteinMinG * 4 - p.fatTargetG * 9) / 4), 0);
    this.save();
  },

  /* ---------- tiny SVG charts ---------- */
  sparkline(values, color) {
    if (!values.length) return "";
    const w = 280, h = 70, pad = 6;
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1 || 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}"/>
      ${pts.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="2.5" fill="${color}"/>`).join("")}
    </svg>`;
  },

  barsChart(items) {
    if (!items.length) return "";
    const w = 280, h = 80, pad = 4;
    const max = Math.max(...items.map((i) => Math.max(i.value, i.target)), 1);
    const bw = (w - 2 * pad) / items.length - 3;
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      ${items.map((it, i) => {
        const x = pad + i * ((w - 2 * pad) / items.length);
        const bh = (it.value / max) * (h - 12);
        const ty = h - 8 - (it.target / max) * (h - 12);
        const col = it.value <= it.target ? "var(--good)" : "var(--danger)";
        return `<rect x="${x.toFixed(1)}" y="${(h - 8 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${col}"/>
                <line x1="${x.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(x + bw).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>`;
      }).join("")}
    </svg>`;
  },

  /* ---------- date rollover ---------- */
  checkRollover() {
    const today = this.todayStr();
    const a = this.state.active;
    if (a.date === today) return;

    if (this.state.profile) {
      const totals = this.dayTotals();
      const target = this.state.profile;
      const met = this.metGoal(totals, target);
      this.state.history.push({
        date: a.date,
        kcal: Math.round(totals.kcal),
        protein: Math.round(totals.protein),
        sugar: Math.round(totals.sugar),
        target: target.calorieTarget,
        metGoal: met,
        waterMl: a.waterMl,
        steps: a.steps,
        sleepHours: a.sleepHours,
        mood: a.mood,
        energy: a.energy,
      });
      if (this.state.history.length > 365) this.state.history.shift();
      this.state.streak = met ? this.state.streak + 1 : 0;
      if (met && window.Gamify) Gamify.onStreakDay();
    }

    this.state.active = this.blankActive(today);
    this.save();
  },

  /* ---------- water & steps ---------- */
  setWaterMl(ml) {
    this.state.active.waterMl = Math.max(0, ml);
    this.save();
    this.updateWaterUI();
  },

  updateWaterUI() {
    const ml = this.state.active.waterMl;
    const targetMl = this.state.profile?.waterTargetMl || 3000;
    const ratio = ml / targetMl;
    const pct = Math.min(100, ratio * 100);
    const fill = document.getElementById("water-fill");
    if (fill) fill.style.height = `${pct.toFixed(1)}%`;
    const vessel = fill && fill.closest(".vessel");
    if (vessel) vessel.classList.toggle("near", ratio >= 0.9);
    const pctEl = vessel && vessel.querySelector(".vessel-pct");
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
    const label = document.getElementById("water-amount");
    if (label) label.textContent = `${(ml / 1000).toFixed(2)} / ${(targetMl / 1000).toFixed(2)} L`;
    const wrap = document.querySelector('.ring-wrap[data-ring="water"]');
    if (wrap) {
      const r = 42;
      const c = 2 * Math.PI * r;
      const off = c * (1 - Math.min(1, ml / targetMl));
      wrap.querySelector(".ring-fg").style.setProperty("--off", off.toFixed(2));
      wrap.querySelector(".ring-val").textContent = `${(ml / 1000).toFixed(1)}L`;
    }
  },

  addWater(ml) {
    const before = this.state.active.waterMl;
    const target = this.state.profile?.waterTargetMl || 3000;
    this.setWaterMl(before + ml);
    if (ml > 0 && this.state.active.waterMl >= target && before < target) this.celebrate("Hydration goal hit!");
  },

  setSteps(steps) {
    this.state.active.steps = Math.max(0, parseInt(steps, 10) || 0);
    this.save();
    this.renderDashboard(); // steps change the max + activity burn → refresh
  },

  /* ---------- profile onboarding / editing ---------- */
  renderProfileForm(isEdit = false) {
    const p = this.state.profile || {};
    const sel = (v, opt) => (v === opt ? "selected" : "");
    const root = document.getElementById("view-dashboard");
    root.innerHTML = `
      <div class="card onboard">
        <h2>${isEdit ? "Edit Profile" : "Welcome to StreakFit"}</h2>
        <p class="muted">${isEdit ? "Update your metrics — targets recalculate automatically." : "Enter your metrics to compute your personalized targets."}</p>
        <form id="profile-form">
          <div class="grid-2">
            <label>Weight (kg)<input name="weightKg" type="number" step="0.1" required value="${p.weightKg ?? ""}"></label>
            <label>Goal weight (kg)<input name="goalWeightKg" type="number" step="0.1" placeholder="optional" value="${p.goalWeightKg ?? ""}"></label>
            <label>Height (cm)<input name="heightCm" type="number" step="0.1" required value="${p.heightCm ?? ""}"></label>
            <label>Age<input name="age" type="number" required value="${p.age ?? ""}"></label>
          </div>
          <label>Goal timeframe
            <select name="goalWeeks">
              <option value="" ${p.goalWeeks ? "" : "selected"}>Auto (safe aggressive)</option>
              <option value="4" ${sel(String(p.goalWeeks), "4")}>1 month</option>
              <option value="6" ${sel(String(p.goalWeeks), "6")}>6 weeks</option>
              <option value="8" ${sel(String(p.goalWeeks), "8")}>2 months</option>
              <option value="12" ${sel(String(p.goalWeeks), "12")}>3 months</option>
              <option value="16" ${sel(String(p.goalWeeks), "16")}>4 months</option>
              <option value="26" ${sel(String(p.goalWeeks), "26")}>6 months</option>
            </select>
          </label>
          <label>Gender
            <select name="gender">
              <option value="male" ${sel(p.gender, "male")}>Male</option>
              <option value="female" ${sel(p.gender, "female")}>Female</option>
            </select>
          </label>
          <label>Activity Level
            <select name="activityLevel">
              <option value="sedentary" ${sel(p.activityLevel, "sedentary")}>Sedentary (little/no exercise)</option>
              <option value="light" ${sel(p.activityLevel, "light")}>Light (1-3 days/wk)</option>
              <option value="moderate" ${sel(p.activityLevel, "moderate")}>Moderate (3-5 days/wk)</option>
              <option value="active" ${sel(p.activityLevel, "active")}>Active (6-7 days/wk)</option>
              <option value="veryActive" ${sel(p.activityLevel, "veryActive")}>Very Active (physical job)</option>
            </select>
          </label>
          <label>Goal
            <select name="goalType">
              <option value="lose" ${sel(p.goalType || "lose", "lose")}>Lose fat</option>
              <option value="maintain" ${sel(p.goalType, "maintain")}>Maintain</option>
              <option value="gain" ${sel(p.goalType, "gain")}>Lean bulk / gain</option>
            </select>
          </label>
          <p class="muted small">Fine-tune your pace and calories anytime with the calculator on the dashboard.</p>
          ${
            isEdit
              ? `<details class="advanced"><summary>Advanced: override targets</summary>
                  <label>Water target (ml)<input name="waterTargetMl" type="number" value="${p.waterTargetMl ?? ""}"></label>
                  <label>Calorie Target<input name="calorieTarget" type="number" value="${p.calorieTarget ?? ""}"></label>
                  <label>Protein Min (g)<input name="proteinMinG" type="number" value="${p.proteinMinG ?? ""}"></label>
                  <label>Sugar Max (g)<input name="sugarMaxG" type="number" value="${p.sugarMaxG ?? ""}"></label>
                  <label>Carb Target (g)<input name="carbTargetG" type="number" value="${p.carbTargetG ?? ""}"></label>
                  <label>Fat Target (g)<input name="fatTargetG" type="number" value="${p.fatTargetG ?? ""}"></label>
                  <label>Fiber Target (g)<input name="fiberTargetG" type="number" value="${p.fiberTargetG ?? ""}"></label>
                  <label>Sodium Max (mg)<input name="sodiumMaxMg" type="number" value="${p.sodiumMaxMg ?? ""}"></label>
                 </details>`
              : ""
          }
          ${
            isEdit
              ? `<details class="advanced"><summary><i class="fa-solid fa-camera"></i> Photo logging (OpenRouter)</summary>
                  <label>OpenRouter API key<input name="openrouterKey" type="password" placeholder="sk-or-..." value="${(this.state.settings || {}).openrouterKey || ""}"></label>
                  <label>Vision model<input name="visionModel" value="${(this.state.settings || {}).visionModel || "meta-llama/llama-4-maverick:free"}"></label>
                  <p class="muted small">Stored on this device only. Free key: openrouter.ai → Keys. Leave blank to use the chat-handoff flow.</p>
                 </details>`
              : ""
          }
          <button type="submit" class="btn-primary">${isEdit ? "Save" : "Calculate & Start"}</button>
          ${isEdit ? `<button type="button" id="cancel-edit" class="btn-ghost">Cancel</button>` : ""}
        </form>
        ${isEdit ? this.dataToolsMarkup() : ""}
      </div>`;

    document.getElementById("profile-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const base = {
        weightKg: +fd.get("weightKg"),
        goalWeightKg: fd.get("goalWeightKg") ? +fd.get("goalWeightKg") : null,
        goalWeeks: fd.get("goalWeeks") ? +fd.get("goalWeeks") : null,
        heightCm: +fd.get("heightCm"),
        age: +fd.get("age"),
        gender: fd.get("gender"),
        activityLevel: fd.get("activityLevel"),
        goalType: fd.get("goalType") || "lose",
        ratePct: this.state.profile?.ratePct ?? null,
      };
      const auto = this.computeTargets(base);
      const overrideOr = (key) => {
        const v = fd.get(key);
        return v !== null && v !== "" ? +v : auto[key];
      };
      this.state.profile = {
        ...base,
        bmr: auto.bmr,
        tdee: auto.tdee,
        calorieTarget: overrideOr("calorieTarget"),
        proteinMinG: overrideOr("proteinMinG"),
        sugarMaxG: overrideOr("sugarMaxG"),
        carbTargetG: overrideOr("carbTargetG"),
        fatTargetG: overrideOr("fatTargetG"),
        fiberTargetG: overrideOr("fiberTargetG"),
        sodiumMaxMg: overrideOr("sodiumMaxMg"),
        waterTargetMl: overrideOr("waterTargetMl"),
      };
      if (fd.has("openrouterKey")) {
        this.state.settings = this.state.settings || {};
        this.state.settings.openrouterKey = (fd.get("openrouterKey") || "").trim();
        this.state.settings.visionModel = (fd.get("visionModel") || "").trim() || "meta-llama/llama-4-maverick:free";
      }
      this.save();
      this.renderDashboard();
    });

    if (isEdit) {
      document.getElementById("cancel-edit").addEventListener("click", () => this.renderDashboard());
      this.bindDataTools();
    }
  },

  /* ---------- dashboard ---------- */
  ring(percent, color, valueText, label) {
    const r = 42;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, percent));
    const offset = c * (1 - pct);
    // "within 10% of target" → momentum pulse (but not when blown past it)
    const near = percent >= 0.9 && percent <= 1.08;
    return `
      <div class="ring-wrap ${near ? "near" : ""}" data-ring="${label}">
        <svg viewBox="0 0 100 100" class="ring">
          <circle cx="50" cy="50" r="${r}" class="ring-bg"></circle>
          <circle cx="50" cy="50" r="${r}" class="ring-fg"
            style="--rc:${color};--c:${c.toFixed(2)};--off:${offset.toFixed(2)}"></circle>
        </svg>
        <div class="ring-center"><span class="ring-val">${valueText}</span><span class="ring-label">${label}</span></div>
      </div>`;
  },

  /* Streak as a literal temperature gauge: dim ember → white-hot at 2 weeks. */
  heatGauge() {
    const s = this.state.streak || 0;
    const pct = Math.min(100, (s / 14) * 100);
    let tier, label, icon;
    if (s >= 14)      { tier = "whitehot"; label = "WHITE-HOT"; icon = "fa-temperature-full"; }
    else if (s >= 7)  { tier = "blazing";  label = "BLAZING";   icon = "fa-temperature-three-quarters"; }
    else if (s >= 3)  { tier = "warming";  label = "WARMING";   icon = "fa-temperature-half"; }
    else              { tier = "ember";    label = s > 0 ? "EMBER" : "COLD"; icon = "fa-temperature-quarter"; }
    return `<div class="heat-gauge heat-${tier}">
        <i class="fa-solid ${icon}"></i>
        <div class="heat-track">
          <div class="heat-fill" style="width:${pct}%"></div>
          <div class="heat-knob" style="left:${pct}%"></div>
        </div>
        <span class="heat-label">${label}</span>
      </div>`;
  },

  /* Momentary spark explosion — fired on calorie target + XP level-up. */
  sparkBurst(count = 36) {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const layer = document.createElement("div");
    layer.className = "sparks";
    const cols = ["#ffd98a", "#ff6a18", "#ff2e7e", "#ffc83a", "#fff4dc"];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * 240;
      const sp = document.createElement("i");
      sp.style.setProperty("--dx", `${(Math.cos(a) * dist).toFixed(0)}px`);
      sp.style.setProperty("--dy", `${(Math.sin(a) * dist).toFixed(0)}px`);
      sp.style.background = cols[i % cols.length];
      sp.style.animationDelay = `${(Math.random() * 0.08).toFixed(2)}s`;
      sp.style.animationDuration = `${(0.7 + Math.random() * 0.55).toFixed(2)}s`;
      layer.appendChild(sp);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1500);
  },

  /* badges earned from current state */
  computeBadges() {
    const p = this.state.profile;
    const t = this.dayTotals();
    const a = this.state.active;
    const out = [];
    const add = (icon, name, earned) => out.push({ icon, name, earned });
    add("fa-fire", "3-day", this.state.streak >= 3);
    add("fa-bolt", "Week", this.state.streak >= 7);
    add("fa-trophy", "30-day", this.state.streak >= 30);
    add("fa-dumbbell", "Protein", t.protein >= (p?.proteinMinG || 1e9));
    add("fa-droplet", "Hydrated", a.waterMl >= (p?.waterTargetMl || 1e9));
    add("fa-circle-check", "Workout", a.workout.length > 0 && a.workout.every((e) => e.done));
    add("fa-utensils", "Logged", a.foods.length > 0);
    return out;
  },

  dailyMotivation() {
    // stable per calendar day
    const idx = Math.abs(this.hash(this.state.active.date)) % this.MOTIVATION.length;
    return this.MOTIVATION[idx];
  },

  hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
    return h;
  },

  // Animate a number from 0 → target (easeOutCubic). Used for the hero on tab-in.
  animateCount(el, to, dur = 750) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !to) { el.textContent = to; return; }
    el.classList.add("counting");
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = to;
    };
    requestAnimationFrame(step);
  },

  haptic(type = 'light') {
    if (!navigator.vibrate) return;
    const patterns = { light: [10], medium: [20, 30, 20], strong: [30, 20, 30, 20, 50] };
    navigator.vibrate(patterns[type] || [10]);
  },

  _initGyro() {
    // Bail if prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Bail if API not available
    if (!window.DeviceOrientationEvent) return;

    // iOS 13+ requires permission request
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // Only request on user gesture — listen for first tap, then request
      const req = () => {
        DeviceOrientationEvent.requestPermission()
          .then(state => {
            if (state === 'granted') {
              document.body.classList.add('gyro-enabled');
              window.addEventListener('deviceorientation', this._onGyro.bind(this), { passive: true });
            }
          })
          .catch(() => {});
        document.removeEventListener('touchend', req);
      };
      document.addEventListener('touchend', req, { once: true });
    } else {
      // Android / non-gated browsers — add listener directly
      document.body.classList.add('gyro-enabled');
      window.addEventListener('deviceorientation', this._onGyro.bind(this), { passive: true });
    }
  },

  _onGyro(e) {
    // beta = front-back tilt (-180 to 180), gamma = left-right tilt (-90 to 90)
    const beta  = Math.max(-8, Math.min(8, (e.beta  || 0) - 45)); // 45° = neutral upright
    const gamma = Math.max(-8, Math.min(8, (e.gamma || 0)));

    // Apply to all .card elements currently in DOM
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
      card.style.transform = `perspective(800px) rotateX(${-beta * 0.5}deg) rotateY(${gamma * 0.5}deg)`;
    });
  },

  _animateNumber(el, newText) {
    if (!el || el.textContent === newText) return;
    el.classList.add('flip-digit', 'flipping');
    setTimeout(() => {
      el.textContent = newText;
      el.classList.remove('flipping');
    }, 180);
  },

  _greeting() {
    const h = new Date().getHours();
    let main, sub;
    if (h >= 5 && h < 12) {
      main = 'Good morning';
      sub = 'Start strong — breakfast sets the tone';
    } else if (h >= 12 && h < 17) {
      main = 'Good afternoon';
      sub = 'Midday check-in — how\'s the fuel level?';
    } else if (h >= 17 && h < 21) {
      main = 'Good evening';
      sub = 'Dinner time — finish your protein today';
    } else {
      main = 'Still up?';
      sub = 'Your body repairs while you sleep — rest well';
    }
    return { main, sub };
  },

  _islandPillHTML(consumed, max, streak, t) {
    const remaining = max - consumed;
    return `<div class="island-pill" onclick="App._islandExpanded=!App._islandExpanded;this.classList.toggle('expanded')" role="button" aria-label="Today summary">
    <span class="island-dot"></span>
    <span class="island-kcal">${consumed} kcal</span>
    <span class="island-streak"><i class="fa-solid fa-fire"></i> ${streak}</span>
    <div class="island-expanded">
      <div class="island-macro">
        <div class="island-macro-val" style="color:${remaining>=0?'var(--flame)':'var(--danger)'}">${remaining>=0?remaining:Math.abs(remaining)}</div>
        <div class="island-macro-lbl">${remaining>=0?'left':'over'}</div>
      </div>
      <div class="island-macro">
        <div class="island-macro-val" style="color:var(--aqua)">${Math.round(t.protein)}g</div>
        <div class="island-macro-lbl">protein</div>
      </div>
      <div class="island-macro">
        <div class="island-macro-val" style="color:var(--violet)">${Math.round(t.carbs)}g</div>
        <div class="island-macro-lbl">carbs</div>
      </div>
    </div>
  </div>`;
  },

  _updateBg() {
    const t = this.dayTotals();
    const max = this.dailyMax();
    document.body.classList.remove('perf-crushed', 'perf-over');
    if (t.kcal < max * 0.9 && t.protein >= (this.state.profile?.proteinMinG || 0))
      document.body.classList.add('perf-crushed');
    else if (t.kcal > max * 1.05)
      document.body.classList.add('perf-over');
  },

  tripleRings(consumed, max, protein, proteinTarget, waterMl, waterTargetMl) {
    const rawPct = (v, t) => t > 0 ? v / t : 0;
    const clamp  = p => Math.min(Math.max(p, 0), 1);
    const calRaw = rawPct(consumed, max);
    const proRaw = rawPct(protein, proteinTarget);
    const watRaw = rawPct(waterMl, waterTargetMl);

    // Three concentric rings: outer r=70, middle r=54, inner r=38
    // circumference = 2πr; dashoffset = circ * (1 - pct) to fill clockwise from top
    const rings = [
      { r: 70, pct: clamp(calRaw), color: 'var(--flame)',  val: consumed,                      unit: 'kcal', lbl: 'Calories', near: calRaw >= 0.95 && calRaw <= 1.05 },
      { r: 54, pct: clamp(proRaw), color: 'var(--aqua)',   val: Math.round(protein) + 'g',     unit: '',     lbl: 'Protein',  near: proRaw >= 0.95 && proRaw <= 1.05 },
      { r: 38, pct: clamp(watRaw), color: 'var(--violet)', val: (waterMl/1000).toFixed(1)+'L', unit: '',     lbl: 'Water',    near: watRaw >= 0.95 && watRaw <= 1.05 },
    ];

    const svgRings = rings.map(({ r, pct, color, near }) => {
      const circ = +(2 * Math.PI * r).toFixed(2);
      const offset = +(circ * (1 - pct)).toFixed(2);
      const nearCls = near ? ' near-target' : '';
      return `
        <circle class="ring-track" cx="90" cy="90" r="${r}" stroke="${color}" stroke-width="9"/>
        <circle class="ring-fill${nearCls}" cx="90" cy="90" r="${r}" stroke="${color}" stroke-width="9"
          style="stroke-dasharray:${circ};stroke-dashoffset:${offset};transform:rotate(-90deg);filter:drop-shadow(0 0 6px ${color})"
          data-circ="${circ}" data-offset="${offset}"/>`;
    }).join('');

    const legend = rings.map(({ color, val, unit, lbl }) =>
      `<div class="ring-legend-row">
        <span class="ring-legend-val" style="color:${color}">${val}</span>
        ${unit ? `<span class="ring-legend-unit">${unit}</span>` : ''}
        <span class="ring-legend-lbl">${lbl}</span>
      </div>`
    ).join('');

    return `<div class="triple-rings-wrap">
      <svg class="triple-rings-svg" viewBox="0 0 180 180" width="180" height="180">${svgRings}</svg>
      <div class="rings-legend">${legend}</div>
    </div>`;
  },

  renderDashboard() {
    const root = document.getElementById("view-dashboard");
    if (!this.state.profile) {
      this.renderProfileForm(false);
      return;
    }
    this._updateBg();
    const p = this.state.profile;
    const t = this.dayTotals();
    const stepBurn = this.stepsBurn();
    const actBurn = this.activityBurn();
    const max = this.dailyMax();
    const consumed = Math.round(t.kcal);
    const remaining = max - consumed;

    const calColor = consumed > max ? "var(--danger)" : "var(--accent)";
    const proColor = t.protein >= p.proteinMinG ? "var(--good)" : "var(--warn)";
    const sugColor = t.sugar > p.sugarMaxG ? "var(--danger)" : "var(--good)";

    const gt = p.goalType || "lose";
    const leftWord = gt === "maintain" ? "to maintenance" : gt === "gain" ? "to your target" : "until your max";
    const verdicts = [];
    if (remaining >= 0) verdicts.push(`<li class="v-good"><i class="fa-solid fa-circle-check"></i> ${remaining} kcal ${leftWord}</li>`);
    else verdicts.push(`<li class="v-bad"><i class="fa-solid fa-ban"></i> ${Math.abs(remaining)} kcal over ${gt === "gain" ? "target" : "your max"}</li>`);
    if (t.protein >= p.proteinMinG)
      verdicts.push(`<li class="v-good"><i class="fa-solid fa-circle-check"></i> Protein goal met (${Math.round(t.protein)}/${p.proteinMinG} g)</li>`);
    else
      verdicts.push(`<li class="v-warn"><i class="fa-solid fa-triangle-exclamation"></i> Protein ${Math.round(p.proteinMinG - t.protein)} g short</li>`);
    if (t.sugar <= p.sugarMaxG)
      verdicts.push(`<li class="v-good"><i class="fa-solid fa-circle-check"></i> Sugar under cap (${Math.round(t.sugar)}/${p.sugarMaxG} g)</li>`);
    else
      verdicts.push(`<li class="v-bad"><i class="fa-solid fa-ban"></i> Sugar over by ${Math.round(t.sugar - p.sugarMaxG)} g</li>`);

    const goalType = p.goalType || "lose";
    const gp = this.goalProjection();
    const goalLabel = { lose: "Lose fat", maintain: "Maintain", gain: "Lean bulk" }[goalType];
    let goalCard;
    if (goalType === "maintain") {
      goalCard = `<div class="card goal-card">
           <h3><i class="fa-solid fa-bullseye"></i> ${goalLabel}</h3>
           <div class="goal-big">${p.calorieTarget} <span class="muted">kcal/day</span></div>
           <div class="muted small">Eating at maintenance (TDEE ${p.tdee})</div>
           <button id="adjust-goal" class="btn-ghost">Adjust goal</button>
         </div>`;
    } else if (gp) {
      const warn = !gp.safe
        ? `<div class="goal-warn"><i class="fa-solid fa-triangle-exclamation"></i> That pace (${gp.requestedWeeklyKg} kg/wk) is faster than the safe max of ${gp.maxSafeWeeklyKg} kg/wk — calories are capped safely, so realistic finish is shown below.</div>`
        : gp.floored
        ? `<div class="goal-warn"><i class="fa-solid fa-circle-info"></i> Calories capped at the safe limit, so the realistic finish is a bit later than your chosen date.</div>`
        : "";
      goalCard = `<div class="card goal-card">
           <h3><i class="fa-solid fa-bullseye"></i> ${goalLabel}</h3>
           <div class="goal-big">${gp.kgToGo} kg <span class="muted">${gp.gaining ? "to gain" : "to go"}</span></div>
           <div class="goal-line">~${gp.etaWeeks} weeks → <strong>${this.prettyDate(gp.target)}</strong></div>
           <div class="muted small">~${gp.achievableWeeklyKg} kg/wk · ${gp.gaining ? "surplus" : "deficit"} ${gp.gap} kcal/day${gp.chosenWeeks ? ` · target ${gp.chosenWeeks} wk` : ""}</div>
           ${warn}
           <button id="adjust-goal" class="btn-ghost">Adjust goal</button>
         </div>`;
    } else {
      goalCard = `<div class="card goal-card muted-card">
           <h3><i class="fa-solid fa-bullseye"></i> ${goalLabel}</h3>
           <p class="muted small">Open the calculator to set your pace, target weight + timeframe, or a custom calorie target.</p>
           <button id="adjust-goal" class="btn-ghost">Open calorie calculator</button>
         </div>`;
    }

    const targetMl = p.waterTargetMl;
    if (window.Gamify) Gamify.checkDaily(t); // award daily XP + unlock achievements before rendering counts
    const badges = this.computeBadges();

    root.innerHTML = `
      <header class=”dash-head”>
        ${this._islandPillHTML(consumed, max, this.state.streak, t)}
        <div class=”head-btns”>
          <button id=”open-reminders” class=”btn-ghost small” aria-label=”Reminders”><i class=”fa-solid fa-bell”></i></button>
          <button id=”open-progress” class=”btn-ghost small” aria-label=”Progress”><i class=”fa-solid fa-chart-line”></i></button>
          <button id=”edit-profile” class=”btn-ghost small” aria-label=”Settings”><i class=”fa-solid fa-gear”></i></button>
        </div>
      </header>
      <div class=”dash-greeting”>
        <div class=”greeting-main”>${this._greeting().main}</div>
        <div class=”greeting-sub”>${this._greeting().sub}</div>
      </div>

      ${this.heatGauge()}

      <div class="remaining-hero">
        <span class="big" style="color:${calColor === "var(--danger)" ? "var(--danger)" : "inherit"}">${consumed}</span>
        <span class="muted">of ${max} kcal max ${actBurn ? `· +${actBurn} earned` : ""}</span>
        <div class="hero-pill ${remaining >= 0 ? "ok" : "bad"}">${remaining >= 0 ? `${remaining} kcal left` : `${Math.abs(remaining)} over`}</div>
      </div>

      ${this.tripleRings(consumed, max, t.protein, p.proteinMinG, this.state.active.waterMl, targetMl)}

      ${badges.some((b) => b.earned) ? `<div class="badges">${badges.filter((b) => b.earned).map((b) => `<span class="badge" title="${b.name}"><i class="fa-solid ${b.icon}"></i></span>`).join("")}</div>` : ""}

      ${window.Gamify ? Gamify.dashboardHTML() : ""}

      <ul class="verdicts">${verdicts.join("")}</ul>

      ${goalCard}

      <div class="card">
        <div class="wk-head"><h3><i class="fa-solid fa-droplet i-cyan"></i> Water</h3><span id="water-amount" class="water-amount">${(this.state.active.waterMl / 1000).toFixed(2)} / ${(targetMl / 1000).toFixed(2)} L</span></div>
        <div class="vessel ${this.state.active.waterMl / targetMl >= 0.9 ? "near" : ""}">
          <div id="water-fill" class="vessel-liquid" style="height:${Math.min(100, (this.state.active.waterMl / targetMl) * 100).toFixed(1)}%"></div>
          <div class="vessel-gloss"></div>
          <div class="vessel-pct">${Math.round(Math.min(100, (this.state.active.waterMl / targetMl) * 100))}%</div>
        </div>
        <div class="chip-row water-chips">
          <button class="chip water-add" data-ml="250">+250</button>
          <button class="chip water-add" data-ml="330">+330</button>
          <button class="chip water-add" data-ml="500">+500</button>
        </div>
        <div class="search-row water-custom">
          <input id="water-custom" type="number" min="1" placeholder="custom ml (e.g. 200)">
          <button id="water-add-custom" class="btn-ghost" style="width:auto">Add</button>
          <button id="water-minus" class="btn-ghost" style="width:auto">−250</button>
          <button id="water-reset" class="btn-ghost" style="width:auto">Reset</button>
        </div>
      </div>

      <div class="card">
        <div class="wk-head"><h3><i class="fa-solid fa-shoe-prints"></i> Steps</h3><span class="burn-pill"><i class="fa-solid fa-fire"></i> ${stepBurn} kcal</span></div>
        <input id="steps-input" class="steps" type="number" min="0" placeholder="Enter today's steps" value="${this.state.active.steps || ""}">
        <p class="muted small">Steps add to your daily max — move more, eat more.</p>
      </div>

      <div class="card">
        <h3><i class="fa-solid fa-moon i-cyan"></i> Sleep & Mood</h3>
        <label>Hours slept<input id="sleep-input" class="steps" type="number" step="0.5" min="0" max="24" placeholder="e.g. 7.5" value="${this.state.active.sleepHours ?? ""}"></label>
        <div class="mood-row"><span class="mood-label">Mood</span><div class="faces" id="mood-faces">${[1, 2, 3, 4, 5].map((n) => `<button class="face ${this.state.active.mood === n ? "sel" : ""}" data-m="${n}" aria-label="Mood ${n}"><i class="fa-solid ${App.MOOD_ICONS[n - 1]}"></i></button>`).join("")}</div></div>
        <div class="mood-row"><span class="mood-label">Energy</span><div class="faces" id="energy-faces">${[1, 2, 3, 4, 5].map((n) => `<button class="face energy ${this.state.active.energy >= n ? "on" : ""}" data-e="${n}" aria-label="Energy ${n}"><i class="fa-solid fa-bolt"></i></button>`).join("")}</div></div>
      </div>

      <div class="card macros-mini">
        <h3>Macros & micros today</h3>
        <div class="macro-row"><span>Carbs</span><span>${Math.round(t.carbs)} / ${p.carbTargetG} g</span></div>
        <div class="macro-row"><span>Fats</span><span>${Math.round(t.fats)} / ${p.fatTargetG} g</span></div>
        <div class="macro-row"><span>Fiber</span><span class="${t.fiber >= (p.fiberTargetG || 25) ? "v-good" : ""}">${Math.round(t.fiber)} / ${p.fiberTargetG || 25} g</span></div>
        <div class="macro-row"><span>Sodium</span><span class="${t.sodium > (p.sodiumMaxMg || 2300) ? "v-bad" : ""}">${Math.round(t.sodium)} / ${p.sodiumMaxMg || 2300} mg</span></div>
        <div class="macro-row"><span>Workout burn</span><span>${this.state.active.exerciseBurn || 0} kcal</span></div>
        <div class="macro-row muted"><span>Base target</span><span>${p.calorieTarget} kcal · TDEE ${p.tdee}</span></div>
      </div>`;

    if (App._islandExpanded) {
      const pill = root.querySelector('.island-pill');
      if (pill) pill.classList.add('expanded');
    }

    document.getElementById("edit-profile").addEventListener("click", () => this.renderProfileForm(true));
    document.getElementById("open-progress").addEventListener("click", () => this.renderProgress());
    document.getElementById("open-reminders").addEventListener("click", () => { if (window.Reminders) Reminders.open(); });
    document.getElementById("adjust-goal").addEventListener("click", () => this.renderCalculator());
    if (window.Gamify) Gamify.bindDashboard();

    // water controls
    document.querySelectorAll(".water-add").forEach((b) =>
      b.addEventListener("click", () => this.addWater(+b.dataset.ml))
    );
    document.getElementById("water-add-custom").addEventListener("click", () => {
      const el = document.getElementById("water-custom");
      const v = +el.value;
      if (v > 0) { this.addWater(v); el.value = ""; }
    });
    document.getElementById("water-minus").addEventListener("click", () => this.setWaterMl(this.state.active.waterMl - 250));
    document.getElementById("water-reset").addEventListener("click", () => this.setWaterMl(0));

    const stepsEl = document.getElementById("steps-input");
    stepsEl.addEventListener("change", (e) => this.setSteps(e.target.value));

    const sleepEl = document.getElementById("sleep-input");
    sleepEl.addEventListener("change", (e) => { this.state.active.sleepHours = e.target.value ? +e.target.value : null; this.save(); });
    document.getElementById("mood-faces").addEventListener("click", (e) => {
      const b = e.target.closest(".face"); if (!b) return;
      this.state.active.mood = +b.dataset.m; this.save();
      document.querySelectorAll("#mood-faces .face").forEach((f) => f.classList.toggle("sel", +f.dataset.m === this.state.active.mood));
    });
    document.getElementById("energy-faces").addEventListener("click", (e) => {
      const b = e.target.closest(".face"); if (!b) return;
      this.state.active.energy = +b.dataset.e; this.save();
      document.querySelectorAll("#energy-faces .face").forEach((f) => f.classList.toggle("on", +f.dataset.e <= this.state.active.energy));
    });

    // Count up the hero calorie number when arriving on the dashboard.
    if (this._heroAnim) {
      this._heroAnim = false;
      this.animateCount(root.querySelector(".remaining-hero .big"), consumed);
    }

    // Spark explosion the first time you reach your calorie target for the day.
    if (consumed >= p.calorieTarget && p.calorieTarget > 0 && !this.state.active._sparkedCal) {
      this.state.active._sparkedCal = true;
      this.save();
      setTimeout(() => this.sparkBurst(), 220);
    }
  },

  /* ---------- "you've come this far" recap ---------- */
  journeyHTML() {
    const ws = (this.state.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const lost = ws.length >= 2 ? +(ws[0].kg - ws[ws.length - 1].kg).toFixed(1) : 0;
    const workouts = (this.state.gamify && this.state.gamify.stats && this.state.gamify.stats.workouts) || 0;
    const days = this.state.history.length;
    const li = window.Gamify ? Gamify.levelInfo(this.state.gamify.xp || 0) : { level: 1 };
    const sleeps = this.state.history.filter((h) => h.sleepHours).map((h) => h.sleepHours);
    if (this.state.active.sleepHours) sleeps.push(this.state.active.sleepHours);
    const avgSleep = sleeps.length ? +(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : null;
    const stat = (big, label) => `<div class="j-stat"><b>${big}</b><span>${label}</span></div>`;
    return `<div class="prog-section journey">
        <h4><i class="fa-solid fa-dumbbell"></i> You've come this far</h4>
        <div class="j-grid">
          ${stat(lost > 0 ? `${lost} kg` : (lost < 0 ? `+${Math.abs(lost)} kg` : "—"), "weight change")}
          ${stat(`<i class="fa-solid fa-fire i-ember"></i> ` + this.state.streak, "day streak")}
          ${stat(workouts, "workouts")}
          ${stat(days, "days tracked")}
          ${stat(`<i class="fa-solid fa-star i-lime"></i> ` + li.level, "level")}
          ${stat(avgSleep ? avgSleep + "h" : "—", "avg sleep")}
        </div>
      </div>`;
  },

  /* ---------- progress / trends modal ---------- */
  renderProgress() {
    const p = this.state.profile;
    const ws = (this.state.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const hist = this.state.history.slice(-14);

    const a = this.adaptiveTDEE();
    const adaptiveCard = a.insufficient
      ? `<div class="prog-stat"><span class="muted small"><i class="fa-solid fa-gear"></i> Adaptive TDEE: ${a.reason}</span></div>`
      : `<div class="prog-stat">
           <div class="prog-stat-main">${a.tdee} <span class="muted">kcal adaptive TDEE</span></div>
           <div class="muted small">vs formula ${a.formula} · ${a.weightChange > 0 ? "+" : ""}${a.weightChange} kg over ${a.spanDays} days (${a.loggedDays} logged)</div>
           <button id="apply-tdee" class="btn-ghost">Apply to my targets</button>
         </div>`;

    const weightVals = ws.map((w) => w.kg);
    const weightChart = ws.length >= 2
      ? `${this.sparkline(weightVals, "var(--lime)")}<div class="chart-cap muted small">${ws[0].kg} → ${ws[ws.length - 1].kg} kg · ${ws.length} weigh-ins</div>`
      : `<p class="muted small">Log your weight regularly to see your trend.</p>`;

    const calItems = hist.map((h) => ({ value: h.kcal, target: h.target || p.calorieTarget }));
    const calChart = calItems.length
      ? `${this.barsChart(calItems)}<div class="chart-cap muted small">Calories vs target · last ${calItems.length} days (line = target)</div>`
      : `<p class="muted small">Your daily history will chart here after a few days.</p>`;

    const proteinDays = this.state.history.slice(-14);
    const proteinHits = proteinDays.filter((h) => h.protein >= p.proteinMinG).length;
    const goalDays = this.state.history.slice(-30);
    const goalHits = goalDays.filter((h) => h.metGoal).length;

    const modal = document.createElement("div");
    modal.id = "progress-modal";
    modal.innerHTML = `
      <div class="ex-modal-card">
        <button class="ex-close" aria-label="close"><i class="fa-solid fa-xmark"></i></button>
        <h3 class="ex-title"><i class="fa-solid fa-chart-line"></i> Progress</h3>

        ${this.journeyHTML()}

        <div class="prog-section">
          <h4>Weigh-in</h4>
          <div class="search-row">
            <input id="weigh-input" type="number" step="0.1" placeholder="Today's weight (kg)" value="${ws.length ? ws[ws.length - 1].kg : p.weightKg}">
            <button id="weigh-log" class="btn-primary" style="width:auto">Log</button>
          </div>
          ${weightChart}
        </div>

        <div class="prog-section">${adaptiveCard}</div>

        <div class="prog-section">
          <h4>Calories vs target</h4>
          ${calChart}
        </div>

        <div class="prog-section">
          <h4>Consistency</h4>
          <div class="prog-grid">
            <div class="prog-pill"><b><i class="fa-solid fa-fire i-ember"></i> ${this.state.streak}</b><span>streak</span></div>
            <div class="prog-pill"><b>${proteinHits}/${proteinDays.length || 0}</b><span>protein (14d)</span></div>
            <div class="prog-pill"><b>${goalHits}/${goalDays.length || 0}</b><span>goal days (30d)</span></div>
          </div>
        </div>

        ${this.sleepMoodSection()}
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("open"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest(".ex-close")) modal.remove();
    });
    modal.querySelector("#weigh-log").addEventListener("click", () => {
      const v = +modal.querySelector("#weigh-input").value;
      if (v > 0) { this.logWeight(v); modal.remove(); this.renderProgress(); this.renderDashboard(); }
    });
    const applyBtn = modal.querySelector("#apply-tdee");
    if (applyBtn) applyBtn.addEventListener("click", () => {
      this.applyAdaptiveTDEE();
      this.celebrateMini("TDEE updated ✓");
      modal.remove();
      this.renderDashboard();
    });
  },

  /* ---------- sleep & mood insights ---------- */
  sleepMoodSection() {
    // Gather history entries that have at least one tracked field.
    const hist = [...this.state.history.slice(-30)];
    // Include today if it has data.
    const a = this.state.active;
    if (a.sleepHours || a.mood || a.energy) {
      hist.push({ date: a.date, sleepHours: a.sleepHours, mood: a.mood, energy: a.energy });
    }

    const withSleep = hist.filter((h) => h.sleepHours != null);
    const withMood  = hist.filter((h) => h.mood  != null);
    const withEnergy = hist.filter((h) => h.energy != null);

    if (!withSleep.length && !withMood.length) {
      return `<div class="prog-section"><h4><i class="fa-solid fa-moon i-cyan"></i> Sleep & Mood</h4><p class="muted small">Log sleep hours and mood on the dashboard to see insights here.</p></div>`;
    }

    // Averages.
    const avg = (arr, fn) => arr.length ? +(arr.reduce((s, h) => s + fn(h), 0) / arr.length).toFixed(1) : null;
    const avgSleep  = avg(withSleep,  (h) => h.sleepHours);
    const avgMood   = avg(withMood,   (h) => h.mood);
    const avgEnergy = avg(withEnergy, (h) => h.energy);

    // Sparkline for sleep (last 14 days).
    const sleepLast14 = withSleep.slice(-14);
    const sleepChart = sleepLast14.length >= 2
      ? this.sparkline(sleepLast14.map((h) => h.sleepHours), "var(--water)")
        + `<div class="chart-cap muted small">Sleep hours · last ${sleepLast14.length} nights</div>`
      : "";

    // Mood icon map (Font Awesome face icons).
    const moodFace = (n) => `<i class="fa-solid ${App.MOOD_ICONS[Math.round(n) - 1] || "fa-face-meh"}"></i>`;
    const energyStr = (n) => `<i class="fa-solid fa-bolt i-ember"></i>`.repeat(Math.round(n));

    // Insight: compare mood on good-sleep days vs poor-sleep days.
    let insight = "";
    if (withSleep.length >= 4 && withMood.length >= 4) {
      const joined = hist.filter((h) => h.sleepHours != null && h.mood != null);
      if (joined.length >= 4) {
        const good = joined.filter((h) => h.sleepHours >= 7);
        const poor = joined.filter((h) => h.sleepHours < 7);
        const moodGood = avg(good, (h) => h.mood);
        const moodPoor = avg(poor, (h) => h.mood);
        if (good.length && poor.length && moodGood !== null && moodPoor !== null) {
          const diff = +(moodGood - moodPoor).toFixed(1);
          if (diff > 0.3) {
            insight = `<div class="insight-pill"><i class="fa-solid fa-lightbulb"></i> On 7+ h sleep days your mood is <b>${moodFace(moodGood)}</b> vs <b>${moodFace(moodPoor)}</b> on shorter nights. Sleep wins!</div>`;
          } else if (diff < -0.3) {
            insight = `<div class="insight-pill"><i class="fa-solid fa-lightbulb"></i> Your mood holds up even on shorter sleep nights — you're resilient!</div>`;
          } else {
            insight = `<div class="insight-pill"><i class="fa-solid fa-lightbulb"></i> Your mood is pretty consistent regardless of sleep length — keep logging to see patterns develop.</div>`;
          }
        }
      }
    }

    const statChip = (icon, val, label) =>
      val != null ? `<div class="prog-pill"><b>${icon} ${val}</b><span>${label}</span></div>` : "";

    return `<div class="prog-section">
      <h4><i class="fa-solid fa-moon i-cyan"></i> Sleep & Mood</h4>
      <div class="prog-grid">
        ${statChip(`<i class="fa-solid fa-bed i-cyan"></i>`, avgSleep ? avgSleep + "h" : null, "avg sleep")}
        ${statChip("", avgMood ? moodFace(avgMood) : null, "avg mood")}
        ${statChip("", avgEnergy ? energyStr(avgEnergy) : null, "avg energy")}
      </div>
      ${sleepChart}
      ${insight}
    </div>`;
  },

  /* ---------- calorie / deficit calculator ---------- */
  PACE: {
    lose: [{ label: "Mild", pct: 0.25 }, { label: "Moderate", pct: 0.5 }, { label: "Aggressive", pct: 0.75 }],
    gain: [{ label: "Lean", pct: 0.125 }, { label: "Moderate", pct: 0.25 }, { label: "Fast", pct: 0.5 }],
  },

  renderCalculator() {
    const p = this.state.profile;
    const w = {
      goalType: p.goalType || "lose",
      ratePct: p.ratePct || null,
      goalWeightKg: p.goalWeightKg || null,
      goalWeeks: p.goalWeeks || null,
      manualKcal: null,
      bodyFatPct: p.bodyFatPct || null,
      neckCm: p.neckCm || null,
      waistCm: p.waistCm || null,
      hipCm: p.hipCm || null,
      targetBodyFat: p.targetBodyFat || null,
    };

    const preview = () => {
      const temp = { ...p, goalType: w.goalType, ratePct: w.ratePct, goalWeeks: w.goalWeeks,
        bodyFatPct: w.bodyFatPct, neckCm: w.neckCm, waistCm: w.waistCm, hipCm: w.hipCm };
      const effBf = this.effectiveBodyFat(temp);
      // implied goal weight from target body-fat % (lean mass held constant)
      let goalW = w.goalWeightKg || null;
      if (!goalW && w.targetBodyFat && effBf != null) {
        const lean = p.weightKg * (1 - effBf / 100);
        goalW = +(lean / (1 - w.targetBodyFat / 100)).toFixed(1);
      }
      temp.goalWeightKg = goalW;
      const t = this.computeTargets(temp);
      let target = t.calorieTarget;
      if (w.goalType !== "maintain" && w.manualKcal) target = w.manualKcal;
      const gap = target - t.tdee; // <0 deficit, >0 surplus
      const weeklyKg = (Math.abs(gap) * 7) / this.KCAL_PER_KG_FAT;
      let eta = null;
      if (w.goalType !== "maintain" && goalW && weeklyKg > 0) {
        const losing = w.goalType === "lose";
        const ok = losing ? goalW < p.weightKg : goalW > p.weightKg;
        if (ok) {
          const weeks = Math.ceil(Math.abs(p.weightKg - goalW) / weeklyKg);
          eta = { weeks, date: this.prettyDate(this.addDays(new Date(), weeks * 7)) };
        }
      }
      const maxSafe = p.weightKg * (w.goalType === "gain" ? 0.005 : 0.01);
      const safe = w.goalType === "maintain" || weeklyKg <= maxSafe + 0.001;
      return { tdee: t.tdee, target, gap, weeklyKg: +weeklyKg.toFixed(2), eta, safe, effBf, bmrMethod: t.bmrMethod, goalW };
    };

    const modal = document.createElement("div");
    modal.id = "calc-modal";
    const gtBtns = ["lose", "maintain", "gain"].map((g) =>
      `<button class="seg ${w.goalType === g ? "active" : ""}" data-gt="${g}">${{ lose: "Lose", maintain: "Maintain", gain: "Gain" }[g]}</button>`
    ).join("");
    modal.innerHTML = `
      <div class="ex-modal-card">
        <button class="ex-close" aria-label="close"><i class="fa-solid fa-xmark"></i></button>
        <h3 class="ex-title"><i class="fa-solid fa-scale-balanced"></i> Calorie Calculator</h3>
        <div class="seg-row">${gtBtns}</div>
        <div id="calc-controls"></div>
        <details class="advanced bodycomp"><summary>Body composition (optional — improves accuracy)</summary>
          <div class="grid-2">
            <label>Body fat %<input id="bc-bf" type="number" step="0.1" placeholder="if known" value="${w.bodyFatPct ?? ""}"></label>
            <label>Target body fat %<input id="bc-tbf" type="number" step="0.1" placeholder="optional" value="${w.targetBodyFat ?? ""}"></label>
            <label>Neck (cm)<input id="bc-neck" type="number" step="0.1" placeholder="for estimate" value="${w.neckCm ?? ""}"></label>
            <label>Waist (cm)<input id="bc-waist" type="number" step="0.1" placeholder="for estimate" value="${w.waistCm ?? ""}"></label>
            <label>Hip (cm, women)<input id="bc-hip" type="number" step="0.1" placeholder="women only" value="${w.hipCm ?? ""}"></label>
          </div>
          <p class="muted small">Body fat % → more accurate TDEE (Katch-McArdle). Neck/Waist(/Hip) → US-Navy estimate. Target body fat % → sets your goal weight.</p>
        </details>
        <div id="calc-readout" class="calc-readout"></div>
        <button id="calc-save" class="btn-primary">Save</button>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("open"));

    const controls = modal.querySelector("#calc-controls");
    const readoutEl = modal.querySelector("#calc-readout");

    const renderControls = () => {
      if (w.goalType === "maintain") { controls.innerHTML = `<p class="muted small">Eat at maintenance — no deficit or surplus.</p>`; return; }
      const paces = this.PACE[w.goalType];
      const verb = w.goalType === "lose" ? "lose" : "gain";
      controls.innerHTML = `
        <h4 class="calc-h">Pace</h4>
        <div class="chip-row">${paces.map((pc) => `<button class="chip pace-btn ${w.ratePct === pc.pct ? "active" : ""}" data-pct="${pc.pct}">${pc.label} (${pc.pct}%/wk)</button>`).join("")}</div>
        <h4 class="calc-h">…or by target</h4>
        <div class="grid-2">
          <label>Goal weight (kg)<input id="calc-gw" type="number" step="0.1" value="${w.goalWeightKg ?? ""}"></label>
          <label>Timeframe
            <select id="calc-weeks">
              <option value="">—</option>
              ${[["4", "1 month"], ["6", "6 weeks"], ["8", "2 months"], ["12", "3 months"], ["16", "4 months"], ["26", "6 months"]].map(([v, l]) => `<option value="${v}" ${String(w.goalWeeks) === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </label>
        </div>
        <h4 class="calc-h">…or set calories directly</h4>
        <label>Target calories/day<input id="calc-manual" type="number" placeholder="e.g. 1900" value="${w.manualKcal ?? ""}"></label>`;
      bindControls();
    };

    const updateReadout = () => {
      const r = preview();
      const gapTxt = w.goalType === "maintain" || Math.abs(r.gap) < 5
        ? "at maintenance"
        : r.gap < 0 ? `${Math.abs(r.gap)} kcal deficit/day` : `+${r.gap} kcal surplus/day`;
      readoutEl.innerHTML = `
        <div class="calc-main">${r.target} <span class="muted">kcal/day</span></div>
        <div class="muted small">TDEE ${r.tdee} · ${gapTxt}</div>
        ${w.goalType !== "maintain" ? `<div class="muted small">~${r.weeklyKg} kg/wk${r.eta ? ` · ${r.eta.weeks} wk → ${r.eta.date}` : ""}</div>` : ""}
        <div class="muted small">${r.effBf != null ? `Body fat ${r.effBf}% · ` : ""}${r.bmrMethod}${r.goalW && !w.goalWeightKg ? ` · goal ≈ ${r.goalW} kg` : ""}</div>
        ${!r.safe ? `<div class="goal-warn"><i class="fa-solid fa-triangle-exclamation"></i> Faster than the safe limit — calories may be capped on save.</div>` : ""}`;
    };

    const bindControls = () => {
      controls.querySelectorAll(".pace-btn").forEach((b) => b.addEventListener("click", () => {
        w.ratePct = +b.dataset.pct; w.goalWeeks = null; w.manualKcal = null;
        renderControls(); updateReadout();
      }));
      const gw = controls.querySelector("#calc-gw"), wk = controls.querySelector("#calc-weeks"), mn = controls.querySelector("#calc-manual");
      if (gw) gw.addEventListener("input", () => { w.goalWeightKg = +gw.value || null; w.manualKcal = null; updateReadout(); });
      if (wk) wk.addEventListener("change", () => { w.goalWeeks = +wk.value || null; w.ratePct = null; w.manualKcal = null; updateReadout(); });
      if (mn) mn.addEventListener("input", () => { w.manualKcal = +mn.value || null; updateReadout(); });
    };

    modal.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
      w.goalType = b.dataset.gt;
      modal.querySelectorAll(".seg").forEach((x) => x.classList.toggle("active", x === b));
      renderControls(); updateReadout();
    }));
    // body-composition inputs (static in markup)
    const bcMap = { "bc-bf": "bodyFatPct", "bc-tbf": "targetBodyFat", "bc-neck": "neckCm", "bc-waist": "waistCm", "bc-hip": "hipCm" };
    Object.keys(bcMap).forEach((id) => {
      const el = modal.querySelector("#" + id);
      if (el) el.addEventListener("input", () => { w[bcMap[id]] = +el.value || null; updateReadout(); });
    });
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".ex-close")) modal.remove(); });
    modal.querySelector("#calc-save").addEventListener("click", () => {
      p.goalType = w.goalType;
      p.ratePct = w.ratePct;
      p.goalWeeks = w.goalWeeks;
      // body composition (optional)
      p.bodyFatPct = w.bodyFatPct || null;
      p.neckCm = w.neckCm || null;
      p.waistCm = w.waistCm || null;
      p.hipCm = w.hipCm || null;
      p.targetBodyFat = w.targetBodyFat || null;
      // goal weight: explicit, else derived from target body-fat %
      if (w.goalWeightKg) {
        p.goalWeightKg = w.goalWeightKg;
      } else if (w.targetBodyFat) {
        const eff = this.effectiveBodyFat(p);
        p.goalWeightKg = eff != null ? +((p.weightKg * (1 - eff / 100)) / (1 - w.targetBodyFat / 100)).toFixed(1) : p.goalWeightKg;
      } else {
        p.goalWeightKg = w.goalWeightKg;
      }
      const t = this.computeTargets(p);
      Object.assign(p, {
        bmr: t.bmr, tdee: t.tdee, calorieTarget: t.calorieTarget, proteinMinG: t.proteinMinG,
        sugarMaxG: t.sugarMaxG, carbTargetG: t.carbTargetG, fatTargetG: t.fatTargetG,
        fiberTargetG: t.fiberTargetG, sodiumMaxMg: t.sodiumMaxMg, waterTargetMl: t.waterTargetMl,
      });
      if (w.goalType !== "maintain" && w.manualKcal) {
        p.calorieTarget = w.manualKcal;
        p.carbTargetG = Math.max(Math.round((p.calorieTarget - p.proteinMinG * 4 - p.fatTargetG * 9) / 4), 0);
      }
      this.save();
      modal.remove();
      this.celebrateMini("Goal updated ✓");
      this.renderDashboard();
    });

    renderControls();
    updateReadout();
  },

  /* ---------- celebration ---------- */
  celebrate(message) {
    const layer = document.createElement("div");
    layer.className = "celebrate";
    const colors = ["#c6f135", "#ff6a2c", "#45d6f0", "#5ce08f", "#ffc24b"];
    let bits = "";
    for (let i = 0; i < 40; i++) {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.3;
      const dur = 1.1 + Math.random() * 0.8;
      const col = colors[i % colors.length];
      const rot = Math.random() * 360;
      bits += `<i style="left:${left}%;background:${col};animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
    }
    layer.innerHTML = `<div class="celebrate-msg">${message}</div>${bits}`;
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2200);
  },

  // Small "added" toast for routine actions (food logged, etc.).
  celebrateMini(message = "Added ✓") {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 1100);
  },

  /* ---------- export / import ---------- */
  dataToolsMarkup() {
    return `
      <div class="data-tools">
        <h3>Backup</h3>
        <button type="button" id="export-btn" class="btn-ghost"><i class="fa-solid fa-download"></i> Export data (JSON)</button>
        <label class="btn-ghost file-label"><i class="fa-solid fa-upload"></i> Import data
          <input type="file" id="import-input" accept="application/json" hidden>
        </label>
        <p class="muted small">Export regularly — clearing browser data wipes localStorage.</p>
      </div>`;
  },

  bindDataTools() {
    document.getElementById("export-btn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `streakfit-backup-${this.todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById("import-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!imported || typeof imported !== "object" || !("profile" in imported))
            throw new Error("Not a StreakFit backup file.");
          this.state = imported;
          this.normalize();
          this.checkRollover();
          this.save();
          alert("Backup imported successfully.");
          this.renderDashboard();
        } catch (err) {
          alert("Import failed: " + err.message);
        }
      };
      reader.readAsText(file);
    });
  },

  /* ---------- tab routing ---------- */
  switchTab(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.getElementById(`view-${name}`).classList.add("active");
    if (name === "dashboard") { this._heroAnim = true; this.renderDashboard(); }
    if (name === "log" && window.renderLogTab) renderLogTab();
    if (name === "workouts" && window.renderWorkoutsTab) renderWorkoutsTab();
    if (name === "social" && window.renderSocialTab) renderSocialTab();
  },

  /* ---------- init ---------- */
  init() {
    this.load();
    this.checkRollover();
    // Register service worker for proper OS notifications on Android PWA.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    if (window.Reminders) Reminders.start();

    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.addEventListener("click", () => this.switchTab(b.dataset.tab))
    );

    if (location.hash.startsWith("#c=") && window.loadSocialFromHash) {
      this.switchTab("social");
      loadSocialFromHash();
    } else {
      this.switchTab("dashboard");
    }

    this._initGyro();
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
