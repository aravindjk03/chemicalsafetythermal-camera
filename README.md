# GasVision AI – Chemical Leak Monitor

A high-performance, single-file browser application demonstrating AI-driven chemical and vapor hazard monitoring for workplace safety.

Designed for the **"AI Integration for Management of Chemical Hazards in Workplaces"** demonstration session.

---

## Key Features

- **Pluggable Camera Architecture**:
  - `SimulatedSceneSource` (Default): 320x240 RGB canvas rendering brick wall, industrial piping with specular shading, valve body, red handwheel, realistic turbulent convective vapor plume, camera noise, and false-alarm walking person.
  - `SimulatedThermalSource`: Calibrated 160x120 temperature array (°C) simulating ambient thermal baseline (29 °C), hot pipe (44 °C), warm human walker (33–35.5 °C), and cold plume leak applying saturating cooling $T \mathrel{-}= 16 \cdot (1 - e^{-A/12})$ (bounded realistically to ~13 °C).
  - `WebcamSource`: Live laptop webcam capture (640x480) with error recovery overlay.
  - `VideoFileSource`: Looped local video playback.

- **Detection Engine (`Detector`)**:
  - 16x12 grid (192 cells of 10x10 px) processed at ~15 fps.
  - Fast baseline calibration (first 45 frames) recording cell noise floors.
  - Visible-light feature extraction: background difference, contrast loss (haze), luminescence shift, edge energy ratio (rejects solid moving objects), abrupt motion penalty, and darkening rejection.
  - Thermal feature extraction: cold pixel detection below $(ambient - 1.0\text{ }^\circ\text{C})$ and $(bgT - 3.0\text{ }^\circ\text{C})$, eliminating false positives from pipe occlusion.
  - Scene-change guard: automatically handles lighting shifts (>60% cells) without false alarms.
  - Spatiotemporal confirmation: temporal score smoothing, persistence counter ($\ge 1.2\text{ s}$), and 4-connected component clustering.

- **Decision & Multi-Modal Sensor Fusion**:
  - Combines computer vision with gas sensor inputs (Virtual 0–2000 ppm slider or Arduino via Web Serial at 9600 baud).
  - Immediate escalation to `WARNING` ($\ge 0.28$) or `LEAK DETECTED` ($\ge 0.55$) with a 2-second de-escalation hysteresis.
  - Dual sensor confirmation escalates confidence to $\ge 85\%$, while single sensor spikes are capped at warning levels.
  - Web Audio API 3-beep 880 Hz alarm.
  - Snapshot event log retaining the 25 newest leak incidents with 160x120 JPEG thumbnails, timestamps, and readings.

- **Industrial Safety UI**:
  - Full-width status band with pulsing indicator dot and hazard guidance copy.
  - 640x480 display canvas with **Normal**, **Thermal palette** (Inferno 256-entry LUT), and **Risk heatmap** overlays.
  - Interactive click-and-drag **Watch Zones**.
  - Real-time **60-Second Sparkline** and telemetry tiles.
  - **Accuracy Benchmark Panel** (TP, FP, TN, FN, Accuracy, Precision, Recall, F1).
  - **Hardware Integration Roadmap** with adapter status, interface definition, and Arduino sketch.

---

## How to Run

1. Clone or download this repository.
2. Open `index.html` directly in **Google Chrome** or **Microsoft Edge**.
3. No web server, Node.js, or build step required!
