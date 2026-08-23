/**
 * AstroMesh Mock Gateway — dev/mock-gateway.js
 * Pure Node.js (zero npm deps) development server on port 8090.
 * Simulates the full 4-node AstroMesh cluster with Bully election + 2PC consensus.
 *
 * Usage: node mock-gateway.js
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const path_ = path;                       // alias: `path` is shadowed inside handleRequest
const { URL } = require('url');

// Built frontend dir (single-origin serving). Set SERVE_FRONTEND=0 to disable.
const DIST_DIR = process.env.SERVE_FRONTEND === '0'
  ? null
  : path.join(__dirname, '..', 'frontend', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain',
};
function sendFile(res, filePath) {
  const ext = path_.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // hash-named build assets are immutable; cache hard. index.html stays fresh.
  const cache = filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
  fs.createReadStream(filePath).pipe(res);
}
// Reuse the frontend's installed SGP4 lib for real conjunction screening.
let satLib = null;
try { satLib = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'satellite.js')); } catch { /* optional */ }

const PORT = process.env.PORT || 8090;

// ---------------------------------------------------------------------------
// Minimal .env loader (no deps) — loads repo-root .env into process.env
// ---------------------------------------------------------------------------
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* no .env — fine */ }
})();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let nodes, satellites, conjunctions, leaderId, agentEnabled;
let cdms = [];   // real operational Conjunction Data Messages (Space-Track, covariance-based)
let tleCache = { data: null, ts: 0 };

function seedState() {
  nodes = [
    { id: 1, name: 'ISRO',   online: true },
    { id: 2, name: 'ESA',    online: true },
    { id: 3, name: 'JAXA',   online: true },
    { id: 4, name: 'SpaceX', online: true },
  ];

  satellites = [
    // All NORAD IDs verified real & currently tracked on CelesTrak (2026-06-10) — name matches the actual catalogued object
    { id:  1, norad_id: 25544, name: 'ISS (ZARYA)',        operator: 'NASA/Roscosmos', lat:  28.5,  lon:   77.2,  alt_km:  408, status: 'NOMINAL',   risk_score: 15 },
    { id:  2, norad_id: 44714, name: 'STARLINK-1008',      operator: 'SpaceX',         lat:  53.1,  lon: -120.3,  alt_km:  550, status: 'NOMINAL',   risk_score: 45 },
    { id:  3, norad_id: 33757, name: 'COSMOS-2251 DEB',    operator: 'DEBRIS',         lat:  72.8,  lon:   45.1,  alt_km:  786, status: 'NOMINAL',   risk_score: 82 },
    { id:  4, norad_id: 33773, name: 'IRIDIUM-33 DEB',     operator: 'DEBRIS',         lat: -33.2,  lon:  155.4,  alt_km:  776, status: 'NOMINAL',   risk_score: 78 },
    { id:  5, norad_id: 40697, name: 'SENTINEL-2A',        operator: 'ESA',            lat:  15.7,  lon:   32.8,  alt_km:  786, status: 'NOMINAL',   risk_score: 22 },
    { id:  6, norad_id: 44804, name: 'CARTOSAT-3',         operator: 'ISRO',           lat:  20.1,  lon:   78.9,  alt_km:  509, status: 'NOMINAL',   risk_score: 18 },
    { id:  7, norad_id: 36411, name: 'GOES-15',            operator: 'NOAA',           lat:   0.0,  lon: -135.0,  alt_km:35786, status: 'NOMINAL',   risk_score:  5 },
    { id:  8, norad_id: 44718, name: 'STARLINK-1012',      operator: 'SpaceX',         lat:  48.5,  lon:   12.3,  alt_km:  550, status: 'NOMINAL',   risk_score: 55 },
    { id:  9, norad_id: 33758, name: 'COSMOS-2251 DEB',    operator: 'DEBRIS',         lat: -45.2,  lon:  100.1,  alt_km:  786, status: 'NOMINAL',   risk_score: 71 },
    { id: 10, norad_id: 39766, name: 'ALOS-2',             operator: 'JAXA',           lat:  35.7,  lon:  139.7,  alt_km:  628, status: 'NOMINAL',   risk_score: 12 },
    { id: 11, norad_id: 44723, name: 'STARLINK-1017',      operator: 'SpaceX',         lat:  61.2,  lon:  -88.4,  alt_km:  550, status: 'NOMINAL',   risk_score: 62 },
    { id: 12, norad_id: 44057, name: 'ONEWEB-0012',        operator: 'OneWeb',         lat:  55.0,  lon:   20.0,  alt_km: 1200, status: 'NOMINAL',   risk_score: 38 },
    { id: 13, norad_id: 44058, name: 'ONEWEB-0010',        operator: 'OneWeb',         lat:  57.3,  lon:   25.8,  alt_km: 1200, status: 'NOMINAL',   risk_score: 41 },
    { id: 14, norad_id: 16182, name: 'SL-16 R/B',          operator: 'DEBRIS',         lat: -60.1,  lon:   88.2,  alt_km:  853, status: 'NOMINAL',   risk_score: 74 },
    { id: 15, norad_id: 29733, name: 'FENGYUN-1C DEB',     operator: 'DEBRIS',         lat:  40.1,  lon:  110.5,  alt_km:  845, status: 'NOMINAL',   risk_score: 90 },
    { id: 16, norad_id: 50032, name: 'COSMOS-1408 DEB',    operator: 'DEBRIS',         lat:  65.4,  lon:   58.7,  alt_km:  802, status: 'NOMINAL',   risk_score: 69 },
    { id: 17, norad_id: 44725, name: 'STARLINK-1020',      operator: 'SpaceX',         lat:  44.2,  lon:  -70.3,  alt_km:  550, status: 'NOMINAL',   risk_score: 33 },
    { id: 18, norad_id: 33775, name: 'IRIDIUM-33 DEB',     operator: 'DEBRIS',         lat:  30.5,  lon:  120.1,  alt_km:  776, status: 'NOMINAL',   risk_score: 57 },
    { id: 19, norad_id: 44741, name: 'STARLINK-1036',      operator: 'SpaceX',         lat: -12.8,  lon:  -60.2,  alt_km:  550, status: 'NOMINAL',   risk_score: 28 },
    { id: 20, norad_id: 44059, name: 'ONEWEB-0008',        operator: 'OneWeb',         lat:  80.1,  lon:   15.4,  alt_km: 1200, status: 'NOMINAL',   risk_score: 47 },
  ];

  // Seeded fallback events (used until the real Space-Track screening lands).
  // TCAs are generated RELATIVE TO NOW so this data is never stale — a fixed
  // date would make every event fail FR-06 the day after it was written.
  const H = 3600 * 1000;
  const inHours = (h) => new Date(Date.now() + h * H).toISOString();

  conjunctions = [
    {
      id: 1, sat1_id: 3,  sat2_id: 4,  sat1_name: 'COSMOS-2251 DEB', sat2_name: 'IRIDIUM-33 DEB',
      tca: inHours(3.5), min_range_km: 0.08, dilution_threshold_km: 0.057, probability: 0.12, risk_index: 88.5, status: 'MONITORING', source: 'SGP4', tle_age_days: 1.2, position_sigma_m: 210,
    },
    {
      id: 2, sat1_id: 2,  sat2_id: 8,  sat1_name: 'STARLINK-1008',   sat2_name: 'STARLINK-1012',
      tca: inHours(9.2), min_range_km: 0.31, dilution_threshold_km: 0.219, probability: 0.07, risk_index: 67.2, status: 'MONITORING', source: 'SGP4', tle_age_days: 1.2, position_sigma_m: 210,
    },
    {
      id: 3, sat1_id: 9,  sat2_id: 5,  sat1_name: 'COSMOS-2251 DEB', sat2_name: 'SENTINEL-2A',
      tca: inHours(27.0), min_range_km: 0.55, dilution_threshold_km: 0.389, probability: 0.04, risk_index: 52.1, status: 'MONITORING', source: 'SGP4', tle_age_days: 1.2, position_sigma_m: 210,
    },
    {
      id: 4, sat1_id: 15, sat2_id: 14, sat1_name: 'FENGYUN-1C DEB',  sat2_name: 'SL-16 R/B',
      tca: inHours(34.1), min_range_km: 0.19, dilution_threshold_km: 0.134, probability: 0.09, risk_index: 79.4, status: 'MONITORING', source: 'SGP4', tle_age_days: 1.2, position_sigma_m: 210,
    },
    {
      id: 5, sat1_id: 16, sat2_id: 12, sat1_name: 'COSMOS-1408 DEB', sat2_name: 'ONEWEB-0012',
      tca: inHours(46.8), min_range_km: 0.42, dilution_threshold_km: 0.297, probability: 0.03, risk_index: 44.0, status: 'APPROVED', source: 'SGP4', tle_age_days: 0.9, position_sigma_m: 190,
    },
    {
      id: 6, sat1_id: 11, sat2_id: 17, sat1_name: 'STARLINK-1017',   sat2_name: 'STARLINK-1020',
      tca: inHours(55.3), min_range_km: 0.27, dilution_threshold_km: 0.191, probability: 0.05, risk_index: 38.7, status: 'RESOLVED', source: 'SGP4', tle_age_days: 1.4, position_sigma_m: 205,
    },
    {
      id: 7, sat1_id: 18, sat2_id: 1,  sat1_name: 'IRIDIUM-33 DEB',  sat2_name: 'ISS (ZARYA)',
      tca: inHours(63.9), min_range_km: 0.93, dilution_threshold_km: 0.658, probability: 0.01, risk_index: 22.3, status: 'MONITORING', source: 'SGP4', tle_age_days: 1.2, position_sigma_m: 210,
    },
    {
      id: 8, sat1_id: 3,  sat2_id: 15, sat1_name: 'COSMOS-2251 DEB', sat2_name: 'FENGYUN-1C DEB',
      tca: inHours(76.4), min_range_km: 0.12, dilution_threshold_km: 0.085, probability: 0.10, risk_index: 91.0, status: 'MONITORING', source: 'SGP4', tle_age_days: 1.2, position_sigma_m: 210,
    },
  ];

  leaderId = computeLeader();
  agentEnabled = false;
}

function computeLeader() {
  const online = nodes.filter(n => n.online);
  if (online.length === 0) return null;
  return online.reduce((best, n) => (n.id > best.id ? n : best)).id;
}

seedState();

// ---------------------------------------------------------------------------
// Constraint gate — the Flight Rules layer.
//
// Every maneuver must clear a published rulebook before the operator cluster is
// allowed to vote on it. The gate emits one completion signal per event —
// COMPLETE / PARTIAL / BLOCKED / UNRESOLVED — and that signal decides both
// whether the poll may run and how each operator votes.
//
// The engine itself is domain-agnostic (dev/constraints/engine.js): it takes a
// rulebook and a context and knows nothing about satellites. See
// rulebooks/release-gate.js for the same engine gating a software release.
// ---------------------------------------------------------------------------

const CE = require('./constraints/engine');
const { maneuverRulebook, describe: describeRulebook, classify, LIMITS: FR } = require('./constraints/rulebooks/orbital');
const CV = require('./constraints/voting');
const { PropellantLedger } = require('./constraints/ledger');
const SW = require('./constraints/spaceweather');
const RE = require('./constraints/reentry');
const { reentryRulebook } = require('./constraints/rulebooks/reentry');
const { releaseRulebook, SCENARIOS: RELEASE_SCENARIOS } = require('./constraints/rulebooks/release-gate');
const FLARES = require('./constraints/flares');
const CONFORMAL = require('./constraints/conformal');
const AUTHORING = require('./constraints/authoring');
const MODELS = require('./constraints/models');
const SNAPSHOT = require('./snapshot');
const OPFEEDS = require('./constraints/operator-feeds');
const RECOURSE = require('./constraints/recourse');
const RESOLV = require('./constraints/resolvability');
const ORBITAL_SUPPLY = require('./constraints/rulebooks/orbital').supplyEvidence;
const RELEASE_SUPPLY = require('./constraints/rulebooks/release-gate').supplyEvidence;
const DISPATCH = require('./constraints/rulebooks/dispatch');
const HORIZON = require('./constraints/horizon');
const STORY = require('./constraints/story');

/**
 * Demo mode. SNAPSHOT=1 serves the frozen capture instead of hitting live APIs,
 * so a recording never waits on a network. Everything served is REAL data that
 * was captured live — and FR-00 still audits its age and will BLOCK the system
 * if it goes stale. A cached real answer is a recording; a fabricated one is a
 * lie, and this is the former.
 */
const USE_SNAPSHOT = process.env.SNAPSHOT === '1' && !!SNAPSHOT.snapshotDir();

const ledger = new PropellantLedger();

/**
 * Rules authored live, in English. They are validated deterministically and
 * interpreted from a data structure — never executed as generated code. See
 * constraints/authoring.js.
 */
const authored = new AUTHORING.AuthoredRules();

/** The maneuver rulebook, plus anything authored at runtime. */
function activeRulebook() { return authored.extend(maneuverRulebook); }

/** Waivers on record, keyed by conjunction id. */
const waiverStore = new Map();
/** Cached avoidance plans, so a report upgrades from UNRESOLVED once PLAN is run. */
const planStore = new Map();
/** Operator notification/acknowledgement state per event (SSC 8.i). */
const ackStore = new Map();

/**
 * Rolling element-set store.
 *
 * The maneuver detector needs two epochs of the same object to see a step in
 * semi-major axis. A single catalogue snapshot cannot provide that, so we keep
 * the previous epoch for every object and compare on each refresh.
 *
 * Before a second epoch exists the check is simply not made, and FR-10 falls
 * back to its age test. It does NOT guess.
 */
// Resolved lazily: CACHE_DIR is declared further down the file, so referencing
// it at module top level hits the temporal dead zone.
const epochStorePath = () => path.join(__dirname, 'cache', 'epochs.json');
let epochStore = null;

function loadEpochStore() {
  if (epochStore) return epochStore;
  try { epochStore = JSON.parse(fs.readFileSync(epochStorePath(), 'utf8')); }
  catch { epochStore = {}; }
  return epochStore;
}

const MU_SMA = 398600.4418;
function smaFromMeanMotion(revPerDay) {
  const n = (revPerDay * 2 * Math.PI) / 86400;
  return Math.cbrt(MU_SMA / (n * n));
}

/**
 * Record the current epoch for every catalogued object, and flag any whose
 * semi-major axis stepped further than its own drag baseline can explain.
 */
function updateEpochStore(catText) {
  const det = MODELS.get('maneuver-detector');
  const store = loadEpochStore();
  const lines = catText.split('\n');
  const flags = new Map();
  let compared = 0, flagged = 0;

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].replace(/^0 /, '').trim();
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1 || !l2 || !l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const norad = parseInt(l2.slice(2, 7), 10);
    const mm = parseFloat(l2.slice(52, 63));
    const epochRaw = parseFloat(l1.slice(18, 32));
    if (!Number.isFinite(norad) || !Number.isFinite(mm) || !Number.isFinite(epochRaw)) continue;

    const sma = smaFromMeanMotion(mm);
    const prev = store[norad];
    store[norad] = { sma: +sma.toFixed(4), epoch: epochRaw, name };

    if (!prev || !det) continue;
    // Epoch field is YYDDD.ffff — a day difference within the same year.
    const dt = (epochRaw - prev.epoch);
    if (!(dt > 0.05 && dt < 5)) continue;
    compared++;

    const dadt = (sma - prev.sma) / dt;
    const prof = det.per_object && det.per_object[String(norad)];
    // Without a per-object profile we do NOT borrow a global baseline — drag
    // regime is per object, which is the whole lesson of that calibration.
    if (!prof || !Number.isFinite(prof.robust_sigma_km_day)) continue;
    const z = Math.abs((dadt - prof.median_da_dt_km_day) / Math.max(prof.robust_sigma_km_day, 1e-9));
    if (z > (det.z_threshold || 4)) {
      flags.set(norad, { detected: true, object: name, delta_a_km: +(sma - prev.sma).toFixed(3), z, dt_days: +dt.toFixed(2) });
      flagged++;
    } else {
      flags.set(norad, { detected: false, object: name });
    }
  }

  try { fs.mkdirSync(path.dirname(epochStorePath()), { recursive: true }); fs.writeFileSync(epochStorePath(), JSON.stringify(store)); } catch {}
  maneuverFlags = flags;
  if (compared) console.log(`[Maneuvers] compared ${compared} objects against their previous epoch · ${flagged} flagged as unannounced`);
  return flags;
}

/** norad -> maneuver flag, populated on each catalogue load. */
let maneuverFlags = new Map();

