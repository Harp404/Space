/**
 * Space weather → ground segment.      dev/constraints/spaceweather.js
 * =============================================================================
 * Live feed from NOAA's Space Weather Prediction Center. Public JSON, no API
 * key, no registration:  services.swpc.noaa.gov
 *
 *   /products/noaa-planetary-k-index.json   Kp index, updated every minute
 *   /products/alerts.json                   live G / S / R alerts and warnings
 *   /json/ovation_aurora_latest.json        aurora oval as a lat/lon grid
 *
 * WHY THIS BELONGS IN A CONSTRAINT SYSTEM
 *
 * Space weather is not decoration. It closes a loop that nothing else in the
 * system closes:
 *
 *     solar storm
 *       → energetic protons funnel down the field lines at the poles
 *       → HF blacks out above ~63° magnetic latitude (polar cap absorption)
 *       → the POLAR ground stations go deaf
 *       → those are exactly the stations that command LEO spacecraft
 *       → the burn cannot be uplinked
 *       → FR-19 VIOLATED → the maneuver is BLOCKED
 *
 * A constraint on the ground blocks a maneuver in space. Separately, geomagnetic
 * activity expands the upper atmosphere and makes drag — the dominant error
 * source in LEO — unpredictable, which is FR-21.
 *
 * NOAA scales used:
 *   G1-G5  geomagnetic storm   (Kp 5→9)  drives satellite drag
 *   S1-S5  solar radiation storm          drives the polar HF blackout
 *   R1-R5  radio blackout                 drives dayside HF loss
 *
 * Zero dependencies (uses node:https directly).
 * =============================================================================
 */

'use strict';

const https = require('https');

const HOST = 'services.swpc.noaa.gov';
const PATHS = {
  kp: '/products/noaa-planetary-k-index.json',
  alerts: '/products/alerts.json',
};

// Ground stations that actually command LEO spacecraft. The polar ones are the
// workhorses precisely because a polar orbit passes over them every revolution —
// and they are the ones a solar radiation storm takes out first.
const GROUND_STATIONS = [
  { id: 'SVALSAT', name: 'Svalbard (SvalSat)', lat: 78.23, lon: 15.39, mag_lat: 75.3, polar: true },
  { id: 'TROLL',   name: 'Troll (TrollSat)',   lat: -72.01, lon: 2.53, mag_lat: -64.9, polar: true },
  { id: 'INUVIK',  name: 'Inuvik',             lat: 68.36, lon: -133.72, mag_lat: 71.1, polar: true },
  { id: 'MCMURDO', name: 'McMurdo',            lat: -77.85, lon: 166.67, mag_lat: -79.9, polar: true },
  { id: 'KIRUNA',  name: 'Kiruna',             lat: 67.86, lon: 20.96, mag_lat: 64.7, polar: true },
  { id: 'WEILHEIM',name: 'Weilheim',           lat: 47.88, lon: 11.08, mag_lat: 48.2, polar: false },
  { id: 'HARTRAO', name: 'Hartebeesthoek',     lat: -25.89, lon: 27.69, mag_lat: -36.1, polar: false },
  { id: 'ALCANTARA', name: 'Alcântara',        lat: -2.37, lon: -44.4, mag_lat: 5.2, polar: false },
];

// Polar cap absorption blacks out HF above this magnetic latitude during a solar
// radiation storm. Mean duration ~8 h for moderate events, ~1.6 d for severe.
const PCA_MAGLAT = 63;

// ---------------------------------------------------------------------------
// NOAA scales
// ---------------------------------------------------------------------------

/** Kp → NOAA G scale. Kp 5 = G1 … Kp 9 = G5. */
function gScale(kp) {
  if (!Number.isFinite(kp) || kp < 5) return 'G0';
  return 'G' + Math.min(5, Math.max(1, Math.floor(kp) - 4));
}

