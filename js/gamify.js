/* StreakFit — gamification: XP, levels, achievements, daily quests.
 * Owns App.state.gamify so app.js stays lean. Award hooks are called from the
 * action sites (food log, workout complete, weigh-in, water/protein goals, streak).
 */
const Gamify = {
  XP: { food: 5, photo: 8, workout: 40, weigh: 15, protein: 20, water: 15, steps: 12, streakDay: 10, quest: 25 },

  ACHIEVEMENTS: [
    { id: "first_log", icon: "fa-utensils", name: "First Bite", desc: "Log your first food", test: (s) => s.gamify.stats.foods > 0 || s.active.foods.length > 0 },
    { id: "streak_3", icon: "fa-fire", name: "On Fire", desc: "3-day streak", test: (s) => s.streak >= 3 },
    { id: "streak_7", icon: "fa-bolt", name: "Week Warrior", desc: "7-day streak", test: (s) => s.streak >= 7 },
    { id: "streak_30", icon: "fa-trophy", name: "Unstoppable", desc: "30-day streak", test: (s) => s.streak >= 30 },
    { id: "streak_100", icon: "fa-crown", name: "Centurion", desc: "100-day streak", test: (s) => s.streak >= 100 },
    { id: "protein", icon: "fa-drumstick-bite", name: "Protein Locked", desc: "Hit your protein goal", test: (s, t) => s.profile && t.protein >= s.profile.proteinMinG },
    { id: "hydrated", icon: "fa-droplet", name: "Hydrated", desc: "Reach your water goal", test: (s) => s.profile && s.active.waterMl >= s.profile.waterTargetMl },
    { id: "workout_1", icon: "fa-circle-check", name: "Sweat Started", desc: "Finish a workout", test: (s) => s.gamify.stats.workouts >= 1 },
    { id: "workout_10", icon: "fa-dumbbell", name: "Iron Habit", desc: "Finish 10 workouts", test: (s) => s.gamify.stats.workouts >= 10 },
    { id: "weigh_first", icon: "fa-scale-balanced", name: "Stepped Up", desc: "Log your weight", test: (s) => (s.weights || []).length >= 1 },
    { id: "lost_1", icon: "fa-arrow-trend-down", name: "Down a Kilo", desc: "Lose 1 kg from your start", test: (s) => Gamify.weightLost(s) >= 1 },
    { id: "lost_5", icon: "fa-bullseye", name: "Five Down", desc: "Lose 5 kg from your start", test: (s) => Gamify.weightLost(s) >= 5 },
    { id: "logged_7", icon: "fa-calendar-check", name: "Consistent", desc: "Track 7 days", test: (s) => s.history.length >= 7 },
    { id: "level_5", icon: "fa-star", name: "Level 5", desc: "Reach level 5", test: (s) => Gamify.levelInfo(s.gamify.xp).level >= 5 },
    { id: "level_10", icon: "fa-star-of-life", name: "Level 10", desc: "Reach level 10", test: (s) => Gamify.levelInfo(s.gamify.xp).level >= 10 },
    { id: "photo_log", icon: "fa-camera", name: "Snap & Track", desc: "Log a meal by photo", test: (s) => s.gamify.stats.photos > 0 },
  ],

  QUEST_POOL: [
    { id: "log3", label: "Log 3 foods", test: (s) => s.active.foods.length >= 3 },
    { id: "protein", label: "Hit your protein goal", test: (s, t) => s.profile && t.protein >= s.profile.proteinMinG },
    { id: "water", label: "Reach your water goal", test: (s) => s.profile && s.active.waterMl >= s.profile.waterTargetMl },
    { id: "steps", label: "Walk 8,000 steps", test: (s) => (s.active.steps || 0) >= 8000 },
    { id: "workout", label: "Complete a workout", test: (s) => s.active.workout.length > 0 && s.active.workout.every((e) => e.done) },
    { id: "undercal", label: "Stay under your calorie max", test: (s, t) => s.profile && t.kcal <= s.profile.calorieTarget },
    { id: "logbreak", label: "Log your first meal", test: (s) => s.active.foods.length >= 1 },
  ],

  /* ---------- helpers ---------- */
  _g() {
    const s = App.state;
    if (!s.gamify) s.gamify = { xp: 0, achievements: {}, quests: null };
    if (!s.gamify.stats) s.gamify.stats = { workouts: 0, foods: 0, photos: 0 };
    if (!s.gamify.awardedToday || s.gamify.awardedToday.date !== App.todayStr())
      s.gamify.awardedToday = { date: App.todayStr(), keys: {} };
    return s.gamify;
  },

  weightLost(s) {
    const w = (s.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return w.length >= 2 ? +(w[0].kg - w[w.length - 1].kg).toFixed(1) : 0;
  },

  levelInfo(xp) {
    let level = 1, need = 100, acc = 0;
    while (xp >= acc + need) { acc += need; level++; need = 100 + (level - 1) * 50; }
    return { level, into: xp - acc, span: need, pct: (xp - acc) / need, nextAt: acc + need };
  },

  /* ---------- awarding ---------- */
  award(amount) {
    const g = this._g();
    const before = this.levelInfo(g.xp).level;
    g.xp += amount;
    const after = this.levelInfo(g.xp).level;
    if (after > before && App.celebrate) { App.celebrate(`Level ${after}!`); if (App.sparkBurst) App.sparkBurst(); if (window.App) App.haptic('strong'); }
    App.save();
    this.updateXpBar();
  },
  awardDaily(key, amount) {
    const g = this._g();
    if (g.awardedToday.keys[key]) return;
    g.awardedToday.keys[key] = true;
    this.award(amount);
  },
  onFood() { this._g().stats.foods++; this.award(this.XP.food); if (window.App) App.haptic('light'); },
  onPhoto(n) { const g = this._g(); g.stats.photos++; g.stats.foods += n || 1; this.award(this.XP.photo); },
  onWorkout() { this._g().stats.workouts++; this.award(this.XP.workout); },
  onWeighIn() { this.awardDaily("weigh", this.XP.weigh); },
  onStreakDay() { this.award(this.XP.streakDay); },

  // Called from renderDashboard — awards daily goal XP + refreshes quests/achievements.
  checkDaily(totals) {
    const s = App.state, p = s.profile;
    if (!p) return;
    if (totals.protein >= p.proteinMinG) this.awardDaily("protein", this.XP.protein);
    if (s.active.waterMl >= p.waterTargetMl) this.awardDaily("water", this.XP.water);
    if ((s.active.steps || 0) >= 8000) this.awardDaily("steps", this.XP.steps);
    this.evalQuests(totals);
    this.evalAchievements(totals);
  },

  /* ---------- quests ---------- */
  todaysQuests() {
    const g = this._g();
    const today = App.todayStr();
    if (!g.quests || g.quests.date !== today) {
      const seed = Math.abs(App.hash(today));
      const pool = this.QUEST_POOL.slice();
      const picks = [];
      for (let i = 0; i < 3 && pool.length; i++) picks.push(pool.splice((seed + i * 7) % pool.length, 1)[0]);
      g.quests = { date: today, items: picks.map((q) => ({ id: q.id, label: q.label, done: false })) };
      App.save();
    }
    return g.quests;
  },
  evalQuests(totals) {
    const q = this.todaysQuests();
    q.items.forEach((item) => {
      if (item.done) return;
      const def = this.QUEST_POOL.find((d) => d.id === item.id);
      if (def && def.test(App.state, totals)) {
        item.done = true;
        this.award(this.XP.quest);
        if (App.celebrateMini) App.celebrateMini("Quest done +" + this.XP.quest + " XP");
      }
    });
    App.save();
  },

  /* ---------- achievements ---------- */
  evalAchievements(totals) {
    const g = this._g();
    let newly = null;
    this.ACHIEVEMENTS.forEach((a) => {
      if (!g.achievements[a.id] && a.test(App.state, totals)) {
        g.achievements[a.id] = true;
        newly = a;
      }
    });
    if (newly && App.celebrate) App.celebrate(`${newly.name} unlocked!`);
    App.save();
  },

  /* ---------- dashboard UI ---------- */
  dashboardHTML() {
    const g = this._g();
    const li = this.levelInfo(g.xp);
    const q = this.todaysQuests();
    const earned = Object.keys(g.achievements).length;
    return `
      <div class="card xp-card">
        <div class="xp-head">
          <span class="xp-level"><i class="fa-solid fa-star i-lime"></i> Level ${li.level}</span>
          <button id="open-ach" class="btn-ghost small"><i class="fa-solid fa-medal"></i> ${earned}/${this.ACHIEVEMENTS.length}</button>
        </div>
        <div class="xp-bar"><div class="xp-fill" style="width:${Math.round(li.pct * 100)}%"></div></div>
        <div class="muted small xp-sub">${g.xp} XP · ${li.span - li.into} to next level</div>
        <div class="quests">
          ${q.items.map((i) => `<div class="quest ${i.done ? "done" : ""}"><span class="q-check"><i class="fa-${i.done ? "solid fa-square-check" : "regular fa-square"}"></i></span>${i.label}</div>`).join("")}
        </div>
      </div>`;
  },
  bindDashboard() {
    const btn = document.getElementById("open-ach");
    if (btn) btn.addEventListener("click", () => this.openAchievements());
  },

  openAchievements() {
    const g = this._g();
    const cells = this.ACHIEVEMENTS.map((a) => {
      const got = !!g.achievements[a.id];
      return `<div class="ach ${got ? "got" : "locked"}"><div class="ach-icon"><i class="fa-solid ${got ? a.icon : "fa-lock"}"></i></div><div class="ach-name">${a.name}</div><div class="ach-desc muted small">${a.desc}</div></div>`;
    }).join("");
    const earned = Object.keys(g.achievements).length;
    const modal = document.createElement("div");
    modal.id = "ach-modal";
    modal.innerHTML = `
      <div class="ex-modal-card">
        <button class="ex-close" aria-label="close"><i class="fa-solid fa-xmark"></i></button>
        <h3 class="ex-title"><i class="fa-solid fa-medal"></i> Achievements</h3>
        <p class="muted small">${earned} of ${this.ACHIEVEMENTS.length} unlocked · Level ${this.levelInfo(g.xp).level} · ${g.xp} XP</p>
        <div class="ach-grid">${cells}</div>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".ex-close")) modal.remove(); });
  },

  updateXpBar() {
    const fill = document.querySelector(".xp-fill");
    if (!fill) return;
    const li = this.levelInfo(this._g().xp);
    fill.style.width = `${Math.round(li.pct * 100)}%`;
    const lvl = document.querySelector(".xp-level");
    if (lvl) lvl.innerHTML = `<i class="fa-solid fa-star i-lime"></i> Level ${li.level}`;
    const sub = document.querySelector(".xp-sub");
    if (sub) sub.textContent = `${this._g().xp} XP · ${li.span - li.into} to next level`;
  },
};

// `const` globals don't attach to window — expose explicitly so `window.Gamify` guards work.
window.Gamify = Gamify;
