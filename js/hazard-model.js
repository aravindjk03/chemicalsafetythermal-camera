'use strict';

/* =====================================================================
   HAZARD MODEL
   Screening-level consequence estimates for a gas release.

   Outdoor: steady-state Gaussian plume, ground-level point source with
            ground reflection, Briggs (1973) open-country dispersion
            coefficients for Pasquill–Gifford stability classes A–F.
   Indoor:  well-mixed room (single-zone mass balance) with ventilation
            and an incomplete-mixing factor.

   These are the same first-order models used for training and pre-plan
   screening. They do NOT model dense-gas slumping, terrain, buildings,
   two-phase jets or fires — use ALOHA / PHAST for real emergency planning.
   ===================================================================== */

const STABILITY_CLASSES = {
  A: { label: 'A – Very unstable', hint: 'Strong sun, light wind (< 2 m/s)' },
  B: { label: 'B – Unstable', hint: 'Sunny, 2–3 m/s wind' },
  C: { label: 'C – Slightly unstable', hint: 'Daytime, moderate sun, 3–5 m/s' },
  D: { label: 'D – Neutral', hint: 'Overcast or windy (> 6 m/s), day or night' },
  E: { label: 'E – Slightly stable', hint: 'Night, some cloud, 2–3 m/s' },
  F: { label: 'F – Stable', hint: 'Clear night, light wind — worst case' }
};

// Briggs open-country sigma formulas (x in metres)
function briggsSigmas(stability, x) {
  const s = 1 / Math.sqrt(1 + 0.0001 * x);
  switch (stability) {
    case 'A': return { sy: 0.22 * x * s, sz: 0.20 * x };
    case 'B': return { sy: 0.16 * x * s, sz: 0.12 * x };
    case 'C': return { sy: 0.11 * x * s, sz: 0.08 * x / Math.sqrt(1 + 0.0002 * x) };
    case 'D': return { sy: 0.08 * x * s, sz: 0.06 * x / Math.sqrt(1 + 0.0015 * x) };
    case 'E': return { sy: 0.06 * x * s, sz: 0.03 * x / (1 + 0.0003 * x) };
    case 'F':
    default:  return { sy: 0.04 * x * s, sz: 0.016 * x / (1 + 0.0003 * x) };
  }
}

// Molar volume of an ideal gas at 1 atm (L/mol)
function molarVolumeL(tempC) {
  return 22.414 * (tempC + 273.15) / 273.15;
}

function mgm3ToPpm(mgm3, mw, tempC) {
  return mgm3 * molarVolumeL(tempC) / mw;
}

function ppmToMgm3(ppm, mw, tempC) {
  return ppm * mw / molarVolumeL(tempC);
}

/* ---------------------------------------------------------------------
   Outdoor Gaussian plume
   --------------------------------------------------------------------- */

// Ground-level concentration (ppm) at downwind x (m), crosswind y (m)
function plumePpm(chem, s, x, y = 0) {
  if (x <= 0) return 0;
  const { sy, sz } = briggsSigmas(s.stability, x);
  const u = Math.max(0.5, s.windSpeed);
  // Ground-level source with full ground reflection: C = Q / (π u σy σz) · exp(−y² / 2σy²)
  const gm3 = (s.releaseRateGs / (Math.PI * u * sy * sz)) * Math.exp(-(y * y) / (2 * sy * sy));
  const ppm = mgm3ToPpm(gm3 * 1000, chem.mw, s.tempC);
  return Math.min(ppm, chem.maxPpm);
}

// Furthest downwind distance (m) at which the centreline still reaches thresholdPpm
function distanceToPpm(chem, s, thresholdPpm, maxDistance = 20000) {
  if (!thresholdPpm || thresholdPpm <= 0) return null;
  const minX = 1;
  if (plumePpm(chem, s, minX) < thresholdPpm) return 0;
  if (plumePpm(chem, s, maxDistance) >= thresholdPpm) return maxDistance;
  let lo = minX, hi = maxDistance;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi); // geometric bisection: distances span decades
    if (plumePpm(chem, s, mid) >= thresholdPpm) lo = mid; else hi = mid;
  }
  return lo;
}

// Crosswind half-width (m) of the zone above thresholdPpm at downwind distance x
function halfWidthAt(chem, s, x, thresholdPpm) {
  const c0 = plumePpm(chem, s, x);
  if (c0 <= thresholdPpm) return 0;
  const { sy } = briggsSigmas(s.stability, x);
  return sy * Math.sqrt(2 * Math.log(c0 / thresholdPpm));
}

/* ---------------------------------------------------------------------
   Indoor well-mixed room
   --------------------------------------------------------------------- */

// Concentration (ppm) at time tSec after the release starts
function roomPpm(chem, s, tSec) {
  const V = Math.max(1, s.roomVolume);
  const G = s.releaseRateGs * 1000;                // mg/s
  const lambda = (s.ach * s.mixing) / 3600;        // effective air changes per second
  const tRel = s.durationMin * 60;
  let mgm3;
  if (lambda <= 0) {
    mgm3 = G * Math.min(tSec, tRel) / V;
  } else if (tSec <= tRel) {
    mgm3 = (G / (lambda * V)) * (1 - Math.exp(-lambda * tSec));
  } else {
    const atStop = (G / (lambda * V)) * (1 - Math.exp(-lambda * tRel));
    mgm3 = atStop * Math.exp(-lambda * (tSec - tRel));
  }
  return Math.min(mgm3ToPpm(mgm3, chem.mw, s.tempC), chem.maxPpm);
}

