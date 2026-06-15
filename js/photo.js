/* StreakFit — photo calorie calculator.
 * Snap/upload a meal photo → estimate foods (name, grams, macros). Two paths:
 *   1. OpenRouter vision (if a key is set in settings) — one tap, auto-filled, editable.
 *   2. Chat handoff (no key) — copy a prompt, paste the photo+prompt into your Claude chat,
 *      paste the JSON reply back.
 * Reuses extractPlanJSON (js/workouts.js) and the App.state.active.foods entry shape.
 */
const PHOTO_PROMPT =
  'You are a nutrition estimator. Identify each distinct food/drink in the photo and estimate a ' +
  'realistic portion in grams and the macros FOR THAT PORTION. Be realistic and concise. ' +
  'Reply with ONLY valid JSON, no markdown, no prose:\n' +
  '{"items":[{"name":"string","grams":number,"kcal":number,"protein":number,"carbs":number,"fats":number,"sugar":number,"fiber":number,"sodium":number}]}';

function downscaleImage(file, max = 768) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

function parsePhotoItems(text) {
  let obj;
  try {
    obj = JSON.parse(extractPlanJSON(text));
  } catch (e) {
    throw new Error("Couldn't read the reply as JSON.");
  }
  const arr = Array.isArray(obj) ? obj : obj.items;
  if (!Array.isArray(arr) || !arr.length) throw new Error("No food items found in the reply.");
  return arr.map((it) => ({
    name: String(it.name || "Item"),
    grams: Math.round(+it.grams || 0),
    kcal: Math.round(+it.kcal || 0),
    protein: +(+it.protein || 0).toFixed(1),
    carbs: +(+it.carbs || 0).toFixed(1),
    fats: +(+it.fats || 0).toFixed(1),
    sugar: +(+it.sugar || 0).toFixed(1),
    fiber: +(+it.fiber || 0).toFixed(1),
    sodium: Math.round(+it.sodium || 0),
  }));
}

async function analyzePhotoOpenRouter(dataUrl) {
  const s = App.state.settings || {};
  const model = s.visionModel || "meta-llama/llama-4-maverick:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${s.openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-Title": "StreakFit",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: [
        { type: "text", text: PHOTO_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ] }],
    }),
  });
  if (res.status === 401) throw new Error("Invalid API key — check it in profile → Photo logging.");
  if (res.status === 429) throw new Error("Rate limited (free model busy). Wait a moment or switch model.");
  if (!res.ok) throw new Error("Request failed (" + res.status + ").");
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("Empty reply from the model.");
  return { items: parsePhotoItems(text), model: data.model || model };
}

function addPhotoItemsToToday(items) {
  items.forEach((it) => App.state.active.foods.push({
    name: it.name, grams: it.grams, kcal: it.kcal, protein: it.protein,
    carbs: it.carbs, fats: it.fats, sugar: it.sugar, fiber: it.fiber, sodium: it.sodium,
  }));
  App.save();
}

/* ---------- modal ---------- */
function openPhotoLog() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.setAttribute("capture", "environment");
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    let dataUrl;
    try { dataUrl = await downscaleImage(file); } catch (e) { alert(e.message); return; }
    openPhotoModal(dataUrl);
  };
  inp.click();
}

function closePhotoModal() {
  const m = document.getElementById("photo-modal");
  if (m) m.remove();
}