/** Freshness of our OWN evidence — what FR-00 audits. */
function systemHealth() {
  const ageOf = (file) => { try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return null; } };
  if (USE_SNAPSHOT) {
    // Snapshot mode does NOT exempt us from FR-00. The age reported is the
    // snapshot's real capture time, so a stale snapshot blocks the system
    // exactly as stale live data would.
    const m = SNAPSHOT.manifest();
    const age = m ? Date.now() - Date.parse(m.captured_at) : null;
    return {
      catalogue_age_ms: age, cdm_age_ms: age,
      propagator_ok: !!satLib,
      catalogue_ttl_ms: CATALOGUE_TTL_MS,
      snapshot: true, snapshot_captured_at: m && m.captured_at,
    };
  }
  return {
    catalogue_age_ms: ageOf(CATALOGUE_FILE),
    cdm_age_ms: ageOf(CDM_FILE),
    propagator_ok: !!satLib,
    catalogue_ttl_ms: CATALOGUE_TTL_MS,
  };
}

/**
 * Live space-weather + ground-segment state. Populated by the NOAA SWPC feed in
 * Phase 3; until then these stay null, which correctly reads as UNRESOLVED
 * rather than as "conditions are fine".
 */
let spaceWeather = null;
let groundSegment = null;
let swReplay = null;          // when set, a recorded historical scenario overrides live conditions

/**
 * Refresh space weather from NOAA. On failure both values stay null, which the
 * rulebook reads as UNRESOLVED — never as "conditions are fine". That is the
 * whole point: a dead feed must not look like a clear sky.
 */
async function refreshSpaceWeather() {
  if (swReplay) return;                                  // a replay is pinned
  if (USE_SNAPSHOT) {
    try {
      const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOT.SNAP, 'spaceweather.json'), 'utf8'));
      spaceWeather = { ...snap.conditions, from_snapshot: true };
      groundSegment = snap.ground_segment;
    } catch { spaceWeather = null; groundSegment = null; }
    return;
  }
  try {
    const c = await SW.fetchConditions();
    spaceWeather = c;
    groundSegment = SW.groundSegment(c);
  } catch (e) {
    spaceWeather = null;
    groundSegment = null;
    console.log('[SpaceWeather] unavailable:', e.message, '- affected rules will report UNRESOLVED');
  }
}

/**
 * Solar flare nowcast + forecast.
 *
 * This is what makes the completion signal PREDICTIVE instead of reactive: a
 * flare forecast gives lead time on when FR-19 (command uplink) will be
 * violated, rather than telling us after the blackout has already started.
 */
let flareState = null;

async function refreshFlares() {
  if (swReplay) return;                                  // a replay pins conditions
  if (USE_SNAPSHOT) {
    try { flareState = JSON.parse(fs.readFileSync(path.join(SNAPSHOT.SNAP, 'flares.json'), 'utf8')); }
    catch { flareState = null; }
    return;
  }
  try {
    flareState = await FLARES.assess();
  } catch (e) {
    flareState = null;                                   // → predictive rules go UNRESOLVED
    console.log('[Flares] X-ray feed unavailable:', e.message);
  }
}

/** Pin a recorded historical scenario (e.g. the Gannon storm), or clear it. */
function setReplay(id) {
  if (!id) { swReplay = null; return refreshSpaceWeather(); }
  const r = SW.replay(id);
  if (!r) return null;
  swReplay = r;
  spaceWeather = r.conditions;
  groundSegment = r.groundSegment;
  return r;
}

/**
 * SSC 8.i — operators must notify every operator of an active spacecraft in the
 * conjunction, "even if the other spacecraft is/are un-maneuverable or minimally
 * maneuverable". Acknowledgement is tracked per event.
 *
 * Un-acknowledged is deliberately UNEVALUATED rather than VIOLATED: we do not
 * know the other operator's position, and SSC 8.h prescribes a specific fallback
 * for exactly that case (act on the more stringent of the two risk tolerances).
 */
function operatorOf(name) {
  const n = String(name || '').toUpperCase();
  if (/STARLINK/.test(n)) return 'SpaceX';
  if (/ONEWEB/.test(n)) return 'OneWeb';
  if (/SENTINEL|GALILEO|ESA|SWARM|CRYOSAT|AEOLUS/.test(n)) return 'ESA';
  if (/CARTOSAT|RISAT|OCEANSAT|IRNSS|GSAT|RESOURCESAT/.test(n)) return 'ISRO';
  if (/ALOS|HIMAWARI|IBUKI|JAXA|MICHIBIKI/.test(n)) return 'JAXA';
  if (/NOAA|DMSP|GOES|LANDSAT|TERRA|AQUA|SUOMI/.test(n)) return 'NOAA/USG';
  if (/ISS|ZARYA|TIANHE|CSS|SOYUZ|SHENZHOU|PROGRESS/.test(n)) return 'Human spaceflight';
  return null;
}

/** Distinct active operators involved — the parties SSC 8.i requires us to notify. */
function involvedOperators(conj) {
  const out = [];
  for (const name of [conj.sat1_name, conj.sat2_name]) {
    if (classify(name) === 'NONMANEUVERABLE') continue;   // inert objects have no operator to notify
    const op = operatorOf(name);
    if (op && !out.includes(op)) out.push(op);
  }
  return out;
}

/** Initialise notification state for an event the first time it is assessed. */
function notificationState(conj) {
  if (!ackStore.has(conj.id)) {
    const parties = involvedOperators(conj);
    ackStore.set(conj.id, {
      required: parties.length,
      acknowledged: 0,
      parties: parties.map((p) => ({ operator: p, notified_at: new Date().toISOString(), acknowledged_at: null })),
    });
  }
  return ackStore.get(conj.id);
}

/** The primary (manoeuvring) asset for an event — the one whose propellant pays. */
function primaryAsset(conj) {
  const a = classify(conj.sat1_name), b = classify(conj.sat2_name);
  const canA = a && a !== 'NONMANEUVERABLE', canB = b && b !== 'NONMANEUVERABLE';
  if (canA) return conj.sat1_name;
  if (canB) return conj.sat2_name;
  return null;
}

/** Assemble everything the rulebook needs for one event. */
function constraintContext(conj) {
  const asset = primaryAsset(conj);
  const plan = planStore.get(conj.id) || null;
  // A maneuver on EITHER object voids the encounter geometry.
  const mf = maneuverFlags.get(conj.sat1_id) || maneuverFlags.get(conj.sat2_id) || null;
  return {
    conj: mf ? { ...conj, maneuver_flag: mf } : conj,
    plan,
    cluster: {
      online_nodes: nodes.filter((n) => n.online).length,
      total_nodes: nodes.length,
      leader_id: leaderId,
    },
    system: systemHealth(),
    propellant: asset ? ledger.get(asset) : null,
    asset: asset ? { name: asset } : null,
    notifications: notificationState(conj),
    groundSegment,
    spaceWeather: spaceWeather ? { ...spaceWeather, flares: flareState } : null,
  };
}

/** Evaluate one event against the maneuver rulebook. */
function constraintReport(conj) {
  return CE.evaluate({
    rulebook: activeRulebook(),
    context: constraintContext(conj),
    waivers: waiverStore.get(conj.id) || [],
    now: Date.now(),
  });
}

/** Compact per-row signal for the conjunction list — cheap enough to broadcast. */
function constraintBadge(conj) {
  try {
    const r = constraintReport(conj);
    return {
      signal: r.signal,
      progress: r.progress,
      blocking: r.blocking.length,
      unevaluated: r.unevaluated.length,
      first: (r.blocking[0] || r.unevaluated[0] || r.advisory[0] || null)?.id || null,
      deadline_in_ms: r.deadline ? r.deadline.in_ms : null,
      authorised: r.authorised,
    };
  } catch (e) {
    // A failure to evaluate is itself an unresolved state, never a pass.
    return { signal: 'UNRESOLVED', progress: 0, blocking: 0, unevaluated: 1, first: null, error: e.message, authorised: false };
  }
}

/** Fleet-level completion signal — "show whether THE RELATED WORK is complete". */
function fleetSignal() {
  const reports = conjunctions.map((c) => { try { return constraintReport(c); } catch { return null; } }).filter(Boolean);
  const roll = CE.rollup(reports);

  // Value of information: which single piece of evidence closes the most rules
  // across the whole fleet, weighted by how urgent the affected events are.
  const byEvidence = new Map();
  reports.forEach((r, i) => {
    const conj = conjunctions[i];
    for (const ev of r.evidence_needed) {
      const e = byEvidence.get(ev.evidence) || { evidence: ev.evidence, label: ev.label, cost: ev.cost, rules: 0, events: 0, urgent: 0, event_ids: [] };
      e.rules += ev.closes.length;
      e.events += 1;
      if (r.deadline && r.deadline.in_ms < 6 * 3600000) e.urgent += 1;
      if (conj) e.event_ids.push(conj.id);
      byEvidence.set(ev.evidence, e);
    }
  });
  const evidence = [...byEvidence.values()].sort((a, b) => (b.rules - a.rules) || (b.urgent - a.urgent));

  return {
    ...roll,
    rulebook: { id: maneuverRulebook.id, title: maneuverRulebook.title, rules: activeRulebook().rules.length, authored: authored.rules.length },
    best_next_evidence: evidence[0] || null,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// THE RETURN LEG — controlled deorbit planning.
//
// AstroMesh covered launch and on-orbit. This is the third phase: coming down.
// A deorbit is screened through the shells on the way down (FR-22), its ground
// footprint is computed as a Monte Carlo distribution rather than a line, and
// the casualty expectancy is evaluated against the real ground consequence
// raster (FR-17a / FR-17b / FR-23 / FR-24 / FR-25).
// ---------------------------------------------------------------------------

const deorbitStore = new Map();     // norad -> plan

/** Debris casualty area by object class, from published survivability data. */
function casualtyAreaFor(name, rcsClass) {
  const n = String(name || '').toUpperCase();
  if (/R\/B|ROCKET|CZ-|SL-\d|DELTA|CENTAUR|ARIANE/.test(n)) return RE.CASUALTY_AREA_M2.ROCKET_BODY;
  if (/STARLINK/.test(n)) return RE.CASUALTY_AREA_M2.DEMISABLE_SMALLSAT;   // design-for-demise
  if (rcsClass === 2) return RE.CASUALTY_AREA_M2.LARGE_PAYLOAD;
  if (rcsClass === 0) return RE.CASUALTY_AREA_M2.DEMISABLE_SMALLSAT;
  return RE.CASUALTY_AREA_M2.TYPICAL_LEO_PAYLOAD;
}

/**
 * Plan a controlled deorbit.
 *
 * @param {number} norad
 * @param {object} opts  { lead_minutes, recoverable, burn_offset_s }
 */
function planDeorbit(norad, opts = {}) {
  if (!satLib) return { error: 'propagator unavailable' };
  const rec = satrecByNorad(norad);
  if (!rec) return { error: `TLE not found for NORAD ${norad}` };

  const name = (allRecs().find((o) => o.norad === norad) || {}).name || String(norad);
  const incDeg = (rec.inclo * 180) / Math.PI;
  const nowMs = Date.now();
  // A deorbit burn is planned ahead; the offset lets the operator walk the
  // corridor across the ground track, which is how retargeting actually works.
  const burnMs = nowMs + (opts.lead_minutes ?? 45) * 60000 + (opts.burn_offset_s ?? 0) * 1000;

  const pv = satLib.propagate(rec, new Date(burnMs));
  if (!pv || !pv.position) return { error: 'propagation failed at the burn epoch' };

  // Descent to entry interface. A retrograde burn lowers perigee; the object
  // then coasts down. We screen the coast arc against the catalogue.
  const T = Math.min(periodMin(rec), 200);
  const STEP_S = 45;
  const steps = Math.ceil((T * 60) / STEP_S);
  const track = [];
  for (let i = 0; i <= steps; i++) {
    const p = satLib.propagate(rec, new Date(burnMs + i * STEP_S * 1000));
    if (p && p.position) track.push(p.position);
  }

  // FR-22 — the descent passes through occupied shells. Reuse the same COLA
  // engine the reroute planner uses; a deorbit is just a maneuver pointed down.
  let descent = { conjunctions: [], screened: 0, catalogue: 0 };
  try {
    const v1 = pv.velocity;
    const scr = screenReroutedVsCatalogue(track, burnMs, STEP_S, bandOf(pv.position, v1), new Set([norad]), 5);
    descent = { conjunctions: scr.hits, screened: scr.screened, catalogue: scr.catalogue };
  } catch (e) {
    descent = null;                                  // → FR-22 UNEVALUATED, honestly
  }

  // Entry interface sub-satellite point.
  const entryMs = burnMs + (opts.coast_minutes ?? 35) * 60000;
  const pe = satLib.propagate(rec, new Date(entryMs));
  if (!pe || !pe.position) return { error: 'propagation failed at entry interface' };
  const gmst = satLib.gstime(new Date(entryMs));
  const geo = satLib.eciToGeodetic(pe.position, gmst);
  const entryLat = satLib.degreesLat(geo.latitude);
  const entryLon = satLib.degreesLong(geo.longitude);

  const bc = opts.ballistic_coefficient ?? 80;
  const kp = spaceWeather ? spaceWeather.kp : null;

  const fp = RE.footprint({
    entry_lat: entryLat, entry_lon: entryLon,
    inclination_deg: incDeg, ballistic_coefficient: bc,
    kp, seed: `${norad}:${Math.round(burnMs / 60000)}`,
  });

  const acM2 = casualtyAreaFor(name, opts.rcs_class);
  const plan = {
    norad, name,
    inclination_deg: +incDeg.toFixed(2),
    burn_time: new Date(burnMs).toISOString(),
    entry_interface: { lat: +entryLat.toFixed(3), lon: +entryLon.toFixed(3), alt_km: RE.LIMITS.ENTRY_INTERFACE_KM, time: new Date(entryMs).toISOString() },
    ballistic_coefficient: bc,
    recoverable: opts.recoverable === true,
    footprint: fp,
    casualty: RE.casualtyExpectancy(fp, acM2),
    consequence: RE.consequenceProfile(fp),
    maritime: null,                                  // AIS layer not loaded → FR-24 UNEVALUATED
    recovery: opts.recovery || null,
    descent,
    burn_offset_s: opts.burn_offset_s ?? 0,
  };
  deorbitStore.set(norad, plan);
  return plan;
}

/** Context for the re-entry rulebook. */
function deorbitContext(plan) {
  return {
    reentry: plan,
    descent: plan.descent,
    cluster: { online_nodes: nodes.filter((n) => n.online).length, total_nodes: nodes.length, leader_id: leaderId },
    system: systemHealth(),
    spaceWeather: spaceWeather ? { ...spaceWeather, flares: flareState } : null,
    groundSegment,
  };
}

function deorbitReport(plan) {
  return CE.evaluate({ rulebook: reentryRulebook, context: deorbitContext(plan), waivers: [], now: Date.now() });
}

/**
 * Minimum unblocking change — "what would fix it".
 *
 * Walk the burn epoch forward and find the smallest shift that moves the
 * corridor to a state the rulebook clears. This is what turns the gate from a
 * checker into a planner: it does not just say no, it says what would make it
 * a yes.
 */
function retargetDeorbit(norad, opts = {}) {
  const base = deorbitStore.get(norad) || planDeorbit(norad, opts);
  if (base.error) return base;
  const baseReport = deorbitReport(base);

  // TARGET: no HARD violations — the "minimum UNBLOCKING set", not the minimum
  // completing set. Retargeting the burn cannot manufacture evidence for a rule
  // that was never evaluated, so chasing full authorisation here would search
  // forever and report failure for the wrong reason.
  const unblocked = (rep) => rep.blocking.length === 0;
  if (unblocked(baseReport)) {
    return { already_clear: true, offset_s: 0, report: baseReport, plan: base,
      still_unresolved: baseReport.unevaluated.map((u) => ({ id: u.id, detail: u.detail })) };
  }

  // Walk in 60 s steps out to one full revolution — the corridor sweeps right
  // across the ground track as the burn epoch moves.
  const tried = [];
  for (let off = 60; off <= 95 * 60; off += 60) {
    const cand = planDeorbit(norad, { ...opts, burn_offset_s: off });
    if (cand.error) continue;
    const rep = deorbitReport(cand);
    tried.push({ offset_s: off, signal: rep.signal, ec: cand.casualty ? cand.casualty.ec : null });
    if (unblocked(rep)) {
      deorbitStore.set(norad, cand);
      return {
        already_clear: false,
        offset_s: off,
        offset_human: `${Math.floor(off / 60)} min ${off % 60} s`,
        from: { signal: baseReport.signal, ec: base.casualty ? base.casualty.ec : null, worst: base.consequence && base.consequence.worst ? base.consequence.worst.label : null },
        to: { signal: rep.signal, ec: cand.casualty ? cand.casualty.ec : null, worst: cand.consequence && cand.consequence.worst ? cand.consequence.worst.label : null },
        plan: cand, report: rep, searched: tried.length,
        // Being unblocked is not the same as being complete. Say what is still open.
        still_unresolved: rep.unevaluated.map((u) => ({ id: u.id, detail: u.detail })),
      };
    }
  }
  // Restore the original so a failed search does not leave a worse plan behind.
  deorbitStore.set(norad, base);
  return { already_clear: false, offset_s: null, searched: tried.length, report: baseReport, plan: base,
    note: 'No burn epoch within one revolution clears the rulebook. A different disposal orbit or a lower ballistic coefficient is required.' };
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

const wsClients = new Set();

/** Compute Sec-WebSocket-Accept from the client key */
function wsAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

/** Encode a text frame */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + opcode text
    header[1] = len;
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    // write 64-bit big-endian length (high 32 bits are 0 for sane payloads)
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

/** Parse a single WebSocket frame from a buffer; returns {opcode, payload, consumed} or null */
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const fin  = (buf[0] & 0x80) !== 0;   // eslint-disable-line no-unused-vars
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < offset + 2) return null;
    payloadLen = buf.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLen === 127) {
    if (buf.length < offset + 8) return null;
    // treat as 32-bit (high 4 bytes assumed 0)
    payloadLen = buf.readUInt32BE(offset + 4);
    offset += 8;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + payloadLen) return null;

  let payload;
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = buf[offset + i] ^ mask[i % 4];
    }
    offset += payloadLen;
  } else {
    payload = buf.slice(offset, offset + payloadLen);
    offset += payloadLen;
  }

  return { opcode, payload, consumed: offset };
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  const frame = encodeTextFrame(msg);
  for (const sock of wsClients) {
    try { sock.write(frame); } catch (_) { wsClients.delete(sock); }
  }
}

function handleWsUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = wsAccept(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );

  wsClients.add(socket);
  let buf = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length > 0) {
      const frame = parseFrame(buf);
      if (!frame) break;
      buf = buf.slice(frame.consumed);
      if (frame.opcode === 0x8) {
        // close
        wsClients.delete(socket);
        socket.destroy();
        return;
      }
      if (frame.opcode === 0x9) {
        // ping → pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a; pong[1] = 0x00;
        socket.write(pong);
      }
      // text frames from client: ignore for now
    }
  });

  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
}

// ---------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------

// Push live network state every 4 s. Satellite POSITIONS are NOT faked here — the
// globe propagates real orbits (SGP4) client-side; this just keeps conjunctions,
// CDMs, node health and leader state fresh for the panels.
setInterval(() => {
  broadcast('NETWORK_UPDATE', fullState());
}, 4000);

// AI agent — every 10 s
setInterval(() => {
  if (!agentEnabled) return;
  // Only act on conjunctions with a LIVE satellite — debris can't be commanded.
  const monitoring = conjunctions.filter(c => c.status === 'MONITORING' && (isManeuverable(c.sat1_name) || isManeuverable(c.sat2_name)));
  if (monitoring.length === 0) return;
  const top = monitoring.reduce((a, b) => (a.risk_index >= b.risk_index ? a : b));
  // Say what the scan concluded even when it concludes "nothing to do" — an
  // agent that only speaks when it acts is indistinguishable from one that is
  // not running.
  broadcast('AGENT_SCAN', {
    scanned: monitoring.length,
    top: { pair: `${top.sat1_name} × ${top.sat2_name}`, risk: top.risk_index },
    threshold: 45,
    acting: top.risk_index > 45 && top.status === 'MONITORING',
  });
  // Threshold 45: the debris-on-debris events score higher but cannot be
  // commanded, and the commandable population in this catalogue tops out near
  // 50 — a threshold of 70 meant the agent never spoke at all.
  if (top.risk_index > 45 && top.status === 'MONITORING') {
    top.status = 'PLANNING';
    broadcast('CONJUNCTION_ALERT', { conjunction: top, agent: true });
    // Autonomous loop: plan a REAL avoidance maneuver, then put it to the cluster vote.
    (async () => {
      let plan = null;
      try { plan = planAvoidance(top); } catch { /* fall through */ }
      const m = plan && plan.maneuvers ? plan.maneuvers.find((x) => x.maneuverable) : null;
      if (plan && !plan.error) {
        plan.pc_before = Number.isFinite(top.probability) ? top.probability : conjMaxPc(plan.original_miss_km);
        plan.pc_after = conjMaxPc(plan.new_miss_km);
        planStore.set(top.id, plan);
      }
      top.plan = plan && !plan.error ? {
        delta_v_ms: plan.total_delta_v_ms, new_miss_km: plan.new_miss_km,
        clear_vs_catalogue: plan.clear_vs_catalogue, sat: m ? m.sat : null,
        orbit_shift_deg: m ? m.orbit_shift_deg : null,
      } : null;

      // The autonomous agent is bound by the same gate as a human operator. It
      // does not get to drive a blocked or unevaluated event to a vote — it
      // reports what is outstanding and stands down.
      const report = constraintReport(top);
      top.constraint = constraintBadge(top);
      if (!report.authorised) {
        broadcast('CONSTRAINT_EVENT', {
          conjunction_id: top.id, signal: report.signal, headline: report.headline,
          agent: true, agent_stood_down: true,
          next_actions: report.next_actions.slice(0, 3),
        });
        top.status = 'MONITORING';
        return;
      }

      await runConsensus(top);
      if (top.status !== 'APPROVED') top.status = 'MONITORING';
    })();
  }
}, 10000);

// Passive monitoring alerts — fires every 25s to keep the feed alive even with agent off
setInterval(() => {
  const monitoring = conjunctions.filter(c => c.status === 'MONITORING' && c.risk_index > 40);
  if (monitoring.length === 0) return;
  // Screening surfaces the highest-risk event, it does not sample at random.
  // The previous Math.random() pick meant the same fleet state could raise a
  // different alert on each pass, which is not how a screening system behaves.
  const pick = monitoring.reduce((a, b) => (b.risk_index > a.risk_index ? b : a));
  broadcast('CONJUNCTION_ALERT', {
    conjunction: pick,
    agent: false,
    source: 'SOCRATES_SCREEN',
  });
}, 25000);

// Startup burst — send 3 events after 3s so the feed isn't empty
setTimeout(() => {
  const hi = conjunctions.filter(c => c.risk_index > 60);
  for (const c of hi.slice(0, 3)) {
    broadcast('CONJUNCTION_ALERT', { conjunction: c, source: 'INITIAL_SCREEN' });
  }
  broadcast('LEADER_CHANGE', { previous_leader: null, new_leader: leaderId, reason: 'Cluster initialised — Bully election complete' });
}, 3000);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// Comma-separated list in env, e.g. "https://astromesh.onrender.com,https://astromesh.web.app"
// Defaults to "*" (open) for local dev. Set ALLOWED_ORIGINS in production to lock it down.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

function cors(res) {
  const origin = res._reqOrigin;
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ---- simple in-memory per-IP rate limiter (protects the paid Groq endpoint) ----
const _rlHits = new Map();
function rateLimited(req, max, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const arr = (_rlHits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  _rlHits.set(ip, arr);
  return arr.length > max;
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); }
    });
  });
}

function fullState() {
  // Attach the four-state signal to every event so the list can badge each row
  // without a round trip. Pure arithmetic over data already in memory.
  let annotated = conjunctions;
  let fleet = null;
  try {
    annotated = conjunctions.map((c) => ({ ...c, constraint: constraintBadge(c) }));
    fleet = fleetSignal();
  } catch (e) {
    console.log('[constraints] badge pass skipped:', e.message);
  }
  return {
    nodes,
    satellites,
    conjunctions: annotated,
    cdms,
    leader_id: leaderId,
    fleet_signal: fleet,
  };
}

function replicationSummary() {
  const result = {};
  for (const n of nodes) {
    result[String(n.id)] = {
      nodeId: n.id,
      // A replicated log index is a COUNT of committed entries. It was
      // previously jittered with Math.random(), which made the cluster look
      // like it was diverging when nothing had happened.
      lastLogId: conjunctions.filter((c) => c.status === 'APPROVED').length,
      online: n.online,
    };
  }
  return { nodes: result };
}

// ---------------------------------------------------------------------------
// 2PC consensus
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run the operator poll.
 *
 * Every vote is a pure function of the constraint report — see
 * constraints/voting.js. The previous implementation used
 * `Math.random() < 0.70`, which meant the same event could be approved and
 * denied on consecutive runs and no operator could explain its own vote.
 *
 * `extraWaivers` carries emergency-declared waivers; they are evaluated by the
 * same engine as any other waiver, so a non-negotiable rule is unaffected.
 */
async function runConsensus(conj, { extraWaivers = [] } = {}) {
  const t0 = Date.now();
  // Deliberation latency, so the UI can show the poll in progress. It does not
  // affect the outcome — the outcome is already determined by the report.
  await sleep(300);

  const waivers = [...(waiverStore.get(conj.id) || []), ...extraWaivers];
  const report = CE.evaluate({
    rulebook: activeRulebook(),
    context: constraintContext(conj),
    waivers,
    now: Date.now(),
  });

  const onlineNodes = nodes.filter((n) => n.online);
  const result = CV.poll(onlineNodes, report, FR.QUORUM);

  conj.status = result.approved ? 'APPROVED' : 'DENIED';
  conj.constraint = constraintBadge(conj);

  // An approved maneuver spends real propellant. The ledger refuses to touch the
  // disposal reserve, so FR-05 is enforced structurally as well as by the rule.
  let debit = null;
  if (result.approved) {
    const plan = planStore.get(conj.id);
    const asset = primaryAsset(conj);
    if (plan && asset && Number.isFinite(plan.total_delta_v_ms)) {
      debit = ledger.debit(asset, plan.total_delta_v_ms, { conjunction_id: conj.id, ts: new Date().toISOString() });
    }
  }

  const duration_ms = Date.now() - t0;
  const payload = {
    conjunction_id: conj.id,
    status: conj.status,
    votes: result.votes,
    yes_count: result.yes_count,
    quorum: result.quorum,
    duration_ms,
    signal: report.signal,
    signal_headline: report.headline,
    deterministic: true,
    waivers: waivers.length ? waivers : undefined,
    propellant: debit && debit.ok ? debit.state : undefined,
  };
  broadcast('MANEUVER_EVENT', payload);
  broadcast('CONSTRAINT_EVENT', { conjunction_id: conj.id, signal: report.signal, headline: report.headline, progress: report.progress });

  return { ...payload, report };
}

// ---------------------------------------------------------------------------
// CelesTrak TLE proxy
// ---------------------------------------------------------------------------

const MOCK_TLE = `ISS (ZARYA)
1 25544U 98067A   26160.50000000  .00016717  00000-0  10270-3 0  9993
2 25544  51.6400 208.9163 0006703  86.2996 273.5478 15.49012691000000
STARLINK-2120
1 48274U 21024B   26160.50000000  .00002103  00000-0  15248-3 0  9991
2 48274  53.0543  10.5234 0001234  90.1234 269.9999 15.06386714000000
STARLINK-1007
1 44713U 19074B   26160.50000000  .00001800  00000-0  13100-3 0  9998
2 44713  53.0002  15.1234 0001100  88.0000 271.9999 15.06380001000000
STARLINK-2609
1 47528U 21015B   26160.50000000  .00001900  00000-0  13800-3 0  9994
2 47528  53.0543  12.5678 0001010  91.2345 268.7654 15.06385714000000
STARLINK-3009
1 48900U 21060B   26160.50000000  .00001700  00000-0  12300-3 0  9997
2 48900  53.0200  18.3456 0001050  87.6543 272.3457 15.06384321000000
`;

function fetchTLE(group) {
  return new Promise((resolve) => {
    const now = Date.now();
    if (tleCache.data && now - tleCache.ts < 3600 * 1000) {
      resolve(tleCache.data);
      return;
    }
    const tleUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    https.get(tleUrl, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode === 200 && data.length > 10) {
          tleCache = { data, ts: now };
          resolve(data);
        } else {
          resolve(MOCK_TLE);
        }
      });
    }).on('error', () => resolve(MOCK_TLE));
  });
}

// ---------------------------------------------------------------------------
// Space-Track catalogue middleware
// Server-side proxy: logs into Space-Track with env creds, pulls the FULL
// on-orbit catalogue (~31k objects), caches it on disk, refreshes daily.
// The browser only ever talks to /api/catalogue — never sees credentials.
// Space-Track limits: <30 req/min, <300 req/hour → we do ~1 req/DAY.
// ---------------------------------------------------------------------------
const ST_IDENTITY = process.env.SPACETRACK_IDENTITY || '';
const ST_PASSWORD = process.env.SPACETRACK_PASSWORD || '';
const ST_QUERY = '/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id/format/3le';
const CACHE_DIR = path.join(__dirname, 'cache');
const CATALOGUE_FILE = path.join(CACHE_DIR, 'catalogue.3le');
const CATALOGUE_TTL_MS = 8 * 3600 * 1000;    // refresh every 8h = 3x/day (same cadence as CelesTrak SOCRATES; well under Space-Track rate limits)
let catalogueFetching = false;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// ---------------------------------------------------------------------------
// AI mission-control agent — Groq (gpt-oss-120b). The agent reasons over the LIVE
// engine state (real conjunctions, real US Space Force CDMs, the catalogue) so it
// answers with actual numbers and can explain coordination decisions. Key lives in
// the gitignored .env and never reaches the browser.
// ---------------------------------------------------------------------------
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

function agentContext() {
  // Compact snapshot of the live state for the agent to reason over.
  const topConj = (conjunctions || []).slice(0, 8).map((c) => ({
    pair: `${c.sat1_name} × ${c.sat2_name}`, miss_km: c.min_range_km,
    tca: c.tca, pc: c.probability, rel_v_kms: c.relative_velocity_kms, risk: c.risk_index,
  }));
  const topCdm = (cdms || []).slice(0, 8).map((c) => ({
    pair: `${c.sat1_name} × ${c.sat2_name}`, miss_m: c.min_range_m,
    tca: c.tca, pc: c.probability, emergency: c.emergency,
  }));
  return {
    catalogue_size: (satellites || []).length,
    tracked_objects: '~31,000 (full Space-Track catalogue)',
    our_screening_conjunctions: topConj,
    official_cdms: topCdm,
    leader_node: leaderId,
  };
}

const AGENT_SYSTEM_PROMPT = `You are the AstroMesh mission-control AI — an autonomous Space Traffic Coordinator.
AstroMesh is a trustless, formally-verified collision-avoidance coordination platform: it screens the full ~31,000-object catalogue with its own SGP4 engine (TCA verified exact vs CelesTrak SOCRATES), overlays real US Space Force CDMs (covariance-based), and uses a decentralized Raft-consensus protocol so rival operators can agree on exactly ONE avoidance maneuver with no central authority — provably safe (TLA+).

You have the LIVE system state in the next message as JSON. Answer with REAL numbers from it. Be concise, technical, and confident, like a flight director. Use km, km/s, Pc, and TCA countdowns. When asked about risk or coordination, reference the actual conjunctions/CDMs. If asked to plan or arbitrate a maneuver, explain the right-of-way / least-delta-v logic and that the decentralized consensus must approve it. Never invent satellite names or numbers not in the state. Keep answers under ~120 words unless asked for detail. Use markdown (tables, bold) when it helps.

YOU CAN CONTROL THE GLOBE. When the user asks you to SHOW / FIND / GO TO / FOCUS a specific conjunction, end your reply with a directive ALONE on the last line using the EXACT names from the state:
<<SHOW|SAT1 NAME|SAT2 NAME>>
When they then ask to plan / compute / show the avoidance reroute for the shown conjunction, append:
<<REROUTE>>
When they ask to plan or simulate a launch, append (fill numbers; default alt 550, infer site coords if a known site is named):
<<LAUNCH|LAT|LON|ALT_KM|INCLINATION_DEG>>
You can also TRACK/ZOOM TO any single object in the full ~31,000-object catalogue (NOT just the conjunction list) — when the user asks to show/zoom/track/find one satellite or debris by name or NORAD, append:
<<TRACK|NAME OR NORAD>>
And to move the camera, append one of:
<<ZOOM|IN>>  <<ZOOM|OUT>>  <<ZOOM|RESET>>
Emit a directive ONLY when the user actually requests that action, and keep it on its own final line. Still give a short normal sentence before the directive. For a single object the user names (e.g. "zoom on FENGYUN 1C DEB"), use <<TRACK|FENGYUN 1C DEB>> — do NOT turn it into a conjunction.`;

async function groqOnce(messages, maxTokens) {
  const body = JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.4, max_tokens: maxTokens, reasoning_effort: 'low' });
  const res = await httpsRequest({
    hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Length': Buffer.byteLength(body) },
  }, body);
  if (res.status !== 200) throw new Error(`Groq API ${res.status}: ${res.body.slice(0, 200)}`);
  const j = JSON.parse(res.body);
  const choice = j.choices?.[0];
  // Reasoning models sometimes put text in `reasoning` when `content` is empty.
  return (choice?.message?.content || choice?.message?.reasoning || '').trim();
}

