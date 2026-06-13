/* StreakFit — built-in training plans.
 * The flagship "Aggressive Home Cut" is a 6-day Push/Pull/Legs split tuned for a
 * 20 kg dumbbell (or 2×10s) + pull-up bar + bodyweight. Each entry references an
 * exercise key in EXERCISES (js/exercises.js); reps/sets/rest are per-exercise.
 */
const BUILTIN_PLAN = {
  id: "aggressive_home_cut",
  name: "Aggressive Home Cut",
  subtitle: "6-day PPL · dumbbell + pull-up bar + bodyweight",
  days: [
    {
      title: "Day 1 — Push (Chest / Shoulders / Triceps)",
      exercises: [
        { key: "pushup", sets: 4, reps: "12–20", rest: 60 },
        { key: "floor_press", sets: 4, reps: "10–12", rest: 75 },
        { key: "ohp", sets: 3, reps: "10–12", rest: 75 },
        { key: "lateral_raise", sets: 3, reps: "15", rest: 45 },
        { key: "diamond_pushup", sets: 3, reps: "AMRAP", rest: 60 },
        { key: "burpee", sets: 3, reps: "10", rest: 45 },
      ],
    },
    {
      title: "Day 2 — Pull (Back / Biceps)",
      exercises: [
        { key: "pull_up", sets: 4, reps: "AMRAP", rest: 90 },
        { key: "bent_row", sets: 4, reps: "10–12", rest: 75 },
        { key: "single_row", sets: 3, reps: "12 / side", rest: 60 },
        { key: "db_curl", sets: 3, reps: "12", rest: 45 },
        { key: "hammer_curl", sets: 3, reps: "12", rest: 45 },
        { key: "dead_hang", sets: 3, reps: "30–45 s", rest: 45 },
      ],
    },
    {
      title: "Day 3 — Legs (Quads / Glutes / Hamstrings)",
      exercises: [
        { key: "goblet_squat", sets: 4, reps: "12–15", rest: 75 },
        { key: "reverse_lunge", sets: 3, reps: "12 / leg", rest: 60 },
        { key: "rdl", sets: 4, reps: "12", rest: 75 },
        { key: "glute_bridge", sets: 3, reps: "15", rest: 45 },
        { key: "calf_raise", sets: 4, reps: "20", rest: 30 },
        { key: "wall_sit", sets: 3, reps: "45 s", rest: 45 },
      ],
    },
    {
      title: "Day 4 — Push 2 (Strength focus)",
      exercises: [
        { key: "floor_press", sets: 5, reps: "8–10", rest: 90 },
        { key: "ohp", sets: 4, reps: "8–10", rest: 90 },
        { key: "pushup", sets: 3, reps: "AMRAP", rest: 60 },
        { key: "lateral_raise", sets: 4, reps: "15", rest: 45 },
        { key: "diamond_pushup", sets: 3, reps: "12", rest: 60 },
      ],
    },
    {
      title: "Day 5 — Pull 2 (Strength focus)",
      exercises: [
        { key: "pull_up", sets: 5, reps: "AMRAP", rest: 120 },
        { key: "bent_row", sets: 5, reps: "8–10", rest: 90 },
        { key: "single_row", sets: 3, reps: "10 / side", rest: 60 },
        { key: "hammer_curl", sets: 4, reps: "10", rest: 45 },
        { key: "dead_hang", sets: 3, reps: "Max", rest: 60 },
      ],
    },
    {
      title: "Day 6 — Conditioning / Core (HIIT)",
      exercises: [
        { key: "burpee", sets: 4, reps: "12", rest: 40 },
        { key: "high_knees", sets: 4, reps: "40 s", rest: 30 },
        { key: "mountain_climber", sets: 4, reps: "40 s", rest: 30 },
        { key: "jumping_jack", sets: 4, reps: "45 s", rest: 30 },
        { key: "plank", sets: 3, reps: "45–60 s", rest: 30 },
        { key: "bicycle_crunch", sets: 3, reps: "20 / side", rest: 30 },
      ],
    },
  ],
};
