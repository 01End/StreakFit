/* StreakFit — exercise library + offline animated demonstrator.
 *
 * Each exercise: { name, anim, equip, cues[], met }
 *  - anim : which looping figure animation to play (see exerciseFigure + CSS @keyframes)
 *  - met  : metabolic equivalent, used to estimate calories per set
 * The figure is a pure SVG "mannequin"; animations are CSS keyframes in style.css,
 * selected by the `anim-<key>` class. Works fully offline — no GIFs, no network.
 */
const EXERCISES = {
  // ---- Push ----
  pushup:        { name: "Push-ups", anim: "pushup", equip: "Bodyweight", met: 8,
    cues: ["Hands just wider than shoulders", "Body in one straight line — no sagging hips", "Lower until chest is a fist off the floor", "Drive up, squeeze chest"] },
  diamond_pushup:{ name: "Diamond Push-ups", anim: "pushup", equip: "Bodyweight", met: 8,
    cues: ["Hands together forming a triangle", "Elbows tuck close to body", "Targets triceps", "Full lockout at the top"] },
  floor_press:   { name: "DB Floor Press", anim: "pushup", equip: "Dumbbells", met: 6,
    cues: ["Lie on back, knees bent", "Press dumbbells straight up", "Let elbows lightly touch the floor", "Control the negative"] },
  ohp:           { name: "DB Overhead Press", anim: "press", equip: "Dumbbells", met: 6,
    cues: ["Start at shoulder height", "Brace core, don't lean back", "Press straight overhead", "Lower under control"] },
  lateral_raise: { name: "DB Lateral Raise", anim: "press", equip: "Dumbbells", met: 4,
    cues: ["Slight bend in elbows", "Raise to shoulder height only", "Lead with the elbows", "No swinging — slow and strict"] },

  // ---- Pull ----
  pull_up:       { name: "Pull-ups", anim: "pullup", equip: "Pull-up bar", met: 8,
    cues: ["Overhand grip, shoulder-width", "Pull chest toward the bar", "Drive elbows down", "Full hang at the bottom"] },
  chin_up:       { name: "Chin-ups", anim: "pullup", equip: "Pull-up bar", met: 8,
    cues: ["Underhand grip", "Bigger biceps involvement", "Chin clears the bar", "Lower slowly"] },
  bent_row:      { name: "DB Bent-over Row", anim: "row", equip: "Dumbbells", met: 6,
    cues: ["Hinge at hips ~45°, flat back", "Row dumbbells to your waist", "Squeeze shoulder blades", "Don't jerk with the lower back"] },
  single_row:    { name: "DB Single-arm Row", anim: "row", equip: "Dumbbells", met: 6,
    cues: ["One hand braced on a surface", "Row to the hip, not the chest", "Full stretch at the bottom", "Keep hips square"] },
  db_curl:       { name: "DB Bicep Curl", anim: "curl", equip: "Dumbbells", met: 4,
    cues: ["Elbows pinned to your sides", "Curl without swinging", "Squeeze at the top", "Lower slowly to full extension"] },
  hammer_curl:   { name: "Hammer Curl", anim: "curl", equip: "Dumbbells", met: 4,
    cues: ["Neutral grip (palms face in)", "Hits the forearm + brachialis", "Strict, no momentum", "Control the negative"] },
  dead_hang:     { name: "Dead Hang", anim: "pullup", equip: "Pull-up bar", met: 4,
    cues: ["Hang at full stretch", "Relax shoulders down slightly", "Builds grip + decompresses spine", "Hold for time"] },

  // ---- Legs ----
  goblet_squat:  { name: "DB Goblet Squat", anim: "squat", equip: "Dumbbells", met: 6,
    cues: ["Hold one DB at your chest", "Sit back and down, chest up", "Knees track over toes", "Drive through your heels"] },
  bw_squat:      { name: "Bodyweight Squat", anim: "squat", equip: "Bodyweight", met: 5,
    cues: ["Feet shoulder-width", "Hips back like sitting in a chair", "Thighs to parallel", "Stand tall, squeeze glutes"] },
  reverse_lunge: { name: "DB Reverse Lunge", anim: "squat", equip: "Dumbbells", met: 6,
    cues: ["Step back into a lunge", "Front thigh to parallel", "Keep torso upright", "Push through the front heel"] },
  rdl:           { name: "DB Romanian Deadlift", anim: "hinge", equip: "Dumbbells", met: 6,
    cues: ["Soft knees, push hips BACK", "Flat back throughout", "Feel the hamstring stretch", "Drive hips forward to stand"] },
  glute_bridge:  { name: "Glute Bridge", anim: "hinge", equip: "Bodyweight", met: 4,
    cues: ["Lie on back, feet flat", "Drive hips to the ceiling", "Squeeze glutes hard at the top", "Lower slowly"] },
  calf_raise:    { name: "Calf Raise", anim: "calf", equip: "Bodyweight", met: 4,
    cues: ["Push up onto the balls of your feet", "Pause at the top", "Full stretch at the bottom", "Add a DB to load it"] },
  wall_sit:      { name: "Wall Sit", anim: "squat", equip: "Bodyweight", met: 5,
    cues: ["Back flat on a wall", "Thighs parallel to floor", "Hold the position", "Breathe — don't hold your breath"] },

  // ---- Conditioning / Core ----
  burpee:        { name: "Burpees", anim: "burpee", equip: "Bodyweight", met: 10,
    cues: ["Squat, hands down", "Kick feet back to a plank", "(Optional push-up)", "Jump up explosively"] },
  jumping_jack:  { name: "Jumping Jacks", anim: "jacks", equip: "Bodyweight", met: 8,
    cues: ["Jump feet out, arms overhead", "Land soft", "Keep a steady rhythm", "Great warm-up / finisher"] },
  high_knees:    { name: "High Knees", anim: "knees", equip: "Bodyweight", met: 8,
    cues: ["Drive knees to hip height", "Stay on the balls of your feet", "Pump the arms", "Fast but controlled"] },
  mountain_climber:{ name: "Mountain Climbers", anim: "knees", equip: "Bodyweight", met: 8,
    cues: ["Start in a plank", "Drive knees to chest, alternating", "Hips low and stable", "Quick tempo"] },
  bicycle_crunch:{ name: "Bicycle Crunches", anim: "knees", equip: "Bodyweight", met: 6,
    cues: ["Opposite elbow to opposite knee", "Don't yank your neck", "Slow and controlled", "Full extension each side"] },
  plank:         { name: "Plank", anim: "plank", equip: "Bodyweight", met: 4,
    cues: ["Forearms under shoulders", "Straight line head to heels", "Brace abs + glutes", "Hold for time"] },
};

