'use strict';

/* =====================================================================
   CAMERA DETECTION BENCHMARK
   Scripted, seeded scenes replayed frame by frame (15 fps simulated time)
   through processSourceFrame → Detector → DecisionManager with the gas
   sensor OFF, so the scores measure the camera pipeline alone.
   ===================================================================== */

const BENCH_FPS = 15;
const BENCH_FRAME_MS = 1000 / BENCH_FPS;
const BENCH_ONSET_GRACE_S = 3;    // time allowed to confirm a new leak before misses count
const BENCH_CLEAR_GRACE_S = 12;   // plume lingers after the source stops; alarms here are not false
const BENCH_MAX_LATENCY_S = 5;
const BENCH_MAX_CLEAR_S = 20;

/*
  events: [{ at: seconds, action: 'leakOn' | 'leakOff' | 'walker' | 'light' }]
  leakAtStart: leak already running before monitoring starts (during calibration)
  expectDetect: false for gases a camera physically cannot see (scored on false alarms only)
*/
const BENCHMARK_SCENARIOS = [
  { id: 'rgb-idle', kind: 'rgb', name: 'Empty scene', seconds: 30, chemical: 'ammonia', events: [] },
  { id: 'rgb-walkers', kind: 'rgb', name: 'People walking past (×3)', seconds: 30, chemical: 'ammonia',
    events: [{ at: 5, action: 'walker' }, { at: 13, action: 'walker' }, { at: 21, action: 'walker' }] },
  { id: 'rgb-light', kind: 'rgb', name: 'Lights dimmed, then restored', seconds: 30, chemical: 'ammonia',
    events: [{ at: 8, action: 'light' }, { at: 20, action: 'light' }] },
  { id: 'rgb-leak', kind: 'rgb', name: 'Ammonia leak, 40 s (white cloud)', seconds: 67, chemical: 'ammonia', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 45, action: 'leakOff' }] },
  { id: 'rgb-small', kind: 'rgb', name: 'Small ammonia leak, 30 s', seconds: 57, chemical: 'ammonia', leakRate: 0.35,
    events: [{ at: 5, action: 'leakOn' }, { at: 35, action: 'leakOff' }] },
  { id: 'rgb-leak-walker', kind: 'rgb', name: 'Leak with a person walking through', seconds: 44, chemical: 'ammonia', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 10, action: 'walker' }, { at: 15, action: 'walker' }, { at: 22, action: 'leakOff' }] },
  { id: 'rgb-chlorine', kind: 'rgb', name: 'Chlorine leak (yellow-green)', seconds: 42, chemical: 'chlorine', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 20, action: 'leakOff' }] },
  { id: 'rgb-no2', kind: 'rgb', name: 'NO₂ leak (brown, low contrast on brick)', seconds: 42, chemical: 'no2', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 20, action: 'leakOff' }] },
  { id: 'rgb-startup', kind: 'rgb', name: 'Leak already present at start-up', seconds: 25, chemical: 'ammonia', leakRate: 1,
    leakAtStart: true, events: [] },
  { id: 'rgb-methane', kind: 'rgb', name: 'Methane leak (invisible to RGB)', seconds: 25, chemical: 'methane', leakRate: 1,
    expectDetect: false, events: [{ at: 5, action: 'leakOn' }, { at: 18, action: 'leakOff' }] },

  { id: 'th-idle', kind: 'thermal', name: 'Thermal: empty scene', seconds: 30, chemical: 'propane', events: [] },
  { id: 'th-walkers', kind: 'thermal', name: 'Thermal: people walking past (×3)', seconds: 30, chemical: 'propane',
    events: [{ at: 5, action: 'walker' }, { at: 13, action: 'walker' }, { at: 21, action: 'walker' }] },
  { id: 'th-hvac', kind: 'thermal', name: 'Thermal: HVAC cools room 2 °C', seconds: 30, chemical: 'propane',
    events: [{ at: 8, action: 'light' }, { at: 20, action: 'light' }] },
  { id: 'th-leak', kind: 'thermal', name: 'Thermal: propane leak (cold plume)', seconds: 42, chemical: 'propane', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 20, action: 'leakOff' }] },
  { id: 'th-small', kind: 'thermal', name: 'Thermal: small propane leak', seconds: 42, chemical: 'propane', leakRate: 0.35,
    events: [{ at: 5, action: 'leakOn' }, { at: 20, action: 'leakOff' }] },
  { id: 'th-methane', kind: 'thermal', name: 'Thermal: methane leak', seconds: 42, chemical: 'methane', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 20, action: 'leakOff' }] },
  { id: 'th-h2s', kind: 'thermal', name: 'Thermal: H₂S leak (weak cooling)', seconds: 42, chemical: 'h2s', leakRate: 1,
    events: [{ at: 5, action: 'leakOn' }, { at: 20, action: 'leakOff' }] },
  { id: 'th-startup', kind: 'thermal', name: 'Thermal: leak present at start-up', seconds: 25, chemical: 'propane', leakRate: 1,
    leakAtStart: true, events: [] }
];

