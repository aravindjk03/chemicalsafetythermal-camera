'use strict';

/* =====================================================================
   CHEMICAL DATABASE
   Shared by the SDS inventory, the gas-sensor alarm levels, the
   Analytics exposure tracker and the Hazard Scanner threat model.

   Sources (verified 2026-09):
   - AEGL values: US EPA Acute Exposure Guideline Levels program
   - IDLH / REL / PEL / LEL / UEL / MW: NIOSH Pocket Guide to Chemical Hazards
   - Symptom ladders: OSHA fact sheets, ATSDR Medical Management Guidelines
   - Guide numbers: 2024 Emergency Response Guidebook (ERG)
   ===================================================================== */

// AEGL averaging periods (minutes) that match the arrays in each entry
const AEGL_DURATIONS_MIN = [10, 30, 60, 240, 480];

const AEGL_TIER_TEXT = {
  1: 'Notable discomfort, irritation or certain non-sensory effects. Effects are transient and reversible once exposure stops.',
  2: 'Irreversible or other serious, long-lasting health effects, or an impaired ability to escape.',
  3: 'Life-threatening health effects or death.'
};

const CHEMICALS = [
  {
    id: 'methane',
    name: 'Methane', formula: 'CH₄', cas: '74-82-8', un: 'UN1971', ergGuide: '115',
    synonyms: ['natural gas', 'cng', 'lng', 'marsh gas', 'ch4', 'un1972'],
    signal: 'DANGER', pictograms: '🔥 💨',
    hazards: ['Extremely flammable gas', 'Simple asphyxiant'],
    categories: ['flammable', 'asphyxiant'],
    pel: 'None (simple asphyxiant)', rel: 'None', stel: '–', idlh: 'Not determined',
    lel: '5.0%', uel: '15.0%',
    mw: 16.04, vaporDensity: 0.55, maxPpm: 1000000,
    lelPct: 5.0, uelPct: 15.0,
    idlhPpm: null, oelPpm: null, stelPpm: null, odorPpm: null,
    aegl: null,
    alarm: { low: 5000, high: 10000, max: 25000, simLeak: 12000, basis: '10% / 20% of LEL' },
    visual: 'invisible',
    coldRelease: true,
    effects: [
      { ppm: 0, text: 'No toxic effect. Methane is odourless (utility gas is odorised with mercaptan).' },
      { ppm: 50000, text: 'Explosive range (5–15% in air). Any spark, hot surface or flame can ignite a fire or vapour cloud explosion.' },
      { ppm: 250000, text: 'Oxygen displaced to about 15–16%: headache, dizziness, weakness, loss of coordination.' },
      { ppm: 500000, text: 'Oxygen near 10%: loss of consciousness and death by asphyxiation.' }
    ],
    atmosphere: [
      'Lighter than air (0.55×): rises and disperses quickly outdoors, but collects under roofs and ceilings indoors.',
      'Not visible to an ordinary camera. Leaks show up on optical gas imaging or as a cold spot on thermal cameras.',
      'Strong greenhouse gas with an atmospheric lifetime of about 12 years.'
    ],
    o2Displacement: '~1% O₂ drop per 5% CH₄ by volume',
    firstAid: 'Move to fresh air. Give O₂ if breathing is difficult. CPR if not breathing.',
    ppe: 'SCBA in confined spaces; eliminate ignition sources; anti-static clothing',
    detection: 'Catalytic / IR methane detector (MQ-4 for demos) · Thermal camera (Joule-Thomson cooling)',
    use: 'Natural gas pipelines, boilers, storage'
  },
  {
    id: 'propane',
    name: 'Propane', formula: 'C₃H₈', cas: '74-98-6', un: 'UN1978', ergGuide: '115',
    synonyms: ['lpg', 'liquefied petroleum gas', 'c3h8', 'autogas'],
    signal: 'DANGER', pictograms: '🔥 ⚠️',
    hazards: ['Extremely flammable gas', 'Liquefied gas under pressure', 'Simple asphyxiant'],
    categories: ['flammable', 'asphyxiant'],
    pel: '1,000 ppm (TWA)', rel: '1,000 ppm (TWA)', stel: '–', idlh: '2,100 ppm (10% LEL)',
    lel: '2.1%', uel: '9.5%',
    mw: 44.10, vaporDensity: 1.52, maxPpm: 1000000,
    lelPct: 2.1, uelPct: 9.5,
    idlhPpm: 2100, oelPpm: 1000, stelPpm: null, odorPpm: null,
    aegl: { 1: [10000, 6900, 5500, 5500, 5500], 2: [17000, 17000, 17000, 17000, 17000], 3: [33000, 33000, 33000, 33000, 33000] },
    aeglNote: 'EPA flags all propane AEGLs as above 10% of the LEL: explosion risk comes before toxicity.',
    alarm: { low: 2100, high: 4200, max: 10500, simLeak: 5000, basis: '10% / 20% of LEL' },
    visual: 'white-cloud',
    coldRelease: true,
    effects: [
      { ppm: 0, text: 'No toxic effect at low levels. Commercial LPG is odorised; pure propane is odourless.' },
      { ppm: 21000, text: 'Flammable range (2.1–9.5%). Heavier-than-air vapour can travel to a distant ignition source and flash back.' },
      { ppm: 100000, text: 'Dizziness and drowsiness within minutes (CNS depression). Contact with the liquid causes frostbite.' },
      { ppm: 300000, text: 'Oxygen displaced to about 15%: confusion, collapse and asphyxiation.' }
    ],
    atmosphere: [
      'About 1.5× heavier than air: flows along the ground and pools in pits, drains, basements and trenches.',
      'Liquid releases flash-evaporate and chill the air, forming a visible white fog of condensed moisture.',
      'Vapour cloud explosion risk. A tank exposed to fire can BLEVE (boiling liquid expanding vapour explosion).'
    ],
    o2Displacement: '~1% O₂ drop per 5% C₃H₈ by volume',
    firstAid: 'Move to fresh air. Frostbite: warm gently with lukewarm water, do not rub.',
    ppe: 'SCBA for high concentrations; cold-insulating gloves; no ignition sources',
    detection: 'Catalytic / IR hydrocarbon detector (MQ-2 / MQ-5 for demos) · Thermal camera (cold plume)',
    use: 'Fuel gas, heating, forklifts, storage tanks'
  },
  {
    id: 'h2s',
    name: 'Hydrogen Sulfide', formula: 'H₂S', cas: '7783-06-4', un: 'UN1053', ergGuide: '117',
    synonyms: ['h2s', 'sour gas', 'sewer gas', 'hydrogen sulphide'],
    signal: 'DANGER', pictograms: '☠️ 🔥 ⚠️',
    hazards: ['Fatal if inhaled', 'Extremely flammable gas', 'Olfactory fatigue above 100 ppm'],
    categories: ['toxic', 'flammable'],
    pel: '20 ppm (ceiling), 50 ppm peak', rel: '10 ppm (10-min ceiling)', stel: '50 ppm (OSHA peak)', idlh: '100 ppm',
    lel: '4.0%', uel: '44.0%',
    mw: 34.08, vaporDensity: 1.19, maxPpm: 1000000,
    lelPct: 4.0, uelPct: 44.0,
    idlhPpm: 100, oelPpm: 10, stelPpm: 50, odorPpm: 0.01,
    aegl: { 1: [0.75, 0.60, 0.51, 0.36, 0.33], 2: [41, 32, 27, 20, 17], 3: [76, 59, 50, 37, 31] },
    alarm: { low: 5, high: 10, max: 100, simLeak: 45, basis: 'Typical fixed-detector setpoints' },
    visual: 'invisible',
    coldRelease: false,
    effects: [
      { ppm: 0.01, text: 'Rotten-egg odour detectable (0.01–1.5 ppm).' },
      { ppm: 2, text: 'Prolonged exposure: nausea, tearing eyes, headache, poor sleep; airway problems in some people with asthma.' },
      { ppm: 20, text: 'Fatigue, loss of appetite, headache, irritability, poor memory, dizziness.' },
      { ppm: 50, text: 'Eye and respiratory irritation after about 1 hour.' },
      { ppm: 100, text: 'Sense of smell lost within 2–15 min, so the odour stops warning you. Coughing, eye irritation, drowsiness after 15–30 min.' },
      { ppm: 200, text: 'Marked eye and airway irritation after 1 hour. Fluid in the lungs possible with longer exposure.' },
      { ppm: 500, text: 'Staggering and collapse within 5 minutes; serious eye damage in 30 minutes; death after 30–60 minutes.' },
      { ppm: 700, text: 'Rapid unconsciousness ("knockdown") within a few breaths; breathing stops; death within minutes.' },
      { ppm: 1000, text: 'Nearly instant collapse and death.' }
    ],
    atmosphere: [
      'Slightly heavier than air (1.19×): collects in pits, sumps, tank bottoms and low confined spaces.',
      'Invisible. The odour cannot be relied on because it knocks out the sense of smell above ~100 ppm.',
      'Oxidises in air over hours to days. When it burns it produces toxic sulfur dioxide.'
    ],
    o2Displacement: 'Negligible at toxic concentrations; the hazard is chemical asphyxiation',
    firstAid: 'Remove from exposure IMMEDIATELY (rescuers in SCBA). Give O₂. CPR with barrier if not breathing.',
    ppe: 'SCBA above 10 ppm; personal H₂S monitor for every worker',
    detection: 'Electrochemical H₂S sensor (MQ-136 for demos) · NOT visible to cameras',
    use: 'Refineries, sewage treatment, geothermal, pulp mills'
  },
  {
    id: 'ammonia',
    name: 'Ammonia', formula: 'NH₃', cas: '7664-41-7', un: 'UN1005', ergGuide: '125',
    synonyms: ['nh3', 'anhydrous ammonia', 'r-717', 'r717'],
    signal: 'DANGER', pictograms: '☠️ ⚗️ ⚠️',
    hazards: ['Toxic if inhaled', 'Causes severe skin burns and eye damage', 'Flammable at high concentrations'],
    categories: ['toxic', 'corrosive'],
    pel: '50 ppm (TWA)', rel: '25 ppm (TWA)', stel: '35 ppm', idlh: '300 ppm',
    lel: '15.0%', uel: '28.0%',
    mw: 17.03, vaporDensity: 0.59, maxPpm: 1000000,
    lelPct: 15.0, uelPct: 28.0,
    idlhPpm: 300, oelPpm: 25, stelPpm: 35, odorPpm: 5,
    aegl: { 1: [30, 30, 30, 30, 30], 2: [220, 220, 160, 110, 110], 3: [2700, 1600, 1100, 550, 390] },
    alarm: { low: 25, high: 50, max: 500, simLeak: 180, basis: 'NIOSH REL / 2× REL' },
    visual: 'white-cloud',
    coldRelease: true,
    effects: [
      { ppm: 5, text: 'Sharp, pungent odour detectable.' },
      { ppm: 25, text: 'Irritation noticeable to most people.' },
      { ppm: 50, text: 'Mild eye, nose and throat irritation; tolerance can develop.' },
      { ppm: 140, text: 'Moderate eye irritation. No lasting effects if exposure is under 2 hours.' },
      { ppm: 400, text: 'Moderate to severe throat irritation.' },
      { ppm: 700, text: 'Immediate, severe irritation of eyes, nose and throat; eye injury possible.' },
      { ppm: 1700, text: 'Coughing and laryngospasm (throat closing up).' },
      { ppm: 2500, text: 'Fatal after about 30 minutes of exposure.' },
      { ppm: 5000, text: 'Rapidly fatal: airway swelling and obstruction.' }
    ],
    atmosphere: [
      'The pure gas is lighter than air (0.59×), but liquefied releases form a cold, dense aerosol cloud that hugs the ground.',
      'Reacts with water vapour to form a visible white fog; also dissolves in eyes, sweat and lungs, causing caustic burns.',
      'Very water-soluble: fine water spray knocks down the cloud (contain the run-off).',
      'Reacts with acidic pollutants to form ammonium particulates (PM2.5).'
    ],
    o2Displacement: '~1% O₂ drop per 5% NH₃ by volume',
    firstAid: 'Move to fresh air. Flush eyes and skin with water for at least 15 minutes. Seek medical attention.',
    ppe: 'Full-face respirator with ammonia cartridge (SCBA above IDLH); splash goggles; butyl gloves',
    detection: 'Electrochemical NH₃ sensor (MQ-135 for demos) · Visible as white cloud on webcam',
    use: 'Industrial refrigeration, fertiliser production, water treatment'
  },
  {
    id: 'chlorine',
    name: 'Chlorine', formula: 'Cl₂', cas: '7782-50-5', un: 'UN1017', ergGuide: '124',
    synonyms: ['cl2', 'chlorine gas', 'liquid chlorine'],
    signal: 'DANGER', pictograms: '☠️ ⚗️ ⭕',
    hazards: ['Fatal if inhaled', 'Causes severe skin burns and eye damage', 'Strong oxidizer'],
    categories: ['toxic', 'corrosive', 'oxidizer'],
    pel: '1 ppm (ceiling)', rel: '0.5 ppm (15-min ceiling)', stel: '1 ppm', idlh: '10 ppm',
    lel: 'Non-flammable', uel: 'Non-flammable',
    mw: 70.90, vaporDensity: 2.45, maxPpm: 1000000,
    lelPct: null, uelPct: null,
    idlhPpm: 10, oelPpm: 0.5, stelPpm: 1, odorPpm: 0.3,
    aegl: { 1: [0.50, 0.50, 0.50, 0.50, 0.50], 2: [2.8, 2.8, 2.0, 1.0, 0.71], 3: [50, 28, 20, 10, 7.1] },
    alarm: { low: 0.5, high: 1, max: 10, simLeak: 3, basis: 'NIOSH REL / OSHA ceiling' },
    visual: 'yellow-green',
    coldRelease: true,
    effects: [
      { ppm: 0.2, text: 'Bleach-like odour detectable (0.2–0.4 ppm).' },
      { ppm: 1, text: 'Mild irritation of eyes, nose and throat.' },
      { ppm: 5, text: 'Moderate irritation of the upper airway; coughing.' },
      { ppm: 30, text: 'Immediate chest pain, vomiting, shortness of breath and cough.' },
      { ppm: 40, text: 'Chemical pneumonitis and fluid in the lungs (pulmonary oedema), sometimes delayed by hours.' },
      { ppm: 430, text: 'Lethal after about 30 minutes.' },
      { ppm: 1000, text: 'Fatal within a few minutes.' }
    ],
    atmosphere: [
      'About 2.5× heavier than air: a greenish-yellow cloud that hugs the ground and flows into basements, trenches and low rooms.',
      'Reacts with moisture (air, eyes, lungs) to form hydrochloric and hypochlorous acid.',
      'Strong oxidiser: can ignite hydrocarbons, and forms explosive nitrogen trichloride when mixed with ammonia.'
    ],
    o2Displacement: 'N/A – toxic long before any oxygen displacement',
    firstAid: 'Remove from exposure. Flush eyes and skin with water. Keep at rest; watch 24–48 h for delayed lung oedema.',
    ppe: 'SCBA; gas-tight chemical suit (Level A) for large releases; no contact with organics',
    detection: 'Electrochemical Cl₂ sensor · Yellow-green cloud visible on camera at high concentration',
    use: 'Water treatment, PVC and bleach manufacturing'
  },
  {
    id: 'co',
    name: 'Carbon Monoxide', formula: 'CO', cas: '630-08-0', un: 'UN1016', ergGuide: '119',
    synonyms: ['co', 'carbonic oxide', 'producer gas'],
    signal: 'DANGER', pictograms: '☠️ 🔥',
    hazards: ['Toxic if inhaled', 'Extremely flammable gas', 'Colourless and odourless'],
    categories: ['toxic', 'flammable'],
    pel: '50 ppm (TWA)', rel: '35 ppm (TWA), 200 ppm ceiling', stel: '200 ppm', idlh: '1,200 ppm',
    lel: '12.5%', uel: '74.0%',
    mw: 28.01, vaporDensity: 0.97, maxPpm: 1000000,
    lelPct: 12.5, uelPct: 74.0,
    idlhPpm: 1200, oelPpm: 35, stelPpm: 200, odorPpm: null,
    aegl: { 1: null, 2: [420, 150, 83, 33, 27], 3: [1700, 600, 330, 150, 130] },
    aeglNote: 'AEGL-1 not recommended by EPA (insufficient data); the NIOSH REL is used as the first tier.',
    alarm: { low: 35, high: 200, max: 1500, simLeak: 400, basis: 'NIOSH REL / ceiling' },
    visual: 'invisible',
    coldRelease: false,
    effects: [
      { ppm: 35, text: 'Headache and dizziness after 6–8 hours of constant exposure.' },
      { ppm: 100, text: 'Slight headache after 2–3 hours.' },
      { ppm: 200, text: 'Headache within 2–3 hours; impaired judgement.' },
      { ppm: 400, text: 'Frontal headache within 1–2 hours; life-threatening after 3 hours.' },
      { ppm: 800, text: 'Dizziness, nausea and convulsions within 45 minutes; unconscious within 2 hours.' },
      { ppm: 1600, text: 'Headache, rapid heartbeat and nausea within 20 minutes; death in under 2 hours.' },
      { ppm: 3200, text: 'Headache, dizziness and nausea in 5–10 minutes; death within 30 minutes.' },
      { ppm: 6400, text: 'Convulsions and respiratory arrest; death in under 20 minutes.' },
      { ppm: 12800, text: 'Unconscious after 2–3 breaths; death in under 3 minutes.' }
    ],
    atmosphere: [
      'Almost the same density as air (0.97×): mixes evenly through a room with no warning colour, odour or irritation.',
      'Binds haemoglobin about 200× more strongly than oxygen, so symptoms build with time even at moderate levels.',
      'Persists in the atmosphere for about 2 months before oxidising to CO₂.'
    ],
    o2Displacement: 'Chemical asphyxiant: blocks oxygen transport in blood',
    firstAid: 'Move to fresh air immediately. Give 100% O₂. CPR if not breathing. Hospital assessment required.',
    ppe: 'SCBA required; filter cartridges do NOT protect against CO',
    detection: 'Electrochemical CO sensor (MQ-7 for demos) · INVISIBLE to cameras',
    use: 'Furnaces, engines, smelting, gas-fired heaters'
  },
  {
    id: 'benzene',
    name: 'Benzene', formula: 'C₆H₆', cas: '71-43-2', un: 'UN1114', ergGuide: '130',
    synonyms: ['c6h6', 'benzol'],
    signal: 'DANGER', pictograms: '☠️ 🔥 ⚕️',
    hazards: ['Carcinogen (IARC Group 1)', 'Highly flammable liquid and vapour', 'Toxic if inhaled at high concentration'],
    categories: ['toxic', 'flammable'],
    pel: '1 ppm (TWA), 5 ppm (STEL)', rel: '0.1 ppm (TWA), 1 ppm (STEL)', stel: '5 ppm', idlh: '500 ppm',
    lel: '1.2%', uel: '7.8%',
    mw: 78.11, vaporDensity: 2.70, maxPpm: 99000,
    lelPct: 1.2, uelPct: 7.8,
    idlhPpm: 500, oelPpm: 1, stelPpm: 5, odorPpm: 1.5,
    aegl: { 1: [130, 73, 52, 18, 9.0], 2: [2000, 1100, 800, 400, 200], 3: [9700, 5600, 4000, 2000, 990] },
    aeglNote: 'EPA flags the higher benzene AEGLs as above 10–50% of the LEL: explosion risk.',
    alarm: { low: 1, high: 5, max: 500, simLeak: 60, basis: 'OSHA PEL / STEL' },
    visual: 'invisible',
    coldRelease: false,
    effects: [
      { ppm: 1.5, text: 'Sweet aromatic odour detectable. Repeated exposure above the PEL raises long-term leukaemia risk.' },
      { ppm: 50, text: 'Headache, tiredness and lassitude after several hours.' },
      { ppm: 250, text: 'Dizziness, drowsiness, headache and nausea.' },
      { ppm: 700, text: 'Rapid heartbeat, tremors, confusion; may lose consciousness.' },
      { ppm: 7500, text: 'Dangerous to life within 30–60 minutes.' },
      { ppm: 20000, text: 'Fatal within 5–10 minutes.' }
    ],
    atmosphere: [
      'Vapour is 2.7× heavier than air: spreads along the floor and can flash back to a distant ignition source.',
      'The liquid evaporates quickly (vapour pressure 75 mmHg at 20 °C), so spills generate vapour continuously.',
      'Takes part in photochemical smog formation; breaks down in air over several days.'
    ],
    o2Displacement: 'Negligible at toxic concentrations',
    firstAid: 'Remove contaminated clothing. Wash skin with soap and water. Move to fresh air. Medical follow-up (blood counts).',
    ppe: 'Supplied-air respirator; chemical-resistant suit; Viton or PVA gloves',
    detection: 'PID (photoionisation) detector · Not visible on standard cameras',
    use: 'Petrochemical processing, solvents, chemical synthesis'
  },
  {
    id: 'so2',
    name: 'Sulfur Dioxide', formula: 'SO₂', cas: '7446-09-5', un: 'UN1079', ergGuide: '125',
    synonyms: ['so2', 'sulphur dioxide', 'sulfurous anhydride'],
    signal: 'DANGER', pictograms: '☠️ ⚗️',
    hazards: ['Toxic if inhaled', 'Severe respiratory irritant', 'Corrosive to moist tissue'],
    categories: ['toxic', 'corrosive'],
    pel: '5 ppm (TWA)', rel: '2 ppm (TWA), 5 ppm (STEL)', stel: '5 ppm', idlh: '100 ppm',
    lel: 'Non-flammable', uel: 'Non-flammable',
    mw: 64.07, vaporDensity: 2.21, maxPpm: 1000000,
    lelPct: null, uelPct: null,
    idlhPpm: 100, oelPpm: 2, stelPpm: 5, odorPpm: 1,
    aegl: { 1: [0.20, 0.20, 0.20, 0.20, 0.20], 2: [0.75, 0.75, 0.75, 0.75, 0.75], 3: [30, 30, 30, 19, 9.6] },
    alarm: { low: 2, high: 5, max: 100, simLeak: 12, basis: 'NIOSH REL / STEL' },
    visual: 'invisible',
    coldRelease: true,
    effects: [
      { ppm: 0.25, text: 'People with asthma may get bronchoconstriction (wheezing, chest tightness), especially when exercising.' },
      { ppm: 1, text: 'Pungent, choking odour and taste detectable.' },
      { ppm: 6, text: 'Immediate irritation of nose and throat.' },
      { ppm: 20, text: 'Eye irritation and coughing.' },
      { ppm: 50, text: 'Severe irritation; tolerable only for a short time.' },
      { ppm: 150, text: 'Tolerable for a few minutes at most.' },
      { ppm: 400, text: 'Immediately dangerous to life: airway burns and fluid in the lungs.' }
    ],
    atmosphere: [
      'About 2.2× heavier than air: pools at floor level and in low areas.',
      'Dissolves in moisture to form sulfurous and sulfuric acid mist (acid rain precursor).',
      'Forms sulfate particulates that reduce visibility and harm lungs downwind.'
    ],
    o2Displacement: 'N/A – toxic long before any oxygen displacement',
    firstAid: 'Move to fresh air. Give O₂. Flush eyes and skin with water. Seek medical attention.',
    ppe: 'Full-face respirator with acid-gas cartridge (SCBA above IDLH); splash goggles',
    detection: 'Electrochemical SO₂ sensor · Not visible (may form white mist in humid air)',
    use: 'Smelting, power plants, food preservation, pulp bleaching'
  },
  {
    id: 'no2',
    name: 'Nitrogen Dioxide', formula: 'NO₂', cas: '10102-44-0', un: 'UN1067', ergGuide: '124',
    synonyms: ['no2', 'nitrogen peroxide', 'dinitrogen tetroxide', 'n2o4', 'nox'],
    signal: 'DANGER', pictograms: '☠️ ⚗️ ⭕',
    hazards: ['Fatal if inhaled', 'Oxidizer', 'Delayed pulmonary oedema (may appear hours later)'],
    categories: ['toxic', 'oxidizer'],
    pel: '5 ppm (ceiling)', rel: '1 ppm (STEL)', stel: '1 ppm', idlh: '13 ppm',
    lel: 'Non-flammable', uel: 'Non-flammable',
    mw: 46.01, vaporDensity: 1.59, maxPpm: 1000000,
    lelPct: null, uelPct: null,
    idlhPpm: 13, oelPpm: 1, stelPpm: 1, odorPpm: 0.12,
    aegl: { 1: [0.50, 0.50, 0.50, 0.50, 0.50], 2: [20, 15, 12, 8.2, 6.7], 3: [34, 25, 20, 14, 11] },
    alarm: { low: 1, high: 5, max: 50, simLeak: 8, basis: 'NIOSH STEL / OSHA ceiling' },
    visual: 'red-brown',
    coldRelease: false,
    effects: [
      { ppm: 0.12, text: 'Sharp, acrid odour detectable.' },
      { ppm: 10, text: 'Irritation of eyes, nose and upper airway. Symptoms can be mild at first even after a dangerous dose.' },
      { ppm: 25, text: 'Bronchitis and patchy pneumonitis, usually reversible.' },
      { ppm: 150, text: 'Bronchiolitis obliterans (scarring of small airways) that can be fatal 3–5 weeks later.' },
      { ppm: 500, text: 'Acute pulmonary oedema; death within 2–10 days.' }
    ],
    atmosphere: [
      'About 1.6× heavier than air; reddish-brown at high concentration.',
      'Reacts with moisture to form nitric acid, and with sunlight and VOCs to form ozone and photochemical smog.',
      'Lung damage is often DELAYED 4–72 hours: anyone exposed needs medical observation even without symptoms.'
    ],
    o2Displacement: 'N/A – toxic long before any oxygen displacement',
    firstAid: 'Remove from exposure. Give O₂. Keep at rest and monitor for 48 hours for delayed pulmonary oedema.',
    ppe: 'SCBA for unknown concentrations; acid-gas respirator cartridges for low levels',
    detection: 'Electrochemical NO₂ sensor · Reddish-brown fume visible on camera',
    use: 'Nitric acid plants, explosives, welding, combustion exhaust'
  },
  {
    id: 'hcn',
    name: 'Hydrogen Cyanide', formula: 'HCN', cas: '74-90-8', un: 'UN1051', ergGuide: '117',
    synonyms: ['hcn', 'prussic acid', 'hydrocyanic acid', 'formonitrile'],
    signal: 'DANGER', pictograms: '☠️ 🔥',
    hazards: ['Fatal if inhaled or absorbed through skin', 'Extremely flammable', 'Blocks cellular respiration'],
    categories: ['toxic', 'flammable'],
    pel: '10 ppm (TWA, skin)', rel: '4.7 ppm (STEL, skin)', stel: '4.7 ppm', idlh: '50 ppm',
    lel: '5.6%', uel: '40.0%',
    mw: 27.03, vaporDensity: 0.93, maxPpm: 829000,
    lelPct: 5.6, uelPct: 40.0,
    idlhPpm: 50, oelPpm: 4.7, stelPpm: 4.7, odorPpm: 2,
    aegl: { 1: [2.5, 2.5, 2.0, 1.3, 1.0], 2: [17, 10, 7.1, 3.5, 2.5], 3: [27, 21, 15, 8.6, 6.6] },
    alarm: { low: 4.7, high: 10, max: 50, simLeak: 12, basis: 'NIOSH STEL / OSHA PEL' },
    visual: 'invisible',
    coldRelease: false,
    effects: [
      { ppm: 2, text: 'Bitter-almond odour, but many people genetically cannot smell it.' },
      { ppm: 18, text: 'Headache and slight symptoms after several hours.' },
      { ppm: 45, text: 'Tolerated for 30–60 minutes without immediate effects.' },
      { ppm: 100, text: 'Fatal after 30–60 minutes.' },
      { ppm: 270, text: 'Immediately fatal.' }
    ],
    atmosphere: [
      'Slightly lighter than air (0.93×): mixes quickly, with no visible cloud.',
      'Highly flammable; can polymerise violently if not stabilised.',
      'Long-lived in the atmosphere (months), but indoors the immediate danger is acute poisoning.'
    ],
    o2Displacement: 'Chemical asphyxiant: blocks cellular use of oxygen',
    firstAid: 'IMMEDIATE: remove from exposure, give 100% O₂, call for cyanide antidote (hydroxocobalamin). CPR only with a barrier device.',
    ppe: 'SCBA mandatory; full chemical suit; antidote kit on-site',
    detection: 'Electrochemical HCN sensor · NOT visible to cameras',
    use: 'Chemical manufacturing (nylon, acrylics), fumigation, electroplating'
  },
  {
    id: 'eto',
    name: 'Ethylene Oxide', formula: 'C₂H₄O', cas: '75-21-8', un: 'UN1040', ergGuide: '119P',
    synonyms: ['eto', 'eo', 'oxirane', 'epoxyethane', 'c2h4o'],
    signal: 'DANGER', pictograms: '☠️ 🔥 ⚕️',
    hazards: ['Carcinogen (IARC Group 1)', 'Extremely flammable gas', 'May cause genetic defects'],
    categories: ['toxic', 'flammable'],
    pel: '1 ppm (TWA), 5 ppm excursion', rel: '<0.1 ppm (TWA), 5 ppm ceiling', stel: '5 ppm', idlh: '800 ppm',
    lel: '3.0%', uel: '100%',
    mw: 44.05, vaporDensity: 1.52, maxPpm: 1000000,
    lelPct: 3.0, uelPct: 100,
    idlhPpm: 800, oelPpm: 1, stelPpm: 5, odorPpm: 260,
    aegl: { 1: null, 2: [80, 80, 45, 14, 7.9], 3: [360, 360, 200, 63, 35] },
    aeglNote: 'AEGL-1 not recommended by EPA; the OSHA PEL is used as the first tier.',
    alarm: { low: 1, high: 5, max: 100, simLeak: 10, basis: 'OSHA PEL / excursion limit' },
    visual: 'invisible',
    coldRelease: true,
    effects: [
      { ppm: 1, text: 'No noticeable warning, but repeated exposure above the PEL raises cancer and reproductive risk.' },
      { ppm: 45, text: 'Serious effects possible with 1 hour of exposure (EPA AEGL-2).' },
      { ppm: 200, text: 'Eye and airway irritation, headache, nausea, vomiting, drowsiness. Life-threatening over 1 hour (AEGL-3).' },
      { ppm: 260, text: 'Sweet ether-like odour finally detectable, well above harmful levels.' },
      { ppm: 1000, text: 'Central nervous system depression and delayed lung injury.' }
    ],
    atmosphere: [
      'About 1.5× heavier than air; boils at 10.7 °C, so leaks flash to gas at room temperature.',
      'Flammable from 3% to 100%: it can decompose explosively even without air.',
      'Breaks down slowly in air (months), and the smell gives no useful warning.'
    ],
    o2Displacement: '~1% O₂ drop per 5% by volume',
    firstAid: 'Move to fresh air. Remove contaminated clothing and shoes. Flush skin and eyes 15 min. Seek medical attention.',
    ppe: 'Supplied-air respirator; chemical-resistant suit; butyl gloves',
    detection: 'EtO-specific electrochemical or PID detector · NOT visible to cameras',
    use: 'Medical device sterilisation, glycol and surfactant production'
  },
  {
    id: 'acetylene',
    name: 'Acetylene', formula: 'C₂H₂', cas: '74-86-2', un: 'UN1001', ergGuide: '116',
    synonyms: ['c2h2', 'ethyne', 'ethine', 'welding gas'],
    signal: 'DANGER', pictograms: '🔥 💨',
    hazards: ['Extremely flammable gas', 'May react explosively even without air', 'Simple asphyxiant'],
    categories: ['flammable', 'asphyxiant'],
    pel: 'None (simple asphyxiant)', rel: '2,500 ppm (ceiling)', stel: '–', idlh: 'Not determined',
    lel: '2.5%', uel: '100%',
    mw: 26.04, vaporDensity: 0.90, maxPpm: 1000000,
    lelPct: 2.5, uelPct: 100,
    idlhPpm: null, oelPpm: 2500, stelPpm: null, odorPpm: null,
    aegl: null,
    alarm: { low: 2500, high: 5000, max: 12500, simLeak: 6000, basis: '10% / 20% of LEL' },
    visual: 'invisible',
    coldRelease: true,
    effects: [
      { ppm: 2500, text: 'NIOSH ceiling limit. Low toxicity; the garlic-like smell comes from impurities in commercial gas.' },
      { ppm: 25000, text: 'Flammable range (2.5–100%): ignites very easily and can decompose explosively.' },
      { ppm: 100000, text: 'Very high concentrations: intoxication, dizziness, headache (acetylene is a narcotic).' },
      { ppm: 300000, text: 'Oxygen displaced to about 15%: loss of consciousness and asphyxiation.' }
    ],
    atmosphere: [
      'Slightly lighter than air (0.90×): mixes readily and accumulates under ceilings.',
      'Widest flammable range of common gases, with a very low ignition energy.',
      'Forms explosive acetylides with copper, silver and mercury; cylinders can decompose if heated or shocked.'
    ],
    o2Displacement: '~1% O₂ drop per 5% C₂H₂ by volume',
    firstAid: 'Move to fresh air. Give O₂ if breathing is difficult.',
    ppe: 'SCBA in confined spaces; eliminate all ignition sources; no copper fittings',
    detection: 'Catalytic combustible-gas detector · Thermal camera (cold plume from cylinder leak)',
    use: 'Welding, cutting, brazing, chemical synthesis'
  }
];

