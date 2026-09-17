'use strict';

/* =====================================================================
   VENTILATION PLANNER
   Layout and airflow sizing for chemical / gas-cylinder storage rooms.

   Design basis (verified 2026-09):
   - IFC §5004.3.1 / NFPA 30: continuous mechanical exhaust ≥ 1 cfm/ft² of
     floor area (NFPA 30: not less than 150 cfm), exhaust pickup within
     12 in (300 mm) of the floor or ceiling according to vapour density,
     no recirculation, manual shutoff outside the room.
   - Flammable vapours kept below 25% of the LEL.
   - Dilution ventilation (ACGIH Industrial Ventilation):
     Q = K · G / C_target, mixing factor K = 3 (good) … 10 (poor).
   - IIAR 2 (ammonia machinery rooms): emergency exhaust ≥ 30 air changes/h,
     started at 150 ppm; discharge ≥ 20 ft (6 m) from openings.
   ===================================================================== */

const VENT_STORAGE_KEY = 'gasvision.ventilation.v1';
const CFM_PER_FT2_TO_M3H_PER_M2 = 18.288;   // 1 cfm/ft² in m³/h per m²
const MIN_EXHAUST_M3H = 254.9;              // 150 cfm
const EMERGENCY_ACH = 30;
const PRACTICAL_CONTINUOUS_ACH = 12;         // above this, dilution alone is a poor design

const MIXING_OPTIONS = {
  good: { label: 'Good – air sweeps the whole room', K: 3, m: 1 },
  typical: { label: 'Typical – general exhaust, some dead corners', K: 5, m: 0.5 },
  poor: { label: 'Poor – racks block airflow, one small fan', K: 10, m: 0.2 }
};

const STORAGE_FORMS = {
  cylinder: { label: 'Gas cylinders', rateGs: 0.5, leak: 'valve / regulator leak' },
  manifold: { label: 'Cylinder manifold / pipework', rateGs: 2, leak: 'fitting or flange leak' },
  drum: { label: 'Liquid drums / IBCs', rateGs: 1, leak: 'evaporation from a spill' },
  tank: { label: 'Bulk vessel', rateGs: 10, leak: 'gasket or small line failure' }
};

// Pairs that must not share a room (or need ≥ 6 m / fire-rated separation)
const INCOMPATIBLE_RULES = [
  { a: ['chlorine'], b: ['ammonia'], severity: 'fail', text: 'Chlorine and ammonia react to form explosive nitrogen trichloride and toxic chloramines. Never store in the same room.' },
  { a: ['chlorine', 'no2'], b: ['methane', 'propane', 'h2s', 'co', 'benzene', 'hcn', 'eto', 'acetylene'], severity: 'fail', text: 'Oxidizing gases intensify fires and can ignite flammable gases. Separate by at least 6 m (20 ft) or a 1-hour fire barrier, or use separate gas cabinets.' },
  { a: ['ammonia'], b: ['so2', 'no2'], severity: 'warn', text: 'Ammonia reacts with acidic gases (SO₂, NO₂) forming corrosive salts and heat. Store apart and use separate exhaust pickups.' }
];

const VENT_CHECKLIST = [
  { group: 'Design', items: [
    'Air sweeps across the whole floor from the door side to the storage side, with no dead corners behind racks.',
    'Exhaust pickups within 300 mm of the floor (heavy gases) and/or the ceiling (light gases).',
    'Room held at slight negative pressure (exhaust ~10% more than make-up air) so leaks do not spread into corridors.',
    'Exhaust is never recirculated; it discharges vertically outdoors, away from air intakes, doors and windows.',
    'Make-up air openings sized for the full exhaust flow so doors still open easily.',
    'Spark-resistant fan and hazardous-area-rated motor where flammable gases are stored.',
    'Highly toxic gases kept in exhausted gas cabinets instead of relying on room dilution.'
  ]},
  { group: 'Operation', items: [
    'Exhaust runs continuously (or is interlocked with lights and gas detection).',
    'Gas detectors mounted at the right height for each gas.',
    'Low alarm boosts ventilation; high alarm starts emergency purge, sounds alarms and closes automatic shut-off valves.',
    'Gas reading and fan status displayed outside the door before anyone enters.',
    'Airflow switch or fan-failure alarm on every exhaust fan.',
    'Exhaust fans and detectors on backup power.'
  ]},
  { group: 'Maintenance', items: [
    'Monthly smoke-pencil check that air flows toward the exhaust grilles.',
    'Exhaust flow measured (anemometer or pitot traverse) at least annually and after any change.',
    'Gas detectors calibrated to the manufacturer schedule (typically every 6 months).',
    'Nothing stored within 0.5 m of grilles, louvres or detectors.',
    'Fan belts, dampers, duct joints and discharge cap inspected quarterly.'
  ]},
  { group: 'Emergency', items: [
    'Manual emergency-ventilation and fan shutoff switches outside the room, next to the door.',
    'Nobody enters after a high alarm without SCBA; ventilate from outside first.',
    'Ventilation layout, detector locations and emergency procedure posted at the door.'
  ]}
];

function defaultVentilationPlan() {
  return {
    name: 'Gas cylinder store',
    L: 8, W: 5, H: 3.5,
    doorWall: 'south',
    mixing: 'typical',
    tempC: 25,
    items: [
      { id: 'ammonia', form: 'cylinder', qty: 2, rateGs: 0.5 },
      { id: 'propane', form: 'cylinder', qty: 6, rateGs: 0.5 }
    ],
    existing: { exhaustM3h: 400, exhaustPos: 'high', supply: 'none', detection: false, interlock: false, outsideSwitch: false },
    checklist: {}
  };
}

function densityClass(chem) {
  if (chem.vaporDensity >= 1.2) return 'heavy';
  if (chem.vaporDensity <= 0.8) return 'light';
  return 'neutral';
}

/* ---------------------------------------------------------------------
   Engineering calculations (pure)
   --------------------------------------------------------------------- */
