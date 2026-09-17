# GasVision AI – Chemical Leak Monitor & Safety Suite

A high-performance browser application suite demonstrating AI-driven chemical, vapor hazard, and atmospheric monitoring for workplace safety.

Designed for the **"AI Integration for Management of Chemical Hazards in Workplaces"** demonstration session.

---

## 🌟 Application Suite

The suite consists of two integrated applications:

1. **Live Monitor (`index.html`)**: Real-time AI computer vision leak detection, O₂ monitoring, sensor fusion, and chemical SDS inventory.
2. **Analytics Dashboard (`dashboard.html`)**: Historical telemetry, 24-hour incident timeline, O₂ depletion trends, chemical exposure tracking vs OSHA PEL limits, watch zone incident analytics, and shift report generation with CSV export.

---

## 🚀 Key Features

### 1. Pluggable Camera Architecture
- **`SimulatedSceneSource` (Default)**: 320x240 RGB canvas rendering brick wall, industrial piping with specular shading, valve body, red handwheel, realistic turbulent convective vapor plume, camera noise, and false-alarm walking person.
- **`SimulatedThermalSource`**: Calibrated 160x120 temperature array (°C) simulating ambient thermal baseline (29 °C), hot pipe (44 °C), warm human walker (33–35.5 °C), and cold plume leak applying saturating cooling $T \mathrel{-}= 16 \cdot (1 - e^{-A/12})$ (bounded realistically to ~13 °C).
- **`WebcamSource`**: Live laptop webcam capture (640x480) with error recovery overlay.
- **`VideoFileSource`**: Looped local video playback.

### 2. Detection Engine (`Detector`)
- 16x12 grid (192 cells of 10x10 px) processed at ~15 fps.
- Fast baseline calibration (first 45 frames) recording cell noise floors.
- Visible-light feature extraction: background difference, contrast loss (haze), luminescence shift, edge energy ratio (rejects solid moving objects), abrupt motion penalty, and darkening rejection.
- Thermal feature extraction: cold pixel detection below $(ambient - 1.0\text{ }^\circ\text{C})$ and $(bgT - 3.0\text{ }^\circ\text{C})$, eliminating false positives from pipe occlusion.
- Scene-change guard: automatically handles lighting shifts (>60% cells) without false alarms.
- Spatiotemporal confirmation: temporal score smoothing, persistence counter ($\ge 1.2\text{ s}$), and 4-connected component clustering.

### 3. Oxygen (O₂) Atmospheric Monitoring
- SVG radial percentage gauge with real-time health indicator.
- Threshold indicators:
  - **19.5% – 23.5%**: Safe operating atmosphere.
  - **< 19.5%**: OSHA minimum threshold (Warning: Ventilation required).
  - **< 16.0%**: Impaired judgement and hypoxia risk.
  - **< 6.0%**: Immediately fatal.
- **Gas displacement auto-correlation**: As chemical gas concentration rises, atmospheric O₂ drops proportionally:
  $$O_2 \approx 20.9 \cdot \left(1 - \frac{\text{ppm}}{10000}\right)$$
- Manual slider override & toggle for simulation and calibration testing.

### 4. Safety Data Sheet (SDS) Chemical Inventory
Comprehensive reference database covering **12 common industrial hazardous chemicals**:
- **Chemicals**: Methane, Propane, Hydrogen Sulfide, Ammonia, Chlorine, Carbon Monoxide, Benzene, Sulfur Dioxide, Nitrogen Dioxide, Hydrogen Cyanide, Ethylene Oxide, and Acetylene.
- **Details per chemical**:
  - GHS pictograms, CAS number, chemical formula, and signal word.
  - Exposure standards: OSHA PEL (TWA), NIOSH REL, STEL, and IDLH.
  - Flammability limits: LEL and UEL (% vol).
  - Oxygen displacement characteristics.
  - First aid measures and specific PPE requirements.
  - Recommended sensor/camera detection methodology.
- Instant search and category filtering (Flammable, Toxic, Asphyxiant, Corrosive, Oxidizer).

### 5. Multi-Modal Sensor Fusion & Alarms
- Combines computer vision with gas sensor inputs (Virtual 0–2000 ppm slider or Arduino via Web Serial at 9600 baud).
- Immediate escalation to `WARNING` ($\ge 0.28$) or `LEAK DETECTED` ($\ge 0.55$) with a 2-second de-escalation hysteresis.
- Dual sensor confirmation escalates confidence to $\ge 85\%$, while single sensor spikes are capped at warning levels.
- Web Audio API 3-beep 880 Hz alarm.
- Snapshot event log retaining the 25 newest leak incidents with 160x120 JPEG thumbnails, timestamps, and readings.

### 6. Analytics Dashboard (`dashboard.html`)
- **Live atmospheric counters**: Gas PPM, Oxygen %, Leak Confidence, and Active Alerts.
- **24-hour incident timeline**: Multi-axis canvas chart plotting leak confidence, gas PPM, and O₂ levels.
- **O₂ level trend chart**: 24-hour canvas graph with OSHA safe, deficient, and hazardous zone bands.
- **Chemical exposure tracker**: Event table assessing accumulated exposure versus OSHA PEL limits.
- **Watch zone analytics**: Incident count, average duration, and maximum confidence per monitoring zone.
- **Shift reports**: Morning, afternoon, and night shift incident breakdowns.
- **CSV export**: One-click download of all safety telemetry and incident records.

---

## 🖥️ How to Run

### Option A: Via Local Web Server (Recommended for full feature support)
```powershell
# In the project directory:
python -m http.server 8080
```
Open your browser to:
- **Live Monitor**: `http://localhost:8080/index.html`
- **Analytics Dashboard**: `http://localhost:8080/dashboard.html`

### Option B: Directly in Browser
- Double-click `index.html` or drag it into Google Chrome or Microsoft Edge.
- No build step, npm packages, or external web dependencies required!