const CHEMICALS_BY_ID = Object.fromEntries(CHEMICALS.map(c => [c.id, c]));

/* ---------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------- */

// Air-displacement estimate: a gas at C ppm by volume leaves O2 at 20.9 × (1 − C/10^6)
function o2FromGasPpm(ppm) {
  return Math.max(0, 20.9 * (1 - ppm / 1e6));
}

function formatPpm(ppm) {
  if (ppm === null || ppm === undefined || !isFinite(ppm)) return '–';
  if (ppm >= 10000) return `${(ppm / 10000).toFixed(ppm >= 100000 ? 0 : 1)}% (${Math.round(ppm).toLocaleString()} ppm)`;
  if (ppm >= 100) return `${Math.round(ppm).toLocaleString()} ppm`;
  if (ppm >= 10) return `${ppm.toFixed(1)} ppm`;
  if (ppm >= 1) return `${ppm.toFixed(2)} ppm`;
  return `${ppm.toPrecision(2)} ppm`;
}

// Pick the AEGL column for an exposure duration, rounding UP to the next
// published period (longer periods have lower, more protective values).
function aeglIndexForMinutes(minutes) {
  for (let i = 0; i < AEGL_DURATIONS_MIN.length; i++) {
    if (minutes <= AEGL_DURATIONS_MIN[i]) return i;
  }
  return AEGL_DURATIONS_MIN.length - 1;
}

