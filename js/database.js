/* StreakFit — Log tab: food search over FOODS + customFoods, Quick Add (with serving
 * + quantity), barcode prefill, and today's running log.
 */
function searchFoods(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pool = [...FOODS, ...App.state.customFoods];
  const matches = pool.filter((f) => f.name.toLowerCase().includes(q));
  matches.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return matches.slice(0, 25);
}

// Add `qty` servings of a food to today (macros scaled by qty).
function addFoodToToday(food, qty = 1) {
  qty = +qty || 1;
  App.state.active.foods.push({
    name: food.name,
    serving: food.serving || "1 serving",
    qty,
    kcal: (+food.kcal || 0) * qty,
    protein: (+food.protein || 0) * qty,
    carbs: (+food.carbs || 0) * qty,
    fats: (+food.fats || 0) * qty,
    sugar: (+food.sugar || 0) * qty,
  });
  App.save();
}

function removeFoodFromToday(index) {
  App.state.active.foods.splice(index, 1);
  App.save();
  renderLogTab();
}

// Called by the barcode scanner to drop a looked-up product into Quick Add.
function prefillQuickAdd(food) {
  const set = (name, val) => {
    const el = document.querySelector(`#quick-add [name="${name}"]`);
    if (el) el.value = val;
  };
  set("name", food.name);
  set("serving", food.serving || "per 100 g");
  set("kcal", food.kcal);
  set("protein", food.protein);
  set("carbs", food.carbs);
  set("fats", food.fats);
  set("sugar", food.sugar);
  const form = document.getElementById("quick-add");
  if (form) {
    form.closest(".card").scrollIntoView({ behavior: "smooth", block: "center" });
    form.closest(".card").classList.add("flash-card");
    setTimeout(() => form.closest(".card").classList.remove("flash-card"), 1200);
  }
}

function renderLogTab() {
  const root = document.getElementById("view-log");
  const logged = App.state.active.foods;
  root.innerHTML = `
    <h2>Log Food</h2>

    <div class="card">
      <div class="search-row">
        <input id="food-search" class="search" type="search" placeholder="Search foods (e.g. labneh, chicken)…" autocomplete="off">
        <button id="scan-btn" class="btn-scan" title="Scan barcode">📷</button>
      </div>
      <ul id="search-results" class="results"></ul>
    </div>

    <div class="card">
      <h3>➕ Quick Add</h3>
      <p class="muted small">Type a food, scan a barcode, or paste macros Claude estimated for you. Saved for next time.</p>
      <form id="quick-add">
        <label>Food Name<input name="name" required placeholder="e.g. Mom's machboos"></label>
        <div class="grid-2">
          <label>Serving<input name="serving" placeholder="e.g. 1 plate / 100 g"></label>
          <label>Quantity (servings)<input name="qty" type="number" step="0.25" value="1"></label>
          <label>Calories<input name="kcal" type="number" step="0.1" required></label>
          <label>Protein (g)<input name="protein" type="number" step="0.1" value="0"></label>
          <label>Carbs (g)<input name="carbs" type="number" step="0.1" value="0"></label>
          <label>Fats (g)<input name="fats" type="number" step="0.1" value="0"></label>
          <label>Sugar (g)<input name="sugar" type="number" step="0.1" value="0"></label>
        </div>
        <button type="submit" class="btn-primary">Add to today</button>
      </form>
    </div>

    <div class="card">
      <h3>Today's Log</h3>
      <ul class="logged">
        ${
          logged.length
            ? logged
                .map(
                  (f, i) =>
                    `<li>
                       <span class="log-name">${f.name}${f.qty && f.qty !== 1 ? ` <em>×${f.qty}</em>` : ""}<span class="muted small log-serving">${f.serving || ""}</span></span>
                       <span class="muted">${Math.round(f.kcal)} kcal</span>
                       <button class="del" data-i="${i}">✕</button>
                     </li>`
                )
                .join("")
            : `<li class="muted">Nothing logged yet.</li>`
        }
      </ul>
    </div>`;

  const searchEl = document.getElementById("food-search");
  const resultsEl = document.getElementById("search-results");
  searchEl.addEventListener("input", () => {
    const results = searchFoods(searchEl.value);
    resultsEl.innerHTML = results.length
      ? results
          .map(
            (f) =>
              `<li class="result" data-name="${encodeURIComponent(f.name)}">
                 <div><strong>${f.name}</strong><span class="muted small"> ${f.serving || ""}</span></div>
                 <span class="muted">${Math.round(f.kcal)} kcal · ${f.protein}P · ${f.sugar}S</span>
               </li>`
          )
          .join("")
      : searchEl.value.trim()
      ? `<li class="muted">No matches — try Quick Add below.</li>`
      : "";
  });

  resultsEl.addEventListener("click", (e) => {
    const li = e.target.closest(".result");
    if (!li) return;
    const name = decodeURIComponent(li.dataset.name);
    const food = [...FOODS, ...App.state.customFoods].find((f) => f.name === name);
    if (food) {
      addFoodToToday(food, 1);
      searchEl.value = "";
      resultsEl.innerHTML = "";
      renderLogTab();
    }
  });

  document.getElementById("quick-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const perServing = {
      name: fd.get("name").trim(),
      serving: (fd.get("serving") || "1 serving").trim(),
      kcal: +fd.get("kcal") || 0,
      protein: +fd.get("protein") || 0,
      carbs: +fd.get("carbs") || 0,
      fats: +fd.get("fats") || 0,
      sugar: +fd.get("sugar") || 0,
    };
    const qty = +fd.get("qty") || 1;
    addFoodToToday(perServing, qty);
    // Remember the per-serving food for future searches if new.
    const known = [...FOODS, ...App.state.customFoods].some(
      (f) => f.name.toLowerCase() === perServing.name.toLowerCase()
    );
    if (!known) App.state.customFoods.push(perServing);
    App.save();
    renderLogTab();
  });

  root.querySelector(".logged").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (btn) removeFoodFromToday(+btn.dataset.i);
  });

  document.getElementById("scan-btn").addEventListener("click", () => initBarcodeScanner());
}
