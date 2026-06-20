/* StreakFit — Workouts tab.
 * Three ways to train: load a day from the built-in Aggressive Home Cut plan,
 * paste a Claude-generated JSON routine, or keep an existing one. Each exercise
 * has an animated demo + form cues + a rest timer. Checking items credits calories
 * back to the dashboard's daily max.
 */
const SAMPLE_PLAN = `{
  "title": "Push Day",
  "exercises": [
    { "name": "Bench Press", "sets": 4, "reps": 10, "kcal": 60 },
    { "name": "Overhead Press", "sets": 3, "reps": 12, "kcal": 45 },
    { "name": "Incline Dumbbell Press", "sets": 3, "reps": 12 },
    { "name": "Tricep Pushdown", "sets": 3, "reps": 15, "kcal": 30 }
  ]
}`;

function kcalForExercise(met, sets) {
  const kg = (App.state.profile && App.state.profile.weightKg) || 75;
  const perSet = (met * 3.5 * kg) / 200 * 1.5; // ~1.5 min of work per set
  const n = typeof sets === "number" ? sets : 3;
  return Math.round(perSet * n);
}

function recalcExerciseBurn() {
  App.state.active.exerciseBurn = App.state.active.workout
    .filter((e) => e.done)
    .reduce((sum, e) => sum + (+e.kcal || 0), 0);
  App.save();
}

let _selectedPlan = 0; // index into getAllPlans()

// Built-in plans + any imported (custom) plans the user added.
function getAllPlans() {
  return [...BUILTIN_PLANS, ...((App.state && App.state.customPlans) || [])];
}

// Resolve a plan/imported exercise → { name, anim, cues, met, exKey }.
// Delegates to the smart resolver in exercises.js (name-pattern matching + cues).
function resolveExercise(e) {
  return resolveExerciseSpec(e);
}

function exerciseFromSpec(e) {
  const r = resolveExercise(e);
  return {
    name: r.name, sets: e.sets ?? null, reps: e.reps ?? null, rest: e.rest ?? 60,
    kcal: e.kcal != null ? +e.kcal : kcalForExercise(r.met, e.sets),
    done: false, exKey: r.exKey, anim: r.anim, cues: r.cues,
  };
}

function loadPlanDay(planIndex, dayIndex) {
  const plan = getAllPlans()[planIndex];
  if (!plan || !plan.days[dayIndex]) return;
  const day = plan.days[dayIndex];
  App.state.active.workout = day.exercises.map(exerciseFromSpec);
  App.state.active.workoutTitle = day.title;
  App.state.active.workoutAwarded = false; // allow XP for completing this new workout
  recalcExerciseBurn();
  renderWorkoutsTab();
}

