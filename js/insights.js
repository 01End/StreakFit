/* StreakFit — Insights & Reports: turns daily history into coaching metrics.
 * Pure analytics core (_computeFrom / compute) is DOM-free and unit-tested via
 * window._InsightsTests(). Rendering + optional AI are added in later tasks.
 * Owns no state — reads App.state.{history,weights,profile,settings,gamify}.
 */
const Insights = (() => {
  const DEFAULT_MODEL = 'meta-llama/llama-4-maverick:free';

  /* ---------- pure date/math helpers ---------- */
  function _stdev(arr) {
    if (!arr.length) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v);
  }
  function _daysAgoStr(today, n) {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  function _dayDiff(a, b) { // whole days from a -> b
    const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }
  function _weekdayName(ds) {
    return new Date(ds + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  }

  /* ---------- pure analytics core ---------- */
  // history: [{date,kcal,protein,sugar,target,metGoal,waterMl,steps,sleepHours,...}]
  // weights: [{date,kg}]   profile: {calorieTarget,proteinMinG,goalWeightKg,weightKg,...}
  function _computeFrom(history, weights, profile, windowDays, today) {
    history = Array.isArray(history) ? history : [];
    weights = Array.isArray(weights) ? weights : [];
    profile = profile || {};
    const target = profile.calorieTarget || 0;
    const proteinMin = profile.proteinMinG || 0;

    const cutoff = _daysAgoStr(today, windowDays - 1); // inclusive lower bound
    const inWin = history.filter(h => h.date >= cutoff && h.date <= today);

    // elapsed days the app could have logged, capped at windowDays (so new users aren't penalized)
    let daysInWindow = windowDays;
    if (history.length) {
      const firstDate = history.reduce((m, h) => (h.date < m ? h.date : m), history[0].date);
      const elapsed = _dayDiff(firstDate, today) + 1;
      daysInWindow = Math.max(1, Math.min(windowDays, elapsed));
    }

    const logged = inWin.filter(h => (h.kcal || 0) > 0);
    const daysLogged = logged.length;
    const adherencePct = daysInWindow ? Math.round((daysLogged / daysInWindow) * 100) : 0;
    const goalDays = inWin.filter(h => h.metGoal).length;

    const kcals = logged.map(h => h.kcal || 0);
    const avgKcal = kcals.length ? Math.round(kcals.reduce((a, b) => a + b, 0) / kcals.length) : 0;
    const kcalVariance = kcals.length ? Math.round(_stdev(kcals)) : 0;

    const proteinHits = proteinMin > 0 ? logged.filter(h => (h.protein || 0) >= proteinMin).length : 0;
    const proteinHitRate = daysLogged ? Math.round((proteinHits / daysLogged) * 100) : 0;

    const winWeights = weights.filter(w => w.date >= cutoff && w.date <= today)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const weightChangeKg = winWeights.length >= 2
      ? +(winWeights[winWeights.length - 1].kg - winWeights[0].kg).toFixed(1) : 0;

    const curWeight = winWeights.length ? winWeights[winWeights.length - 1].kg : (profile.weightKg || 0);
    let projection = { onTrack: null, note: 'Log 2+ weigh-ins to track progress' };
    if (profile.goalWeightKg && winWeights.length >= 2 && curWeight) {
      const wantLoss = profile.goalWeightKg < curWeight;
      const onTrack = wantLoss ? weightChangeKg < 0 : weightChangeKg > 0;
      projection = { onTrack, note: onTrack ? 'On track' : 'Off track' };
    }

    let bestDay = null, worstDay = null;
    if (logged.length && target > 0) {
      const scored = logged.map(h => ({
        date: h.date, kcal: Math.round(h.kcal), dist: Math.abs((h.kcal || 0) - target),
      })).sort((a, b) => a.dist - b.dist);
      bestDay = { date: scored[0].date, kcal: scored[0].kcal };
      worstDay = { date: scored[scored.length - 1].date, kcal: scored[scored.length - 1].kcal };
    }

    let wdTot = 0, wdLog = 0, weTot = 0, weLog = 0;
    for (let i = 0; i < daysInWindow; i++) {
      const ds = _daysAgoStr(today, i);
      const dow = new Date(ds + 'T00:00:00').getDay(); // 0 Sun .. 6 Sat
      const isWeekend = dow === 0 || dow === 6;
      const did = inWin.some(h => h.date === ds && (h.kcal || 0) > 0);
      if (isWeekend) { weTot++; if (did) weLog++; } else { wdTot++; if (did) wdLog++; }
    }
    const weekdayRate = wdTot ? Math.round((wdLog / wdTot) * 100) : 0;
    const weekendRate = weTot ? Math.round((weLog / weTot) * 100) : 0;
    const mostConsistent = weekdayRate === weekendRate ? 'even'
      : (weekdayRate > weekendRate ? 'weekdays' : 'weekends');

    const steps = logged.map(h => h.steps || 0).filter(v => v > 0);
    const avgSteps = steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null;
    const sleeps = inWin.map(h => h.sleepHours).filter(v => v);
    const avgSleep = sleeps.length ? +(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : null;

    return {
      windowDays, daysInWindow, daysLogged, adherencePct, goalDays,
      avgKcal, targetKcal: target, kcalVariance,
      proteinHits, proteinHitRate,
      weightChangeKg, projection, bestDay, worstDay,
      weekdayRate, weekendRate, mostConsistent, avgSteps, avgSleep,
    };
  }

  // App-bound wrapper (used by the UI; tests call _computeFrom directly with fixtures)
  function compute(windowDays) {
    const s = (window.App && App.state) || {};
    return _computeFrom(s.history, s.weights, s.profile, windowDays,
      (window.App && App.todayStr()) || _daysAgoStr('1970-01-01', 0));
  }

  /* ---------- templated weekly recap (last 7 days) ---------- */
  function _weeklyReportFrom(history, weights, profile, gamifyStats, today) {
    const m = _computeFrom(history, weights, profile, 7, today);
    const workouts = (gamifyStats && gamifyStats.workouts) || 0;
    const wd = m.weightChangeKg;
    const wStr = wd === 0 ? 'no change' : (wd < 0 ? `▼ ${Math.abs(wd)} kg` : `▲ ${wd} kg`);
    const bestStr = m.bestDay ? _weekdayName(m.bestDay.date) : '—';
    const lines = [
      `Logged ${m.daysLogged}/${m.daysInWindow} days`,
      `Avg ${m.avgKcal} kcal` + (m.targetKcal ? ` (target ${m.targetKcal})` : ''),
      `Weight ${wStr}`,
      `Workouts ${workouts}`,
      `Protein goal hit ${m.proteinHits}/${m.daysLogged} days`,
      `Best day ${bestStr}`,
    ];
    const headline = m.daysLogged >= 6 ? 'Strong, consistent week.'
      : m.daysLogged >= 3 ? 'Solid week — keep it going.'
      : 'A few logs in — build the habit this week.';
    return { metrics: m, workouts, lines, headline };
  }
  function weeklyReport() {
    const s = (window.App && App.state) || {};
    const gstats = (s.gamify && s.gamify.stats) || { workouts: 0 };
    return _weeklyReportFrom(s.history, s.weights, s.profile, gstats,
      (window.App && App.todayStr()) || _daysAgoStr('1970-01-01', 0));
  }

  /* ---------- optional AI deeper analysis (key-gated, graceful) ---------- */
  async function aiReport(metrics) {
    const key = (App.state.settings || {}).openrouterKey || '';
    if (!key) return { ok: false, reason: 'no-key' };
    try {
      const model = (App.state.settings || {}).aiTextModel || DEFAULT_MODEL;
      const facts = [
        `window ${metrics.windowDays}d`,
        `logged ${metrics.daysLogged}/${metrics.daysInWindow}`,
        `adherence ${metrics.adherencePct}%`,
        `avg ${metrics.avgKcal} kcal (target ${metrics.targetKcal})`,
        `variance ${metrics.kcalVariance}`,
        `protein hit ${metrics.proteinHitRate}%`,
        `weight change ${metrics.weightChangeKg} kg`,
        `most consistent ${metrics.mostConsistent}`,
      ].join('; ');
      const resp = await _fetchTimeout('https://openrouter.ai/api/v1/chat/completions', 12000, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content:
            `You are a supportive fitness coach. Based ONLY on these weekly stats, write 2-3 short ` +
            `sentences of encouragement and ONE concrete, actionable tip. No markdown, no lists, ` +
            `under 60 words.\n\nStats: ${facts}` }],
          max_tokens: 160,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (!text) return { ok: false, reason: 'empty' };
      return { ok: true, text };
    } catch (_) {
      return { ok: false, reason: 'error' };
    }
  }

  /* ---------- rendering ---------- */
  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _pill(big, label) {
    return `<div class="prog-pill"><b>${big}</b><span>${label}</span></div>`;
  }
  function _gridHTML(m) {
    if (!m.daysLogged) {
      return `<div class="muted small" style="padding:8px 0">Log a few days to see your insights here.</div>`;
    }
    const projStr = m.projection.onTrack === null ? '—'
      : (m.projection.onTrack ? '<span class="v-good">on track</span>' : '<span class="v-bad">off track</span>');
    const wd = m.weightChangeKg;
    const wStr = wd === 0 ? '—' : (wd < 0 ? `▼ ${Math.abs(wd)}` : `▲ ${wd}`);
    const bestStr = m.bestDay ? _weekdayName(m.bestDay.date) : '—';
    const worstStr = m.worstDay ? _weekdayName(m.worstDay.date) : '—';
    return `<div class="prog-grid">
      ${_pill(`${m.adherencePct}%`, `adherence (${m.daysLogged}/${m.daysInWindow})`)}
      ${_pill(`${m.goalDays}`, 'goal days')}
      ${_pill(`${m.avgKcal}`, `avg kcal ±${m.kcalVariance}`)}
      ${_pill(`${m.proteinHitRate}%`, 'protein hit')}
      ${_pill(`${wStr} kg`, projStr)}
      ${_pill(`${bestStr}/${worstStr}`, 'best / worst')}
      ${_pill(m.mostConsistent, `wk ${m.weekdayRate}% · wkend ${m.weekendRate}%`)}
      ${_pill(m.avgSteps != null ? m.avgSteps : '—', 'avg steps')}
    </div>`;
  }
  function _reportHTML(rep) {
    const hasKey = !!((window.App && App.state.settings || {}).openrouterKey);
    const aiBtn = hasKey
      ? `<button id="insights-ai-btn" class="btn-ghost small"><i class="fa-solid fa-wand-magic-sparkles"></i> Deeper analysis</button>`
      : '';
    return `<div class="insights-report">
      <div class="ins-rep-head">${_esc(rep.headline)}</div>
      <ul class="ins-rep-list">
        ${rep.lines.map(l => `<li>${_esc(l)}</li>`).join('')}
      </ul>
      <div class="ins-rep-actions">
        <button id="insights-share-btn" class="btn-ghost small"><i class="fa-solid fa-share-nodes"></i> Share recap</button>
        ${aiBtn}
      </div>
      <div id="insights-ai-out" class="ins-ai-out"></div>
    </div>`;
  }
  function renderPanel(windowDays) {
    const m = compute(windowDays);
    const rep = weeklyReport();
    const tog = (d, lbl) =>
      `<button class="${windowDays === d ? 'active' : ''}" onclick="App._renderInsights(${d})">${lbl}</button>`;
    return `<div class="insights-block">
      <div class="chart-toggle insights-toggle">
        ${tog(7, '7d')}${tog(30, '30d')}${tog(90, '90d')}
      </div>
      <div id="insights-grid">${_gridHTML(m)}</div>
      ${_reportHTML(rep)}
    </div>`;
  }
  function _bind(root) {
    const shareBtn = root.querySelector('#insights-share-btn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const rep = weeklyReport();
      const text = `StreakFit — this week\n${rep.headline}\n• ` + rep.lines.join('\n• ');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      shareBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
      setTimeout(() => { shareBtn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share recap'; }, 1400);
    });
    const aiBtn = root.querySelector('#insights-ai-btn');
    if (aiBtn) aiBtn.addEventListener('click', async () => {
      const out = root.querySelector('#insights-ai-out');
      aiBtn.disabled = true;
      aiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing…';
      const r = await aiReport(compute(7));
      aiBtn.disabled = false;
      aiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Deeper analysis';
      if (out) out.innerHTML = r.ok
        ? `<div class="ins-ai">${_esc(r.text)}</div>`
        : `<div class="muted small">Couldn't reach AI — your recap above is still complete.</div>`;
    });
  }

  /* ---------- test harness (browser console) ---------- */
  function _assertEq(label, got, want) {
    if (got !== want) throw new Error(`FAIL ${label}: got ${got}, want ${want}`);
    console.log(`PASS ${label}`);
  }
  function _InsightsTests() {
    const today = '2026-06-27'; // a Saturday
    const profile = { calorieTarget: 2000, proteinMinG: 150, goalWeightKg: 80, weightKg: 85 };
    // 7-day window ending today: log 5 of the last 7 days
    const hist = [
      { date: '2026-06-21', kcal: 0,    protein: 0,   metGoal: false }, // Sun, not logged
      { date: '2026-06-22', kcal: 2100, protein: 160, metGoal: true,  steps: 9000, sleepHours: 7 }, // Mon
      { date: '2026-06-23', kcal: 1900, protein: 140, metGoal: true,  steps: 7000, sleepHours: 8 }, // Tue
      { date: '2026-06-24', kcal: 2000, protein: 155, metGoal: true,  steps: 5000 }, // Wed (closest to target)
      { date: '2026-06-25', kcal: 2600, protein: 120, metGoal: false }, // Thu (furthest)
      { date: '2026-06-26', kcal: 1950, protein: 151, metGoal: true }, // Fri
      // Sat (today) not in history yet
    ];
    const weights = [{ date: '2026-06-22', kg: 85 }, { date: '2026-06-26', kg: 84.2 }];
    const m = _computeFrom(hist, weights, profile, 7, today);

    _assertEq('daysLogged', m.daysLogged, 5);
    _assertEq('daysInWindow', m.daysInWindow, 7);
    _assertEq('adherencePct', m.adherencePct, 71); // round(5/7*100)
    _assertEq('goalDays', m.goalDays, 4);
    _assertEq('proteinHits', m.proteinHits, 3); // 160,155,151 >= 150; 140,120 < 150 → 3
    _assertEq('bestDayDate', m.bestDay.date, '2026-06-24');
    _assertEq('worstDayDate', m.worstDay.date, '2026-06-25');
    _assertEq('weightChangeKg', m.weightChangeKg, -0.8);
    _assertEq('projOnTrack', m.projection.onTrack, true);

    // zero-data must never produce NaN
    const z = _computeFrom([], [], {}, 30, today);
    _assertEq('zero adherence', z.adherencePct, 0);
    _assertEq('zero avgKcal', z.avgKcal, 0);
    _assertEq('zero variance', z.kcalVariance, 0);
    _assertEq('zero bestDay', z.bestDay, null);

    // weekly report (pure)
    const rep = _weeklyReportFrom(hist, weights, profile, { workouts: 3 }, today);
    _assertEq('report workouts', rep.workouts, 3);
    _assertEq('report has lines', rep.lines.length > 0, true);
    _assertEq('report protein line', rep.lines.some(l => l.indexOf('Protein') === 0), true);

    console.log('✅ All Insights tests passed.');
  }
  if (typeof window !== 'undefined') window._InsightsTests = _InsightsTests;

  const pub = {
    DEFAULT_MODEL,
    _computeFrom, compute,
    _weeklyReportFrom, weeklyReport,
    aiReport,
    renderPanel, _gridHTML, _bind,
    _daysAgoStr, _weekdayName,
  };
  if (typeof window !== 'undefined') window.Insights = pub;
  return pub;
})();
