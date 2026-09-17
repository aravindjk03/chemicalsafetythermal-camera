'use strict';

/* =====================================================================
   0. UTILITIES & COLOR PALETTES
   ===================================================================== */
const clamp = (val, min = 0, max = 1) => Math.max(min, Math.min(max, val));

// Inferno Color Palette LUT (256 entries)
// Key stops: [0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]
const INFERNO_LUT = new Uint8Array(256 * 3);
(() => {
  const stops = [
    { i: 0,   rgb: [0, 0, 4] },
    { i: 40,  rgb: [40, 11, 84] },
    { i: 101, rgb: [101, 21, 110] },
    { i: 159, rgb: [159, 42, 99] },
    { i: 212, rgb: [212, 72, 66] },
    { i: 245, rgb: [245, 125, 21] },
    { i: 250, rgb: [250, 193, 39] },
    { i: 255, rgb: [252, 255, 164] }
  ];
  for (let s = 0; s < stops.length - 1; s++) {
    const s0 = stops[s];
    const s1 = stops[s + 1];
    const span = s1.i - s0.i;
    for (let idx = s0.i; idx <= s1.i; idx++) {
      const t = (idx - s0.i) / span;
      INFERNO_LUT[idx * 3 + 0] = Math.round(s0.rgb[0] + t * (s1.rgb[0] - s0.rgb[0]));
      INFERNO_LUT[idx * 3 + 1] = Math.round(s0.rgb[1] + t * (s1.rgb[1] - s0.rgb[1]));
      INFERNO_LUT[idx * 3 + 2] = Math.round(s0.rgb[2] + t * (s1.rgb[2] - s0.rgb[2]));
    }
  }
})();

/* =====================================================================
   1. CAMERA SOURCES
   ===================================================================== */

// a) WebcamSource
class WebcamSource {
  constructor() {
    this.kind = 'rgb';
    this.label = 'Webcam (Live)';
    this.sim = false;
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.stream = null;
    this.isReady = false;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }
      });
      this.video.srcObject = this.stream;
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          this.isReady = true;
          resolve();
        };
      });
      return true;
    } catch (err) {
      console.warn('Webcam start failed:', err);
      this.isReady = false;
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.isReady = false;
  }

  ready() {
    return this.isReady && this.video.readyState >= 2;
  }

  step() {}

  drawable() {
    return this.video;
  }
}

// b) VideoFileSource
class VideoFileSource {
  constructor() {
    this.kind = 'rgb';
    this.label = 'Video File';
    this.sim = false;
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.isReady = false;
  }

  load(file) {
    if (this.video.src) {
      URL.revokeObjectURL(this.video.src);
    }
    this.video.src = URL.createObjectURL(file);
    this.video.play();
    this.isReady = true;
  }

  async start() {
    if (this.video.src) {
      this.video.play();
      this.isReady = true;
    }
    return true;
  }

  stop() {
    this.video.pause();
  }

  ready() {
    return this.isReady && this.video.readyState >= 2;
  }

  step() {}

  drawable() {
    return this.video;
  }
}

// c) SimulatedSceneSource (Visible RGB)
class SimulatedSceneSource {
  constructor() {
    this.kind = 'rgb';
    this.label = 'Simulated Visible Scene';
    this.sim = true;
    this.width = 320;
    this.height = 240;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    
    // Background canvas (pre-rendered)
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = this.width;
    this.bgCanvas.height = this.height;
    this.renderStaticBackground();

    this.leakActive = false;
    this.leakRate = 1.0;          // 0.2 (weep) … 1.5 (large release)
    this.chemical = 'ammonia';    // drives plume colour (see PLUME_COLORS)
    this.lightGain = 1.0;         // simulated lighting level (1 = normal)
    this.puffs = [];
    this.walker = { active: false, x: -50 };
  }

  toggleLighting() {
    this.lightGain = this.lightGain === 1.0 ? 0.7 : 1.0;
  }

  renderStaticBackground() {
    const bgCtx = this.bgCanvas.getContext('2d');
    // Brick wall with offset rows and varied shades
    bgCtx.fillStyle = '#6E4E42';
    bgCtx.fillRect(0, 0, this.width, this.height);

    const brickW = 28;
    const brickH = 12;
    const rows = Math.ceil(this.height / brickH);
    const cols = Math.ceil(this.width / brickW) + 1;

    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2 === 0) ? 0 : -brickW / 2;
      for (let c = 0; c < cols; c++) {
        const bx = c * brickW + offsetX;
        const by = r * brickH;
        // Slight color variation
        const shade = 100 + Math.floor((Math.sin(r * 13 + c * 37) * 0.5 + 0.5) * 35);
        const redTone = shade + 20;
        bgCtx.fillStyle = `rgb(${redTone}, ${shade - 25}, ${shade - 40})`;
        bgCtx.fillRect(bx + 1, by + 1, brickW - 2, brickH - 2);
      }
    }

    // Horizontal grey pipe at y=150 (y: 144 to 156)
    const pipeY = 150;
    const pipeH = 14;
    const pipeGrad = bgCtx.createLinearGradient(0, pipeY - pipeH / 2, 0, pipeY + pipeH / 2);
    pipeGrad.addColorStop(0, '#5A6672');
    pipeGrad.addColorStop(0.3, '#A0ADB8');
    pipeGrad.addColorStop(0.7, '#6A7885');
    pipeGrad.addColorStop(1, '#3B454E');
    bgCtx.fillStyle = pipeGrad;
    bgCtx.fillRect(0, pipeY - pipeH / 2, this.width, pipeH);

    // Flanges on pipe
    bgCtx.fillStyle = '#49535C';
    bgCtx.fillRect(90, pipeY - pipeH / 2 - 2, 8, pipeH + 4);
    bgCtx.fillRect(230, pipeY - pipeH / 2 - 2, 8, pipeH + 4);

    // Dark valve body at x≈150–170
    bgCtx.fillStyle = '#222A30';
    bgCtx.fillRect(152, pipeY - 14, 16, 28);
    // Valve stem
    bgCtx.fillStyle = '#4A5560';
    bgCtx.fillRect(158, pipeY - 24, 4, 10);
    // Red handwheel on top (y ≈ 124)
    bgCtx.fillStyle = '#C02626';
    bgCtx.fillRect(148, pipeY - 27, 24, 5);
    bgCtx.fillStyle = '#E53E3E';
    bgCtx.fillRect(150, pipeY - 28, 20, 2);
  }

  triggerWalker() {
    this.walker.active = true;
    this.walker.x = -40;
  }

  async start() { return true; }
  stop() {}
  ready() { return true; }

  step() {
    // Draw static background
    this.ctx.drawImage(this.bgCanvas, 0, 0);

    // Spawn leak puffs if leak is active (3 puffs per frame at full rate).
    // Colourless gases (methane, CO, H2S…) are invisible to an RGB camera.
    const plume = PLUME_COLORS[CHEMICALS_BY_ID[this.chemical]?.visual] || null;
    if (this.leakActive && plume) {
      const count = 3 * this.leakRate;
      for (let i = 0; i < Math.floor(count) + (Math.random() < count % 1 ? 1 : 0); i++) {
        this.puffs.push({
          x: 160 + (Math.random() - 0.5) * 3,
          y: 142,
          vx: (Math.random() - 0.5) * 0.9,
          vy: -0.6 - Math.random() * 0.9,
          radius: 5,
          alpha: plume.alpha * Math.min(1, 0.55 + 0.45 * this.leakRate),
          rgb: plume.rgb,
          phase: Math.random() * Math.PI * 2,
          wobbleFreq: 0.08 + Math.random() * 0.04
        });
      }
    }

    // Update and draw puffs
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.phase += p.wobbleFreq;
      p.x += p.vx + Math.sin(p.phase) * 0.45;
      p.y += p.vy;
      p.radius += 0.32;
      p.alpha -= 0.0032;

      if (p.alpha <= 0 || p.y < -p.radius) {
        this.puffs.splice(i, 1);
        continue;
      }

      // Pre-rendered radial sprite in the chemical's cloud colour, faded by puff alpha
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      this.ctx.drawImage(puffSprite(p.rgb), p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
    }
    this.ctx.globalAlpha = 1;

    // "Person walks by": dark blue rectangle (36x170) with round head, moving 7 px/frame
    if (this.walker.active) {
      const wx = this.walker.x;
      // Round head
      this.ctx.fillStyle = '#102A45';
      this.ctx.beginPath();
      this.ctx.arc(wx + 18, 56, 14, 0, Math.PI * 2);
      this.ctx.fill();
      // Torso / body rect (36x170)
      this.ctx.fillRect(wx, 70, 36, 170);

      this.walker.x += 7;
      if (this.walker.x > this.width + 50) {
        this.walker.active = false;
      }
    }

    // Lighting level + camera noise: ±3 grey-level random noise per pixel
    // (ImageData is a Uint8ClampedArray, so writes clamp to 0–255 automatically)
    const imgData = this.ctx.getImageData(0, 0, this.width, this.height);
    const d = imgData.data;
    const gain = this.lightGain;
    const noiseTable = noiseTableInt();
    let n = (Math.random() * (noiseTable.length - d.length / 4)) | 0;
    for (let i = 0; i < d.length; i += 4, n++) {
      const noise = noiseTable[n];
      d[i]     = d[i] * gain + noise;
      d[i + 1] = d[i + 1] * gain + noise;
      d[i + 2] = d[i + 2] * gain + noise;
    }
    this.ctx.putImageData(imgData, 0, 0);
  }

  drawable() {
    return this.canvas;
  }

  // Clean background (no plume, no person) for the Hazard Scanner's reference frame
  referenceDrawable() {
    return this.bgCanvas;
  }
}

// Pre-generated sensor noise, read from a random offset each frame
let NOISE_INT = null;    // ±3 grey levels (visible camera)
let NOISE_FLOAT = null;  // ±0.15 °C (thermal camera)
function noiseTableInt() {
  if (!NOISE_INT) {
    NOISE_INT = new Int8Array(1 << 20);
    for (let i = 0; i < NOISE_INT.length; i++) NOISE_INT[i] = (Math.random() * 6 - 3) | 0;
  }
  return NOISE_INT;
}
function noiseTableFloat() {
  if (!NOISE_FLOAT) {
    NOISE_FLOAT = new Float32Array(1 << 18);
    for (let i = 0; i < NOISE_FLOAT.length; i++) NOISE_FLOAT[i] = (Math.random() - 0.5) * 0.3;
  }
  return NOISE_FLOAT;
}

// Soft radial sprite per cloud colour: alpha 1 at centre, 0.5 at 60% radius, 0 at edge
const PUFF_SPRITES = new Map();
function puffSprite(rgb) {
  const key = rgb.join(',');
  let sprite = PUFF_SPRITES.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 96;
    const sctx = sprite.getContext('2d');
    const grad = sctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    grad.addColorStop(0, `rgba(${key}, 1)`);
    grad.addColorStop(0.6, `rgba(${key}, 0.5)`);
    grad.addColorStop(1, `rgba(${key}, 0)`);
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 96, 96);
    PUFF_SPRITES.set(key, sprite);
  }
  return sprite;
}

