'use strict';

/* =====================================================================
   HAZARD SCANNER
   1. Capture an image (Live Monitor frame, webcam photo, upload)
   2. Identify the chemical: on-device colour analysis + label matching,
      live sensor evidence, and optional Claude vision
   3. Model the release (hazard-model.js) and explain the threat
   ===================================================================== */

const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.126.0/+esm';
const API_KEY_STORAGE = 'gasvision.anthropicKey';

const ZONE_COLORS = {
  tox3: '#D0342C', tox2: '#EA7317', tox1: '#D9A40B',
  fire3: '#8B5CF6', fire2: '#A78BFA', fire1: '#C4B5FD',
  o2crit: '#0E7490', o2: '#0891B2'
};

// Non-database candidate that explains many white clouds
const STEAM_CANDIDATE = { id: 'steam', name: 'Steam / water vapour', formula: 'H₂O' };

const APPEARANCE_TEXT = {
  'white-cloud': 'White / grey cloud (condensed vapour or aerosol)',
  'yellow-green': 'Yellow-green gas cloud',
  'red-brown': 'Reddish-brown gas cloud',
  'dark-smoke': 'Dark smoke',
  'invisible': 'No visible release',
  'unclear': 'Unclear colour signature'
};

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

// Colour class of an estimated cloud colour
function classifyCloudColor(rgb) {
  const { h, s, v } = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  if (s < 0.2 && v >= 0.55) return 'white-cloud';
  if (s < 0.25 && v < 0.35) return 'dark-smoke';
  if (s >= 0.25 && h >= 45 && h <= 100 && v >= 0.35) return 'yellow-green';
  if (s >= 0.3 && (h <= 40 || h >= 340) && v >= 0.15) return 'red-brown';
  if (s < 0.25) return v >= 0.4 ? 'white-cloud' : 'dark-smoke';
  return 'unclear';
}

class HazardScanner {
  constructor(telemetry, monitor) {
    this.telemetry = telemetry;
    this.monitor = monitor;
    this.image = null;          // canvas with the captured image
    this.reference = null;      // clean-scene canvas (same framing) or null
    this.meta = null;           // capture context (source, sensor, thermal, incident…)
    this.roi = null;            // normalised {x0,y0,x1,y1}
    this.drag = null;
    this.vision = null;         // on-device analysis result
    this.ai = null;             // Claude result
    this.userPickedChemical = false;
    this.userSetRate = false;
    this.result = null;
    this.webcamStream = null;
    this.visible = false;

    this.el = (id) => document.getElementById(id);
    this.initControls();
    this.bindEvents();
    this.renderAssessment();
  }

  /* ---------------------------------------------------------------- */
  /* Setup                                                            */
  /* ---------------------------------------------------------------- */

  initControls() {
    this.el('hzChemicalSelect').innerHTML = `<option value="">— Choose a chemical —</option>` +
      CHEMICALS.map(c => `<option value="${c.id}">${c.name} (${c.formula}) · ${c.un}</option>`).join('');

    this.el('hzReleasePreset').innerHTML = RELEASE_PRESETS.map(p => `<option value="${p.key}">${p.label} (~${p.rateGs} g/s)</option>`).join('') +
      '<option value="custom">Custom rate</option>';
    this.el('hzReleasePreset').value = 'small';

    this.el('hzStability').innerHTML = Object.entries(STABILITY_CLASSES)
      .map(([k, v]) => `<option value="${k}">${v.label} — ${v.hint}</option>`).join('');
    this.el('hzStability').value = 'D';

    try {
      const saved = localStorage.getItem(API_KEY_STORAGE);
      if (saved) {
        this.el('hzApiKey').value = saved;
        this.el('hzRememberKey').checked = true;
      }
    } catch (err) { /* storage unavailable */ }
    this.setting = 'indoor';
  }