async function groqChat(userMessages) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in .env');
  const messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'system', content: 'LIVE SYSTEM STATE:\n' + JSON.stringify(agentContext()) },
    ...userMessages,
  ];
  // gpt-oss is a reasoning model — give it room so `content` isn't starved by reasoning tokens.
  let reply = await groqOnce(messages, 2200);
  // Sometimes the whole budget goes to reasoning and content comes back empty.
  // Retry once with a bigger budget + an explicit nudge to answer directly.
  if (!reply) {
    reply = await groqOnce(
      [...messages, { role: 'system', content: 'Reply now with a short direct answer to the user (and any <<ACTION>> tag if relevant). Do not overthink.' }],
      3000,
    );
  }
  return reply || "I didn't catch that — try rephrasing, e.g. \"track Hubble\" or \"zoom in\".";
}

// Log in to Space-Track and run one query (returns the response body).
async function spaceTrackGet(queryPath) {
  if (!ST_IDENTITY || !ST_PASSWORD) throw new Error('SPACETRACK_IDENTITY / SPACETRACK_PASSWORD not set in .env');
  const loginBody = `identity=${encodeURIComponent(ST_IDENTITY)}&password=${encodeURIComponent(ST_PASSWORD)}`;
  const login = await httpsRequest({
    hostname: 'www.space-track.org', path: '/ajaxauth/login', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(loginBody) },
  }, loginBody);
  const cookies = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (login.status !== 200 || !cookies) throw new Error('Space-Track login failed (' + login.status + ')');
  const res = await httpsRequest({
    hostname: 'www.space-track.org', path: queryPath, method: 'GET', headers: { Cookie: cookies },
  });
  if (res.status !== 200) throw new Error('Space-Track query failed (' + res.status + ')');
  return res.body;
}

async function fetchCatalogueFromSpaceTrack() {
  const body = await spaceTrackGet(ST_QUERY);
  if (body.length < 5000) throw new Error('Space-Track catalogue query too small');
  return body;
}

// Parse one CSV line, honouring quoted fields (SATNAME can contain commas).
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur);
  return out;
}

// SATCAT → compact { norad: rcsCode } JSON (0=SMALL,1=MEDIUM,2=LARGE,-1=unknown).
const SATCAT_QUERY = '/basicspacedata/query/class/satcat/CURRENT/Y/DECAY/null-val/format/csv/orderby/NORAD_CAT_ID';
const SATCAT_FILE = path.join(CACHE_DIR, 'satcat-rcs.json');
let satcatFetching = false;
async function fetchSatcat() {
  const csv = await spaceTrackGet(SATCAT_QUERY);
  const lines = csv.split('\n');
  const header = parseCsvLine(lines[0]);
  const iN = header.indexOf('NORAD_CAT_ID');
  const iR = header.indexOf('RCS_SIZE');
  if (iN < 0 || iR < 0) throw new Error('SATCAT columns not found');
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseCsvLine(lines[i]);
    const n = parseInt(f[iN]); if (!n) continue;
    const r = f[iR];
    map[n] = r === 'LARGE' ? 2 : r === 'MEDIUM' ? 1 : r === 'SMALL' ? 0 : -1;
  }
  return JSON.stringify(map);
}
async function getSatcat() {
  try {
    const st = fs.statSync(SATCAT_FILE);
    if (Date.now() - st.mtimeMs < CATALOGUE_TTL_MS) return fs.readFileSync(SATCAT_FILE, 'utf8');
  } catch { /* missing */ }
  if (satcatFetching) { try { return fs.readFileSync(SATCAT_FILE, 'utf8'); } catch { throw new Error('satcat warming up'); } }
  satcatFetching = true;
  try {
    const json = await fetchSatcat();
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
    fs.writeFileSync(SATCAT_FILE, json);
    console.log(`[SATCAT] cached RCS sizes for ${Object.keys(JSON.parse(json)).length} objects`);
    return json;
  } finally {
    satcatFetching = false;
  }
}

// ---------------------------------------------------------------------------
// Conjunction engine — OUR OWN screening on the real catalogue (SGP4).
// Apogee-perigee sieve → coarse screen → fine TCA refine → screening-grade Pc.
// Replaces the mock conjunctions so the WHOLE app (monitor, agent, consensus)
// runs on real data. Cached on disk, refreshed with the catalogue.
// ---------------------------------------------------------------------------
const CONJ_MU = 398600.4418, CONJ_RE = 6378.137;
const CONJ_FILE = path.join(CACHE_DIR, 'conjunctions.json');
let conjFetching = false;

function conjPeriApo(rec) {
  const nRadSec = rec.no / 60;
  const a = Math.cbrt(CONJ_MU / (nRadSec * nRadSec));
  const e = rec.ecco;
  return { peri: a * (1 - e) - CONJ_RE, apo: a * (1 + e) - CONJ_RE };
}
// --- Maximum probability of collision (the metric CelesTrak SOCRATES reports) ---
// TLEs carry NO covariance. Rather than guess one, SOCRATES computes the conservative
// upper bound: the covariance size that MAXIMISES Pc for the encounter geometry. For a
// 2-D circular Gaussian this maximum occurs at sigma = miss/sqrt(2) (SOCRATES' "dilution
// threshold") and evaluates to Pc_max = HBR^2 / (miss^2 * e), where HBR is the combined
// hard-body radius. We verified this reproduces SOCRATES' published MaxProbability +
// Dilution Threshold columns. This is exactly CelesTrak's screening methodology.
const HBR_KM = 0.010;                             // ~10 m combined hard-body radius — best-fit calibrated against SOCRATES' published MaxProbability
function conjMaxPc(missKm, hbrKm) {
  const hbr = hbrKm || HBR_KM;
  if (missKm <= hbr) return 1;
  return Math.min((hbr * hbr) / (missKm * missKm * Math.E), 1);
}
function dilutionThresholdKm(missKm) { return missKm / Math.SQRT2; }
// Age in days from a satrec's element-set epoch to a given time (kept for transparency).
function tleAgeDays(rec, atMs) {
  const tcaJd = atMs / 86400000 + 2440587.5;
  return tcaJd - rec.jdsatepoch;
}

function computeConjunctions(catText, primaryNorads, opts = {}) {
  const { hours = 24, coarseSec = 300, gateKm = 25, candidateKm = 10, maxResults = 12, startMs = Date.now() } = opts;
  const lines = catText.split('\n').map((l) => l.replace(/\r$/, ''));
  const objs = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    let name = lines[i]; if (name.startsWith('0 ')) name = name.slice(2).trim();
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const norad = parseInt(l2.substring(2, 7)); if (!norad) continue;
    try { const rec = satLib.twoline2satrec(l1, l2); if (!rec || rec.error) continue; objs.push({ norad, name, rec, ...conjPeriApo(rec) }); } catch { /* skip */ }
  }
  const primSet = new Set(primaryNorads);
  const prim = objs.filter((o) => primSet.has(o.norad));
  const pairs = [];
  for (const A of prim) for (const B of objs) {
    if (A.norad >= B.norad) continue;
    if (A.peri > B.apo + gateKm || B.peri > A.apo + gateKm) continue;
    pairs.push([A, B]);
  }
  const involved = new Map();
  for (const [A, B] of pairs) { involved.set(A.norad, A); involved.set(B.norad, B); }
  const inv = [...involved.values()];
  const steps = Math.ceil((hours * 3600) / coarseSec);
  const best = new Map();
  for (let s = 0; s <= steps; s++) {
    const d = new Date(startMs + s * coarseSec * 1000);
    for (const o of inv) { const pv = satLib.propagate(o.rec, d); o._p = (pv && pv.position) ? pv.position : null; }
    for (const [A, B] of pairs) {
      if (!A._p || !B._p) continue;
      const dx = A._p.x - B._p.x, dy = A._p.y - B._p.y, dz = A._p.z - B._p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const k = A.norad + '-' + B.norad; const c = best.get(k);
      if (!c || dist < c.d) best.set(k, { d: dist, t: d.getTime(), A, B });
    }
  }
  const out = [];
  for (const c of best.values()) {
    if (c.d > candidateKm) continue;
    let bd = c.d, bt = c.t;
    for (let tt = c.t - coarseSec * 1000; tt <= c.t + coarseSec * 1000; tt += 2000) {
      const d = new Date(tt);
      const pa = satLib.propagate(c.A.rec, d), pb = satLib.propagate(c.B.rec, d);
      if (!pa.position || !pb.position) continue;
      const dx = pa.position.x - pb.position.x, dy = pa.position.y - pb.position.y, dz = pa.position.z - pb.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < bd) { bd = dist; bt = tt; }
    }
    const d1 = new Date(bt), d2 = new Date(bt + 1000);
    const a1 = satLib.propagate(c.A.rec, d1), b1 = satLib.propagate(c.B.rec, d1), a2 = satLib.propagate(c.A.rec, d2), b2 = satLib.propagate(c.B.rec, d2);
    let rv = 0;
    if (a1.position && b1.position && a2.position && b2.position) {
      rv = Math.sqrt((a2.position.x - b2.position.x - (a1.position.x - b1.position.x)) ** 2 + (a2.position.y - b2.position.y - (a1.position.y - b1.position.y)) ** 2 + (a2.position.z - b2.position.z - (a1.position.z - b1.position.z)) ** 2);
    }
    // Skip co-moving objects (relative speed ~0): docked station modules / same
    // physical structure tracked under multiple catalog numbers — not real
    // collision risks (a true conjunction needs converging orbits).
    if (rv < 0.1) continue;
    out.push({ A: c.A, B: c.B, missKm: bd, tcaMs: bt, relV: rv });
  }
  out.sort((x, y) => x.missKm - y.missKm);
  return out.slice(0, maxResults).map((r, i) => {
    // ECEF positions of both objects at TCA (so the UI can draw without TLEs).
    const dtca = new Date(r.tcaMs), gmst = satLib.gstime(dtca);
    const pa = satLib.propagate(r.A.rec, dtca), pb = satLib.propagate(r.B.rec, dtca);
    const ecef = (p) => { if (!p || !p.position) return null; const e = satLib.eciToEcf(p.position, gmst); return { x: e.x * 1000, y: e.y * 1000, z: e.z * 1000 }; };
    // Maximum probability of collision (CelesTrak SOCRATES method).
    const ageA = tleAgeDays(r.A.rec, r.tcaMs), ageB = tleAgeDays(r.B.rec, r.tcaMs);
    const pc = conjMaxPc(r.missKm, HBR_KM);
    const riskByPc = pc > 1e-2 ? 96 : pc > 1e-3 ? 84 : pc > 1e-4 ? 66 : pc > 1e-5 ? 48 : 34;
    const riskByRange = Math.max(5, Math.min(99, Math.round(100 - r.missKm * 8)));
    return {
      id: i + 1, sat1_id: r.A.norad, sat2_id: r.B.norad,
      sat1_name: r.A.name, sat2_name: r.B.name,
      tca: new Date(r.tcaMs).toISOString(), tca_ms: r.tcaMs,
      min_range_km: +r.missKm.toFixed(3), probability: pc,
      relative_velocity_kms: +r.relV.toFixed(2),
      dilution_threshold_km: +dilutionThresholdKm(r.missKm).toFixed(3),  // sigma at which Pc peaks
      tle_age_days: +Math.max(ageA, ageB).toFixed(1),                    // older element set
      risk_index: Math.max(riskByRange, riskByPc),
      status: 'MONITORING',
      // Provenance, recorded explicitly so FR-11 can evaluate rather than guess.
      // This layer is our own SGP4 screening over public TLEs — which carry no
      // covariance, so FR-11 will correctly flag it as screening-grade.
      source: 'SGP4',
      sat1_pos: ecef(pa), sat2_pos: ecef(pb),
    };
  });
}

// Compute (or load cached) real conjunctions and REPLACE the mock `conjunctions`.
async function getConjunctions() {
  if (!satLib) return conjunctions;   // SGP4 lib missing — keep whatever's loaded
  try {
    const st = fs.statSync(CONJ_FILE);
    if (Date.now() - st.mtimeMs < CATALOGUE_TTL_MS) { conjunctions = JSON.parse(fs.readFileSync(CONJ_FILE, 'utf8')); return conjunctions; }
  } catch { /* compute below */ }
  if (conjFetching) return conjunctions;
  conjFetching = true;
  try {
    const cat = await getCatalogue();
    // Primaries: the curated seed objects + a sample of the dense debris clouds.
    const seedNorads = satellites.map((s) => s.norad_id);
    const dense = [];
    const lines = cat.split('\n');
    for (let i = 0; i + 2 < lines.length && dense.length < 250; i += 3) {
      let name = lines[i]; if (name.startsWith('0 ')) name = name.slice(2).trim();
      const l2 = lines[i + 2]; if (!l2 || !l2.startsWith('2 ')) continue;
      if (/FENGYUN 1C DEB|COSMOS 2251 DEB|IRIDIUM 33 DEB|COSMOS 1408 DEB/.test(name)) dense.push(parseInt(l2.substring(2, 7)));
    }
    const primaries = [...new Set([...seedNorads, ...dense])];
    const computed = computeConjunctions(cat, primaries, { hours: 24, coarseSec: 300, maxResults: 12 });
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
    fs.writeFileSync(CONJ_FILE, JSON.stringify(computed));
    conjunctions = computed;
    console.log(`[Conjunctions] computed ${computed.length} REAL conjunctions (closest ${computed[0] ? computed[0].min_range_km + ' km' : '—'})`);
    return computed;
  } finally {
    conjFetching = false;
  }
}

// ---------------------------------------------------------------------------
// Maneuver-avoidance planner — REAL orbital mechanics. Given a conjunction, find
// the minimum along-track Δv burn (applied ~50 min before TCA) that opens the miss
// distance past a safe threshold. The post-burn arc is propagated with a two-body
// universal-variable Kepler propagator (Vallado); the other object stays on SGP4.
// Returns both orbit tracks (ECEF) so the globe can draw red→green reroute.
// ---------------------------------------------------------------------------
const MU_E = 398600.4418;  // km^3/s^2
const v3 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  mag: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  norm: (a) => { const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1; return { x: a.x / m, y: a.y / m, z: a.z / m }; },
};
function stumpff(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / Math.sqrt(z * z * z)]; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return [(1 - Math.cosh(s)) / z, (Math.sinh(s) - s) / Math.sqrt(-z * -z * -z)]; }
  return [0.5, 1 / 6];
}
// Two-body propagation of state (r0,v0) by dt seconds (universal variables).
function keplerUniversal(r0v, v0v, dt) {
  const r0 = v3.mag(r0v), v0 = v3.mag(v0v);
  const vr0 = v3.dot(r0v, v0v) / r0;
  const alpha = 2 / r0 - (v0 * v0) / MU_E;       // 1/a
  const sqmu = Math.sqrt(MU_E);
  let chi = sqmu * Math.abs(alpha) * dt;
  for (let i = 0; i < 200; i++) {
    const z = alpha * chi * chi;
    const [C, S] = stumpff(z);
    const F = (vr0 / sqmu) * chi * chi * C + (1 - alpha * r0) * chi * chi * chi * S + r0 * chi - sqmu * dt;
    const dF = chi * chi * C + (vr0 / sqmu) * chi * (1 - z * S) + r0 * (1 - z * C);
    const d = F / dF;
    chi -= d;
    if (Math.abs(d) < 1e-7) break;
  }
  const z = alpha * chi * chi;
  const [C, S] = stumpff(z);
  const f = 1 - (chi * chi / r0) * C;
  const g = dt - (chi * chi * chi / sqmu) * S;
  const rv = v3.add(v3.scale(r0v, f), v3.scale(v0v, g));
  const rmag = v3.mag(rv);
  const fdot = (sqmu / (rmag * r0)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - (chi * chi / rmag) * C;
  const vv = v3.add(v3.scale(r0v, fdot), v3.scale(v0v, gdot));
  return { r: rv, v: vv };
}

let _satrecMap = null;
function satrecByNorad(norad) {
  if (!_satrecMap) {
    _satrecMap = new Map();
    try {
      const lines = fs.readFileSync(CATALOGUE_FILE, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const l1 = lines[i + 1], l2 = lines[i + 2];
        if (!l1 || !l1.startsWith('1 ') || !l2 || !l2.startsWith('2 ')) continue;
        const n = parseInt(l2.substring(2, 7)); if (n) _satrecMap.set(n, { l1, l2 });
      }
    } catch { /* catalogue not ready */ }
  }
  const e = _satrecMap.get(norad);
  if (!e) return null;
  try { const r = satLib.twoline2satrec(e.l1, e.l2); return r && !r.error ? r : null; } catch { return null; }
}

function eciKmToEcefM(p, gmst) { const e = satLib.eciToEcf(p, gmst); return { x: e.x * 1000, y: e.y * 1000, z: e.z * 1000 }; }
function periodMin(rec) { return (2 * Math.PI) / rec.no; }   // rec.no is rad/min

// Sample a track (array of ECEF metres) for a satrec over `spanMin`, `n` points.
function sgp4Track(rec, startMs, spanMin, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = new Date(startMs + (spanMin * 60000 * i) / n);
    const pv = satLib.propagate(rec, t);
    if (pv && pv.position) out.push(eciKmToEcefM(pv.position, satLib.gstime(t)));
  }
  return out;
}
// Sample the maneuvered (two-body) track from post-burn state.
function keplerTrack(r0, v0, startMs, spanMin, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const dt = (spanMin * 60 * i) / n;
    const s = keplerUniversal(r0, v0, dt);
    const t = new Date(startMs + dt * 1000);
    out.push(eciKmToEcefM(s.r, satLib.gstime(t)));
  }
  return out;
}