// Seconds until the room first reaches thresholdPpm (null = never during the release)
function roomTimeToPpm(chem, s, thresholdPpm) {
  if (!thresholdPpm) return null;
  const tRel = s.durationMin * 60;
  if (roomPpm(chem, s, tRel) < thresholdPpm) return null;
  let lo = 0, hi = tRel;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (roomPpm(chem, s, mid) >= thresholdPpm) hi = mid; else lo = mid;
  }
  return hi;
}

/* ---------------------------------------------------------------------
   Thresholds & threat assessment
   --------------------------------------------------------------------- */

// Toxic and flammable levels of concern for an exposure duration
function levelsOfConcern(chem, exposureMin) {
  const i = aeglIndexForMinutes(exposureMin);
  const aegl = chem.aegl || {};
  const levels = [];

  const t3 = aegl[3] ? aegl[3][i] : chem.idlhPpm;
  const t2 = aegl[2] ? aegl[2][i] : null;
  const t1 = aegl[1] ? aegl[1][i] : chem.oelPpm;

  if (t3) levels.push({ key: 'tox3', tier: 3, ppm: t3, label: aegl[3] ? `AEGL-3 (${AEGL_DURATIONS_MIN[i]} min)` : 'IDLH', meaning: 'Life-threatening' });
  if (t2) levels.push({ key: 'tox2', tier: 2, ppm: t2, label: `AEGL-2 (${AEGL_DURATIONS_MIN[i]} min)`, meaning: 'Serious or irreversible harm; may be unable to escape' });
  if (t1) levels.push({ key: 'tox1', tier: 1, ppm: t1, label: aegl[1] ? `AEGL-1 (${AEGL_DURATIONS_MIN[i]} min)` : 'Occupational limit', meaning: 'Irritation / discomfort, reversible' });

  if (chem.lelPct) {
    const lel = chem.lelPct * 10000;
    levels.push({ key: 'fire3', tier: 3, ppm: lel, label: 'LEL', meaning: 'Ignitable: fire or explosion if a source is present', flammable: true });
    levels.push({ key: 'fire2', tier: 2, ppm: lel * 0.6, label: '60% LEL', meaning: 'Flame pockets possible in an uneven cloud', flammable: true });
    levels.push({ key: 'fire1', tier: 1, ppm: lel * 0.1, label: '10% LEL', meaning: 'Flammable-gas alarm level', flammable: true });
  }
  // Oxygen displacement: < 19.5% needs ≥ 6.7% gas by volume, < 16% needs ≥ 23% gas
  levels.push({ key: 'o2crit', tier: 3, ppm: (1 - 16 / 20.9) * 1e6, label: 'O₂ < 16%', meaning: 'Hypoxia: impaired judgement, collapse', asphyxiant: true });
  levels.push({ key: 'o2', tier: 2, ppm: (1 - 19.5 / 20.9) * 1e6, label: 'O₂ < 19.5%', meaning: 'Oxygen-deficient atmosphere', asphyxiant: true });

  return levels;
}

const THREAT_LEVELS = [
  { key: 'low', label: 'LOW', color: 'safe' },
  { key: 'elevated', label: 'ELEVATED', color: 'warning' },
  { key: 'high', label: 'HIGH', color: 'leak' },
  { key: 'critical', label: 'CRITICAL', color: 'leak' }
];

function classifyConcentration(ppm, levels) {
  let rank = 0;
  let driver = null;
  for (const l of levels) {
    if (ppm >= l.ppm && l.tier >= rank) {
      if (l.tier > rank || !driver) driver = l;
      rank = l.tier;
    }
  }
  return { rank, driver };
}