  bindEvents() {
    this.el('hzGrabBtn').addEventListener('click', () => this.grabFromMonitor());
    this.el('hzUploadBtn').addEventListener('click', () => this.el('hzFileInput').click());
    this.el('hzFileInput').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) this.loadFile(e.target.files[0]);
      e.target.value = '';
    });
    this.el('hzWebcamBtn').addEventListener('click', () => this.openWebcam());
    this.el('hzWebcamStopBtn').addEventListener('click', () => this.closeWebcam());
    this.el('hzCaptureBtn').addEventListener('click', () => this.captureWebcam());
    this.el('hzAnalyzeBtn').addEventListener('click', () => this.analyze());
    this.el('hzClearRoiBtn').addEventListener('click', () => { this.roi = null; this.drawImage(); });
    this.el('hzLabelText').addEventListener('change', () => { if (this.image || this.el('hzLabelText').value) this.analyze(); });

    // Region-of-interest dragging
    const canvas = this.el('hzCanvas');
    const toNorm = (e) => {
      const r = canvas.getBoundingClientRect();
      const fit = this.displayFit;
      if (!fit) return null;
      const x = ((e.clientX - r.left) / r.width) * canvas.width;
      const y = ((e.clientY - r.top) / r.height) * canvas.height;
      return { x: clamp((x - fit.x) / fit.w), y: clamp((y - fit.y) / fit.h) };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.image) return;
      const p = toNorm(e);
      if (!p) return;
      this.drag = { start: p, cur: p };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.drag.cur = toNorm(e) || this.drag.cur;
      this.drawImage();
    });
    canvas.addEventListener('pointerup', () => {
      if (!this.drag) return;
      const { start, cur } = this.drag;
      this.drag = null;
      if (Math.abs(cur.x - start.x) > 0.03 && Math.abs(cur.y - start.y) > 0.03) {
        this.roi = { x0: Math.min(start.x, cur.x), y0: Math.min(start.y, cur.y), x1: Math.max(start.x, cur.x), y1: Math.max(start.y, cur.y) };
        this.analyze();
      }
      this.drawImage();
    });

    this.el('hzChemicalSelect').addEventListener('change', () => {
      this.userPickedChemical = true;
      this.renderAssessment();
    });

    this.el('hzSetting').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-setting]');
      if (!btn) return;
      this.setSetting(btn.dataset.setting);
      this.renderAssessment();
    });

    this.el('hzReleasePreset').addEventListener('change', (e) => {
      const p = RELEASE_PRESETS.find(r => r.key === e.target.value);
      if (p) this.el('hzRate').value = p.rateGs;
      this.userSetRate = true;
      this.renderAssessment();
    });
    this.el('hzRate').addEventListener('input', () => {
      this.el('hzReleasePreset').value = 'custom';
      this.userSetRate = true;
      this.renderAssessment();
    });
    for (const id of ['hzDuration', 'hzTemp', 'hzRoomL', 'hzRoomW', 'hzRoomH', 'hzAch', 'hzMixing', 'hzWind', 'hzStability', 'hzReceptor']) {
      this.el(id).addEventListener('input', () => this.renderAssessment());
      this.el(id).addEventListener('change', () => this.renderAssessment());
    }

    this.el('hzApiKey').addEventListener('input', () => this.updateAiButton());
    this.el('hzRememberKey').addEventListener('change', () => this.persistKey());
    this.el('hzAiBtn').addEventListener('click', () => this.identifyWithClaude());

    this.el('hzSaveBtn').addEventListener('click', () => this.saveAssessment());
    this.el('hzReportBtn').addEventListener('click', () => this.downloadReport());

    this.el('view-hazard').addEventListener('click', (e) => {
      const cand = e.target.closest('[data-candidate]');
      if (cand && cand.dataset.candidate !== 'steam') {
        this.el('hzChemicalSelect').value = cand.dataset.candidate;
        this.userPickedChemical = true;
        this.renderCandidates();
        this.renderAssessment();
      }
      const vent = e.target.closest('[data-open-ventilation]');
      if (vent) this.openVentilation();
    });

    window.addEventListener('resize', () => { if (this.visible) this.renderAssessment(); });
  }

  setSetting(setting) {
    this.setting = setting;
    this.el('hzSetting').querySelectorAll('.segmented-btn').forEach(b => b.classList.toggle('active', b.dataset.setting === setting));
    this.el('hzIndoor').hidden = setting !== 'indoor';
    this.el('hzOutdoor').hidden = setting !== 'outdoor';
  }

  show(params) {
    this.visible = true;
    if (params) {
      if (params.snapshot) this.loadSnapshot(params.snapshot);
      if (params.incidentId) this.loadIncident(params.incidentId);
      if (params.assessmentId) this.loadAssessment(params.assessmentId);
      if (params.chemical) {
        this.el('hzChemicalSelect').value = params.chemical;
        this.userPickedChemical = true;
      }
      if (params.room) {
        this.setSetting('indoor');
        this.el('hzRoomL').value = params.room.L;
        this.el('hzRoomW').value = params.room.W;
        this.el('hzRoomH').value = params.room.H;
        this.el('hzAch').value = +params.room.ach.toFixed(1);
        if (params.room.rateGs) {
          this.userSetRate = true;
          this.el('hzRate').value = params.room.rateGs;
          this.el('hzReleasePreset').value = RELEASE_PRESETS.find(p => p.rateGs === params.room.rateGs)?.key || 'custom';
        }
      }
    }
    this.drawImage();
    this.renderAssessment();
  }

  hide() {
    this.visible = false;
    this.closeWebcam();
  }

  /* ---------------------------------------------------------------- */
  /* Capture                                                          */
  /* ---------------------------------------------------------------- */

  setImage(canvas, reference, meta) {
    this.image = canvas;
    this.reference = reference;
    this.meta = meta;
    this.roi = null;
    this.vision = null;
    this.ai = null;
    this.userSetRate = false;
    this.el('hzAiResult').innerHTML = '';
    this.el('hzImageEmpty').hidden = true;
    this.el('hzAnalyzeBtn').disabled = false;
    this.updateAiButton();
    this.drawImage();
  }

  grabFromMonitor() {
    this.loadSnapshot(this.monitor.getHazardSnapshot());
  }

  loadSnapshot(snap) {
    const meta = {
      origin: 'monitor',
      sourceLabel: snap.sourceLabel,
      kind: snap.kind,
      sensor: snap.sensor,
      thermal: snap.thermal,
      boxes: snap.boxes,
      incidentId: snap.state !== 'SAFE' ? snap.incidentId : null,
      running: snap.running,
      time: snap.time
    };
    this.setImage(snap.image, snap.reference, meta);
    if (snap.boxes && snap.boxes.length) {
      this.roi = this.unionBoxes(snap.boxes);
    }
    this.analyze();
  }

  loadIncident(id) {
    const inc = this.telemetry.incidents.find(i => i.id === id);
    if (!inc) return;
    const meta = {
      origin: 'incident',
      sourceLabel: inc.source,
      kind: /thermal/i.test(inc.source) ? 'thermal' : 'rgb',
      sensor: inc.gas && inc.peakPpm !== null ? { gas: inc.gas, ppm: inc.peakPpm } : null,
      thermal: null, // temperature drop was not stored with the incident
      boxes: [],
      incidentId: inc.id,
      time: inc.start,
      overlays: true
    };
    if (inc.thumb) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        this.setImage(c, null, meta);
        this.analyze();
      };
      img.src = inc.thumb;
    } else {
      this.image = null;
      this.meta = meta;
      this.el('hzImageEmpty').hidden = false;
      this.analyze();
    }
  }

  loadAssessment(id) {
    const a = this.telemetry.assessments.find(x => x.id === id);
    if (!a) return;
    const s = a.scenario;
    this.el('hzChemicalSelect').value = a.chemicalId;
    this.userPickedChemical = true;
    this.setSetting(s.setting);
    this.userSetRate = true;
    this.el('hzRate').value = s.releaseRateGs;
    this.el('hzReleasePreset').value = RELEASE_PRESETS.find(p => p.rateGs === s.releaseRateGs)?.key || 'custom';
    this.el('hzDuration').value = s.durationMin;
    this.el('hzTemp').value = s.tempC;
    if (s.setting === 'indoor') {
      this.el('hzRoomL').value = s.room.L;
      this.el('hzRoomW').value = s.room.W;
      this.el('hzRoomH').value = s.room.H;
      this.el('hzAch').value = s.ach;
      this.el('hzMixing').value = String(s.mixing);
    } else {
      this.el('hzWind').value = s.windSpeed;
      this.el('hzStability').value = s.stability;
      this.el('hzReceptor').value = s.receptorDistance;
    }
    if (a.incidentId) this.meta = { ...(this.meta || {}), incidentId: a.incidentId };
  }

  loadFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      this.setImage(c, null, { origin: 'upload', sourceLabel: file.name, kind: 'rgb', time: Date.now() });
      this.analyze();
    };
    img.onerror = () => { this.el('hzImageInfo').textContent = 'Could not read that image file. Try a JPEG or PNG.'; };
    img.src = url;
  }

  async openWebcam() {
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      const video = this.el('hzVideo');
      video.srcObject = this.webcamStream;
      this.el('hzWebcamWrap').hidden = false;
    } catch (err) {
      this.el('hzImageInfo').textContent = `Camera unavailable (${err.message}). Allow camera access for this page, or upload a photo instead.`;
    }
  }

  captureWebcam() {
    const video = this.el('hzVideo');
    if (!video.videoWidth) return;
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * scale);
    c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    this.closeWebcam();
    this.setImage(c, null, { origin: 'webcam', sourceLabel: 'Webcam photo', kind: 'rgb', time: Date.now() });
    this.analyze();
  }

  closeWebcam() {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(t => t.stop());
      this.webcamStream = null;
    }
    this.el('hzVideo').srcObject = null;
    this.el('hzWebcamWrap').hidden = true;
  }

  unionBoxes(boxes) {
    return boxes.reduce((u, b) => ({
      x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1)
    }), { x0: 1, y0: 1, x1: 0, y1: 0 });
  }

  drawImage() {
    const canvas = this.el('hzCanvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0B131E';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.image) {
      this.displayFit = null;
      this.el('hzClearRoiBtn').hidden = true;
      return;
    }
    const s = Math.min(canvas.width / this.image.width, canvas.height / this.image.height);
    const w = this.image.width * s;
    const h = this.image.height * s;
    const fit = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
    this.displayFit = fit;
    ctx.drawImage(this.image, fit.x, fit.y, w, h);

    const box = this.drag
      ? { x0: Math.min(this.drag.start.x, this.drag.cur.x), y0: Math.min(this.drag.start.y, this.drag.cur.y), x1: Math.max(this.drag.start.x, this.drag.cur.x), y1: Math.max(this.drag.start.y, this.drag.cur.y) }
      : this.roi;
    if (box) {
      const bx = fit.x + box.x0 * w, by = fit.y + box.y0 * h, bw = (box.x1 - box.x0) * w, bh = (box.y1 - box.y0) * h;
      ctx.fillStyle = 'rgba(11, 19, 30, 0.45)';
      ctx.fillRect(fit.x, fit.y, w, by - fit.y);
      ctx.fillRect(fit.x, by + bh, w, fit.y + h - by - bh);
      ctx.fillRect(fit.x, by, bx - fit.x, bh);
      ctx.fillRect(bx + bw, by, fit.x + w - bx - bw, bh);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillRect(bx, by - 18 < fit.y ? by : by - 18, 104, 18);
      ctx.fillStyle = '#0B131E';
      ctx.font = '600 11px IBM Plex Sans, sans-serif';
      ctx.fillText('RELEASE AREA', bx + 6, (by - 18 < fit.y ? by : by - 18) + 13);
    }
    this.el('hzClearRoiBtn').hidden = !this.roi;

    const m = this.meta || {};
    const parts = [m.sourceLabel, m.time ? new Date(m.time).toLocaleTimeString() : null,
      m.origin === 'monitor' ? (this.reference ? 'clean reference frame available' : 'no reference frame (colour-only analysis)') : null].filter(Boolean);
    this.el('hzImageInfo').textContent = `${parts.join(' · ')}. Drag on the image to mark the release area.`;
  }

  /* ---------------------------------------------------------------- */
  /* On-device analysis                                               */
  /* ---------------------------------------------------------------- */

  analyze() {
    const evidence = [];
    const scores = new Map(CHEMICALS.map(c => [c.id, 0]));
    scores.set('steam', 0);
    const add = (id, v) => scores.set(id, (scores.get(id) || 0) + v);
    let appearance = null;
    let swatch = null;
    let opacity = null;
    let coverage = null;
    let method = null;
    const m = this.meta || {};

    if (this.image && m.kind === 'thermal') {
      method = 'thermal';
      appearance = 'invisible';
      if (m.thermal && m.thermal.avgDrop >= 2) {
        evidence.push({ type: 'good', text: `Thermal camera shows a cold plume (average ${m.thermal.avgDrop.toFixed(1)} °C below the background). Typical of a pressurised or liquefied gas flashing to vapour.` });
        for (const c of CHEMICALS) if (c.coldRelease) add(c.id, 0.25);
      } else {
        evidence.push({ type: 'info', text: 'Thermal image: temperature contrast cannot identify a chemical by itself. Use the gas sensor, labels or placards.' });
      }
    } else if (this.image) {
      const res = this.reference ? this.analyzeAgainstReference() : this.analyzeColorOnly();
      method = res.method;
      appearance = res.appearance;
      swatch = res.swatch;
      opacity = res.opacity;
      coverage = res.coverage;
      evidence.push(...res.evidence);
    }

    // Appearance → candidate chemicals
    if (appearance === 'yellow-green') {
      add('chlorine', 0.9);
    } else if (appearance === 'red-brown') {
      add('no2', 0.9);
    } else if (appearance === 'white-cloud') {
      add('ammonia', 0.45); add('propane', 0.3); add('steam', 0.35); add('so2', 0.1); add('methane', 0.08);
      evidence.push({ type: 'info', text: 'White clouds are usually condensed water: steam, or moisture chilled by a flashing liquefied gas such as ammonia or LPG. Colour alone cannot tell these apart.' });
    } else if (appearance === 'dark-smoke') {
      add('co', 0.45); add('no2', 0.15); add('so2', 0.15);
      evidence.push({ type: 'warn', text: 'Dark smoke suggests combustion: expect carbon monoxide and other combustion gases.' });
    } else if (appearance === 'invisible') {
      for (const c of CHEMICALS) if (c.visual === 'invisible') add(c.id, 0.12);
      if (method !== 'thermal') {
        evidence.push({ type: 'info', text: 'Nothing visible. Most dangerous gases (CO, H₂S, methane, HCN) are colourless, so an empty-looking image does not mean the air is safe.' });
      }
    }

    // Label / placard text
    const labelText = [this.el('hzLabelText').value, ...(this.ai?.label_text || [])].join(' ');
    const labelHits = matchChemicalText(labelText);
    for (const hit of labelHits) {
      add(hit.id, 1.2);
      evidence.push({ type: 'good', text: `Label text matches ${CHEMICALS_BY_ID[hit.id].name} ("${hit.term}").` });
    }

    // Live gas sensor
    if (m.sensor && m.sensor.gas) {
      const chem = CHEMICALS_BY_ID[m.sensor.gas];
      if (m.sensor.ppm >= chem.alarm.low) {
        add(chem.id, 0.7);
        evidence.push({ type: 'good', text: `Gas sensor (calibrated for ${chem.name}) reads ${formatPpm(m.sensor.ppm)}, above its low alarm of ${formatPpm(chem.alarm.low)}.` });
      } else if (m.sensor.ppm >= chem.alarm.low * 0.5) {
        add(chem.id, 0.3);
        evidence.push({ type: 'info', text: `Gas sensor (${chem.name}) reads ${formatPpm(m.sensor.ppm)}, just below its low alarm.` });
      } else {
        evidence.push({ type: 'info', text: `Gas sensor (${chem.name}) reads background (${formatPpm(m.sensor.ppm)}). The release may be a different gas the sensor does not respond to.` });
      }
    }

    // Claude vision
    if (this.ai && this.ai.chemical_id) {
      const w = { high: 1.4, medium: 0.9, low: 0.45 }[this.ai.confidence] || 0.5;
      if (scores.has(this.ai.chemical_id)) add(this.ai.chemical_id, w);
      for (const alt of this.ai.alternatives || []) if (scores.has(alt.chemical_id)) add(alt.chemical_id, w * 0.35);
      if (this.ai.chemical_id !== 'unknown') {
        const name = this.ai.chemical_id === 'steam' ? STEAM_CANDIDATE.name : CHEMICALS_BY_ID[this.ai.chemical_id]?.name;
        evidence.push({ type: 'good', text: `Claude identified ${name} with ${this.ai.confidence} confidence.` });
      }
    }

    // Suggested release size from visible coverage
    let sizeKey = null;
    if (coverage !== null && appearance !== 'invisible' && method === 'reference') {
      sizeKey = coverage < 0.02 ? 'pinhole' : coverage < 0.08 ? 'small' : coverage < 0.25 ? 'medium' : coverage < 0.5 ? 'large' : 'major';
    }
    if (this.ai && this.ai.release_size && this.ai.release_size !== 'none') sizeKey = this.ai.release_size;

    const total = [...scores.values()].reduce((a, b) => a + b, 0) + 0.25; // 0.25 = unexplained / unknown
    const candidates = [...scores.entries()]
      .filter(([, v]) => v > 0.05)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, v]) => ({ id, share: v / total, chem: id === 'steam' ? STEAM_CANDIDATE : CHEMICALS_BY_ID[id] }));

    this.vision = { method, appearance, swatch, opacity, coverage, evidence, candidates, sizeKey };

    // Pre-select the strongest real chemical unless the user already chose one
    const top = candidates.find(c => c.id !== 'steam');
    if (top && (!this.userPickedChemical || !this.el('hzChemicalSelect').value)) {
      this.el('hzChemicalSelect').value = top.id;
    }
    if (sizeKey && !this.userSetRate) {
      const preset = RELEASE_PRESETS.find(p => p.key === sizeKey);
      this.el('hzReleasePreset').value = sizeKey;
      this.el('hzRate').value = preset.rateGs;
    }
    this.el('hzRateHint').textContent = sizeKey
      ? `Suggested from the image: ${RELEASE_PRESETS.find(p => p.key === sizeKey).label.toLowerCase()} (rough visual estimate — adjust if you know the actual leak).`
      : 'Choose the closest description of the leak; the camera cannot measure flow rate.';

    this.renderVision();
    this.renderCandidates();
    this.renderAssessment();
  }

  // Pixel data of a canvas resized to w×h
  pixels(canvas, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  roiPixels(w, h) {
    const r = this.roi || { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0: Math.floor(r.x0 * w), y0: Math.floor(r.y0 * h), x1: Math.ceil(r.x1 * w), y1: Math.ceil(r.y1 * h), full: !this.roi };
  }

  /*
    With a clean reference frame: observed = α·P + (1 − α)·B for cloud colour P,
    background B and opacity α. The mean change Δ = α(P − B) fixes P's direction;
    taking the smallest α that keeps P within 0–255 gives the most saturated
    cloud colour consistent with the image (and a lower bound on opacity).
  */
  analyzeAgainstReference() {
    const w = 160, h = 120;
    const cur = this.pixels(this.image, w, h);
    const ref = this.pixels(this.reference, w, h);
    const r = this.roiPixels(w, h);
    let n = 0, total = 0;
    const dSum = [0, 0, 0], bSum = [0, 0, 0];
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * w + x) * 4;
        total++;
        const d0 = cur[i] - ref[i], d1 = cur[i + 1] - ref[i + 1], d2 = cur[i + 2] - ref[i + 2];
        if (Math.abs(d0) + Math.abs(d1) + Math.abs(d2) > 24) {
          n++;
          dSum[0] += d0; dSum[1] += d1; dSum[2] += d2;
          bSum[0] += ref[i]; bSum[1] += ref[i + 1]; bSum[2] += ref[i + 2];
        }
      }
    }
    const evidence = [];
    const regionFrac = total / (w * h);
    const coverage = (n / total) * regionFrac;
    if (n < total * 0.01 || n < 12) {
      evidence.push({ type: 'info', text: 'Compared with the clean reference frame, nothing visible has changed in the selected area.' });
      return { method: 'reference', appearance: 'invisible', swatch: null, opacity: 0, coverage: 0, evidence };
    }
    const D = dSum.map(v => v / n);
    const B = bSum.map(v => v / n);
    let alpha = 0.05;
    for (let k = 0; k < 3; k++) {
      if (D[k] > 0) alpha = Math.max(alpha, D[k] / Math.max(1, 255 - B[k]));
      if (D[k] < 0) alpha = Math.max(alpha, -D[k] / Math.max(1, B[k]));
    }
    alpha = Math.min(1, alpha);
    const P = B.map((b, k) => Math.round(clamp(b + D[k] / alpha, 0, 255)));
    const appearance = classifyCloudColor(P);
    evidence.push({ type: 'good', text: `Compared with the clean reference frame, ${Math.round((n / total) * 100)}% of the ${this.roi ? 'selected area' : 'image'} changed. Estimated cloud colour rgb(${P.join(', ')}), opacity at least ${Math.round(alpha * 100)}%.` });
    return { method: 'reference', appearance, swatch: P, opacity: alpha, coverage, evidence };
  }

  // Without a reference: classify the pixels in the area and use the dominant cloud-like class
  analyzeColorOnly() {
    const w = 160, h = 120;
    const px = this.pixels(this.image, w, h);
    const r = this.roiPixels(w, h);
    const counts = { 'white-cloud': 0, 'yellow-green': 0, 'red-brown': 0, 'dark-smoke': 0 };
    const sums = { 'white-cloud': [0, 0, 0], 'yellow-green': [0, 0, 0], 'red-brown': [0, 0, 0], 'dark-smoke': [0, 0, 0] };
    let total = 0;
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * w + x) * 4;
        total++;
        const { h: hue, s, v } = rgbToHsv(px[i], px[i + 1], px[i + 2]);
        let cls = null;
        if (s >= 0.3 && hue >= 50 && hue <= 95 && v >= 0.4) cls = 'yellow-green';
        else if (s >= 0.4 && (hue <= 30 || hue >= 345) && v >= 0.2 && v <= 0.75) cls = 'red-brown';
        else if (s < 0.12 && v >= 0.75) cls = 'white-cloud';
        else if (s < 0.2 && v < 0.25) cls = 'dark-smoke';
        if (cls) {
          counts[cls]++;
          sums[cls][0] += px[i]; sums[cls][1] += px[i + 1]; sums[cls][2] += px[i + 2];
        }
      }
    }
    const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const frac = count / total;
    const evidence = [{ type: 'warn', text: `No clean reference frame, so colours of walls, equipment and clothing can be mistaken for gas. ${this.roi ? '' : 'Drag a box around the cloud to improve this. '}` }];
    // Brick, rust and signage are also red-brown; demand a larger share before trusting it
    const needed = best === 'red-brown' ? 0.35 : best === 'white-cloud' ? 0.2 : 0.12;
    if (frac < needed) {
      evidence.push({ type: 'info', text: 'No dominant cloud colour found in the area.' });
      return { method: 'color', appearance: 'unclear', swatch: null, opacity: null, coverage: null, evidence };
    }
    const P = sums[best].map(v => Math.round(v / count));
    evidence.push({ type: 'info', text: `${Math.round(frac * 100)}% of the ${this.roi ? 'selected area' : 'image'} has a ${APPEARANCE_TEXT[best].toLowerCase()} colour, rgb(${P.join(', ')}).` });
    return { method: 'color', appearance: best, swatch: P, opacity: null, coverage: this.roi ? frac * (r.x1 - r.x0) * (r.y1 - r.y0) / (w * h) : frac, evidence };
  }

  renderVision() {
    const v = this.vision;
    const el = this.el('hzVisionResult');
    if (!v) return;
    const methodText = { reference: 'Change vs clean reference frame', color: 'Colour-only analysis', thermal: 'Thermal image', null: 'No image' }[v.method];
    el.innerHTML = `
      <div class="hz-vision-head">
        ${v.swatch ? `<span class="hz-swatch" style="background: rgb(${v.swatch.join(',')});"></span>` : '<span class="hz-swatch hz-swatch-empty">?</span>'}
        <div>
          <div class="hz-vision-title">${v.appearance ? APPEARANCE_TEXT[v.appearance] : 'No image analysed'}</div>
          <div class="muted">${methodText}${v.coverage ? ` · covers ~${Math.max(1, Math.round(v.coverage * 100))}% of frame` : ''}</div>
        </div>
      </div>
      <ul class="evidence-list">
        ${v.evidence.map(e => `<li class="ev-${e.type}">${escapeHtml(e.text)}</li>`).join('')}
      </ul>`;
  }

  renderCandidates() {
    const el = this.el('hzCandidates');
    const v = this.vision;
    if (!v || v.candidates.length === 0) {
      el.innerHTML = v ? '<p class="fine-print" style="margin: 0;">No chemical-specific evidence yet. Add label text, use the gas sensor, try AI identification, or choose the chemical below.</p>' : '';
      return;
    }
    const selected = this.el('hzChemicalSelect').value;
    el.innerHTML = `
      <div class="mini-heading" style="margin-bottom: 6px;">Likely candidates <span class="muted">(evidence strength, not certainty)</span></div>
      ${v.candidates.map(c => `
        <button class="candidate ${c.id === selected ? 'selected' : ''} ${c.id === 'steam' ? 'candidate-steam' : ''}" data-candidate="${c.id}" ${c.id === 'steam' ? 'title="Not hazardous; cannot be modelled"' : ''}>
          <span class="candidate-name">${c.chem.name} <span class="muted">${c.chem.formula}</span></span>
          <span class="candidate-bar"><span style="width: ${Math.round(c.share * 100)}%"></span></span>
          <span class="candidate-pct">${Math.round(c.share * 100)}%</span>
        </button>`).join('')}`;
  }

  /* ---------------------------------------------------------------- */
  /* Claude vision                                                    */
  /* ---------------------------------------------------------------- */

  updateAiButton() {
    this.el('hzAiBtn').disabled = !this.image || !this.el('hzApiKey').value.trim();
    this.persistKey();
  }

  persistKey() {
    try {
      if (this.el('hzRememberKey').checked && this.el('hzApiKey').value.trim()) {
        localStorage.setItem(API_KEY_STORAGE, this.el('hzApiKey').value.trim());
      } else {
        localStorage.removeItem(API_KEY_STORAGE);
      }
    } catch (err) { /* storage unavailable */ }
  }

  async identifyWithClaude() {
    const apiKey = this.el('hzApiKey').value.trim();
    if (!apiKey || !this.image) return;
    const out = this.el('hzAiResult');
    const btn = this.el('hzAiBtn');
    btn.disabled = true;
    btn.textContent = 'Asking Claude…';
    out.innerHTML = '<p class="fine-print">Uploading the image and waiting for Claude…</p>';

    let Anthropic;
    try {
      ({ default: Anthropic } = await import(ANTHROPIC_SDK_URL));
    } catch (err) {
      out.innerHTML = `<p class="ev-warn">Could not load the Anthropic SDK (${escapeHtml(err.message)}). This feature needs an internet connection.</p>`;
      btn.textContent = 'Identify with Claude';
      this.updateAiButton();
      return;
    }

    const ids = [...CHEMICALS.map(c => c.id), 'steam', 'unknown'];
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['scene_summary', 'visible_release', 'release_appearance', 'label_text', 'hazard_symbols', 'chemical_id', 'confidence', 'evidence', 'alternatives', 'release_size', 'safety_note'],
      properties: {
        scene_summary: { type: 'string' },
        visible_release: { type: 'boolean' },
        release_appearance: { type: 'string', enum: ['none', 'white-cloud', 'yellow-green', 'red-brown', 'dark-smoke', 'liquid-spill', 'frost-on-equipment', 'other'] },
        label_text: { type: 'array', items: { type: 'string' } },
        hazard_symbols: { type: 'array', items: { type: 'string' } },
        chemical_id: { type: 'string', enum: ids },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        evidence: { type: 'array', items: { type: 'string' } },
        alternatives: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['chemical_id', 'reason'],
            properties: { chemical_id: { type: 'string', enum: ids }, reason: { type: 'string' } }
          }
        },
        release_size: { type: 'string', enum: ['none', 'pinhole', 'small', 'medium', 'large', 'major'] },
        safety_note: { type: 'string' }
      }
    };

    const catalogue = CHEMICALS.map(c => `${c.id}: ${c.name} (${c.formula}, ${c.un}, CAS ${c.cas}) — appearance: ${c.visual}`).join('\n');
    const m = this.meta || {};
    const context = [
      `Camera source: ${m.sourceLabel || 'unknown'}${m.kind === 'thermal' ? ' (false-colour thermal image: bright = warm, dark = cold)' : ''}.`,
      this.roi ? `The user marked the release area as the box from (${Math.round(this.roi.x0 * 100)}%, ${Math.round(this.roi.y0 * 100)}%) to (${Math.round(this.roi.x1 * 100)}%, ${Math.round(this.roi.y1 * 100)}%) of the image.` : '',
      m.sensor ? `A gas sensor calibrated for ${CHEMICALS_BY_ID[m.sensor.gas].name} currently reads ${m.sensor.ppm} ppm.` : 'No gas sensor reading is available.',
      this.el('hzLabelText').value ? `The user typed this label text: "${this.el('hzLabelText').value}".` : '',
      `Chemicals the app can model:\n${catalogue}`,
      'Identify the most likely chemical being released or stored in this image.'
    ].filter(Boolean).join('\n\n');

    const scale = Math.min(1, 1024 / Math.max(this.image.width, this.image.height));
    const c = document.createElement('canvas');
    c.width = Math.round(this.image.width * scale);
    c.height = Math.round(this.image.height * scale);
    c.getContext('2d').drawImage(this.image, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.9).split(',')[1];

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const response = await client.beta.messages.create({
        model: 'claude-opus-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: 'You help industrial safety staff identify hazardous chemicals from workplace photos for a leak-response training tool. Base your answer on visible evidence: container labels, UN numbers, CAS numbers, GHS pictograms, NFPA diamonds, cylinder colours, piping labels and the appearance of any cloud or spill. Most toxic gases are colourless, and white clouds are often just condensed water vapour, so do not name a specific gas from a white or invisible cloud alone; use "unknown" or "steam" when the evidence does not support a specific chemical. Choose chemical_id only from the provided list. Be calibrated: "high" confidence requires readable labels or an unmistakable colour (yellow-green chlorine, red-brown nitrogen dioxide).',
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: context }
          ]
        }]
      });

      if (response.stop_reason === 'refusal') {
        out.innerHTML = '<p class="ev-warn">Claude declined to analyse this image. Choose the chemical manually.</p>';
        return;
      }
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const result = JSON.parse(text);
      this.ai = result;
      this.userPickedChemical = false;
      this.renderAiResult();
      this.analyze();
    } catch (err) {
      let msg = err.message;
      if (err instanceof Anthropic.AuthenticationError) msg = 'The API key was rejected. Check it in the Anthropic Console.';
      else if (err instanceof Anthropic.RateLimitError) msg = 'Rate limited by the API. Wait a moment and try again.';
      else if (err instanceof Anthropic.APIConnectionError) msg = 'Could not reach the Anthropic API (network or firewall).';
      else if (err instanceof SyntaxError) msg = 'Claude returned an unexpected response format.';
      out.innerHTML = `<p class="ev-warn">${escapeHtml(msg)}</p>`;
    } finally {
      btn.textContent = 'Identify with Claude';
      this.updateAiButton();
    }
  }

  renderAiResult() {
    const a = this.ai;
    if (!a) return;
    const name = a.chemical_id === 'unknown' ? 'Unknown' : a.chemical_id === 'steam' ? STEAM_CANDIDATE.name : CHEMICALS_BY_ID[a.chemical_id].name;
    this.el('hzAiResult').innerHTML = `
      <div class="ai-card">
        <div class="ai-top"><strong>${escapeHtml(name)}</strong> <span class="badge ${a.confidence === 'high' ? 'badge-safe' : a.confidence === 'medium' ? 'badge-warning' : 'badge-leak'}">${a.confidence} confidence</span></div>
        <p>${escapeHtml(a.scene_summary)}</p>
        ${a.label_text.length ? `<p><span class="muted">Text read:</span> ${a.label_text.map(escapeHtml).join(' · ')}</p>` : ''}
        ${a.hazard_symbols.length ? `<p><span class="muted">Symbols:</span> ${a.hazard_symbols.map(escapeHtml).join(' · ')}</p>` : ''}
        <ul class="evidence-list">${a.evidence.map(e => `<li class="ev-info">${escapeHtml(e)}</li>`).join('')}</ul>
        ${a.safety_note ? `<p class="ev-warn">${escapeHtml(a.safety_note)}</p>` : ''}
      </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Threat model                                                     */
  /* ---------------------------------------------------------------- */

  readScenario() {
    const num = (id, def) => {
      const v = parseFloat(this.el(id).value);
      return isFinite(v) ? v : def;
    };
    const room = { L: Math.max(1, num('hzRoomL', 12)), W: Math.max(1, num('hzRoomW', 8)), H: Math.max(1, num('hzRoomH', 4)) };
    return {
      setting: this.setting,
      releaseRateGs: Math.max(0.001, num('hzRate', 5)),
      durationMin: clamp(num('hzDuration', 15), 1, 480),
      tempC: clamp(num('hzTemp', 25), -40, 55),
      windSpeed: clamp(num('hzWind', 3), 0.5, 20),
      stability: this.el('hzStability').value,
      receptorDistance: clamp(num('hzReceptor', 50), 1, 10000),
      room,
      roomVolume: room.L * room.W * room.H,
      ach: clamp(num('hzAch', 4), 0, 60),
      mixing: parseFloat(this.el('hzMixing').value)
    };
  }

  renderAssessment() {
    const chemId = this.el('hzChemicalSelect').value;
    const card = this.el('hzThreatCard');
    this.el('hzSaveBtn').disabled = !chemId;
    this.el('hzReportBtn').disabled = !chemId;
    if (this.vision) this.renderCandidates();

    if (!chemId) {
      this.result = null;
      card.className = 'card threat-card threat-none';
      this.el('hzThreatLevel').textContent = '—';
      this.el('hzThreatChem').textContent = 'Select or identify a chemical';
      this.el('hzHeadline').textContent = 'Capture an image and analyse it, or choose the chemical in step 2. The threat model updates instantly.';
      this.el('hzTiles').innerHTML = '';
      this.el('hzZoneMap').innerHTML = '';
      this.el('hzZoneTable').innerHTML = '';
      this.el('hzModelNote').textContent = '';
      this.el('hzEffects').innerHTML = '<p class="muted">Health effects appear once a chemical is selected.</p>';
      this.el('hzAtmosphere').innerHTML = '<p class="muted">Atmospheric behaviour appears once a chemical is selected.</p>';
      this.el('hzActions').innerHTML = '<p class="muted">Recommended actions appear once a chemical is selected.</p>';
      const canvas = this.el('hzProfileChart');
      if (this.visible) prepareCanvas(canvas);
      return;
    }

    const chem = CHEMICALS_BY_ID[chemId];
    const s = this.readScenario();
    const r = assessRelease(chem, s);
    this.result = r;

    card.className = `card threat-card threat-${r.threat.key}`;
    this.el('hzThreatLevel').textContent = r.threat.label;
    this.el('hzThreatChem').innerHTML = `<strong>${chem.name}</strong> ${chem.formula}<div class="muted">${chem.un} · ERG guide ${chem.ergGuide} · ${chem.signal}</div>`;
    this.el('hzHeadline').textContent = r.headline;

    this.renderTiles(r);
    if (s.setting === 'outdoor') {
      this.el('hzZoneTitle').textContent = 'Threat zones (top view, downwind)';
      this.el('hzZoneSub').textContent = `${s.windSpeed} m/s wind · stability ${s.stability}`;
      this.el('hzZoneMap').innerHTML = this.outdoorMapSvg(r);
    } else {
      this.el('hzZoneTitle').textContent = 'Room build-up over time';
      this.el('hzZoneSub').textContent = `${Math.round(s.roomVolume)} m³ · ${s.ach} air changes/h`;
      this.el('hzZoneMap').innerHTML = this.indoorTimelineSvg(r);
    }
    if (this.visible) this.drawProfile(r);
    this.renderZoneTable(r);
    this.renderEffects(r);
    this.renderAtmosphere(r);
    this.renderActions(r);
  }

  renderTiles(r) {
    const s = r.scenario;
    const chem = r.chem;
    const z = (key) => r.zones.find(q => q.key === key);
    const tile = (label, value, sub, cls = '') => `<div class="hz-tile ${cls}"><div class="tile-label">${label}</div><div class="hz-tile-value" title="${value}">${value}</div><div class="muted" title="${sub}">${sub}</div></div>`;
    // Percent for large concentrations keeps tiles readable
    const compact = (ppm) => ppm >= 10000 ? `${+(ppm / 10000).toFixed(1)}%` : formatPpm(ppm);
    const tiles = [];
    if (s.setting === 'outdoor') {
      tiles.push(tile(`At ${formatDistance(s.receptorDistance)}`, r.receptorReached ? compact(r.receptorPpm) : 'Not reached', r.receptorReached ? `arrives in ~${formatDuration(r.receptorArrivalSec)}` : 'release ends first', r.threat.key === 'critical' || r.threat.key === 'high' ? 'tile-bad' : ''));
      const t3 = z('tox3') || z('o2crit');
      tiles.push(tile('Life-threatening zone', t3 && t3.distance ? formatDistance(t3.distance) : 'None', t3 ? t3.label : '', t3 && t3.distance ? 'tile-bad' : ''));
      const t2 = z('tox2');
      tiles.push(tile('Protective action zone', t2 && t2.distance ? formatDistance(t2.distance) : '–', t2 ? `${t2.label}: ${formatPpm(t2.ppm)}` : 'no AEGL-2 for this gas'));
      const f = z('fire3');
      tiles.push(tile('Ignitable cloud', chem.lelPct ? (f.distance ? formatDistance(f.distance) : 'None') : 'Non-flammable', chem.lelPct ? `LEL ${chem.lel}` : '', f && f.distance ? 'tile-bad' : ''));
    } else {
      tiles.push(tile('Room at end of release', compact(r.receptorPpm), `after ${s.durationMin} min${r.receptorPpm >= 10000 ? ` · ${Math.round(r.receptorPpm).toLocaleString()} ppm` : ''}`, r.threat.key === 'critical' || r.threat.key === 'high' ? 'tile-bad' : ''));
      const firstDanger = [z('tox3'), z('o2crit'), z('fire3')].filter(q => q && q.timeSec !== null).sort((a, b) => a.timeSec - b.timeSec)[0];
      tiles.push(tile('Life-threatening after', firstDanger ? formatDuration(firstDanger.timeSec) : 'Not reached', firstDanger ? firstDanger.label : 'during the release', firstDanger ? 'tile-bad' : ''));
      const t1 = z('tox1') || z('fire1');
      tiles.push(tile('First alarm level after', t1 && t1.timeSec !== null ? formatDuration(t1.timeSec) : 'Not reached', t1 ? `${t1.label}: ${formatPpm(t1.ppm)}` : ''));
      tiles.push(tile('Oxygen in room', `${r.receptorO2.toFixed(2)}%`, r.receptorO2 < 19.5 ? 'oxygen-deficient' : 'normal (gas is toxic long before O₂ drops)', r.receptorO2 < 19.5 ? 'tile-bad' : ''));
    }
    this.el('hzTiles').innerHTML = tiles.join('');
  }

  outdoorMapSvg(r) {
    const s = r.scenario;
    const shown = r.zones.filter(zn => ['tox1', 'tox2', 'tox3', 'fire3'].includes(zn.key) && zn.distance > 0);
    const extentCandidates = [s.receptorDistance * 1.15, 60];
    const t2 = r.zones.find(zn => zn.key === 'tox2');
    const t3 = r.zones.find(zn => zn.key === 'tox3');
    const t1 = r.zones.find(zn => zn.key === 'tox1');
    for (const zn of shown) {
      if (zn.key !== 'tox1' || !t2 || (t1 && t1.distance < 4 * (t2.distance || 1))) extentCandidates.push(zn.distance * 1.1);
    }
    const extent = Math.min(20000, Math.max(...extentCandidates));
    const W = 560, H = 220, x0 = 36, y0 = H / 2, pw = W - x0 - 20;
    const X = d => x0 + (d / extent) * pw;
    const maxHalf = Math.max(1, ...shown.map(zn => Math.min(zn.maxWidth, extent)));
    const yScale = Math.min((H / 2 - 24) / maxHalf, pw / extent * 4);
    const exaggeration = yScale / (pw / extent);

    const polys = shown.sort((a, b) => b.distance - a.distance).map(zn => {
      const top = [], bottom = [];
      const steps = 40;
      const end = Math.min(zn.distance, extent);
      for (let k = 0; k <= steps; k++) {
        const x = Math.max(1, (end * k) / steps);
        const hw = halfWidthAt(r.chem, s, x, zn.ppm) * yScale;
        top.push(`${X(x).toFixed(1)},${(y0 - hw).toFixed(1)}`);
        bottom.unshift(`${X(x).toFixed(1)},${(y0 + hw).toFixed(1)}`);
      }
      const dashed = zn.flammable ? 'stroke-dasharray="5 3"' : '';
      const fill = zn.flammable ? 'none' : ZONE_COLORS[zn.key];
      return `<polygon points="${top.concat(bottom).join(' ')}" fill="${fill}" fill-opacity="${zn.flammable ? 0 : 0.28}" stroke="${ZONE_COLORS[zn.key]}" stroke-width="1.5" ${dashed}/>`;
    }).join('');

    const tick = extent / 4;
    const niceTick = Math.pow(10, Math.floor(Math.log10(tick))) * [1, 2, 5, 10].find(f => f * Math.pow(10, Math.floor(Math.log10(tick))) >= tick);
    const ticks = [];
    for (let d = niceTick; d < extent; d += niceTick) {
      ticks.push(`<line x1="${X(d)}" y1="${H - 18}" x2="${X(d)}" y2="${H - 13}" stroke="var(--muted)"/><text x="${X(d)}" y="${H - 3}" text-anchor="middle" class="svg-label">${formatDistance(d)}</text>`);
    }
    const rx = X(Math.min(s.receptorDistance, extent));
    const offMap = t1 && t1.distance > extent ? `<text x="${W - 20}" y="16" text-anchor="end" class="svg-label">AEGL-1 zone continues to ${formatDistance(t1.distance)} →</text>` : '';

    return `
      <svg viewBox="0 0 ${W} ${H}" class="zone-svg" role="img" aria-label="Top view of threat zones downwind of the release">
        <line x1="${x0}" y1="${y0}" x2="${W - 20}" y2="${y0}" stroke="var(--border)" stroke-dasharray="3 3"/>
        ${polys}
        <circle cx="${x0}" cy="${y0}" r="6" fill="var(--ink)"/>
        <text x="${x0}" y="${y0 - 12}" text-anchor="middle" class="svg-label">Source</text>
        <g transform="translate(${rx}, ${y0})">
          <circle r="5" fill="var(--panel)" stroke="var(--ink)" stroke-width="2"/>
          <text y="-10" text-anchor="middle" class="svg-label">People (${formatDistance(s.receptorDistance)})</text>
        </g>
        <g transform="translate(${x0 + 4}, 18)">
          <text class="svg-label" x="0" y="4">Wind ${s.windSpeed} m/s</text>
          <line x1="72" y1="0" x2="112" y2="0" stroke="var(--muted)" stroke-width="2" marker-end="url(#hzArrow)"/>
        </g>
        <defs><marker id="hzArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--muted)"/></marker></defs>
        <line x1="${x0}" y1="${H - 16}" x2="${W - 20}" y2="${H - 16}" stroke="var(--muted)"/>
        ${ticks.join('')}
        ${offMap}
        ${exaggeration > 1.5 ? `<text x="${W - 20}" y="${H - 24}" text-anchor="end" class="svg-label">Crosswind width ×${exaggeration.toFixed(0)}</text>` : ''}
      </svg>
      <div class="zone-legend">
        <span><i style="background: ${ZONE_COLORS.tox3}"></i>Life-threatening</span>
        <span><i style="background: ${ZONE_COLORS.tox2}"></i>Serious harm</span>
        <span><i style="background: ${ZONE_COLORS.tox1}"></i>Discomfort</span>
        ${r.chem.lelPct ? `<span><i class="legend-dash" style="border-color: ${ZONE_COLORS.fire3}"></i>Ignitable (LEL)</span>` : ''}
      </div>`;
  }

  indoorTimelineSvg(r) {
    const s = r.scenario;
    const tEnd = s.durationMin * 60;
    const W = 560, H = 120, x0 = 20, pw = W - 40;
    const X = t => x0 + (t / tEnd) * pw;
    const events = r.zones.filter(z => z.timeSec !== null && ['tox1', 'tox2', 'tox3', 'fire1', 'fire3', 'o2crit'].includes(z.key))
      .sort((a, b) => a.timeSec - b.timeSec);
    const rows = events.map((e, i) => {
      const x = X(e.timeSec);
      const y = 34 + (i % 3) * 22;
      return `<line x1="${x}" y1="${y + 4}" x2="${x}" y2="${H - 26}" stroke="${ZONE_COLORS[e.key]}" stroke-width="2"/>
        <text x="${Math.min(x + 4, W - 150)}" y="${y}" class="svg-label" fill="${ZONE_COLORS[e.key]}">${e.label} · ${formatDuration(e.timeSec)}</text>`;
    }).join('');
    const worst = events.length ? events[events.length - 1] : null;
    const barColor = worst ? ZONE_COLORS[worst.key] : 'var(--safe)';
    return `
      <svg viewBox="0 0 ${W} ${H}" class="zone-svg" role="img" aria-label="Times at which the room reaches each level of concern">
        <rect x="${x0}" y="${H - 26}" width="${pw}" height="8" rx="4" fill="var(--bg)" stroke="var(--border)"/>
        ${events.length ? `<rect x="${X(events[0].timeSec)}" y="${H - 26}" width="${Math.max(2, x0 + pw - X(events[0].timeSec))}" height="8" rx="4" fill="${barColor}" fill-opacity="0.6"/>` : ''}
        ${rows || `<text x="${W / 2}" y="50" text-anchor="middle" class="svg-label">No level of concern is reached during the ${s.durationMin}-minute release.</text>`}
        <text x="${x0}" y="${H - 4}" class="svg-label">Release starts</text>
        <text x="${x0 + pw}" y="${H - 4}" text-anchor="end" class="svg-label">${s.durationMin} min</text>
        <text x="${x0}" y="14" class="svg-label">Room: ${s.room.L}×${s.room.W}×${s.room.H} m · ${s.releaseRateGs} g/s</text>
      </svg>`;
  }

  drawProfile(r) {
    const canvas = this.el('hzProfileChart');
    const s = r.scenario;
    const levels = r.levels.filter(l => ['tox1', 'tox2', 'tox3', 'fire3', 'o2crit'].includes(l.key));
    const peak = Math.max(...r.profile.map(p => p.ppm), 1e-3);
    const lowLevel = Math.min(...levels.map(l => l.ppm), peak);
    const yMin = Math.max(1e-3, Math.pow(10, Math.floor(Math.log10(lowLevel / 10))));
    const yMax = Math.min(1e6, Math.pow(10, Math.ceil(Math.log10(Math.max(peak, ...levels.map(l => l.ppm)) * 1.5))));
    const thresholds = levels.filter(l => l.ppm <= yMax).map(l => ({ y: l.ppm, label: l.label, color: ZONE_COLORS[l.key] }));

    if (s.setting === 'outdoor') {
      drawLineChart(canvas, {
        x: { min: 5, max: 5000, log: true, format: v => formatDistance(v) },
        y: { min: yMin, max: yMax, log: true, format: shortNumber, label: 'ppm (ground level)' },
        thresholds,
        markers: [{ x: s.receptorDistance, label: 'people', color: cssVar('--ink') }],
        series: [{ points: r.profile.map(p => [p.x, p.ppm]), color: cssVar('--brand'), width: 2.5 }]
      });
    } else {
      const tMax = r.profile[r.profile.length - 1].t / 60;
      drawLineChart(canvas, {
        x: { min: 0, max: tMax, format: v => `${Math.round(v)} min` },
        y: { min: yMin, max: yMax, log: true, format: shortNumber, label: 'ppm in room' },
        thresholds,
        markers: [{ x: s.durationMin, label: 'release stops', color: cssVar('--muted') }],
        series: [{ points: r.profile.map(p => [p.t / 60, Math.max(p.ppm, yMin)]), color: cssVar('--brand'), width: 2.5 }]
      });
    }
  }

  renderZoneTable(r) {
    const s = r.scenario;
    const rows = r.zones.map(z => `
      <tr>
        <td><span class="zone-dot" style="background: ${ZONE_COLORS[z.key]}"></span>${z.label}</td>
        <td>${formatPpm(z.ppm)}</td>
        <td class="table-font-sans">${z.meaning}</td>
        <td>${s.setting === 'outdoor' ? (z.distance > 0 ? `${formatDistance(z.distance)}${z.distance > r.travelLimit ? '*' : ''}` : 'not reached') : formatDuration(z.timeSec)}</td>
      </tr>`).join('');
    this.el('hzZoneTable').innerHTML = `
      <table>
        <thead><tr><th>Level of concern</th><th>Concentration</th><th>Meaning</th><th>${s.setting === 'outdoor' ? 'Reaches downwind' : 'Reached after'}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    const notes = [];
    if (s.setting === 'outdoor') {
      notes.push(`Steady-state Gaussian plume (Briggs open-country coefficients), ground-level release, flat terrain.`);
      if (r.zones.some(z => z.distance > r.travelLimit)) notes.push(`* In ${s.durationMin} min the plume only travels ~${formatDistance(r.travelLimit)}; zones beyond that apply only if the release continues.`);
    } else {
      notes.push(`Well-mixed room model: ${Math.round(s.roomVolume)} m³, ${s.ach} air changes/h × mixing factor ${s.mixing}. Concentrations near the leak and in dead corners will be higher.`);
    }
    if (r.denseGas) notes.push(`${r.chem.name} releases behave as a heavy, ground-hugging cloud near the source, which these models under-predict. Treat low-lying areas as more dangerous than shown.`);
    notes.push('Screening estimate for training and planning. Use ALOHA/CAMEO, site dispersion models and emergency responders for real incidents.');
    this.el('hzModelNote').textContent = notes.join(' ');
  }

  renderEffects(r) {
    const chem = r.chem;
    const s = r.scenario;
    const band = r.receptorEffect;
    const whereText = s.setting === 'outdoor' ? `people ${formatDistance(s.receptorDistance)} downwind` : `someone in the room at the end of the release`;
    const aeglIdx = aeglIndexForMinutes(Math.max(1, s.durationMin));

    const ladder = chem.effects.map(e => {
      const here = band === e;
      return `<li class="${here ? 'effect-here' : r.receptorPpm >= e.ppm ? 'effect-passed' : ''}">
        <span class="effect-ppm">${formatPpm(e.ppm)}${e.ppm === 0 ? '' : '+'}</span>
        <span class="effect-text">${escapeHtml(e.text)}${here ? ` <span class="here-tag">← ${whereText}</span>` : ''}</span>
      </li>`;
    }).join('');

    const aeglRows = chem.aegl ? [1, 2, 3].map(tier => `
      <tr>
        <td><strong>AEGL-${tier}</strong><div class="muted">${AEGL_TIER_TEXT[tier]}</div></td>
        ${AEGL_DURATIONS_MIN.map((d, i) => `<td class="${i === aeglIdx ? 'aegl-used' : ''}">${chem.aegl[tier] ? formatPpm(chem.aegl[tier][i]).replace(' ppm', '') : 'NR'}</td>`).join('')}
      </tr>`).join('') : '';

    this.el('hzEffects').innerHTML = `
      <p class="effects-lead">Predicted exposure for ${whereText}: <strong>${formatPpm(r.receptorPpm)}</strong>${s.setting === 'outdoor' && !r.receptorReached ? ' (if the release lasts long enough to reach them)' : ''}.
        ${band ? '' : 'Below the lowest listed effect level.'}</p>
      <ul class="effect-ladder">${ladder}</ul>
      ${chem.aegl ? `
        <div class="mini-heading" style="margin: 14px 0 6px;">EPA Acute Exposure Guideline Levels (ppm)</div>
        <div class="table-container">
          <table class="aegl-table">
            <thead><tr><th></th>${AEGL_DURATIONS_MIN.map(d => `<th>${d < 60 ? `${d} min` : `${d / 60} h`}</th>`).join('')}</tr></thead>
            <tbody>${aeglRows}</tbody>
          </table>
        </div>
        ${chem.aeglNote ? `<p class="fine-print">${chem.aeglNote}</p>` : ''}
        <p class="fine-print">Highlighted column is used for a ${s.durationMin}-minute exposure (rounded up to the next published duration).</p>` :
        `<p class="fine-print">No EPA AEGLs are published for ${chem.name}. Its hazard is fire/explosion and oxygen displacement rather than toxicity.</p>`}`;
  }

  renderAtmosphere(r) {
    const chem = r.chem;
    const vd = chem.vaporDensity;
    const behaviour = vd >= 1.2 ? { icon: '⬇️', text: `Sinks (${vd}× air): collects at floor level, in pits, drains and basements.` }
      : vd <= 0.8 ? { icon: '⬆️', text: `Rises (${vd}× air): collects under ceilings and roofs indoors.` }
      : { icon: '↔️', text: `Mixes evenly (${vd}× air): spreads through the whole room at breathing height.` };
    const fire = chem.lelPct
      ? `Flammable between ${chem.lel} and ${chem.uel} in air. ${r.fireRisk >= 1 ? `<strong>The modelled concentration (${formatPpm(r.receptorPpm)}) is inside the flammable range.</strong>` : r.fireRisk >= 0.25 ? `The modelled concentration reaches ${Math.round(r.fireRisk * 100)}% of the LEL — above the usual 25% LEL safety limit.` : `The modelled concentration is ${Math.max(0.1, r.fireRisk * 100).toFixed(1)}% of the LEL.`}`
      : 'Not flammable.';
    this.el('hzAtmosphere').innerHTML = `
      <div class="atmo-grid">
        <div class="atmo-item"><div class="atmo-icon">${behaviour.icon}</div><div>${behaviour.text}</div></div>
        <div class="atmo-item"><div class="atmo-icon">🔥</div><div>${fire}</div></div>
        <div class="atmo-item"><div class="atmo-icon">🫁</div><div>Oxygen at the modelled concentration: <strong>${r.receptorO2.toFixed(2)}%</strong>. ${chem.o2Displacement}.</div></div>
      </div>
      <ul class="bullet-list">${chem.atmosphere.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
  }

  renderActions(r) {
    const chem = r.chem;
    const s = r.scenario;
    const z = (key) => r.zones.find(q => q.key === key);
    const actions = [];
    const level = r.threat.key;

    if (s.setting === 'outdoor') {
      const protect = z('tox2')?.distance || z('tox3')?.distance || z('fire2')?.distance || 0;
      if (level === 'critical' || level === 'high') {
        actions.push(`<strong>Move people out of the plume path:</strong> evacuate crosswind, then upwind, to beyond ~${formatDistance(Math.max(100, protect * 1.2))} downwind (modelled protective-action distance with a 20% margin).`);
        actions.push(`If people cannot leave without crossing the plume, <strong>shelter in place</strong>: go indoors, close doors and windows, and switch off HVAC and extract fans.`);
      } else if (level === 'elevated') {
        actions.push(`Keep people out of the area within ~${formatDistance(Math.max(30, protect || z('tox1')?.distance || 30))} downwind until the release is stopped.`);
      } else {
        actions.push('No off-site protective action predicted for this release. Still isolate the immediate area and stop the leak.');
      }
      actions.push(`Check <strong>ERG 2024 Guide ${chem.ergGuide}</strong> (and Table 1 isolation distances for toxic-inhalation gases) with the local fire service.`);
    } else {
      if (level === 'critical' || level === 'high') {
        actions.push(`<strong>Evacuate the room immediately</strong> and do not re-enter without SCBA. ${chem.vaporDensity >= 1.2 ? 'Also clear basements and pits on lower levels.' : chem.vaporDensity <= 0.8 ? 'Also check mezzanines and rooms above.' : ''}`);
      } else {
        actions.push('Leave the room, keep the door closed and monitor the gas detector reading before re-entry.');
      }
      actions.push(`Increase exhaust ventilation from outside the room${chem.lelPct ? ' — only with fans and switches rated for flammable atmospheres; otherwise do not switch electrics on or off inside the cloud' : ''}. <button class="btn btn-secondary btn-xs" data-open-ventilation="1">Plan ventilation for this room →</button>`);
    }
    if (chem.lelPct) {
      const ign = s.setting === 'outdoor' ? z('fire1')?.distance : null;
      actions.push(`<strong>Remove ignition sources</strong>${ign ? ` within ~${formatDistance(Math.max(25, ign * 1.5))}` : ''}: no smoking, hot work, vehicles or non-rated electrics.`);
    }
    if (chem.id === 'ammonia') actions.push('Use fine water spray to knock down the vapour cloud from a distance; contain the run-off (it is alkaline and toxic to aquatic life).');
    if (chem.id === 'chlorine') actions.push('Do not spray water directly on a leaking chlorine container — it makes the leak worse by corrosion. Use the chlorine emergency kit (A/B/C) if trained.');
    if (chem.id === 'no2') actions.push('Everyone exposed needs medical observation for 24–48 h, even without symptoms: lung injury is delayed.');
    if (chem.id === 'hcn') actions.push('Have the cyanide antidote (hydroxocobalamin) and trained responders ready before rescue.');
    if (chem.id === 'h2s') actions.push('Do not rely on smell: H₂S deadens the sense of smell above ~100 ppm. Rescuers must wear SCBA.');
    if (chem.id === 'co') actions.push('Shut down combustion sources (heaters, engines) and ventilate. Anyone with headache or confusion needs 100% oxygen and medical assessment.');

    actions.push(`<strong>PPE:</strong> ${escapeHtml(chem.ppe)}.`);
    actions.push(`<strong>First aid:</strong> ${escapeHtml(chem.firstAid)}`);
    actions.push(`<strong>Detection:</strong> ${escapeHtml(chem.detection)}.`);

    this.el('hzActions').innerHTML = `<ol class="action-list">${actions.map(a => `<li>${a}</li>`).join('')}</ol>`;
  }

  /* ---------------------------------------------------------------- */
  /* Save, report, links                                              */
  /* ---------------------------------------------------------------- */

  thumbnail() {
    if (!this.image) return null;
    const c = document.createElement('canvas');
    const scale = Math.min(1, 240 / this.image.width);
    c.width = Math.round(this.image.width * scale);
    c.height = Math.round(this.image.height * scale);
    c.getContext('2d').drawImage(this.image, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  saveAssessment() {
    const r = this.result;
    if (!r) return;
    const incidentId = this.meta?.incidentId || null;
    this.telemetry.addAssessment({
      incidentId,
      chemicalId: r.chem.id,
      chemicalName: r.chem.name,
      threat: r.threat.label,
      headline: r.headline,
      setting: r.scenario.setting,
      releaseRateGs: r.scenario.releaseRateGs,
      durationMin: r.scenario.durationMin,
      scenario: r.scenario,
      receptorPpm: r.receptorPpm,
      thumb: this.thumbnail()
    });
    const btn = this.el('hzSaveBtn');
    btn.textContent = incidentId ? 'Saved to incident ✓' : 'Saved ✓';
    setTimeout(() => { btn.textContent = 'Save to incident log'; }, 2000);
  }

  openVentilation() {
    const r = this.result;
    if (!r) return;
    const s = r.scenario;
    window.gasVisionRouter.go('ventilation', {
      room: { L: s.room.L, W: s.room.W, H: s.room.H },
      chemicals: [{ id: r.chem.id, rateGs: s.releaseRateGs }],
      currentExhaustM3h: Math.round(s.ach * s.roomVolume)
    });
  }

  downloadReport() {
    const r = this.result;
    if (!r) return;
    const s = r.scenario;
    const map = this.el('hzZoneMap').innerHTML;
    const table = this.el('hzZoneTable').innerHTML;
    const effects = this.el('hzEffects').innerHTML;
    const atmosphere = this.el('hzAtmosphere').innerHTML;
    const actions = this.el('hzActions').innerHTML.replace(/<button[^>]*>.*?<\/button>/g, '');
    const img = this.image ? `<img src="${this.image.toDataURL('image/jpeg', 0.85)}" alt="Captured image" style="max-width:100%;border-radius:8px;">` : '';
    const scenario = s.setting === 'outdoor'
      ? `Outdoor · ${s.releaseRateGs} g/s for ${s.durationMin} min · wind ${s.windSpeed} m/s · stability ${s.stability} · people at ${s.receptorDistance} m · ${s.tempC} °C`
      : `Indoor room ${s.room.L}×${s.room.W}×${s.room.H} m · ${s.releaseRateGs} g/s for ${s.durationMin} min · ${s.ach} ACH · mixing ${s.mixing} · ${s.tempC} °C`;
    const colors = { low: '#1E8E5A', elevated: '#D48A06', high: '#D0342C', critical: '#9B1C1C' };
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Hazard assessment – ${escapeHtml(r.chem.name)}</title>
<style>
:root{--ink:#0E2A47;--muted:#5B6B7C;--border:#D6DEE7;--bg:#EEF2F6;--panel:#fff;--safe:#1E8E5A;--brand:#1446A0}
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0E2A47;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.5;font-size:14px}
h1{font-size:22px;margin:0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #D6DEE7;padding-bottom:4px;margin-top:28px}
.banner{border-left:6px solid ${colors[r.threat.key]};background:#F6F8FB;padding:12px 16px;border-radius:6px;margin:16px 0}
.level{font-size:26px;font-weight:800;color:${colors[r.threat.key]}}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #D6DEE7;padding:6px;text-align:left;vertical-align:top}
.muted,.fine-print{color:#5B6B7C;font-size:12px}.svg-label{font-size:11px;fill:#5B6B7C}.zone-legend span{margin-right:12px;font-size:12px}.zone-legend i{display:inline-block;width:10px;height:10px;margin-right:4px}
.zone-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}.effect-ladder{list-style:none;padding:0}.effect-ladder li{display:flex;gap:10px;padding:4px 0;border-bottom:1px dashed #D6DEE7}
.effect-ppm{min-width:120px;font-family:monospace}.effect-here{background:#FCEBEA;font-weight:600}.aegl-used{background:#FEF7E6;font-weight:700}
.atmo-grid{display:grid;gap:8px}.atmo-item{display:flex;gap:8px}</style></head><body>
<h1>Chemical hazard assessment</h1>
<div class="muted">GasVision AI · generated ${new Date().toLocaleString()} · screening estimate, not for emergency decisions</div>
<div class="banner"><div class="level">${r.threat.label}</div><div><strong>${escapeHtml(r.chem.name)}</strong> (${r.chem.formula}, ${r.chem.un}, CAS ${r.chem.cas}, ERG ${r.chem.ergGuide})</div><p>${escapeHtml(r.headline)}</p><div class="muted">${escapeHtml(scenario)}</div></div>
${img}
<h2>Threat zones</h2>${map}${table}<p class="fine-print">${escapeHtml(this.el('hzModelNote').textContent)}</p>
<h2>Health effects</h2>${effects}
<h2>In the atmosphere</h2>${atmosphere}
<h2>Immediate actions</h2>${actions}
</body></html>`;
    downloadText(`hazard_assessment_${r.chem.id}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.html`, html, 'text/html');
  }
}
