/* StreakFit — Body measurements tracker.
 * Logs waist/chest/arms/thighs/hips/bodyFat/leanMass to App.state.measurements[].
 * Lean mass = weightKg × (1 - bodyFat/100).
 * Body fat can be entered directly or estimated via App.navyBodyFat().
 */
const Measurements = {

  log(entry) {
    const p = App.state.profile;
    const w = (p && p.weightKg) ? p.weightKg : null;
    const bf = entry.bodyFat || (p ? App.navyBodyFat({
      gender: p.gender,
      heightCm: p.heightCm,
      neckCm: entry.neck || p.neckCm,
      waistCm: entry.waist,
      hipCm:   entry.hips || p.hipCm,
    }) : null);
    const leanMass = (w && bf) ? +(w * (1 - bf / 100)).toFixed(1) : null;

    const record = {
      date:     App.todayStr(),
      weightKg: w,
      waist:    entry.waist     || null,
      chest:    entry.chest     || null,
      arms:     entry.arms      || null,
      thighs:   entry.thighs    || null,
      hips:     entry.hips      || null,
      neck:     entry.neck      || null,
      bodyFat:  bf              ? +bf.toFixed(1) : null,
      leanMass,
    };

    const arr = App.state.measurements || (App.state.measurements = []);
    const todayIdx = arr.findIndex(r => r.date === record.date);
    if (todayIdx >= 0) arr[todayIdx] = record; else arr.push(record);
    App.save();

    const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
    if (prev && leanMass && prev.leanMass && leanMass > prev.leanMass && p && p.weightKg < (prev.weightKg || p.weightKg + 0.1)) {
      return { recomp: true, leanMass, prevLeanMass: prev.leanMass };
    }
    return { recomp: false, leanMass };
  },

  latest() {
    const arr = App.state.measurements || [];
    return arr.length ? arr[arr.length - 1] : null;
  },

  renderSection(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const latest = this.latest();
    const history = (App.state.measurements || []).slice(-10).reverse();

    container.innerHTML = `
      <div style="font-size:16px;font-weight:800;letter-spacing:-0.03em;margin-bottom:12px">Body Measurements</div>
      <div class="card" style="padding:16px">
        <div class="measurements-grid">
          ${['waist','chest','arms','thighs','hips','neck'].map(f => `
            <div class="meas-input-row">
              <label>${f} (cm)</label>
              <input type="number" step="0.1" id="meas-${f}" placeholder="—" value="${latest && latest[f] ? latest[f] : ''}">
            </div>`).join('')}
          <div class="meas-input-row" style="grid-column:span 2">
            <label>Body fat % (optional — leave blank to estimate)</label>
            <input type="number" step="0.1" id="meas-bodyFat" placeholder="auto-estimate" value="${latest && latest.bodyFat ? latest.bodyFat : ''}">
          </div>
        </div>
        ${latest && latest.leanMass ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:10px">Last lean mass: <span class="meas-lean-badge">${latest.leanMass} kg lean</span></div>` : ''}
        <button class="btn-primary" onclick="Measurements._save()">Save measurements</button>
      </div>
      ${history.length ? `
      <div style="font-size:13px;font-weight:700;margin:16px 0 8px;color:rgba(255,255,255,0.5)">History</div>
      <div class="card" style="padding:0 16px">
        ${history.map(r => `
          <div class="meas-history-row">
            <span class="meas-history-date">${r.date}</span>
            <span>${r.waist ? r.waist+'cm waist' : ''} ${r.bodyFat ? '· '+r.bodyFat+'% bf' : ''}</span>
            ${r.leanMass ? `<span class="meas-lean-badge">${r.leanMass}kg lean</span>` : ''}
          </div>`).join('')}
      </div>` : ''}`;
  },

  _save() {
    const val = id => +document.getElementById(id)?.value || null;
    const entry = {
      waist: val('meas-waist'), chest: val('meas-chest'), arms: val('meas-arms'),
      thighs: val('meas-thighs'), hips: val('meas-hips'), neck: val('meas-neck'),
      bodyFat: val('meas-bodyFat'),
    };
    const result = Measurements.log(entry);
    App.haptic('medium');
    if (result.recomp) {
      const msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;top:30%;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(0,220,180,0.9);color:#000;padding:14px 24px;border-radius:16px;font-weight:800;font-size:14px;text-align:center';
      msg.textContent = 'Recomp in progress — lean mass is rising while you lose fat!';
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 3500);
    }
    Measurements.renderSection('measurements-section');
  },
};
window.Measurements = Measurements;
