'use strict';

/* =====================================================================
   CHART HELPER
   Minimal canvas line charts shared by Analytics, Hazard Scanner and the
   Ventilation Planner. Colours come from CSS custom properties so charts
   follow the light/dark theme.
   ===================================================================== */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Size a canvas to its container at device pixel ratio; returns a scaled 2D context
function prepareCanvas(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, rect.width);
  const h = Math.max(10, rect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

function shortNumber(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toPrecision(3)}k`;
  if (a >= 10 || a === 0) return `${Math.round(v)}`;
  if (a >= 1) return `${+v.toFixed(1)}`;
  return `${+v.toPrecision(2)}`;
}

/*
  opts = {
    x: { min, max, log?, format?(v), ticks? },
    y: { min, max, log?, format?(v), label? },
    y2: { min, max, format?(v), label? }          // optional right axis
    series: [{ points: [[x, y]], color, width?, dash?, axis?: 'y2', fill? }],
    thresholds: [{ y, label, color, dash? }],
    bands: [{ x0, x1, color }],                   // vertical shaded ranges
    markers: [{ x, label, color }]                // vertical marker lines
  }
*/
function drawLineChart(canvas, opts) {
  const { ctx, w, h } = prepareCanvas(canvas);
  const font = cssVar('--font-mono') || 'monospace';
  const muted = cssVar('--muted');
  const border = cssVar('--border');
  const m = { top: 12, right: opts.y2 ? 52 : 16, bottom: 26, left: 52 };
  const pw = w - m.left - m.right;
  const ph = h - m.top - m.bottom;

  const mapper = (axis, lo, hi) => {
    if (axis.log) {
      const a = Math.log10(Math.max(axis.min, 1e-9));
      const b = Math.log10(axis.max);
      return v => lo + ((Math.log10(Math.max(v, axis.min)) - a) / (b - a)) * (hi - lo);
    }
    return v => lo + ((v - axis.min) / ((axis.max - axis.min) || 1)) * (hi - lo);
  };
  const X = mapper(opts.x, m.left, m.left + pw);
  const Y = mapper(opts.y, m.top + ph, m.top);
  const Y2 = opts.y2 ? mapper(opts.y2, m.top + ph, m.top) : null;

  ctx.font = `11px ${font}`;
  ctx.lineWidth = 1;

  // Bands
  for (const b of opts.bands || []) {
    const x0 = Math.max(m.left, X(b.x0));
    const x1 = Math.min(m.left + pw, X(b.x1));
    if (x1 <= x0) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(x0, m.top, Math.max(1, x1 - x0), ph);
  }

  // Grid + Y ticks
  const yTicks = opts.y.log ? logTicks(opts.y.min, opts.y.max) : niceTicks(opts.y.min, opts.y.max, 4);
  ctx.strokeStyle = border;
  ctx.fillStyle = muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yTicks) {
    const y = Y(t);
    if (y < m.top - 1 || y > m.top + ph + 1) continue;
    ctx.beginPath();
    ctx.moveTo(m.left, y);
    ctx.lineTo(m.left + pw, y);
    ctx.stroke();
    ctx.fillText((opts.y.format || shortNumber)(t), m.left - 6, y);
  }
  if (Y2) {
    ctx.textAlign = 'left';
    for (const t of niceTicks(opts.y2.min, opts.y2.max, 4)) {
      const y = Y2(t);
      if (y < m.top - 1 || y > m.top + ph + 1) continue;
      ctx.fillText((opts.y2.format || shortNumber)(t), m.left + pw + 6, y);
    }
  }

  // X ticks
  const xTicks = opts.x.ticks || (opts.x.log ? logTicks(opts.x.min, opts.x.max) : niceTicks(opts.x.min, opts.x.max, Math.max(2, Math.floor(pw / 90))));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xTicks) {
    const x = X(t);
    if (x < m.left - 1 || x > m.left + pw + 1) continue;
    ctx.beginPath();
    ctx.moveTo(x, m.top + ph);
    ctx.lineTo(x, m.top + ph + 4);
    ctx.stroke();
    ctx.fillText((opts.x.format || shortNumber)(t), x, m.top + ph + 7);
  }
  ctx.beginPath();
  ctx.moveTo(m.left, m.top + ph + 0.5);
  ctx.lineTo(m.left + pw, m.top + ph + 0.5);
  ctx.stroke();

  // Clip plot area for data
  ctx.save();
  ctx.beginPath();
  ctx.rect(m.left, m.top, pw, ph);
  ctx.clip();

  // Thresholds
  for (const t of opts.thresholds || []) {
    const y = Y(t.y);
    if (y < m.top || y > m.top + ph) continue;
    ctx.strokeStyle = t.color;
    ctx.setLineDash(t.dash || [5, 4]);
    ctx.beginPath();
    ctx.moveTo(m.left, y);
    ctx.lineTo(m.left + pw, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (t.label) {
      ctx.fillStyle = t.color;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.font = `600 10px ${font}`;
      ctx.fillText(t.label, m.left + pw - 4, y - 2);
      ctx.font = `11px ${font}`;
    }
  }

  // Markers
  for (const mk of opts.markers || []) {
    const x = X(mk.x);
    if (x < m.left || x > m.left + pw) continue;
    ctx.strokeStyle = mk.color;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, m.top);
    ctx.lineTo(x, m.top + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    if (mk.label) {
      ctx.fillStyle = mk.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `600 10px ${font}`;
      ctx.fillText(mk.label, x + 4, m.top + 2);
      ctx.font = `11px ${font}`;
    }
  }

  // Series
  for (const s of opts.series) {
    const map = s.axis === 'y2' && Y2 ? Y2 : Y;
    const pts = s.points.filter(p => p[1] !== null && p[1] !== undefined && isFinite(p[1]));
    if (pts.length === 0) continue;
    if (s.fill) {
      ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), m.top + ph);
      for (const p of pts) ctx.lineTo(X(p[0]), map(p[1]));
      ctx.lineTo(X(pts[pts.length - 1][0]), m.top + ph);
      ctx.closePath();
      ctx.fillStyle = s.fill;
      ctx.fill();
    }
    ctx.beginPath();
    let penDown = false;
    let lastX = null;
    for (const p of pts) {
      const x = X(p[0]);
      const y = map(p[1]);
      // Break the line across gaps in time-series data
      if (s.gap && lastX !== null && p[0] - lastX > s.gap) penDown = false;
      if (penDown) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      penDown = true;
      lastX = p[0];
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 2;
    ctx.setLineDash(s.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
  ctx.restore();

  // Axis labels
  ctx.fillStyle = muted;
  ctx.font = `10px ${font}`;
  if (opts.y.label) {
    ctx.save();
    ctx.translate(11, m.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.y.label, 0, 0);
    ctx.restore();
  }
  if (opts.y2 && opts.y2.label) {
    ctx.save();
    ctx.translate(w - 8, m.top + ph / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.y2.label, 0, 0);
    ctx.restore();
  }
}

function logTicks(min, max) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(Math.max(min, 1e-9))); e <= Math.ceil(Math.log10(max)); e++) {
    ticks.push(Math.pow(10, e));
  }
  return ticks.filter(t => t >= min * 0.999 && t <= max * 1.001);
}

function formatClock(ms, spanMs) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (spanMs <= 30 * 60000) return `${hh}:${mm}:${String(d.getSeconds()).padStart(2, '0')}`;
  return `${hh}:${mm}`;
}

// Evenly spaced time ticks on round clock boundaries
function timeTicks(fromMs, toMs, targetCount = 6) {
  const span = toMs - fromMs;
  const steps = [15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 10800e3, 14400e3];
  const step = steps.find(s => span / s <= targetCount) || 21600e3;
  // Align to local clock boundaries (e.g. whole hours in IST, not UTC)
  const tz = new Date(fromMs).getTimezoneOffset() * 60000;
  const ticks = [];
  for (let t = Math.ceil((fromMs - tz) / step) * step + tz; t <= toMs; t += step) ticks.push(t);
  return ticks;
}
