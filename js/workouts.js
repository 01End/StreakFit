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

let _selectedPlan = 0; // index into BUILTIN_PLANS

function loadPlanDay(planIndex, dayIndex) {
  const day = BUILTIN_PLANS[planIndex].days[dayIndex];
  App.state.active.workout = day.exercises.map((e) => {
    const ex = getExercise(e.key);
    return {
      name: ex.name,
      sets: e.sets,
      reps: e.reps,
      rest: e.rest,
      kcal: kcalForExercise(ex.met, e.sets),
      done: false,
      exKey: e.key,
      anim: ex.anim,
      cues: ex.cues,
    };
  });
  App.state.active.workoutTitle = day.title;
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

function importWorkoutPlan(raw) {
  let data;
  try {
    data = JSON.parse(extractPlanJSON(raw));
  } catch (e) {
    throw new Error("Couldn't read that. Paste the workout JSON (a { … } block or an exercises array).");
  }
  // Accept a bare array of exercises, or { title, exercises }, or { days:[{exercises}] }.
  if (Array.isArray(data)) data = { exercises: data };
  if (!data.exercises && Array.isArray(data.days) && data.days[0]) data = { title: data.days[0].title, exercises: data.days[0].exercises };
  if (!data || !Array.isArray(data.exercises) || data.exercises.length === 0) {
    throw new Error('Need an "exercises" array (e.g. {"title":"Push","exercises":[{"name":"Push-ups","sets":3,"reps":12}]}).');
  }
  App.state.active.workout = data.exercises.map((ex) => {
    // Try to enrich a pasted exercise with a known animation/cues by name.
    const matchKey = Object.keys(EXERCISES).find(
      (k) => EXERCISES[k].name.toLowerCase() === String(ex.name || "").toLowerCase()
    );
    const known = matchKey ? EXERCISES[matchKey] : null;
    return {
      name: String(ex.name || "Exercise"),
      sets: ex.sets ?? null,
      reps: ex.reps ?? null,
      rest: ex.rest ?? 60,
      kcal: ex.kcal != null ? +ex.kcal : kcalForExercise(known ? known.met : 5, ex.sets),
      done: false,
      exKey: matchKey || null,
      anim: known ? known.anim : "squat",
      cues: Array.isArray(ex.cues) ? ex.cues : known ? known.cues : [],
    };
  });
  App.state.active.workoutTitle = data.title || "Workout";
  recalcExerciseBurn();
}

/* ---------- animated demo + rest timer modal ---------- */
let _restTimer = null;

function openExerciseDemo(item) {
  closeExerciseDemo();
  const cues = (item.cues && item.cues.length ? item.cues : ["Move with control", "Full range of motion", "Breathe steadily"])
    .map((c) => `<li>${c}</li>`)
    .join("");
  const rest = item.rest || 60;
  const modal = document.createElement("div");
  modal.id = "ex-modal";
  modal.innerHTML = `
    <div class="ex-modal-card">
      <button class="ex-close" aria-label="close">✕</button>
      <h3 class="ex-title">${item.name}</h3>
      <div class="ex-demo">${exerciseFigure(item.anim || "squat")}</div>
      <div class="ex-meta-row">${item.sets ? `${item.sets} sets` : ""} ${item.reps ? `· ${item.reps}` : ""}</div>
      <ul class="ex-cues">${cues}</ul>
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

  const fig = modal.querySelector(".ex-fig");
  if (fig && window.startFigureAnim) startFigureAnim(fig);

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

  const plan = BUILTIN_PLANS[_selectedPlan] || BUILTIN_PLANS[0];
  const planChips = BUILTIN_PLANS
    .map((pl, i) => `<button class="chip plan-chip ${i === _selectedPlan ? "active" : ""}" data-plan="${i}">${pl.name}</button>`)
    .join("");
  const dayBtns = plan.days
    .map((d, i) => `<button class="day-btn" data-day="${i}">${d.title.split(" — ")[0]}<span>${d.title.split(" — ")[1] || ""}</span></button>`)
    .join("");

  root.innerHTML = `
    <h2>Workouts</h2>

    <div class="card plan-card">
      <h3>🏋️ Choose a plan</h3>
      <div class="chip-row plan-chips">${planChips}</div>
      <p class="muted small">${plan.subtitle}</p>
      <div class="day-grid">${dayBtns}</div>
    </div>

    <details class="card paste-card">
      <summary><h3 style="display:inline">📋 Paste a Claude Plan</h3></summary>
      <p class="muted small">Ask Claude for a routine as JSON, paste it here, tick exercises off.</p>
      <textarea id="plan-input" class="plan-input" rows="5" placeholder='{"title":"Push Day","exercises":[...]}'></textarea>
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

  document.getElementById("import-plan").addEventListener("click", () => {
    const errEl = document.getElementById("plan-error");
    errEl.textContent = "";
    try {
      importWorkoutPlan(document.getElementById("plan-input").value);
      renderWorkoutsTab();
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