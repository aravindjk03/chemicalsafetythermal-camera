'use strict';

/* =====================================================================
   TELEMETRY STORE
   Single source of truth shared by the Live Monitor (writer), Analytics
   (reader) and Hazard Scanner (reader + assessment writer).
   Persists to localStorage so history survives a page reload.
   ===================================================================== */

const TELEMETRY_STORAGE_KEY = 'gasvision.telemetry.v1';
const SAMPLE_INTERVAL_MS = 2000;           // one stored sample every 2 s
const HISTORY_WINDOW_MS = 24 * 3600 * 1000; // keep 24 h
const MAX_INCIDENTS = 200;
const MAX_THUMBS = 40;                      // older incidents drop their snapshot to save space
const STATE_RANK = { SAFE: 0, WARNING: 1, LEAK: 2 };

class TelemetryStore {
  constructor() {
    this.samples = [];      // { t, ppm, gas, o2, conf, cam, state, src }
    this.incidents = [];    // newest first
    this.assessments = [];  // newest first
    this.isSample = false;  // true while the generated demo dataset is loaded
    this.listeners = new Set();
    this.pending = null;    // sample being aggregated for the current 2 s bucket
    this.saveTimer = null;
    this.load();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind) {
    for (const fn of this.listeners) {
      try { fn(kind); } catch (err) { console.error(err); }
    }
  }

  /* ---------------- Live recording ---------------- */

  record(sample) {
    if (this.isSample) this.clear(); // first live data replaces the demo dataset

    const p = this.pending;
    if (!p) {
      this.pending = { ...sample };
    } else {
      // Keep the worst reading within the bucket
      p.conf = Math.max(p.conf, sample.conf);
      p.cam = Math.max(p.cam, sample.cam);
      p.ppm = sample.ppm === null ? p.ppm : Math.max(p.ppm ?? 0, sample.ppm);
      p.o2 = Math.min(p.o2, sample.o2);
      if (STATE_RANK[sample.state] > STATE_RANK[p.state]) p.state = sample.state;
      p.gas = sample.gas;
      p.src = sample.src;
    }

    if (sample.t - this.pending.t >= SAMPLE_INTERVAL_MS) {
      this.samples.push(this.pending);
      this.pending = null;
      this.trim();
      this.scheduleSave();
      this.emit('samples');
    }
  }

  openIncident(inc) {
    const incident = {
      id: `inc-${inc.start}`,
      end: null,
      assessment: null,
      ...inc
    };
    this.incidents.unshift(incident);
    this.trim();
    this.scheduleSave(true);
    this.emit('incidents');
    return incident;
  }

  updateIncident(id, patch) {
    const inc = this.incidents.find(i => i.id === id);
    if (!inc) return null;
    Object.assign(inc, patch);
    this.scheduleSave();
    this.emit('incidents');
    return inc;
  }

  addAssessment(a) {
    const assessment = { id: `asm-${Date.now()}`, time: Date.now(), ...a };
    this.assessments.unshift(assessment);
    if (this.assessments.length > 100) this.assessments.length = 100;
    if (a.incidentId) {
      this.updateIncident(a.incidentId, {
        assessment: { id: assessment.id, threat: a.threat, chemicalName: a.chemicalName }
      });
    }
    this.scheduleSave(true);
    this.emit('assessments');
    return assessment;
  }

  /* ---------------- Queries ---------------- */

  samplesSince(fromMs) {
    return this.samples.filter(s => s.t >= fromMs);
  }

  incidentsSince(fromMs) {
    return this.incidents.filter(i => (i.end ?? Date.now()) >= fromMs);
  }

  latest() {
    return this.pending || this.samples[this.samples.length - 1] || null;
  }

  /* ---------------- Maintenance ---------------- */

  trim() {
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    if (this.samples.length && this.samples[0].t < cutoff) {
      const idx = this.samples.findIndex(s => s.t >= cutoff);
      this.samples.splice(0, idx === -1 ? this.samples.length : idx);
    }
    if (this.incidents.length > MAX_INCIDENTS) this.incidents.length = MAX_INCIDENTS;
    this.incidents.forEach((inc, i) => { if (i >= MAX_THUMBS) inc.thumb = null; });
  }