// Apparent colour of a dense release against the scene (visual class from the chemical database)
const PLUME_COLORS = {
  'white-cloud':  { rgb: [236, 240, 244], alpha: 0.32 }, // condensed moisture / aerosol (ammonia, LPG flash)
  'yellow-green': { rgb: [204, 216, 96],  alpha: 0.34 }, // chlorine
  'red-brown':    { rgb: [168, 84, 38],   alpha: 0.36 }  // nitrogen dioxide
};

// exp(-k) lookup for k in [0, 12) — the plume window never exceeds k ≈ 11.1
const EXP_LUT_MAX = 12;
const EXP_LUT_SCALE = 512;
const EXP_LUT = new Float32Array(EXP_LUT_MAX * EXP_LUT_SCALE);
for (let i = 0; i < EXP_LUT.length; i++) EXP_LUT[i] = Math.exp(-(i + 0.5) / EXP_LUT_SCALE);

// d) SimulatedThermalSource (160x120 °C Array)
class SimulatedThermalSource {
  constructor() {
    this.kind = 'thermal';
    this.label = 'Simulated Thermal Camera';
    this.sim = true;
    this.width = 160;
    this.height = 120;
    this.temps = new Float32Array(this.width * this.height);
    this.scratchA = new Float32Array(this.width * this.height);
    this.leakActive = false;
    this.leakRate = 1.0;
    this.chemical = 'ammonia';
    this.ambientShift = 0;        // simulated HVAC / sun drift of the whole scene (°C)
    this.puffs = [];
    this.walker = { active: false, x: -30 };
    this.initBaseTemps();
  }

  toggleLighting() {
    // Thermal cameras ignore visible light; model an HVAC swing instead
    this.ambientShift = this.ambientShift === 0 ? -2.0 : 0;
  }

  initBaseTemps() {
    this.baseTemps = new Float32Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        // Ambient ≈ 29 °C with slight gradient
        let t = 28.5 + (y / this.height) * 1.0;
        // Hot pipe at rows 76–84 (≈ 44 °C)
        if (y >= 76 && y <= 84) {
          const distToCenter = Math.abs(y - 80) / 4;
          t = 44.0 - distToCenter * 2.0;
        }
        // Valve block at x 75–85, y 70–88 (≈ 41 °C)
        if (x >= 75 && x <= 85 && y >= 70 && y <= 88) {
          t = 41.0;
        }
        this.baseTemps[idx] = t;
        this.temps[idx] = t;
      }
    }
  }

  triggerWalker() {
    this.walker.active = true;
    this.walker.x = -25;
  }

  async start() { return true; }
  stop() {}
  ready() { return true; }

  step() {
    // 1. Reset temps to base model + ambient drift + noise (±0.15 °C)
    const noiseTable = noiseTableFloat();
    let n = (Math.random() * (noiseTable.length - this.temps.length)) | 0;
    for (let idx = 0; idx < this.temps.length; idx++, n++) {
      this.temps[idx] = this.baseTemps[idx] + this.ambientShift + noiseTable[n];
    }

    // 2. Leak: 2 cold puffs per frame from (80, 72). Liquefied / high-pressure
    //    releases chill strongly; other gases only show weak expansion cooling.
    if (this.leakActive) {
      const chem = CHEMICALS_BY_ID[this.chemical];
      const strength = (chem && !chem.coldRelease ? 0.45 : 1.0) * Math.min(1.2, 0.4 + 0.6 * this.leakRate);
      const count = 2 * this.leakRate;
      for (let i = 0; i < Math.floor(count) + (Math.random() < count % 1 ? 1 : 0); i++) {
        this.puffs.push({
          x: 80 + (Math.random() - 0.5) * 1.5,
          y: 72,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -0.35 - Math.random() * 0.45,
          r: 3.0,
          strength
        });
      }
    }

    // Clear cooling scratch array A
    this.scratchA.fill(0);

    // Update puffs and accumulate gaussian cooling
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.x += p.vx;
      p.y += p.vy;
      p.r += 0.18;
      p.strength *= 0.965;

      if (p.strength < 0.05 || p.y < -p.r) {
        this.puffs.splice(i, 1);
        continue;
      }

      // Accumulate gaussian cooling into scratch A
      const minX = Math.max(0, Math.floor(p.x - p.r * 2));
      const maxX = Math.min(this.width - 1, Math.ceil(p.x + p.r * 2));
      const minY = Math.max(0, Math.floor(p.y - p.r * 2));
      const maxY = Math.min(this.height - 1, Math.ceil(p.y + p.r * 2));
      const invSigmaSq = 1 / (2 * (p.r * 0.6) ** 2);
      const amp = p.strength * 10;

      for (let py = minY; py <= maxY; py++) {
        const dy2 = (py - p.y) ** 2;
        const row = py * this.width;
        for (let px = minX; px <= maxX; px++) {
          const k = ((px - p.x) ** 2 + dy2) * invSigmaSq;
          if (k < EXP_LUT_MAX) {
            this.scratchA[row + px] += amp * EXP_LUT[(k * EXP_LUT_SCALE) | 0];
          }
        }
      }
    }

    // Apply saturating cooling: T -= 16 * (1 - exp(-A/12))
    // Naturally never drops below ~13 °C for ambient ~29 °C!
    for (let idx = 0; idx < this.temps.length; idx++) {
      const a = this.scratchA[idx];
      if (a > 0.01) {
        const deltaT = 16.0 * (1.0 - Math.exp(-a / 12.0));
        this.temps[idx] -= deltaT;
      }
    }

    // "Person walks by": a warm 33–35.5 °C body moving 3.5 px/frame
    if (this.walker.active) {
      const wx = Math.round(this.walker.x);
      const bodyW = 18;
      const bodyH = 86;
      for (let py = 34; py < 34 + bodyH; py++) {
        for (let px = wx; px < wx + bodyW; px++) {
          if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
            // Head ellipse or body rect
            const isHead = py < 46 && Math.abs(px - (wx + bodyW / 2)) > 5;
            if (!isHead) {
              const bodyTemp = 33.0 + Math.random() * 2.5;
              this.temps[py * this.width + px] = bodyTemp;
            }
          }
        }
      }

      this.walker.x += 3.5;
      if (this.walker.x > this.width + 30) {
        this.walker.active = false;
      }
    }
  }
}

/* =====================================================================
   2. DETECTION ENGINE (Class Detector)
   ===================================================================== */
class Detector {
  constructor() {
    this.width = 160;
    this.height = 120;
    this.cellSize = 10;
    this.gridCols = 16;
    this.gridRows = 12;
    this.numCells = this.gridCols * this.gridRows; // 192 cells

    // Buffers
    this.grayCur = new Uint8Array(this.width * this.height);
    this.grayPrev = new Uint8Array(this.width * this.height);
    this.bg = new Float32Array(this.width * this.height);
    this.bgClean = new Float32Array(this.width * this.height); // frozen while a cell is active
    this.bgT = new Float32Array(this.width * this.height);

    // Illumination-invariant colour (chromaticity r = R/ΣRGB, g = G/ΣRGB, scaled ×255)
    this.chromR = new Float32Array(this.width * this.height);
    this.chromG = new Float32Array(this.width * this.height);
    this.bgChromR = new Float32Array(this.width * this.height);
    this.bgChromG = new Float32Array(this.width * this.height);
    this.cleanChromR = new Float32Array(this.width * this.height);
    this.cleanChromG = new Float32Array(this.width * this.height);
    this.chromValid = new Uint8Array(this.width * this.height); // too dark = unreliable colour

    // Cell features & state
    this.noise = new Float32Array(this.numCells);
    this.chromaNoise = new Float32Array(this.numCells);
    this.score = new Float32Array(this.numCells);
    this.raw = new Float32Array(this.numCells);
    this.persist = new Int32Array(this.numCells);
    this.persistSince = new Float64Array(this.numCells);   // ms timestamp the cell became active
    this.idleFrames = new Int32Array(this.numCells);       // consecutive quiet frames (clean-reference gating)

    // Parameters
    this.sensitivity = 1.3;
    this.persistSeconds = 1.2;
    this.coldThreshold = 3.0;
    this.fps = 15;

    // Calibration
    this.calibFramesMax = 45;
    this.calibFrames = 0;
    this.isCalibrating = true;

    // Scene change
    this.sceneChangeCounter = 0;

    // Telemetry metrics
    this.telemetry = {
      changedAreaPct: 0,
      hazePct: 0,
      shiftVal: 0,
      isThermal: false,
      minT: 0,
      maxT: 0
    };

    this.reset();
  }

  reset() {
    this.calibFrames = 0;
    this.isCalibrating = true;
    this.sceneChangeCounter = 0;
    this.noise.fill(2);
    this.chromaNoise.fill(2);
    this.score.fill(0);
    this.raw.fill(0);
    this.persist.fill(0);
    this.persistSince.fill(0);
    this.idleFrames.fill(0);
    this.bg.fill(0);
    this.bgClean.fill(0);
    this.bgT.fill(0);
    this.bgChromR.fill(0);
    this.bgChromG.fill(0);
    this.cleanChromR.fill(0);
    this.cleanChromG.fill(0);
    this.hasColor = false;
  }

  // Chromaticity of the current frame from RGBA (160x120)
  updateChroma(rgba) {
    for (let i = 0, j = 0; j < this.chromR.length; i += 4, j++) {
      const sum = rgba[i] + rgba[i + 1] + rgba[i + 2];
      if (sum < 60) {
        this.chromValid[j] = 0;
      } else {
        this.chromValid[j] = 1;
        this.chromR[j] = (rgba[i] * 255) / sum;
        this.chromG[j] = (rgba[i + 1] * 255) / sum;
      }
    }
  }