const G_DESCRIPTION = {
  G0: 'below storm level', G1: 'minor', G2: 'moderate', G3: 'strong', G4: 'severe', G5: 'extreme',
};

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function getJson(path, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: HOST, path, headers: { 'User-Agent': 'AstroMesh/1.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`SWPC ${path} -> HTTP ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('SWPC returned malformed JSON: ' + e.message)); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('SWPC request timed out')); });
  });
}

/**
 * Current conditions from NOAA.
 * Returns null on any failure — which correctly reads as UNRESOLVED downstream,
 * never as "conditions are fine".
 */
async function fetchConditions(attempt = 0) {
  // One retry: the first call can land while the process is busy with a heavy
  // screening pass. A transient timeout should not be reported as a dead feed.
  try {
    return await fetchConditionsOnce();
  } catch (e) {
    if (attempt < 1) return fetchConditions(attempt + 1);
    throw e;
  }
}

async function fetchConditionsOnce() {
  // SWPC serves two shapes across its products: an array of objects, or a
  // spreadsheet-style array whose row 0 is the header. Handle both, because
  // which one you get has changed before and a parser failure here must not
  // silently become "conditions are fine".
  const rows = await getJson(PATHS.kp);
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('SWPC Kp product empty');

  let kp, observedAt = null;
  const last = rows[rows.length - 1];

  if (last && typeof last === 'object' && !Array.isArray(last)) {
    // [{ time_tag, Kp, a_running, station_count }, ...]
    const key = Object.keys(last).find((k) => k.toLowerCase() === 'kp')
      || Object.keys(last).find((k) => k.toLowerCase().includes('kp'));
    kp = Number(last[key]);
    observedAt = last.time_tag || null;
  } else if (Array.isArray(rows[0])) {
    const header = rows[0].map((h) => String(h).toLowerCase());
    const kpIdx = header.findIndex((h) => h.includes('kp'));
    const timeIdx = header.findIndex((h) => h.includes('time'));
    kp = Number(last[kpIdx >= 0 ? kpIdx : 1]);
    observedAt = timeIdx >= 0 ? last[timeIdx] : null;
  }
  if (!Number.isFinite(kp)) throw new Error('SWPC Kp value not numeric');

  let alerts = [];
  try {
    const raw = await getJson(PATHS.alerts);
    // Keep only currently-relevant S (radiation) and R (blackout) alerts.
    alerts = (Array.isArray(raw) ? raw : []).slice(0, 40)
      .map((a) => ({ issued: a.issue_datetime, message: String(a.message || '').split('\n')[0] }))
      .filter((a) => /ALERT|WARNING|WATCH/i.test(a.message));
  } catch { /* alerts are optional; Kp is the load-bearing value */ }

  // Derive the solar-radiation (S) level from any live alert text. A dedicated
  // proton-flux product exists; the alert feed is sufficient and much cheaper.
  const sMatch = alerts.map((a) => a.message.match(/\bS([1-5])\b/)).find(Boolean);
  const rMatch = alerts.map((a) => a.message.match(/\bR([1-5])\b/)).find(Boolean);

  return {
    kp: +kp.toFixed(2),
    scale_g: gScale(kp),
    scale_g_desc: G_DESCRIPTION[gScale(kp)],
    scale_s: sMatch ? 'S' + sMatch[1] : 'S0',
    scale_r: rMatch ? 'R' + rMatch[1] : 'R0',
    observed_at: observedAt,
    alerts: alerts.slice(0, 5),
    source: 'NOAA SWPC (services.swpc.noaa.gov) — live, no API key',
    fetched_at: new Date().toISOString(),
    simulated: false,
  };
}

// ---------------------------------------------------------------------------
// Derived geospatial zones — rendered on the globe, and consumed by FR-19.
// ---------------------------------------------------------------------------

/**
 * The three exposure zones.
 *
 * HONESTY: these are EXPOSURE ZONES, not outage predictions. We say where the
 * documented class of effect applies and cite why. We do not claim a specific
 * ground station, grid or aircraft will fail.
 */
