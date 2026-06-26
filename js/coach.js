/* StreakFit — Coach math engine.
 * Provides: what-if simulator, reverse planner, and rule-based insight engine.
 * Reads App.state and App.computeTargets() for live data — no separate state.
 */
const Coach = {

  /* ---- What-if simulator ----
   * Given params, returns projection (weeks to goal, kg/week, goal date, safe flag).
   * Works without a saved profile — used for new-user onboarding.
   */
  simulate({ weightKg, goalKg, dailyKcal, tdee, workoutsPerWeek = 0 }) {
    const isLoss = goalKg < weightKg;
    const burnsPerWorkout = 300;
    const totalBurn = tdee + (workoutsPerWeek * burnsPerWorkout / 7);
    const dailyDelta = isLoss ? totalBurn - dailyKcal : dailyKcal - totalBurn;
    if (dailyDelta <= 0) return { weeks: Infinity, kgPerWeek: 0, goalDate: null, safe: true, warning: 'Calorie setting will not produce change toward goal.' };

    const totalKg = Math.abs(goalKg - weightKg);
    if (totalKg === 0) return { weeks: 0, weeksRounded: 0, kgPerWeek: 0, goalDate: new Date(), goalDateStr: 'Already at goal', safe: true, warning: null };
    const totalKcal = totalKg * 7700;
    const weeks = totalKcal / (dailyDelta * 7);
    const kgPerWeek = totalKg / weeks;
    const goalDate = new Date(Date.now() + weeks * 7 * 86400000);
    const safe = kgPerWeek <= 1;

    return {
      weeks: +weeks.toFixed(1),
      weeksRounded: Math.ceil(weeks),
      kgPerWeek: +kgPerWeek.toFixed(2),
      goalDate,
      goalDateStr: goalDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
      safe,
      warning: !safe ? `${kgPerWeek.toFixed(1)} kg/week is faster than the safe maximum of 1 kg/week. Increase calories for a sustainable pace.` : null,
    };
  },

  /* ---- Reverse planner ----
   * Given current weight, goal weight, and a deadline date string (ISO), returns required daily params.
   */
  reversePlan({ weightKg, goalKg, deadline, tdee }) {
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) return { error: 'Invalid deadline date.' };
    const days = (deadlineDate - Date.now()) / 86400000;
    if (days <= 0) return { error: 'Deadline is in the past.' };
    const weeks = days / 7;
    const totalKg = Math.abs(goalKg - weightKg);
    const totalKcal = totalKg * 7700;
    const requiredDailyDeficit = totalKcal / days;
    const requiredDailyKcal = Math.round(tdee - requiredDailyDeficit);
    const kgPerWeek = totalKg / weeks;
    const safe = kgPerWeek <= 1;
    const floor = 1200;
    return {
      dailyKcal: Math.max(requiredDailyKcal, floor),
      floored: requiredDailyKcal < floor,
      kgPerWeek: +kgPerWeek.toFixed(2),
      deficit: Math.round(requiredDailyDeficit),
      weeks: +weeks.toFixed(1),
      safe,
      warning: !safe
        ? `This requires losing ${kgPerWeek.toFixed(1)} kg/week — not sustainable. Move the deadline or adjust your goal.`
        : null,
    };
  },

  /* ---- Insight rule engine ----
   * Returns array of { icon, color, title, body, cta, ctaAction } objects.
   */
  insights() {
    if (!App.state.profile) return [];
    const t = App.dayTotals();
    const p = App.state.profile;
    const max = App.dailyMax();
    const consumed = Math.round(t.kcal);
    const result = [];
    const h = new Date().getHours();

    // 1. Calorie status + projection
    const gp = App.goalProjection();
    if (gp && gp.etaWeeks) {
      const deficit = max - consumed;
      const onTrack = deficit >= 0 && deficit <= max * 0.15;
      result.push({
        icon: 'fa-solid fa-chart-line',
        color: onTrack ? 'var(--aqua)' : 'var(--gold)',
        title: onTrack ? 'On track' : 'Slight adjustment needed',
        body: `At this pace you reach ${p.goalWeightKg ? p.goalWeightKg + ' kg' : 'your goal'} in ${gp.etaWeeks} weeks (~${gp.achievableWeeklyKg} kg/week).`,
        cta: null,
      });
    }

    // 2. Protein gap
    const proteinGap = Math.round(p.proteinMinG - t.protein);
    if (proteinGap > 10) {
      result.push({
        icon: 'fa-solid fa-drumstick-bite',
        color: 'var(--aqua)',
        title: `Protein ${proteinGap}g short`,
        body: `You need ${proteinGap}g more protein today. A chicken breast (150g) has ~45g.`,
        cta: 'Log protein',
        ctaAction: "App.switchTab('log')",
      });
    }

    // 3. Hydration reminder after 3pm if water < 60%
    if (h >= 15 && App.state.active.waterMl < p.waterTargetMl * 0.6) {
      const mlLeft = p.waterTargetMl - App.state.active.waterMl;
      result.push({
        icon: 'fa-solid fa-droplet',
        color: 'var(--violet)',
        title: 'Stay hydrated',
        body: `You've had ${(App.state.active.waterMl/1000).toFixed(1)}L — ${(mlLeft/1000).toFixed(1)}L left to reach your daily target.`,
        cta: null,
      });
    }

    // 4. Streak momentum
    if (App.state.streak >= 3) {
      result.push({
        icon: 'fa-solid fa-fire',
        color: 'var(--flame)',
        title: `${App.state.streak}-day streak`,
        body: `You've been consistent for ${App.state.streak} days. Research shows habits lock in around 21 days.`,
        cta: null,
      });
    }

    // 5. Under-eating warning (less than 80% of target by 8pm)
    if (h >= 20 && consumed < max * 0.8) {
      result.push({
        icon: 'fa-solid fa-triangle-exclamation',
        color: 'var(--gold)',
        title: 'Eating too little',
        body: `Only ${consumed} of ${max} kcal logged by ${h}:00. Severe deficit slows metabolism and loses muscle.`,
        cta: 'Log a meal',
        ctaAction: "App.switchTab('log')",
      });
    }

    // Default if no insights
    if (result.length === 0) {
      result.push({
        icon: 'fa-solid fa-circle-check',
        color: 'var(--good)',
        title: 'All systems go',
        body: 'Log your meals to unlock personalized coaching insights.',
        cta: 'Log food',
        ctaAction: "App.switchTab('log')",
      });
    }

    return result;
  },

  /* ---- Tab renderer ---- */
  renderTab() {
    const root = document.getElementById('view-coach');
    if (!root) return;
    const mode = Coach._mode || 'insights';
    const p = App.state.profile;
    const tdee = p ? (p.tdee || 2000) : 2000;

    const modeHtml = (id, label, active) =>
      `<button class="coach-mode-pill${active?' active':''}" onclick="Coach._mode='${id}';Coach.renderTab()">${label}</button>`;

    const pillsHtml = `<div class="coach-mode-pills">
      ${modeHtml('insights','Insights',  mode==='insights')}
      ${modeHtml('simulator','What-If',  mode==='simulator')}
      ${modeHtml('planner',  'Planner',  mode==='planner')}
    </div>`;

    let contentHtml = '';

    if (mode === 'insights') {
      const items = Coach.insights();
      contentHtml = items.map(i => `
        <div class="card coach-insight-card">
          <div class="coach-insight-icon" style="color:${i.color}"><i class="${i.icon}"></i></div>
          <div class="coach-insight-body">
            <div class="coach-insight-title" style="color:${i.color}">${i.title}</div>
            <div class="coach-insight-text">${i.body}</div>
            ${i.cta ? `<div class="coach-insight-cta" onclick="${i.ctaAction}">${i.cta}</div>` : ''}
          </div>
        </div>`).join('');
      contentHtml += `<button class="btn-ghost" style="width:100%;margin-top:8px;touch-action:manipulation" onclick="App.renderCalculator()"><i class="fa-solid fa-bullseye"></i> Adjust Goals</button>`;

    } else if (mode === 'simulator') {
      const wkg   = p ? p.weightKg   : 80;
      const gkg   = p ? (p.goalWeightKg || wkg - 10) : 70;
      const kcal0 = Coach._simKcal !== undefined ? Coach._simKcal : (p ? p.calorieTarget : 1800);
      const wk0   = Coach._simWk   !== undefined ? Coach._simWk   : 3;
      const sim = Coach.simulate({ weightKg: wkg, goalKg: gkg, dailyKcal: kcal0, tdee, workoutsPerWeek: wk0 });
      const weeksDisp = isFinite(sim.weeks) ? sim.weeksRounded : '∞';
      const dateDisp  = sim.goalDate ? sim.goalDateStr : '—';
      contentHtml = `
        <div class="card coach-result-card" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;padding:20px">
          <div>
            <div class="coach-result-big" style="color:var(--flame)">${weeksDisp}</div>
            <div class="coach-result-lbl">weeks to goal</div>
          </div>
          <div>
            <div class="coach-result-big" style="color:var(--aqua)">${sim.kgPerWeek}</div>
            <div class="coach-result-lbl">kg/week</div>
          </div>
          <div style="grid-column:span 2;font-size:13px;color:rgba(255,255,255,0.55);margin-top:4px">Goal: ${dateDisp}</div>
        </div>
        ${sim.warning ? `<div class="card" style="border-color:rgba(255,200,0,0.3);color:var(--gold);font-size:12px;padding:12px"><i class="fa-solid fa-triangle-exclamation"></i> ${sim.warning}</div>` : ''}
        <div class="card" style="padding:16px">
          <div class="coach-slider-row">
            <label>Daily calories <span id="sim-kcal-val">${kcal0}</span> kcal</label>
            <input type="range" id="sim-kcal" min="800" max="3500" step="50" value="${kcal0}"
              oninput="document.getElementById('sim-kcal-val').textContent=this.value;Coach._simKcal=+this.value;Coach.renderTab()">
          </div>
          <div class="coach-slider-row">
            <label>Workouts/week <span id="sim-wk-val">${wk0}</span></label>
            <input type="range" id="sim-wk" min="0" max="7" step="1" value="${wk0}"
              oninput="document.getElementById('sim-wk-val').textContent=this.value;Coach._simWk=+this.value;Coach.renderTab()">
          </div>
        </div>`;

    } else if (mode === 'planner') {
      const wkg = p ? p.weightKg : 80;
      const gkg = p ? (p.goalWeightKg || wkg - 10) : 70;
      const defaultDeadline = new Date(Date.now() + 90*86400000).toISOString().slice(0,10);
      const deadline = Coach._plannerDeadline || defaultDeadline;
      const plan = Coach.reversePlan({ weightKg: wkg, goalKg: gkg, deadline, tdee });
      contentHtml = `
        <div class="card" style="padding:16px">
          <div class="coach-slider-row">
            <label>Target date</label>
            <input type="date" value="${deadline}" min="${new Date().toISOString().slice(0,10)}"
              style="background:rgba(255,255,255,0.07);border:0.5px solid rgba(255,255,255,0.2);border-radius:10px;padding:8px 12px;color:#fff;font-size:14px;width:100%"
              onchange="Coach._plannerDeadline=this.value;Coach.renderTab()">
          </div>
        </div>
        ${plan.error ? `<div class="card" style="color:var(--danger);font-size:13px">${plan.error}</div>` : `
        <div class="card coach-result-card" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px">
          <div>
            <div class="coach-result-big" style="color:var(--flame)">${plan.dailyKcal}</div>
            <div class="coach-result-lbl">kcal/day</div>
          </div>
          <div>
            <div class="coach-result-big" style="color:var(--aqua)">${plan.kgPerWeek}</div>
            <div class="coach-result-lbl">kg/week</div>
          </div>
          <div style="grid-column:span 2;font-size:12px;color:rgba(255,255,255,0.5)">
            ${plan.floored ? '<i class="fa-solid fa-triangle-exclamation" style="color:var(--gold)"></i> Calories floored at safe minimum. ' : ''}
            ~${Math.ceil(plan.weeks)} weeks · ${Math.round(plan.deficit)} kcal/day deficit
          </div>
        </div>
        ${plan.warning ? `<div class="card" style="border-color:rgba(255,50,50,0.3);color:var(--danger);font-size:12px;padding:12px"><i class="fa-solid fa-triangle-exclamation"></i> ${plan.warning}</div>` : ''}
        <button class="btn-primary" onclick="Coach._applyPlan(${plan.dailyKcal})">Apply this plan</button>`}`;
    }

    root.innerHTML = `<div style="padding:0 0 24px">
      <div class="coach-tab-head">
        <div style="font-size:22px;font-weight:900;letter-spacing:-0.04em">Your Coach</div>
        <button class="btn-ghost small" style="touch-action:manipulation" onclick="App.openSettings()" aria-label="Settings">
          <i class="fa-solid fa-gear"></i> Settings
        </button>
      </div>
      ${pillsHtml}
      ${contentHtml}
      <div id="measurements-section" style="margin-top:20px"></div>
    </div>`;
    if (window.Measurements) Measurements.renderSection('measurements-section');
  },

  _applyPlan(kcal) {
    if (!App.state.profile) return;
    App.state.profile.calorieTarget = kcal;
    const t = App.computeTargets(App.state.profile);
    App.state.profile = { ...App.state.profile, ...t };
    App.save();
    App.haptic('medium');
    Coach._mode = 'insights';
    Coach.renderTab();
  },
};
// `const` does not set window properties — expose explicitly so app.js guards work
window.Coach = Coach;