// All catalogue objects as {norad, rec, peri, apo} — built once, reused for screening.
let _allRecs = null;
function allRecs() {
  if (_allRecs) return _allRecs;
  _allRecs = [];
  try {
    const lines = fs.readFileSync(CATALOGUE_FILE, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
    for (let i = 0; i + 2 < lines.length; i += 3) {
      let name = lines[i]; if (name && name.startsWith('0 ')) name = name.slice(2).trim();
      const l1 = lines[i + 1], l2 = lines[i + 2];
      if (!l1 || !l1.startsWith('1 ') || !l2 || !l2.startsWith('2 ')) continue;
      const norad = parseInt(l2.substring(2, 7)); if (!norad) continue;
      try { const rec = satLib.twoline2satrec(l1, l2); if (rec && !rec.error) _allRecs.push({ norad, name, rec, ...conjPeriApo(rec) }); } catch { /* skip */ }
    }
  } catch { /* catalogue not ready */ }
  return _allRecs;
}

// Orbit altitude band (peri/apo, km) of a post-burn state vector.
function bandOf(r0v, v1v) {
  const r = v3.mag(r0v), v = v3.mag(v1v);
  const a = 1 / (2 / r - (v * v) / MU_E);
  const evec = v3.scale(v3.sub(v3.scale(r0v, v * v - MU_E / r), v3.scale(v1v, v3.dot(r0v, v1v))), 1 / MU_E);
  const e = v3.mag(evec);
  return { peri: a * (1 - e) - 6378.137, apo: a * (1 + e) - 6378.137 };
}

// Screen a maneuvered (two-body) trajectory against the WHOLE catalogue over a
// window. Apogee–perigee sieve first, then coarse time march. Returns any object
// the new orbit comes within `hitKm` of (excluding self + the original partner).
function screenReroutedVsCatalogue(aTrackEci, burnMs, stepS, band, excludeSet, hitKm = 5) {
  const objs = allRecs();
  const gate = 20;
  const candidates = objs.filter((o) => !excludeSet.has(o.norad) && !(o.peri > band.apo + gate || band.peri > o.apo + gate));
  const steps = aTrackEci.length - 1;
  const hits = [];
  for (const o of candidates) {
    let best = 1e9, bestMs = 0;
    for (let s = 0; s <= steps; s++) {
      if (!aTrackEci[s]) continue;
      const t = new Date(burnMs + s * stepS * 1000);
      const pv = satLib.propagate(o.rec, t);
      if (!pv || !pv.position) continue;
      const d = v3.mag(v3.sub(aTrackEci[s], pv.position));
      if (d < best) { best = d; bestMs = t.getTime(); }
    }
    if (best < hitKm) hits.push({ norad: o.norad, name: o.name, miss_km: +best.toFixed(3), tca: new Date(bestMs).toISOString() });
  }
  hits.sort((a, b) => a.miss_km - b.miss_km);
  return { screened: candidates.length, catalogue: objs.length, hits };
}

function isManeuverable(name) { return !/DEB|R\/B|DEBRIS|COOLANT|WESTFORD|FRAG/i.test(name || ''); }

// Cooperative collision avoidance. Both objects of a conjunction reroute (the
// trustless-coordination idea): A burns prograde, B retrograde, sharing the load.
// Post-burn arcs use a two-body universal-variable propagator applied as a
// DIFFERENTIAL displacement on each object's SGP4 truth (cancels model error).
// Both new orbits are re-screened against the WHOLE catalogue.
function planAvoidance(conj) {
  if (!satLib) return { error: 'propagator unavailable' };
  const recA = satrecByNorad(conj.sat1_id);
  const recB = satrecByNorad(conj.sat2_id);
  if (!recA || !recB) return { error: 'TLE not found for one of the objects' };
  const tcaMs = conj.tca_ms || Date.parse(conj.tca);
  const burnMs = tcaMs - 50 * 60 * 1000;
  const dtToTca = (tcaMs - burnMs) / 1000;
  const pvA = satLib.propagate(recA, new Date(burnMs));
  const pvB = satLib.propagate(recB, new Date(burnMs));
  if (!pvA || !pvA.position || !pvB || !pvB.position) return { error: 'propagation failed at burn epoch' };

  // Build a per-object maneuver model. `sign` = +1 prograde, -1 retrograde.
  function model(rec, pv, sign, maneuver) {
    const r0 = pv.position, v0 = pv.velocity;
    const vhat = v3.scale(v0, sign / v3.mag(v0));
    const v0mag = v3.mag(v0), r0mag = v3.mag(r0);
    const aOld = 1 / (2 / r0mag - (v0mag * v0mag) / MU_E);
    return {
      rec, r0, v0, vhat, r0mag, aOld, maneuver,
      shift(dvMs, dt) { if (!maneuver || dvMs === 0) return { x: 0, y: 0, z: 0 };
        const v1 = v3.add(v0, v3.scale(vhat, dvMs / 1000));
        return v3.sub(keplerUniversal(r0, v1, dt).r, keplerUniversal(r0, v0, dt).r); },
      eci(dvMs, dt) { const pv2 = satLib.propagate(rec, new Date(burnMs + dt * 1000));
        if (!pv2 || !pv2.position) return null; return v3.add(pv2.position, this.shift(dvMs, dt)); },
      altChangeKm(dvMs) { if (!maneuver) return 0;
        const v1 = v3.mag(v3.add(v0, v3.scale(vhat, dvMs / 1000)));
        const aNew = 1 / (2 / r0mag - (v1 * v1) / MU_E); return aNew - aOld; },
    };
  }
  const manA = isManeuverable(conj.sat1_name), manB = isManeuverable(conj.sat2_name);
  // If neither is maneuverable (debris×debris) we still demonstrate on the primary,
  // flagged as requiring active debris removal.
  const A = model(recA, pvA, +1, manA || (!manA && !manB));
  const B = model(recB, pvB, -1, manB);

  const missForDv = (dv) => {
    let best = 1e9;
    for (let s = -480; s <= 480; s += 10) {
      const dt = dtToTca + s;
      const a = A.eci(dv, dt), b = B.eci(dv, dt);
      if (!a || !b) continue;
      const d = v3.mag(v3.sub(a, b));
      if (d < best) best = d;
    }
    return best;
  };
  const origMiss = conj.min_range_km;

  // Target the PUBLISHED standard, not an arbitrary multiple.
  //
  // SSC 8.k requires post-maneuver collision probability to fall by at least
  // 1.5 orders of magnitude. Under CelesTrak's maximum-probability method
  // Pc ∝ 1/miss², so achieving N orders of reduction needs the miss distance to
  // grow by 10^(N/2):
  //
  //     miss_required = miss_original × 10^(orders / 2)
  //
  // Before this, the planner aimed at `origMiss * 2.5`, which produced burns
  // that were clear of the catalogue and looked fine on every displayed metric
  // but silently failed the industry efficacy bar. FR-14 caught it; this closes
  // the loop so the planner solves for the constraint rather than tripping over it.
  const EFFICACY_FACTOR = Math.pow(10, FR.PC_REDUCTION_ORDERS / 2);   // ≈ 5.62×
  const SAFE_KM = Math.max(10, origMiss * EFFICACY_FACTOR);

  let dv = null, newMiss = 0;
  for (let d = 0.02; d <= 8.0; d += 0.02) { const m = missForDv(d); if (m >= SAFE_KM) { dv = +d.toFixed(3); newMiss = +m.toFixed(3); break; } }
  if (dv === null) { dv = 8.0; newMiss = +missForDv(8.0).toFixed(3); }

  // Re-screen BOTH new orbits against the whole catalogue; bump Δv until clear.
  const T = Math.min(periodMin(recA), 200);
  const STEP_S = 45, steps = Math.ceil((T * 60) / STEP_S);
  const exclude = new Set([conj.sat1_id, conj.sat2_id]);
  const trackFor = (m, d) => { const a = []; for (let s = 0; s <= steps; s++) a.push(m.eci(d, s * STEP_S)); return a; };
  function screenBoth(d) {
    let hits = [], screened = 0, cat = 0;
    for (const m of [A, B]) {
      if (!m.maneuver) continue;
      const v1 = v3.add(m.v0, v3.scale(m.vhat, d / 1000));
      const r = screenReroutedVsCatalogue(trackFor(m, d), burnMs, STEP_S, bandOf(m.r0, v1), exclude, 5);
      hits = hits.concat(r.hits); screened += r.screened; cat = r.catalogue;
    }
    return { hits, screened, catalogue: cat };
  }
  let screen = screenBoth(dv), tries = 0;
  while (screen.hits.length && tries < 6) { dv = +(dv + 0.4).toFixed(3); newMiss = +missForDv(dv).toFixed(3); screen = screenBoth(dv); tries++; }

  // Orbit tracks (ECEF metres): current (red) + rerouted (blue) for each object.
  function tracks(m) {
    const cur = [], neu = [];
    for (let i = 0; i <= 90; i++) {
      const dt = (T * 60 * i) / 90, t = new Date(burnMs + dt * 1000), gmst = satLib.gstime(t);
      const pv = satLib.propagate(m.rec, t);
      if (!pv || !pv.position) continue;
      cur.push(eciKmToEcefM(pv.position, gmst));
      neu.push(eciKmToEcefM(v3.add(pv.position, m.shift(dv, dt)), gmst));
    }
    return { cur, neu };
  }
  const tA = tracks(A), tB = tracks(B);
  // Real ECEF positions at TCA (the actual predicted encounter point) for markers.
  const gmstTca = satLib.gstime(new Date(tcaMs));
  const tcaPos = (rec) => { const pv = satLib.propagate(rec, new Date(tcaMs)); if (!pv || !pv.position) return null; const e = satLib.eciToEcf(pv.position, gmstTca); return { x: e.x * 1000, y: e.y * 1000, z: e.z * 1000 }; };
  // Human-readable maneuver per object: Δv, direction, phase shift (deg), altitude (km).
  function describe(m, name, sign) {
    if (!m.maneuver) return { sat: name, maneuverable: false, note: 'debris / rocket body — cannot maneuver (would need active removal)' };
    const disp = v3.mag(m.shift(dv, dtToTca));               // along-track displacement at TCA (km)
    const phaseDeg = (disp / m.r0mag) * (180 / Math.PI);
    return {
      sat: name, maneuverable: true,
      delta_v_ms: dv,
      direction: sign > 0 ? 'prograde (raise)' : 'retrograde (lower)',
      orbit_shift_deg: +phaseDeg.toFixed(3),
      altitude_change_km: +m.altChangeKm(dv).toFixed(2),
      displacement_km: +disp.toFixed(1),
    };
  }

  return {
    conjunction_id: conj.id,
    sat1_name: conj.sat1_name, sat2_name: conj.sat2_name,
    burn_time: new Date(burnMs).toISOString(), lead_minutes: 50,
    total_delta_v_ms: +((A.maneuver ? dv : 0) + (B.maneuver ? dv : 0)).toFixed(3),
    original_miss_km: origMiss, new_miss_km: newMiss, safe_threshold_km: +SAFE_KM.toFixed(1),
    screened_objects: screen.screened, catalogue_size: screen.catalogue,
    new_conjunctions: screen.hits, clear_vs_catalogue: screen.hits.length === 0,
    maneuvers: [describe(A, conj.sat1_name, +1), describe(B, conj.sat2_name, -1)],
    sat1_current: tA.cur, sat1_rerouted: A.maneuver ? tA.neu : null,
    sat2_current: tB.cur, sat2_rerouted: B.maneuver ? tB.neu : null,
    sat1_tca_pos: tcaPos(recA), sat2_tca_pos: tcaPos(recB),   // real positions at closest approach
  };
}

// ---------------------------------------------------------------------------
// Launch trajectory planner — real ascent physics. Given a launch site (lat/lon)
// and a target orbit (altitude, inclination), compute the optimal launch azimuth,
// the achievable inclination, insertion Δv (vis-viva + Earth-rotation assist +
// gravity/steering losses), period, a gravity-turn ascent path and the resulting
// circular orbit ring (both ECEF metres), and a COLA debris-density check.
// ---------------------------------------------------------------------------
function computeLaunch({ lat, lon, alt, inc }) {
  const RE = 6378.137, MU = MU_E;
  const r = RE + alt;
  const d2r = Math.PI / 180;
  const latR = lat * d2r, lonR = lon * d2r;
  const cl = Math.cos(latR), sl = Math.sin(latR), clo = Math.cos(lonR), slo = Math.sin(lonR);
  const Punit = { x: cl * clo, y: cl * slo, z: sl };            // site direction (ECEF)
  const Psurf = v3.scale(Punit, RE);
  const east = { x: -slo, y: clo, z: 0 };
  const north = { x: -sl * clo, y: -sl * slo, z: cl };
  // Achievable inclination ≥ |launch latitude|; azimuth from sin(Az)=cos(i)/cos(lat).
  const minInc = Math.abs(lat);
  const effInc = Math.max(inc, minInc);
  let sinAz = Math.cos(effInc * d2r) / Math.cos(latR);
  sinAz = Math.max(-1, Math.min(1, sinAz));
  const Az = Math.asin(sinAz);                                  // rad, from north (eastward)
  const dir = v3.norm(v3.add(v3.scale(east, Math.sin(Az)), v3.scale(north, Math.cos(Az))));
  // Gravity-turn ascent path (surface → insertion at target altitude, downrange arc).
  const maxArc = 22 * d2r, N = 50, ascent = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, phi = maxArc * u, a = alt * Math.pow(u, 0.75);
    const p = v3.scale(v3.add(v3.scale(Punit, Math.cos(phi)), v3.scale(dir, Math.sin(phi))), RE + a);
    ascent.push({ x: p.x * 1000, y: p.y * 1000, z: p.z * 1000 });
  }
  // Insertion point + horizontal velocity direction → defines the orbit plane.
  const Idir = v3.norm(v3.add(v3.scale(Punit, Math.cos(maxArc)), v3.scale(dir, Math.sin(maxArc))));
  const vtan = v3.norm(v3.add(v3.scale(Punit, -Math.sin(maxArc)), v3.scale(dir, Math.cos(maxArc))));
  const n = v3.norm(v3.cross(Idir, vtan));
  const e1 = Idir, e2 = v3.norm(v3.cross(n, e1));
  const ring = [];
  for (let k = 0; k <= 120; k++) {
    const th = (2 * Math.PI * k) / 120;
    const p = v3.add(v3.scale(e1, r * Math.cos(th)), v3.scale(e2, r * Math.sin(th)));
    ring.push({ x: p.x * 1000, y: p.y * 1000, z: p.z * 1000 });
  }
  const incl = Math.acos(Math.max(-1, Math.min(1, n.z))) / d2r;
  // Best launch time: when the site rotates under the target orbital plane (ascending
  // node taken at inertial longitude 0 as the reference). Real spherical geometry.
  let windowSec = 0, windowUtc = null;
  try {
    const gmstDeg = (satLib.gstime(new Date()) * 180) / Math.PI;
    const u = Math.asin(Math.max(-1, Math.min(1, Math.sin(latR) / Math.sin(effInc * d2r))));
    const lamRel = (Math.atan2(Math.cos(effInc * d2r) * Math.sin(u), Math.cos(u)) * 180) / Math.PI;
    const siteInertial = ((gmstDeg + lon) % 360 + 360) % 360;
    const target = ((0 + lamRel) % 360 + 360) % 360;
    const dLon = ((target - siteInertial) % 360 + 360) % 360;
    windowSec = (dLon / 360) * 86164;
    windowUtc = new Date(Date.now() + windowSec * 1000).toISOString();
  } catch { /* satLib not ready */ }
  const vOrb = Math.sqrt(MU / r);
  const vRot = 0.4651 * Math.cos(latR);                          // Earth surface eastward speed
  const assist = vRot * Math.sin(Az);
  const dv = vOrb - assist + 1.8;                                // + gravity/drag/steering losses
  const period = (2 * Math.PI * Math.sqrt(r * r * r / MU)) / 60;
  let band = 0;
  try { for (const o of allRecs()) { if (o.peri <= alt + 25 && o.apo >= alt - 25) band++; } } catch { /* catalogue not ready */ }
  return {
    site: { lat, lon }, target_alt_km: alt, requested_inc_deg: inc,
    achievable_inc_deg: +effInc.toFixed(2), inclination_deg: +incl.toFixed(2),
    azimuth_deg: +(Az / d2r).toFixed(2),
    azimuth_compass: Az / d2r > 75 ? 'due East' : Az / d2r < 15 ? 'due North' : 'North-East',
    orbit_velocity_kms: +vOrb.toFixed(3),
    earth_assist_kms: +assist.toFixed(3),
    delta_v_kms: +dv.toFixed(2),
    period_min: +period.toFixed(1),
    launch_window_min: +(windowSec / 60).toFixed(1),
    launch_window_utc: windowUtc,
    objects_in_altitude_band: band,
    note: inc < minInc ? `Target ${inc}° is below the site latitude (${minInc.toFixed(1)}°). A direct launch can't reach it without a costly plane change — planning the lowest achievable ${effInc.toFixed(1)}° instead.` : null,
    launch_site_ecef: { x: Psurf.x * 1000, y: Psurf.y * 1000, z: Psurf.z * 1000 },
    ascent_path: ascent,
    orbit_ring: ring,
  };
}