/*
  scenario = {
    setting: 'outdoor' | 'indoor',
    releaseRateGs, durationMin, tempC,
    windSpeed, stability, receptorDistance,   // outdoor
    roomVolume, ach, mixing                   // indoor
  }
*/
function assessRelease(chem, scenario) {
  const s = { ...scenario };
  const exposureMin = Math.max(1, s.durationMin);
  const levels = levelsOfConcern(chem, exposureMin);
  const result = { chem, scenario: s, levels, exposureMin };

  if (s.setting === 'outdoor') {
    result.zones = levels.map(l => {
      const distance = distanceToPpm(chem, s, l.ppm);
      const maxWidth = distance > 0 ? maxHalfWidth(chem, s, l.ppm, distance) : 0;
      return { ...l, distance, maxWidth };
    });
    const travelLimit = Math.max(0.5, s.windSpeed) * s.durationMin * 60;
    result.travelLimit = travelLimit;
    result.receptorPpm = plumePpm(chem, s, Math.max(1, s.receptorDistance));
    result.receptorArrivalSec = Math.max(1, s.receptorDistance) / Math.max(0.5, s.windSpeed);
    result.receptorReached = s.receptorDistance <= travelLimit;
    result.profile = [];
    for (let x = 5; x <= 5000; x *= 1.12) {
      result.profile.push({ x, ppm: plumePpm(chem, s, x) });
    }
  } else {
    result.zones = levels.map(l => ({ ...l, timeSec: roomTimeToPpm(chem, s, l.ppm) }));
    const tRel = s.durationMin * 60;
    result.receptorPpm = roomPpm(chem, s, tRel);
    const lambda = (s.ach * s.mixing) / 3600;
    result.steadyStatePpm = lambda > 0 ? Math.min(mgm3ToPpm((s.releaseRateGs * 1000) / (lambda * s.roomVolume), chem.mw, s.tempC), chem.maxPpm) : null;
    result.profile = [];
    const tEnd = tRel * 1.6 + 60;
    for (let i = 0; i <= 120; i++) {
      const t = (tEnd * i) / 120;
      result.profile.push({ t, ppm: roomPpm(chem, s, t) });
    }
  }

  const peakPpm = result.receptorPpm;
  result.receptorO2 = o2FromGasPpm(peakPpm);
  result.receptorEffect = effectForPpm(chem, peakPpm);

  const reachedPpm = (s.setting === 'outdoor' && !result.receptorReached) ? 0 : peakPpm;
  const cls = classifyConcentration(reachedPpm, levels);
  // Map tier rank to threat level; flammable atmosphere or tier-3 toxic = critical
  const levelIdx = cls.rank;
  result.threat = THREAT_LEVELS[levelIdx];
  result.driver = cls.driver;
  result.fireRisk = chem.lelPct ? peakPpm / (chem.lelPct * 10000) : null;
  // Gaussian/well-mixed models under-predict ground-hugging clouds near the source
  result.denseGas = chem.vaporDensity >= 1.3 || (chem.coldRelease && chem.visual === 'white-cloud');
  result.headline = buildHeadline(result);
  return result;
}

function maxHalfWidth(chem, s, thr, distance) {
  let best = 0;
  for (let k = 1; k <= 24; k++) {
    const x = (distance * k) / 25;
    best = Math.max(best, halfWidthAt(chem, s, x, thr));
  }
  return best;
}

function formatDistance(m) {
  if (m === null || m === undefined) return '–';
  if (m <= 0) return '< 1 m';
  if (m >= 20000) return '> 20 km';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${Math.round(m)} m`;
}

function formatDuration(sec) {
  if (sec === null || sec === undefined) return 'not reached';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

function buildHeadline(r) {
  const s = r.scenario;
  const name = r.chem.name;
  const zone3 = r.zones.find(z => z.key === 'tox3');
  const fire = r.zones.find(z => z.key === 'fire3');
  if (s.setting === 'outdoor') {
    const parts = [];
    if (zone3 && zone3.distance > 0) parts.push(`life-threatening ${name} levels up to ${formatDistance(zone3.distance)} downwind`);
    if (fire && fire.distance > 0) parts.push(`an ignitable cloud up to ${formatDistance(fire.distance)}`);
    const at = r.receptorReached
      ? `≈ ${formatPpm(r.receptorPpm)} at ${formatDistance(s.receptorDistance)} (people there)`
      : `the plume would not reach ${formatDistance(s.receptorDistance)} before the release stops`;
    return parts.length ? `Model predicts ${parts.join(' and ')}; ${at}.` : `No life-threatening zone predicted; ${at}.`;
  }
  const t3 = zone3 && zone3.timeSec !== null ? `life-threatening levels after ${formatDuration(zone3.timeSec)}` : null;
  const tf = fire && fire.timeSec !== null ? `an ignitable atmosphere after ${formatDuration(fire.timeSec)}` : null;
  const parts = [t3, tf].filter(Boolean);
  const end = `room reaches ≈ ${formatPpm(r.receptorPpm)} by the end of the ${s.durationMin}-min release`;
  return parts.length ? `The room reaches ${parts.join(' and ')}; ${end}.` : `No life-threatening level predicted; ${end}.`;
}

// Rough release-size classes a camera can suggest from visible plume coverage
const RELEASE_PRESETS = [
  { key: 'pinhole', label: 'Pinhole / fitting weep', rateGs: 0.5 },
  { key: 'small', label: 'Small valve or flange leak', rateGs: 5 },
  { key: 'medium', label: 'Gasket failure / small hose', rateGs: 50 },
  { key: 'large', label: 'Hose rupture / broken line', rateGs: 500 },
  { key: 'major', label: 'Cylinder valve sheared / tank failure', rateGs: 5000 }
];

if (typeof module !== 'undefined') {
  module.exports = { STABILITY_CLASSES, RELEASE_PRESETS, THREAT_LEVELS, briggsSigmas, molarVolumeL, mgm3ToPpm, ppmToMgm3, plumePpm, distanceToPpm, halfWidthAt, roomPpm, roomTimeToPpm, levelsOfConcern, assessRelease, formatDistance, formatDuration };
}
