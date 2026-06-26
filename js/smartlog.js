/* StreakFit — Smart AI Logging
 * Natural-language meal logging + "What can I eat?" suggestions.
 * Stage 1 (parse): text → [{name,qty,unit}]
 * Stage 2 (resolve): item → {food(per-100g), grams, entry, _source}
 * All state lives in App.state; no persistent state added here.
 */
const SmartLog = (() => {
  const DEFAULT_MODEL = 'meta-llama/llama-4-maverick:free';

  // Portion table keyed by unit name or food-name keyword (grams per 1 each)
  const PORTIONS = {
    // unit-based
    cup: 240, cups: 240,
    bowl: 300,
    tbsp: 15, tablespoon: 15,
    tsp: 5, teaspoon: 5,
    scoop: 30,
    handful: 30,
    slice: 30, slices: 30,
    piece: 60, pieces: 60,
    glass: 240,
    // food-name keywords (matched against item.name)
    egg: 50, eggs: 50,
    banana: 120,
    apple: 180,
    orange: 150,
    bread: 30,
    tortilla: 40,
    chapati: 50,
    roti: 50,
    cookie: 15,
    pancake: 45,
  };

  const NUMBER_WORDS = {
    half: 0.5, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4,
    five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };

  // Pure: string → [{name, qty, unit}]
  function parseLocal(text) {
    const fragments = text.toLowerCase()
      .split(/,|(?:\band\b)|&|\n/)
      .map(s => s.trim())
      .filter(Boolean);

    return fragments.map(frag => {
      // Numeric qty + optional unit + name
      let m = frag.match(/^(\d+(?:\.\d+)?)\s*(g|kg|oz|ml|cup|cups|bowl|slice|slices|tbsp|tsp|scoop|handful|piece|pieces|glass)?\s+(.+)$/);
      if (m) return { qty: +m[1], unit: m[2] || 'each', name: m[3].trim() };

      // Number word + optional unit + name
      m = frag.match(/^(half|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*(g|kg|oz|ml|cup|cups|bowl|slice|slices|tbsp|tsp|scoop|handful|piece|pieces|glass)?\s+(.+)$/);
      if (m) return { qty: NUMBER_WORDS[m[1]] || 1, unit: m[2] || 'each', name: m[3].trim() };

      // No qty — default 1 each
      return { qty: 1, unit: 'each', name: frag };
    }).filter(item => item.name.length > 0);
  }

  // Pure: (qty, unit, food) → grams (number)
  function unitToGrams(qty, unit, food) {
    const u = (unit || 'each').toLowerCase();
    if (u === 'g')  return +(qty).toFixed(1);
    if (u === 'kg') return +(qty * 1000).toFixed(1);
    if (u === 'oz') return +(qty * 28.35).toFixed(1);
    if (u === 'ml') return +(qty * 1).toFixed(1);
    // Food has its own serving size
    if (food && food.serving && food.serving.g) return +(qty * food.serving.g).toFixed(1);
    // Unit-based lookup (cup, bowl, tbsp, etc.)
    if (PORTIONS[u] && u !== 'each') return +(qty * PORTIONS[u]).toFixed(1);
    // Per-food keyword lookup for 'each' / count units
    if (food && food.name) {
      const nameLow = food.name.toLowerCase();
      for (const [key, grams] of Object.entries(PORTIONS)) {
        if (nameLow.includes(key)) return +(qty * grams).toFixed(1);
      }
    }
    return +(qty * 100).toFixed(1); // fallback: 1 each = 100g
  }

  // Pure: (food, remainingKcal, remainingProtein, hour) → score number
  function scoreSuggestion(food, remainingKcal, remainingProtein, hour) {
    const portionG = (food.serving && food.serving.g) || 100;
    const m = scaleMacros(food, portionG);
    let score = 0;
    if (m.kcal <= remainingKcal) score += 20; else score -= 10;
    if (remainingProtein > 0) score += Math.min(m.protein / Math.max(remainingProtein, 1), 1) * 30;
    if (hour < 10 && m.kcal < 300) score += 5;
    if (hour >= 12 && hour < 14 && m.kcal >= 300) score += 5;
    return score;
  }

  // ---- inline test harness (call window._SmartLogTests() from browser console) ----
  function _assertEqual(label, got, expected) {
    const g = JSON.stringify(got), e = JSON.stringify(expected);
    if (g !== e) throw new Error(`FAIL ${label}: got ${g}, expected ${e}`);
    console.log(`PASS ${label}`);
  }

  function _SmartLogTests() {
    // parseLocal basics
    const r1 = parseLocal('2 eggs and a banana');
    _assertEqual('parseLocal count', r1.length, 2);
    _assertEqual('parseLocal qty',   r1[0].qty, 2);
    _assertEqual('parseLocal name',  r1[0].name, 'eggs');
    _assertEqual('parseLocal banana', r1[1].name, 'banana');
    _assertEqual('parseLocal banana qty', r1[1].qty, 1);
    _assertEqual('parseLocal banana unit', r1[1].unit, 'each');

    // parseLocal with units
    const r2 = parseLocal('100g chicken, 2 cups rice');
    _assertEqual('parseLocal g', r2[0].unit, 'g');
    _assertEqual('parseLocal cups', r2[1].unit, 'cups');
    _assertEqual('parseLocal g qty', r2[0].qty, 100);

    // parseLocal number word
    const r3 = parseLocal('three tbsp olive oil');
    _assertEqual('parseLocal number word qty', r3[0].qty, 3);
    _assertEqual('parseLocal number word unit', r3[0].unit, 'tbsp');

    // unitToGrams — mass units
    _assertEqual('utg g',  unitToGrams(200, 'g', {}),  200);
    _assertEqual('utg kg', unitToGrams(0.5, 'kg', {}), 500);
    _assertEqual('utg oz', +unitToGrams(2, 'oz', {}).toFixed(1), 56.7);
    _assertEqual('utg ml', unitToGrams(250, 'ml', {}), 250);

    // unitToGrams — unit table
    _assertEqual('utg tbsp', unitToGrams(2, 'tbsp', {}), 30);
    _assertEqual('utg cup',  unitToGrams(1, 'cup', {}), 240);

    // unitToGrams — food serving
    _assertEqual('utg serving', unitToGrams(2, 'each', { serving: { g: 30 } }), 60);

    // unitToGrams — food keyword
    _assertEqual('utg egg keyword', unitToGrams(1, 'each', { name: 'egg' }), 50);
    _assertEqual('utg banana keyword', unitToGrams(1, 'each', { name: 'banana' }), 120);

    // unitToGrams — fallback
    _assertEqual('utg fallback', unitToGrams(1, 'each', { name: 'mysterious gruel' }), 100);

    // scoreSuggestion — higher protein density wins
    const hP = { kcal: 100, protein: 25, carbs: 0, fats: 0, sugar: 0, fiber: 0, sodium: 0, serving: { g: 100 } };
    const lP = { kcal: 100, protein: 2,  carbs: 0, fats: 0, sugar: 0, fiber: 0, sodium: 0, serving: { g: 100 } };
    const sH = scoreSuggestion(hP, 400, 30, 12);
    const sL = scoreSuggestion(lP, 400, 30, 12);
    if (sH <= sL) throw new Error('FAIL scoreSuggestion protein density');
    console.log('PASS scoreSuggestion protein density');

    console.log('✅ All SmartLog pure-helper tests passed.');
  }
  window._SmartLogTests = _SmartLogTests;

  // Stage 1: text → [{name, qty, unit}]
  async function parse(text) {
    const key = (App.state.settings || {}).openrouterKey || '';
    if (key) {
      try {
        const model = (App.state.settings || {}).aiTextModel || DEFAULT_MODEL;
        const safeText = text.replace(/["\n\r]/g, ' ').slice(0, 300);
        const resp = await _fetchTimeout('https://openrouter.ai/api/v1/chat/completions', 12000, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: `Extract foods from this meal description. Return ONLY a JSON array of objects with keys "name" (string), "qty" (number), "unit" (string). No nutrition. No prose.\n\nMeal: "${safeText}"` }],
            max_tokens: 300,
          }),
        });
        const data = await resp.json();
        const raw = data.choices?.[0]?.message?.content || '';
        const items = JSON.parse(extractPlanJSON(raw));
        if (Array.isArray(items) && items.length > 0) {
          const valid = items.filter(it =>
            it && typeof it.name === 'string' && it.name.trim() &&
            typeof it.qty === 'number'
          ).map(it => ({
            name: it.name.trim(),
            qty: it.qty,
            unit: typeof it.unit === 'string' ? it.unit : 'each',
          }));
          if (valid.length > 0) return valid;
        }
      } catch (_) {
        if (window.App && App._toast) App._toast('Used basic parser.', 'info');
      }
    }
    return parseLocal(text);
  }

  function _nameSim(foodName, query) {
    if (!foodName || !query) return false;
    const fn = foodName.toLowerCase(), q = query.toLowerCase();
    if (fn.includes(q) || q.includes(fn)) return true;
    const firstWord = q.split(/\s+/)[0];
    return firstWord.length > 0 && fn.includes(firstWord);
  }

  // Stage 2: {name, qty, unit} → {food, grams, entry, _source}
  async function resolve(item) {
    const gBase = (food) => unitToGrams(item.qty, item.unit, food);

    // 1. Local DB
    const dbResults = searchFoods(item.name);
    if (dbResults.length > 0) {
      const food = dbResults.find(f => _nameSim(f.name, item.name)) || dbResults[0];
      const grams = Math.max(gBase(food) || 1, 1);
      return { food, grams, entry: scaleMacros(food, grams), _source: 'db' };
    }

    // 2. Online search (always free — OFF + USDA)
    try {
      const onlineResults = await searchFoodsOnline(item.name);
      if (onlineResults.length > 0) {
        const food = onlineResults.find(f => _nameSim(f.name, item.name)) || onlineResults[0];
        const grams = Math.max(gBase(food) || 1, 1);
        return { food, grams, entry: scaleMacros(food, grams), _source: 'online' };
      }
    } catch (_) { /* defensive — searchFoodsOnline uses allSettled internally */ }

    // 3. AI macro estimate (key set only)
    const key = (App.state.settings || {}).openrouterKey || '';
    if (key) {
      try {
        const model = (App.state.settings || {}).aiTextModel || DEFAULT_MODEL;
        const safeName = item.name.replace(/["\n\r]/g, ' ').slice(0, 80);
        const resp = await _fetchTimeout('https://openrouter.ai/api/v1/chat/completions', 12000, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: `Approximate macros per 100g for "${safeName}". Return ONLY JSON: {"kcal":number,"protein":number,"carbs":number,"fats":number,"sugar":number,"fiber":number,"sodium":number}` }],
            max_tokens: 150,
          }),
        });
        const data = await resp.json();
        const raw = data.choices?.[0]?.message?.content || '';
        const macros = JSON.parse(extractPlanJSON(raw));
        if (macros && typeof macros.kcal === 'number') {
          const food = { name: item.name, ...macros, serving: { label: '100 g', g: 100 } };
          const grams = Math.max(gBase(food) || 1, 1);
          return { food, grams, entry: scaleMacros(food, grams), _source: 'ai' };
        }
      } catch (_) { /* fall through to manual */ }
    }

    // 4. Manual (zeros — UI flags this row red)
    const food = { name: item.name, kcal: 0, protein: 0, carbs: 0, fats: 0, sugar: 0, fiber: 0, sodium: 0, serving: { label: '100 g', g: 100 } };
    const grams = Math.max(gBase(food) || 1, 1);
    return { food, grams, entry: scaleMacros(food, grams), _source: 'manual' };
  }

  // Orchestrate parse → resolve all items in parallel
  async function parseAndResolve(text) {
    const items = await parse(text);
    return Promise.all(items.map(item => resolve(item)));
  }

  function _sourceLabel(src) {
    return { db: 'DB', online: 'Online', ai: 'AI', manual: 'Manual' }[src] || src;
  }

  function _previewRowHTML(row, idx) {
    const e = row.entry;
    const isManual = row._source === 'manual';
    return `<div class="sl-row${isManual ? ' sl-manual' : ''}" data-idx="${idx}">
      <span class="sl-name">${row.food.name}</span>
      <label class="sl-grams-label">
        <input class="sl-grams" type="number" min="1" step="1" value="${Math.round(row.grams)}" data-idx="${idx}"> g
      </label>
      <span class="sl-kcal">${Math.round(e.kcal)} kcal</span>
      <span class="sl-macros muted small">${e.protein.toFixed(1)}P · ${e.carbs.toFixed(1)}C · ${e.fats.toFixed(1)}F</span>
      <span class="source-badge source-${row._source}">${_sourceLabel(row._source)}</span>
      <button class="sl-remove" data-idx="${idx}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }

  function _footerHTML(rows) {
    const tot = rows.reduce((acc, r) => {
      acc.kcal += r.entry.kcal; acc.protein += r.entry.protein;
      acc.carbs += r.entry.carbs; acc.fats += r.entry.fats;
      return acc;
    }, { kcal: 0, protein: 0, carbs: 0, fats: 0 });
    const consumed = App.dayTotals ? App.dayTotals().kcal : 0;
    const max = App.dailyMax ? App.dailyMax() : 2000;
    const remaining = Math.round(max - consumed - tot.kcal);
    return `<div class="sl-footer">
      <strong>${Math.round(tot.kcal)} kcal · ${tot.protein.toFixed(1)}P · ${tot.carbs.toFixed(1)}C · ${tot.fats.toFixed(1)}F</strong>
      <span class="muted small">Leaves you ${remaining} kcal today</span>
    </div>
    <div class="sl-btns">
      <button id="sl-log-all" class="btn-primary">Log all</button>
      <button id="sl-cancel" class="btn-ghost">Cancel</button>
    </div>`;
  }

  let _rows = []; // module-level so event handlers can reference after grams edits

  function _renderPreview(rows) {
    _rows = rows;
    const container = document.getElementById('smartlog-preview');
    if (!container) return;

    if (!rows || rows.length === 0) {
      container.innerHTML = App._emptyState
        ? App._emptyState('fa-solid fa-utensils', 'Nothing found', 'Try "2 eggs and toast" or "100g chicken rice".')
        : '<p class="muted small">Nothing found — try "2 eggs and toast".</p>';
      return;
    }

    container.innerHTML =
      rows.map((r, i) => _previewRowHTML(r, i)).join('') +
      _footerHTML(rows);

    // Live grams update — recomputes entry and re-renders footer
    container.querySelectorAll('.sl-grams').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = +inp.dataset.idx;
        const newG = Math.max(+inp.value || 1, 1);
        _rows[idx] = { ..._rows[idx], grams: newG, entry: scaleMacros(_rows[idx].food, newG) };
        const oldFooter = container.querySelector('.sl-footer');
        if (oldFooter) oldFooter.outerHTML = _footerHTML(_rows);
        _bindFooterBtns(container);
      });
    });

    // Remove a row
    container.querySelectorAll('.sl-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        _rows.splice(+btn.dataset.idx, 1);
        _renderPreview(_rows);
      });
    });

    _bindFooterBtns(container);
  }

  function _bindFooterBtns(container) {
    const logBtn = container.querySelector('#sl-log-all');
    if (logBtn) logBtn.addEventListener('click', () => {
      _rows.forEach(r => addScaledFood(r.food, r.grams));
      _rows = [];
      container.innerHTML = '';
      const inp = document.getElementById('smartlog-input');
      if (inp) inp.value = '';
      if (window.renderLogTab) renderLogTab();
      if (window.App && App.renderDashboard) App.renderDashboard();
      if (window.App && App.haptic) App.haptic('medium');
    });

    const cancelBtn = container.querySelector('#sl-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      _rows = [];
      container.innerHTML = '';
    });
  }

  // Public entry point: parse text → resolve → show preview
  async function run(text) {
    if (!text || !text.trim()) return;
    const preview = document.getElementById('smartlog-preview');
    if (preview) preview.innerHTML = '<p class="muted small sl-loading"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing…</p>';
    try {
      const rows = await parseAndResolve(text);
      _renderPreview(rows);
    } catch (_) {
      if (preview) preview.innerHTML = '<p class="muted small">Could not parse — try Quick Add below.</p>';
    }
  }

  const pub = {
    DEFAULT_MODEL, PORTIONS, NUMBER_WORDS,
    parseLocal, unitToGrams, scoreSuggestion,
    parse, resolve, parseAndResolve,
    run, _renderPreview,
  };
  window.SmartLog = pub;
  return pub;
})();