  processVisible(grayBuffer, watchZones, nowMs = 0, rgba = null) {
    this.grayCur.set(grayBuffer);
    this.hasColor = !!rgba;
    if (rgba) this.updateChroma(rgba);

    // Calibration phase
    if (this.isCalibrating) {
      this.calibFrames++;
      const alpha = 0.25;

      if (this.calibFrames === 1) {
        for (let i = 0; i < this.bg.length; i++) this.bg[i] = this.grayCur[i];
        if (rgba) {
          this.bgChromR.set(this.chromR);
          this.bgChromG.set(this.chromG);
        }
      } else {
        for (let i = 0; i < this.bg.length; i++) {
          this.bg[i] = this.bg[i] * (1 - alpha) + this.grayCur[i] * alpha;
        }
        if (rgba) {
          for (let i = 0; i < this.bg.length; i++) {
            this.bgChromR[i] = this.bgChromR[i] * (1 - alpha) + this.chromR[i] * alpha;
            this.bgChromG[i] = this.bgChromG[i] * (1 - alpha) + this.chromG[i] * alpha;
          }
        }
      }

      // Measure brightness and colour noise per cell
      for (let cy = 0; cy < this.gridRows; cy++) {
        for (let cx = 0; cx < this.gridCols; cx++) {
          const c = cy * this.gridCols + cx;
          let sumDiff = 0;
          let sumChroma = 0;
          let nChroma = 0;
          for (let y = cy * 10; y < cy * 10 + 10; y++) {
            for (let x = cx * 10; x < cx * 10 + 10; x++) {
              const idx = y * this.width + x;
              sumDiff += Math.abs(this.grayCur[idx] - this.bg[idx]);
              if (rgba && this.chromValid[idx]) {
                sumChroma += Math.abs(this.chromR[idx] - this.bgChromR[idx]) + Math.abs(this.chromG[idx] - this.bgChromG[idx]);
                nChroma++;
              }
            }
          }
          const meanDiff = sumDiff / 100;
          this.noise[c] = Math.max(2, Math.max(this.noise[c], meanDiff));
          if (nChroma > 0) {
            this.chromaNoise[c] = Math.max(2, Math.max(this.chromaNoise[c], sumChroma / nChroma));
          }
        }
      }

      if (this.calibFrames >= this.calibFramesMax) {
        this.isCalibrating = false;
        this.bgClean.set(this.bg);
        this.cleanChromR.set(this.bgChromR);
        this.cleanChromG.set(this.bgChromG);
      }

      this.grayPrev.set(this.grayCur);
      return { confidence: 0, boxes: [], calibrating: true, remainingCalib: Math.ceil((this.calibFramesMax - this.calibFrames) / this.fps) };
    }

    // --- Visible-light per-cell features ---
    let highChangeCells = 0;
    let totalActiveHaze = 0;
    let totalActiveBright = 0;
    let activeCellCount = 0;
    let changedCellsCount = 0;

    for (let cy = 0; cy < this.gridRows; cy++) {
      for (let cx = 0; cx < this.gridCols; cx++) {
        const c = cy * this.gridCols + cx;

        let sumBgDiff = 0;
        let sumCleanDiff = 0;
        let sumPrevDiff = 0;
        let sumCur = 0;
        let sumCurSq = 0;
        let sumBg = 0;
        let sumBgSq = 0;
        let eC = 0;
        let eB = 0;
        let sumChroma = 0;
        let sumCleanChroma = 0;
        let nChroma = 0;

        for (let y = cy * 10; y < cy * 10 + 10; y++) {
          for (let x = cx * 10; x < cx * 10 + 10; x++) {
            const idx = y * this.width + x;
            const g = this.grayCur[idx];
            const b = this.bg[idx];
            const p = this.grayPrev[idx];

            sumBgDiff += Math.abs(g - b);
            sumCleanDiff += Math.abs(g - this.bgClean[idx]);
            sumPrevDiff += Math.abs(g - p);
            sumCur += g;
            sumCurSq += g * g;
            sumBg += b;
            sumBgSq += b * b;

            // Edge energy (|right - px| + |down - px|)
            const rightIdx = (x + 1 < this.width) ? idx + 1 : idx;
            const downIdx  = (y + 1 < this.height) ? idx + this.width : idx;

            eC += Math.abs(this.grayCur[rightIdx] - g) + Math.abs(this.grayCur[downIdx] - g);
            eB += Math.abs(this.bg[rightIdx] - b) + Math.abs(this.bg[downIdx] - b);

            if (rgba && this.chromValid[idx]) {
              sumChroma += Math.abs(this.chromR[idx] - this.bgChromR[idx]) + Math.abs(this.chromG[idx] - this.bgChromG[idx]);
              sumCleanChroma += Math.abs(this.chromR[idx] - this.cleanChromR[idx]) + Math.abs(this.chromG[idx] - this.cleanChromG[idx]);
              nChroma++;
            }
          }
        }

        const dBg = sumBgDiff / 100;
        const dCleanChroma = nChroma > 20 ? sumCleanChroma / nChroma : 0;
        const dClean = sumCleanDiff / 100;
        const dPrev = sumPrevDiff / 100;
        const dChroma = nChroma > 20 ? sumChroma / nChroma : 0;
        const meanCur = sumCur / 100;
        const meanBg = sumBg / 100;
        const varCur = Math.max(0, (sumCurSq / 100) - (meanCur * meanCur));
        const varBg  = Math.max(0, (sumBgSq / 100) - (meanBg * meanBg));
        const stdCur = Math.sqrt(varCur);
        const stdBg  = Math.sqrt(varBg);

        // Feature formulas
        const grayChange = clamp((dBg - this.noise[c] * 1.5) / 12);
        // Coloured vapour (chlorine, NO2) can change hue without changing brightness;
        // chromaticity ignores lighting level, so dimming lights does not trigger it.
        const tint = clamp((dChroma - Math.max(3, this.chromaNoise[c]) * 1.5) / 10);
        const change = Math.max(grayChange, tint);
        const haze   = clamp((stdBg - stdCur) / (stdBg + 2));
        const bright = clamp((meanCur - meanBg) / 40, -1, 1);
        const solid  = clamp(eC / (eB + 2 * 100) - 1.3);
        const fast   = clamp((dPrev - 18) / 20);
        const dark   = clamp((-bright - 0.15) * 2);

        let rawVal = clamp(
          change * (0.35 + 0.35 * haze + 0.3 * Math.max(Math.max(0, bright), tint)) *
          (1 - 0.8 * solid) * (1 - 0.6 * fast) * (1 - 0.8 * dark) * this.sensitivity
        );

        // Recovery: an active cell that looks like its pre-event background again
        // has cleared, even if the adaptive background absorbed part of the plume.
        const recovered = dClean <= this.noise[c] * 1.5 + 1 &&
          dCleanChroma <= Math.max(3, this.chromaNoise[c]) * 1.5 + 1 &&
          (this.score[c] > 0.05 || change > 0);
        // Clearing: the scene looks more like its clean reference than like the
        // adapted background, i.e. vapour the background had absorbed is leaving.
        const clearing = !recovered && dClean + this.noise[c] < 0.6 * dBg;
        if (recovered) rawVal = 0;
        else if (clearing) rawVal *= clamp(dClean / Math.max(1, dBg));

        this.raw[c] = rawVal;

        if (grayChange > 0.5) highChangeCells++;
        if (change > 0.2) changedCellsCount++;
        if (rawVal > 0.2) {
          totalActiveHaze += haze;
          totalActiveBright += Math.max(0, bright);
          activeCellCount++;
        }

        // Update background per pixel: slow while active, snap back once recovered.
        // Pixels that differ strongly from the background (a passing person, the
        // dense core of a cloud) are foreground and are absorbed only very slowly.
        const cellAlpha = recovered ? 0.5 : clearing ? 0.08 : (this.score[c] > 0.2) ? 0.002 : 0.02;
        // The clean reference only follows cells that have been quiet for 3 s,
        // so thin or fluctuating vapour can never be learnt as "clean".
        this.idleFrames[c] = (this.score[c] < 0.1 && rawVal < 0.05 && change === 0) ? this.idleFrames[c] + 1 : 0;
        const idle = this.idleFrames[c] >= this.fps * 3;
        for (let y = cy * 10; y < cy * 10 + 10; y++) {
          for (let x = cx * 10; x < cx * 10 + 10; x++) {
            const idx = y * this.width + x;
            const hasChroma = rgba && this.chromValid[idx];
            const fg = Math.abs(this.grayCur[idx] - this.bg[idx]) > 20 ||
              (hasChroma && Math.abs(this.chromR[idx] - this.bgChromR[idx]) + Math.abs(this.chromG[idx] - this.bgChromG[idx]) > 12);
            const alpha = (fg && !recovered && !clearing) ? Math.min(cellAlpha, 0.001) : cellAlpha;
            this.bg[idx] = this.bg[idx] * (1 - alpha) + this.grayCur[idx] * alpha;
            if (hasChroma) {
              this.bgChromR[idx] = this.bgChromR[idx] * (1 - alpha) + this.chromR[idx] * alpha;
              this.bgChromG[idx] = this.bgChromG[idx] * (1 - alpha) + this.chromG[idx] * alpha;
            }
            if (idle) {
              this.bgClean[idx] += (this.grayCur[idx] - this.bgClean[idx]) * 0.02;
              if (hasChroma) {
                this.cleanChromR[idx] += (this.chromR[idx] - this.cleanChromR[idx]) * 0.02;
                this.cleanChromG[idx] += (this.chromG[idx] - this.cleanChromG[idx]) * 0.02;
              }
            }
          }
        }
      }
    }

    // Scene-change guard: >60% of cells have change > 0.5
    if (highChangeCells / this.numCells > 0.60) {
      for (let i = 0; i < this.bg.length; i++) this.bg[i] = this.grayCur[i];
      this.bgClean.set(this.bg);
      if (rgba) {
        this.bgChromR.set(this.chromR);
        this.bgChromG.set(this.chromG);
        this.cleanChromR.set(this.chromR);
        this.cleanChromG.set(this.chromG);
      }
      this.score.fill(0);
      this.raw.fill(0);
      this.persist.fill(0);
      this.sceneChangeCounter = Math.round(this.fps * 2); // 2 seconds
      this.grayPrev.set(this.grayCur);
      return { confidence: 0, boxes: [], sceneChanged: true };
    }

    if (this.sceneChangeCounter > 0) {
      this.sceneChangeCounter--;
      this.grayPrev.set(this.grayCur);
      if (this.sceneChangeCounter === 0) {
        this.bgClean.set(this.bg);
        this.cleanChromR.set(this.bgChromR);
        this.cleanChromG.set(this.bgChromG);
      }
      return { confidence: 0, boxes: [], sceneChanged: true };
    }

    this.grayPrev.set(this.grayCur);

    // Update telemetry
    this.telemetry.changedAreaPct = Math.round((changedCellsCount / this.numCells) * 100);
    this.telemetry.hazePct = activeCellCount > 0 ? Math.round((totalActiveHaze / activeCellCount) * 100) : 0;
    this.telemetry.shiftVal = activeCellCount > 0 ? Math.round((totalActiveBright / activeCellCount) * 100) : 0;
    this.telemetry.isThermal = false;

    return this.aggregate(watchZones, nowMs);
  }