function openPhotoModal(dataUrl) {
  closePhotoModal();
  const hasKey = !!(App.state.settings && App.state.settings.openrouterKey);
  const modal = document.createElement("div");
  modal.id = "photo-modal";
  modal.innerHTML = `
    <div class="ex-modal-card">
      <button class="ex-close" aria-label="close">✕</button>
      <h3 class="ex-title">📷 Photo meal</h3>
      <img class="photo-preview" src="${dataUrl}" alt="meal photo">
      <div id="photo-body"></div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("open"));
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".ex-close")) closePhotoModal(); });

  const body = modal.querySelector("#photo-body");

  // Render the editable item list + Add all.
  const showItems = (items, modelText) => {
    const state = items.map((it) => ({ ...it, _base: { ...it } })); // keep originals for gram scaling
    const rowsHtml = () => state
      .map((it, i) => `
        <li class="pi-row">
          <span class="pi-name">${it.name}</span>
          <input class="pi-grams" type="number" min="1" data-i="${i}" value="${it.grams}"> g
          <span class="pi-kcal">${it.kcal} kcal</span>
          <button class="del pi-del" data-i="${i}">✕</button>
        </li>`)
      .join("");
    const totalKcal = () => Math.round(state.reduce((s, it) => s + it.kcal, 0));
    body.innerHTML = `
      ${modelText ? `<p class="muted small">Estimated by <strong>${modelText}</strong> · tweak grams if needed</p>` : ""}
      <ul class="photo-items">${rowsHtml()}</ul>
      <div class="recipe-totals" id="photo-total"><strong>${totalKcal()} kcal</strong> total</div>
      <button class="btn-primary" id="photo-add">Add all to today</button>`;

    const refreshTotals = () => { body.querySelector("#photo-total").innerHTML = `<strong>${totalKcal()} kcal</strong> total`; };
    const rerender = () => { showItems(state.filter(Boolean), modelText); };

    body.querySelectorAll(".pi-grams").forEach((inp) => inp.addEventListener("input", (e) => {
      const i = +e.target.dataset.i, g = +e.target.value || 0, b = state[i]._base;
      const f = b.grams ? g / b.grams : 0;
      ["kcal", "protein", "carbs", "fats", "sugar", "fiber", "sodium"].forEach((k) => { state[i][k] = +(b[k] * f).toFixed(k === "kcal" || k === "sodium" ? 0 : 1); });
      state[i].grams = g;
      body.querySelector(`.pi-row:nth-child(${i + 1}) .pi-kcal`).textContent = `${Math.round(state[i].kcal)} kcal`;
      refreshTotals();
    }));
    body.querySelectorAll(".pi-del").forEach((btn) => btn.addEventListener("click", (e) => {
      state.splice(+e.target.dataset.i, 1);
      rerender();
    }));
    body.querySelector("#photo-add").addEventListener("click", () => {
      if (!state.length) { closePhotoModal(); return; }
      addPhotoItemsToToday(state.map((it) => ({ name: it.name, grams: it.grams, kcal: Math.round(it.kcal), protein: it.protein, carbs: it.carbs, fats: it.fats, sugar: it.sugar, fiber: it.fiber, sodium: it.sodium })));
      closePhotoModal();
      if (window.renderLogTab) renderLogTab();
      App.celebrateMini("Logged from photo ✓");
    });
  };

  // Fallback (no key): prompt + paste box.
  const showFallback = (note) => {
    body.innerHTML = `
      ${note ? `<p class="error">${note}</p>` : ""}
      <p class="muted small">No OpenRouter key set. Send this to your Claude chat with the photo, then paste the JSON reply back. (Add a key in profile → Photo logging for one-tap.)</p>
      <button class="btn-ghost" id="copy-prompt">Copy prompt</button>
      <textarea id="photo-paste" class="plan-input" rows="4" placeholder="Paste Claude's JSON reply here…"></textarea>
      <button class="btn-primary" id="photo-parse">Parse & review</button>
      <p id="photo-err" class="error"></p>`;
    body.querySelector("#copy-prompt").addEventListener("click", (e) => {
      navigator.clipboard && navigator.clipboard.writeText(PHOTO_PROMPT);
      e.target.textContent = "Copied!";
    });
    body.querySelector("#photo-parse").addEventListener("click", () => {
      const err = body.querySelector("#photo-err");
      err.textContent = "";
      try {
        showItems(parsePhotoItems(body.querySelector("#photo-paste").value), null);
      } catch (e) { err.textContent = e.message; }
    });
  };

  if (hasKey) {
    body.innerHTML = `<p class="muted analyzing">🔎 Analyzing your meal…</p>`;
    analyzePhotoOpenRouter(dataUrl)
      .then(({ items, model }) => showItems(items, model))
      .catch((err) => showFallback(err.message));
  } else {
    showFallback();
  }
}
