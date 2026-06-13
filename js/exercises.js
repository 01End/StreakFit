/* StreakFit — exercise library + offline animated demonstrator.
 *
 * Each exercise: { name, anim, equip, cues[], met }.
 * The demonstrator is a connected stick figure animated POSE-TO-POSE with SMIL:
 * every joint has a start pose (A) and end pose (B), and we animate the bone
 * endpoints between them. Because joints are shared coordinates, the figure stays
 * connected and anatomically correct for each movement. Fully offline, no media.
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
  reverse_lunge: { name: "DB Reverse Lunge", anim: "lunge", equip: "Dumbbells", met: 6,
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

/* ============================ animated figure (JS rAF, pose-to-pose) ============================
 * Bones are <line> elements tagged with the joint names they connect (data-j1/data-j2).
 * A small requestAnimationFrame loop interpolates each joint A↔B and updates the line
 * coordinates — reliable across browsers (unlike SMIL inserted via innerHTML). */
function _bone(j1, j2, cls) {
  return `<line class="bone ${cls || ""}" data-j1="${j1}" data-j2="${j2}" x1="0" y1="0" x2="0" y2="0"></line>`;
}

// Side-view figure. Joints: head,S(shoulder),E(elbow),H(hand),P(hip),K(knee),F(foot)[,K2,F2].
function figSide(cfg, anim) {
  const groundY = cfg.groundY != null ? cfg.groundY : 122;
  const bar = cfg.bar ? `<line class="ex-bar" x1="28" y1="14" x2="102" y2="14"></line>` : "";
  const legs2 = cfg.A.K2 ? _bone("P", "K2") + _bone("K2", "F2") : "";
  return `
  <svg class="ex-fig" data-anim="${anim}" viewBox="0 0 140 140" role="img" aria-label="exercise demonstration">
    <line class="ex-ground" x1="14" y1="${groundY}" x2="126" y2="${groundY}"></line>
    ${bar}
    ${_bone("S", "P", "spine")}${_bone("P", "K")}${_bone("K", "F")}${legs2}
    ${_bone("S", "E")}${_bone("E", "H")}
    <circle class="head" r="10" cx="0" cy="0"></circle>
  </svg>`;
}

// Front-view figure. Joints: head,S,P, EL,HL,ER,HR, KL,FL,KR,FR.
function figFront(cfg, anim) {
  return `
  <svg class="ex-fig" data-anim="${anim}" viewBox="0 0 120 138" role="img" aria-label="exercise demonstration">
    <line class="ex-ground" x1="16" y1="122" x2="104" y2="122"></line>
    ${_bone("S", "P", "spine")}
    ${_bone("S", "EL")}${_bone("EL", "HL")}${_bone("S", "ER")}${_bone("ER", "HR")}
    ${_bone("P", "KL")}${_bone("KL", "FL")}${_bone("P", "KR")}${_bone("KR", "FR")}
    <circle class="head" r="10" cx="0" cy="0"></circle>
  </svg>`;
}

let _figRAF = null;
function startFigureAnim(svg) {
  stopFigureAnim();
  const cfg = POSES[svg.dataset.anim] || POSES.squat;
  const dur = (parseFloat(cfg.dur) || 1.5) * 1000;
  const bones = [...svg.querySelectorAll("line.bone")];
  const head = svg.querySelector("circle.head");
  const lerp = (a, b, e) => a + (b - a) * e;
  const setLine = (ln, e) => {
    const a = cfg.A, b = cfg.B, j1 = ln.dataset.j1, j2 = ln.dataset.j2;
    ln.setAttribute("x1", lerp(a[j1][0], b[j1][0], e));
    ln.setAttribute("y1", lerp(a[j1][1], b[j1][1], e));
    ln.setAttribute("x2", lerp(a[j2][0], b[j2][0], e));
    ln.setAttribute("y2", lerp(a[j2][1], b[j2][1], e));
  };
  const draw = (e) => {
    bones.forEach((ln) => setLine(ln, e));
    if (head) { head.setAttribute("cx", lerp(cfg.A.head[0], cfg.B.head[0], e)); head.setAttribute("cy", lerp(cfg.A.head[1], cfg.B.head[1], e)); }
  };
  // Demos always animate — the movement is the instructional content (decorative
  // app animations still respect prefers-reduced-motion via CSS).
  const start = performance.now();
  const frame = (now) => {
    const t = ((now - start) % (2 * dur)) / dur; // 0..2
    let e = t < 1 ? t : 2 - t; // triangle 0..1..0
    e = e * e * (3 - 2 * e); // smoothstep ease
    draw(e);
    _figRAF = requestAnimationFrame(frame);
  };
  _figRAF = requestAnimationFrame(frame);
}
function stopFigureAnim() {
  if (_figRAF) cancelAnimationFrame(_figRAF);
  _figRAF = null;
}