  processThermal(tempsBuffer, watchZones, nowMs = 0) {
    // Calibration phase
    if (this.isCalibrating) {
      this.calibFrames++;
      const alpha = 0.25;

      if (this.calibFrames === 1) {
        for (let i = 0; i < this.bgT.length; i++) this.bgT[i] = tempsBuffer[i];
      } else {
        for (let i = 0; i < this.bgT.length; i++) {
          this.bgT[i] = this.bgT[i] * (1 - alpha) + tempsBuffer[i] * alpha;
        }
      }

      if (this.calibFrames >= this.calibFramesMax) {
        this.isCalibrating = false;
      }

      return { confidence: 0, boxes: [], calibrating: true, remainingCalib: Math.ceil((this.calibFramesMax - this.calibFrames) / this.fps) };
    }

    // Ambient = mean(bgT)
    let sumBgT = 0;
    let minT = 999;
    let maxT = -999;
    for (let i = 0; i < this.bgT.length; i++) {
      sumBgT += this.bgT[i];
      const t = tempsBuffer[i];
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const ambient = sumBgT / this.bgT.length;

    let totalColdDrop = 0;
    let totalColdPixels = 0;
    let changedCellsCount = 0;

    for (let cy = 0; cy < this.gridRows; cy++) {
      for (let cx = 0; cx < this.gridCols; cx++) {
        const c = cy * this.gridCols + cx;
        let coldPixels = 0;

        for (let y = cy * 10; y < cy * 10 + 10; y++) {
          for (let x = cx * 10; x < cx * 10 + 10; x++) {
            const idx = y * this.width + x;
            const T = tempsBuffer[idx];
            const bT = this.bgT[idx];

            // Cold rule: (bgT - T) > coldThreshold AND T < ambient - 1
            if ((bT - T) > this.coldThreshold && T < (ambient - 1.0)) {
              coldPixels++;
              totalColdDrop += (bT - T);
              totalColdPixels++;
            }

            // bgT update per pixel
            let alpha = 0.02;
            if (this.score[c] > 0.2) {
              alpha = 0.001;
            } else if ((T - bT) > 1.5) {
              alpha = 0.0005; // warm transients must not enter baseline!
            }
            this.bgT[idx] = bT * (1 - alpha) + T * alpha;
          }
        }

        const coldFraction = coldPixels / 100;
        const rawVal = clamp(coldFraction * 2.2 * this.sensitivity / 1.3);
        this.raw[c] = rawVal;
        if (rawVal > 0.2) changedCellsCount++;
      }
    }

    this.telemetry.changedAreaPct = Math.round((changedCellsCount / this.numCells) * 100);
    this.telemetry.hazePct = Math.min(100, Math.round((totalColdPixels / this.bgT.length) * 100 * 5));
    this.telemetry.shiftVal = totalColdPixels > 0 ? (totalColdDrop / totalColdPixels).toFixed(1) : '0.0';
    this.telemetry.isThermal = true;
    this.telemetry.minT = minT.toFixed(1);
    this.telemetry.maxT = maxT.toFixed(1);

    return this.aggregate(watchZones, nowMs);
  }

  aggregate(watchZones, nowMs = 0) {
    const requiredPersistMs = this.persistSeconds * 1000;
    const hasZones = watchZones && watchZones.length > 0;

    const confirmedGrid = new Uint8Array(this.numCells);
    const earlyGrid = new Uint8Array(this.numCells);

    for (let cy = 0; cy < this.gridRows; cy++) {
      for (let cx = 0; cx < this.gridCols; cx++) {
        const c = cy * this.gridCols + cx;

        // Temporal smoothing: score = score*0.8 + raw*0.2
        this.score[c] = this.score[c] * 0.8 + this.raw[c] * 0.2;

        // Persistence is timed in real milliseconds so a slow machine (low fps)
        // still confirms after the configured number of seconds
        if (this.score[c] > 0.3) {
          if (this.persist[c] === 0) this.persistSince[c] = nowMs;
          this.persist[c]++;
        } else {
          this.persist[c] = 0;
        }

        // Watch zone check
        let inZone = true;
        if (hasZones) {
          const nx = (cx + 0.5) / this.gridCols;
          const ny = (cy + 0.5) / this.gridRows;
          inZone = watchZones.some(z => nx >= z.x0 && nx <= z.x1 && ny >= z.y0 && ny <= z.y1);
        }

        if (inZone && this.score[c] > 0.3) {
          earlyGrid[c] = 1;
          if (this.persist[c] > 1 && nowMs - this.persistSince[c] >= requiredPersistMs) {
            confirmedGrid[c] = 1;
          }
        }
      }
    }

    // Find 4-connected components
    const confirmedComponents = this.findComponents(confirmedGrid);
    const earlyComponents = this.findComponents(earlyGrid);

    let bestConfirmedConf = 0;
    let boxes = [];

    for (const comp of confirmedComponents) {
      const size = comp.cells.length;
      let sumScore = 0;
      for (const idx of comp.cells) sumScore += this.score[idx];
      const meanScore = sumScore / size;
      const conf = size < 2 ? 0 : clamp(meanScore * 1.4 * Math.min(1, 0.35 + size / 10));

      if (conf > bestConfirmedConf) bestConfirmedConf = conf;

      if (conf > 0.25) {
        boxes.push({
          minCx: comp.minCx,
          maxCx: comp.maxCx,
          minCy: comp.minCy,
          maxCy: comp.maxCy,
          conf: conf,
          size: size
        });
      }
    }

    let bestEarlyConf = 0;
    for (const comp of earlyComponents) {
      const size = comp.cells.length;
      let sumScore = 0;
      for (const idx of comp.cells) sumScore += this.score[idx];
      const meanScore = sumScore / size;
      const conf = size < 2 ? 0 : clamp(meanScore * 1.4 * Math.min(1, 0.35 + size / 10));
      if (conf > bestEarlyConf) bestEarlyConf = conf;
    }

    // Camera confidence formula:
    // max(best confirmed conf, min(0.5, bestEarlyConf * 0.5))
    // So unconfirmed activity can reach WARNING but never LEAK!
    const camConfidence = Math.max(bestConfirmedConf, Math.min(0.5, bestEarlyConf * 0.5));

    return {
      confidence: camConfidence,
      boxes: boxes,
      calibrating: false,
      sceneChanged: false
    };
  }

  findComponents(binaryGrid) {
    const visited = new Uint8Array(this.numCells);
    const components = [];

    for (let cy = 0; cy < this.gridRows; cy++) {
      for (let cx = 0; cx < this.gridCols; cx++) {
        const startIdx = cy * this.gridCols + cx;
        if (binaryGrid[startIdx] === 0 || visited[startIdx] === 1) continue;

        const comp = { cells: [], minCx: cx, maxCx: cx, minCy: cy, maxCy: cy };
        const queue = [startIdx];
        visited[startIdx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop();
          comp.cells.push(curr);

          const ccx = curr % this.gridCols;
          const ccy = (curr / this.gridCols) | 0;

          if (ccx < comp.minCx) comp.minCx = ccx;
          if (ccx > comp.maxCx) comp.maxCx = ccx;
          if (ccy < comp.minCy) comp.minCy = ccy;
          if (ccy > comp.maxCy) comp.maxCy = ccy;

          // 4-neighbors
          const neighbors = [
            ccx > 0 ? curr - 1 : -1,
            ccx < this.gridCols - 1 ? curr + 1 : -1,
            ccy > 0 ? curr - this.gridCols : -1,
            ccy < this.gridRows - 1 ? curr + this.gridCols : -1
          ];

          for (const n of neighbors) {
            if (n >= 0 && binaryGrid[n] === 1 && visited[n] === 0) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }

        components.push(comp);
      }
    }

    return components;
  }
}

/*
  One detection step for any camera source. Shared by the live loop and
  the automated benchmark so both exercise exactly the same pipeline.
  offCtx must be a 160x120 2D context created with willReadFrequently.
*/
function processSourceFrame(detector, source, offCtx, watchZones, nowMs) {
  if (source.kind === 'thermal') {
    return detector.processThermal(source.temps, watchZones, nowMs);
  }
  if (!source.ready()) {
    return { confidence: 0, boxes: [], calibrating: false };
  }
  offCtx.drawImage(source.drawable(), 0, 0, 160, 120);
  const imgData = offCtx.getImageData(0, 0, 160, 120).data;
  const gray = new Uint8Array(160 * 120);
  // Grayscale conversion: g = (77*R + 150*G + 29*B) >> 8
  for (let i = 0, j = 0; i < imgData.length; i += 4, j++) {
    gray[j] = (77 * imgData[i] + 150 * imgData[i + 1] + 29 * imgData[i + 2]) >> 8;
  }
  return detector.processVisible(gray, watchZones, nowMs, imgData);
}

/* =====================================================================
   3. DECISION + SENSOR FUSION + AUDIO
   ===================================================================== */

// Evidence of a leak from the gas sensor, scaled to the gas's alarm setpoints:
// half the low alarm → 0, low alarm → ~0.35, high alarm → 1.
function sensorConfidence(gasId, ppm) {
  const a = CHEMICALS_BY_ID[gasId].alarm;
  return clamp((ppm - 0.5 * a.low) / (a.high - 0.5 * a.low));
}

// Typical clean-air reading shown when no release is simulated
function backgroundPpm(chem) {
  return +(chem.alarm.low * 0.05).toPrecision(2);
}
class DecisionManager {
  constructor() {
    this.sensorMode = 'virtual'; // 'off' | 'virtual' | 'arduino'
    this.gas = 'ammonia';        // gas the sensor is calibrated for (CHEMICALS id)
    this.ppm = 0;
    this.arduinoConnected = false;
    this.audioEnabled = true;
    this.audioCtx = null;

    this.currentState = 'SAFE'; // 'SAFE' | 'WARNING' | 'LEAK'
    this.fusedConfidence = 0;
    this.highReadingTimestamp = performance.now();
    this.deescalateDelayMs = 2000; // 2 seconds hysteresis
    this.alarmPlaying = false;
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  playAlarmBeeps() {
    if (!this.audioEnabled || this.alarmPlaying) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    this.alarmPlaying = true;
    const now = ctx.currentTime;
    // 3 beeps: 880 Hz, tone 150ms, pause 100ms
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * 0.25;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, start);

      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.15);
    }

    setTimeout(() => {
      this.alarmPlaying = false;
    }, 850);
  }

  evaluate(camConf, nowMs) {
    let sensorConf = 0;
    const isSensorOn = this.sensorMode !== 'off';

    if (isSensorOn) {
      sensorConf = sensorConfidence(this.gas, this.ppm);

      // Fusion rules
      let fused = 0.6 * camConf + 0.4 * sensorConf;
      if (camConf >= 0.55 && sensorConf >= 0.55) {
        fused = Math.max(fused, 0.85); // LEAK
      } else if ((camConf >= 0.55 && sensorConf < 0.55) || (sensorConf >= 0.55 && camConf < 0.55)) {
        // Only one >= 0.55 -> clamped to 0.35–0.54 (WARNING)
        fused = clamp(fused, 0.35, 0.54);
      }
      this.fusedConfidence = fused;
    } else {
      this.fusedConfidence = camConf;
    }

    // Determine target state based on thresholds:
    // >=0.55 LEAK DETECTED, >=0.28 WARNING, else SAFE
    let targetState = 'SAFE';
    if (this.fusedConfidence >= 0.55) {
      targetState = 'LEAK';
    } else if (this.fusedConfidence >= 0.28) {
      targetState = 'WARNING';
    }

    const stateRank = { 'SAFE': 0, 'WARNING': 1, 'LEAK': 2 };

    // Escalate immediately; de-escalate only after 2 s of lower readings
    if (stateRank[targetState] >= stateRank[this.currentState]) {
      if (targetState !== this.currentState) {
        if (targetState === 'LEAK') {
          this.playAlarmBeeps();
        }
      }
      this.currentState = targetState;
      this.highReadingTimestamp = nowMs;
    } else {
      // De-escalation condition
      if (nowMs - this.highReadingTimestamp >= this.deescalateDelayMs) {
        this.currentState = targetState;
      }
    }

    return {
      state: this.currentState,
      fusedConfidence: this.fusedConfidence,
      camConf: camConf,
      sensorConf: sensorConf
    };
  }
}

/* =====================================================================
   4. ACCURACY TRACKER
   ===================================================================== */
class AccuracyTracker {
  constructor() {
    this.groundTruth = 'none'; // 'none' | 'leak' | 'noleak'
    this.tp = 0;
    this.fp = 0;
    this.tn = 0;
    this.fn = 0;
    this.secondsTested = 0;
  }

