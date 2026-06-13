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

  state: null,

  /* ---------- persistence ---------- */
  blankActive(date) {
    return { date, foods: [], waterMl: 0, steps: 0, exerciseBurn: 0, workout: [], workoutTitle: "" };
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

  /* ---------- TDEE / macro engine (goal-timeframe driven) ---------- */
  computeTargets(profile) {
    const { weightKg: kg, heightCm: cm, age, gender, activityLevel } = profile;
    const bmr =
      gender === "female"
        ? 10 * kg + 6.25 * cm - 5 * age - 161
        : 10 * kg + 6.25 * cm - 5 * age + 5;
    const tdee = bmr * (this.ACTIVITY_FACTORS[activityLevel] || 1.2);
    const floor = gender === "female" ? 1200 : 1500;

    // Deficit comes from the goal weight + chosen timeframe, else a default aggressive 750.
    let requestedDeficit = 750;
    if (profile.goalWeightKg && profile.goalWeeks && profile.goalWeightKg < kg) {
      const weeklyKg = (kg - profile.goalWeightKg) / profile.goalWeeks;
      requestedDeficit = Math.round((weeklyKg * this.KCAL_PER_KG_FAT) / 7);
    }
    // Cap so the target never drops below the safe floor.
    const maxDeficit = Math.max(0, Math.round(tdee - floor));
    const appliedDeficit = Math.min(requestedDeficit, maxDeficit);
    const calorieTarget = Math.max(Math.round(tdee - appliedDeficit), floor);

    const proteinMinG = Math.round(2.0 * kg);
    const sugarMaxG = 36;
    const fatTargetG = Math.round(0.8 * kg);
    const remaining = calorieTarget - proteinMinG * 4 - fatTargetG * 9;
    const carbTargetG = Math.max(Math.round(remaining / 4), 0);
    const fiberTargetG = Math.max(25, Math.round((calorieTarget / 1000) * 14)); // ~14 g / 1000 kcal
    const sodiumMaxMg = 2300;
    const waterTargetMl = Math.round(kg * 35);

    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      requestedDeficit,
      appliedDeficit,
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

  /* ---------- goal / weight-loss projection (timeframe-based) ---------- */
  goalProjection() {
    const p = this.state.profile;
    if (!p || !p.goalWeightKg || p.goalWeightKg >= p.weightKg) return null;
    const kgToLose = +(p.weightKg - p.goalWeightKg).toFixed(1);

    // Deficit the plan actually applies (already floor-capped in computeTargets).
    const appliedDeficit = p.tdee - p.calorieTarget;
    const achievableWeeklyKg = (appliedDeficit * 7) / this.KCAL_PER_KG_FAT;
    const achievableWeeks = achievableWeeklyKg > 0 ? Math.ceil(kgToLose / achievableWeeklyKg) : Infinity;

    // What the user asked for (their chosen timeframe), if any.
    const chosenWeeks = p.goalWeeks || achievableWeeks;
    const requestedWeeklyKg = kgToLose / chosenWeeks;
    const maxSafeWeeklyKg = p.weightKg * 0.01; // 1%/week ceiling
    const safe = requestedWeeklyKg <= maxSafeWeeklyKg + 0.001;
    const floored = achievableWeeks > chosenWeeks + 0; // target hit the floor → slower than asked

    const etaWeeks = Math.max(chosenWeeks, achievableWeeks === Infinity ? chosenWeeks : achievableWeeks);
    const target = this.addDays(new Date(), etaWeeks * 7);

    return {
      kgToLose,
      chosenWeeks,
      etaWeeks,
      requestedWeeklyKg: +requestedWeeklyKg.toFixed(2),
      achievableWeeklyKg: +achievableWeeklyKg.toFixed(2),
      maxSafeWeeklyKg: +maxSafeWeeklyKg.toFixed(2),
      safe,
      floored,
      appliedDeficit,
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
      });
      if (this.state.history.length > 365) this.state.history.shift();
      this.state.streak = met ? this.state.streak + 1 : 0;
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
    const filled = Math.floor(ml / 250);
    document.querySelectorAll("#cups .cup").forEach((c, i) => c.classList.toggle("filled", i < filled));
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
        <p class="muted">${isEdit ? "Update your metrics — targets recalculate automatically." : "Enter your metrics to compute your Aggressive Cut targets."}</p>
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
          <label>Goal<input value="Aggressive Cut" disabled></label>
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
        goal: "aggressiveCut",
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
    return `
      <div class="ring-wrap" data-ring="${label}">
        <svg viewBox="0 0 100 100" class="ring">
          <circle cx="50" cy="50" r="${r}" class="ring-bg"></circle>
          <circle cx="50" cy="50" r="${r}" class="ring-fg"
            style="--rc:${color};--c:${c.toFixed(2)};--off:${offset.toFixed(2)}"></circle>
        </svg>
        <div class="ring-center"><span class="ring-val">${valueText}</span><span class="ring-label">${label}</span></div>
      </div>`;
  },

  /* badges earned from current state */
  computeBadges() {
    const p = this.state.profile;
    const t = this.dayTotals();
    const a = this.state.active;
    const out = [];
    const add = (icon, name, earned) => out.push({ icon, name, earned });
    add("🔥", "3-day", this.state.streak >= 3);
    add("⚡", "Week", this.state.streak >= 7);
    add("🏆", "30-day", this.state.streak >= 30);
    add("💪", "Protein", t.protein >= (p?.proteinMinG || 1e9));
    add("💧", "Hydrated", a.waterMl >= (p?.waterTargetMl || 1e9));
    add("✅", "Workout", a.workout.length > 0 && a.workout.every((e) => e.done));
    add("📋", "Logged", a.foods.length > 0);
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

  renderDashboard() {
    const root = document.getElementById("view-dashboard");
    if (!this.state.profile) {
      this.renderProfileForm(false);
      return;
    }
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

    const verdicts = [];
    if (remaining >= 0) verdicts.push(`<li class="v-good">✅ ${remaining} kcal until your max</li>`);
    else verdicts.push(`<li class="v-bad">🚫 ${Math.abs(remaining)} kcal over your max</li>`);
    if (t.protein >= p.proteinMinG)
      verdicts.push(`<li class="v-good">✅ Protein goal met (${Math.round(t.protein)}/${p.proteinMinG} g)</li>`);
    else
      verdicts.push(`<li class="v-warn">⚠️ Protein ${Math.round(p.proteinMinG - t.protein)} g short</li>`);
    if (t.sugar <= p.sugarMaxG)
      verdicts.push(`<li class="v-good">✅ Sugar under cap (${Math.round(t.sugar)}/${p.sugarMaxG} g)</li>`);
    else
      verdicts.push(`<li class="v-bad">🚫 Sugar over by ${Math.round(t.sugar - p.sugarMaxG)} g</li>`);

    const gp = this.goalProjection();
    let goalCard;
    if (gp) {
      const warn = !gp.safe
        ? `<div class="goal-warn">⚠️ That pace (${gp.requestedWeeklyKg} kg/wk) is faster than the safe max of ${gp.maxSafeWeeklyKg} kg/wk — I floored your calories safely, so realistic finish is shown below.</div>`
        : gp.floored
        ? `<div class="goal-warn">ℹ️ Calories floored at the safe minimum, so the realistic finish is a bit later than your chosen date.</div>`
        : "";
      goalCard = `<div class="card goal-card">
           <h3>🎯 Goal</h3>
           <div class="goal-big">${gp.kgToLose} kg <span class="muted">to go</span></div>
           <div class="goal-line">~${gp.etaWeeks} weeks → <strong>${this.prettyDate(gp.target)}</strong></div>
           <div class="muted small">~${gp.achievableWeeklyKg} kg/wk · deficit ${gp.appliedDeficit} kcal/day${gp.chosenWeeks ? ` · target ${gp.chosenWeeks} wk` : ""}</div>
           ${warn}
         </div>`;
    } else {
      goalCard = `<div class="card goal-card muted-card">
           <h3>🎯 Goal</h3>
           <p class="muted small">Set a goal weight + timeframe in your profile to see your projected finish date.</p>
           <button id="set-goal" class="btn-ghost">Set a goal</button>
         </div>`;
    }

    const targetMl = p.waterTargetMl;
    const cupsCount = Math.max(1, Math.round(targetMl / 250));
    const filledCups = Math.floor(this.state.active.waterMl / 250);

    const badges = this.computeBadges();

    root.innerHTML = `
      <header class="dash-head">
        <div class="streak">🔥 <span>${this.state.streak}</span> day streak</div>
        <div class="head-btns">
          <button id="open-progress" class="btn-ghost small">📈</button>
          <button id="edit-profile" class="btn-ghost small">⚙︎</button>
        </div>
      </header>

      <p class="motivation">“${this.dailyMotivation()}”</p>

      <div class="remaining-hero">
        <span class="big" style="color:${calColor === "var(--danger)" ? "var(--danger)" : "inherit"}">${consumed}</span>
        <span class="muted">of ${max} kcal max ${actBurn ? `· +${actBurn} earned` : ""}</span>
        <div class="hero-pill ${remaining >= 0 ? "ok" : "bad"}">${remaining >= 0 ? `${remaining} kcal left` : `${Math.abs(remaining)} over`}</div>
      </div>

      <div class="rings">
        ${this.ring(consumed / max, calColor, `${consumed}`, "kcal")}
        ${this.ring(t.protein / p.proteinMinG, proColor, `${Math.round(t.protein)}`, "protein")}
        ${this.ring(t.sugar / p.sugarMaxG, sugColor, `${Math.round(t.sugar)}`, "sugar")}
        ${this.ring(this.state.active.waterMl / targetMl, "var(--water)", `${(this.state.active.waterMl / 1000).toFixed(1)}L`, "water")}
      </div>

      ${badges.some((b) => b.earned) ? `<div class="badges">${badges.filter((b) => b.earned).map((b) => `<span class="badge" title="${b.name}">${b.icon}</span>`).join("")}</div>` : ""}

      <ul class="verdicts">${verdicts.join("")}</ul>

      ${goalCard}

      <div class="card">
        <div class="wk-head"><h3>💧 Water</h3><span id="water-amount" class="water-amount">${(this.state.active.waterMl / 1000).toFixed(2)} / ${(targetMl / 1000).toFixed(2)} L</span></div>
        <div class="cups" id="cups">
          ${Array.from({ length: cupsCount }, (_, i) => `<button class="cup ${i < filledCups ? "filled" : ""}" data-i="${i}">💧</button>`).join("")}
        </div>
        <div class="btn-row">
          <button id="water-minus" class="btn-ghost">− 250 ml</button>
          <button id="water-plus" class="btn-ghost">+ 250 ml</button>
        </div>
      </div>

      <div class="card">
        <div class="wk-head"><h3>👟 Steps</h3><span class="burn-pill">🔥 ${stepBurn} kcal</span></div>
        <input id="steps-input" class="steps" type="number" min="0" placeholder="Enter today's steps" value="${this.state.active.steps || ""}">
        <p class="muted small">Steps add to your daily max — move more, eat more.</p>
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

    document.getElementById("edit-profile").addEventListener("click", () => this.renderProfileForm(true));
    document.getElementById("open-progress").addEventListener("click", () => this.renderProgress());
    const setGoalBtn = document.getElementById("set-goal");
    if (setGoalBtn) setGoalBtn.addEventListener("click", () => this.renderProfileForm(true));

    // water cups
    document.getElementById("cups").addEventListener("click", (e) => {
      const btn = e.target.closest(".cup");
      if (!btn) return;
      const i = +btn.dataset.i;
      const curCups = Math.floor(this.state.active.waterMl / 250);
      const nextCups = curCups === i + 1 ? i : i + 1;
      btn.classList.remove("pop");
      void btn.offsetWidth;
      btn.classList.add("pop");
      const before = this.state.active.waterMl;
      this.setWaterMl(nextCups * 250);
      if (this.state.active.waterMl >= p.waterTargetMl && before < p.waterTargetMl) this.celebrate("💧 Hydration goal hit!");
    });
    document.getElementById("water-plus").addEventListener("click", () => this.setWaterMl(this.state.active.waterMl + 250));
    document.getElementById("water-minus").addEventListener("click", () => this.setWaterMl(this.state.active.waterMl - 250));

    const stepsEl = document.getElementById("steps-input");
    stepsEl.addEventListener("change", (e) => this.setSteps(e.target.value));
  },

  /* ---------- progress / trends modal ---------- */
  renderProgress() {
    const p = this.state.profile;
    const ws = (this.state.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const hist = this.state.history.slice(-14);

    const a = this.adaptiveTDEE();
    const adaptiveCard = a.insufficient
      ? `<div class="prog-stat"><span class="muted small">⚙️ Adaptive TDEE: ${a.reason}</span></div>`
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
        <button class="ex-close" aria-label="close">✕</button>
        <h3 class="ex-title">📈 Progress</h3>

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
            <div class="prog-pill"><b>🔥 ${this.state.streak}</b><span>streak</span></div>
            <div class="prog-pill"><b>${proteinHits}/${proteinDays.length || 0}</b><span>protein (14d)</span></div>
            <div class="prog-pill"><b>${goalHits}/${goalDays.length || 0}</b><span>goal days (30d)</span></div>
          </div>
        </div>
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
        <button type="button" id="export-btn" class="btn-ghost">⬇︎ Export data (JSON)</button>
        <label class="btn-ghost file-label">⬆︎ Import data
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
    if (name === "dashboard") this.renderDashboard();
    if (name === "log" && window.renderLogTab) renderLogTab();
    if (name === "workouts" && window.renderWorkoutsTab) renderWorkoutsTab();
    if (name === "social" && window.renderSocialTab) renderSocialTab();
  },

  /* ---------- init ---------- */
  init() {
    this.load();
    this.checkRollover();

    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.addEventListener("click", () => this.switchTab(b.dataset.tab))
    );

    if (location.hash.startsWith("#c=") && window.loadSocialFromHash) {
      this.switchTab("social");
      loadSocialFromHash();
    } else {
      this.switchTab("dashboard");
    }
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