function computeVentilation(plan) {
  const area = plan.L * plan.W;
  const volume = area * plan.H;
  const mix = MIXING_OPTIONS[plan.mixing] || MIXING_OPTIONS.typical;
  const achOf = (m3h) => m3h / volume;

  const codeMin = Math.max(CFM_PER_FT2_TO_M3H_PER_M2 * area, MIN_EXHAUST_M3H);

  const items = plan.items.filter(it => CHEMICALS_BY_ID[it.id]).map(it => {
    const chem = CHEMICALS_BY_ID[it.id];
    const G = Math.max(0, it.rateGs) * 1000; // mg/s
    const rows = [];
    if (chem.oelPpm && chem.categories.includes('toxic')) {
      const target = ppmToMgm3(chem.oelPpm, chem.mw, plan.tempC);
      rows.push({ basis: `toxic: keep below occupational limit ${formatPpm(chem.oelPpm)}`, targetPpm: chem.oelPpm, q: (mix.K * G / target) * 3600 });
    }
    if (chem.lelPct) {
      const targetPpm = chem.lelPct * 2500; // 25% LEL
      const target = ppmToMgm3(targetPpm, chem.mw, plan.tempC);
      rows.push({ basis: `flammable: keep below 25% LEL (${formatPpm(targetPpm)})`, targetPpm, q: (mix.K * G / target) * 3600 });
    }
    if (rows.length === 0 && chem.oelPpm) {
      const target = ppmToMgm3(chem.oelPpm, chem.mw, plan.tempC);
      rows.push({ basis: `keep below exposure limit ${formatPpm(chem.oelPpm)}`, targetPpm: chem.oelPpm, q: (mix.K * G / target) * 3600 });
    }
    const driver = rows.reduce((a, r) => (!a || r.q > a.q) ? r : a, null);
    return {
      ...it, chem,
      density: densityClass(chem),
      dilution: driver,
      practical: driver ? achOf(driver.q) <= PRACTICAL_CONTINUOUS_ACH : true
    };
  });

  const maxDilution = items.reduce((a, i) => Math.max(a, i.dilution ? i.dilution.q : 0), 0);
  const continuous = Math.max(codeMin, Math.min(maxDilution, PRACTICAL_CONTINUOUS_ACH * volume));
  const emergency = Math.max(EMERGENCY_ACH * volume, continuous);

  // Where the exhaust must pick up
  const classes = new Set(items.map(i => i.density));
  const needLow = classes.has('heavy') || classes.has('neutral');
  const needHigh = classes.has('light') || classes.has('neutral');
  const exhaustPos = needLow && needHigh ? 'both' : needLow ? 'low' : needHigh ? 'high' : 'low';
  const intakePos = exhaustPos === 'both' ? 'mid' : exhaustPos === 'low' ? 'high' : 'low';

  // Share of exhaust at low level. With gases at both levels, split evenly and
  // balance on site using detector readings (dilution demand is not a fair weight
  // when one gas must be enclosed rather than diluted).
  const lowShare = exhaustPos === 'low' ? 1 : exhaustPos === 'high' ? 0 : 0.5;

  // Incompatibilities
  const ids = new Set(items.map(i => i.id));
  const conflicts = [];
  for (const rule of INCOMPATIBLE_RULES) {
    const aHit = rule.a.filter(x => ids.has(x));
    const bHit = rule.b.filter(x => ids.has(x) && !aHit.includes(x));
    if (aHit.length && bHit.length) {
      conflicts.push({ ...rule, pair: [...aHit, ...bHit].map(x => CHEMICALS_BY_ID[x].name) });
    }
  }

  const flammable = items.some(i => i.chem.lelPct);
  const toxic = items.some(i => i.chem.categories.includes('toxic'));
  const corrosive = items.filter(i => i.chem.categories.includes('corrosive') || i.chem.categories.includes('oxidizer'));
  const hasAmmonia = ids.has('ammonia');

  // Existing-installation checks
  const ex = plan.existing;
  const checks = [];
  const add = (status, title, detail) => checks.push({ status, title, detail });
  add(ex.exhaustM3h >= codeMin ? 'pass' : 'fail', 'Continuous exhaust meets the code minimum',
    `${Math.round(ex.exhaustM3h)} m³/h installed vs ${Math.round(codeMin)} m³/h required (1 cfm/ft² of floor, min 150 cfm).`);
  if (maxDilution > 0) {
    add(ex.exhaustM3h >= Math.min(maxDilution, PRACTICAL_CONTINUOUS_ACH * volume) ? 'pass' : 'warn', 'Exhaust dilutes the design-basis leak',
      `${Math.round(ex.exhaustM3h)} m³/h installed vs ${Math.round(Math.min(maxDilution, PRACTICAL_CONTINUOUS_ACH * volume))} m³/h to dilute the worst credible leak.`);
  }
  const posOk = ex.exhaustPos === exhaustPos || ex.exhaustPos === 'both';
  add(ex.exhaustPos === 'none' ? 'fail' : posOk ? 'pass' : 'fail', 'Exhaust picks up at the right height',
    ex.exhaustPos === 'none' ? 'No exhaust pickup.' : posOk ? `Pickup ${ex.exhaustPos} matches the stored gases.` : `Pickup is ${ex.exhaustPos}; stored gases need ${exhaustPos === 'both' ? 'both low and high' : exhaustPos} level extraction.`);
  add(ex.supply === 'none' ? 'fail' : 'pass', 'Make-up air is provided',
    ex.supply === 'none' ? 'Without a dedicated inlet the fan pulls air through door gaps, cannot reach its rated flow, and leaves the far side of the room unswept.' : `${ex.supply === 'louvre' ? 'Louvred inlet' : 'Mechanical supply'} provides replacement air.`);
  if (toxic || flammable) {
    add(ex.detection ? 'pass' : 'fail', 'Gas detection installed', ex.detection ? 'Fixed gas detection present.' : 'Toxic or flammable gases are stored without fixed gas detection.');
    add(ex.interlock ? 'pass' : 'warn', 'Detection controls the ventilation', ex.interlock ? 'Alarms boost or start the exhaust.' : 'Link low alarm to high-speed exhaust and high alarm to emergency purge and shut-off valves.');
  }
  add(ex.outsideSwitch ? 'pass' : 'warn', 'Manual shutoff / emergency switch outside the door', ex.outsideSwitch ? 'Switch located outside the room.' : 'Required by IFC §5004.3.1: operate the ventilation without entering the room.');
  if (ex.exhaustM3h >= emergency) {
    add('pass', 'Emergency purge capacity (30 air changes/h)', `${achOf(ex.exhaustM3h).toFixed(1)} ACH available.`);
  } else {
    // Emergency purge is expected for toxic gases (IIAR 2 practice); for flammables it is good practice
    add(toxic ? 'warn' : 'pass', 'Emergency purge capacity (30 air changes/h)',
      `${achOf(ex.exhaustM3h).toFixed(1)} ACH installed vs ${EMERGENCY_ACH} ACH (${Math.round(emergency)} m³/h). ${toxic ? 'A second high-speed fan on the detection interlock can provide this.' : 'Optional for flammable-only storage when detection and continuous exhaust are in place.'}`);
  }
  for (const c of conflicts) add(c.severity, `Incompatible storage: ${c.pair.join(' + ')}`, c.text);

  const verdict = checks.some(c => c.status === 'fail') ? 'inadequate' : checks.some(c => c.status === 'warn') ? 'improve' : 'adequate';

  // Leak simulation: worst item under current vs recommended ventilation
  const simDuration = 30;
  const sims = items.map(it => {
    const levels = levelsOfConcern(it.chem, simDuration);
    const danger = levels.find(l => l.key === 'tox3') || levels.find(l => l.key === 'fire3') || levels.find(l => l.key === 'o2crit');
    const target = it.dilution ? it.dilution.targetPpm : levels.find(l => l.tier === 1)?.ppm;
    const scenario = (m3h) => ({ setting: 'indoor', releaseRateGs: it.rateGs, durationMin: simDuration, tempC: plan.tempC, roomVolume: volume, ach: achOf(m3h), mixing: mix.m });
    const cur = scenario(ex.exhaustM3h);
    const rec = scenario(continuous);
    return {
      item: it, danger, target,
      current: { endPpm: roomPpm(it.chem, cur, simDuration * 60), toTarget: roomTimeToPpm(it.chem, cur, target), toDanger: danger ? roomTimeToPpm(it.chem, cur, danger.ppm) : null, scenario: cur },
      recommended: { endPpm: roomPpm(it.chem, rec, simDuration * 60), toTarget: roomTimeToPpm(it.chem, rec, target), toDanger: danger ? roomTimeToPpm(it.chem, rec, danger.ppm) : null, scenario: rec }
    };
  });
  const worst = sims.reduce((a, s) => {
    const score = (x) => (x.current.endPpm / (x.danger ? x.danger.ppm : x.target || 1));
    return !a || score(s) > score(a) ? s : a;
  }, null);

  return {
    area, volume, mix, codeMin, maxDilution, continuous, emergency,
    items, exhaustPos, intakePos, lowShare, conflicts, flammable, toxic, corrosive, hasAmmonia,
    checks, verdict, sims, worst, simDuration,
    currentAch: achOf(ex.exhaustM3h), continuousAch: achOf(continuous), emergencyAch: achOf(emergency)
  };
}

/* ---------------------------------------------------------------------
   View
   --------------------------------------------------------------------- */
class VentilationPlanner {
  constructor(root) {
    this.root = root;
    this.plan = this.load();
    this.visible = false;
    this.renderShell();
    this.bindEvents();
    this.syncInputs();
    this.update();
    window.addEventListener('resize', () => { if (this.visible) this.drawLeakChart(); });
  }

  load() {
    try {
      const raw = localStorage.getItem(VENT_STORAGE_KEY);
      if (raw) return { ...defaultVentilationPlan(), ...JSON.parse(raw) };
    } catch (err) { /* ignore */ }
    return defaultVentilationPlan();
  }

  save() {
    try { localStorage.setItem(VENT_STORAGE_KEY, JSON.stringify(this.plan)); } catch (err) { /* ignore */ }
  }

