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
    if (typeof s.streak !== "number") s.streak = 0;
    // migrate old 8-glass water → ml (250 ml per glass)
    if (s.active.waterMl == null) s.active.waterMl = (s.active.water || 0) * 250;
    if (s.active.steps == null) s.active.steps = 0;
    if (s.active.exerciseBurn == null) s.active.exerciseBurn = 0;
    if (!s.active.workout) s.active.workout = [];
    // profile defaults for new fields
    if (s.profile) {
      if (s.profile.waterTargetMl == null) s.profile.waterTargetMl = Math.round(s.profile.weightKg * 35);
      if (s.profile.lossRatePct == null) s.profile.lossRatePct = 0.75;
      if (s.profile.goalWeightKg == null) s.profile.goalWeightKg = null;
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

  /* ---------- TDEE / macro engine ---------- */
  computeTargets(profile) {
    const { weightKg: kg, heightCm: cm, age, gender, activityLevel } = profile;
    const bmr =
      gender === "female"
        ? 10 * kg + 6.25 * cm - 5 * age - 161
        : 10 * kg + 6.25 * cm - 5 * age + 5;
    const tdee = bmr * (this.ACTIVITY_FACTORS[activityLevel] || 1.2);
    const floor = gender === "female" ? 1200 : 1500;
    const calorieTarget = Math.max(Math.round(tdee - 750), floor);

    const proteinMinG = Math.round(2.0 * kg);
    const sugarMaxG = 36;
    const fatTargetG = Math.round(0.8 * kg);
    const remaining = calorieTarget - proteinMinG * 4 - fatTargetG * 9;
    const carbTargetG = Math.max(Math.round(remaining / 4), 0);

    const waterTargetMl = Math.round(kg * 35); // ~35 ml per kg bodyweight

    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      calorieTarget,
      proteinMinG,
      sugarMaxG,
      fatTargetG,
      carbTargetG,
      waterTargetMl,
    };
  },

  /* ---------- daily totals & burn ---------- */
  dayTotals() {
    const t = { kcal: 0, protein: 0, carbs: 0, fats: 0, sugar: 0 };
    for (const f of this.state.active.foods) {
      t.kcal += +f.kcal || 0;
      t.protein += +f.protein || 0;
      t.carbs += +f.carbs || 0;
      t.fats += +f.fats || 0;
      t.sugar += +f.sugar || 0;
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

  /* ---------- goal / weight-loss projection ---------- */
  goalProjection() {
    const p = this.state.profile;
    if (!p || !p.goalWeightKg || p.goalWeightKg >= p.weightKg) return null;
    const kgToLose = +(p.weightKg - p.goalWeightKg).toFixed(1);
    const ratePct = p.lossRatePct || 0.75;
    const weeklyKg = p.weightKg * (ratePct / 100);
    const weeks = Math.ceil(kgToLose / weeklyKg);
    const target = this.addDays(new Date(), weeks * 7);
    const dailyDeficit = Math.round((weeklyKg * this.KCAL_PER_KG_FAT) / 7);
    const actualDeficit = p.tdee - p.calorieTarget;
    return { kgToLose, ratePct, weeklyKg: +weeklyKg.toFixed(2), weeks, target, dailyDeficit, actualDeficit };
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
              ? `<details class="advanced"><summary>Advanced: override targets & pace</summary>
                  <label>Loss pace (% bodyweight / week)<input name="lossRatePct" type="number" step="0.05" value="${p.lossRatePct ?? 0.75}"></label>
                  <label>Water target (ml)<input name="waterTargetMl" type="number" value="${p.waterTargetMl ?? ""}"></label>
                  <label>Calorie Target<input name="calorieTarget" type="number" value="${p.calorieTarget ?? ""}"></label>
                  <label>Protein Min (g)<input name="proteinMinG" type="number" value="${p.proteinMinG ?? ""}"></label>
                  <label>Sugar Max (g)<input name="sugarMaxG" type="number" value="${p.sugarMaxG ?? ""}"></label>
                  <label>Carb Target (g)<input name="carbTargetG" type="number" value="${p.carbTargetG ?? ""}"></label>
                  <label>Fat Target (g)<input name="fatTargetG" type="number" value="${p.fatTargetG ?? ""}"></label>
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
        heightCm: +fd.get("heightCm"),
        age: +fd.get("age"),
        gender: fd.get("gender"),
        activityLevel: fd.get("activityLevel"),
        goal: "aggressiveCut",
        lossRatePct: fd.get("lossRatePct") ? +fd.get("lossRatePct") : 0.75,
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
    const goalCard = gp
      ? `<div class="card goal-card">
           <h3>🎯 Goal</h3>
           <div class="goal-big">${gp.kgToLose} kg <span class="muted">to go</span></div>
           <div class="goal-line">~${gp.weeks} weeks → <strong>${this.prettyDate(gp.target)}</strong></div>
           <div class="muted small">Safe pace ${gp.ratePct}%/wk (~${gp.weeklyKg} kg/wk) · current deficit ${gp.actualDeficit} kcal/day</div>
         </div>`
      : `<div class="card goal-card muted-card">
           <h3>🎯 Goal</h3>
           <p class="muted small">Add a goal weight in your profile to see your projected finish date.</p>
           <button id="set-goal" class="btn-ghost">Set a goal weight</button>
         </div>`;

    const targetMl = p.waterTargetMl;
    const cupsCount = Math.max(1, Math.round(targetMl / 250));
    const filledCups = Math.floor(this.state.active.waterMl / 250);

    const badges = this.computeBadges();

    root.innerHTML = `
      <header class="dash-head">
        <div class="streak">🔥 <span>${this.state.streak}</span> day streak</div>
        <button id="edit-profile" class="btn-ghost small">⚙︎</button>
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
        <h3>Macros today</h3>
        <div class="macro-row"><span>Carbs</span><span>${Math.round(t.carbs)} / ${p.carbTargetG} g</span></div>
        <div class="macro-row"><span>Fats</span><span>${Math.round(t.fats)} / ${p.fatTargetG} g</span></div>
        <div class="macro-row"><span>Workout burn</span><span>${this.state.active.exerciseBurn || 0} kcal</span></div>
        <div class="macro-row muted"><span>Base target</span><span>${p.calorieTarget} kcal · TDEE ${p.tdee}</span></div>
      </div>`;

    document.getElementById("edit-profile").addEventListener("click", () => this.renderProfileForm(true));
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