  reset() {
    this.tp = 0;
    this.fp = 0;
    this.tn = 0;
    this.fn = 0;
    this.secondsTested = 0;
  }

  tick(state, isCalibrating) {
    if (this.groundTruth === 'none' || isCalibrating) return;

    this.secondsTested++;
    const predLeak = (state === 'LEAK');

    if (this.groundTruth === 'leak') {
      if (predLeak) this.tp++;
      else this.fn++;
    } else if (this.groundTruth === 'noleak') {
      if (predLeak) this.fp++;
      else this.tn++;
    }
  }

  getMetrics() {
    const total = this.tp + this.fp + this.tn + this.fn;
    const accuracy = total > 0 ? (this.tp + this.tn) / total : null;
    const precision = (this.tp + this.fp) > 0 ? this.tp / (this.tp + this.fp) : null;
    const recall = (this.tp + this.fn) > 0 ? this.tp / (this.tp + this.fn) : null;
    let f1 = null;
    if (precision !== null && recall !== null && (precision + recall) > 0) {
      f1 = (2 * precision * recall) / (precision + recall);
    }

    return {
      accuracy, precision, recall, f1,
      tp: this.tp, fp: this.fp, tn: this.tn, fn: this.fn,
      duration: this.secondsTested
    };
  }
}

/* =====================================================================
   5. MAIN APPLICATION CONTROLLER
   ===================================================================== */
class GasVisionApp {
  constructor(telemetry) {
    this.telemetry = telemetry;
    this.currentIncident = null;
    this.lastDetection = null;
    this.referenceCanvas = null;
    this.referenceSourceKey = null;

    this.displayCanvas = document.getElementById('displayCanvas');
    this.displayCtx = this.displayCanvas.getContext('2d');
    this.sparklineCanvas = document.getElementById('sparklineCanvas');
    this.sparklineCtx = this.sparklineCanvas.getContext('2d');

    // Offscreen 160x120 canvas for image processing & thumbnail captures
    this.offCanvas = document.createElement('canvas');
    this.offCanvas.width = 160;
    this.offCanvas.height = 120;
    this.offCtx = this.offCanvas.getContext('2d', { willReadFrequently: true });

    // Core systems
    this.sources = {
      'sim-rgb': new SimulatedSceneSource(),
      'sim-thermal': new SimulatedThermalSource(),
      'webcam': new WebcamSource(),
      'video-file': new VideoFileSource()
    };
    this.currentSourceKey = 'sim-rgb';
    this.currentSource = this.sources[this.currentSourceKey];

    this.detector = new Detector();
    this.decision = new DecisionManager();
    this.accuracy = new AccuracyTracker();
    this.o2Monitor = null;

    // State
    this.isRunning = false;
    this.viewMode = 'normal'; // 'normal' | 'thermal' | 'heatmap'
    this.watchZones = []; // Array of {x0, y0, x1, y1} normalized
    this.drawingZone = false;
    this.zoneStart = null;
    this.mousePos = { x: 0, y: 0, onCanvas: false };

    // Performance & loop timing (~15 fps)
    this.lastFrameTime = 0;
    this.fpsCounter = 0;
    this.fpsTimer = performance.now();
    this.currentFps = 15;

    // Sparkline history (60 seconds, 1 sample per second = 60 samples)
    this.sparklineHistory = new Array(60).fill(0);
    this.lastSparklineTick = performance.now();

    this.initUI();
    this.bindEvents();
    this.renderInitialState();
  }

  initUI() {
    this.elStatusBand = document.getElementById('statusBand');
    this.elStatusHeading = document.getElementById('statusHeading');
    this.elStatusSubtext = document.getElementById('statusSubtext');
    this.elStatusConfidence = document.getElementById('statusConfidence');
    this.elStatusAssessBtn = document.getElementById('statusAssessBtn');

    this.elToggleMonitorBtn = document.getElementById('toggleMonitorBtn');
    this.elSourceSelect = document.getElementById('cameraSourceSelect');
    this.elCalibrationOverlay = document.getElementById('calibrationOverlay');
    this.elCalibrationText = document.getElementById('calibrationText');
    this.elCameraErrorOverlay = document.getElementById('cameraErrorOverlay');

    this.elTileArea = document.getElementById('tileArea');
    this.elTileHaze = document.getElementById('tileHaze');
    this.elTileShift = document.getElementById('tileShift');
    this.elTileShiftLabel = document.getElementById('tileShiftLabel');
    this.elTileFps = document.getElementById('tileFps');

    this.elSensorPpmVal = document.getElementById('sensorPpmVal');
    this.elSensorConfVal = document.getElementById('sensorConfVal');
    this.elSensorBarFill = document.getElementById('sensorBarFill');
    this.elSensorStatusBadge = document.getElementById('sensorStatusBadge');
    this.elVirtualSensorSlider = document.getElementById('virtualSensorSlider');
    this.elVirtualSensorWrap = document.getElementById('virtualSensorWrap');
    this.elArduinoSerialWrap = document.getElementById('arduinoSerialWrap');
    this.elSensorModeSelect = document.getElementById('sensorModeSelect');

    this.elSimControls = document.getElementById('simControlsGroup');
    this.elSimChemicalSelect = document.getElementById('simChemicalSelect');
    this.elSimLeakSize = document.getElementById('simLeakSize');
    this.elLightingBtn = document.getElementById('lightingBtn');
    this.elSensorGasSelect = document.getElementById('sensorGasSelect');
    this.elSensorScale = document.getElementById('sensorScale');
    this.elSensorBasis = document.getElementById('sensorBasis');
    this.elToggleLeakBtn = document.getElementById('toggleLeakBtn');
    this.elWalkPersonBtn = document.getElementById('walkPersonBtn');
    this.elAlertList = document.getElementById('alertList');
    this.elAlertCount = document.getElementById('alertCount');

    // Accuracy elements
    this.elStatAccuracy = document.getElementById('statAccuracy');
    this.elStatPrecision = document.getElementById('statPrecision');
    this.elStatRecall = document.getElementById('statRecall');
    this.elStatF1 = document.getElementById('statF1');
    this.elValTP = document.getElementById('valTP');
    this.elValFP = document.getElementById('valFP');
    this.elValTN = document.getElementById('valTN');
    this.elValFN = document.getElementById('valFN');
    this.elValDuration = document.getElementById('valDuration');
  }