function getExercise(key) {
  return EXERCISES[key] || { name: key, anim: "squat", equip: "", cues: [], met: 5 };
}

/* The animated mannequin. `anim` selects which scene + CSS animation to play.
 * Upright/hanging moves use the side-view skeleton; pushup/plank use a side scene;
 * jacks/knees use a front-view scene. All looping, all offline. */
function exerciseFigure(anim) {
  if (anim === "pushup" || anim === "plank") return figHorizontal(anim);
  if (anim === "jacks") return figJacks();
  if (anim === "knees") return figKnees();
  return figSkeleton(anim);
}

function figSkeleton(anim) {
  return `
  <svg class="ex-fig anim-${anim}" viewBox="0 0 120 150" role="img" aria-label="exercise demonstration">
    <line class="ex-ground" x1="18" y1="136" x2="102" y2="136"></line>
    <line class="ex-bar" x1="28" y1="12" x2="92" y2="12"></line>
    <g class="fig">
      <g class="lower" transform="translate(60,80)">
        <g class="thigh">
          <rect class="seg" x="-4" y="0" width="8" height="28" rx="4"></rect>
          <g class="shin" transform="translate(0,28)">
            <rect class="seg" x="-4" y="0" width="8" height="28" rx="4"></rect>
            <rect class="foot" x="-8" y="25" width="16" height="5" rx="2.5"></rect>
          </g>
        </g>
      </g>
      <g class="upper" transform="translate(60,80)">
        <g class="torso">
          <rect class="seg spine" x="-4.5" y="-36" width="9" height="38" rx="4.5"></rect>
          <circle class="head" cx="0" cy="-48" r="11"></circle>
          <g class="uarm" transform="translate(0,-34)">
            <rect class="seg" x="-3.5" y="0" width="7" height="20" rx="3.5"></rect>
            <g class="farm" transform="translate(0,20)">
              <rect class="seg" x="-3.5" y="0" width="7" height="18" rx="3.5"></rect>
            </g>
          </g>
        </g>
      </g>
    </g>
  </svg>`;
}

/* Side-view pushup / plank: a near-horizontal body that dips. */
function figHorizontal(anim) {
  return `
  <svg class="ex-fig anim-${anim}" viewBox="0 0 140 100" role="img" aria-label="exercise demonstration">
    <line class="ex-ground" x1="14" y1="84" x2="128" y2="84"></line>
    <g class="phbody">
      <circle class="head" cx="28" cy="42" r="10"></circle>
      <line class="bone" x1="36" y1="46" x2="86" y2="60"></line>
      <line class="bone" x1="86" y1="60" x2="124" y2="78"></line>
      <line class="bone foot-bone" x1="124" y1="78" x2="132" y2="80"></line>
      <line class="bone arm" x1="44" y1="48" x2="46" y2="82"></line>
      <line class="bone arm forearm" x1="46" y1="82" x2="40" y2="82"></line>
    </g>
  </svg>`;
}

/* Front-view jumping jacks. */
function figJacks() {
  return `
  <svg class="ex-fig anim-jacks" viewBox="0 0 120 140" role="img" aria-label="exercise demonstration">
    <line class="ex-ground" x1="20" y1="128" x2="100" y2="128"></line>
    <g class="jfig">
      <circle class="head" cx="60" cy="24" r="11"></circle>
      <line class="bone" x1="60" y1="35" x2="60" y2="78"></line>
      <g class="armL"><line class="bone" x1="60" y1="40" x2="60" y2="72"></line></g>
      <g class="armR"><line class="bone" x1="60" y1="40" x2="60" y2="72"></line></g>
      <g class="legL"><line class="bone" x1="60" y1="78" x2="60" y2="120"></line></g>
      <g class="legR"><line class="bone" x1="60" y1="78" x2="60" y2="120"></line></g>
    </g>
  </svg>`;
}

/* Front-view high knees / running in place. */
function figKnees() {
  return `
  <svg class="ex-fig anim-knees" viewBox="0 0 120 140" role="img" aria-label="exercise demonstration">
    <line class="ex-ground" x1="20" y1="128" x2="100" y2="128"></line>
    <g class="kfig">
      <circle class="head" cx="60" cy="24" r="11"></circle>
      <line class="bone" x1="60" y1="35" x2="60" y2="78"></line>
      <g class="armL"><line class="bone" x1="60" y1="42" x2="60" y2="72"></line></g>
      <g class="armR"><line class="bone" x1="60" y1="42" x2="60" y2="72"></line></g>
      <g class="legL"><line class="bone" x1="60" y1="78" x2="60" y2="118"></line></g>
      <g class="legR"><line class="bone" x1="60" y1="78" x2="60" y2="118"></line></g>
    </g>
  </svg>`;
}
