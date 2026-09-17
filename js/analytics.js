'use strict';

/* =====================================================================
   ANALYTICS VIEW
   Everything here is computed from the shared TelemetryStore: the live
   session recorded by the monitor, or the generated sample dataset.
   ===================================================================== */

const SHIFTS = {
  morning: { label: 'Morning', startH: 6, endH: 14 },
  afternoon: { label: 'Afternoon', startH: 14, endH: 22 },
  night: { label: 'Night', startH: 22, endH: 6 }
};

function formatSpan(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function stateBadge(state) {
  const cls = state === 'LEAK' ? 'badge-leak' : state === 'WARNING' ? 'badge-warning' : 'badge-safe';
  return `<span class="badge ${cls}">${state === 'LEAK' ? 'LEAK' : state}</span>`;
}

function threatChip(threat) {
  return `<span class="threat-chip threat-${threat.toLowerCase()}">${threat}</span>`;
}

class AnalyticsView {
  constructor(telemetry, monitor) {
    this.telemetry = telemetry;
    this.monitor = monitor;
    this.rangeMs = 24 * 3600 * 1000;
    this.shift = 'morning';
    this.visible = false;
    this.refreshTimer = null;
    this.renderQueued = false;

    this.el = (id) => document.getElementById(id);
    this.bindEvents();

    telemetry.onChange(() => this.queueRender());
    window.addEventListener('resize', () => this.queueRender());
  }

  bindEvents() {
    this.el('anRange').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      this.el('anRange').querySelectorAll('.segmented-btn').forEach(b => b.classList.toggle('active', b === btn));
      this.rangeMs = parseInt(btn.dataset.range, 10);
      this.render();
    });

    const loadSample = () => {
      if (this.monitor.isRunning) this.monitor.toggleMonitoring();
      this.telemetry.loadSampleData();
    };
    this.el('anSampleBtn').addEventListener('click', (e) => {
      if (this.telemetry.samples.length && !this.telemetry.isSample) {
        confirmClick(e.currentTarget, 'Replace recorded history?', loadSample);
      } else {
        loadSample();
      }
    });
    this.el('anEmptySampleBtn').addEventListener('click', loadSample);

    this.el('anExportTelemetryBtn').addEventListener('click', () => {
      downloadText(`gasvision_telemetry_${this.fileStamp()}.csv`, this.telemetry.telemetryCsv(Date.now() - this.rangeMs));
    });
    this.el('anExportIncidentsBtn').addEventListener('click', () => {
      downloadText(`gasvision_incidents_${this.fileStamp()}.csv`, this.telemetry.incidentsCsv(Date.now() - this.rangeMs));
    });

    this.el('anShiftTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shift]');
      if (!btn) return;
      this.el('anShiftTabs').querySelectorAll('.segmented-btn').forEach(b => b.classList.toggle('active', b === btn));
      this.shift = btn.dataset.shift;
      this.renderShift();
    });

    document.getElementById('view-analytics').addEventListener('click', (e) => {
      const assess = e.target.closest('[data-assess-incident]');
      if (assess) {
        window.gasVisionRouter.go('hazard', { incidentId: assess.dataset.assessIncident });
        return;
      }
      const open = e.target.closest('[data-open-assessment]');
      if (open) {
        window.gasVisionRouter.go('hazard', { assessmentId: open.dataset.openAssessment });
        return;
      }
      const shiftCsv = e.target.closest('[data-shift-csv]');
      if (shiftCsv) {
        const w = this.shiftWindow(this.shift);
        const csv = this.telemetry.incidentsCsv(w.from);
        downloadText(`gasvision_${this.shift}_shift_${this.fileStamp()}.csv`, csv);
      }
    });
  }

  fileStamp() {
    return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  }

  show() {
    this.visible = true;
    this.render();
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => { if (this.monitor.isRunning) this.render(); }, 4000);
  }

  hide() {
    this.visible = false;
    clearInterval(this.refreshTimer);
  }

  queueRender() {
    if (!this.visible || this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.visible) this.render();
    });
  }

  /* ---------------------------------------------------------------- */

  render() {
    const now = Date.now();
    const from = now - this.rangeMs;
    const t = this.telemetry;
    const samples = t.samplesSince(from);
    const incidents = t.incidentsSince(from);
    const empty = t.samples.length === 0 && t.incidents.length === 0 && t.assessments.length === 0;

    this.el('anEmpty').hidden = !empty;
    this.el('anContent').hidden = empty;

    const badge = this.el('anDataBadge');
    badge.textContent = t.isSample ? 'Sample data' : 'Live data';
    badge.classList.toggle('data-badge-warn', t.isSample);
    this.el('anSampleBtn').hidden = t.isSample;

    if (empty) return;

    const rangeLabel = { 900000: '15 minutes', 3600000: 'hour', 28800000: '8 hours', 86400000: '24 hours' }[this.rangeMs];
    this.el('anSubtitle').textContent = t.isSample
      ? `Generated 24-hour sample dataset. Start monitoring to replace it with live readings.`
      : `Last ${rangeLabel} recorded on this device · ${samples.length.toLocaleString()} readings (every 2 s) · updated ${new Date().toLocaleTimeString()}`;

    this.renderKpis(samples, incidents, from, now);
    this.renderTimeline(samples, incidents, from, now);
    this.renderO2(samples, from, now);
    this.renderExposure(now);
    this.renderIncidents(incidents);
    this.renderZones(incidents);
    this.renderShift();
    this.renderAssessments();
  }

  coverageMs(samples) {
    // Gaps longer than a few sample intervals mean monitoring was stopped
    const cap = this.telemetry.isSample ? 60000 : 6000;
    const step = this.telemetry.isSample ? 30000 : 2000;
    let ms = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].t - samples[i - 1].t;
      ms += dt <= cap ? dt : step;
    }
    return ms;
  }

  renderKpis(samples, incidents, from, now) {
    const latest = this.telemetry.latest();
    const setKpi = (id, value, sub, cls = '') => {
      const el = this.el(id);
      el.innerHTML = value;
      el.className = `kpi-value ${cls}`;
      this.el(`${id}Sub`).textContent = sub;
    };

    if (latest) {
      const running = this.monitor.isRunning;
      setKpi('kpiState', latest.state, running ? `Monitoring · ${latest.src}` : `Last reading ${new Date(latest.t).toLocaleTimeString()}`,
        `kpi-${latest.state.toLowerCase()}`);
      const chem = latest.gas ? CHEMICALS_BY_ID[latest.gas] : null;
      const peakPpm = samples.reduce((a, s) => Math.max(a, s.ppm ?? 0), 0);
      setKpi('kpiGas', latest.ppm !== null && chem ? `${formatPpm(latest.ppm)}` : 'Sensor off',
        chem ? `${chem.name} · peak ${formatPpm(peakPpm)}` : '');
      const minO2 = samples.reduce((a, s) => Math.min(a, s.o2), 20.9);
      setKpi('kpiO2', `${latest.o2.toFixed(2)}%`, `Minimum ${minO2.toFixed(2)}%`, latest.o2 < 19.5 ? 'kpi-warning' : '');
    } else {
      setKpi('kpiState', '–', 'No readings yet');
      setKpi('kpiGas', '–', '');
      setKpi('kpiO2', '–', '');
    }

    const peakConf = samples.reduce((a, s) => Math.max(a, s.conf), 0);
    const meanConf = samples.length ? samples.reduce((a, s) => a + s.conf, 0) / samples.length : 0;
    setKpi('kpiConf', `${Math.round(peakConf * 100)}%`, `Mean ${Math.round(meanConf * 100)}%`,
      peakConf >= 0.55 ? 'kpi-leak' : peakConf >= 0.28 ? 'kpi-warning' : '');

    const leaks = incidents.filter(i => i.maxState === 'LEAK').length;
    const assessed = incidents.filter(i => i.assessment).length;
    setKpi('kpiIncidents', `${incidents.length}`, `${leaks} leak${leaks === 1 ? '' : 's'} · ${assessed} assessed`, incidents.length ? 'kpi-leak' : '');

    const cov = this.coverageMs(samples);
    setKpi('kpiCoverage', formatSpan(cov), `${Math.min(100, Math.round((cov / (now - from)) * 100))}% of range`);
  }

  // Keep charts light: at most one point per ~2 px, preserving peaks
  downsample(samples, buckets) {
    if (samples.length <= buckets) return samples;
    const out = [];
    const size = samples.length / buckets;
    for (let b = 0; b < buckets; b++) {
      const chunk = samples.slice(Math.floor(b * size), Math.floor((b + 1) * size));
      if (!chunk.length) continue;
      let worst = chunk[0];
      for (const s of chunk) if (s.conf > worst.conf || (s.ppm ?? 0) > (worst.ppm ?? 0)) worst = s;
      const minO2 = chunk.reduce((a, s) => Math.min(a, s.o2), 99);
      out.push({ ...worst, t: chunk[Math.floor(chunk.length / 2)].t, o2: minO2 });
    }
    return out;
  }

  gapFor(samples) {
    return this.telemetry.isSample ? 120000 : 10000;
  }

  renderTimeline(samples, incidents, from, now) {
    const canvas = this.el('anTimeline');
    const data = this.downsample(samples, 900);
    const leakBg = cssVar('--leak-bg');
    const warnBg = cssVar('--warning-bg');

    // Shade contiguous alarm periods
    const bands = [];
    let cur = null;
    for (const s of samples) {
      if (s.state === 'SAFE') { cur = null; continue; }
      const color = s.state === 'LEAK' ? leakBg : warnBg;
      if (cur && cur.color === color && s.t - cur.x1 <= this.gapFor()) {
        cur.x1 = s.t + 2000;
      } else {
        cur = { x0: s.t - 2000, x1: s.t + 2000, color };
        bands.push(cur);
      }
    }

    const gasPct = data.map(s => {
      const chem = s.gas ? CHEMICALS_BY_ID[s.gas] : null;
      return [s.t, s.ppm !== null && chem ? (s.ppm / chem.alarm.high) * 100 : null];
    });
    const maxGas = Math.max(100, ...gasPct.map(p => p[1] ?? 0));

    drawLineChart(canvas, {
      x: { min: from, max: now, ticks: timeTicks(from, now), format: v => formatClock(v, now - from) },
      y: { min: 0, max: 100, format: v => `${v}%`, label: 'Confidence' },
      y2: { min: 0, max: Math.ceil(maxGas / 50) * 50, format: v => `${v}%`, label: 'Gas / high alarm' },
      bands,
      thresholds: [
        { y: 55, label: 'LEAK', color: cssVar('--leak') },
        { y: 28, label: 'WARNING', color: cssVar('--warning') }
      ],
      markers: incidents.filter(i => i.start >= from).slice(0, 30).map(i => ({ x: i.start, color: cssVar('--leak') })),
      series: [
        { points: gasPct, color: cssVar('--brand'), width: 1.5, axis: 'y2', gap: this.gapFor() },
        { points: data.map(s => [s.t, s.conf * 100]), color: cssVar('--ink'), width: 1.8, gap: this.gapFor() }
      ]
    });
  }

  renderO2(samples, from, now) {
    const data = this.downsample(samples, 600);
    const minO2 = data.reduce((a, s) => Math.min(a, s.o2), 20.9);
    const lo = Math.min(19, Math.floor((minO2 - 0.3) * 2) / 2);
    drawLineChart(this.el('anO2Chart'), {
      x: { min: from, max: now, ticks: timeTicks(from, now, 4), format: v => formatClock(v, now - from) },
      y: { min: lo, max: 21.5, format: v => `${v.toFixed(1)}%`, label: 'O₂' },
      thresholds: [
        { y: 19.5, label: 'O₂ deficient < 19.5%', color: cssVar('--warning') },
        { y: 16, label: 'Hypoxia < 16%', color: cssVar('--leak') }
      ],
      series: [{ points: data.map(s => [s.t, s.o2]), color: cssVar('--brand'), width: 2, gap: this.gapFor() }]
    });
  }

  /*
    Exposure for a worker standing at the sensor over the last 8 hours.
    TWA divides by the full 8 h (unmonitored time counts as zero exposure);
    STEL is the worst rolling 15-minute time-weighted average.
  */
  renderExposure(now) {
    const table = this.el('anExposureTable');
    const from = now - 8 * 3600 * 1000;
    const samples = this.telemetry.samplesSince(from).filter(s => s.ppm !== null && s.gas);
    const byGas = new Map();
    for (const s of samples) {
      if (!byGas.has(s.gas)) byGas.set(s.gas, []);
      byGas.get(s.gas).push(s);
    }

    if (byGas.size === 0) {
      table.innerHTML = '<tbody><tr><td class="empty-cell">No gas sensor readings in the last 8 hours.</td></tr></tbody>';
      return;
    }

    const maxDt = this.telemetry.isSample ? 60000 : 6000;
    const rows = [];
    for (const [gas, list] of byGas) {
      const chem = CHEMICALS_BY_ID[gas];
      let dose = 0;
      let peak = 0;
      const weighted = [];
      for (let i = 0; i < list.length; i++) {
        const dt = i + 1 < list.length ? Math.min(list[i + 1].t - list[i].t, maxDt) : Math.min(2000, maxDt);
        dose += list[i].ppm * dt;
        peak = Math.max(peak, list[i].ppm);
        weighted.push({ t: list[i].t, dose: list[i].ppm * dt });
      }
      const twa = dose / (8 * 3600 * 1000);

      // Rolling 15-minute window
      let stel = 0, windowDose = 0, j = 0;
      for (let i = 0; i < weighted.length; i++) {
        windowDose += weighted[i].dose;
        while (weighted[i].t - weighted[j].t > 15 * 60000) windowDose -= weighted[j++].dose;
        stel = Math.max(stel, windowDose / (15 * 60000));
      }

      const checks = [];
      if (chem.oelPpm) checks.push({ label: 'TWA', value: twa, limit: chem.oelPpm, limitLabel: `OEL ${formatPpm(chem.oelPpm)}` });
      if (chem.stelPpm) checks.push({ label: 'STEL', value: stel, limit: chem.stelPpm, limitLabel: `STEL ${formatPpm(chem.stelPpm)}` });
      if (chem.idlhPpm) checks.push({ label: 'Peak', value: peak, limit: chem.idlhPpm, limitLabel: `IDLH ${formatPpm(chem.idlhPpm)}` });
      if (chem.lelPct) checks.push({ label: 'Peak', value: peak, limit: chem.lelPct * 1000, limitLabel: `10% LEL ${formatPpm(chem.lelPct * 1000)}` });

      const worst = checks.reduce((a, c) => (!a || c.value / c.limit > a.value / a.limit) ? c : a, null);
      const ratio = worst ? worst.value / worst.limit : 0;
      const status = ratio > 1 ? { cls: 'badge-leak', text: `EXCEEDS ${worst.limitLabel.split(' ')[0]}` }
        : ratio > 0.5 ? { cls: 'badge-warning', text: 'APPROACHING' }
        : { cls: 'badge-safe', text: 'WITHIN LIMITS' };
      const barColor = ratio > 1 ? 'var(--leak)' : ratio > 0.5 ? 'var(--warning)' : 'var(--safe)';

      rows.push(`
        <tr>
          <td class="table-font-sans"><strong>${chem.name}</strong><div class="muted">${chem.formula}</div></td>
          <td>${formatPpm(twa)}<div class="muted">limit ${chem.oelPpm ? formatPpm(chem.oelPpm) : '–'}</div></td>
          <td>${formatPpm(stel)}<div class="muted">limit ${chem.stelPpm ? formatPpm(chem.stelPpm) : '–'}</div></td>
          <td>${formatPpm(peak)}<div class="muted">${chem.idlhPpm ? `IDLH ${formatPpm(chem.idlhPpm)}` : chem.lelPct ? `LEL ${chem.lel}` : ''}</div></td>
          <td>
            <span class="badge ${status.cls}">${status.text}</span>
            <div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${Math.min(100, ratio * 100)}%; background: ${barColor};"></div></div>
          </td>
        </tr>`);
    }

    table.innerHTML = `
      <thead><tr><th>Gas</th><th>8-h TWA</th><th>15-min STEL</th><th>Peak</th><th>Status</th></tr></thead>
      <tbody>${rows.join('')}</tbody>`;
  }

  renderIncidents(incidents) {
    const table = this.el('anIncidentTable');
    if (incidents.length === 0) {
      table.innerHTML = '<tbody><tr><td class="empty-cell">No incidents in this time range.</td></tr></tbody>';
      return;
    }
    table.innerHTML = `
      <thead><tr><th>Snapshot</th><th>Started</th><th>Duration</th><th>Severity</th><th>Peak conf.</th><th>Gas peak</th><th>Min O₂</th><th>Source · zone</th><th>Hazard assessment</th><th></th></tr></thead>
      <tbody>
        ${incidents.map(i => {
          const chem = i.gas ? CHEMICALS_BY_ID[i.gas] : null;
          const dur = (i.end ?? Date.now()) - i.start;
          return `
          <tr>
            <td>${i.thumb ? `<img src="${i.thumb}" class="table-thumb" alt="Snapshot at ${new Date(i.start).toLocaleTimeString()}">` : '<div class="table-thumb table-thumb-empty">—</div>'}</td>
            <td>${new Date(i.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}<div class="muted">${new Date(i.start).toLocaleTimeString()}</div></td>
            <td>${formatSpan(dur)}${i.end ? '' : '<div class="muted">ongoing</div>'}</td>
            <td>${stateBadge(i.maxState)}</td>
            <td>${Math.round(i.peakConf * 100)}%</td>
            <td>${i.peakPpm !== null && i.peakPpm !== undefined && chem ? `${formatPpm(i.peakPpm)}<div class="muted">${chem.name}</div>` : '<span class="muted">Sensor off</span>'}</td>
            <td>${i.minO2 !== undefined ? `${i.minO2.toFixed(2)}%` : '–'}</td>
            <td class="table-font-sans">${escapeHtml(i.source)}<div class="muted">${escapeHtml((i.zones || []).join(', ') || 'Full frame')}</div></td>
            <td>${i.assessment ? `${threatChip(i.assessment.threat)}<div class="muted">${escapeHtml(i.assessment.chemicalName)}</div>` : '<span class="muted">Not assessed</span>'}</td>
            <td><button class="btn btn-secondary btn-xs" data-assess-incident="${i.id}">${i.assessment ? 'Re-assess' : 'Assess'} →</button></td>
          </tr>`;
        }).join('')}
      </tbody>`;
  }

  renderZones(incidents) {
    const table = this.el('anZoneTable');
    const zones = new Map();
    for (const i of incidents) {
      for (const z of (i.zones && i.zones.length ? i.zones : ['Full frame'])) {
        if (!zones.has(z)) zones.set(z, { count: 0, total: 0, maxConf: 0, last: 0 });
        const e = zones.get(z);
        e.count++;
        e.total += (i.end ?? Date.now()) - i.start;
        e.maxConf = Math.max(e.maxConf, i.peakConf);
        e.last = Math.max(e.last, i.start);
      }
    }
    if (zones.size === 0) {
      table.innerHTML = '<tbody><tr><td class="empty-cell">No incidents in this time range. Draw watch zones on the Live Monitor to break incidents down by area.</td></tr></tbody>';
      return;
    }
    const rows = [...zones.entries()].sort((a, b) => b[1].count - a[1].count);
    table.innerHTML = `
      <thead><tr><th>Zone</th><th>Incidents</th><th>Avg duration</th><th>Max confidence</th><th>Last triggered</th></tr></thead>
      <tbody>${rows.map(([name, z]) => `
        <tr>
          <td class="table-font-sans"><strong>${escapeHtml(name)}</strong></td>
          <td>${z.count}</td>
          <td>${formatSpan(z.total / z.count)}</td>
          <td>${Math.round(z.maxConf * 100)}%</td>
          <td>${new Date(z.last).toLocaleTimeString()}</td>
        </tr>`).join('')}
      </tbody>`;
  }

  // Most recent occurrence of a shift window (may be in progress)
  shiftWindow(key) {
    const sh = SHIFTS[key];
    const now = new Date();
    const start = new Date(now);
    start.setHours(sh.startH, 0, 0, 0);
    if (start > now) start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setHours(sh.endH, 0, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
    return { from: start.getTime(), to: Math.min(end.getTime(), now.getTime()), end: end.getTime(), inProgress: end > now };
  }

  renderShift() {
    const el = this.el('anShiftContent');
    const w = this.shiftWindow(this.shift);
    const samples = this.telemetry.samples.filter(s => s.t >= w.from && s.t <= w.to);
    const incidents = this.telemetry.incidents.filter(i => i.start >= w.from && i.start <= w.to);
    const dateStr = `${new Date(w.from).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${String(SHIFTS[this.shift].startH).padStart(2, '0')}:00–${String(SHIFTS[this.shift].endH).padStart(2, '0')}:00${w.inProgress ? ' (in progress)' : ''}`;

    if (samples.length === 0 && incidents.length === 0) {
      el.innerHTML = `<p class="muted" style="margin-bottom: 6px;">${dateStr}</p><div class="shift-summary">No monitoring data recorded during this shift.</div>`;
      return;
    }

    const step = this.telemetry.isSample ? 30000 : 2000;
    const leakMs = samples.filter(s => s.state === 'LEAK').length * step;
    const warnMs = samples.filter(s => s.state === 'WARNING').length * step;
    const peak = samples.reduce((a, s) => (s.ppm ?? 0) > (a?.ppm ?? -1) ? s : a, null);
    const minO2 = samples.reduce((a, s) => Math.min(a, s.o2), 20.9);
    const worstState = incidents.some(i => i.maxState === 'LEAK') ? 'LEAK' : warnMs > 0 ? 'WARNING' : 'SAFE';
    const assessed = incidents.filter(i => i.assessment);
    const worstThreat = assessed.reduce((a, i) => {
      const order = ['LOW', 'ELEVATED', 'HIGH', 'CRITICAL'];
      return !a || order.indexOf(i.assessment.threat) > order.indexOf(a.assessment.threat) ? i : a;
    }, null);
    const chem = peak && peak.gas ? CHEMICALS_BY_ID[peak.gas] : null;

    const sentences = [];
    sentences.push(incidents.length === 0 ? 'No leak incidents were confirmed.' :
      `${incidents.length} incident${incidents.length > 1 ? 's' : ''} confirmed, ${formatSpan(leakMs)} in LEAK state and ${formatSpan(warnMs)} in WARNING.`);
    if (peak && chem && peak.ppm !== null) {
      const over = chem.idlhPpm && peak.ppm >= chem.idlhPpm ? ' — above IDLH' : chem.oelPpm && peak.ppm >= chem.oelPpm ? ' — above the occupational limit' : '';
      sentences.push(`Peak ${chem.name} reading ${formatPpm(peak.ppm)} at ${new Date(peak.t).toLocaleTimeString()}${over}.`);
    }
    if (worstThreat) sentences.push(`Worst assessed threat: ${worstThreat.assessment.threat} (${worstThreat.assessment.chemicalName}).`);
    else if (incidents.length) sentences.push('Incidents have not been hazard-assessed yet.');

    const cls = worstState === 'LEAK' ? 'shift-summary-leak' : worstState === 'WARNING' ? 'shift-summary-warning' : '';
    el.innerHTML = `
      <p class="muted" style="margin-bottom: 8px;">${dateStr}</p>
      <div class="shift-stats">
        <div class="shift-stat-item"><div class="shift-stat-label">Incidents</div><div class="shift-stat-val">${incidents.length}</div></div>
        <div class="shift-stat-item"><div class="shift-stat-label">Max severity</div><div class="shift-stat-val">${stateBadge(worstState)}</div></div>
        <div class="shift-stat-item"><div class="shift-stat-label">Time in alarm</div><div class="shift-stat-val">${formatSpan(leakMs + warnMs)}</div></div>
        <div class="shift-stat-item"><div class="shift-stat-label">Min O₂ / peak gas</div><div class="shift-stat-val">${minO2.toFixed(2)}% / ${peak && peak.ppm !== null ? formatPpm(peak.ppm) : '–'}</div></div>
      </div>
      <div class="shift-summary ${cls}">${sentences.join(' ')}</div>
      <div style="text-align: right; margin-top: 10px;"><button class="btn btn-secondary btn-xs" data-shift-csv="1">Export shift incidents (CSV)</button></div>`;
  }

  renderAssessments() {
    const el = this.el('anAssessmentList');
    const list = this.telemetry.assessments.slice(0, 20);
    if (list.length === 0) {
      el.innerHTML = '<div class="empty-cell">No hazard assessments saved yet. Use "Assess" on an incident, or open the Hazard Scanner.</div>';
      return;
    }
    el.innerHTML = list.map(a => `
      <div class="assessment-item">
        ${a.thumb ? `<img src="${a.thumb}" class="table-thumb" alt="">` : ''}
        <div class="assessment-main">
          <div class="assessment-top">
            ${threatChip(a.threat)}
            <strong>${escapeHtml(a.chemicalName)}</strong>
            <span class="muted">· ${a.setting === 'outdoor' ? 'Outdoor' : 'Indoor'} · ${a.releaseRateGs} g/s for ${a.durationMin} min · ${new Date(a.time).toLocaleString()}</span>
          </div>
          <div class="assessment-headline">${escapeHtml(a.headline)}</div>
        </div>
        <button class="btn btn-secondary btn-xs" data-open-assessment="${a.id}">Open →</button>
      </div>`).join('');
  }
}
