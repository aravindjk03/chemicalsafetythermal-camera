# GasVision AI – Chemical Safety Suite

A browser-based demo of AI-assisted chemical leak detection, hazard assessment and storage-room ventilation planning for workplaces.

Designed for the **"AI Integration for Management of Chemical Hazards in Workplaces"** demonstration session.

## 🌐 Live app

👉 **[https://aravindjk03.github.io/chemicalsafetythermal-camera/](https://aravindjk03.github.io/chemicalsafetythermal-camera/)**. Runs in Chrome or Edge on desktop and mobile; no installation needed.

> Demo prototype. The hazard and ventilation models are screening estimates for training and planning. They are not a substitute for emergency responders, site dispersion models (ALOHA/CAMEO, PHAST) or a qualified ventilation engineer.

---

## 🖥️ How to Run

No build step, npm packages or server-side code.

**Option A – local web server (recommended)**
```powershell
# In the project directory:
python -m http.server 8080
```
Open `http://localhost:8080/`. (Use another port, e.g. `8093`, if 8080 is busy.)

**Option B – open the file**
Double-click `index.html` in Chrome or Edge. Everything works except webcam access, which browsers only allow on `http://localhost` or `https://`.

The old `dashboard.html` link now redirects to the Analytics tab.

---

## 🌟 The five screens

All screens share one app shell. The alarm status bar stays visible on every screen, and data flows between them.

| Screen | What it does |
|---|---|
| 📹 **Live Monitor** (`#monitor`) | Camera leak detection (simulated visible, simulated thermal, webcam, video file), gas-sensor fusion, O₂ monitor, incident log with snapshots, automated camera self-test, SDS chemical inventory |
| 📊 **Analytics** (`#analytics`) | Live history recorded by the monitor: timeline, O₂ trend, 8-h TWA / 15-min STEL exposure vs limits, incident log, watch-zone summary, shift reports, saved hazard assessments, CSV export. Optional 24-hour sample dataset |
| ⚠️ **Hazard Scanner** (`#hazard`) | Capture an image of a release, identify the chemical, model how it spreads indoors or outdoors, and explain what exposure does to people |
| 🌀 **Ventilation** (`#ventilation`) | Plan and check ventilation for chemical / gas-cylinder storage rooms |
| 🧭 **Roadmap** (`#roadmap`) | What the demo can grow into |

**How they link**
- A confirmed leak on the monitor opens an incident. Its **Assess hazard →** button sends the frame (with the clean reference frame and sensor reading) to the Hazard Scanner.
- Saved assessments attach to the incident and show in Analytics and the incident log.
- SDS cards have **Model a release** buttons.
- The Hazard Scanner's indoor actions include **Plan ventilation for this room →**, and the planner has **Model a leak in this room →**.

---

## 📹 Live Monitor

### Camera sources
- **Simulated visible scene:** brick wall, pipe and valve, with the release chemical chosen in the simulator panel. Ammonia/LPG show as a white cloud, chlorine yellow-green, NO₂ brown, and colourless gases are invisible. It also has small/medium/large leaks, a person walking by, and a lighting change.
- **Simulated thermal camera:** 160×120 °C array. Liquefied / high-pressure releases produce a strong cold plume, other gases weaker expansion cooling. Also has a person walking by and an HVAC temperature swing.
- **Webcam** and **video file.**

### Detection engine
- 16×12 cell grid at ~15 fps with a 3-second noise-floor calibration.
- Visible light: brightness change, **illumination-invariant colour (chromaticity) change**, haze/contrast loss, edge-energy rejection of solid objects, fast-motion and darkening penalties, and a scene-change guard.
- **Selective background update:** strongly differing pixels (people, dense vapour) are absorbed very slowly. A separate clean reference, updated only from cells idle for 3 s, lets the detector recognise a cloud that is clearing, so the alarm doesn't latch.
- Thermal: cold pixels below both the learned background and ambient.
- Confirmation needs **persistence timed in seconds** (so low-fps machines behave the same) plus connected-cell clustering.

### Gas sensor fusion
- Choose the **target gas**. The slider range and alarm setpoints follow that gas (e.g. chlorine 0.5 / 1 ppm, ammonia 25 / 50 ppm, methane 10% / 20% of LEL).
- Camera + sensor must agree for LEAK; a single source can only raise WARNING.
- The Arduino input (MQ sensors via Web Serial) uses an **uncalibrated** demo mapping.

### O₂ monitor
Oxygen from air displacement: **O₂ = 20.9 × (1 − ppm / 10⁶)**. Toxic gases are dangerous long before oxygen changes; asphyxiants like methane need percent-level concentrations to lower it.

### Automated camera self-test
**Run self-test** replays 18 seeded scenes frame by frame through the real detection pipeline with the gas sensor off:
- **False-alarm scenes:** an empty scene, people walking past, and a lighting change or HVAC swing.
- **Leak scenes:** small and long leaks, a leak with a person walking through, and a leak already present at start-up.
- **Coloured gases:** chlorine and NO₂.
- **Gases invisible to the visible camera:** methane.

It reports precision, recall, F1, false alarms, time to detect and time to clear.

Current result: **18/18 scenes pass, 0 false alarms, 100% precision and recall, mean time to detect 1.6 s**. Before the detector changes above, a small leak never cleared, a long leak took ~34 s to clear, and brown NO₂ was caught in only 24% of leak frames.

These are simulated scenes. Real-camera accuracy needs field footage; use the manual live-scoring panel for that.

---

## ⚠️ Hazard Scanner

1. **Capture:** grab the Live Monitor frame, take a webcam photo, or upload a picture. Drag to mark the release area.
2. **Identify:**
   - **On-device analysis.** With the monitor's clean reference frame, the scanner solves *observed = α·cloud + (1−α)·background* to estimate cloud colour and opacity. Without one, it falls back to colour classes.
   - **Evidence combined** with label / placard / UN / CAS text, the live gas sensor, and the thermal cold-plume signature.
   - **Optional Claude vision** (`claude-opus-5`, structured JSON output) reads labels, placards and GHS pictograms. It needs your own Anthropic API key, is called from the browser, and the key is only stored if you tick *Remember*.
3. **Model the release:**
   - **Indoor:** well-mixed room with ventilation and a mixing factor gives concentration over time and when each level of concern is reached.
   - **Outdoor:** steady-state Gaussian plume with Briggs open-country coefficients (stability A–F) gives ground-level concentration vs distance and top-view threat zones.
4. **Explain the threat:**
   - **Threat level** from LOW to CRITICAL.
   - **Levels of concern:** EPA AEGL-1/2/3 for the exposure duration, flammability (10% / 60% / 100% LEL) and O₂ displacement.
   - **What happens if exposed:** a symptom ladder with the predicted exposure marked.
   - **Atmospheric behaviour:** sinks or rises, reactions with moisture, fire range.
   - **Immediate actions:** evacuation / shelter-in-place distances, ignition control, PPE, first aid and ERG guide number.
   - **Save and report:** save to the incident log or download an HTML report.

---

## 🌀 Ventilation Planner

For a chemical or gas-cylinder storage room:
- **Inputs:** room size and door wall, air distribution quality, stored chemicals (form, quantity, design-basis leak rate), and what is installed now.
- **Required airflow:**
  - Code minimum: **1 cfm/ft² of floor area, ≥ 150 cfm** (IFC §5004.3.1 / NFPA 30).
  - Dilution of the design leak: **Q = K·G / C_target**, targeting the occupational limit for toxic gases and **25% of LEL** for flammables.
  - A **30 air-changes/h** emergency purge on gas alarm (IIAR 2 practice).
  - When dilution would need more than 12 ACH, the planner recommends enclosing the gas (exhausted gas cabinet) instead.
- **Layout by vapour density:** exhaust within **300 mm of the floor** for heavy gases and of the **ceiling** for light gases (both for mixed storage). Fresh-air inlet on the door side, air sweeping across the room to the storage wall, and detectors at the right heights. Shown as a **plan view and section drawing**.
- **Installed-system check:** airflow, pickup height, make-up air, detection, interlocks, outside switch, emergency capacity.
- **Incompatible storage:** chlorine + ammonia, oxidizers + flammables, ammonia + acid gases.
- **Design-basis leak simulation** under current vs recommended ventilation.
- **Guidance and reports:** fan, duct material and discharge guidance, a 21-item good-practice checklist, and a downloadable HTML plan.

---

## 🧪 Chemical database

12 chemicals (methane, propane, H₂S, ammonia, chlorine, CO, benzene, SO₂, NO₂, HCN, ethylene oxide, acetylene). Each entry includes:
- **Identity:** CAS number, UN number, ERG guide, GHS signal word and pictograms.
- **Exposure limits:** OSHA PEL, NIOSH REL, STEL and IDLH (NIOSH Pocket Guide).
- **EPA AEGL-1/2/3** at 10 min, 30 min, 1 h, 4 h and 8 h.
- **Physical properties:** LEL/UEL, molecular weight, vapour density, saturation limit.
- **Health effects:** a symptom ladder by concentration.
- **Behaviour in air:** how it spreads and what it reacts with.
- **Response:** first aid, PPE and detection method.
- **Sensor alarm setpoints:** used by the gas sensor.

Values verified against NIOSH and EPA sources in September 2026.

---

## 📁 Project structure

```
index.html           App shell and screen markup
dashboard.html       Redirect to index.html#analytics
css/app.css          Base styles (monitor, cards, SDS)
css/views.css        Navigation, Analytics, Hazard Scanner, Ventilation, Roadmap
js/chemicals.js      Chemical database + helpers + SDS cards
js/charts.js         Canvas line-chart helper
js/hazard-model.js   Gaussian plume, room model, levels of concern, threat assessment
js/telemetry.js      Shared store (readings, incidents, assessments) in localStorage
js/monitor.js        Camera sources, detector, sensor fusion, Live Monitor controller
js/benchmark.js      Automated camera self-test
js/analytics.js      Analytics screen
js/hazard.js         Hazard Scanner screen (image analysis, Claude vision, threat UI)
js/ventilation.js    Ventilation Planner screen
js/roadmap.js        Roadmap content
js/app.js            Hash router and start-up
```

`chemicals.js`, `hazard-model.js` and `ventilation.js` also export their pure functions for Node, so the models can be tested without a browser.

---

## 🧭 Future roadmap (summary)

- **Real hardware:** radiometric thermal cameras, calibrated electrochemical / IR / PID gas detectors over Modbus or MQTT, optical gas imaging, an on-site weather station.
- **Smarter detection:** a trained plume-segmentation model, a field validation dataset from controlled releases, multi-camera fusion, on-device label OCR.
- **Response automation:** automatic shut-off valves and emergency purge via PLC, SMS/WhatsApp/PA alerts, evacuation and muster tracking, a responder view.
- **Better modelling:** dense-gas dispersion, site-map overlays, multi-room leak migration, fire and explosion consequences.
- **Data and compliance:** a central server and multi-site dashboard, per-worker exposure records, audit-ready reports, maintenance scheduling.
- **Platform:** edge devices (Raspberry Pi / Jetson), an offline-first PWA, chemical-register import, localisation.

See the **Roadmap** tab for details.
