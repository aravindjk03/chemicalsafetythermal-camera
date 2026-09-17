# GasVision AI – Industrial Chemical Hazard & Leak Safety Suite

A high-performance browser application suite demonstrating AI-driven chemical leak detection, optical container recognition, atmospheric exposure threat modeling, and workplace environmental safety.

Designed for the **"AI Integration for Management of Chemical Hazards in Workplaces"** demonstration session.

---

## 🌐 Live Web Application
👉 **Access the Live Production App**: [https://aravindjk03.github.io/chemicalsafetythermal-camera/](https://aravindjk03.github.io/chemicalsafetythermal-camera/)

*No installation, setup, or hardware required — runs directly in Google Chrome, Microsoft Edge, and Safari on desktop and mobile.*

---

## 🌟 Unified Multi-Screen Architecture (`index.html`)

GasVision AI integrates 4 specialized industrial safety modules into a seamless single-page application with instant zero-reload tab navigation:

```
[ 📡 Live Leak Monitor ]  [ 🔬 Chemical Threat Scanner ]  [ 📊 Analytics Dashboard ]  [ 🚀 Future Roadmap ]
```

---

## 🚀 Key Modules & Capabilities

### Screen 1: 📡 Live Leak Monitor
- **Pluggable Camera Sources**:
  - `SimulatedSceneSource` (Default): 320x240 RGB scene with industrial piping, valve handwheel, turbulent vapor plume physics, sensor noise, and a walking person for false-alarm benchmarking.
  - `SimulatedThermalSource`: Calibrated 160x120 temperature array (°C) simulating baseline (29 °C), hot pipe (44 °C), warm human walker (33–35.5 °C), and cold plume leak applying saturating cooling $T \mathrel{-}= 16 \cdot (1 - e^{-A/12})$.
  - `WebcamSource`: Live laptop UVC webcam capture (640x480) with automatic resolution fallback and permission recovery.
  - `VideoFileSource`: Looped local video file analysis.
- **Computer Vision Leak Detection Engine (`Detector`)**:
  - 16x12 cell matrix (192 grid cells) processed at ~15 fps.
  - Visible-light feature extraction: background difference, contrast loss (haze), luminescence shift, and edge energy ratio.
  - Robust false-alarm rejection: penalizes solid moving edges and dark clothing, ensuring walking humans never trigger leaks ($0\%$ confidence).
  - Thermal cold-plume detection below ambient and background thresholds.
- **Oxygen ($O_2$) Atmospheric Monitor**:
  - Real-time SVG radial arc gauge color-coded across OSHA hazard tiers (Safe $19.5\text{--}23.5\%$, Deficient $<19.5\%$, Hazardous $<16.0\%$, Lethal $<6.0\%$).
  - **Dynamic Gas Displacement Correlation**: Local oxygen drops proportionally as gas leaks:
    $$O_2 \approx 20.9 \cdot \left(1 - \frac{\text{ppm}}{10000}\right)$$
- **Safety Data Sheet (SDS) Chemical Inventory**:
  - 12 industrial chemicals (Methane, Propane, H₂S, Ammonia, Chlorine, CO, Benzene, SO₂, NO₂, HCN, Ethylene Oxide, Acetylene) with GHS pictograms, OSHA PEL/REL/IDLH limits, LEL/UEL, PPE, first aid, and detection guidance.
  - Instant search and category filtering.

---

### Screen 2: 🔬 Chemical Hazard Vision Scanner & Atmospheric Threat Modeler
- **Optical Container Capture & Viewfinder**:
  - Live HUD targeting reticle with real-time confidence readout.
  - Capture frame directly from live camera/webcam, or upload custom container photos.
  - 6 Pre-configured Industrial Benchmarks:
    1. **Anhydrous Ammonia ($NH_3$)** · High-Pressure Storage Tank (UN 1005)
    2. **Chlorine Gas ($Cl_2$)** · 1-Ton Pressurized Chemical Tonner (UN 1017)
    3. **Methane / Natural Gas ($CH_4$)** · Transmission Manifold Flange (UN 1971)
    4. **Benzene ($C_6H_6$)** · Petrochemical Solvent Drum (UN 1114)
    5. **Hydrogen Sulfide ($H_2S$)** · Sour Crude Desulfurization Line (UN 1053)
    6. **Oleum / Fuming Sulfuric Acid ($H_2SO_4 \cdot SO_3$)** · Acid Tote (UN 1831)
- **AI Hazard Classification & NFPA 704**:
  - Interactive SVG standard **NFPA 704 Diamond** (Health, Flammability, Instability, Special hazard).
  - GHS pictograms, Signal Word (`DANGER` / `WARNING`), and hazard code statements.
  - Critical thermodynamic properties: Vapor density (indicates sinking vs rising behavior), boiling point, LEL/UEL, OSHA PEL.
- **Atmospheric Exposure Threat Consequence Simulation ("What Happens When Released?")**:
  - **Dynamic Downwind Plume Radar (Canvas 2D)**:
    - ALOHA / EPA RMP compliant Gaussian dispersion modeling under ambient wind conditions.
    - 🔴 **Red Zone (Lethal / IDLH)**: Immediate danger to life.
    - 🟠 **Orange Zone (AEGL-2 Disabling)**: Irreversible injury & impaired escape.
    - 🟡 **Yellow Zone (AEGL-1 Irritation & Odor)**: Evacuation boundary.
  - **Atmospheric Reaction & Behavior Breakdown**:
    - Explains exact chemical behavior upon atmospheric contact (e.g. moisture reaction forming caustic aerosol clouds, ground pooling, or vapor cloud explosion/BLEVE risk).
    - Localized oxygen displacement rate.
  - **Physiological Health Impact Timeline**:
    - `0–30s`: Sensory irritation, acute corneal/respiratory burn.
    - `1–5 min`: Chemical bronchitis, pulmonary edema, severe caustic blistering.
    - `15–30 min`: Cellular asphyxiation, cardiovascular arrest, fatality threshold without SCBA.
  - **DOT ERG 2024 Emergency Response & Evacuation Guide**:
    - Initial isolation distance (all directions) and day vs night downwind protective action zones.
    - Mandatory PPE rating (Level A / B) and firefighting guidelines.

---

### Screen 3: 📊 Unified Analytics Dashboard
- Synchronized with the live monitor in real time.
- **Real-Time Telemetry Counters**: Live Gas PPM, $O_2$ %, Leak confidence, Active alerts, and System uptime.
- **24-Hour Incident Timeline Chart**: Multi-curve Canvas chart tracking Leak Confidence, Gas PPM, and $O_2$ depletion against hazard bands.
- **24-Hour $O_2$ Trend Chart**: Oxygen depletion curve with OSHA reference lines ($19.5\%$ and $23.5\%$).
- **Chemical Exposure Log**: Compares cumulative exposure against OSHA PEL limits with color-coded progress bars.
- **Shift Reports & One-Click CSV Export**: Morning, afternoon, and night shift breakdown with downloadable `.csv` report.

---

### Screen 4: 🚀 Future Technological Roadmap
Strategic engineering plan for full-scale commercialization:
1. **Cooled Optical Gas Imaging (OGI) Thermal Cores**: MWIR 3.2–3.4 µm narrowband filtered InSb sensors (FLIR GF320 class) for direct optical absorption visualization of colorless VOCs and methane.
2. **Embedded Edge AI Acceleration**: NVIDIA Jetson Orin Nano / Hailo-8 26-TOPS NPU running quantized INT8 YOLOv10-Gas models (< 8 ms inference at 60 fps, < 10W power).
3. **Autonomous Robotics & Drone (UAV) Sniffer Patrols**: Quadruped agile robots (Boston Dynamics Spot) and ATEX Zone 1 rated autonomous aerial drones with TDLAS laser spectrometers.
4. **CFD Digital Twin & 3D Atmospheric Dispersion**: Coupling 3D BIM/CAD plant models, 3-axis sonic anemometers, and Navier-Stokes fluid dispersion for microclimate worker evacuation routing.
5. **SCADA / DCS Emergency Shutdown (ESD) Integration**: Modbus TCP and MQTT Sparkplug B automated valve closure (< 500 ms) and air deluge activation.
6. **ATEX & IECEx Zone 0 Certification**: Explosion-proof marine-grade aluminum/stainless enclosures (Ex d, Ex ia) for explosive atmospheres.

---

## 🖥️ How to Run

### Via Local Web Server
```powershell
python -m http.server 8080
```
Open your browser to:
- **Unified Application**: `http://localhost:8080/index.html`
- **Standalone Dashboard**: `http://localhost:8080/dashboard.html`

### Direct File Execution
Double click `index.html` to run in Google Chrome or Microsoft Edge. No npm packages, frameworks, or internet connection required!