// Health effect band for a concentration: the highest listed band at or below ppm
function effectForPpm(chem, ppm) {
  let band = null;
  for (const e of chem.effects) {
    if (ppm >= e.ppm) band = e;
  }
  return band;
}

// Match free text (label, placard, AI output) to a chemical id
function matchChemicalText(text) {
  if (!text) return [];
  const q = ` ${text.toLowerCase().replace(/[₀-₉]/g, d => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(d)])} `;
  const hits = [];
  for (const c of CHEMICALS) {
    const terms = [c.name.toLowerCase(), c.cas, c.un.toLowerCase(), ...c.synonyms];
    const hit = terms.find(t => {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`[^a-z0-9]${esc}[^a-z0-9]`).test(q);
    });
    if (hit) hits.push({ id: c.id, term: hit });
  }
  return hits;
}

/* ---------------------------------------------------------------------
   SDS inventory cards (Live Monitor view)
   --------------------------------------------------------------------- */
function initSDS() {
  const grid = document.getElementById('sdsChemicalGrid');
  const searchInput = document.getElementById('sdsSearchInput');
  const filterSelect = document.getElementById('sdsFilterSelect');
  if (!grid) return;

  function renderCards(filter, search) {
    let chemicals = CHEMICALS;
    if (filter && filter !== 'all') {
      chemicals = chemicals.filter(c => c.categories.includes(filter));
    }
    if (search) {
      const q = search.toLowerCase();
      chemicals = chemicals.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.formula.toLowerCase().includes(q) ||
        c.cas.includes(q) ||
        c.un.toLowerCase().includes(q) ||
        c.synonyms.some(s => s.includes(q)) ||
        c.use.toLowerCase().includes(q)
      );
    }

    grid.innerHTML = chemicals.map(c => `
      <div class="sds-card" data-chem="${c.id}">
        <div class="sds-card-header">
          <div>
            <span class="sds-card-name">${c.name}</span>
            <span class="sds-card-formula">${c.formula}</span>
            <span class="sds-card-cas">CAS ${c.cas} · ${c.un}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="sds-pictograms">${c.pictograms}</span>
            <span class="${c.signal === 'DANGER' ? 'sds-signal-danger' : 'sds-signal-warning'}">${c.signal}</span>
          </div>
        </div>
        <div class="sds-card-body">
          <div class="sds-hazard-tags">
            ${c.hazards.map(h => `<span class="sds-hazard-tag">${h}</span>`).join('')}
          </div>
          <div class="sds-detail-grid">
            <div class="sds-detail-item"><div class="sds-detail-label">OSHA PEL</div><div class="sds-detail-value">${c.pel}</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">NIOSH REL</div><div class="sds-detail-value">${c.rel}</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">STEL</div><div class="sds-detail-value">${c.stel}</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">IDLH</div><div class="sds-detail-value">${c.idlh}</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">LEL</div><div class="sds-detail-value">${c.lel}</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">UEL</div><div class="sds-detail-value">${c.uel}</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">Vapour density</div><div class="sds-detail-value">${c.vaporDensity}× air</div></div>
            <div class="sds-detail-item"><div class="sds-detail-label">ERG guide</div><div class="sds-detail-value">${c.ergGuide}</div></div>
          </div>
          <div class="sds-detail-grid" style="margin-top:6px;">
            <div class="sds-detail-item" style="grid-column:span 2;"><div class="sds-detail-label">O₂ Displacement</div><div class="sds-detail-value" style="font-size:10px;font-weight:500;">${c.o2Displacement}</div></div>
            <div class="sds-detail-item" style="grid-column:span 2;"><div class="sds-detail-label">First Aid</div><div class="sds-detail-value" style="font-size:10px;font-weight:500;">${c.firstAid}</div></div>
            <div class="sds-detail-item" style="grid-column:span 2;"><div class="sds-detail-label">PPE Requirements</div><div class="sds-detail-value" style="font-size:10px;font-weight:500;">${c.ppe}</div></div>
          </div>
          <div class="sds-detection-note">🎯 <strong>Detection:</strong> ${c.detection}</div>
          <button class="btn btn-secondary btn-sm sds-assess-btn" data-assess="${c.id}">⚠️ Model a release of ${c.name}</button>
        </div>
      </div>
    `).join('');
  }

  renderCards('all', '');

  grid.addEventListener('click', (e) => {
    const assessBtn = e.target.closest('[data-assess]');
    if (assessBtn) {
      e.stopPropagation();
      window.gasVisionRouter.go('hazard', { chemical: assessBtn.dataset.assess });
      return;
    }
    const card = e.target.closest('.sds-card');
    if (card) card.classList.toggle('expanded');
  });

  if (searchInput) searchInput.addEventListener('input', () => renderCards(filterSelect.value, searchInput.value));
  if (filterSelect) filterSelect.addEventListener('change', () => renderCards(filterSelect.value, searchInput.value));
}

if (typeof module !== 'undefined') {
  module.exports = { CHEMICALS, CHEMICALS_BY_ID, AEGL_DURATIONS_MIN, AEGL_TIER_TEXT, o2FromGasPpm, formatPpm, aeglIndexForMinutes, effectForPpm, matchChemicalText };
}