// Pull JSON out of whatever Claude pasted: strip ``` fences/prose, take the first
// balanced { … } or [ … ] block.
function extractPlanJSON(raw) {
  let s = (raw || "").trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  const start = s.search(/[\[{]/);
  if (start > 0) s = s.slice(start);
  const lastObj = s.lastIndexOf("}");
  const lastArr = s.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end >= 0) s = s.slice(0, end + 1);
  return s;
}

// Returns { type:"program", name, days } or { type:"day" }.
function importWorkoutPlan(raw) {
  let data;
  try {
    data = JSON.parse(extractPlanJSON(raw));
  } catch (e) {
    throw new Error("Couldn't read that. Paste the workout JSON.");
  }
  if (Array.isArray(data)) data = { exercises: data };

  // Multi-workout program → save as a custom plan you can pick days from.
  const workouts = Array.isArray(data.workouts) ? data.workouts : Array.isArray(data.days) ? data.days : null;
  if (workouts) {
    const days = workouts
      .filter((w) => Array.isArray(w.exercises) && w.exercises.length)
      .map((w) => ({ title: w.title || w.name || "Workout", exercises: w.exercises }));
    if (!days.length) throw new Error("No workouts with exercises found.");
    const name = data.program || data.name || data.title || "Imported plan";
    const subtitle = [data.level, data.duration_weeks ? data.duration_weeks + " weeks" : null].filter(Boolean).join(" · ") || "Imported program";
    if (!App.state.customPlans) App.state.customPlans = [];
    App.state.customPlans.push({ id: "custom_" + Date.now(), name, subtitle, days, custom: true });
    App.save();
    _selectedPlan = getAllPlans().length - 1; // select the newly imported plan
    return { type: "program", name, days: days.length };
  }

  // Single workout → load it as today's workout.
  if (!Array.isArray(data.exercises) || !data.exercises.length) {
    throw new Error('Paste a program ({"program":"…","workouts":[…]}) or a single {"title","exercises":[…]}.');
  }
  App.state.active.workout = data.exercises.map(exerciseFromSpec);
  App.state.active.workoutTitle = data.title || "Workout";
  App.state.active.workoutAwarded = false;
  recalcExerciseBurn();
  return { type: "day" };
}

/* ---------- animated demo + rest timer modal ---------- */
let _restTimer = null;

function openExerciseDemo(item) {
  closeExerciseDemo();
  const anim = item.anim || (typeof guessAnim !== "undefined" ? guessAnim(item.name) : "squat");
  const cueList = (item.cues && item.cues.length && item.cues) || (typeof ANIM_CUES !== "undefined" && ANIM_CUES[anim]) || ["Move with control", "Full range of motion", "Breathe steadily"];
  const cues = cueList.map((c) => `<li>${c}</li>`).join("");
  const rest = item.rest || 60;
  const modal = document.createElement("div");
  modal.id = "ex-modal";
  modal.innerHTML = `
    <div class="ex-modal-card">
      <button class="ex-close" aria-label="close">✕</button>
      <h3 class="ex-title">${item.name}</h3>
      <div class="ex-demo">${exerciseFrames(anim)}</div>
      <div class="ex-meta-row">${item.sets ? `${item.sets} sets` : ""} ${item.reps ? `· ${item.reps}` : ""}</div>
      <h4 class="calc-h">How to do it</h4>
      <ol class="ex-cues">${cues}</ol>
      <div class="rest-timer">
        <div class="rest-display" id="rest-display">${rest}s</div>
        <div class="btn-row">
          <button class="btn-primary" id="rest-start">Start ${rest}s rest</button>
          <button class="btn-ghost" id="rest-reset">Reset</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("open"));

  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest(".ex-close")) closeExerciseDemo();
  });

  const display = modal.querySelector("#rest-display");
  let remaining = rest;
  modal.querySelector("#rest-start").addEventListener("click", (e) => {
    clearInterval(_restTimer);
    remaining = rest;
    display.textContent = `${remaining}s`;
    display.classList.add("running");
    _restTimer = setInterval(() => {
      remaining--;
      display.textContent = remaining > 0 ? `${remaining}s` : "GO! 💪";
      if (remaining <= 0) {
        clearInterval(_restTimer);
        display.classList.remove("running");
        display.classList.add("done");
        if (navigator.vibrate) navigator.vibrate(200);
      }
    }, 1000);
    e.target.textContent = "Restart";
  });
  modal.querySelector("#rest-reset").addEventListener("click", () => {
    clearInterval(_restTimer);
    remaining = rest;
    display.textContent = `${rest}s`;
    display.classList.remove("running", "done");
  });
}

function closeExerciseDemo() {
  clearInterval(_restTimer);
  if (window.stopFigureAnim) stopFigureAnim();
  const m = document.getElementById("ex-modal");
  if (m) m.remove();
}

/* ---------- render ---------- */
function renderWorkoutsTab() {
  const root = document.getElementById("view-workouts");
  const w = App.state.active.workout || [];
  const title = App.state.active.workoutTitle || "Today's Workout";
  const totalBurn = App.state.active.exerciseBurn || 0;
  const allDone = w.length > 0 && w.every((e) => e.done);

  const plans = getAllPlans();
  if (_selectedPlan >= plans.length) _selectedPlan = 0;
  const plan = plans[_selectedPlan] || plans[0];
  const planChips = plans
    .map((pl, i) => `<button class="chip plan-chip ${i === _selectedPlan ? "active" : ""}" data-plan="${i}">${pl.name}${pl.custom ? ' <em class="tag">imported</em>' : ""}</button>`)
    .join("");
  const dayBtns = plan.days
    .map((d, i) => `<button class="day-btn" data-day="${i}">${d.title.split(" — ")[0]}<span>${d.title.split(" — ")[1] || ""}</span></button>`)
    .join("");

  root.innerHTML = `
    <h2>Workouts</h2>

    <div class="card plan-card">
      <h3>🏋️ Choose a plan</h3>
      <div class="chip-row plan-chips">${planChips}</div>
      <p class="muted small">${plan.subtitle}${plan.custom ? ` · <button id="remove-plan" class="link-btn">remove</button>` : ""}</p>
      <div class="day-grid">${dayBtns}</div>
    </div>

    <details class="card paste-card">
      <summary><h3 style="display:inline">📋 Import a plan (JSON)</h3></summary>
      <p class="muted small">Paste a full multi-day program (<code>{"program":"…","workouts":[…]}</code>) to add it to the picker, or a single <code>{"title","exercises":[…]}</code> to load now.</p>
      <textarea id="plan-input" class="plan-input" rows="5" placeholder='{"program":"My Split","workouts":[{"title":"Push","exercises":[{"name":"Push-Up","sets":3,"reps":15}]}]}'></textarea>
      <div class="btn-row">
        <button id="import-plan" class="btn-primary">Import</button>
        <button id="sample-plan" class="btn-ghost">Use sample</button>
      </div>
      <p id="plan-error" class="error"></p>
    </details>

    <div class="card">
      <div class="wk-head">
        <h3>${title}</h3>
        <span class="burn-pill">🔥 ${totalBurn} kcal back</span>
      </div>
      <ul class="checklist">
        ${
          w.length
            ? w
                .map(
                  (e, i) => `
            <li class="check-item ${e.done ? "done" : ""}">
              <label>
                <input type="checkbox" data-i="${i}" ${e.done ? "checked" : ""}>
                <span class="ex-name">${e.name}</span>
              </label>
              <span class="ex-meta">${e.sets ? e.sets + "×" + (e.reps ?? "") : ""}</span>
              <button class="demo-btn" data-i="${i}" aria-label="show demo">▶</button>
            </li>`
                )
                .join("")
            : `<li class="muted">Pick a day above or paste a plan to get started.</li>`
        }
      </ul>
      ${allDone ? `<p class="all-done">✅ Workout complete — ${totalBurn} kcal credited to your day!</p>` : ""}
    </div>`;

  root.querySelector(".plan-chips").addEventListener("click", (e) => {
    const b = e.target.closest(".plan-chip");
    if (b) { _selectedPlan = +b.dataset.plan; renderWorkoutsTab(); }
  });
  root.querySelector(".day-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".day-btn");
    if (btn) loadPlanDay(_selectedPlan, +btn.dataset.day);
  });
  const removeBtn = document.getElementById("remove-plan");
  if (removeBtn) removeBtn.addEventListener("click", () => {
    const customIdx = _selectedPlan - BUILTIN_PLANS.length;
    if (customIdx >= 0) { App.state.customPlans.splice(customIdx, 1); App.save(); }
    _selectedPlan = 0;
    renderWorkoutsTab();
  });

  document.getElementById("import-plan").addEventListener("click", () => {
    const errEl = document.getElementById("plan-error");
    errEl.textContent = "";
    try {
      const res = importWorkoutPlan(document.getElementById("plan-input").value);
      document.getElementById("plan-input").value = "";
      renderWorkoutsTab();
      if (res.type === "program" && App.celebrateMini) App.celebrateMini(`Added "${res.name}" (${res.days} days) ✓`);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
  document.getElementById("sample-plan").addEventListener("click", () => {
    document.getElementById("plan-input").value = SAMPLE_PLAN;
  });

  const checklist = root.querySelector(".checklist");
  checklist.addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox]");
    if (!box) return;
    const i = +box.dataset.i;
    App.state.active.workout[i].done = box.checked;
    recalcExerciseBurn();
    box.closest(".check-item").classList.toggle("done", box.checked);
    const pill = root.querySelector(".burn-pill");
    if (pill) pill.textContent = `🔥 ${App.state.active.exerciseBurn} kcal back`;
    // Celebrate + full re-render only when the whole workout is finished.
    if (App.state.active.workout.every((x) => x.done)) {
      App.celebrate("🏆 Workout complete!");
      if (window.Gamify && !App.state.active.workoutAwarded) {
        App.state.active.workoutAwarded = true;
        Gamify.onWorkout();
      }
      renderWorkoutsTab();
    }
  });
  checklist.addEventListener("click", (e) => {
    const demo = e.target.closest(".demo-btn");
    if (demo) openExerciseDemo(App.state.active.workout[+demo.dataset.i]);
  });
}