  clear() {
    this.samples = [];
    this.incidents = [];
    this.assessments = [];
    this.pending = null;
    this.isSample = false;
    this.scheduleSave(true);
    this.emit('reset');
  }

  scheduleSave(immediate = false) {
    if (immediate) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.save();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 15000);
  }

  save() {
    try {
      const payload = {
        v: 1,
        isSample: this.isSample,
        // Compact column form keeps 24 h of 2 s samples well under storage limits
        samples: this.samples.map(s => [s.t, s.ppm, s.gas, Math.round(s.o2 * 100), Math.round(s.conf * 1000), Math.round(s.cam * 1000), STATE_RANK[s.state], s.src]),
        incidents: this.incidents,
        assessments: this.assessments
      };
      localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Telemetry save failed:', err);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(TELEMETRY_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.v !== 1) return;
      const states = Object.keys(STATE_RANK);
      this.samples = (data.samples || []).map(r => ({
        t: r[0], ppm: r[1], gas: r[2], o2: r[3] / 100, conf: r[4] / 1000, cam: r[5] / 1000, state: states[r[6]], src: r[7]
      }));
      this.incidents = data.incidents || [];
      this.assessments = data.assessments || [];
      this.isSample = !!data.isSample;
      // An incident left open by a closed tab ends at its last sample
      for (const inc of this.incidents) {
        if (inc.end === null) inc.end = inc.lastSeen ?? inc.start;
      }
      this.trim();
    } catch (err) {
      console.warn('Telemetry load failed:', err);
    }
  }

  /* ---------------- Demo dataset ---------------- */

  // 24 h of realistic-looking history so Analytics can be shown before a live session
  loadSampleData() {
    const now = Date.now();
    const start = now - HISTORY_WINDOW_MS;
    const step = 30000;
    let seed = 20260917;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const gas = 'ammonia';
    const events = [
      { at: 0.14, mins: 9, peakPpm: 210, peakConf: 0.92, zone: 'Zone 1', source: 'Simulated Visible Scene' },
      { at: 0.42, mins: 4, peakPpm: 62, peakConf: 0.48, zone: 'Full frame', source: 'Webcam (Live)', warningOnly: true },
      { at: 0.63, mins: 14, peakPpm: 340, peakConf: 0.97, zone: 'Zone 1', source: 'Simulated Thermal Camera' },
      { at: 0.88, mins: 6, peakPpm: 120, peakConf: 0.86, zone: 'Zone 2', source: 'Simulated Visible Scene' }
    ].map(e => ({ ...e, t0: start + e.at * HISTORY_WINDOW_MS }));

    const samples = [];
    for (let t = start; t <= now; t += step) {
      let ppm = 4 + rand() * 6;
      let conf = rand() * 0.08;
      let state = 'SAFE';
      for (const e of events) {
        const p = (t - e.t0) / (e.mins * 60000);
        if (p >= 0 && p <= 1) {
          const k = Math.sin(p * Math.PI);
          ppm += k * e.peakPpm * (0.85 + rand() * 0.15);
          conf = Math.max(conf, k * e.peakConf);
          state = conf >= 0.55 && !e.warningOnly ? 'LEAK' : conf >= 0.28 ? 'WARNING' : 'SAFE';
        }
      }
      samples.push({ t, ppm: Math.round(ppm), gas, o2: o2FromGasPpm(ppm), conf, cam: conf, state, src: 'Sample data' });
    }

    const incidents = events.map(e => ({
      id: `inc-${Math.round(e.t0)}`,
      start: Math.round(e.t0 + e.mins * 60000 * 0.2),
      end: Math.round(e.t0 + e.mins * 60000 * 0.85),
      maxState: e.warningOnly ? 'WARNING' : 'LEAK',
      peakConf: e.peakConf,
      peakPpm: e.peakPpm,
      gas,
      minO2: o2FromGasPpm(e.peakPpm),
      source: e.source,
      zones: [e.zone],
      thumb: null,
      assessment: null
    })).reverse();

    this.samples = samples;
    this.incidents = incidents;
    this.assessments = [];
    this.pending = null;
    this.isSample = true;
    this.scheduleSave(true);
    this.emit('reset');
  }

  /* ---------------- Export ---------------- */

  telemetryCsv(fromMs = 0) {
    const rows = [['timestamp_iso', 'state', 'fused_confidence', 'camera_confidence', 'gas', 'gas_ppm', 'o2_percent', 'camera_source']];
    for (const s of this.samplesSince(fromMs)) {
      rows.push([new Date(s.t).toISOString(), s.state, s.conf.toFixed(3), s.cam.toFixed(3), s.gas ?? '', s.ppm ?? '', s.o2.toFixed(2), s.src]);
    }
    return toCsv(rows);
  }

  incidentsCsv(fromMs = 0) {
    const rows = [['incident_id', 'start_iso', 'end_iso', 'duration_s', 'max_state', 'peak_confidence', 'gas', 'peak_ppm', 'min_o2_percent', 'camera_source', 'zones', 'assessed_threat', 'assessed_chemical']];
    for (const i of this.incidentsSince(fromMs)) {
      const end = i.end ?? Date.now();
      rows.push([i.id, new Date(i.start).toISOString(), i.end ? new Date(i.end).toISOString() : 'ongoing', Math.round((end - i.start) / 1000),
        i.maxState, i.peakConf.toFixed(3), i.gas ?? '', i.peakPpm ?? '', i.minO2?.toFixed(2) ?? '', i.source, (i.zones || []).join(' | '),
        i.assessment?.threat ?? '', i.assessment?.chemicalName ?? '']);
    }
    return toCsv(rows);
  }
}

