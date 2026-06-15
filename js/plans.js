/* StreakFit — built-in training plans (a library to choose from).
 * Each plan: { id, name, subtitle, days:[{ title, exercises:[{key,sets,reps,rest}] }] }
 * `key` references an exercise in EXERCISES (js/exercises.js).
 */
const BUILTIN_PLANS = [
  {
    id: "aggressive_home_cut",
    name: "Aggressive Home Cut",
    subtitle: "6-day PPL · dumbbell + pull-up bar + bodyweight",
    days: [
      { title: "Day 1 — Push (Chest / Shoulders / Triceps)", exercises: [
        { key: "pushup", sets: 4, reps: "12–20", rest: 60 },
        { key: "floor_press", sets: 4, reps: "10–12", rest: 75 },
        { key: "ohp", sets: 3, reps: "10–12", rest: 75 },
        { key: "lateral_raise", sets: 3, reps: "15", rest: 45 },
        { key: "diamond_pushup", sets: 3, reps: "AMRAP", rest: 60 },
        { key: "burpee", sets: 3, reps: "10", rest: 45 },
      ] },
      { title: "Day 2 — Pull (Back / Biceps)", exercises: [
        { key: "pull_up", sets: 4, reps: "AMRAP", rest: 90 },
        { key: "bent_row", sets: 4, reps: "10–12", rest: 75 },
        { key: "single_row", sets: 3, reps: "12 / side", rest: 60 },
        { key: "db_curl", sets: 3, reps: "12", rest: 45 },
        { key: "hammer_curl", sets: 3, reps: "12", rest: 45 },
        { key: "dead_hang", sets: 3, reps: "30–45 s", rest: 45 },
      ] },
      { title: "Day 3 — Legs (Quads / Glutes / Hamstrings)", exercises: [
        { key: "goblet_squat", sets: 4, reps: "12–15", rest: 75 },
        { key: "reverse_lunge", sets: 3, reps: "12 / leg", rest: 60 },
        { key: "rdl", sets: 4, reps: "12", rest: 75 },
        { key: "glute_bridge", sets: 3, reps: "15", rest: 45 },
        { key: "calf_raise", sets: 4, reps: "20", rest: 30 },
        { key: "wall_sit", sets: 3, reps: "45 s", rest: 45 },
      ] },
      { title: "Day 4 — Push 2 (Strength focus)", exercises: [
        { key: "floor_press", sets: 5, reps: "8–10", rest: 90 },
        { key: "ohp", sets: 4, reps: "8–10", rest: 90 },
        { key: "pushup", sets: 3, reps: "AMRAP", rest: 60 },
        { key: "lateral_raise", sets: 4, reps: "15", rest: 45 },
        { key: "diamond_pushup", sets: 3, reps: "12", rest: 60 },
      ] },
      { title: "Day 5 — Pull 2 (Strength focus)", exercises: [
        { key: "pull_up", sets: 5, reps: "AMRAP", rest: 120 },
        { key: "bent_row", sets: 5, reps: "8–10", rest: 90 },
        { key: "single_row", sets: 3, reps: "10 / side", rest: 60 },
        { key: "hammer_curl", sets: 4, reps: "10", rest: 45 },
        { key: "dead_hang", sets: 3, reps: "Max", rest: 60 },
      ] },
      { title: "Day 6 — Conditioning / Core (HIIT)", exercises: [
        { key: "burpee", sets: 4, reps: "12", rest: 40 },
        { key: "high_knees", sets: 4, reps: "40 s", rest: 30 },
        { key: "mountain_climber", sets: 4, reps: "40 s", rest: 30 },
        { key: "jumping_jack", sets: 4, reps: "45 s", rest: 30 },
        { key: "plank", sets: 3, reps: "45–60 s", rest: 30 },
        { key: "bicycle_crunch", sets: 3, reps: "20 / side", rest: 30 },
      ] },
    ],
  },
  {
    id: "bodyweight_only",
    name: "Bodyweight Only",
    subtitle: "3-day · zero equipment, anywhere",
    days: [
      { title: "Day 1 — Upper / Push", exercises: [
        { key: "pushup", sets: 4, reps: "12–20", rest: 60 },
        { key: "diamond_pushup", sets: 3, reps: "AMRAP", rest: 60 },
        { key: "plank", sets: 3, reps: "45–60 s", rest: 45 },
        { key: "burpee", sets: 3, reps: "12", rest: 45 },
      ] },
      { title: "Day 2 — Lower", exercises: [
        { key: "bw_squat", sets: 4, reps: "20", rest: 60 },
        { key: "reverse_lunge", sets: 3, reps: "12 / leg", rest: 60 },
        { key: "glute_bridge", sets: 3, reps: "20", rest: 45 },
        { key: "calf_raise", sets: 4, reps: "25", rest: 30 },
        { key: "wall_sit", sets: 3, reps: "60 s", rest: 45 },
      ] },
      { title: "Day 3 — Full Body / HIIT", exercises: [
        { key: "burpee", sets: 4, reps: "12", rest: 40 },
        { key: "high_knees", sets: 4, reps: "40 s", rest: 30 },
        { key: "mountain_climber", sets: 4, reps: "40 s", rest: 30 },
        { key: "jumping_jack", sets: 4, reps: "45 s", rest: 30 },
        { key: "bicycle_crunch", sets: 3, reps: "20 / side", rest: 30 },
        { key: "plank", sets: 3, reps: "60 s", rest: 30 },
      ] },
    ],
  },
  {
    id: "dumbbell_4day",
    name: "Dumbbell Only",
    subtitle: "4-day · just a pair of dumbbells",
    days: [
      { title: "Day 1 — Push", exercises: [
        { key: "floor_press", sets: 4, reps: "10–12", rest: 75 },
        { key: "ohp", sets: 4, reps: "10–12", rest: 75 },
        { key: "lateral_raise", sets: 3, reps: "15", rest: 45 },
        { key: "pushup", sets: 3, reps: "AMRAP", rest: 60 },
      ] },
      { title: "Day 2 — Pull", exercises: [
        { key: "bent_row", sets: 4, reps: "10–12", rest: 75 },
        { key: "single_row", sets: 3, reps: "12 / side", rest: 60 },
        { key: "db_curl", sets: 3, reps: "12", rest: 45 },
        { key: "hammer_curl", sets: 3, reps: "12", rest: 45 },
      ] },
      { title: "Day 3 — Legs", exercises: [
        { key: "goblet_squat", sets: 4, reps: "12–15", rest: 75 },
        { key: "reverse_lunge", sets: 3, reps: "12 / leg", rest: 60 },
        { key: "rdl", sets: 4, reps: "12", rest: 75 },
        { key: "calf_raise", sets: 4, reps: "20", rest: 30 },
      ] },
      { title: "Day 4 — Full Body", exercises: [
        { key: "goblet_squat", sets: 3, reps: "15", rest: 60 },
        { key: "floor_press", sets: 3, reps: "12", rest: 60 },
        { key: "bent_row", sets: 3, reps: "12", rest: 60 },
        { key: "burpee", sets: 3, reps: "12", rest: 45 },
      ] },
    ],
  },
  {
    id: "fullbody_3day",
    name: "Full-Body 3-Day",
    subtitle: "3-day · efficient, hits everything",
    days: [
      { title: "Day A", exercises: [
        { key: "goblet_squat", sets: 4, reps: "12", rest: 75 },
        { key: "floor_press", sets: 4, reps: "10", rest: 75 },
        { key: "bent_row", sets: 4, reps: "10", rest: 75 },
        { key: "plank", sets: 3, reps: "45 s", rest: 45 },
      ] },
      { title: "Day B", exercises: [
        { key: "rdl", sets: 4, reps: "12", rest: 75 },
        { key: "ohp", sets: 4, reps: "10", rest: 75 },
        { key: "pull_up", sets: 4, reps: "AMRAP", rest: 90 },
        { key: "bicycle_crunch", sets: 3, reps: "20 / side", rest: 45 },
      ] },
      { title: "Day C", exercises: [
        { key: "reverse_lunge", sets: 4, reps: "12 / leg", rest: 60 },
        { key: "pushup", sets: 4, reps: "AMRAP", rest: 60 },
        { key: "single_row", sets: 4, reps: "12 / side", rest: 60 },
        { key: "burpee", sets: 3, reps: "12", rest: 45 },
      ] },
    ],
  },
];