  bindEvents() {
    // Source switch
    this.elSourceSelect.addEventListener('change', (e) => this.switchSource(e.target.value));

    // Start / Stop monitoring
    this.elToggleMonitorBtn.addEventListener('click', () => this.toggleMonitoring());

    // View toggle buttons
    document.querySelectorAll('#viewModeControl .segmented-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#viewModeControl .segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.viewMode = btn.getAttribute('data-view');
      });
    });

    // Watch zone buttons
    const drawBtn = document.getElementById('drawZoneBtn');
    drawBtn.addEventListener('click', () => {
      this.drawingZone = !this.drawingZone;
      this.displayCanvas.classList.toggle('drawing-zone', this.drawingZone);
      drawBtn.classList.toggle('btn-primary', this.drawingZone);
      drawBtn.classList.toggle('btn-secondary', !this.drawingZone);
    });

    document.getElementById('clearZonesBtn').addEventListener('click', () => {
      this.watchZones = [];
      this.updateStatusText();
    });

    document.getElementById('recalibrateBtn').addEventListener('click', () => {
      this.detector.reset();
    });

    // Sim controls
    this.elToggleLeakBtn.addEventListener('click', () => {
      const sim = this.currentSource;
      if (sim && sim.sim) {
        sim.leakActive = !sim.leakActive;
        this.syncSimControls();
      }
    });

    // Simulated release chemical: plume colour, thermal signature and sensor gas
    this.elSimChemicalSelect.innerHTML = CHEMICALS.map(c => {
      const look = { 'white-cloud': 'white cloud', 'yellow-green': 'yellow-green cloud', 'red-brown': 'brown cloud', invisible: 'invisible' }[c.visual];
      return `<option value="${c.id}">${c.name} (${look})</option>`;
    }).join('');
    this.elSimChemicalSelect.value = this.sources['sim-rgb'].chemical;
    this.elSimChemicalSelect.addEventListener('change', (e) => {
      this.sources['sim-rgb'].chemical = e.target.value;
      this.sources['sim-thermal'].chemical = e.target.value;
      this.elSensorGasSelect.value = e.target.value;
      this.setSensorGas(e.target.value);
    });

    this.elSimLeakSize.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value);
      this.sources['sim-rgb'].leakRate = rate;
      this.sources['sim-thermal'].leakRate = rate;
      this.syncSimControls();
    });

    this.elLightingBtn.addEventListener('click', () => {
      const sim = this.currentSource;
      if (sim && sim.sim) sim.toggleLighting();
    });

    this.elWalkPersonBtn.addEventListener('click', () => {
      const sim = this.currentSource;
      if (sim && sim.sim) {
        sim.triggerWalker();
      }
    });

    // Video file input
    const fileInput = document.getElementById('videoFileInput');
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.sources['video-file'].load(e.target.files[0]);
      }
    });

    // Retry & fallback webcam buttons
    document.getElementById('retryCameraBtn').addEventListener('click', () => {
      this.switchSource('webcam');
    });
    document.getElementById('fallbackSimBtn').addEventListener('click', () => {
      this.elSourceSelect.value = 'sim-rgb';
      this.switchSource('sim-rgb');
    });

    // Settings sliders
    const sliderSens = document.getElementById('sliderSensitivity');
    const valSens = document.getElementById('valSensitivity');
    sliderSens.addEventListener('input', (e) => {
      this.detector.sensitivity = parseFloat(e.target.value);
      valSens.textContent = e.target.value;
    });

    const sliderPers = document.getElementById('sliderPersistence');
    const valPers = document.getElementById('valPersistence');
    sliderPers.addEventListener('input', (e) => {
      this.detector.persistSeconds = parseFloat(e.target.value);
      valPers.textContent = `${e.target.value} s`;
    });

    const sliderCold = document.getElementById('sliderColdThresh');
    const valCold = document.getElementById('valColdThresh');
    sliderCold.addEventListener('input', (e) => {
      this.detector.coldThreshold = parseFloat(e.target.value);
      valCold.textContent = `${parseFloat(e.target.value).toFixed(1)} °C`;
    });

    const alarmSoundToggle = document.getElementById('alarmSoundToggle');
    alarmSoundToggle.addEventListener('change', (e) => {
      this.decision.audioEnabled = e.target.checked;
    });

    // Sensor mode select
    this.elSensorModeSelect.addEventListener('change', (e) => {
      this.decision.sensorMode = e.target.value;
      this.elVirtualSensorWrap.hidden = (this.decision.sensorMode !== 'virtual');
      this.elArduinoSerialWrap.hidden = (this.decision.sensorMode !== 'arduino');

      if (this.decision.sensorMode === 'off') {
        this.elSensorStatusBadge.textContent = 'Off';
        this.elSensorStatusBadge.style.background = 'var(--bg)';
        this.elSensorStatusBadge.style.color = 'var(--muted)';
      } else {
        this.elSensorStatusBadge.textContent = 'Active';
        this.elSensorStatusBadge.style.background = 'var(--safe-bg)';
        this.elSensorStatusBadge.style.color = 'var(--safe)';
      }
    });

    // Target gas the sensor is calibrated for
    this.elSensorGasSelect.innerHTML = CHEMICALS.map(c => `<option value="${c.id}">${c.name} (${c.formula})</option>`).join('');
    this.elSensorGasSelect.value = this.decision.gas;
    this.elSensorGasSelect.addEventListener('change', (e) => this.setSensorGas(e.target.value));

    // Virtual sensor slider
    this.elVirtualSensorSlider.addEventListener('input', (e) => {
      this.updateVirtualSensor(parseFloat(e.target.value));
    });

    // Arduino Web Serial Connect
    document.getElementById('connectSerialBtn').addEventListener('click', () => {
      this.connectArduinoSerial();
    });

    // Alert log clear
    const clearBtn = document.getElementById('clearAlertsBtn');
    clearBtn.addEventListener('click', () => {
      confirmClick(clearBtn, 'Clear all history?', () => {
        this.currentIncident = null;
        this.telemetry.clear();
      });
    });

    // Alert log → Hazard Scanner
    this.elAlertList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-assess-incident]');
      if (btn) window.gasVisionRouter.go('hazard', { incidentId: btn.dataset.assessIncident });
    });

    // Accuracy ground truth radios
    document.querySelectorAll('input[name="groundTruth"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.accuracy.groundTruth = e.target.value;
      });
    });

    document.getElementById('resetAccuracyBtn').addEventListener('click', () => {
      this.accuracy.reset();
      this.renderAccuracy();
    });

    // Canvas interactive mouse tracking & watch zone drawing
    this.displayCanvas.addEventListener('mousedown', (e) => {
      if (!this.drawingZone) return;
      const rect = this.displayCanvas.getBoundingClientRect();
      this.zoneStart = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height
      };
    });

    this.displayCanvas.addEventListener('mousemove', (e) => {
      const rect = this.displayCanvas.getBoundingClientRect();
      this.mousePos.x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      this.mousePos.y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      this.mousePos.onCanvas = true;
    });

    this.displayCanvas.addEventListener('mouseleave', () => {
      this.mousePos.onCanvas = false;
    });

    this.displayCanvas.addEventListener('mouseup', (e) => {
      if (!this.drawingZone || !this.zoneStart) return;
      const rect = this.displayCanvas.getBoundingClientRect();
      const curX = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const curY = clamp((e.clientY - rect.top) / rect.height, 0, 1);

      const x0 = Math.min(this.zoneStart.x, curX);
      const x1 = Math.max(this.zoneStart.x, curX);
      const y0 = Math.min(this.zoneStart.y, curY);
      const y1 = Math.max(this.zoneStart.y, curY);

      // If box is large enough (>2% of screen)
      if ((x1 - x0) > 0.02 && (y1 - y0) > 0.02) {
        this.watchZones.push({ x0, y0, x1, y1 });
      }

      this.drawingZone = false;
      this.zoneStart = null;
      this.displayCanvas.classList.remove('drawing-zone');
      drawBtn.classList.remove('btn-primary');
      drawBtn.classList.add('btn-secondary');
      this.updateStatusText();
    });

    // 1-second interval timer for Accuracy Benchmark & Sparkline tick
    setInterval(() => {
      if (this.isRunning) {
        this.accuracy.tick(this.decision.currentState, this.detector.isCalibrating);
        this.renderAccuracy();
      }
    }, 1000);
  }

  updateVirtualSensor(ppm) {
    const alarm = CHEMICALS_BY_ID[this.decision.gas].alarm;
    this.decision.ppm = ppm;
    this.elVirtualSensorSlider.value = ppm;
    this.elSensorPpmVal.textContent = ppm >= 100 ? Math.round(ppm).toLocaleString() : +ppm.toFixed(2);
    const sensorConf = sensorConfidence(this.decision.gas, ppm);
    this.elSensorConfVal.textContent = `Conf: ${Math.round(sensorConf * 100)}%`;
    this.elSensorBarFill.style.width = `${Math.min(100, (ppm / alarm.max) * 100)}%`;
    if (this.o2Monitor) this.o2Monitor.setFromGasPPM(ppm);
  }

  // Re-scale the sensor slider and alarm levels for the selected gas
  setSensorGas(gasId) {
    const chem = CHEMICALS_BY_ID[gasId];
    this.decision.gas = gasId;
    const a = chem.alarm;
    this.elVirtualSensorSlider.max = a.max;
    this.elVirtualSensorSlider.step = a.max / 400;
    this.elSensorScale.innerHTML = `<span>0</span><span>Low alarm ${a.low.toLocaleString()}</span><span>High ${a.high.toLocaleString()}</span><span>${a.max.toLocaleString()} ppm</span>`;
    this.elSensorBasis.textContent = `${chem.name} alarm setpoints: ${a.basis}.`;
    const leaking = this.currentSource && this.currentSource.sim && this.currentSource.leakActive;
    this.updateVirtualSensor(leaking ? a.simLeak : backgroundPpm(chem));
  }

  // Keep leak button and virtual sensor consistent with the active simulator
  syncSimControls() {
    const sim = this.currentSource;
    const leaking = !!(sim && sim.leakActive);
    this.elToggleLeakBtn.textContent = leaking ? 'Stop leak' : 'Start leak';
    this.elToggleLeakBtn.classList.toggle('btn-secondary', leaking);
    this.elToggleLeakBtn.classList.toggle('btn-danger', !leaking);
    if (sim && sim.sim && this.decision.sensorMode === 'virtual') {
      const chem = CHEMICALS_BY_ID[this.decision.gas];
      this.updateVirtualSensor(leaking ? +(chem.alarm.simLeak * (0.4 + 0.6 * sim.leakRate)).toPrecision(3) : backgroundPpm(chem));
    }
  }

  async connectArduinoSerial() {
    if (!('serial' in navigator)) {
      document.getElementById('connectSerialBtn').textContent = 'Web Serial not available here (use Chrome or Edge)';
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      this.decision.arduinoConnected = true;
      document.getElementById('connectSerialBtn').textContent = 'Arduino Connected (9600 Baud)';
      document.getElementById('connectSerialBtn').classList.remove('btn-secondary');
      document.getElementById('connectSerialBtn').classList.add('btn-primary');

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      let buffer = '';
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const rawNum = parseFloat(line.trim());
            if (!isNaN(rawNum)) {
              // Uncalibrated demo mapping (0–1023 ADC → 0–2046). Real MQ sensors
              // need an Rs/R0 log-curve calibration against a reference gas.
              const calculatedPpm = Math.round(rawNum * 2);
              this.updateVirtualSensor(calculatedPpm);
            }
          }
        }
      })().catch(err => console.error('Serial read error:', err));
    } catch (err) {
      console.warn('Arduino serial error:', err);
      document.getElementById('connectSerialBtn').textContent = `Could not connect: ${err.message}`;
    }
  }

  async switchSource(key) {
    if (this.currentSource) {
      this.currentSource.stop();
    }

    this.currentSourceKey = key;
    this.currentSource = this.sources[key];
    this.detector.reset();

    // Update UI controls visibility
    this.elSimControls.hidden = !this.currentSource.sim;
    this.syncSimControls();
    this.elCameraErrorOverlay.hidden = true;

    if (key === 'video-file') {
      document.getElementById('videoFileInput').click();
    }

    if (this.isRunning) {
      const ok = await this.currentSource.start();
      if (!ok && key === 'webcam') {
        this.elCameraErrorOverlay.hidden = false;
      }
    }

    this.updateStatusText();
  }

  async toggleMonitoring() {
    if (this.isRunning) {
      // Stop monitoring
      this.isRunning = false;
      this.currentSource.stop();
      if (this.currentIncident) {
        this.telemetry.updateIncident(this.currentIncident.id, { end: Date.now() });
        this.currentIncident = null;
      }
      this.elToggleMonitorBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <span>Start monitoring</span>
      `;
      this.elToggleMonitorBtn.classList.remove('btn-danger');
      this.elToggleMonitorBtn.classList.add('btn-primary');
      this.elCalibrationOverlay.hidden = true;
    } else {
      // Start monitoring
      this.isRunning = true;
      this.detector.reset();
      const ok = await this.currentSource.start();
      if (!ok && this.currentSourceKey === 'webcam') {
        this.elCameraErrorOverlay.hidden = false;
      }

      this.elToggleMonitorBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
        <span>Stop monitoring</span>
      `;
      this.elToggleMonitorBtn.classList.remove('btn-primary');
      this.elToggleMonitorBtn.classList.add('btn-danger');

      this.lastFrameTime = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  loop(now) {
    if (!this.isRunning) return;

    // Skip rAF frames closer than 66 ms (~15 fps)
    const elapsed = now - this.lastFrameTime;
    if (elapsed < 66) {
      requestAnimationFrame((t) => this.loop(t));
      return;
    }
    this.lastFrameTime = now;

    // Calculate FPS
    this.fpsCounter++;
    if (now - this.fpsTimer >= 1000) {
      this.currentFps = this.fpsCounter;
      this.fpsCounter = 0;
      this.fpsTimer = now;
      this.elTileFps.textContent = `${this.currentFps} fps`;
    }

    // 1. Advance camera source
    this.currentSource.step();

    // 2. Extract frame buffer & process detection
    const wasCalibrating = this.detector.isCalibrating;
    const detectionResult = processSourceFrame(this.detector, this.currentSource, this.offCtx, this.watchZones, now);
    this.lastDetection = detectionResult;

    // Keep a colour reference frame of the clean scene for the Hazard Scanner
    if (wasCalibrating && !this.detector.isCalibrating) {
      this.captureReferenceFrame();
    }

    // 3. Calibration overlay
    if (detectionResult.calibrating) {
      this.elCalibrationOverlay.hidden = false;
      this.elCalibrationText.textContent = `Calibrating baseline... ${detectionResult.remainingCalib} s`;
    } else {
      this.elCalibrationOverlay.hidden = true;
    }

    // 4. Evaluate decision & sensor fusion
    const previousState = this.decision.currentState;
    const evalResult = this.decision.evaluate(detectionResult.confidence, now);

    // 5. Incident lifecycle + shared telemetry
    this.trackIncident(previousState, evalResult, detectionResult);
    this.telemetry.record({
      t: Date.now(),
      ppm: this.decision.sensorMode !== 'off' ? this.decision.ppm : null,
      gas: this.decision.gas,
      o2: this.o2Monitor ? this.o2Monitor.o2Percent : 20.9,
      conf: evalResult.fusedConfidence,
      cam: detectionResult.confidence,
      state: evalResult.state,
      src: this.currentSource.label
    });

    // 6. Update Status Band & Sparkline
    this.updateStatusBand(evalResult, detectionResult);

    if (now - this.lastSparklineTick >= 1000) {
      this.lastSparklineTick = now;
      this.sparklineHistory.shift();
      this.sparklineHistory.push(evalResult.fusedConfidence);
      this.renderSparkline(evalResult.state);
    }

    // 7. Update Telemetry Tiles
    this.updateTelemetryTiles();

    // 8. Render 640x480 Display Canvas
    this.renderDisplay(detectionResult);

    requestAnimationFrame((t) => this.loop(t));
  }

  updateStatusBand(evalResult, detectionResult) {
    const state = evalResult.state;
    const confPct = Math.round(evalResult.fusedConfidence * 100);

    this.elStatusBand.className = `status-band state-${state.toLowerCase()}`;
    this.elStatusAssessBtn.hidden = state === 'SAFE';
    this.elStatusHeading.textContent = (state === 'LEAK') ? 'LEAK DETECTED' : state;
    this.elStatusConfidence.textContent = `${confPct}%`;

    // Status Subtext Rules
    if (detectionResult.calibrating) {
      this.elStatusSubtext.textContent = `Calibrating baseline... ${detectionResult.remainingCalib} s remaining`;
    } else if (detectionResult.sceneChanged) {
      this.elStatusSubtext.textContent = 'Scene changed suddenly… Relearning baseline';
    } else if (state === 'LEAK' && evalResult.camConf >= 0.55 && evalResult.sensorConf >= 0.55) {
      this.elStatusSubtext.textContent = 'Camera and gas sensor both indicate a leak. Evacuate and isolate the valve.';
    } else if ((state === 'LEAK' || state === 'WARNING') && this.currentSource.kind === 'thermal') {
      this.elStatusSubtext.textContent = 'Persistent cold plume at the valve: typical of escaping pressurised gas.';
    } else if ((state === 'WARNING' || state === 'LEAK') && this.decision.sensorMode !== 'off' && evalResult.sensorConf >= 0.55 && evalResult.camConf < 0.28) {
      this.elStatusSubtext.textContent = 'Gas sensor is high but the camera sees no plume. Check the area.';
    } else {
      this.updateStatusText();
    }
  }

  updateStatusText() {
    const zoneCount = this.watchZones.length;
    const zoneText = zoneCount === 0 ? 'Full frame' : `${zoneCount} watch zone${zoneCount > 1 ? 's' : ''}`;
    this.elStatusSubtext.textContent = `Monitoring ${this.currentSource.label} · ${zoneText}`;
  }

  updateTelemetryTiles() {
    const t = this.detector.telemetry;
    this.elTileArea.textContent = `${t.changedAreaPct}%`;
    this.elTileHaze.textContent = `${t.hazePct}%`;

    if (t.isThermal) {
      this.elTileShiftLabel.textContent = 'Avg. temp drop';
      this.elTileShift.textContent = `${t.shiftVal} °C`;
    } else {
      this.elTileShiftLabel.textContent = 'Brightness shift';
      this.elTileShift.textContent = `${t.shiftVal}%`;
    }
  }

  renderDisplay(detectionResult) {
    const ctx = this.displayCtx;
    const width = 640;
    const height = 480;

    ctx.clearRect(0, 0, width, height);

    // Render Source Feed
    if (this.currentSource.kind === 'rgb') {
      if (this.viewMode === 'normal') {
        if (this.currentSource.ready()) {
          ctx.drawImage(this.currentSource.drawable(), 0, 0, width, height);
        }
      } else if (this.viewMode === 'thermal') {
        // Pseudo-thermal: grayscale -> Inferno LUT
        const gray = this.detector.grayCur;
        const imgData = ctx.createImageData(160, 120);
        const d = imgData.data;
        for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
          const lutIdx = gray[i] * 3;
          d[j]     = INFERNO_LUT[lutIdx];
          d[j + 1] = INFERNO_LUT[lutIdx + 1];
          d[j + 2] = INFERNO_LUT[lutIdx + 2];
          d[j + 3] = 255;
        }
        this.offCtx.putImageData(imgData, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.offCanvas, 0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
      } else if (this.viewMode === 'heatmap') {
        if (this.currentSource.ready()) {
          ctx.drawImage(this.currentSource.drawable(), 0, 0, width, height);
        }
        this.renderRiskHeatmapOverlay(ctx);
      }
    } else if (this.currentSource.kind === 'thermal') {
      // Real thermal: 15–50 °C -> Inferno LUT
      const temps = this.currentSource.temps;
      const imgData = ctx.createImageData(160, 120);
      const d = imgData.data;

      for (let i = 0, j = 0; i < temps.length; i++, j += 4) {
        const t = temps[i];
        const norm = clamp((t - 15.0) / (50.0 - 15.0));
        const lutIdx = Math.round(norm * 255) * 3;
        d[j]     = INFERNO_LUT[lutIdx];
        d[j + 1] = INFERNO_LUT[lutIdx + 1];
        d[j + 2] = INFERNO_LUT[lutIdx + 2];
        d[j + 3] = 255;
      }

      this.offCtx.putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.offCanvas, 0, 0, width, height);
      ctx.imageSmoothingEnabled = true;

      if (this.viewMode === 'heatmap') {
        this.renderRiskHeatmapOverlay(ctx);
      }
    }

    // Render Watch Zones (dashed light-blue)
    if (this.watchZones.length > 0) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);

      for (let i = 0; i < this.watchZones.length; i++) {
        const z = this.watchZones[i];
        const zx = z.x0 * width;
        const zy = z.y0 * height;
        const zw = (z.x1 - z.x0) * width;
        const zh = (z.y1 - z.y0) * height;
        ctx.strokeRect(zx, zy, zw, zh);

        ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.fillRect(zx, zy, 70, 18);
        ctx.fillStyle = '#0B131E';
        ctx.font = '600 10px IBM Plex Sans, sans-serif';
        ctx.fillText(`ZONE ${i + 1}`, zx + 6, zy + 13);
      }
      ctx.setLineDash([]);
    }

    // Render Active Drawing Zone Preview
    if (this.drawingZone && this.zoneStart && this.mousePos.onCanvas) {
      const x0 = Math.min(this.zoneStart.x, this.mousePos.x) * width;
      const y0 = Math.min(this.zoneStart.y, this.mousePos.y) * height;
      const w = Math.abs(this.mousePos.x - this.zoneStart.x) * width;
      const h = Math.abs(this.mousePos.y - this.zoneStart.y) * height;

      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x0, y0, w, h);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.fillRect(x0, y0, w, h);
      ctx.setLineDash([]);
    }

    // Render Detection Boxes
    if (detectionResult.boxes && detectionResult.boxes.length > 0) {
      for (const box of detectionResult.boxes) {
        const bx = box.minCx * 40;
        const by = box.minCy * 40;
        const bw = (box.maxCx - box.minCx + 1) * 40;
        const bh = (box.maxCy - box.minCy + 1) * 40;

        const isHigh = box.conf >= 0.55;
        const strokeColor = isHigh ? '#D0342C' : '#D48A06';

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.strokeRect(bx, by, bw, bh);

        // Label tag
        const labelText = `${this.currentSource.kind === 'thermal' ? 'Cold plume' : 'Vapour'} ${Math.round(box.conf * 100)}%`;
        ctx.font = '600 11px IBM Plex Mono, monospace';
        const textWidth = ctx.measureText(labelText).width;
        const tagW = textWidth + 14;
        const tagH = 20;
        const tagY = by >= tagH + 4 ? by - tagH - 2 : by + 4;

        ctx.fillStyle = strokeColor;
        ctx.fillRect(bx, tagY, tagW, tagH);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(labelText, bx + 6, tagY + 14);
      }
    }

    // Top-Right HUD Badge
    this.renderHUD(ctx, width);
  }

  renderRiskHeatmapOverlay(ctx) {
    const cellW = 640 / 16;
    const cellH = 480 / 12;

    for (let cy = 0; cy < 12; cy++) {
      for (let cx = 0; cx < 16; cx++) {
        const c = cy * 16 + cx;
        const s = this.detector.score[c];
        if (s > 0.15) {
          const alpha = Math.min(0.6, s * 0.8);
          ctx.fillStyle = `rgba(208, 52, 44, ${alpha})`;
          ctx.fillRect(cx * cellW, cy * cellH, cellW, cellH);
        }
      }
    }
  }

  renderHUD(ctx, canvasWidth) {
    let cursorInfo = 'Cursor: --';
    if (this.mousePos.onCanvas) {
      const col = Math.floor(this.mousePos.x * 160);
      const row = Math.floor(this.mousePos.y * 120);
      const idx = row * 160 + col;

      if (this.currentSource.kind === 'thermal') {
        const t = this.currentSource.temps[idx];
        if (t !== undefined) cursorInfo = `Cursor: ${t.toFixed(1)} °C`;
      } else {
        const g = this.detector.grayCur[idx];
        if (g !== undefined) cursorInfo = `Cursor: ${g} px`;
      }
    }

    let hudText = `${this.currentSource.label} · ${this.currentFps} fps`;
    if (this.currentSource.kind === 'thermal' && !this.detector.isCalibrating) {
      hudText += ` · min ${this.detector.telemetry.minT}°C / max ${this.detector.telemetry.maxT}°C`;
    }
    hudText += ` · ${cursorInfo}`;

    ctx.font = '500 11px IBM Plex Mono, monospace';
    const w = ctx.measureText(hudText).width + 20;
    const h = 24;
    const x = canvasWidth - w - 10;
    const y = 10;

    ctx.fillStyle = 'rgba(12, 19, 29, 0.75)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(hudText, x + 10, y + 16);
  }

  renderSparkline(state) {
    const ctx = this.sparklineCtx;
    const w = this.sparklineCanvas.width;
    const h = this.sparklineCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dashed horizontal threshold lines at 0.28 and 0.55
    const yWarn = h - 0.28 * h;
    const yLeak = h - 0.55 * h;

    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Warning line (amber)
    ctx.strokeStyle = 'rgba(212, 138, 6, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, yWarn);
    ctx.lineTo(w, yWarn);
    ctx.stroke();

    // Leak line (red)
    ctx.strokeStyle = 'rgba(208, 52, 44, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, yLeak);
    ctx.lineTo(w, yLeak);
    ctx.stroke();

    ctx.setLineDash([]);

    // Plot history line
    const data = this.sparklineHistory;
    const step = w / (data.length - 1);

    const strokeColor = (state === 'LEAK') ? '#D0342C' : (state === 'WARNING') ? '#D48A06' : '#1E8E5A';

    // Gradient under fill
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    if (state === 'LEAK') {
      fillGrad.addColorStop(0, 'rgba(208, 52, 44, 0.3)');
      fillGrad.addColorStop(1, 'rgba(208, 52, 44, 0.0)');
    } else if (state === 'WARNING') {
      fillGrad.addColorStop(0, 'rgba(212, 138, 6, 0.25)');
      fillGrad.addColorStop(1, 'rgba(212, 138, 6, 0.0)');
    } else {
      fillGrad.addColorStop(0, 'rgba(30, 142, 90, 0.2)');
      fillGrad.addColorStop(1, 'rgba(30, 142, 90, 0.0)');
    }

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < data.length; i++) {
      const px = i * step;
      const py = h - data[i] * h;
      if (i === 0) ctx.lineTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Curve stroke
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const px = i * step;
      const py = h - data[i] * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Opens an incident on escalation to LEAK, keeps its peaks updated, and
  // closes it once the system has de-escalated back to SAFE.
  trackIncident(previousState, evalResult, detectionResult) {
    const state = evalResult.state;
    const inc = this.currentIncident;

    if (!inc && previousState !== 'LEAK' && state === 'LEAK') {
      this.currentIncident = this.telemetry.openIncident({
        start: Date.now(),
        lastSeen: Date.now(),
        maxState: 'LEAK',
        peakConf: evalResult.fusedConfidence,
        peakPpm: this.decision.sensorMode !== 'off' ? this.decision.ppm : null,
        gas: this.decision.sensorMode !== 'off' ? this.decision.gas : null,
        minO2: this.o2Monitor ? this.o2Monitor.o2Percent : 20.9,
        source: this.currentSource.label,
        zones: this.zonesForBoxes(detectionResult.boxes),
        thumb: this.snapshotDataUrl(320, 240, 0.8)
      });
      return;
    }

    if (inc) {
      const now = Date.now();
      if (state === 'SAFE') {
        this.telemetry.updateIncident(inc.id, { end: now });
        this.currentIncident = null;
        return;
      }
      // Throttle store updates to twice a second
      if (now - inc.lastSeen >= 500) {
        const zones = new Set([...(inc.zones || []), ...this.zonesForBoxes(detectionResult.boxes)]);
        if (zones.size > 1) zones.delete('Full frame');
        this.telemetry.updateIncident(inc.id, {
          lastSeen: now,
          peakConf: Math.max(inc.peakConf, evalResult.fusedConfidence),
          peakPpm: this.decision.sensorMode !== 'off' ? Math.max(inc.peakPpm ?? 0, this.decision.ppm) : inc.peakPpm,
          minO2: Math.min(inc.minO2, this.o2Monitor ? this.o2Monitor.o2Percent : 20.9),
          zones: [...zones]
        });
      }
    }
  }

  // Names of the watch zones that contain detection boxes
  zonesForBoxes(boxes) {
    if (!boxes || boxes.length === 0) return [];
    if (this.watchZones.length === 0) return ['Full frame'];
    const names = new Set();
    for (const b of boxes) {
      const cx = ((b.minCx + b.maxCx + 1) / 2) / 16;
      const cy = ((b.minCy + b.maxCy + 1) / 2) / 12;
      this.watchZones.forEach((z, i) => {
        if (cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1) names.add(`Zone ${i + 1}`);
      });
    }
    return [...names];
  }

  // JPEG of what the operator sees (with detection boxes)
  snapshotDataUrl(w, h, quality) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(this.displayCanvas, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  }

  captureReferenceFrame() {
    if (this.currentSource.kind !== 'rgb' || !this.currentSource.ready()) {
      this.referenceCanvas = null;
      return;
    }
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const src = this.currentSource.referenceDrawable ? this.currentSource.referenceDrawable() : this.currentSource.drawable();
    c.getContext('2d').drawImage(src, 0, 0, 320, 240);
    this.referenceCanvas = c;
    this.referenceSourceKey = this.currentSourceKey;
  }

  /*
    Everything the Hazard Scanner needs to analyse the current scene.
    Image is the raw camera frame (no overlays) for RGB sources, or the
    false-colour thermal render for thermal sources.
  */
  getHazardSnapshot() {
    const src = this.currentSource;
    const image = document.createElement('canvas');
    image.width = 320;
    image.height = 240;
    const ictx = image.getContext('2d');
    if (src.kind === 'rgb' && src.ready()) {
      ictx.drawImage(src.drawable(), 0, 0, 320, 240);
    } else {
      ictx.drawImage(this.displayCanvas, 0, 0, 320, 240);
    }

    const boxes = (this.lastDetection?.boxes || []).map(b => ({
      x0: b.minCx / 16, y0: b.minCy / 12, x1: (b.maxCx + 1) / 16, y1: (b.maxCy + 1) / 12, conf: b.conf
    }));

    const latestIncident = this.currentIncident || this.telemetry.incidents[0] || null;
    return {
      image,
      reference: (src.kind === 'rgb' && this.referenceSourceKey === this.currentSourceKey) ? this.referenceCanvas : null,
      boxes,
      kind: src.kind,
      sim: src.sim,
      sourceLabel: src.label,
      running: this.isRunning,
      state: this.decision.currentState,
      sensor: this.decision.sensorMode !== 'off' ? { gas: this.decision.gas, ppm: this.decision.ppm } : null,
      thermal: src.kind === 'thermal' && this.isRunning && !this.detector.isCalibrating ? {
        minT: parseFloat(this.detector.telemetry.minT),
        avgDrop: parseFloat(this.detector.telemetry.shiftVal)
      } : null,
      incidentId: latestIncident ? latestIncident.id : null,
      time: Date.now()
    };
  }

  renderAlerts() {
    const incidents = this.telemetry.incidents.slice(0, 25);
    this.elAlertCount.textContent = this.telemetry.incidents.length;
    if (incidents.length === 0) {
      this.elAlertList.innerHTML = '<div class="empty-log">No incident events recorded yet.</div>';
      return;
    }

    this.elAlertList.innerHTML = incidents.map(a => {
      const chem = a.gas ? CHEMICALS_BY_ID[a.gas] : null;
      const ppmStr = a.peakPpm !== null && a.peakPpm !== undefined && chem ? `${formatPpm(a.peakPpm)} ${chem.formula}` : 'Sensor off';
      const threat = a.assessment ? `<span class="threat-chip threat-${a.assessment.threat.toLowerCase()}">${a.assessment.threat}</span>` : '';
      return `
      <div class="alert-item">
        ${a.thumb ? `<img src="${a.thumb}" class="alert-thumb" alt="Alert snapshot">` : '<div class="alert-thumb alert-thumb-empty">—</div>'}
        <div class="alert-meta">
          <div class="alert-meta-top">
            <span class="alert-time">${new Date(a.start).toLocaleTimeString()}${a.end ? '' : ' · ongoing'}</span>
            <span class="alert-conf">${a.maxState} ${Math.round(a.peakConf * 100)}%</span>
          </div>
          <div class="alert-details">
            ${escapeHtml(a.source)} &middot; ${ppmStr} &middot; ${escapeHtml((a.zones || []).join(', ') || 'Full frame')}
          </div>
          <div class="alert-actions">
            ${threat}
            <button class="btn btn-secondary btn-xs" data-assess-incident="${a.id}">Assess hazard →</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  renderAccuracy() {
    const m = this.accuracy.getMetrics();
    this.elStatAccuracy.textContent = m.accuracy !== null ? `${Math.round(m.accuracy * 100)}%` : '–';
    this.elStatPrecision.textContent = m.precision !== null ? `${Math.round(m.precision * 100)}%` : '–';
    this.elStatRecall.textContent = m.recall !== null ? `${Math.round(m.recall * 100)}%` : '–';
    this.elStatF1.textContent = m.f1 !== null ? `${Math.round(m.f1 * 100)}%` : '–';

    this.elValTP.textContent = m.tp;
    this.elValFP.textContent = m.fp;
    this.elValTN.textContent = m.tn;
    this.elValFN.textContent = m.fn;
    this.elValDuration.textContent = `${m.duration} s`;
  }

  renderInitialState() {
    // Draw demo canvas initial state
    this.currentSource.step();
    this.renderDisplay({ confidence: 0, boxes: [], calibrating: false });
    this.renderSparkline('SAFE');
    this.renderAccuracy();
    this.o2Monitor = new OxygenMonitor();
    this.o2Monitor.onAutoCorrelate = () => this.o2Monitor.setFromGasPPM(this.decision.ppm);
    this.setSensorGas(this.decision.gas);
    this.renderAlerts();
    this.telemetry.onChange((kind) => {
      if (kind !== 'samples') this.renderAlerts();
    });
    initSDS();
  }
}

/* =====================================================================
   6. OXYGEN MONITORING
   ===================================================================== */
class OxygenMonitor {
  constructor() {
    this.o2Percent = 20.9;
    this.autoCorrelate = true;
    this.elGaugeArc = document.getElementById('o2GaugeArc');
    this.elValueText = document.getElementById('o2ValueText');
    this.elStatusText = document.getElementById('o2StatusText');
    this.elStatusBadge = document.getElementById('o2StatusBadge');
    this.elSlider = document.getElementById('o2Slider');
    this.elSliderVal = document.getElementById('o2SliderVal');
    this.elAutoCheck = document.getElementById('o2AutoCorrelate');

    if (this.elSlider) {
      this.elSlider.addEventListener('input', (e) => {
        this.o2Percent = parseFloat(e.target.value);
        this.update();
      });
    }
    if (this.elAutoCheck) {
      this.elAutoCheck.addEventListener('change', (e) => {
        this.autoCorrelate = e.target.checked;
        if (this.autoCorrelate && this.onAutoCorrelate) this.onAutoCorrelate();
      });
    }
    this.update();
  }

  setFromGasPPM(ppm) {
    if (!this.autoCorrelate) return;
    // Gas displaces air by volume: O2 = 20.9 × (1 − ppm / 1,000,000).
    // Toxic gases are dangerous long before O2 changes; asphyxiants need % levels.
    this.o2Percent = Math.round(o2FromGasPpm(ppm) * 100) / 100;
    if (this.elSlider) this.elSlider.value = this.o2Percent;
    this.update();
  }

  getStatus() {
    const o2 = this.o2Percent;
    if (o2 >= 23.5) return { label: 'O₂ Enriched – Fire risk', color: 'var(--warning)', level: 'warning' };
    if (o2 >= 19.5) return { label: `Normal (${o2.toFixed(1)}%)`, color: 'var(--safe)', level: 'safe' };
    if (o2 >= 16.0) return { label: `Deficient (${o2.toFixed(1)}%) – Ventilate!`, color: 'var(--warning)', level: 'warning' };
    if (o2 >= 10.0) return { label: `DANGER (${o2.toFixed(1)}%) – Impaired!`, color: 'var(--leak)', level: 'leak' };
    if (o2 >= 6.0)  return { label: `CRITICAL (${o2.toFixed(1)}%) – Unconsciousness!`, color: 'var(--leak)', level: 'leak' };
    return { label: `FATAL (${o2.toFixed(1)}%) – Immediately lethal!`, color: 'var(--leak)', level: 'leak' };
  }

  update() {
    const status = this.getStatus();
    if (this.elValueText) this.elValueText.textContent = this.o2Percent.toFixed(1);
    if (this.elSliderVal) this.elSliderVal.textContent = `${this.o2Percent.toFixed(2)}%`;
    if (this.elStatusText) {
      this.elStatusText.textContent = status.label;
      this.elStatusText.style.color = status.color;
    }
    if (this.elStatusBadge) {
      const badgeMap = { safe: ['Normal','var(--safe-bg)','var(--safe)'], warning: ['Warning','var(--warning-bg)','var(--warning)'], leak: ['DANGER','var(--leak-bg)','var(--leak)'] };
      const b = badgeMap[status.level];
      this.elStatusBadge.textContent = b[0];
      this.elStatusBadge.style.background = b[1];
      this.elStatusBadge.style.color = b[2];
    }
    // Update gauge arc
    if (this.elGaugeArc) {
      const fraction = clamp(this.o2Percent / 25.0);
      const arcLen = Math.round(fraction * 198);
      this.elGaugeArc.setAttribute('stroke-dasharray', `${arcLen} ${264 - arcLen}`);
      this.elGaugeArc.setAttribute('stroke', status.color);
    }
  }
}


