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

  state: null,

  /* ---------- persistence ---------- */
  blankActive(date) {
    return { date, foods: [], water: 0, steps: 0, exerciseBurn: 0, workout: [] };
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

  // Fill in any missing top-level fields (forward/backward compatibility, imports).
  normalize() {
    if (!this.state.active) this.state.active = this.blankActive(this.todayStr());
    if (!this.state.history) this.state.history = [];
    if (!this.state.customFoods) this.state.customFoods = [];
    if (typeof this.state.streak !== "number") this.state.streak = 0;
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
    // carbs fill whatever calories remain after protein (4 kcal/g) and fat (9 kcal/g)
    const remaining = calorieTarget - proteinMinG * 4 - fatTargetG * 9;
    const carbTargetG = Math.max(Math.round(remaining / 4), 0);

    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      calorieTarget,
      proteinMinG,
      sugarMaxG,
      fatTargetG,
      carbTargetG,
    };
  },

  /* ---------- daily totals ---------- */
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

  metGoal(totals, target) {
    return totals.kcal <= target.calorieTarget && totals.protein >= target.proteinMinG;
  },

  /* ---------- date rollover ---------- */
  checkRollover() {
    const today = this.todayStr();
    const a = this.state.active;
    if (a.date === today) return;

    // Archive the day that just ended (only if a profile existed to judge it).
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
        water: a.water,
        steps: a.steps,
      });
      // Keep history bounded (last 365 days).
      if (this.state.history.length > 365) this.state.history.shift();
      this.state.streak = met ? this.state.streak + 1 : 0;
    }

    this.state.active = this.blankActive(today);
    this.save();
  },

  /* ---------- water & steps ---------- */
  setWater(glasses) {
    this.state.active.water = glasses;
    this.save();
    this.renderDashboard();
  },

  setSteps(steps) {
    this.state.active.steps = Math.max(0, parseInt(steps, 10) || 0);
    this.save();
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
          <label>Weight (kg)<input name="weightKg" type="number" step="0.1" required value="${p.weightKg ?? ""}"></label>
          <label>Height (cm)<input name="heightCm" type="number" step="0.1" required value="${p.heightCm ?? ""}"></label>
          <label>Age<input name="age" type="number" required value="${p.age ?? ""}"></label>
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
        heightCm: +fd.get("heightCm"),
        age: +fd.get("age"),
        gender: fd.get("gender"),
        activityLevel: fd.get("activityLevel"),
        goal: "aggressiveCut",
      };
      const auto = this.computeTargets(base);
      // Honor advanced overrides if present and non-empty.
      const overrideOr = (key) => {
        const v = fd.get(key);
        return v !== null && v !== "" ? +v : auto[key];
      };
      this.state.profile = {
        ...base,
        calorieTarget: overrideOr("calorieTarget"),
        proteinMinG: overrideOr("proteinMinG"),
        sugarMaxG: overrideOr("sugarMaxG"),
        carbTargetG: overrideOr("carbTargetG"),
        fatTargetG: overrideOr("fatTargetG"),
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
      <div class="ring-wrap">
        <svg viewBox="0 0 100 100" class="ring">
          <circle cx="50" cy="50" r="${r}" class="ring-bg"></circle>
          <circle cx="50" cy="50" r="${r}" class="ring-fg"
            style="stroke:${color};stroke-dasharray:${c};stroke-dashoffset:${offset}"></circle>
        </svg>
        <div class="ring-center"><span class="ring-val">${valueText}</span><span class="ring-label">${label}</span></div>
      </div>`;
  },

  renderDashboard() {
    const root = document.getElementById("view-dashboard");
    if (!this.state.profile) {
      this.renderProfileForm(false);
      return;
    }
    const p = this.state.profile;
    const t = this.dayTotals();
    const burn = this.state.active.exerciseBurn || 0;
    const remaining = Math.round(p.calorieTarget - t.kcal + burn);

    const calColor = t.kcal > p.calorieTarget + burn ? "var(--danger)" : "var(--accent)";
    const proColor = t.protein >= p.proteinMinG ? "var(--good)" : "var(--warn)";
    const sugColor = t.sugar > p.sugarMaxG ? "var(--danger)" : "var(--good)";

    const verdicts = [];
    if (remaining >= 0) verdicts.push(`<li class="v-good">✅ ${remaining} kcal left today</li>`);
    else verdicts.push(`<li class="v-bad">🚫 ${Math.abs(remaining)} kcal over target</li>`);
    if (t.protein >= p.proteinMinG)
      verdicts.push(`<li class="v-good">✅ Protein goal met (${Math.round(t.protein)}/${p.proteinMinG} g)</li>`);
    else
      verdicts.push(`<li class="v-warn">⚠️ Protein ${Math.round(p.proteinMinG - t.protein)} g short</li>`);
    if (t.sugar <= p.sugarMaxG)
      verdicts.push(`<li class="v-good">✅ Sugar under cap (${Math.round(t.sugar)}/${p.sugarMaxG} g)</li>`);
    else
      verdicts.push(`<li class="v-bad">🚫 Sugar over by ${Math.round(t.sugar - p.sugarMaxG)} g</li>`);

    root.innerHTML = `
      <header class="dash-head">
        <div class="streak">🔥 <span>${this.state.streak}</span> day streak</div>
        <button id="edit-profile" class="btn-ghost small">⚙︎</button>
      </header>

      <div class="remaining-hero">
        <span class="big">${remaining}</span>
        <span class="muted">kcal remaining ${burn ? `(incl. +${burn} burned)` : ""}</span>
      </div>

      <div class="rings">
        ${this.ring(t.kcal / p.calorieTarget, calColor, `${Math.round(t.kcal)}`, "kcal")}
        ${this.ring(t.protein / p.proteinMinG, proColor, `${Math.round(t.protein)}`, "protein")}
        ${this.ring(t.sugar / p.sugarMaxG, sugColor, `${Math.round(t.sugar)}`, "sugar")}
        ${this.ring(this.state.active.water / 8, "var(--water)", `${this.state.active.water}/8`, "water")}
      </div>

      <ul class="verdicts">${verdicts.join("")}</ul>

      <div class="card">
        <h3>💧 Water</h3>
        <div class="glasses" id="glasses">
          ${Array.from({ length: 8 }, (_, i) =>
            `<button class="glass ${i < this.state.active.water ? "filled" : ""}" data-i="${i}">🥛</button>`
          ).join("")}
        </div>
      </div>

      <div class="card">
        <h3>👟 Steps</h3>
        <input id="steps-input" class="steps" type="number" min="0" placeholder="Enter today's steps"
          value="${this.state.active.steps || ""}">
      </div>

      <div class="card macros-mini">
        <h3>Macros today</h3>
        <div class="macro-row"><span>Carbs</span><span>${Math.round(t.carbs)} / ${p.carbTargetG} g</span></div>
        <div class="macro-row"><span>Fats</span><span>${Math.round(t.fats)} / ${p.fatTargetG} g</span></div>
        <div class="macro-row muted"><span>Target</span><span>${p.calorieTarget} kcal • TDEE-derived</span></div>
      </div>`;

    document.getElementById("edit-profile").addEventListener("click", () => this.renderProfileForm(true));
    document.getElementById("glasses").addEventListener("click", (e) => {
      const btn = e.target.closest(".glass");
      if (!btn) return;
      const i = +btn.dataset.i;
      // Tapping the highest filled glass empties it; otherwise fill up to tapped.
      const next = this.state.active.water === i + 1 ? i : i + 1;
      this.setWater(next);
    });
    const stepsEl = document.getElementById("steps-input");
    stepsEl.addEventListener("change", (e) => this.setSteps(e.target.value));
  },

  /* ---------- export / import (shared markup for profile edit view) ---------- */
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

    // Auto-open a social challenge if the URL carries one.
    if (location.hash.startsWith("#c=") && window.loadSocialFromHash) {
      this.switchTab("social");
      loadSocialFromHash();
    } else {
      this.switchTab("dashboard");
    }
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