function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

function downloadText(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // Embedded previews (sandboxed iframes) silently block downloads: show the file instead
  if (isEmbedded()) showFilePreview(filename, text, mime);
}

function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch (err) {
    return true;
  }
}

function showFilePreview(filename, text, mime) {
  const overlay = document.createElement('div');
  overlay.className = 'file-preview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', filename);
  const isHtml = mime === 'text/html';
  overlay.innerHTML = `
    <div class="file-preview-panel">
      <div class="file-preview-head">
        <div>
          <strong>${escapeHtml(filename)}</strong>
          <div class="muted">Saving files is blocked in this embedded view. Copy the contents below, or run the app locally to download.</div>
        </div>
        <div class="file-preview-actions">
          <button class="btn btn-secondary btn-sm" data-copy>Copy</button>
          <button class="btn btn-primary btn-sm" data-close>Close</button>
        </div>
      </div>
      ${isHtml ? '<iframe class="file-preview-body" title="Report preview" sandbox=""></iframe>' : '<textarea class="file-preview-body" readonly></textarea>'}
    </div>`;
  const body = overlay.querySelector('.file-preview-body');
  if (isHtml) body.srcdoc = text; else body.value = text;
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) {
      overlay.remove();
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied';
      } catch (err) {
        if (!isHtml) {
          body.focus();
          body.select();
          copy.textContent = 'Press Ctrl+C';
        } else {
          copy.textContent = 'Copy blocked';
        }
      }
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]').focus();
}

// Two-step confirmation on the button itself (confirm() dialogs are blocked in some embeds)
function confirmClick(btn, prompt, action) {
  if (btn.dataset.confirming === '1') {
    clearTimeout(btn.confirmTimer);
    btn.dataset.confirming = '';
    btn.textContent = btn.dataset.label;
    btn.classList.remove('btn-confirming');
    action();
    return;
  }
  btn.dataset.label = btn.textContent;
  btn.dataset.confirming = '1';
  btn.textContent = prompt;
  btn.classList.add('btn-confirming');
  btn.confirmTimer = setTimeout(() => {
    btn.dataset.confirming = '';
    btn.textContent = btn.dataset.label;
    btn.classList.remove('btn-confirming');
  }, 4000);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
