/* StreakFit — Log tab: food search over FOODS + customFoods, and Quick Add.
 * Adds chosen foods to App.state.active.foods and refreshes the dashboard totals.
 */
function searchFoods(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pool = [...FOODS, ...App.state.customFoods];
  const matches = pool.filter((f) => f.name.toLowerCase().includes(q));
  // Prefix matches rank first, then alphabetical.
  matches.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return matches.slice(0, 25);
}

function addFoodToToday(food) {
  App.state.active.foods.push({
    name: food.name,
    kcal: +food.kcal || 0,
    protein: +food.protein || 0,
    carbs: +food.carbs || 0,
    fats: +food.fats || 0,
    sugar: +food.sugar || 0,
  });
  App.save();
}

function removeFoodFromToday(index) {
  App.state.active.foods.splice(index, 1);
  App.save();
  renderLogTab();
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
      <p class="muted small">Type a food, or paste macros Claude estimated for you in chat. Saved for next time.</p>
      <form id="quick-add">
        <label>Food Name<input name="name" required placeholder="e.g. Mom's machboos"></label>
        <div class="grid-2">
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
                    `<li><span>${f.name}</span><span class="muted">${Math.round(f.kcal)} kcal</span><button class="del" data-i="${i}">✕</button></li>`
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
      addFoodToToday(food);
      searchEl.value = "";
      resultsEl.innerHTML = "";
      renderLogTab();
    }
  });

  document.getElementById("quick-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const food = {
      name: fd.get("name").trim(),
      kcal: +fd.get("kcal") || 0,
      protein: +fd.get("protein") || 0,
      carbs: +fd.get("carbs") || 0,
      fats: +fd.get("fats") || 0,
      sugar: +fd.get("sugar") || 0,
      serving: "custom",
    };
    addFoodToToday(food);
    // Remember it for future searches if not already known.
    const known = [...FOODS, ...App.state.customFoods].some(
      (f) => f.name.toLowerCase() === food.name.toLowerCase()
    );
    if (!known) App.state.customFoods.push(food);
    App.save();
    renderLogTab();
  });

  root.querySelector(".logged").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (btn) removeFoodFromToday(+btn.dataset.i);
  });

  document.getElementById("scan-btn").addEventListener("click", () => initBarcodeScanner());
}