function zones(sw) {
  if (!sw) return null;
  const sLevel = Number(String(sw.scale_s).replace('S', '')) || 0;
  const kp = sw.kp;

  // The auroral oval expands equatorward as Kp rises — roughly 67° at Kp 0 down
  // to about 50° at Kp 9. This is the standard rule-of-thumb boundary.
  const auroralBoundary = Math.max(48, 67 - 2 * kp);

  return {
    auroral_oval: {
      equatorward_boundary_deg: +auroralBoundary.toFixed(1),
      active: kp >= 4,
      effect: 'GNSS scintillation, HF degradation, geomagnetically induced currents in high-latitude grids',
      basis: 'auroral boundary expands equatorward with Kp',
    },
    polar_cap_absorption: {
      magnetic_latitude_deg: PCA_MAGLAT,
      active: sLevel >= 1,
      level: sw.scale_s,
      effect: `total HF blackout above ${PCA_MAGLAT}° magnetic latitude`,
      typical_duration: sLevel >= 3 ? '~1.6 days (severe)' : '~8 hours (moderate)',
      basis: 'polar cap absorption during a solar radiation storm',
    },
    equatorial_scintillation: {
      band_deg: 20,
      active: kp >= 3,
      effect: 'GNSS positioning degradation within ±20° of the magnetic equator after sunset',
      basis: 'post-sunset equatorial plasma bubbles',
    },
  };
}

/** Ground-station availability under current conditions — the input to FR-19. */
function groundSegment(sw) {
  if (!sw) return null;
  const z = zones(sw);
  const blackout = z.polar_cap_absorption.active;
  const stations = GROUND_STATIONS.map((s) => {
    const inPca = blackout && Math.abs(s.mag_lat) >= PCA_MAGLAT;
    return {
      ...s,
      available: !inPca,
      reason: inPca ? `polar cap absorption (${sw.scale_s}) — HF blackout above ${PCA_MAGLAT}° magnetic latitude` : null,
    };
  });
  const available = stations.filter((s) => s.available).length;
  return {
    stations,
    stations_assigned: stations.length,
    stations_available: available,
    blackout_reason: blackout ? `${sw.scale_s} solar radiation storm — ${stations.length - available} polar station(s) in HF blackout` : null,
  };
}

// ---------------------------------------------------------------------------
// Historical replays — real recorded events, so the system can be shown behaving
// correctly during a crisis that actually happened.
// ---------------------------------------------------------------------------

const REPLAYS = {
  gannon: {
    id: 'gannon',
    title: 'Gannon storm — 10 May 2024',
    summary: 'The strongest geomagnetic storm in over two decades.',
    conditions: {
      kp: 9.0, scale_g: 'G5', scale_g_desc: 'extreme', scale_s: 'S1', scale_r: 'R3',
      observed_at: '2024-05-11 00:00:00.000',
      alerts: [{ issued: '2024-05-10', message: 'ALERT: Geomagnetic K-index of 9 (G5 - Extreme)' }],
      source: 'recorded historical conditions — NOAA SWPC archive',
      simulated: true,
      replay: 'gannon',
    },
    documented_effects: [
      'About half of the ~10,000 LEO payloads manoeuvred — the largest satellite migration on record',
      'A peer-reviewed assessment called it a serious challenge for existing conjunction assessment infrastructure',
      'One Starlink satellite\'s re-entry was accelerated by roughly 11 days',
      'GPS positions were off by up to 70 m',
      'About $500 million of losses to US midwest farmers, during planting season, across 12 states',
    ],
    citations: ['AIAA J. Spacecraft & Rockets — Satellite Drag Analysis During the May 2024 Gannon Geomagnetic Storm'],
  },
};

function replay(id) {
  const r = REPLAYS[id];
  if (!r) return null;
  return { ...r, zones: zones(r.conditions), groundSegment: groundSegment(r.conditions) };
}

module.exports = {
  fetchConditions, zones, groundSegment, gScale,
  GROUND_STATIONS, PCA_MAGLAT, REPLAYS, replay,
};
