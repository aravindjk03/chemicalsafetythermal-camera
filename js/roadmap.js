'use strict';

/* =====================================================================
   ROADMAP: what the demo can grow into
   ===================================================================== */

const ROADMAP = [
  {
    title: 'Real sensing hardware',
    icon: '📡',
    horizon: 'Next',
    items: [
      { name: 'Radiometric thermal cameras', detail: 'FLIR Lepton / InfiRay / TOPDON over USB-UVC, and MLX90640 arrays over serial, replacing the simulated thermal source through the existing CameraSource interface.' },
      { name: 'Calibrated gas detectors', detail: 'Electrochemical (NH₃, Cl₂, H₂S, CO), catalytic/IR (methane, propane) and PID (benzene) sensors read over Modbus RTU/TCP or MQTT, replacing the uncalibrated MQ-sensor demo mapping.' },
      { name: 'Optical gas imaging (OGI)', detail: 'Cooled mid-wave IR cameras make methane, propane and other hydrocarbons visible as plumes; feed their video into the same detector.' },
      { name: 'Weather station', detail: 'Live wind speed/direction and stability class from an on-site anemometer so outdoor threat zones point the right way automatically.' }
    ]
  },
  {
    title: 'Smarter detection',
    icon: '🧠',
    horizon: 'Next',
    items: [
      { name: 'Trained plume-segmentation model', detail: 'A small on-device neural network (e.g. TensorFlow.js / ONNX Runtime Web) trained on real leak footage to outline vapour clouds pixel by pixel, with the current rule-based detector as a fallback.' },
      { name: 'Field validation dataset', detail: 'Record controlled releases (steam, CO₂ fog, tracer gas) and false-alarm scenes at the site; extend the self-test to replay real video and report precision/recall per camera.' },
      { name: 'Multi-camera fusion', detail: 'Combine overlapping cameras and sensors to locate the source in 3-D and estimate leak size from plume growth.' },
      { name: 'Label and placard reading on-device', detail: 'OCR for UN numbers, CAS numbers and GHS pictograms without sending images to the cloud.' }
    ]
  },
  {
    title: 'Response automation',
    icon: '🚨',
    horizon: 'Pilot',
    items: [
      { name: 'Automatic isolation', detail: 'On confirmed LEAK, close solenoid shut-off valves and switch storage-room fans to emergency purge through a PLC or relay board.' },
      { name: 'Alert routing', detail: 'SMS, WhatsApp, email, pager and PA announcements with the snapshot, chemical, threat level and evacuation distance.' },
      { name: 'Evacuation and muster tracking', detail: 'Show safe assembly points upwind of the modelled plume and track who has checked in (badge or QR scan).' },
      { name: 'Responder view', detail: 'Mobile page for the fire service with the live threat zones, SDS, ERG guide and site map.' }
    ]
  },
  {
    title: 'Better hazard modelling',
    icon: '🌬️',
    horizon: 'Pilot',
    items: [
      { name: 'Dense-gas dispersion', detail: 'Heavy-gas model (e.g. Britter–McQuaid / SLAB-style) for chlorine, propane and cold ammonia clouds, which the Gaussian plume under-predicts near the source.' },
      { name: 'Site map overlay', detail: 'Draw threat zones on the actual plant layout (GIS or floor plans) with buildings, doors and air intakes.' },
      { name: 'Multi-room indoor model', detail: 'Leak migration between connected rooms through doors and HVAC, using the ventilation plans from the Ventilation Planner.' },
      { name: 'Fire and explosion consequences', detail: 'Jet fire, flash fire and vapour-cloud explosion overpressure distances for flammable releases.' }
    ]
  },
  {
    title: 'Data, compliance and reporting',
    icon: '📑',
    horizon: 'Scale',
    items: [
      { name: 'Central server and multi-site dashboard', detail: 'Store telemetry and incidents in a database instead of browser storage; compare sites and shifts; role-based access.' },
      { name: 'Exposure records per worker', detail: 'Link badge location with sensor readings to build individual exposure histories against OSHA/NIOSH limits.' },
      { name: 'Audit-ready reports', detail: 'Automatic monthly incident, near-miss and ventilation-check reports for ISO 45001, OSHA PSM and insurance audits.' },
      { name: 'Maintenance scheduling', detail: 'Reminders for detector calibration, fan flow tests and checklist items from the Ventilation Planner.' }
    ]
  },
  {
    title: 'Platform',
    icon: '🧩',
    horizon: 'Scale',
    items: [
      { name: 'Edge deployment', detail: 'Run the detector on a Raspberry Pi 5 or NVIDIA Jetson next to each camera, sending only events and snapshots.' },
      { name: 'Offline-first app', detail: 'Installable Progressive Web App so the monitor keeps running and alarming without internet.' },
      { name: 'Chemical inventory integration', detail: 'Import the site chemical register (quantities, locations, SDS) to pre-fill the Hazard Scanner and Ventilation Planner.' },
      { name: 'Localization', detail: 'Alerts, SDS summaries and voice announcements in the languages workers actually speak.' }
    ]
  }
];

function renderRoadmap(container) {
  if (!container) return;
  container.innerHTML = ROADMAP.map(section => `
    <section class="card roadmap-card">
      <div class="card-header">
        <span class="card-title">${section.icon} ${section.title}</span>
        <span class="horizon horizon-${section.horizon.toLowerCase()}">${section.horizon}</span>
      </div>
      <div class="card-body">
        <ul class="roadmap-list">
          ${section.items.map(i => `<li><strong>${i.name}</strong><span>${i.detail}</span></li>`).join('')}
        </ul>
      </div>
    </section>`).join('') + `
    <p class="fine-print roadmap-foot"><strong>Next</strong> = extends what already works in this demo · <strong>Pilot</strong> = needed for a first site trial · <strong>Scale</strong> = needed to roll out across sites.</p>`;
}