  show(params) {
    this.visible = true;
    if (params) {
      // Arriving from the Hazard Scanner describes a specific room: start its plan fresh
      if (params.room) {
        Object.assign(this.plan, { name: 'Room from Hazard Scanner', L: params.room.L, W: params.room.W, H: params.room.H });
      }
      if (params.chemicals) {
        this.plan.items = params.chemicals.map(c => ({ id: c.id, form: 'cylinder', qty: 1, rateGs: c.rateGs }));
      }
      if (params.currentExhaustM3h !== undefined) this.plan.existing.exhaustM3h = params.currentExhaustM3h;
      this.syncInputs();
    }
    this.update();
  }

  hide() {
    this.visible = false;
  }

  $(id) {
    return document.getElementById(id);
  }

  renderShell() {
    const opt = (obj) => Object.entries(obj).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Ventilation Planner</h2>
          <p>Lay out and size ventilation for a chemical or gas-cylinder storage room, check what is installed, and see how a leak builds up.</p>
        </div>
        <div class="page-actions">
          <button id="vpResetBtn" class="btn btn-secondary btn-sm">Reset example</button>
          <button id="vpLeakBtn" class="btn btn-secondary btn-sm">Model a leak in this room →</button>
          <button id="vpReportBtn" class="btn btn-primary btn-sm">Download plan</button>
        </div>
      </div>

      <div class="vp-grid">
        <div class="hz-col">
          <section class="card">
            <div class="card-header"><span class="card-title"><span class="step-num">1</span> Room</span></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="setting-row" style="grid-column: span 2;">
                  <label for="vpName">Room name</label>
                  <input type="text" id="vpName">
                </div>
                <div class="setting-row" style="grid-column: span 2;">
                  <label>Length × Width × Height (m)</label>
                  <div class="dims">
                    <input type="number" id="vpL" min="1" max="100" step="0.1" aria-label="Room length (m)">
                    <input type="number" id="vpW" min="1" max="100" step="0.1" aria-label="Room width (m)">
                    <input type="number" id="vpH" min="2" max="20" step="0.1" aria-label="Room height (m)">
                  </div>
                </div>
                <div class="setting-row">
                  <label for="vpDoor">Door is on the</label>
                  <select id="vpDoor">
                    <option value="south">South wall (bottom of plan)</option>
                    <option value="north">North wall (top of plan)</option>
                    <option value="west">West wall (left)</option>
                    <option value="east">East wall (right)</option>
                  </select>
                </div>
                <div class="setting-row">
                  <label for="vpTemp">Room temperature (°C)</label>
                  <input type="number" id="vpTemp" min="-20" max="50" step="1">
                </div>
                <div class="setting-row" style="grid-column: span 2;">
                  <label for="vpMixing">Air distribution</label>
                  <select id="vpMixing">${opt(MIXING_OPTIONS)}</select>
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <span class="card-title"><span class="step-num">2</span> Stored chemicals</span>
              <button id="vpAddItemBtn" class="btn btn-secondary btn-xs">+ Add chemical</button>
            </div>
            <div class="card-body">
              <div id="vpItems" class="vp-items"></div>
              <p class="fine-print">Design-basis leak: the largest credible continuous leak the ventilation must handle (not a catastrophic failure). Defaults: cylinder valve 0.5 g/s, manifold fitting 2 g/s, spill evaporation 1 g/s, bulk vessel 10 g/s.</p>
            </div>
          </section>

          <section class="card">
            <div class="card-header"><span class="card-title"><span class="step-num">3</span> What is installed now</span></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="setting-row">
                  <label for="vpExFlow">Exhaust airflow (m³/h)</label>
                  <input type="number" id="vpExFlow" min="0" step="10">
                  <span id="vpExAch" class="fine-print" style="margin: 0;"></span>
                </div>
                <div class="setting-row">
                  <label for="vpExPos">Exhaust pickup height</label>
                  <select id="vpExPos">
                    <option value="none">No exhaust</option>
                    <option value="low">Low (near floor)</option>
                    <option value="high">High (near ceiling)</option>
                    <option value="both">Both low and high</option>
                  </select>
                </div>
                <div class="setting-row" style="grid-column: span 2;">
                  <label for="vpSupply">Make-up (fresh) air</label>
                  <select id="vpSupply">
                    <option value="none">None – only door gaps</option>
                    <option value="louvre">Louvred wall / door inlet</option>
                    <option value="mechanical">Mechanical supply fan</option>
                  </select>
                </div>
              </div>
              <div class="vp-checks-inline">
                <label class="checkbox-row"><input type="checkbox" id="vpDetection"> Fixed gas detection</label>
                <label class="checkbox-row"><input type="checkbox" id="vpInterlock"> Detection controls the fans</label>
                <label class="checkbox-row"><input type="checkbox" id="vpSwitch"> Switch outside the door</label>
              </div>
            </div>
          </section>
        </div>

        <div class="hz-col">
          <section id="vpVerdictCard" class="card threat-card">
            <div class="threat-banner">
              <div>
                <div class="threat-kicker">Ventilation verdict</div>
                <div class="threat-level" id="vpVerdict">—</div>
              </div>
              <div class="threat-chem" id="vpRoomSummary"></div>
            </div>
            <p class="threat-headline" id="vpHeadline"></p>
            <div class="hz-tiles" id="vpTiles"></div>
          </section>

          <section class="card">
            <div class="card-header">
              <span class="card-title">Recommended layout</span>
              <span class="fine-print" style="margin: 0;">Plan view and section</span>
            </div>
            <div class="card-body">
              <div id="vpPlan" class="vp-drawing"></div>
              <div id="vpSection" class="vp-drawing" style="margin-top: 12px;"></div>
              <div class="zone-legend" style="margin-top: 8px;">
                <span><i style="background: #2563EB"></i>Fresh air inlet</span>
                <span><i style="background: #D0342C"></i>Exhaust pickup</span>
                <span><i style="background: #D48A06; border-radius: 50%"></i>Gas detector</span>
                <span><i style="background: #64748B"></i>Storage</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-header"><span class="card-title">Where everything goes</span></div>
            <div class="card-body" id="vpPlacement"></div>
          </section>

          <section class="card">
            <div class="card-header"><span class="card-title">Required airflow</span></div>
            <div class="card-body">
              <div id="vpAirflow" class="table-container"></div>
              <p class="fine-print">Dilution: Q = K × G ÷ C<sub>target</sub> with mixing factor K = <span id="vpK"></span>. Continuous rate is capped at ${PRACTICAL_CONTINUOUS_ACH} air changes/h; leaks needing more should be enclosed (gas cabinet or local exhaust) rather than diluted.</p>
            </div>
          </section>

          <section class="card">
            <div class="card-header"><span class="card-title">Installed ventilation check</span></div>
            <div class="card-body"><ul id="vpChecks" class="check-list"></ul></div>
          </section>

          <section class="card">
            <div class="card-header">
              <span class="card-title">Leak in this room: current vs recommended</span>
              <span id="vpLeakSub" class="fine-print" style="margin: 0;"></span>
            </div>
            <div class="card-body">
              <div class="chart-box" style="height: 220px;"><canvas id="vpLeakChart" role="img" aria-label="Room concentration during a design-basis leak"></canvas></div>
              <div id="vpLeakTable" class="table-container" style="margin-top: 10px;"></div>
            </div>
          </section>
        </div>
      </div>

      <section class="card" style="margin-top: 4px;">
        <div class="card-header">
          <span class="card-title">Ventilation good-practice checklist</span>
          <span id="vpChecklistScore" class="data-badge"></span>
        </div>
        <div class="card-body"><div id="vpChecklist" class="vp-checklist"></div></div>
      </section>`;
  }

  bindEvents() {
    const num = (id, key, min, max) => this.$(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) { this.plan[key] = clamp(v, min, max); this.update(); }
    });
    num('vpL', 'L', 1, 100);
    num('vpW', 'W', 1, 100);
    num('vpH', 'H', 2, 20);
    num('vpTemp', 'tempC', -20, 50);
    this.$('vpName').addEventListener('input', (e) => { this.plan.name = e.target.value; this.update(); });
    this.$('vpDoor').addEventListener('change', (e) => { this.plan.doorWall = e.target.value; this.update(); });
    this.$('vpMixing').addEventListener('change', (e) => { this.plan.mixing = e.target.value; this.update(); });

    this.$('vpExFlow').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) { this.plan.existing.exhaustM3h = Math.max(0, v); this.update(); }
    });
    this.$('vpExPos').addEventListener('change', (e) => { this.plan.existing.exhaustPos = e.target.value; this.update(); });
    this.$('vpSupply').addEventListener('change', (e) => { this.plan.existing.supply = e.target.value; this.update(); });
    this.$('vpDetection').addEventListener('change', (e) => { this.plan.existing.detection = e.target.checked; this.update(); });
    this.$('vpInterlock').addEventListener('change', (e) => { this.plan.existing.interlock = e.target.checked; this.update(); });
    this.$('vpSwitch').addEventListener('change', (e) => { this.plan.existing.outsideSwitch = e.target.checked; this.update(); });

    this.$('vpAddItemBtn').addEventListener('click', () => {
      const unused = CHEMICALS.find(c => !this.plan.items.some(i => i.id === c.id)) || CHEMICALS[0];
      this.plan.items.push({ id: unused.id, form: 'cylinder', qty: 1, rateGs: STORAGE_FORMS.cylinder.rateGs });
      this.renderItems();
      this.update();
    });

    this.$('vpItems').addEventListener('input', (e) => this.onItemChange(e));
    this.$('vpItems').addEventListener('change', (e) => this.onItemChange(e));
    this.$('vpItems').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm) return;
      this.plan.items.splice(parseInt(rm.dataset.remove, 10), 1);
      this.renderItems();
      this.update();
    });

    this.$('vpChecklist').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-check]');
      if (!cb) return;
      this.plan.checklist[cb.dataset.check] = cb.checked;
      this.renderChecklistScore();
      this.save();
    });

    this.$('vpResetBtn').addEventListener('click', (e) => {
      confirmClick(e.currentTarget, 'Replace this plan?', () => {
        this.plan = defaultVentilationPlan();
        this.syncInputs();
        this.update();
      });
    });
    this.$('vpReportBtn').addEventListener('click', () => this.downloadReport());
    this.$('vpLeakBtn').addEventListener('click', () => {
      const r = this.calc;
      const worst = r.worst;
      window.gasVisionRouter.go('hazard', {
        chemical: worst ? worst.item.id : this.plan.items[0]?.id,
        room: { L: this.plan.L, W: this.plan.W, H: this.plan.H, ach: r.currentAch, rateGs: worst ? worst.item.rateGs : 1 }
      });
    });
  }

  onItemChange(e) {
    const row = e.target.closest('[data-item]');
    if (!row) return;
    const item = this.plan.items[parseInt(row.dataset.item, 10)];
    const field = e.target.dataset.field;
    if (!item || !field) return;
    if (field === 'id') item.id = e.target.value;
    if (field === 'form') {
      item.form = e.target.value;
      item.rateGs = STORAGE_FORMS[item.form].rateGs;
      row.querySelector('[data-field="rateGs"]').value = item.rateGs;
    }
    if (field === 'qty') item.qty = Math.max(0, parseFloat(e.target.value) || 0);
    if (field === 'rateGs') {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) item.rateGs = Math.max(0, v);
    }
    if (field === 'id') this.renderItems();
    this.update();
  }

  syncInputs() {
    const p = this.plan;
    this.$('vpName').value = p.name;
    this.$('vpL').value = p.L;
    this.$('vpW').value = p.W;
    this.$('vpH').value = p.H;
    this.$('vpDoor').value = p.doorWall;
    this.$('vpTemp').value = p.tempC;
    this.$('vpMixing').value = p.mixing;
    this.$('vpExFlow').value = p.existing.exhaustM3h;
    this.$('vpExPos').value = p.existing.exhaustPos;
    this.$('vpSupply').value = p.existing.supply;
    this.$('vpDetection').checked = p.existing.detection;
    this.$('vpInterlock').checked = p.existing.interlock;
    this.$('vpSwitch').checked = p.existing.outsideSwitch;
    this.renderItems();
    this.renderChecklist();
  }

  renderItems() {
    const chemOptions = (sel) => CHEMICALS.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name} (${c.formula})</option>`).join('');
    const formOptions = (sel) => Object.entries(STORAGE_FORMS).map(([k, f]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${f.label}</option>`).join('');
    this.$('vpItems').innerHTML = this.plan.items.length === 0
      ? '<p class="muted">Add the chemicals stored in this room.</p>'
      : this.plan.items.map((it, i) => {
        const chem = CHEMICALS_BY_ID[it.id];
        const dc = densityClass(chem);
        return `
        <div class="vp-item" data-item="${i}">
          <div class="vp-item-top">
            <select data-field="id" aria-label="Chemical">${chemOptions(it.id)}</select>
            <button class="btn btn-secondary btn-xs" data-remove="${i}" aria-label="Remove ${chem.name}">✕</button>
          </div>
          <div class="vp-item-row">
            <select data-field="form" aria-label="Storage form">${formOptions(it.form)}</select>
            <label class="vp-inline">Qty <input type="number" data-field="qty" min="0" step="1" value="${it.qty}"></label>
            <label class="vp-inline">Leak <input type="number" data-field="rateGs" min="0" step="any" value="${it.rateGs}"> g/s</label>
          </div>
          <div class="vp-item-tags">
            <span class="density-tag density-${dc}">${dc === 'heavy' ? '⬇ Heavier than air' : dc === 'light' ? '⬆ Lighter than air' : '↔ Similar to air'} (${chem.vaporDensity}×)</span>
            ${chem.categories.map(c => `<span class="sds-hazard-tag">${c}</span>`).join('')}
          </div>
        </div>`;
      }).join('');
  }

  renderChecklist() {
    let n = 0;
    this.$('vpChecklist').innerHTML = VENT_CHECKLIST.map(g => `
      <div class="vp-check-group">
        <div class="mini-heading">${g.group}</div>
        ${g.items.map(text => {
          const key = `c${n++}`;
          return `<label class="checkbox-row vp-check"><input type="checkbox" data-check="${key}" ${this.plan.checklist[key] ? 'checked' : ''}><span>${text}</span></label>`;
        }).join('')}
      </div>`).join('');
    this.renderChecklistScore();
  }

  renderChecklistScore() {
    const total = VENT_CHECKLIST.reduce((a, g) => a + g.items.length, 0);
    const done = Object.values(this.plan.checklist).filter(Boolean).length;
    const el = this.$('vpChecklistScore');
    el.textContent = `${done}/${total} in place`;
    el.classList.toggle('data-badge-warn', done < total * 0.7);
  }

  update() {
    this.calc = computeVentilation(this.plan);
    this.save();
    const r = this.calc;
    const p = this.plan;

    const verdictText = { adequate: 'ADEQUATE', improve: 'NEEDS IMPROVEMENT', inadequate: 'INADEQUATE' }[r.verdict];
    const verdictCls = { adequate: 'threat-low', improve: 'threat-elevated', inadequate: 'threat-critical' }[r.verdict];
    this.$('vpVerdictCard').className = `card threat-card ${verdictCls}`;
    this.$('vpVerdict').textContent = verdictText;
    this.$('vpRoomSummary').innerHTML = `<strong>${escapeHtml(p.name || 'Storage room')}</strong><div class="muted">${p.L} × ${p.W} × ${p.H} m · ${Math.round(r.area)} m² · ${Math.round(r.volume)} m³</div>`;
    const fails = r.checks.filter(c => c.status === 'fail').length;
    const warns = r.checks.filter(c => c.status === 'warn').length;
    this.$('vpHeadline').textContent = r.verdict === 'adequate'
      ? 'The installed ventilation meets every check below for the chemicals stored.'
      : `${fails ? `${fails} requirement${fails > 1 ? 's' : ''} not met` : ''}${fails && warns ? ' and ' : ''}${warns ? `${warns} improvement${warns > 1 ? 's' : ''} recommended` : ''}. See the layout and checks below.`;

    const tile = (label, value, sub, cls = '') => `<div class="hz-tile ${cls}"><div class="tile-label">${label}</div><div class="hz-tile-value">${value}</div><div class="muted">${sub}</div></div>`;
    this.$('vpTiles').innerHTML = [
      tile('Installed exhaust', `${Math.round(p.existing.exhaustM3h)} m³/h`, `${r.currentAch.toFixed(1)} air changes/h`, p.existing.exhaustM3h < r.continuous ? 'tile-bad' : ''),
      tile('Recommended continuous', `${Math.round(r.continuous)} m³/h`, `${r.continuousAch.toFixed(1)} ACH · ${Math.round(r.continuous / 1.699)} cfm`),
      tile('Emergency purge', `${Math.round(r.emergency)} m³/h`, `${EMERGENCY_ACH} ACH on gas alarm`),
      tile('Exhaust pickup', { low: 'Low level', high: 'High level', both: 'Low + high' }[r.exhaustPos], r.exhaustPos === 'both' ? `${Math.round(r.lowShare * 100)}% low / ${Math.round((1 - r.lowShare) * 100)}% high` : r.exhaustPos === 'low' ? 'within 300 mm of floor' : 'within 300 mm of ceiling')
    ].join('');
    this.$('vpExAch').textContent = `= ${r.currentAch.toFixed(1)} air changes per hour`;
    this.$('vpK').textContent = `${r.mix.K}`;

    this.$('vpPlan').innerHTML = this.planSvg(r);
    this.$('vpSection').innerHTML = this.sectionSvg(r);
    this.renderPlacement(r);
    this.renderAirflow(r);
    this.renderChecks(r);
    this.renderLeak(r);
    if (this.visible) this.drawLeakChart();
  }

  /* ---------------- Drawings ---------------- */

  // Plan geometry in metres: x east, y south (north at top)
  layout(r) {
    const p = this.plan;
    const door = p.doorWall;
    const far = { south: 'north', north: 'south', east: 'west', west: 'east' }[door];
    const horizontalWall = (w) => w === 'north' || w === 'south';
    // Point on a wall at fraction t along it, offset d metres into the room
    const onWall = (wall, t, d = 0) => {
      if (wall === 'north') return { x: t * p.L, y: d };
      if (wall === 'south') return { x: t * p.L, y: p.W - d };
      if (wall === 'west') return { x: d, y: t * p.W };
      return { x: p.L - d, y: t * p.W };
    };
    const farLen = horizontalWall(far) ? p.L : p.W;
    const exhaustCount = farLen > 6 ? 2 : 1;
    const exhaustTs = exhaustCount === 2 ? [0.3, 0.7] : [0.5];
    return { door, far, onWall, horizontalWall, farLen, exhaustTs };
  }

  planSvg(r) {
    const p = this.plan;
    const lay = this.layout(r);
    const W = 560, H = 340, pad = 46;
    const s = Math.min((W - 2 * pad) / p.L, (H - 2 * pad) / p.W);
    const ox = (W - p.L * s) / 2, oy = (H - p.W * s) / 2;
    const P = (pt) => ({ x: ox + pt.x * s, y: oy + pt.y * s });
    const out = [];

    // Storage band along the far wall
    const depth = Math.min(0.9, (lay.horizontalWall(lay.far) ? p.W : p.L) * 0.25);
    const a = P(lay.onWall(lay.far, 0.12, 0));
    const b = P(lay.onWall(lay.far, 0.88, depth));
    const sx = Math.min(a.x, b.x), sy = Math.min(a.y, b.y), sw = Math.abs(b.x - a.x), sh = Math.abs(b.y - a.y);
    out.push(`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="#64748B" fill-opacity="0.25" stroke="#64748B" stroke-dasharray="4 3"/>`);
    const names = r.items.map(i => i.chem.formula).join(' · ');
    const mid = P(lay.onWall(lay.far, 0.5, depth / 2));
    out.push(`<text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" class="svg-label svg-strong">${escapeHtml(names || 'Storage')}</text>`);
    if (r.conflicts.some(c => c.severity === 'fail')) {
      const c1 = P(lay.onWall(lay.far, 0.5, -0.1));
      const c2 = P(lay.onWall(lay.far, 0.5, depth + 0.6));
      out.push(`<line x1="${c1.x}" y1="${c1.y}" x2="${c2.x}" y2="${c2.y}" stroke="#D0342C" stroke-width="3" stroke-dasharray="6 4"/>`);
      const lbl = P(lay.onWall(lay.far, 0.5, depth + 0.9));
      out.push(`<text x="${lbl.x}" y="${lbl.y}" text-anchor="middle" class="svg-label" fill="#D0342C">separate incompatibles (≥ 6 m or fire wall)</text>`);
    }

    // Room outline
    out.push(`<rect x="${ox}" y="${oy}" width="${p.L * s}" height="${p.W * s}" fill="none" stroke="var(--ink)" stroke-width="3"/>`);

    // Door gap + swing
    const doorW = Math.min(1.2, (lay.horizontalWall(lay.door) ? p.L : p.W) * 0.3);
    const doorT = 0.22;
    const dl = lay.horizontalWall(lay.door) ? p.L : p.W;
    const d0 = P(lay.onWall(lay.door, doorT, 0));
    const d1 = P(lay.onWall(lay.door, doorT + doorW / dl, 0));
    out.push(`<line x1="${d0.x}" y1="${d0.y}" x2="${d1.x}" y2="${d1.y}" stroke="var(--panel)" stroke-width="5"/>`);
    const leaf = P(lay.onWall(lay.door, doorT, doorW));
    out.push(`<line x1="${d0.x}" y1="${d0.y}" x2="${leaf.x}" y2="${leaf.y}" stroke="var(--ink)" stroke-width="1.5"/>`);
    out.push(`<path d="M ${leaf.x} ${leaf.y} A ${doorW * s} ${doorW * s} 0 0 ${lay.door === 'south' || lay.door === 'west' ? 1 : 0} ${d1.x} ${d1.y}" fill="none" stroke="var(--muted)" stroke-dasharray="3 3"/>`);
    const dOut = P(lay.onWall(lay.door, doorT + doorW / dl / 2, -0.55));
    out.push(`<text x="${dOut.x}" y="${dOut.y + 4}" text-anchor="middle" class="svg-label">Door</text>`);
    const sw0 = P(lay.onWall(lay.door, Math.max(0.04, doorT - 0.08), -0.35));
    out.push(`<rect x="${sw0.x - 7}" y="${sw0.y - 7}" width="14" height="14" rx="2" fill="#0F766E"/><text x="${sw0.x}" y="${sw0.y + 4}" text-anchor="middle" class="svg-icon">S</text>`);

    // Fresh-air inlet on the door wall, away from the door
    const inlet = P(lay.onWall(lay.door, 0.72, 0));
    const inletIn = P(lay.onWall(lay.door, 0.72, 0.5));
    out.push(`<rect x="${inlet.x - 16}" y="${inlet.y - 6}" width="32" height="12" fill="#2563EB"/>`);
    const inletLbl = P(lay.onWall(lay.door, 0.72, -0.5));
    out.push(`<text x="${inletLbl.x}" y="${inletLbl.y + 4}" text-anchor="middle" class="svg-label" fill="#2563EB">Fresh air in (${r.intakePos})</text>`);

    // Exhaust grilles on the far wall + fan outside
    const posLabel = { low: 'low', high: 'high', both: 'low+high' }[r.exhaustPos];
    for (const t of lay.exhaustTs) {
      const e = P(lay.onWall(lay.far, t, 0));
      out.push(`<rect x="${e.x - 14}" y="${e.y - 7}" width="28" height="14" fill="#D0342C"/>`);
      const lbl = P(lay.onWall(lay.far, t, -0.45));
      out.push(`<text x="${lbl.x}" y="${lbl.y + 4}" text-anchor="middle" class="svg-label" fill="#D0342C">Exhaust (${posLabel})</text>`);
      // Airflow sweep from inlet and door towards the exhaust
      out.push(`<path d="M ${inletIn.x} ${inletIn.y} Q ${(inletIn.x + e.x) / 2 + (t - 0.5) * 40} ${(inletIn.y + e.y) / 2} ${e.x} ${e.y}" fill="none" stroke="#2563EB" stroke-width="2" stroke-opacity="0.7" marker-end="url(#vpArrow)"/>`);
    }
    for (const t of [0.12, 0.5, 0.88]) {
      const from = P(lay.onWall(lay.door, t, 0.9));
      const to = P(lay.onWall(lay.far, t, depth + 0.35));
      out.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#2563EB" stroke-width="1.2" stroke-opacity="0.35" stroke-dasharray="6 5" marker-end="url(#vpArrowLight)"/>`);
    }

    // Detectors near the storage, one per density class
    const classes = [...new Set(r.items.map(i => i.density))];
    classes.forEach((c, i) => {
      const d = P(lay.onWall(lay.far, 0.2 + (0.6 * (i + 0.5)) / classes.length, depth + 0.35));
      const hTxt = c === 'heavy' ? '0.3 m' : c === 'light' ? `${(p.H - 0.3).toFixed(1)} m` : '1.5 m';
      out.push(`<circle cx="${d.x}" cy="${d.y}" r="7" fill="#D48A06"/><text x="${d.x}" y="${d.y + 4}" text-anchor="middle" class="svg-icon">D</text>`);
      out.push(`<text x="${d.x + 11}" y="${d.y + 4}" class="svg-label">@ ${hTxt}</text>`);
    });

    // Dimensions + compass
    out.push(`<text x="${ox + (p.L * s) / 2}" y="${oy + p.W * s + 36}" text-anchor="middle" class="svg-label">${p.L} m</text>`);
    out.push(`<text x="${ox - 30}" y="${oy + (p.W * s) / 2}" text-anchor="middle" class="svg-label" transform="rotate(-90 ${ox - 30} ${oy + (p.W * s) / 2})">${p.W} m</text>`);
    out.push(`<g transform="translate(${W - 20}, 22)"><text text-anchor="middle" class="svg-label" y="-6">N</text><path d="M0,-2 L5,10 L0,7 L-5,10 z" fill="var(--muted)"/></g>`);

    return `
      <svg viewBox="0 0 ${W} ${H}" class="zone-svg" role="img" aria-label="Plan view of the storage room with inlet, exhaust, airflow and detectors">
        <defs>
          <marker id="vpArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#2563EB"/></marker>
          <marker id="vpArrowLight" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#2563EB" fill-opacity="0.5"/></marker>
        </defs>
        ${out.join('')}
      </svg>
      <p class="fine-print" style="margin-top: 4px;">S = ventilation / emergency switch outside the door. Air enters on the door side and sweeps across the floor to the storage wall, so people entering stand in clean air.</p>`;
  }

  sectionSvg(r) {
    const p = this.plan;
    const lay = this.layout(r);
    const depthM = lay.horizontalWall(lay.door) ? p.W : p.L;
    const W = 560, H = 230, pad = 40;
    const s = Math.min((W - 2 * pad - 40) / depthM, (H - 2 * pad) / p.H);
    const ox = (W - depthM * s) / 2, floorY = H - pad;
    const X = (m) => ox + m * s;
    const Y = (m) => floorY - m * s;
    const out = [];

    // Gas accumulation layers
    const heavy = r.items.some(i => i.density === 'heavy');
    const light = r.items.some(i => i.density === 'light');
    out.push(`<defs>
      <linearGradient id="vpHeavy" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#D48A06" stop-opacity="0.45"/><stop offset="1" stop-color="#D48A06" stop-opacity="0"/></linearGradient>
      <linearGradient id="vpLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8B5CF6" stop-opacity="0.4"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></linearGradient>
      <marker id="vpArrowS" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#2563EB"/></marker>
    </defs>`);
    if (heavy) out.push(`<rect x="${X(0)}" y="${Y(0.8)}" width="${depthM * s}" height="${0.8 * s}" fill="url(#vpHeavy)"/><text x="${X(depthM / 2)}" y="${Y(0.15)}" text-anchor="middle" class="svg-label" fill="#B45309">heavy gases pool here</text>`);
    if (light) out.push(`<rect x="${X(0)}" y="${Y(p.H)}" width="${depthM * s}" height="${0.8 * s}" fill="url(#vpLight)"/><text x="${X(depthM / 2)}" y="${Y(p.H - 0.35)}" text-anchor="middle" class="svg-label" fill="#6D28D9">light gases collect here</text>`);

    // Walls
    out.push(`<line x1="${X(0)}" y1="${Y(0)}" x2="${X(depthM)}" y2="${Y(0)}" stroke="var(--ink)" stroke-width="3"/>`);
    out.push(`<line x1="${X(0)}" y1="${Y(p.H)}" x2="${X(depthM)}" y2="${Y(p.H)}" stroke="var(--ink)" stroke-width="3"/>`);
    out.push(`<line x1="${X(0)}" y1="${Y(0)}" x2="${X(0)}" y2="${Y(p.H)}" stroke="var(--ink)" stroke-width="3"/>`);
    out.push(`<line x1="${X(depthM)}" y1="${Y(0)}" x2="${X(depthM)}" y2="${Y(p.H)}" stroke="var(--ink)" stroke-width="3"/>`);
    // Door opening (2.1 m) in the left wall
    out.push(`<line x1="${X(0)}" y1="${Y(0.02)}" x2="${X(0)}" y2="${Y(Math.min(2.1, p.H - 0.4))}" stroke="var(--panel)" stroke-width="5"/>`);
    out.push(`<text x="${X(0) - 8}" y="${Y(1.0)}" text-anchor="end" class="svg-label">Door</text>`);

    // Inlet on door wall
    const inletH = r.intakePos === 'high' ? p.H - 0.4 : r.intakePos === 'low' ? 0.4 : Math.min(1.5, p.H / 2);
    out.push(`<rect x="${X(0) - 5}" y="${Y(inletH) - 10}" width="10" height="20" fill="#2563EB"/>`);
    out.push(`<text x="${X(0) - 8}" y="${Y(inletH) + 4}" text-anchor="end" class="svg-label" fill="#2563EB">Inlet</text>`);

    // Exhaust pickups on far wall
    const pickups = r.exhaustPos === 'both' ? [0.15, p.H - 0.15] : r.exhaustPos === 'high' ? [p.H - 0.15] : [0.15];
    for (const h of pickups) {
      out.push(`<rect x="${X(depthM) - 5}" y="${Y(h) - 8}" width="10" height="16" fill="#D0342C"/>`);
      out.push(`<path d="M ${X(0.3)} ${Y(inletH)} C ${X(depthM * 0.45)} ${Y(inletH)}, ${X(depthM * 0.55)} ${Y(h)}, ${X(depthM) - 8} ${Y(h)}" fill="none" stroke="#2563EB" stroke-width="2" stroke-opacity="0.75" marker-end="url(#vpArrowS)"/>`);
      out.push(`<text x="${X(depthM) + 10}" y="${Y(h) + 4}" class="svg-label" fill="#D0342C">Exhaust ${h < 1 ? '≤ 300 mm above floor' : '≤ 300 mm below ceiling'}</text>`);
    }
    // Duct to roof
    out.push(`<path d="M ${X(depthM) + 5} ${Y(pickups[pickups.length - 1])} H ${X(depthM) + 22} V ${Y(p.H) - 22}" fill="none" stroke="#D0342C" stroke-width="3"/>`);
    out.push(`<path d="M ${X(depthM) + 22} ${Y(p.H) - 22} v -10" stroke="#D0342C" stroke-width="3" marker-end="url(#vpArrowS)"/>`);
    out.push(`<text x="${X(depthM) + 30}" y="${Y(p.H) - 26}" class="svg-label">to outside, vertical discharge</text>`);

    // Storage
    const cylW = 0.3, cylH = Math.min(1.5, p.H * 0.45);
    for (let i = 0; i < 3; i++) {
      const cx = depthM - 0.35 - i * 0.45;
      out.push(`<rect x="${X(cx - cylW / 2)}" y="${Y(cylH)}" width="${cylW * s}" height="${cylH * s}" rx="${cylW * s / 2}" fill="#64748B" fill-opacity="0.55"/>`);
    }

    // Detectors
    const classes = [...new Set(r.items.map(i => i.density))];
    classes.forEach((c, i) => {
      const h = c === 'heavy' ? 0.3 : c === 'light' ? p.H - 0.3 : 1.5;
      const x = depthM - 1.6 - i * 0.5;
      out.push(`<circle cx="${X(x)}" cy="${Y(h)}" r="6" fill="#D48A06"/><text x="${X(x) - 9}" y="${Y(h) + 4}" text-anchor="end" class="svg-label">D ${h.toFixed(1)} m</text>`);
    });

    out.push(`<text x="${X(depthM / 2)}" y="${H - 12}" text-anchor="middle" class="svg-label">Section from door wall to storage wall · ${depthM} m wide · ${p.H} m high</text>`);
    return `<svg viewBox="0 0 ${W} ${H}" class="zone-svg" role="img" aria-label="Section view showing inlet and exhaust heights">${out.join('')}</svg>`;
  }

  /* ---------------- Text & tables ---------------- */

  renderPlacement(r) {
    const p = this.plan;
    const lay = this.layout(r);
    const wallName = (w) => ({ north: 'north', south: 'south', east: 'east', west: 'west' }[w]);
    const heavy = r.items.filter(i => i.density === 'heavy').map(i => i.chem.name);
    const light = r.items.filter(i => i.density === 'light').map(i => i.chem.name);
    const neutral = r.items.filter(i => i.density === 'neutral').map(i => i.chem.name);
    const list = [];

    list.push(`<strong>Storage:</strong> along the ${wallName(lay.far)} wall, opposite the door, so the exhaust pulls any leak away from people entering. Keep 0.5 m clear in front of grilles and detectors.`);
    const exParts = [];
    if (heavy.length) exParts.push(`low-level pickups within 300 mm of the floor for ${heavy.join(', ')} (heavier than air)`);
    if (light.length) exParts.push(`high-level pickups within 300 mm of the ceiling for ${light.join(', ')} (lighter than air)`);
    if (neutral.length) exParts.push(`pickups at both levels for ${neutral.join(', ')} (similar density to air, mixes through the room)`);
    list.push(`<strong>Exhaust:</strong> ${lay.exhaustTs.length} grille${lay.exhaustTs.length > 1 ? 's' : ''} on the ${wallName(lay.far)} wall behind the storage, with ${exParts.join('; ')}.${r.exhaustPos === 'both' ? ` Split the airflow roughly 50/50 between low and high pickups with balancing dampers, then adjust using detector readings.` : ''}`);
    list.push(`<strong>Fresh air:</strong> louvred inlet on the ${wallName(lay.door)} wall beside the door, ${r.intakePos === 'high' ? 'high up' : r.intakePos === 'low' ? 'near the floor' : 'at mid-height (about 1.5 m)'}, sized for ~90% of the exhaust flow so the room stays slightly negative. Air then crosses the whole room before leaving.`);
    const det = [];
    if (heavy.length) det.push(`300 mm above the floor for ${heavy.join(', ')}`);
    if (light.length) det.push(`300 mm below the ceiling for ${light.join(', ')}`);
    if (neutral.length) det.push(`breathing height (1.5 m) for ${neutral.join(', ')}`);
    list.push(`<strong>Gas detectors:</strong> between the storage and the exhaust, ${det.join('; ')}, plus a reading display outside the door. Low alarm → high-speed exhaust; high alarm → ${Math.round(r.emergency)} m³/h emergency purge, alarm and automatic shut-off valves${r.hasAmmonia ? ' (IIAR 2 starts emergency ventilation at 150 ppm ammonia)' : ''}.`);

    const fan = [];
    if (r.flammable) fan.push('spark-resistant (AMCA Type A/B) fan with the motor outside the airstream or rated for the hazardous area; bond and earth all ductwork');
    const corr = r.corrosive.map(i => i.chem);
    if (corr.some(c => c.id === 'ammonia')) fan.push('no copper, brass or zinc in contact with ammonia (use steel or stainless)');
    if (corr.some(c => ['chlorine', 'so2', 'no2'].includes(c.id))) fan.push('corrosion-resistant ducts and fan (FRP, PVC-coated or suitable stainless) for acid-forming gases');
    if (fan.length) list.push(`<strong>Fan & ducts:</strong> ${fan.join('; ')}.`);
    list.push(`<strong>Discharge:</strong> vertically upward above the roof line, at least ${r.hasAmmonia ? '6 m (20 ft, IIAR 2)' : '3 m (10 ft)'} from doors, windows, air intakes and property lines. Never recirculate. No rain caps that deflect exhaust downward.`);
    list.push('<strong>Controls:</strong> manual ventilation and emergency switches outside the room next to the door; airflow switch with fan-failure alarm; exhaust and detection on backup power.');
    if (r.conflicts.length) list.push(`<strong class="bad">Segregation:</strong> ${r.conflicts.map(c => `${c.pair.join(' + ')} — ${c.text}`).join(' ')}`);
    const enclose = r.items.filter(i => !i.practical);
    if (enclose.length) list.push(`<strong class="bad">Enclose, don't dilute:</strong> ${enclose.map(i => i.chem.name).join(', ')} would need more than ${PRACTICAL_CONTINUOUS_ACH} air changes/h to dilute the design leak. Keep ${enclose.length > 1 ? 'these cylinders' : 'this cylinder'} in an exhausted gas cabinet (face velocity ≥ 1 m/s / 200 fpm) with an automatic shut-off valve.`);

    this.$('vpPlacement').innerHTML = `<ol class="action-list">${list.map(t => `<li>${t}</li>`).join('')}</ol>`;
  }

  renderAirflow(r) {
    const rows = [];
    rows.push(`<tr><td class="table-font-sans"><strong>Code minimum</strong><div class="muted">IFC §5004.3.1 / NFPA 30: 1 cfm/ft² of floor, ≥ 150 cfm</div></td><td>${Math.round(r.codeMin)}</td><td>${(r.codeMin / r.volume).toFixed(1)}</td><td>—</td></tr>`);
    for (const it of r.items) {
      if (!it.dilution) continue;
      rows.push(`<tr class="${it.practical ? '' : 'row-warn'}">
        <td class="table-font-sans"><strong>${it.chem.name}</strong> dilution<div class="muted">${it.rateGs} g/s leak; ${it.dilution.basis}</div></td>
        <td>${Math.round(it.dilution.q).toLocaleString()}</td>
        <td>${(it.dilution.q / r.volume).toFixed(1)}</td>
        <td>${it.practical ? '<span class="badge badge-safe">Dilution OK</span>' : '<span class="badge badge-leak">Enclose</span>'}</td>
      </tr>`);
    }
    rows.push(`<tr class="row-strong"><td class="table-font-sans"><strong>Recommended continuous</strong><div class="muted">largest of the above, capped at ${PRACTICAL_CONTINUOUS_ACH} ACH</div></td><td>${Math.round(r.continuous).toLocaleString()}</td><td>${r.continuousAch.toFixed(1)}</td><td>—</td></tr>`);
    rows.push(`<tr class="row-strong"><td class="table-font-sans"><strong>Emergency purge</strong><div class="muted">${EMERGENCY_ACH} air changes/h on high gas alarm (IIAR 2 practice)</div></td><td>${Math.round(r.emergency).toLocaleString()}</td><td>${r.emergencyAch.toFixed(0)}</td><td>—</td></tr>`);
    this.$('vpAirflow').innerHTML = `<table><thead><tr><th>Requirement</th><th>m³/h</th><th>ACH</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  renderChecks(r) {
    const icon = { pass: '✔', warn: '!', fail: '✖' };
    this.$('vpChecks').innerHTML = r.checks.map(c => `
      <li class="check-${c.status}">
        <span class="check-icon">${icon[c.status]}</span>
        <div><strong>${escapeHtml(c.title)}</strong><div class="muted">${escapeHtml(c.detail)}</div></div>
      </li>`).join('');
  }

  renderLeak(r) {
    const w = r.worst;
    if (!w) {
      this.$('vpLeakSub').textContent = '';
      this.$('vpLeakTable').innerHTML = '<p class="muted">Add a chemical to simulate a leak.</p>';
      return;
    }
    this.$('vpLeakSub').textContent = `${w.item.chem.name} · ${w.item.rateGs} g/s for ${r.simDuration} min`;
    const t = (sec) => sec === null ? '<span class="good">never</span>' : `<span class="${sec < 600 ? 'bad' : ''}">${formatDuration(sec)}</span>`;
    this.$('vpLeakTable').innerHTML = `
      <table>
        <thead><tr><th></th><th>Airflow</th><th>After ${r.simDuration} min</th><th>Reaches ${w.target ? formatPpm(w.target) : 'target'}</th><th>Reaches ${w.danger ? w.danger.label : 'danger'}</th></tr></thead>
        <tbody>
          <tr><td class="table-font-sans">Installed</td><td>${r.currentAch.toFixed(1)} ACH</td><td>${formatPpm(w.current.endPpm)}</td><td>${t(w.current.toTarget)}</td><td>${t(w.current.toDanger)}</td></tr>
          <tr><td class="table-font-sans">Recommended</td><td>${r.continuousAch.toFixed(1)} ACH</td><td>${formatPpm(w.recommended.endPpm)}</td><td>${t(w.recommended.toTarget)}</td><td>${t(w.recommended.toDanger)}</td></tr>
        </tbody>
      </table>
      <p class="fine-print">Well-mixed room with mixing factor ${r.mix.m}. Concentrations right beside the leak are higher; that is why detectors go between the storage and the exhaust.</p>`;
  }

  drawLeakChart() {
    const r = this.calc;
    const w = r && r.worst;
    const canvas = this.$('vpLeakChart');
    if (!w) {
      prepareCanvas(canvas);
      return;
    }
    const chem = w.item.chem;
    const tEnd = r.simDuration * 60;
    const pts = (scn) => {
      const out = [];
      for (let i = 0; i <= 90; i++) {
        const tt = (tEnd * i) / 90;
        out.push([tt / 60, roomPpm(chem, scn, tt)]);
      }
      return out;
    };
    const cur = pts(w.current.scenario);
    const rec = pts(w.recommended.scenario);
    const peak = Math.max(...cur.map(p => p[1]), ...rec.map(p => p[1]), 1e-3);
    const refs = [w.target, w.danger ? w.danger.ppm : null].filter(Boolean);
    const yMin = Math.max(1e-3, Math.pow(10, Math.floor(Math.log10(Math.min(...refs, peak) / 20))));
    const yMax = Math.pow(10, Math.ceil(Math.log10(Math.max(peak, ...refs) * 1.5)));
    drawLineChart(canvas, {
      x: { min: 0, max: r.simDuration, format: v => `${Math.round(v)} min` },
      y: { min: yMin, max: yMax, log: true, format: shortNumber, label: 'ppm in room' },
      thresholds: [
        w.target ? { y: w.target, label: `Design target ${formatPpm(w.target)}`, color: cssVar('--warning') } : null,
        w.danger ? { y: w.danger.ppm, label: w.danger.label, color: cssVar('--leak') } : null
      ].filter(Boolean),
      series: [
        { points: cur.map(p => [p[0], Math.max(p[1], yMin)]), color: cssVar('--leak'), width: 2.5 },
        { points: rec.map(p => [p[0], Math.max(p[1], yMin)]), color: cssVar('--safe'), width: 2.5, dash: [6, 4] }
      ]
    });
  }

  downloadReport() {
    const r = this.calc;
    const p = this.plan;
    const verdictText = { adequate: 'ADEQUATE', improve: 'NEEDS IMPROVEMENT', inadequate: 'INADEQUATE' }[r.verdict];
    const color = { adequate: '#1E8E5A', improve: '#D48A06', inadequate: '#D0342C' }[r.verdict];
    let n = 0;
    const checklist = VENT_CHECKLIST.map(g => `<h3>${g.group}</h3><ul>${g.items.map(t => `<li>${p.checklist[`c${n++}`] ? '☑' : '☐'} ${t}</li>`).join('')}</ul>`).join('');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Ventilation plan – ${escapeHtml(p.name)}</title>
<style>
:root{--ink:#0E2A47;--muted:#5B6B7C;--border:#D6DEE7;--bg:#EEF2F6;--panel:#fff}
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0E2A47;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.5;font-size:14px}
h1{font-size:22px;margin:0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #D6DEE7;padding-bottom:4px;margin-top:28px}h3{font-size:13px;margin:12px 0 4px}
.banner{border-left:6px solid ${color};background:#F6F8FB;padding:12px 16px;border-radius:6px;margin:16px 0}.level{font-size:24px;font-weight:800;color:${color}}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #D6DEE7;padding:6px;text-align:left;vertical-align:top}
.muted,.fine-print{color:#5B6B7C;font-size:12px}.svg-label{font-size:11px;fill:#5B6B7C}.svg-strong{font-weight:700;fill:#0E2A47}.svg-icon{font-size:9px;font-weight:700;fill:#fff}
.check-pass .check-icon{color:#1E8E5A}.check-warn .check-icon{color:#D48A06}.check-fail .check-icon{color:#D0342C}.check-list{list-style:none;padding:0}.check-list li{display:flex;gap:8px;padding:6px 0;border-bottom:1px dashed #D6DEE7}
.check-icon{font-weight:800;width:16px}.bad{color:#D0342C}.badge{font-size:11px;font-weight:700}ul{padding-left:18px}svg{max-width:100%}</style></head><body>
<h1>Storage room ventilation plan</h1>
<div class="muted">GasVision AI · ${new Date().toLocaleString()} · planning aid; have the design verified by a qualified ventilation engineer and the authority having jurisdiction</div>
<div class="banner"><div class="level">${verdictText}</div><strong>${escapeHtml(p.name)}</strong> — ${p.L} × ${p.W} × ${p.H} m (${Math.round(r.area)} m², ${Math.round(r.volume)} m³)<br>
Stored: ${r.items.map(i => `${i.qty} × ${i.chem.name} (${STORAGE_FORMS[i.form].label.toLowerCase()}, design leak ${i.rateGs} g/s)`).join('; ')}<br>
Installed exhaust ${Math.round(p.existing.exhaustM3h)} m³/h (${r.currentAch.toFixed(1)} ACH) · Recommended continuous ${Math.round(r.continuous)} m³/h (${r.continuousAch.toFixed(1)} ACH) · Emergency ${Math.round(r.emergency)} m³/h</div>
<h2>Layout</h2>${this.$('vpPlan').innerHTML}${this.$('vpSection').innerHTML}
<h2>Where everything goes</h2>${this.$('vpPlacement').innerHTML}
<h2>Required airflow</h2>${this.$('vpAirflow').innerHTML}
<h2>Installed ventilation check</h2><ul class="check-list">${this.$('vpChecks').innerHTML}</ul>
<h2>Design-basis leak</h2>${this.$('vpLeakTable').innerHTML}
<h2>Good-practice checklist</h2>${checklist}
</body></html>`;
    const safeName = (p.name || 'storage-room').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadText(`ventilation_plan_${safeName}.html`, html, 'text/html');
  }
}

if (typeof module !== 'undefined') {
  module.exports = { computeVentilation, defaultVentilationPlan, densityClass, MIXING_OPTIONS, STORAGE_FORMS };
}