// Deterministic PRNG so every run of the self-test sees identical scenes
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
  Runs one scenario as a generator that yields progress (0–1) every second of
  simulated video, so the UI can stay responsive. The seeded PRNG replaces
  Math.random only while frames are being processed. `settings` copies the
  live detector settings so the self-test scores what the operator configured.
*/
function* benchmarkScenarioSteps(scn, settings, seed = 1) {
  const originalRandom = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    const source = scn.kind === 'thermal' ? new SimulatedThermalSource() : new SimulatedSceneSource();
    source.chemical = scn.chemical;
    source.leakRate = scn.leakRate ?? 1;
    source.leakActive = !!scn.leakAtStart;

    const detector = new Detector();
    Object.assign(detector, settings);
    const decision = new DecisionManager();
    decision.sensorMode = 'off';
    decision.audioEnabled = false;

    const off = document.createElement('canvas');
    off.width = 160;
    off.height = 120;
    const offCtx = off.getContext('2d', { willReadFrequently: true });

    // Ground-truth intervals (seconds) during which a leak is being released
    const intervals = [];
    let openAt = scn.leakAtStart ? 0 : null;
    for (const e of scn.events) {
      if (e.action === 'leakOn') openAt = e.at;
      if (e.action === 'leakOff' && openAt !== null) { intervals.push([openAt, e.at]); openAt = null; }
    }
    if (openAt !== null) intervals.push([openAt, scn.seconds]);

    const expectDetect = scn.expectDetect !== false;
    const totalFrames = Math.round(scn.seconds * BENCH_FPS);
    const pending = [...scn.events].sort((a, b) => a.at - b.at);
    let tp = 0, fp = 0, tn = 0, fn = 0;
    let falseAlarms = 0, prevState = 'SAFE';
    const latencies = [], clears = [];
    let calibratedAtS = null;

    for (let f = 0; f < totalFrames; f++) {
      if (f > 0 && f % BENCH_FPS === 0) {
        Math.random = originalRandom;
        yield f / totalFrames;
        Math.random = rng;
      }
      const tS = f / BENCH_FPS;
      const tMs = f * BENCH_FRAME_MS;
      while (pending.length && pending[0].at <= tS) {
        const e = pending.shift();
        if (e.action === 'leakOn') source.leakActive = true;
        if (e.action === 'leakOff') source.leakActive = false;
        if (e.action === 'walker') source.triggerWalker();
        if (e.action === 'light') source.toggleLighting();
      }

      source.step();
      const det = processSourceFrame(detector, source, offCtx, [], tMs);
      if (det.calibrating) { prevState = 'SAFE'; continue; }
      if (calibratedAtS === null) calibratedAtS = tS;

      const state = decision.evaluate(det.confidence, tMs).state;
      const predLeak = state === 'LEAK';

      // Where are we relative to the ground truth?
      const inLeak = intervals.find(([a, b]) => tS >= a && tS < b);
      const inOnsetGrace = intervals.some(([a]) => tS >= Math.max(a, calibratedAtS) && tS < Math.max(a, calibratedAtS) + BENCH_ONSET_GRACE_S);
      const inClearGrace = intervals.some(([, b]) => tS >= b && tS < b + BENCH_CLEAR_GRACE_S);

      if (inLeak && expectDetect) {
        if (!inOnsetGrace) { if (predLeak) tp++; else fn++; }
      } else if (!inClearGrace || !expectDetect) {
        if (predLeak) fp++; else tn++;
        if (predLeak && prevState !== 'LEAK') falseAlarms++;
      }

      // Latency from (leak start or end of calibration) to first LEAK
      for (const [a, b] of intervals) {
        const armed = Math.max(a, calibratedAtS);
        const key = `${a}`;
        if (expectDetect && tS >= armed && tS < b && predLeak && !latencies.some(l => l.key === key)) {
          latencies.push({ key, s: tS - armed });
        }
        if (tS >= b && state === 'SAFE' && !clears.some(c => c.key === key)) {
          clears.push({ key, s: tS - b });
        }
      }
      prevState = state;
    }

    const latency = intervals.length && expectDetect
      ? (latencies.length === intervals.length ? Math.max(...latencies.map(l => l.s)) : null)
      : undefined;
    const endedIntervals = intervals.filter(([, b]) => b < scn.seconds);
    const clear = endedIntervals.length
      ? (clears.length >= endedIntervals.length ? Math.max(...clears.map(c => c.s)) : null)
      : undefined;

    const missed = latency === null;
    const pass = falseAlarms === 0 &&
      (latency === undefined || (latency !== null && latency <= BENCH_MAX_LATENCY_S)) &&
      (clear === undefined || (clear !== null && clear <= BENCH_MAX_CLEAR_S));

    return { scn, tp, fp, tn, fn, falseAlarms, latency, clear, missed, pass, expectDetect };
  } finally {
    Math.random = originalRandom;
  }
}

