/* StreakFit — Log tab.
 * Foods are stored PER 100 g, so logging is gram-based: pick a food, enter grams,
 * and macros + micros (fiber, sodium) auto-scale. Includes Quick Add for one-offs
 * and a Recipe Builder that combines ingredients into a reusable per-100g meal.
 */
function searchFoods(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pool = [...FOODS, ...(App.state.customFoods || [])];
  const matches = pool.filter((f) => f.name.toLowerCase().includes(q));
  matches.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return matches.slice(0, 25);
}

// Online search via Open Food Facts v2 API → per-100g food objects (same shape as FOODS).
async function searchFoodsOnline(query) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(
      `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(query)}&page_size=20&fields=product_name,brands,nutriments,serving_size&json=1`,
      { signal: ctrl.signal }
    );
  } finally {
    clearTimeout(tid);
  }
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await res.json();
  return (data.products || [])
    .map((p) => {
      const n = p.nutriments || {};
      const name = [p.brands, p.product_name].filter(Boolean).join(" ").trim();
      if (!name || !n["energy-kcal_100g"]) return null;
      return {
        name,
        kcal: Math.round(n["energy-kcal_100g"] || 0),
        protein: +(n.proteins_100g || 0).toFixed(1),
        carbs: +(n.carbohydrates_100g || 0).toFixed(1),
        fats: +(n.fat_100g || 0).toFixed(1),
        sugar: +(n.sugars_100g || 0).toFixed(1),
        fiber: +(n.fiber_100g || 0).toFixed(1),
        sodium: Math.round((n.sodium_100g || 0) * 1000),
        serving: p.serving_size ? { label: p.serving_size, g: parseFloat(p.serving_size) || 100 } : { label: "100 g", g: 100 },
      };
    })
    .filter(Boolean);
}

// Scale a per-100g food to `grams`.
function scaleMacros(food, grams) {
  const f = (+grams || 0) / 100;
  return {
    kcal: (+food.kcal || 0) * f,
    protein: (+food.protein || 0) * f,
    carbs: (+food.carbs || 0) * f,
    fats: (+food.fats || 0) * f,
    sugar: (+food.sugar || 0) * f,
    fiber: (+food.fiber || 0) * f,
    sodium: (+food.sodium || 0) * f,
  };
}

// per-100g snapshot used by recents/favorites
function per100Snapshot(food) {
  return { name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fats: food.fats,
    sugar: food.sugar, fiber: food.fiber, sodium: food.sodium, serving: food.serving || { label: "100 g", g: 100 } };
}
function recordRecent(food) {
  if (!food || !food.name) return;
  const r = (App.state.recentFoods || []).filter((f) => f.name.toLowerCase() !== food.name.toLowerCase());
  r.unshift(per100Snapshot(food));
  App.state.recentFoods = r.slice(0, 15);
}
function isFavorite(name) {
  return (App.state.favoriteFoods || []).some((f) => f.name.toLowerCase() === name.toLowerCase());
}
function toggleFavorite(food) {
  const favs = App.state.favoriteFoods || (App.state.favoriteFoods = []);
  const i = favs.findIndex((f) => f.name.toLowerCase() === food.name.toLowerCase());
  if (i >= 0) favs.splice(i, 1); else favs.unshift(per100Snapshot(food));
  App.save();
}
// build a per-100g food from a logged entry (which stores totals + grams)
function per100FromEntry(entry) {
  const g = entry.grams || 100, f = 100 / g;
  return { name: entry.name, kcal: entry.kcal * f, protein: entry.protein * f, carbs: entry.carbs * f,
    fats: entry.fats * f, sugar: entry.sugar * f, fiber: (entry.fiber || 0) * f, sodium: (entry.sodium || 0) * f,
    serving: { label: `${g} g`, g } };
}

function addScaledFood(food, grams) {
  const m = scaleMacros(food, grams);
  App.state.active.foods.push({ name: food.name, grams: +grams, ...m });
  recordRecent(food);
  if (window.Gamify) Gamify.onFood();
  App.save();
}

function removeFoodFromToday(index) {
  App.state.active.foods.splice(index, 1);
  App.save();
  renderLogTab();
}