const POSES = {
  // SQUAT — feet planted, hips sit back & down, knees forward, torso leans.
  squat: { dur: "1.6s", A: { head: [60, 20], S: [60, 34], P: [60, 66], K: [60, 92], F: [58, 120], E: [56, 50], H: [50, 56] },
                        B: { head: [72, 42], S: [66, 54], P: [50, 80], K: [76, 94], F: [58, 120], E: [62, 66], H: [56, 70] } },
  // LUNGE — step back: front leg bends, back leg extends behind (2nd leg via K2/F2).
  lunge: { dur: "1.8s", A: { head: [60, 20], S: [60, 34], P: [60, 66], K: [60, 92], F: [60, 120], K2: [60, 92], F2: [60, 120], E: [60, 50], H: [60, 64] },
                        B: { head: [58, 28], S: [58, 42], P: [58, 74], K: [64, 96], F: [62, 120], K2: [80, 104], F2: [98, 120], E: [58, 58], H: [58, 72] } },
  // HINGE (RDL) — hips push back, flat back bows forward, arms hang to shins.
  hinge: { dur: "1.8s", A: { head: [60, 20], S: [60, 34], P: [60, 66], K: [60, 92], F: [60, 120], E: [60, 50], H: [60, 66] },
                        B: { head: [100, 56], S: [86, 58], P: [50, 66], K: [56, 92], F: [60, 120], E: [88, 76], H: [88, 94] } },
  // PRESS — overhead press: hands from shoulders to overhead.
  press: { dur: "1.4s", A: { head: [60, 22], S: [60, 36], P: [60, 70], K: [60, 96], F: [60, 122], E: [46, 38], H: [50, 28] },
                        B: { head: [60, 22], S: [60, 36], P: [60, 70], K: [60, 96], F: [60, 122], E: [56, 18], H: [60, 4] } },
  // CURL — upper arm pinned, forearm curls up.
  curl: { dur: "1.3s", A: { head: [60, 22], S: [60, 36], P: [60, 70], K: [60, 96], F: [60, 122], E: [60, 54], H: [60, 72] },
                       B: { head: [60, 22], S: [60, 36], P: [60, 70], K: [60, 96], F: [60, 122], E: [60, 54], H: [49, 40] } },
  // ROW — bent over, elbow drives back to waist.
  row: { dur: "1.3s", A: { head: [98, 52], S: [84, 56], P: [52, 66], K: [56, 92], F: [60, 120], E: [84, 76], H: [84, 94] },
                      B: { head: [98, 52], S: [84, 56], P: [52, 66], K: [56, 92], F: [60, 120], E: [76, 64], H: [66, 60] } },
  // PULLUP — hands fixed on bar, body rises.
  pullup: { dur: "1.8s", bar: true, A: { head: [60, 38], S: [60, 50], P: [60, 84], K: [60, 108], F: [60, 128], E: [57, 30], H: [56, 14] },
                                    B: { head: [60, 20], S: [60, 32], P: [60, 66], K: [60, 90], F: [60, 110], E: [53, 22], H: [56, 14] } },
  // CALF — rise onto toes (whole body lifts a touch).
  calf: { dur: "1s", A: { head: [60, 22], S: [60, 36], P: [60, 70], K: [60, 96], F: [60, 122], E: [60, 52], H: [60, 70] },
                     B: { head: [60, 14], S: [60, 28], P: [60, 62], K: [60, 88], F: [60, 120], E: [60, 44], H: [60, 62] } },
  // PUSHUP — side plank that dips (ground raised to body level).
  pushup: { dur: "1.3s", groundY: 88, A: { head: [26, 50], S: [40, 54], P: [80, 66], K: [104, 74], F: [124, 82], E: [40, 70], H: [42, 84] },
                                       B: { head: [26, 60], S: [40, 64], P: [80, 72], K: [104, 78], F: [124, 84], E: [34, 74], H: [42, 84] } },
  // PLANK — hold, tiny bob.
  plank: { dur: "3s", groundY: 88, A: { head: [26, 56], S: [40, 60], P: [80, 70], K: [104, 78], F: [124, 84], E: [40, 78], H: [40, 84] },
                                   B: { head: [26, 58], S: [40, 62], P: [80, 72], K: [104, 80], F: [124, 85], E: [40, 80], H: [40, 84] } },
  // JACKS — front view, arms + legs open/close with a small jump.
  jacks: { view: "front", dur: "0.8s",
    A: { head: [60, 16], S: [60, 34], P: [60, 74], EL: [52, 52], HL: [48, 70], ER: [68, 52], HR: [72, 70], KL: [56, 98], FL: [54, 120], KR: [64, 98], FR: [66, 120] },
    B: { head: [60, 12], S: [60, 30], P: [60, 70], EL: [44, 22], HL: [34, 8], ER: [76, 22], HR: [86, 8], KL: [46, 100], FL: [38, 120], KR: [74, 100], FR: [82, 120] } },
  // KNEES — front view, alternate knee drive (A: left up, B: right up).
  knees: { view: "front", dur: "0.7s",
    A: { head: [60, 16], S: [60, 34], P: [60, 74], EL: [52, 52], HL: [50, 70], ER: [70, 48], HR: [74, 34], KL: [58, 88], FL: [56, 74], KR: [64, 98], FR: [66, 120] },
    B: { head: [60, 16], S: [60, 34], P: [60, 74], EL: [50, 48], HL: [46, 34], ER: [68, 52], HR: [70, 70], KL: [56, 98], FL: [54, 120], KR: [62, 88], FR: [64, 74] } },
};
POSES.burpee = POSES.squat; // burpee shown as a squat-to-jump style cycle

function exerciseFigure(anim) {
  const cfg = POSES[anim] || POSES.squat;
  return cfg.view === "front" ? figFront(cfg, anim) : figSide(cfg, anim);
}