// Synchronous convenience wrapper (console / tests)
function runBenchmarkScenario(scn, settings, seed = 1) {
  const steps = benchmarkScenarioSteps(scn, settings, seed);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

function summarizeBenchmark(results) {
  const sum = (k) => results.reduce((a, r) => a + r[k], 0);
  const tp = sum('tp'), fp = sum('fp'), tn = sum('tn'), fn = sum('fn');
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null;
  const accuracy = tp + fp + tn + fn ? (tp + tn) / (tp + fp + tn + fn) : null;
  const latencies = results.map(r => r.latency).filter(v => typeof v === 'number');
  return {
    tp, fp, tn, fn, precision, recall, f1, accuracy,
    falseAlarms: sum('falseAlarms'),
    passed: results.filter(r => r.pass).length,
    total: results.length,
    meanLatency: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null
  };
}

/* ---------------------------------------------------------------------
   UI panel inside the Live Monitor accuracy card
   --------------------------------------------------------------------- */
class BenchmarkPanel {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.elBtn = document.getElementById('runBenchmarkBtn');
    this.elProgress = document.getElementById('benchmarkProgress');
    this.elFill = document.getElementById('benchmarkProgressFill');
    this.elSummary = document.getElementById('benchmarkSummary');
    this.elResults = document.getElementById('benchmarkResults');
    this.elBtn.addEventListener('click', () => this.run());
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.elBtn.disabled = true;
    this.elBtn.textContent = 'Running…';
    this.elProgress.hidden = false;
    this.elSummary.hidden = true;
    this.elResults.hidden = true;

    const d = this.app.detector;
    const settings = { sensitivity: d.sensitivity, persistSeconds: d.persistSeconds, coldThreshold: d.coldThreshold };
    const results = [];
    const totalSeconds = BENCHMARK_SCENARIOS.reduce((a, s) => a + s.seconds, 0);
    let doneSeconds = 0;
    for (let i = 0; i < BENCHMARK_SCENARIOS.length; i++) {
      const scn = BENCHMARK_SCENARIOS[i];
      const steps = benchmarkScenarioSteps(scn, settings, 1000 + i);
      let step = steps.next();
      while (!step.done) {
        this.elFill.style.width = `${((doneSeconds + step.value * scn.seconds) / totalSeconds) * 100}%`;
        this.elBtn.textContent = `Running ${i + 1}/${BENCHMARK_SCENARIOS.length}…`;
        await new Promise(r => setTimeout(r, 0)); // yield to the page between chunks
        step = steps.next();
      }
      results.push(step.value);
      doneSeconds += scn.seconds;
    }
    this.elFill.style.width = '100%';
    this.render(results);
    this.lastResults = results;

    this.running = false;
    this.elBtn.disabled = false;
    this.elBtn.textContent = 'Run again';
    setTimeout(() => { this.elProgress.hidden = true; }, 400);
    return results;
  }

  render(results) {
    const s = summarizeBenchmark(results);
    const pct = (v) => v === null ? '–' : `${Math.round(v * 100)}%`;
    const secs = (v) => v === undefined ? '<span class="muted">n/a</span>' : v === null ? '<span class="bad">missed</span>' : `${v.toFixed(1)} s`;

    this.elSummary.innerHTML = `
      <div class="accuracy-stats-grid" style="margin-bottom: 8px;">
        <div class="stat-box"><div class="stat-label">Scenes passed</div><div class="stat-val">${s.passed}/${s.total}</div></div>
        <div class="stat-box"><div class="stat-label">Precision</div><div class="stat-val">${pct(s.precision)}</div></div>
        <div class="stat-box"><div class="stat-label">Recall</div><div class="stat-val">${pct(s.recall)}</div></div>
        <div class="stat-box"><div class="stat-label">False alarms</div><div class="stat-val">${s.falseAlarms}</div></div>
      </div>
      <div class="matrix-summary">
        <span>F1: <strong>${pct(s.f1)}</strong></span>
        <span>Accuracy: <strong>${pct(s.accuracy)}</strong></span>
        <span>Mean time to detect: <strong>${s.meanLatency === null ? '–' : `${s.meanLatency.toFixed(1)} s`}</strong></span>
      </div>`;

    this.elResults.innerHTML = `
      <table class="benchmark-table">
        <thead><tr><th>Scene</th><th>Result</th><th>Detect</th><th>Clear</th><th>False alarms</th></tr></thead>
        <tbody>
          ${results.map(r => `
            <tr>
              <td>${r.scn.name}${r.expectDetect ? '' : ' <span class="muted">(not visible: false-alarm check only)</span>'}</td>
              <td><span class="status-badge ${r.pass ? 'badge-working' : 'badge-fail'}">${r.pass ? 'Pass' : 'Fail'}</span></td>
              <td>${secs(r.latency)}</td>
              <td>${secs(r.clear)}</td>
              <td>${r.falseAlarms}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="fine-print">Pass = no false alarms, detected within ${BENCH_MAX_LATENCY_S} s, cleared within ${BENCH_MAX_CLEAR_S} s of the source stopping. Scores count seconds after a ${BENCH_ONSET_GRACE_S} s confirmation window and ignore the ${BENCH_CLEAR_GRACE_S} s while a stopped plume drifts away.</p>`;
    this.elSummary.hidden = false;
    this.elResults.hidden = false;
  }
}