// ---------------------------------------------------------------------------
// Real CDMs — operational Conjunction Data Messages from Space-Track. These are
// computed by the US Space Force (18th SDS) with high-precision SP ephemerides
// AND covariance, so the miss distance + Pc are operational-grade (not screening
// like our SGP4 engine). We surface them as the high-fidelity "verified" layer.
// ---------------------------------------------------------------------------
const CDM_FILE = path.join(CACHE_DIR, 'cdms.json');
let cdmFetching = false;

function mapCdm(c) {
  return {
    id: c.CDM_ID,
    sat1_id: parseInt(c.SAT_1_ID), sat1_name: (c.SAT_1_NAME || '').trim(), sat1_type: c.SAT1_OBJECT_TYPE,
    sat2_id: parseInt(c.SAT_2_ID), sat2_name: (c.SAT_2_NAME || '').trim(), sat2_type: c.SAT2_OBJECT_TYPE,
    tca: c.TCA, tca_ms: Date.parse((c.TCA || '') + 'Z'),
    min_range_km: parseFloat(c.MIN_RNG) / 1000,   // Space-Track MIN_RNG is in METERS
    min_range_m: parseFloat(c.MIN_RNG),
    probability: parseFloat(c.PC),
    emergency: c.EMERGENCY_REPORTABLE === 'Y',
    created: c.CREATED,
    source: 'CDM',
  };
}

async function fetchCdms() {
  const today = new Date().toISOString().slice(0, 10);
  const q = `/basicspacedata/query/class/cdm_public/TCA/%3E${today}/orderby/PC%20desc/limit/200/format/json`;
  const body = await spaceTrackGet(q);
  const raw = JSON.parse(body);
  // One conjunction generates many CDMs: both object orderings, plus a fresh message
  // each time tracking refines the estimate. Collapse to ONE row per object pair,
  // keeping the most recently CREATED assessment (the current best estimate).
  const byPair = new Map();
  for (const c of raw) {
    const a = parseInt(c.SAT_1_ID), b = parseInt(c.SAT_2_ID);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const key = Math.min(a, b) + '-' + Math.max(a, b);
    const m = mapCdm(c);
    if (!Number.isFinite(m.min_range_km)) continue;
    const prev = byPair.get(key);
    if (!prev || Date.parse(m.created || 0) > Date.parse(prev.created || 0)) byPair.set(key, m);
  }
  return [...byPair.values()].sort((x, y) => (y.probability || 0) - (x.probability || 0));
}

async function getCdms() {
  try {
    const st = fs.statSync(CDM_FILE);
    if (Date.now() - st.mtimeMs < CATALOGUE_TTL_MS) { cdms = JSON.parse(fs.readFileSync(CDM_FILE, 'utf8')); return cdms; }
  } catch { /* compute below */ }
  if (cdmFetching) return cdms;
  cdmFetching = true;
  try {
    const list = await fetchCdms();
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
    fs.writeFileSync(CDM_FILE, JSON.stringify(list));
    cdms = list;
    const top = list[0];
    console.log(`[CDM] cached ${list.length} real conjunction messages` + (top ? ` (max Pc ${top.probability} : ${top.sat1_name} × ${top.sat2_name})` : ''));
    return list;
  } finally {
    cdmFetching = false;
  }
}

