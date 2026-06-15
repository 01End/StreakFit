function importWorkoutPlan(raw) {
  let data;
  try {
    data = JSON.parse(extractPlanJSON(raw));
  } catch (e) {
    throw new Error("Couldn't read that. Paste the workout JSON (a { … } block or an exercises array).");
  }
  
  // Accept a bare array of exercises
  if (Array.isArray(data)) data = { exercises: data };
  
  // Accept a multi-day program structured with a "workouts" array (e.g., Claude's P90X)
  // This extracts the first workout day automatically
  if (!data.exercises && Array.isArray(data.workouts) && data.workouts[0]) {
    data = { 
      title: data.workouts[0].title, 
      exercises: data.workouts[0].exercises 
    };
  }
  
  // Accept an alternate multi-day structure using a "days" array
  if (!data.exercises && Array.isArray(data.days) && data.days[0]) {
    data = { 
      title: data.days[0].title, 
      exercises: data.days[0].exercises 
    };
  }
  
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