/* ---------- food detail modal (gram-based) ---------- */
function openFoodDetail(food, defaultGrams) {
  closeFoodModal();
  const g0 = defaultGrams || (food.serving && food.serving.g) || 100;
  const chips = [];
  if (food.serving) chips.push({ label: `${food.serving.label} (${food.serving.g}g)`, g: food.serving.g });
  chips.push({ label: "100 g", g: 100 }, { label: "150 g", g: 150 }, { label: "200 g", g: 200 });

  const modal = document.createElement("div");
  modal.id = "food-modal";
  modal.innerHTML = `
    <div class="ex-modal-card">
      <button class="ex-close" aria-label="close">✕</button>
      <h3 class="ex-title">${food.name}</h3>
      <p class="muted small">Per 100 g: ${Math.round(food.kcal)} kcal · ${food.protein}P · ${food.carbs}C · ${food.fats}F</p>
      <div class="chip-row">${chips.map((c) => `<button class="chip" data-g="${c.g}">${c.label}</button>`).join("")}</div>
      <label>Amount (grams)<input id="fd-grams" type="number" min="1" step="1" value="${g0}"></label>
      <div class="macro-preview" id="fd-preview"></div>
      <button class="btn-primary" id="fd-add">Add to today</button>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("open"));

  const gramsEl = modal.querySelector("#fd-grams");
  const preview = modal.querySelector("#fd-preview");
  const renderPreview = () => {
    const m = scaleMacros(food, gramsEl.value);
    preview.innerHTML = `
      <div class="mp-main"><span class="mp-kcal">${Math.round(m.kcal)}</span> kcal</div>
      <div class="mp-grid">
        <span>Protein <b>${m.protein.toFixed(1)}g</b></span>
        <span>Carbs <b>${m.carbs.toFixed(1)}g</b></span>
        <span>Fats <b>${m.fats.toFixed(1)}g</b></span>
        <span>Sugar <b>${m.sugar.toFixed(1)}g</b></span>
        <span>Fiber <b>${m.fiber.toFixed(1)}g</b></span>
        <span>Sodium <b>${Math.round(m.sodium)}mg</b></span>
      </div>`;
  };
  renderPreview();
  gramsEl.addEventListener("input", renderPreview);
  modal.querySelector(".chip-row").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    gramsEl.value = c.dataset.g;
    renderPreview();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest(".ex-close")) closeFoodModal();
  });
  modal.querySelector("#fd-add").addEventListener("click", () => {
    const g = +gramsEl.value;
    if (!g || g <= 0) return;
    addScaledFood(food, g);
    closeFoodModal();
    renderLogTab();
    if (App.celebrateMini) App.celebrateMini();
  });
}

function closeFoodModal() {
  const m = document.getElementById("food-modal");
  if (m) m.remove();
}

// Barcode / external prefill → open the gram picker with per-100g data.
function prefillQuickAdd(food) {
  openFoodDetail({ ...food, serving: food.serving && food.serving.g ? food.serving : { label: "100 g", g: 100 } }, 100);
}

/* ---------- recipe builder ---------- */
let _recipeDraft = []; // [{ food, grams }]

function recipeTotals() {
  let totalG = 0;
  const sum = { kcal: 0, protein: 0, carbs: 0, fats: 0, sugar: 0, fiber: 0, sodium: 0 };
  for (const it of _recipeDraft) {
    totalG += +it.grams || 0;
    const m = scaleMacros(it.food, it.grams);
    for (const k in sum) sum[k] += m[k];
  }
  return { totalG, sum };
}

function saveRecipe(name) {
  const { totalG, sum } = recipeTotals();
  if (!name || _recipeDraft.length === 0 || totalG <= 0) return false;
  const per100 = {};
  ["kcal", "protein", "carbs", "fats", "sugar", "fiber", "sodium"].forEach((k) => {
    per100[k] = +((sum[k] / totalG) * 100).toFixed(2);
  });
  const food = { name, ...per100, serving: { label: "1 recipe", g: Math.round(totalG) }, recipe: true };
  App.state.customFoods.push(food);
  App.save();
  _recipeDraft = [];
  return true;
}

/* ---------- render ---------- */
function renderLogTab() {
  const root = document.getElementById("view-log");
  const logged = App.state.active.foods;

  root.innerHTML = `
    <h2>Log Food</h2>

    <div class="card">
      <div class="search-row">
        <input id="food-search" class="search" type="search" placeholder="Search foods (e.g. chicken, rice, labneh)…" autocomplete="off">
        <button id="scan-btn" class="btn-scan" title="Scan barcode">▮▮</button>
      </div>
      <button id="snap-meal" class="btn-primary snap-btn">📸 Snap a meal (photo)</button>
      <ul id="search-results" class="results"></ul>
      <button id="online-search" class="btn-ghost" style="display:none">🔎 Search Open Food Facts (online)</button>
      <ul id="online-results" class="results"></ul>
      <p class="muted small">Tap a food → enter grams → it calculates automatically.</p>
      <div id="quick-foods" class="quick-foods"></div>
    </div>

    <details class="card">
      <summary><h3 style="display:inline">🍳 Recipe Builder</h3></summary>
      <p class="muted small">Build a homemade dish from ingredients (by gram), save it, then log any amount later.</p>
      <div class="search-row">
        <input id="recipe-search" class="search" type="search" placeholder="Add an ingredient…" autocomplete="off">
      </div>
      <ul id="recipe-results" class="results"></ul>
      <ul id="recipe-draft" class="recipe-draft"></ul>
      <div id="recipe-totals" class="recipe-totals"></div>
      <label>Recipe name<input id="recipe-name" placeholder="e.g. Mom's Machboos"></label>
      <button id="recipe-save" class="btn-primary">Save recipe</button>
    </details>

    <details class="card">
      <summary><h3 style="display:inline">➕ Quick Add (one-off)</h3></summary>
      <p class="muted small">No product? Enter the amount you ate and its macros (e.g. Claude-estimated).</p>
      <form id="quick-add">
        <label>Food Name<input name="name" required placeholder="e.g. Grandma's stew"></label>
        <div class="grid-2">
          <label>Amount eaten (g)<input name="grams" type="number" step="1" value="100"></label>
          <label>Calories<input name="kcal" type="number" step="0.1" required></label>
          <label>Protein (g)<input name="protein" type="number" step="0.1" value="0"></label>
          <label>Carbs (g)<input name="carbs" type="number" step="0.1" value="0"></label>
          <label>Fats (g)<input name="fats" type="number" step="0.1" value="0"></label>
          <label>Sugar (g)<input name="sugar" type="number" step="0.1" value="0"></label>
          <label>Fiber (g)<input name="fiber" type="number" step="0.1" value="0"></label>
          <label>Sodium (mg)<input name="sodium" type="number" step="1" value="0"></label>
        </div>
        <label class="check-line"><input type="checkbox" name="save" checked> Save for later (reusable)</label>
        <button type="submit" class="btn-primary">Add to today</button>
      </form>
    </details>

    <div class="card">
      <h3>Today's Log</h3>
      <ul class="logged">
        ${
          logged.length
            ? logged
                .map(
                  (f, i) =>
                    `<li>
                       <span class="log-name">${f.name}<span class="muted small log-serving">${f.grams ? f.grams + " g" : ""}</span></span>
                       <span class="muted">${Math.round(f.kcal)} kcal</span>
                       <button class="fav-star ${isFavorite(f.name) ? "on" : ""}" data-i="${i}" title="Favorite">${isFavorite(f.name) ? "★" : "☆"}</button>
                       <button class="del" data-i="${i}">✕</button>
                     </li>`
                )
                .join("")
            : `<li class="muted">Nothing logged yet.</li>`
        }
      </ul>
    </div>`;

  // ---- main search ----
  const searchEl = document.getElementById("food-search");
  const resultsEl = document.getElementById("search-results");
  const onlineBtn = document.getElementById("online-search");
  const onlineEl = document.getElementById("online-results");
  const quickFoods = document.getElementById("quick-foods");
  renderQuickFoods();
  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim();
    onlineBtn.style.display = q ? "block" : "none";
    onlineBtn.textContent = "🔎 Search Open Food Facts (online)";
    onlineEl.innerHTML = "";
    if (quickFoods) quickFoods.style.display = q ? "none" : "block";
    const results = searchFoods(searchEl.value);
    resultsEl.innerHTML = results.length
      ? results
          .map((f, idx) => {
            const sv = f.serving ? scaleMacros(f, f.serving.g) : f;
            return `<li class="result" data-idx="${idx}">
                 <div><strong>${f.name}</strong>${f.recipe ? ' <em class="tag">recipe</em>' : ""}<span class="muted small"> ${f.serving ? f.serving.label : ""}</span></div>
                 <span class="muted">${Math.round(f.kcal)} kcal/100g</span>
               </li>`;
          })
          .join("")
      : searchEl.value.trim()
      ? `<li class="muted">No match — use Quick Add or Recipe Builder below.</li>`
      : "";
    resultsEl._results = results;
  });
  resultsEl.addEventListener("click", (e) => {
    const li = e.target.closest(".result");
    if (!li) return;
    const food = resultsEl._results[+li.dataset.idx];
    if (food) openFoodDetail(food);
  });

  onlineBtn.addEventListener("click", async () => {
    const q = searchEl.value.trim();
    if (!q) return;
    onlineBtn.textContent = "Searching…";
    try {
      const results = await searchFoodsOnline(q);
      onlineEl._results = results;
      onlineEl.innerHTML = results.length
        ? results
            .map(
              (f, idx) =>
                `<li class="result" data-idx="${idx}">
                   <div><strong>${f.name}</strong> <em class="tag">web</em></div>
                   <span class="muted">${Math.round(f.kcal)} kcal/100g</span>
                 </li>`
            )
            .join("")
        : `<li class="muted">No online matches.</li>`;
      onlineBtn.textContent = "🔎 Search again";
    } catch (err) {
      const msg = err.name === "AbortError" ? "Search timed out — check your connection." : `Search failed: ${err.message}`;
      onlineEl.innerHTML = `<li class="muted">${msg} You can use Quick Add or Recipe Builder below.</li>`;
      onlineBtn.textContent = "🔎 Retry";
    }
  });
  onlineEl.addEventListener("click", (e) => {
    const li = e.target.closest(".result");
    if (!li || !onlineEl._results) return;
    const food = onlineEl._results[+li.dataset.idx];
    if (food) openFoodDetail(food);
  });

  // ---- recipe builder ----
  const recSearch = document.getElementById("recipe-search");
  const recResults = document.getElementById("recipe-results");
  recSearch.addEventListener("input", () => {
    const results = searchFoods(recSearch.value);
    recResults.innerHTML = results
      .map((f, idx) => `<li class="result" data-idx="${idx}"><strong>${f.name}</strong><span class="muted small"> ${f.serving ? f.serving.label : ""}</span></li>`)
      .join("");
    recResults._results = results;
  });
  recResults.addEventListener("click", (e) => {
    const li = e.target.closest(".result");
    if (!li) return;
    const food = recResults._results[+li.dataset.idx];
    _recipeDraft.push({ food, grams: (food.serving && food.serving.g) || 100 });
    recSearch.value = "";
    recResults.innerHTML = "";
    renderRecipeDraft();
  });
  renderRecipeDraft();
  document.getElementById("recipe-save").addEventListener("click", () => {
    const name = document.getElementById("recipe-name").value.trim();
    if (saveRecipe(name)) {
      alert(`Saved "${name}" — search for it to log any amount.`);
      renderLogTab();
    } else {
      alert("Add a name and at least one ingredient first.");
    }
  });

  // ---- quick add ----
  document.getElementById("quick-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const grams = +fd.get("grams") || 100;
    const totals = {
      name: fd.get("name").trim(),
      grams,
      kcal: +fd.get("kcal") || 0,
      protein: +fd.get("protein") || 0,
      carbs: +fd.get("carbs") || 0,
      fats: +fd.get("fats") || 0,
      sugar: +fd.get("sugar") || 0,
      fiber: +fd.get("fiber") || 0,
      sodium: +fd.get("sodium") || 0,
    };
    App.state.active.foods.push(totals);
    if (fd.get("save")) {
      const per100 = { name: totals.name, serving: { label: `${grams} g`, g: grams } };
      ["kcal", "protein", "carbs", "fats", "sugar", "fiber", "sodium"].forEach((k) => {
        per100[k] = +((totals[k] / grams) * 100).toFixed(2);
      });
      const known = [...FOODS, ...App.state.customFoods].some((f) => f.name.toLowerCase() === totals.name.toLowerCase());
      if (!known) App.state.customFoods.push(per100);
      recordRecent(per100);
    }
    if (window.Gamify) Gamify.onFood();
    App.save();
    renderLogTab();
  });

  root.querySelector(".logged").addEventListener("click", (e) => {
    const del = e.target.closest(".del");
    if (del) { removeFoodFromToday(+del.dataset.i); return; }
    const star = e.target.closest(".fav-star");
    if (star) { toggleFavorite(per100FromEntry(App.state.active.foods[+star.dataset.i])); renderLogTab(); }
  });

  // ---- quick foods (recents + favorites, one-tap re-log) ----
  if (quickFoods) quickFoods.addEventListener("click", (e) => {
    const chip = e.target.closest(".qf-chip");
    if (!chip) return;
    const list = chip.dataset.kind === "fav" ? App.state.favoriteFoods : App.state.recentFoods;
    const food = (list || [])[+chip.dataset.i];
    if (food) openFoodDetail(food);
  });

  document.getElementById("scan-btn").addEventListener("click", () => initBarcodeScanner());
  document.getElementById("snap-meal").addEventListener("click", () => openPhotoLog());
}

function renderQuickFoods() {
  const host = document.getElementById("quick-foods");
  if (!host) return;
  const favs = App.state.favoriteFoods || [];
  const recents = App.state.recentFoods || [];
  let html = "";
  if (favs.length)
    html += `<div class="qf-label">★ Favorites</div><div class="qf-chips">` +
      favs.map((f, i) => `<button class="qf-chip" data-kind="fav" data-i="${i}">${f.name}</button>`).join("") + `</div>`;
  if (recents.length)
    html += `<div class="qf-label">🕘 Recent</div><div class="qf-chips">` +
      recents.map((f, i) => `<button class="qf-chip" data-kind="rec" data-i="${i}">${f.name}</button>`).join("") + `</div>`;
  if (!html)
    html = `<p class="muted small">Log a food, snap a photo, or scan a barcode to begin — your recent & favorite foods will appear here for one-tap re-logging.</p>`;
  host.innerHTML = html;
}

function renderRecipeDraft() {
  const list = document.getElementById("recipe-draft");
  const totalsEl = document.getElementById("recipe-totals");
  if (!list) return;
  list.innerHTML = _recipeDraft
    .map(
      (it, i) => `<li class="rd-item">
        <span class="rd-name">${it.food.name}</span>
        <input class="rd-grams" type="number" min="1" data-i="${i}" value="${it.grams}"> g
        <button class="del rd-del" data-i="${i}">✕</button>
      </li>`
    )
    .join("");
  const { totalG, sum } = recipeTotals();
  totalsEl.innerHTML = _recipeDraft.length
    ? `<strong>${Math.round(sum.kcal)} kcal</strong> · ${sum.protein.toFixed(0)}P ${sum.carbs.toFixed(0)}C ${sum.fats.toFixed(0)}F · ${Math.round(totalG)} g total`
    : `<span class="muted small">No ingredients yet.</span>`;

  list.querySelectorAll(".rd-grams").forEach((inp) =>
    inp.addEventListener("input", (e) => {
      _recipeDraft[+e.target.dataset.i].grams = +e.target.value || 0;
      const { totalG, sum } = recipeTotals();
      totalsEl.innerHTML = `<strong>${Math.round(sum.kcal)} kcal</strong> · ${sum.protein.toFixed(0)}P ${sum.carbs.toFixed(0)}C ${sum.fats.toFixed(0)}F · ${Math.round(totalG)} g total`;
    })
  );
  list.querySelectorAll(".rd-del").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      _recipeDraft.splice(+e.target.dataset.i, 1);
      renderRecipeDraft();
    })
  );
}