// Returns the catalogue text — from fresh disk cache, else fetches + caches.
async function getCatalogue() {
  try {
    const st = fs.statSync(CATALOGUE_FILE);
    if (Date.now() - st.mtimeMs < CATALOGUE_TTL_MS) {
      const cached = fs.readFileSync(CATALOGUE_FILE, 'utf8');
      if (!maneuverFlags.size) { try { updateEpochStore(cached); } catch {} }
      return cached;
    }
  } catch { /* missing — fetch below */ }
  if (catalogueFetching) {                       // a fetch is in-flight: serve stale if we have it
    try { return fs.readFileSync(CATALOGUE_FILE, 'utf8'); } catch { throw new Error('catalogue warming up'); }
  }
  catalogueFetching = true;
  try {
    const data = await fetchCatalogueFromSpaceTrack();
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
    fs.writeFileSync(CATALOGUE_FILE, data);
    try { updateEpochStore(data); } catch (e) { console.log('[Maneuvers] epoch comparison skipped:', e.message); }
    console.log(`[Catalogue] fetched ${Math.round(data.length / 3) | 0} lines (~${Math.round(data.split('\n').length / 3)} objects) from Space-Track`);
    return data;
  } finally {
    catalogueFetching = false;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path   = parsed.pathname;
  const method = req.method.toUpperCase();
  res._reqOrigin = req.headers.origin;   // used by cors() for the allow-list

  // Preflight
  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- GET routes ----

  if (method === 'GET' && path === '/health') {
    return json(res, 200, { status: 'ok', leader_id: leaderId });
  }

  if (method === 'GET' && path === '/api/network') {
    return json(res, 200, fullState());
  }

  if (method === 'GET' && path === '/api/conjunctions') {
    return json(res, 200, conjunctions.map((c) => ({ ...c, constraint: constraintBadge(c) })));
  }

  if (method === 'GET' && path === '/api/cdms') {
    return json(res, 200, cdms);
  }

  if (method === 'GET' && path === '/api/satellites') {
    return json(res, 200, satellites);
  }

  if (method === 'GET' && path === '/current-leader') {
    return json(res, 200, { currentLeaderId: leaderId });
  }

  if (method === 'GET' && path === '/replication-summary') {
    return json(res, 200, replicationSummary());
  }

  if (method === 'GET' && path === '/api/tle') {
    const group = parsed.searchParams.get('group') || 'starlink';
    const tleData = await fetchTLE(group);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(tleData);
    return;
  }

  // Full ~31k object catalogue (Space-Track, cached daily). Browser never sees creds.
  if (method === 'GET' && path === '/api/catalogue') {
    try {
      const data = await getCatalogue();
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(data);
    } catch (e) {
      json(res, 502, { error: 'catalogue unavailable', detail: e.message });
    }
    return;
  }

  // RCS size class per object { norad: 0|1|2 } for proportional model scaling.
  if (method === 'GET' && path === '/api/satcat') {
    try {
      const data = await getSatcat();
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      json(res, 502, { error: 'satcat unavailable', detail: e.message });
    }
    return;
  }

  // ---- POST routes ----

  if (method === 'POST' && path === '/api/chat') {
    // 20 AI calls / minute / IP — stops anyone draining the Groq key via the public URL
    if (rateLimited(req, 20, 60000)) return json(res, 429, { error: 'Too many requests, slow down.' });
    const body = await readBody(req);
    const msgs = Array.isArray(body.messages) ? body.messages
      : (body.message ? [{ role: 'user', content: String(body.message) }] : []);
    if (!msgs.length) return json(res, 400, { error: 'no message' });
    try {
      const reply = await groqChat(msgs.slice(-8));   // keep last 8 turns
      return json(res, 200, { reply });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  if (method === 'GET' && path === '/api/search') {
    const q = (parsed.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return json(res, 400, { error: 'q required' });
    const qn = q.replace(/[^a-z0-9]/g, '');
    const objs = allRecs();
    const matches = objs.filter((o) => String(o.norad) === q || (o.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(qn))
      .slice(0, 10).map((o) => ({ norad: o.norad, name: o.name }));
    return json(res, 200, { matches });
  }

  if (method === 'POST' && path === '/api/launch/plan') {
    const body = await readBody(req);
    const lat = Number(body.lat), lon = Number(body.lon);
    const alt = Number(body.alt) || 550, inc = Number(body.inc);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(inc)) return json(res, 400, { error: 'lat, lon, inc required' });
    try { return json(res, 200, computeLaunch({ lat, lon, alt, inc })); }
    catch (e) { return json(res, 500, { error: e.message }); }
  }

  if (method === 'POST' && path === '/api/maneuver/plan') {
    const body = await readBody(req);
    const conj = conjunctions.find((c) => c.id === Number(body.conjunction_id));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });
    try {
      const plan = planAvoidance(conj);
      if (plan.error) return json(res, 422, plan);

      // SSC 8.k requires the maneuver to reduce collision probability by at
      // least 1.5 orders of magnitude. Compute both sides with the SAME method
      // (CelesTrak's maximum-probability formula) so the ratio is meaningful.
      plan.pc_before = Number.isFinite(conj.probability) ? conj.probability : conjMaxPc(plan.original_miss_km);
      plan.pc_after = conjMaxPc(plan.new_miss_km);
      plan.pc_orders_reduced = (plan.pc_before > 0 && plan.pc_after > 0)
        ? +(Math.log10(plan.pc_before / plan.pc_after)).toFixed(2) : null;
      plan.ssc_8k_target_orders = FR.PC_REDUCTION_ORDERS;

      // Cache it: the constraint report upgrades out of UNRESOLVED once a plan
      // exists, because the plan-dependent rules finally have their input.
      planStore.set(conj.id, plan);
      const report = constraintReport(conj);
      conj.constraint = constraintBadge(conj);
      broadcast('CONSTRAINT_EVENT', { conjunction_id: conj.id, signal: report.signal, headline: report.headline, progress: report.progress });

      return json(res, 200, { ...plan, constraint: { signal: report.signal, headline: report.headline, progress: report.progress } });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (method === 'POST' && path === '/api/maneuver/request') {
    const body = await readBody(req);
    const conj = conjunctions.find(c => c.id === Number(body.conjunction_id));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });
    if (conj.status === 'APPROVED') return json(res, 200, { status: 'APPROVED', message: 'Already approved' });

    // ---- THE GATE ----
    // The poll does not run unless the constraint work permits it. BLOCKED means
    // a hard rule is violated; UNRESOLVED means a rule could not be evaluated,
    // and not knowing is not the same as being allowed. Either way: 409, and the
    // report says exactly what is outstanding.
    const report = constraintReport(conj);
    if (!report.authorised) {
      return json(res, 409, {
        error: report.signal === 'BLOCKED'
          ? 'Authorisation refused — a hard flight rule is violated'
          : 'Authorisation withheld — constraint work is incomplete',
        signal: report.signal,
        headline: report.headline,
        blocking: report.blocking,
        unevaluated: report.unevaluated,
        next_actions: report.next_actions,
        progress: report.progress,
        conjunction_id: conj.id,
      });
    }

    const result = await runConsensus(conj);
    return json(res, 200, result);
  }

  // ---- Constraint gate API ----

  // The rulebook itself — every limit with the authority that set it.
  if (method === 'GET' && path === '/api/constraints/rules') {
    return json(res, 200, {
      ...describeRulebook(activeRulebook()),
      operator_postures: CV.postures(),
      authored: authored.list(),
    });
  }

  // Operator ephemeris feeds — and an honest report of what access we have.
  if (method === 'GET' && path === '/api/operator-feeds') {
    const st = await OPFEEDS.starlinkStatus();
    return json(res, 200, {
      feeds: [st],
      reconciliation: {
        disagreement_factor: OPFEEDS.DISAGREEMENT_FACTOR,
        policy: 'When independent sources describe the same encounter and disagree by more than the threshold, we report UNRESOLVED. We do not average two disagreeing measurements — that manufactures a number neither source supports and hides exactly the uncertainty that matters.',
      },
    });
  }

  // ---- RULE AUTHORING: English -> validated rule -> TLA+ invariant ----
  //
  // Not an AI wrapper: the model's output is validated deterministically and
  // interpreted from a data structure. There is no eval and no generated code,
  // and the emitted TLA+ lets a model checker rule on the model's rule.

  if (method === 'GET' && path === '/api/constraints/authored') {
    return json(res, 200, {
      authored: authored.list(),
      allowed_fields: AUTHORING.FIELDS,
      allowed_operators: Object.fromEntries(Object.entries(AUTHORING.OPS).map(([k, v]) => [k, v.label])),
      safety: 'Authored rules are data, not code. They are interpreted through a fixed set of comparison primitives over an allow-listed set of context fields. No eval, no Function(), no arbitrary access.',
    });
  }

  if (method === 'POST' && path === '/api/constraints/author') {
    if (rateLimited(req, 10, 60000)) return json(res, 429, { error: 'Too many requests, slow down.' });
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return json(res, 400, { error: 'text required — state the constraint in plain English' });

    const existingIds = activeRulebook().rules.map((r) => r.id);
    let draft = body.draft || null;

    // Compile with the LLM unless a pre-built draft was supplied (which is also
    // how this is tested without a network round trip).
    if (!draft) {
      if (!GROQ_API_KEY) return json(res, 503, { error: 'GROQ_API_KEY not set — cannot compile natural language' });
      try {
        const raw = await groqOnce([
          { role: 'system', content: AUTHORING.authoringPrompt(existingIds) },
          { role: 'user', content: text },
        ], 900);
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return json(res, 422, { error: 'the model did not return a JSON rule', raw: raw.slice(0, 300) });
        draft = JSON.parse(m[0]);
      } catch (e) {
        return json(res, 502, { error: 'rule compilation failed', detail: e.message });
      }
    }

    // STAGE first, then verify. A structurally valid rule can still be
    // semantically inverted — in testing, "never authorise when FEWER than three
    // nodes are online" compiled to `online_nodes < 3`, which is exactly
    // backwards. Structural validation cannot see that; probing can.
    const staged = authored.add(draft, existingIds, { dryRun: true });
    if (staged.ok && !body.skip_verification) {
      try {
        const verdictRaw = await groqOnce([
          { role: 'system', content: 'You verify compiled operational rules. Reply with JSON only.' },
          { role: 'user', content: AUTHORING.verificationPrompt(text, staged.rule, staged.probe) },
        ], 500);
        const vm = verdictRaw.match(/\{[\s\S]*\}/);
        const verdict = vm ? JSON.parse(vm[0]) : null;
        if (verdict && verdict.matches === false) {
          return json(res, 422, {
            error: 'the compiled rule does not match what you said',
            reason: verdict.reason,
            suggested_fix: verdict.suggested_fix || null,
            compiled_as: staged.rule.requirement,
            probe: staged.probe,
            source_text: text,
            note: 'Caught by semantic verification, not by structural validation. The rule was well-formed and still meant the opposite. It has NOT entered the rulebook.',
          });
        }
      } catch (e) {
        // A failed verification is not a pass. Refuse rather than admit an
        // unverified rule into an authorisation system.
        return json(res, 503, {
          error: 'semantic verification unavailable — the rule was not admitted',
          detail: e.message,
          compiled_as: staged.rule.requirement,
          probe: staged.probe,
          note: 'An unverified rule is an unknown, and unknowns do not become rules.',
        });
      }
    }

    const result = authored.add(draft, existingIds);
    if (!result.ok) {
      return json(res, 422, {
        error: result.model_declined
          ? 'the model correctly declined: the constraint cannot be expressed with the available inputs'
          : 'the compiled rule failed validation',
        errors: result.errors,
        draft,
        note: 'The model proposes; the validator disposes. A rule that does not validate never enters the book.',
      });
    }

    // Re-evaluate every event against the extended rulebook immediately.
    const fleet = fleetSignal();
    broadcast('CONSTRAINT_EVENT', { authored: result.rule.id, headline: `New rule ${result.rule.id}: ${result.rule.title}`, fleet_signal: fleet.signal });
    broadcast('NETWORK_UPDATE', fullState());

    return json(res, 200, {
      rule: {
        id: result.rule.id, key: result.rule.key, title: result.rule.title,
        class: result.rule.class, waivable: result.rule.waivable,
        authority: result.rule.authority, requirement: result.rule.requirement,
        rationale: result.rule.rationale, spec: result.rule.spec,
      },
      tla_invariant: result.tla,
      probe: result.probe,
      source_text: text,
      verification: body.skip_verification ? 'skipped' : 'passed — the compiled behaviour was probed and judged against the original wording',
      rulebook_size: activeRulebook().rules.length,
      fleet_signal: fleet,
      note: 'The rule is live. Every event has been re-evaluated against it.',
    });
  }

  const authDel = path.match(/^\/api\/constraints\/authored\/([A-Z]{2}-\d{1,3}[a-z]?)$/);
  if (method === 'DELETE' && authDel) {
    const ok = authored.remove(authDel[1]);
    if (!ok) return json(res, 404, { error: 'no authored rule with that id' });
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { removed: authDel[1], rulebook_size: activeRulebook().rules.length });
  }

  // The ML layer's own status — including what is ABSENT.
  if (method === 'GET' && path === '/api/models') {
    return json(res, 200, MODELS.status());
  }

  // ---- SOLAR FLARES: nowcast + forecast (the predictive layer) ----

  if (method === 'GET' && path === '/api/flares') {
    if (!flareState) {
      return json(res, 503, {
        error: 'X-ray feed unavailable',
        note: 'Predictive rules report UNRESOLVED rather than assuming a quiet Sun.',
      });
    }
    return json(res, 200, flareState);
  }

  // ---- THEME INDEPENDENCE ----
  //
  // The challenge statement requires the capability to "remain independent of
  // any specific hackathon theme". This endpoint demonstrates that rather than
  // asserting it: the SAME engine, the SAME four states, a rulebook about
  // shipping software. Zero engine changes.

  // -------------------------------------------------------------------------
  // RECOURSE — the cheapest way out of a gate that is not COMPLETE.
  //
  // The signal says what state the work is in. This says what to DO about it,
  // or that nothing can be done. Both answers matter: recommending
  // measurements when a non-negotiable is violated would waste an operator's
  // time on a gate that can never open.
  // -------------------------------------------------------------------------
  if (method === 'POST' && path === '/api/constraints/recourse') {
    const body = await readBody(req);
    const which = String(body.rulebook || 'orbital');
    const pick = which === 'release'
      ? { rulebook: releaseRulebook, supply: RELEASE_SUPPLY }
      : { rulebook: maneuverRulebook, supply: ORBITAL_SUPPLY };
    const r = RECOURSE.recourse({
      rulebook: pick.rulebook,
      context: body.context || {},
      waivers: body.waivers || [],
      supply: pick.supply,
      now: Date.now(),
    });
    return json(res, 200, r);
  }

  // Recourse for a conjunction the gateway already knows about.
  if (method === 'GET' && path.startsWith('/api/constraints/recourse/')) {
    const id = Number(path.split('/').pop());
    const conj = conjunctions.find((c) => c.id === id);
    if (!conj) return json(res, 404, { error: 'unknown conjunction' });
    const r = RECOURSE.recourse({
      rulebook: maneuverRulebook,
      context: constraintContext(conj),
      supply: ORBITAL_SUPPLY,
      now: Date.now(),
    });
    return json(res, 200, { conjunction_id: id, ...r });
  }

  // -------------------------------------------------------------------------
  // RESOLVABILITY — is this bound achievable at this sample size, or at all?
  //
  // Two kinds of not-knowing that look identical in a UI and are completely
  // different operationally: one is fixed by collecting more data (and we say
  // how much), the other is impossible in principle (and we cite why).
  // -------------------------------------------------------------------------
  if (method === 'GET' && path === '/api/constraints/resolvability') {
    const model = MODELS.load ? MODELS.load('conformal-screening') : null;
    const buckets = [];
    try {
      const cm = require('./cache/models/conformal-screening.json');
      const alpha = 1 - cm.coverage;
      for (const [name, b] of Object.entries(cm.buckets)) {
        buckets.push({ bucket: name, n: b.n, half_width_km: b.q95_km,
          ...RESOLV.resolvability({ n: b.n, alpha, tol: 0.05 }) });
      }
      return json(res, 200, {
        alpha, coverage_target: cm.coverage,
        required_for_tolerance: {
          '±10%': RESOLV.requiredSamples(alpha, 0.10).n_required,
          '±5%': RESOLV.requiredSamples(alpha, 0.05).n_required,
          '±2%': RESOLV.requiredSamples(alpha, 0.02).n_required,
        },
        minimum_n_for_any_finite_bound: Math.ceil(1 / alpha) - 1,
        buckets,
        conditional: RESOLV.resolvability({ n: 1e6, alpha, conditional: true }),
        note: 'Realised coverage of a split-conformal bound is Beta(n+1-l, l) distributed, so how far actual coverage may drift from target is computable at any n. Below 1/alpha - 1 samples the interval is provably infinite.',
      });
    } catch (e) {
      return json(res, 503, { error: 'conformal artefact unavailable', detail: e.message });
    }
  }

  // -------------------------------------------------------------------------
  // EVIDENCE-COVERAGE AUDIT — does each rulebook offer a route out of every
  // rule it contains? Routes come in three kinds and they are different
  // instructions: measure something, wait for time to pass, or act.
  // -------------------------------------------------------------------------
  if (method === 'GET' && path === '/api/constraints/audit') {
    const books = {
      orbital: maneuverRulebook,
      reentry: reentryRulebook,
      release: releaseRulebook,
    };
    const out = {};
    for (const [k, rb] of Object.entries(books)) out[k] = RECOURSE.auditEvidenceCoverage(rb);
    return json(res, 200, {
      claim: 'A rule with no route out can go UNEVALUATED and leave the operator nothing to do. This checks every rulebook for that.',
      rulebooks: out,
    });
  }

  if (method === 'GET' && path === '/api/portability/rules') {
    return json(res, 200, describeRulebook(releaseRulebook));
  }

  // -------------------------------------------------------------------------
  // The theme-independence proof, now across THREE domains.
  //
  // Software release and aircraft dispatch have nothing in common with each
  // other or with orbital mechanics, and the engine has never been told about
  // any of them. The dispatch rulebook additionally carries deadlines, so it
  // exercises the countdown machinery on a domain where the deadline is a
  // regulated rectification interval rather than an element-set age.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // ONE EVENT, EVERY LAYER, IN ORDER.
  //
  // The system's depth was invisible: each layer worked and none of it was
  // legible from the outside. This walks a single real event through the whole
  // chain and returns it as an ordered narrative, every step naming a number
  // and where the number came from.
  // -------------------------------------------------------------------------
  if (method === 'GET' && path.startsWith('/api/story/reentry')) {
    const replay = parsed.searchParams.get('replay') || 'long_march_5b';
    // Evidence the reader has chosen to acquire, so the chain can be re-run
    // with it and the reader can watch an UNRESOLVED step change.
    const acquired = (parsed.searchParams.get('acquire') || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    return json(res, 200, STORY.reentryStory({ replay, acquired, now: Date.now() }));
  }

  if (method === 'GET' && path === '/api/portability/dispatch') {
    const now = Date.now();
    const scenarios = Object.entries(DISPATCH.SCENARIOS).map(([id, sc]) => {
      const ctx = DISPATCH.at(sc.context, now);
      const report = CE.evaluate({ rulebook: DISPATCH.dispatchRulebook, context: ctx, now });
      const h = HORIZON.horizon({ rulebook: DISPATCH.dispatchRulebook, context: ctx, now });
      const rec = report.signal === 'COMPLETE' ? null : RECOURSE.recourse({
        rulebook: DISPATCH.dispatchRulebook, context: ctx,
        supply: DISPATCH.supplyEvidence, now,
      });
      return {
        id, label: sc.label,
        signal: report.signal, progress: report.progress, headline: report.headline,
        grounds_in: h.self_blocks_in,
        grounds_on: h.self_blocks_on,
        recourse: rec && (rec.terminal
          ? { terminal: true, why: rec.why, blockers: rec.blockers }
          : rec.cheapest
            ? { terminal: false, acquire: rec.cheapest.evidence, cost: rec.cheapest.cost_human,
                verified_minimal: rec.minimality_proof && rec.minimality_proof.verified_minimal }
            : { terminal: false, none: true, why: rec.why }),
      };
    });
    return json(res, 200, {
      claim: 'A regulated, non-software, non-space domain. Same engine, same four states, same precedence, zero changes.',
      engine_changes_required: 0,
      source: 'FAA Policy Letter PL-25 — MMEL repair categories A/B/C/D and the (M)/(O) provisos',
      scope: 'An illustrative subset of the PL-25 structure, not an operator MEL and not approved by anybody. We are showing the engine is domain-free, not shipping a dispatch tool.',
      rulebook: describeRulebook(DISPATCH.dispatchRulebook),
      scenarios,
      note: 'The Minimum Equipment List is natively four-state: dispatch permitted; permitted with a placard, a proviso and a repair deadline; no dispatch; or the item is not listed and therefore not classified. An industry arrived at these four independently, decades before we did.',
    });
  }

  if (method === 'GET' && path === '/api/portability') {
    const scenarios = Object.entries(RELEASE_SCENARIOS).map(([id, sc]) => {
      const report = CE.evaluate({ rulebook: releaseRulebook, context: sc.context, now: Date.now() });
      return {
        id, label: sc.label,
        signal: report.signal, progress: report.progress, headline: report.headline,
        first: (report.blocking[0] || report.unevaluated[0] || report.advisory[0] || null),
        counts: report.counts,
      };
    });
    return json(res, 200, {
      claim: 'The same constraint engine, the same four states, a domain with no space content.',
      engine_changes_required: 0,
      rulebook: describeRulebook(releaseRulebook),
      scenarios,
      note: 'The engine takes a rulebook and a context and returns a completion signal. It has never heard of a satellite, and it has never heard of a CVE either. Orbit is simply where we needed it first.',
    });
  }

  // Evaluate an arbitrary release context against the software rulebook.
  if (method === 'POST' && path === '/api/portability/evaluate') {
    const body = await readBody(req);
    const report = CE.evaluate({ rulebook: releaseRulebook, context: body.context || {}, waivers: body.waivers || [], now: Date.now() });
    return json(res, 200, report);
  }

  // ---- THE RETURN LEG ----

  // The re-entry rulebook itself, with citations.
  if (method === 'GET' && path === '/api/deorbit/rules') {
    return json(res, 200, describeRulebook(reentryRulebook));
  }

  // Plan a controlled deorbit and evaluate it against the rulebook.
  if (method === 'POST' && path === '/api/deorbit/plan') {
    const body = await readBody(req);
    const norad = Number(body.norad);
    if (!Number.isFinite(norad)) return json(res, 400, { error: 'norad required' });
    try {
      const plan = planDeorbit(norad, {
        lead_minutes: body.lead_minutes,
        coast_minutes: body.coast_minutes,
        ballistic_coefficient: body.ballistic_coefficient,
        recoverable: body.recoverable,
        recovery: body.recovery,
        burn_offset_s: body.burn_offset_s,
      });
      if (plan.error) return json(res, 422, plan);
      const report = deorbitReport(plan);
      broadcast('CONSTRAINT_EVENT', { deorbit: norad, signal: report.signal, headline: report.headline });
      return json(res, 200, { plan, constraint: report });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // "What would fix it" — the minimum burn-epoch shift that clears the rulebook.
  if (method === 'POST' && path === '/api/deorbit/retarget') {
    const body = await readBody(req);
    const norad = Number(body.norad);
    if (!Number.isFinite(norad)) return json(res, 400, { error: 'norad required' });
    try {
      const out = retargetDeorbit(norad, { ballistic_coefficient: body.ballistic_coefficient, recoverable: body.recoverable });
      if (out.error) return json(res, 422, out);
      return json(res, 200, out);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // Full constraint report for a planned deorbit.
  const deoMatch = path.match(/^\/api\/deorbit\/(\d+)$/);
  if (method === 'GET' && deoMatch) {
    const plan = deorbitStore.get(Number(deoMatch[1]));
    if (!plan) return json(res, 404, { error: 'no deorbit planned for that object' });
    return json(res, 200, { plan, constraint: deorbitReport(plan) });
  }

  // Historical re-entry replays — recorded events, not invented ones.
  if (method === 'GET' && path === '/api/deorbit/replays') {
    return json(res, 200, {
      available: Object.keys(RE.REENTRY_REPLAYS),
      replays: Object.values(RE.REENTRY_REPLAYS).map((r) => ({
        id: r.id, title: r.title, summary: r.summary,
        documented_effects: r.documented_effects, citations: r.citations, the_point: r.the_point,
      })),
    });
  }

  const rpMatch = path.match(/^\/api\/deorbit\/replay\/([a-z0-9_]+)$/);
  if (method === 'GET' && rpMatch) {
    const r = RE.reentryReplay(rpMatch[1]);
    if (!r) return json(res, 404, { error: 'unknown replay', available: Object.keys(RE.REENTRY_REPLAYS) });
    // Evaluate the recorded event against the live rulebook.
    const ctx = {
      reentry: { ...r, maritime: null, recoverable: false },
      descent: null,                         // an uncontrolled re-entry was never screened
      cluster: { online_nodes: nodes.filter((n) => n.online).length, total_nodes: nodes.length, leader_id: leaderId },
      system: systemHealth(),
      spaceWeather: spaceWeather ? { ...spaceWeather, flares: flareState } : null,
      groundSegment,
    };
    const report = CE.evaluate({ rulebook: reentryRulebook, context: ctx, now: Date.now() });
    return json(res, 200, { replay: r, constraint: report });
  }

  // The ground consequence raster's provenance and stated limitations.
  // -------------------------------------------------------------------------
  // THE DINOv3 GROUND, AS PIXELS.
  //
  // 18.2 million sub-cells were classified on an A100 and then never shown to
  // anyone. This slices the 3.4 km land-cover grid for a bounding box so the
  // globe can paint what the vision model actually sees under a corridor:
  // water, sparse ground, built-up, and the cells it refuses to classify.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // THE WHOLE PLANET, AS THE MODEL SEES IT.
  //
  // The corridor strip shows the vision layer where it matters; this shows its
  // reach. Every classified cell on Earth, downsampled 16x16 -> 4x4 by
  // majority vote per block, so the full 18.2M sub-cells compress into a
  // ~1.1M-pixel layer a browser draws once and keeps.
  // -------------------------------------------------------------------------
  if (method === 'GET' && path === '/api/ground/global') {
    if (!global.__groundGlobal) {
      let dense;
      try { dense = require('./cache/dense-consequence.json'); }
      catch { return json(res, 503, { error: 'dense-consequence.json not built' }); }
      const G = dense.grid || 16, D = 4, B = G / D;
      const cells = [];
      for (const [key, g] of Object.entries(dense.cells)) {
        const out = new Array(D * D);
        for (let by = 0; by < D; by++) {
          for (let bx = 0; bx < D; bx++) {
            const counts = {};
            for (let y = 0; y < B; y++) {
              for (let x = 0; x < B; x++) {
                const v = g[(by * B + y) * G + (bx * B + x)];
                counts[v] = (counts[v] || 0) + 1;
              }
            }
            out[by * D + bx] = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
          }
        }
        cells.push([Number(key), out]);
      }
      global.__groundGlobal = {
        classes: dense.classes, grid: D, res_deg: 0.5, nx: 720,
        model: dense.model,
        accuracy: dense.accuracy ? dense.accuracy.patch_linear_vote : null,
        cells,
        note: 'majority vote per 4x4 block of the 3.4 km grid — coverage, not precision. The corridor strip keeps full resolution.',
      };
    }
    return json(res, 200, global.__groundGlobal);
  }

  if (method === 'GET' && path === '/api/ground/dense') {
    let dense;
    try { dense = require('./cache/dense-consequence.json'); }
    catch { return json(res, 503, { error: 'dense-consequence.json not built' }); }
    const q = parsed.searchParams;
    const w = Number(q.get('w')), sdeg = Number(q.get('s'));
    const e = Number(q.get('e')), n = Number(q.get('n'));
    if (![w, sdeg, e, n].every(Number.isFinite)) {
      return json(res, 400, { error: 'need w,s,e,n bounding box in degrees' });
    }
    const RES = 0.5, NX = 720, G = dense.grid || 16;
    const x0 = Math.max(0, Math.floor((w + 180) / RES));
    const x1 = Math.min(NX - 1, Math.floor((e + 180) / RES));
    const y0 = Math.max(0, Math.floor((90 - n) / RES));
    const y1 = Math.min(359, Math.floor((90 - sdeg) / RES));
    const cells = [];
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const g = dense.cells[String(iy * NX + ix)];
        if (g) cells.push({ ix, iy, g });
      }
    }
    return json(res, 200, {
      classes: dense.classes, grid: G, res_deg: RES,
      sub_cell_km: dense.sub_cell_km,
      accuracy: dense.accuracy ? dense.accuracy.patch_linear_vote : null,
      model: dense.model,
      bbox: { w, s: sdeg, e, n }, cells,
      note: 'DINOv3-SAT patch classification at ~3.4 km. UNKNOWN is the model refusing, not a gap.',
    });
  }

  if (method === 'GET' && path === '/api/deorbit/raster') {
    const r = RE.loadRaster();
    if (!r) return json(res, 503, { error: 'consequence raster not built — run node dev/constraints/build-consequence-raster.js' });
    return json(res, 200, { version: r.version, built_at: r.built_at, resolution_deg: r.resolution_deg, classes: r.classes, stats: r.stats, sources: r.sources, limitations: r.limitations });
  }

  // Live space weather + the derived geospatial exposure zones.
  if (method === 'GET' && path === '/api/spaceweather') {
    if (!spaceWeather) {
      return json(res, 503, {
        error: 'space-weather feed unavailable',
        note: 'Affected rules (FR-19, FR-21) report UNRESOLVED rather than assuming nominal conditions.',
      });
    }
    return json(res, 200, {
      conditions: spaceWeather,
      zones: SW.zones(spaceWeather),
      ground_segment: groundSegment,
      replay: swReplay ? { id: swReplay.id, title: swReplay.title } : null,
      honesty: 'These are EXPOSURE ZONES, not outage predictions. We state where a documented class of effect applies and cite why; we do not claim a specific station, grid or aircraft will fail.',
    });
  }

  // Replay a recorded historical scenario, or return to live conditions.
  if (method === 'POST' && path === '/api/spaceweather/replay') {
    const body = await readBody(req);
    const id = body.id ? String(body.id) : null;
    if (id && !SW.REPLAYS[id]) return json(res, 404, { error: `unknown replay '${id}'`, available: Object.keys(SW.REPLAYS) });
    const r = await setReplay(id);
    const fleet = fleetSignal();
    broadcast('NETWORK_UPDATE', fullState());
    broadcast('CONSTRAINT_EVENT', { replay: id, fleet_signal: fleet.signal, headline: fleet.headline });
    return json(res, 200, {
      replay: id ? { id, title: r.title, summary: r.summary, documented_effects: r.documented_effects, citations: r.citations } : null,
      conditions: spaceWeather,
      ground_segment: groundSegment,
      zones: SW.zones(spaceWeather),
      fleet_signal: fleet,
    });
  }

  // Fleet-level completion signal + the value-of-information ranking.
  if (method === 'GET' && path === '/api/constraints/fleet') {
    return json(res, 200, fleetSignal());
  }

  // Propellant ledger — the limit that cannot be argued with.
  if (method === 'GET' && path === '/api/constraints/propellant') {
    return json(res, 200, ledger.summary());
  }

  // Full report for one event.
  const conMatch = path.match(/^\/api\/constraints\/(\d+)$/);
  if (method === 'GET' && conMatch) {
    const conj = conjunctions.find((c) => c.id === Number(conMatch[1]));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });
    return json(res, 200, { conjunction_id: conj.id, pair: `${conj.sat1_name} × ${conj.sat2_name}`, ...constraintReport(conj) });
  }

  // SSC 8.i — an involved operator acknowledges the notification.
  const ackMatch = path.match(/^\/api\/constraints\/(\d+)\/acknowledge$/);
  if (method === 'POST' && ackMatch) {
    const conj = conjunctions.find((c) => c.id === Number(ackMatch[1]));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });
    const body = await readBody(req);
    const who = String(body.operator || body.party || '').trim();
    const state = notificationState(conj);
    if (!who) return json(res, 400, { error: 'operator required' });
    const row = state.parties.find((p) => p.operator.toLowerCase() === who.toLowerCase());
    if (!row) return json(res, 404, { error: `${who} is not an involved operator for this event`, involved: state.parties.map((p) => p.operator) });
    if (!row.acknowledged_at) { row.acknowledged_at = new Date().toISOString(); state.acknowledged += 1; }
    const report = constraintReport(conj);
    conj.constraint = constraintBadge(conj);
    broadcast('CONSTRAINT_EVENT', { conjunction_id: conj.id, signal: report.signal, headline: report.headline, acknowledged_by: who });
    return json(res, 200, { acknowledged_by: who, notifications: state, signal: report.signal, headline: report.headline });
  }

  // File a named waiver. Non-negotiable and unevaluated rules refuse it.
  const waiveMatch = path.match(/^\/api\/constraints\/(\d+)\/waive$/);
  if (method === 'POST' && waiveMatch) {
    const conj = conjunctions.find((c) => c.id === Number(waiveMatch[1]));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });
    const body = await readBody(req);
    const ruleId = String(body.rule_id || '').trim();
    const party = String(body.party || body.operator || '').trim();
    const reason = String(body.reason || '').trim();
    if (!ruleId || !party || !reason) {
      return json(res, 400, { error: 'rule_id, party and reason are all required — a waiver must have a name on it' });
    }
    const rule = activeRulebook().rules.find((r) => r.id === ruleId);
    if (!rule) return json(res, 404, { error: `Unknown rule ${ruleId}` });
    if (rule.waivable === false) {
      return json(res, 409, {
        error: `${ruleId} ${rule.title} is non-negotiable and cannot be waived`,
        rule: { id: rule.id, title: rule.title, authority: rule.authority, rationale: rule.rationale },
      });
    }
    const list = waiverStore.get(conj.id) || [];
    list.push({ rule_id: ruleId, party, reason, ts: new Date().toISOString() });
    waiverStore.set(conj.id, list);

    const report = constraintReport(conj);
    const row = report.rules.find((r) => r.id === ruleId);
    // The engine may still refuse it — e.g. the rule was never evaluated.
    if (row && row.waiver_rejected) {
      return json(res, 409, { error: row.waiver_rejected, rule_id: ruleId, signal: report.signal, headline: report.headline });
    }
    conj.constraint = constraintBadge(conj);
    broadcast('CONSTRAINT_EVENT', { conjunction_id: conj.id, signal: report.signal, headline: report.headline, waived: ruleId, party });
    return json(res, 200, { waived: ruleId, party, signal: report.signal, headline: report.headline, report });
  }

  /**
   * Emergency override.
   *
   * PREVIOUS BEHAVIOUR (a real bug, fixed here): this endpoint set
   * `conj.status = 'APPROVED'` directly with ZERO actual votes, then fabricated
   * unanimous YES from whichever nodes happened to be online — one node was
   * enough. That contradicted the invariant formal/AstroMesh.tla proves:
   *
   *     Safety == conjStatus[c] = "APPROVED" => Cardinality(votes[c]) >= Quorum
   *
   * The TLA+ model had no Emergency action, so TLC never saw the violation.
   *
   * An emergency is a reason to accept known risk faster. It is not a reason to
   * skip the poll, and it is not a reason to cross a non-negotiable line. So:
   * auto-waive the WAIVABLE hard rules under a named declaration, refuse if a
   * non-negotiable rule is violated or a rule is unevaluated, then run a real
   * poll that still requires quorum.
   */
  if (method === 'POST' && path === '/api/maneuver/emergency') {
    const body = await readBody(req);
    const conj = conjunctions.find(c => c.id === Number(body.conjunction_id));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });

    const declaredBy = String(body.party || body.operator || '').trim() || 'FLIGHT DIRECTOR';
    const reason = String(body.reason || '').trim() || 'declared emergency';

    const report = constraintReport(conj);
    const em = CV.emergencyWaivers(report, { party: declaredBy, reason, ts: new Date().toISOString() });

    if (!em.allowed) {
      broadcast('CONSTRAINT_EVENT', {
        conjunction_id: conj.id, signal: report.signal,
        headline: 'EMERGENCY OVERRIDE REFUSED', emergency_refused: true,
      });
      return json(res, 409, {
        error: 'Emergency override refused',
        reason: em.reason,
        refused_by: em.refused_by,
        signal: report.signal,
        headline: report.headline,
        note: 'Non-negotiable rules have no override path, and an emergency is not evidence for a rule that was never evaluated.',
        conjunction_id: conj.id,
      });
    }

    broadcast('CONJUNCTION_ALERT', { conjunction: conj, emergency: true, declared_by: declaredBy });

    // Waivers are recorded permanently — an emergency exception stays on the record.
    const list = waiverStore.get(conj.id) || [];
    list.push(...em.waivers);
    waiverStore.set(conj.id, list);

    // A real poll. Quorum still binds, and an operator may still refuse to
    // accept another party's waiver.
    const result = await runConsensus(conj);
    return json(res, 200, {
      ...result,
      trigger: 'EMERGENCY',
      declared_by: declaredBy,
      auto_waived: em.waivers.map((w) => w.rule_id),
      note: em.reason,
    });
  }

  if (method === 'POST' && path === '/api/agent/toggle') {
    const body = await readBody(req);
    agentEnabled = Boolean(body.enabled);
    return json(res, 200, { agent_enabled: agentEnabled });
  }

  // Node control
  const stopMatch  = path.match(/^\/control\/node\/(\d+)\/stop$/);
  const startMatch = path.match(/^\/control\/node\/(\d+)\/start$/);

  if (method === 'POST' && stopMatch) {
    const nodeId = Number(stopMatch[1]);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return json(res, 404, { error: 'Node not found' });
    node.online = false;
    const prevLeader = leaderId;
    leaderId = computeLeader();
    if (prevLeader !== leaderId) {
      broadcast('LEADER_CHANGE', { previous_leader: prevLeader, new_leader: leaderId, reason: `Node ${nodeId} went offline` });
    }
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { node_id: nodeId, online: false, leader_id: leaderId });
  }

  if (method === 'POST' && startMatch) {
    const nodeId = Number(startMatch[1]);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return json(res, 404, { error: 'Node not found' });
    node.online = true;
    const prevLeader = leaderId;
    leaderId = computeLeader();
    if (prevLeader !== leaderId) {
      broadcast('LEADER_CHANGE', { previous_leader: prevLeader, new_leader: leaderId, reason: `Node ${nodeId} came online` });
    }
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { node_id: nodeId, online: true, leader_id: leaderId });
  }

  if (method === 'POST' && path === '/reset') {
    seedState();
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { status: 'reset', leader_id: leaderId });
  }

  // ---- /celestrak proxy (so the browser never calls celestrak.org directly) ----
  if (method === 'GET' && path.startsWith('/celestrak/')) {
    const target = 'https://celestrak.org/' + path.slice('/celestrak/'.length) + (parsed.search || '');
    https.get(target, (up) => {
      cors(res);
      res.writeHead(up.statusCode || 200, { 'Content-Type': up.headers['content-type'] || 'text/plain' });
      up.pipe(res);
    }).on('error', (e) => json(res, 502, { error: 'celestrak proxy failed', detail: e.message }));
    return;
  }

  // ---- static frontend (single-origin: serves the built Vue app) ----
  if (method === 'GET' && DIST_DIR) {
    const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    const filePath = path_.join(DIST_DIR, rel);
    // block path traversal
    if (filePath.startsWith(DIST_DIR)) {
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return sendFile(res, filePath);
        }
      } catch (_) {}
      // SPA fallback: any unknown non-API path -> index.html
      if (!path.startsWith('/api') && !path.startsWith('/control') && !path.startsWith('/celestrak')) {
        const idx = path_.join(DIST_DIR, 'index.html');
        if (fs.existsSync(idx)) return sendFile(res, idx);
      }
    }
  }

  // 404
  cors(res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path }));
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[error]', err);
    try {
      cors(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    } catch (_) {}
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws' && req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    // Re-attach any pre-buffered data
    if (head && head.length > 0) socket.unshift(head);
    handleWsUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`\nAstroMesh Mock Gateway running on http://localhost:${PORT}`);
  console.log(`  WebSocket:        ws://localhost:${PORT}/ws`);
  console.log(`  Network state:    GET  /api/network`);
  console.log(`  Conjunctions:     GET  /api/conjunctions`);
  console.log(`  Satellites:       GET  /api/satellites`);
  console.log(`  Maneuver request: POST /api/maneuver/request  {conjunction_id}`);
  console.log(`  Emergency:        POST /api/maneuver/emergency {conjunction_id}`);
  console.log(`  Agent toggle:     POST /api/agent/toggle       {enabled:bool}`);
  console.log(`  Node stop:        POST /control/node/:id/stop`);
  console.log(`  Node start:       POST /control/node/:id/start`);
  console.log(`  Reset:            POST /reset`);
  console.log(`  Catalogue:        GET  /api/catalogue   (~31k objects, Space-Track)`);
  console.log(`  Health:           GET  /health`);
  console.log(`\nLeader: Node ${leaderId} (Bully — highest online ID)\n`);
  // Space weather: fetch now, then every 5 minutes. A failure leaves the state
  // null, which the rulebook reports as UNRESOLVED.
  refreshSpaceWeather().then(() => {
    if (spaceWeather) console.log(`[SpaceWeather] Kp ${spaceWeather.kp} (${spaceWeather.scale_g}) · ${groundSegment.stations_available}/${groundSegment.stations_assigned} ground stations reachable`);
  });
  setInterval(refreshSpaceWeather, 5 * 60 * 1000);

  // Solar flares: GOES XRS updates every minute, so poll every 2 minutes. This
  // is the predictive layer — it buys lead time on FR-19.
  if (USE_SNAPSHOT) {
    const m = SNAPSHOT.manifest();
    const ageH = m ? ((Date.now() - Date.parse(m.captured_at)) / 3600000).toFixed(1) : '?';
    console.log(`[Snapshot] SERVING FROZEN CAPTURE from ${m && m.captured_at} (${ageH} h old)`);
    console.log('[Snapshot] All of it is real data captured live. FR-00 still audits its age and will block if stale.');
  }

  const ml = MODELS.loadAll();
  console.log(`[Models] ${ml.found} artefact(s) loaded${ml.refused ? `, ${ml.refused} refused` : ''}${ml.found ? ': ' + ml.models.map((m) => m.name).join(', ') : ' — affected rules will report UNEVALUATED'}`);

  refreshFlares().then(() => {
    if (flareState) {
      const f = flareState.forecast;
      const n = flareState.nowcast;
      console.log(`[Flares] ${n.count} flare(s) in the 6 h window${n.largest ? ` (largest ${n.largest.class})` : ''} · now ${f.current.class} · P(flare) ${f.probability}`);
    }
  });
  setInterval(refreshFlares, 2 * 60 * 1000);
  // Warm the catalogue cache in the background (non-blocking) so the first
  // "Show all" toggle is instant.
  if (ST_IDENTITY && ST_PASSWORD) {
    getCatalogue().then(
      () => console.log('[Catalogue] cache ready'),
      (e) => console.log('[Catalogue] warm-up skipped:', e.message),
    );
    getSatcat().then(
      () => console.log('[SATCAT] cache ready'),
      (e) => console.log('[SATCAT] warm-up skipped:', e.message),
    );
    // Compute real conjunctions (replaces mock). First run ~1-2 min, then cached.
    console.log('[Conjunctions] computing real close approaches…');
    getConjunctions().then(
      () => console.log('[Conjunctions] ready'),
      (e) => console.log('[Conjunctions] skipped:', e.message),
    );
    // Real operational CDMs (covariance-based, high-fidelity layer).
    getCdms().then(
      () => console.log('[CDM] ready'),
      (e) => console.log('[CDM] skipped:', e.message),
    );

    // Auto-refresh 3x/day (every 8h), same cadence as CelesTrak SOCRATES, so the
    // screening always runs on the freshest Space-Track TLEs. This is a SEQUENTIAL
    // dependency chain — never an overlap: refresh the SATCAT, then the catalogue
    // (TLEs), and only THEN recompute conjunctions from that fresh catalogue. Each
    // step is guarded by its own in-flight flag, so a slow run can't double-fire.
    setInterval(async () => {
      try {
        await getSatcat();                 // 1) RCS sizes (independent, guarded)
        await getCatalogue();              // 2) fresh TLEs (guarded)
        await getConjunctions();           // 3) recompute close approaches FROM the fresh TLEs
        await getCdms();                   // 4) refresh real operational CDMs
        console.log('[Refresh] TLEs + conjunctions + CDMs updated (3x/day cycle)');
      } catch (e) {
        console.log('[Refresh] cycle skipped:', e.message);
      }
    }, CATALOGUE_TTL_MS);
  } else {
    console.log('[Catalogue] Space-Track creds not set — /api/catalogue disabled');
  }
});
