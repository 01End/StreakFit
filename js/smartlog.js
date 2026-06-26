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

  const pub = {
    DEFAULT_MODEL, PORTIONS, NUMBER_WORDS,
    parseLocal, unitToGrams, scoreSuggestion,
  };
  window.SmartLog = pub;
  return pub;
})();
