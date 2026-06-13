/* StreakFit — Workouts tab: import a Claude-generated JSON routine, render it as an
 * interactive checklist, and feed checked-off calories into App.state.active.exerciseBurn.
 *
 * Expected JSON shape:
 *   { "title": "Push Day",
 *     "exercises": [ { "name": "Bench Press", "sets": 4, "reps": 10, "kcal": 60 } ] }
 * If "kcal" is omitted it's estimated from a default MET and bodyweight.
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

function estimateExerciseKcal(ex) {
  // Rough fallback: MET 5 for ~6 min of work per exercise.
  const kg = (App.state.profile && App.state.profile.weightKg) || 75;
  const met = 5;
  const minutes = 6;
  return Math.round((met * 3.5 * kg) / 200 * minutes);
}

function recalcExerciseBurn() {
  const burn = App.state.active.workout
    .filter((e) => e.done)
    .reduce((sum, e) => sum + (+e.kcal || 0), 0);
  App.state.active.exerciseBurn = burn;
  App.save();
}

function importWorkoutPlan(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error("That's not valid JSON. Paste the full { … } block.");
  }
  if (!data || !Array.isArray(data.exercises) || data.exercises.length === 0) {
    throw new Error('JSON must have an "exercises" array.');
  }
  App.state.active.workout = data.exercises.map((ex) => ({
    name: String(ex.name || "Exercise"),
    sets: ex.sets ?? null,
    reps: ex.reps ?? null,
    kcal: ex.kcal != null ? +ex.kcal : estimateExerciseKcal(ex),
    done: false,
  }));
  App.state.active.workoutTitle = data.title || "Workout";
  recalcExerciseBurn();
}

function renderWorkoutsTab() {
  const root = document.getElementById("view-workouts");
  const w = App.state.active.workout || [];
  const title = App.state.active.workoutTitle || "Today's Workout";
  const totalBurn = App.state.active.exerciseBurn || 0;

  root.innerHTML = `
    <h2>Workouts</h2>

    <div class="card">
      <h3>📋 Paste Claude Plan</h3>
      <p class="muted small">Ask Claude for a routine as JSON, paste it here, and tick exercises off.</p>
      <textarea id="plan-input" class="plan-input" rows="6" placeholder='{"title":"Push Day","exercises":[...]}'></textarea>
      <div class="btn-row">
        <button id="import-plan" class="btn-primary">Import Plan</button>
        <button id="sample-plan" class="btn-ghost">Use sample</button>
      </div>
      <p id="plan-error" class="error"></p>
    </div>

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
                <span class="ex-meta">${e.sets ? e.sets + "×" + (e.reps ?? "") : ""} · ${e.kcal} kcal</span>
              </label>
            </li>`
                )
                .join("")
            : `<li class="muted">No plan loaded. Paste one above.</li>`
        }
      </ul>
    </div>`;

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

  root.querySelector(".checklist").addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox]");
    if (!box) return;
    App.state.active.workout[+box.dataset.i].done = box.checked;
    recalcExerciseBurn();
    // Targeted update: toggle the item + refresh the burn pill, no full re-render.
    box.closest(".check-item").classList.toggle("done", box.checked);
    const pill = root.querySelector(".burn-pill");
    if (pill) pill.textContent = `🔥 ${App.state.active.exerciseBurn} kcal back`;
  });
}
