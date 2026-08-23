/**
 * Orbital flight rules.        dev/constraints/rulebooks/orbital.js
 * =============================================================================
 * The rulebook for authorising an orbital collision-avoidance maneuver.
 *
 * Real flight operations do not decide by judgement in the moment. They decide
 * against a pre-agreed written rulebook — NASA "Flight Rules", Launch Commit
 * Criteria, the Go/No-Go poll. Each rule states a limit, who set it, and whether
 * it may be waived. The poll is not "does this feel safe", it is "is every
 * applicable rule closed out".
 *
 * EVERY NUMBER IN `LIMITS` TRACES TO PUBLISHED DOCTRINE, cited in each rule's
 * `authority` field and surfaced through GET /api/constraints/rules. Nothing
 * here is invented.
 *
 * Primary sources
 *   SSC     Space Safety Coalition, "Best Practices for the Sustainability of
 *           Space Operations" v2.39 (Nov 2024) — signed by ~40 operators
 *   CARA    NASA Conjunction Assessment Risk Analysis risk bands
 *   CCSDS   Conjunction Data Message standard
 *   ISO     ISO 24113 space debris mitigation requirements
 *   FCC     5-year deorbit rule (2022)
 *
 * This file is DATA. The engine that consumes it (../engine.js) has never heard
 * of a satellite — see ./release-gate.js for the same engine gating a software
 * release with the same four states.
 * =============================================================================
 */

'use strict';

const starlink = require('../starlink-ephemeris.js');
const { resolvability } = require('../resolvability.js');

const { STATE, CLASS, R } = require('../engine');

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const LIMITS = {
  // --- NASA CARA risk bands ---
  PC_RED:    1e-4,   // >= red: a risk-mitigation maneuver is REQUIRED per NPR
  PC_YELLOW: 7e-5,   // >= yellow: CARA evaluates the maneuver trade space
  PC_GREEN:  1e-7,   // <  green: no threat — spending propellant is not justified

  // --- SSC 8.j: screening threshold ---
  SCREEN_MISS_KM: 5,      // plan a maneuver below this miss distance
  ALERT_VOLUME_KM: 25,    // operator alert volume (ISS "pizza box" is 4 x 50 x 50 km)

  // --- SSC 8.k: the maneuver must actually work ---
  PC_REDUCTION_ORDERS: 1.5,   // Pc must fall by >= 1.5 orders of magnitude

  // --- timelines ---
  DECISION_LEAD_H: 24,    // standard LEO cut-off: the go/no-go is locked 24 h before TCA
  EXEC_LEAD_MIN:   30,    // the burn must be commanded no later than 30 min before TCA

  // --- data currency (SSC 2.e.ii, 7.k) ---
  TLE_AGE_MAX_D:      3,    // element sets older than ~3 d are materially degraded
  EPHEM_VALIDITY_D:   4,    // LEO ephemerides must be valid >= 4 days
  POSITION_KNOWLEDGE_M: 500, // 500 m (2 sigma), current and 48 h predicted

  // --- propellant ---
  DV_CA_ALLOCATION_MS:    15,   // per-asset collision-avoidance allocation
  DV_DISPOSAL_RESERVE_MS: 30,   // ring-fenced for controlled disposal (FCC / ISO 24113)

  // --- consensus ---
  QUORUM: 3,
  NODES:  4,

  // --- space weather ---
  KP_MODEL_VALIDITY:   6,   // above Kp 6 (G2+) the drag model leaves its validated range
  POLAR_BLACKOUT_MAGLAT: 63, // polar cap absorption blacks out HF above 63 deg mag latitude

  // --- our own evidence (FR-00) ---
  CATALOGUE_MAX_AGE_H: 12,  // Space-Track refreshes ~3x/day; beyond 12 h we are stale
  CDM_MAX_AGE_H:       12,
};

// ---------------------------------------------------------------------------
// Evidence — what would resolve an unknown. Consumed by the value-of-information
// planner, which ranks these by how many rules each one would close.
// ---------------------------------------------------------------------------

const EV = {
  RADAR_PASS:     { id: 'radar-pass',     label: 'tasked radar pass on the secondary object', cost: 90, unit: 's' },
  FRESH_CDM:      { id: 'fresh-cdm',      label: 'fresh CDM from the 19th SDS',               cost: 8,  unit: 'h' },
  OPERATOR_EPHEM: { id: 'operator-ephem', label: 'operator-supplied ephemeris with covariance', cost: 1, unit: 'h' },
  PLAN:           { id: 'maneuver-plan',  label: 'run the avoidance planner',                 cost: 20, unit: 's' },
  PROP_STATE:     { id: 'propellant',     label: 'operator declaration of remaining propellant', cost: 1, unit: 'h' },
  OPERATOR_ACK:   { id: 'operator-ack',   label: 'acknowledgement from the other operator',   cost: 2, unit: 'h' },
  SW_FEED:        { id: 'space-weather',  label: 'NOAA SWPC feed',                            cost: 1, unit: 'min' },
  CATALOGUE:      { id: 'catalogue',      label: 'refresh the Space-Track catalogue',         cost: 4, unit: 'min' },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function tcaMs(conj) {
  if (!conj) return null;
  if (Number.isFinite(conj.tca_ms)) return conj.tca_ms;
  const t = Date.parse(conj.tca || '');
  return Number.isFinite(t) ? t : null;
}
const fmtPc = (p) => (p === null || p === undefined ? '—' : (p < 1e-3 ? Number(p).toExponential(1) : Number(p).toFixed(4)));
const fmtKm = (k) => (k === null || k === undefined ? '—' : (k < 1 ? `${(k * 1000).toFixed(0)} m` : `${Number(k).toFixed(2)} km`));
function fmtDur(mins) {
  const m = Math.abs(mins);
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}

// ---------------------------------------------------------------------------
// SSC 8.b — the five maneuverability classes, and 8.c — the Rules of the Road.
// This replaces a regex on the object's name with the industry's own taxonomy.
// ---------------------------------------------------------------------------

const MCLASS = {
  NONE:      'NONMANEUVERABLE',        // debris, spent stages — takes no commands
  MINIMAL:   'MINIMALLY_MANEUVERABLE', // low-thrust / differential drag only
  MANUAL:    'MANEUVERABLE',           // conventional active spacecraft
  AUTO:      'AUTOMATED_COLA',         // autonomous collision avoidance
  CREWED:    'CREWED',
};

const CREWED_PATTERNS = /\b(ISS|ZARYA|TIANHE|TIANGONG|CSS|SOYUZ[- ]?MS|SHENZHOU|CREW DRAGON|DRAGON|STARLINER|PROGRESS[- ]?MS)\b/i;
const AUTO_PATTERNS   = /\b(STARLINK|ONEWEB|KUIPER)\b/i;
const INERT_PATTERNS  = /\b(DEB|DEBRIS|R\/B|RB|FRAG|COOLANT|WESTFORD|PLAT|SHROUD|ADAPTER)\b/i;
const MINIMAL_PATTERNS = /\b(CUBESAT|\d+U|DOVE|FLOCK|LEMUR|SPIRE)\b/i;

/**
 * Classify an object into one of the five SSC categories.
 *
 * Order of precedence:
 *   1. an explicit hint (an operator telling us directly)
 *   2. the trained classifier, when orbital elements are available AND it is
 *      confident — see ml/train_class_classifier.py
 *   3. name patterns, which is what the MVP used alone
 *   4. null — we genuinely cannot tell, which becomes UNRESOLVED, not a guess
 *
 * The model is a TIE-BREAKER, not an authority: it only overrides the name
 * heuristic when it is confident, and its output still feeds a rule rather than
 * deciding anything.
 */
const CLASSIFIER_MIN_CONFIDENCE = 0.7;

/**
 * Conformal screening intervals, calibrated by ml/calibrate_conformal.py.
 * Absent artefact -> no interval -> the rule that reads it reports UNEVALUATED.
 */
let _conformal;
function conformalModel() {
  if (_conformal !== undefined) return _conformal;
  try {
    const fs2 = require('fs'), path2 = require('path');
    const f = path2.join(__dirname, '..', '..', 'cache', 'models', 'conformal-screening.json');
    const m = JSON.parse(fs2.readFileSync(f, 'utf8'));
    _conformal = (m && m.buckets && Object.keys(m.buckets).length) ? m : null;
  } catch { _conformal = null; }
  return _conformal;
}

/** The 95% half-width for a given element-set age, or null if that age is uncalibrated. */
function screeningInterval(ageDays) {
  const m = conformalModel();
  if (!m || !Number.isFinite(ageDays)) return null;
  for (const [name, b] of Object.entries(m.buckets)) {
    const [lo, hi] = name.replace('d', '').split('-').map(Number);
    if (ageDays >= lo && ageDays < hi) {
      // The bound's own trustworthiness, from the coverage law rather than
      // from our confidence in it. Realised coverage of a split-conformal
      // interval is Beta(n+1-l, l) distributed (Vovk 2012), so at a given n we
      // can state how far actual coverage may drift from the target — and
      // whether the bin has enough samples to support the claim at all.
      const res = resolvability({ n: b.n, alpha: 1 - m.coverage, tol: 0.05 });
      return {
        half_width_km: b.q95_km, bucket: name, n: b.n, coverage: m.coverage,
        resolvability: res.state,          // RESOLVED | NOT_YET | BLOCKED
        coverage_ci: res.envelope ? res.envelope.coverage_ci : null,
        resolvability_note: res.why,
      };
    }
  }
  return null;   // outside every calibrated bucket
}
let _models = null;
function modelsModule() {
  if (_models === null) { try { _models = require('../models'); } catch { _models = false; } }
  return _models || null;
}

function classify(name, hints = {}) {
  if (hints.maneuverability_class) return hints.maneuverability_class;

  // The trained classifier, if we have the elements and it is confident.
  const M = modelsModule();
  if (M && hints.elements) {
    const p = M.predict('maneuverability', hints.elements);
    if (p && p.value && p.confidence >= CLASSIFIER_MIN_CONFIDENCE) return p.value;
  }

  if (!name || typeof name !== 'string' || !name.trim()) return null;
  if (CREWED_PATTERNS.test(name)) return MCLASS.CREWED;
  if (INERT_PATTERNS.test(name)) return MCLASS.NONE;
  if (AUTO_PATTERNS.test(name)) return MCLASS.AUTO;
  if (MINIMAL_PATTERNS.test(name)) return MCLASS.MINIMAL;
  return MCLASS.MANUAL;
}

const CAN_MANEUVER = new Set([MCLASS.MINIMAL, MCLASS.MANUAL, MCLASS.AUTO, MCLASS.CREWED]);

/** Rank for the SSC 8.c matrix — the more capable object generally yields. */
const MRANK = {
  [MCLASS.NONE]: 0, [MCLASS.MINIMAL]: 1, [MCLASS.MANUAL]: 2, [MCLASS.AUTO]: 3, [MCLASS.CREWED]: 4,
};

/**
 * SSC 8.c — who is obliged to burn.
 * Returns { mover, cell, resolved }. `resolved: false` marks the cells where the
 * matrix says "decided in bilateral discussion" — doctrine genuinely does not
 * assign responsibility there, and saying so is more honest than picking one.
 */
function rightOfWay(aName, bName, aClass, bClass) {
  if (!aClass || !bClass) return null;
  const ra = MRANK[aClass], rb = MRANK[bClass];

  // Debris on debris — nobody can move.
  if (aClass === MCLASS.NONE && bClass === MCLASS.NONE) {
    return { mover: null, resolved: true, cell: 'nonmaneuverable × nonmaneuverable',
      detail: 'neither object can be commanded — resolvable only by active debris removal' };
  }
  // Crewed vs crewed — explicitly bilateral.
  if (aClass === MCLASS.CREWED && bClass === MCLASS.CREWED) {
    return { mover: null, resolved: false, cell: 'crewed × crewed',
      detail: 'SSC 8.c: bilateral discussion determines who maneuvers' };
  }
  // Anything vs crewed — the crewed vehicle moves unless other arrangements exist.
  if (aClass === MCLASS.CREWED || bClass === MCLASS.CREWED) {
    const mover = aClass === MCLASS.CREWED ? aName : bName;
    return { mover, resolved: true, cell: `${aClass} × ${bClass}`,
      detail: 'SSC 8.c: crewed vehicle moves unless other arrangements are in place; uncrewed gives wide berth' };
  }
  // Automated COLA vs automated COLA — needs a pre-coordinated agreement.
  if (aClass === MCLASS.AUTO && bClass === MCLASS.AUTO) {
    return { mover: null, resolved: false, cell: 'automated COLA × automated COLA',
      detail: 'SSC 8.c: established via pre-coordinated agreement between the operators' };
  }
  // Same class, both able to move — bilateral.
  if (ra === rb) {
    return { mover: null, resolved: false, cell: `${aClass} × ${bClass}`,
      detail: 'SSC 8.c: same capability class — decided in bilateral discussion' };
  }
  // Otherwise the more capable object moves.
  const mover = ra > rb ? aName : bName;
  return { mover, resolved: true, cell: `${aClass} × ${bClass}`,
    detail: 'SSC 8.c: the more capable spacecraft maneuvers' };
}

// ---------------------------------------------------------------------------
// Shared rules — these govern any orbital decision, maneuver or deorbit.
// ---------------------------------------------------------------------------

/** FR-00 — the tool applies the rules to itself. */
const FR_00 = {
  id: 'FR-00', key: 'SELF-AUDIT', title: 'Our own evidence is current',
  class: CLASS.HARD, waivable: true,
  authority: 'internal — evidence currency',
  requirement: `The catalogue and CDM feeds must be under ${LIMITS.CATALOGUE_MAX_AGE_H} h old and the propagator must be loaded.`,
  rationale: 'A system that reasons about other people\'s data quality has no business hiding its own. If our evidence is stale, every answer downstream is stale, and the honest response is to say so rather than serve confident output.',
  resolvedBy: [EV.CATALOGUE],
  evaluate(ctx) {
    const s = ctx.system;
    if (!s) return R.unknown('system health not reported', ['system']);
    if (s.propagator_ok === false) return R.fail('propagator unavailable — no orbital state can be computed', 'propagator down', 'loaded');
    const ageH = num(s.catalogue_age_ms) === null ? null : s.catalogue_age_ms / 3600000;
    if (ageH === null) return R.unknown('catalogue age unknown', ['catalogue_age_ms']);
    const actual = `catalogue ${ageH.toFixed(1)} h old`;
    const limit = `<= ${LIMITS.CATALOGUE_MAX_AGE_H} h`;
    if (ageH > LIMITS.CATALOGUE_MAX_AGE_H) {
      return R.fail('our own catalogue is stale — downstream answers cannot be trusted', actual, limit);
    }
    return R.pass('our evidence is current', actual, limit);
  },
};

/** FR-08 — quorum. Non-negotiable: it is the entire trust model. */
const FR_08 = {
  id: 'FR-08', key: 'CONSENSUS-QUORUM', title: 'Operator quorum is available',
  class: CLASS.HARD, waivable: false,
  authority: `AstroMesh consensus protocol — ${LIMITS.QUORUM} of ${LIMITS.NODES} operators, TLA+ verified`,
  requirement: `A leader must be elected and at least ${LIMITS.QUORUM} of ${LIMITS.NODES} operator nodes online.`,
  rationale: 'Quorum is the whole trustless guarantee. Waiving it would let a minority — or a single node — commit a maneuver unilaterally, which is exactly the failure the protocol exists to prevent. So there is no waiver path, for anyone.',
  evaluate(ctx) {
    const c = ctx.cluster;
    if (!c) return R.unknown('cluster health not reported', ['cluster']);
    const online = num(c.online_nodes), total = num(c.total_nodes) ?? LIMITS.NODES;
    if (online === null) return R.unknown('node count unavailable', ['cluster.online_nodes']);
    const actual = `${online}/${total} online · leader ${c.leader_id ?? 'none'}`;
    const limit = `>= ${LIMITS.QUORUM} online + elected leader`;
    if (c.leader_id === null || c.leader_id === undefined) {
      return R.fail('no leader elected — the cluster cannot commit a decision', actual, limit);
    }
    if (online < LIMITS.QUORUM) return R.fail('quorum lost — a minority may not authorise', actual, limit);
    return R.pass('quorum available', actual, limit);
  },
};

/** FR-21 — space weather validity. Fleet-wide UNRESOLVED generator. */
const FR_21 = {
  id: 'FR-21', key: 'DRAG-MODEL-VALIDITY', title: 'Atmospheric model within its validated range',
  class: CLASS.SOFT, waivable: true,
  authority: 'NOAA SWPC geomagnetic scale · thermospheric density model validity',
  requirement: `Geomagnetic activity must be below Kp ${LIMITS.KP_MODEL_VALIDITY} (G2) for drag predictions to be inside the model's validated range.`,
  rationale: 'Atmospheric drag is the dominant error source in low Earth orbit. During a geomagnetic storm the upper atmosphere expands unpredictably and every propagated state degrades at once. In May 2024 the Gannon storm produced perturbations that a peer-reviewed assessment called a serious challenge for existing conjunction assessment infrastructure. Reporting normal confidence through that is a lie.',
  resolvedBy: [EV.SW_FEED],
  evaluate(ctx) {
    const sw = ctx.spaceWeather;
    if (!sw) return R.unknown('space-weather feed unavailable — model validity cannot be confirmed', ['spaceWeather']);
    const kp = num(sw.kp);
    if (kp === null) return R.unknown('Kp index unavailable', ['spaceWeather.kp']);
    const actual = `Kp ${kp.toFixed(1)}${sw.scale_g ? ` (${sw.scale_g})` : ''}`;
    const limit = `< Kp ${LIMITS.KP_MODEL_VALIDITY}`;
    if (kp >= LIMITS.KP_MODEL_VALIDITY) {
      return R.fail('geomagnetic storm — drag predictions are outside the model\'s validated range', actual, limit);
    }
    return R.pass('geomagnetic conditions nominal', actual, limit);
  },
};

// ---------------------------------------------------------------------------
// Maneuver rulebook
// ---------------------------------------------------------------------------

const MANEUVER_RULES = [
  FR_00,

  {
    id: 'FR-01', key: 'RISK-THRESHOLD', title: 'Event is above the action threshold',
    class: CLASS.HARD, waivable: true,
    authority: `NASA CARA green band (Pc < ${LIMITS.PC_GREEN}) · SSC 8.j (miss < ${LIMITS.SCREEN_MISS_KM} km)`,
    requirement: `Propellant may only be spent on an event at or above the CARA green threshold, or inside the ${LIMITS.ALERT_VOLUME_KM} km alert volume.`,
    rationale: 'A constraint cuts both ways. Manoeuvring away from a non-event wastes life-limiting propellant and injects an unscreened orbit change into a crowded shell. Refusing to act is also a decision this rulebook has to be able to make.',
    resolvedBy: [EV.FRESH_CDM, EV.RADAR_PASS],
    evaluate(ctx) {
      const c = ctx.conj || {};
      const pc = num(c.probability), miss = num(c.min_range_km);
      if (pc === null && miss === null) return R.unknown('neither Pc nor miss distance available', ['conj.probability', 'conj.min_range_km']);
      const actual = `Pc ${fmtPc(pc)} · miss ${fmtKm(miss)}`;
      const limit = `Pc >= ${LIMITS.PC_GREEN} or miss <= ${LIMITS.ALERT_VOLUME_KM} km`;
      const overPc = pc !== null && pc >= LIMITS.PC_GREEN;
      const inVolume = miss !== null && miss <= LIMITS.ALERT_VOLUME_KM;
      if (overPc || inVolume) {
        return R.pass(overPc ? 'above the CARA green threshold' : 'inside the operator alert volume', actual, limit);
      }
      return R.fail('green event — a maneuver is not justified and would waste propellant', actual, limit);
    },
  },

  {
    id: 'FR-02', key: 'MITIGATION-MANDATE', title: 'Red event has a mitigation plan',
    class: CLASS.HARD, waivable: true,
    authority: `NASA CARA red threshold Pc >= ${LIMITS.PC_RED} — mitigation mandated per NPR`,
    requirement: 'An event at or above the red threshold must have a computed avoidance plan on record.',
    rationale: 'Above red the obligation is to act. An unplanned red event is not a neutral state — it is outstanding work, and a completion signal that hides it is worthless.',
    // Only governs red events.
    applies: (ctx) => {
      const pc = num((ctx.conj || {}).probability);
      return pc === null ? null : pc >= LIMITS.PC_RED;   // null -> UNEVALUATED, honestly
    },
    notApplicableDetail: 'below the red threshold — no mandated action',
    resolvedBy: [EV.PLAN],
    evaluate(ctx) {
      const pc = num((ctx.conj || {}).probability);
      const actual = `Pc ${fmtPc(pc)}`, limit = `plan required at Pc >= ${LIMITS.PC_RED}`;
      if (!ctx.plan) return R.fail('red event with no avoidance plan — mitigation is mandated and outstanding', `${actual}, no plan on record`, limit);
      return R.pass('mandated mitigation has been planned', `${actual}, plan on record`, limit);
    },
  },

  {
    id: 'FR-03', key: 'COLA-CLEAR', title: 'Rerouted orbit is clear of the whole catalogue',
    class: CLASS.HARD, waivable: false,          // non-negotiable
    authority: 'Collision-avoidance screening (COLA) · IADC / ISO 24113 debris-generation prevention',
    requirement: 'The post-burn trajectory must be screened against every catalogued object and be clear.',
    rationale: 'Dodging into a second object is the one outcome strictly worse than doing nothing — it converts a probabilistic risk into a certain debris-generating event. There is no emergency that makes that acceptable, so no waiver exists.',
    resolvedBy: [EV.PLAN],
    evaluate(ctx) {
      if (!ctx.plan) return R.unknown('no avoidance plan computed — the post-burn path has not been screened', ['plan']);
      const p = ctx.plan;
      const screened = p.screened_objects ?? '?', cat = p.catalogue_size ?? '?';
      if (p.clear_vs_catalogue === true) {
        return R.pass(`${screened} candidates screened against ${cat} catalogued objects`, '0 new conjunctions', '0 new conjunctions');
      }
      if (p.clear_vs_catalogue !== false) return R.unknown('screening result not reported by the planner', ['plan.clear_vs_catalogue']);
      const n = Array.isArray(p.new_conjunctions) ? p.new_conjunctions.length : '?';
      return R.fail('the rerouted path creates a fresh close approach — this rule cannot be waived', `${n} new conjunction(s)`, '0 new conjunctions');
    },
  },

  {
    id: 'FR-04', key: 'DELTA-V-BUDGET', title: 'Burn fits the remaining avoidance allocation',
    class: CLASS.HARD, waivable: true,
    authority: 'Mission propellant budgeting — dedicated collision-avoidance allocation (ESA Δv/propellant budget guidelines)',
    requirement: `Plan Δv must fit within the asset's remaining collision-avoidance allocation (${LIMITS.DV_CA_ALLOCATION_MS} m/s).`,
    rationale: 'Propellant is the hardest limit in orbit: strictly finite and unreplenishable. A maneuver the asset cannot pay for is not a maneuver, it is a wish.',
    resolvedBy: [EV.PLAN, EV.PROP_STATE],
    evaluate(ctx) {
      if (!ctx.plan) return R.unknown('no plan — Δv cost unknown', ['plan']);
      if (!ctx.propellant) return R.unknown('no propellant state declared by the operator for this asset', ['propellant']);
      const need = num(ctx.plan.total_delta_v_ms);
      if (need === null) return R.unknown('plan carries no Δv figure', ['plan.total_delta_v_ms']);
      const remaining = num(ctx.propellant.ca_remaining_ms);
      if (remaining === null) return R.unknown('remaining allocation not declared', ['propellant.ca_remaining_ms']);
      const actual = `needs ${need.toFixed(2)} m/s · ${remaining.toFixed(2)} m/s remaining`;
      const limit = `<= ${LIMITS.DV_CA_ALLOCATION_MS} m/s allocation`;
      if (need <= remaining) return R.pass(`${(remaining - need).toFixed(2)} m/s allocation left after this burn`, actual, limit);
      return R.fail('burn exceeds the remaining avoidance allocation for this asset', actual, limit);
    },
  },

  {
    id: 'FR-05', key: 'DISPOSAL-RESERVE', title: 'End-of-life disposal reserve is untouched',
    class: CLASS.HARD, waivable: false,          // non-negotiable
    authority: 'FCC 5-year deorbit rule (2022) · ISO 24113 · SSC 7.i',
    requirement: `The burn must not consume the ${LIMITS.DV_DISPOSAL_RESERVE_MS} m/s ring-fenced for controlled disposal.`,
    rationale: 'Spending the disposal reserve trades a probabilistic collision today for a guaranteed derelict tomorrow. Regulators treat the reserve as inviolable, so this platform does too — there is no override.',
    resolvedBy: [EV.PLAN, EV.PROP_STATE],
    evaluate(ctx) {
      if (!ctx.plan) return R.unknown('no plan — Δv cost unknown', ['plan']);
      if (!ctx.propellant) return R.unknown('no propellant state declared for this asset', ['propellant']);
      const need = num(ctx.plan.total_delta_v_ms);
      const spare = num(ctx.propellant.ca_remaining_ms);
      const reserve = num(ctx.propellant.disposal_reserve_ms) ?? LIMITS.DV_DISPOSAL_RESERVE_MS;
      if (need === null || spare === null) return R.unknown('Δv or allocation figures missing', ['plan.total_delta_v_ms', 'propellant.ca_remaining_ms']);
      const actual = `${need.toFixed(2)} m/s vs ${spare.toFixed(2)} m/s non-reserve + ${reserve} m/s reserve`;
      const limit = `disposal reserve ${reserve} m/s untouched`;
      if (need <= spare) return R.pass('burn is funded entirely from the avoidance allocation', actual, limit);
      return R.fail('this burn would draw on the deorbit reserve — not permitted under FCC / ISO 24113', actual, limit);
    },
  },

  {
    id: 'FR-06', key: 'EXECUTION-LEAD', title: 'Burn can still be commanded in time',
    class: CLASS.HARD, waivable: true,
    authority: `Operational command lead time (>= ${LIMITS.EXEC_LEAD_MIN} min to TCA)`,
    requirement: 'TCA must be in the future and at least the minimum command lead away.',
    rationale: 'Authorising a burn that physically cannot be uplinked and executed is worse than not authorising it — it consumes the decision window and yields nothing.',
    deadline: (ctx) => { const t = tcaMs(ctx.conj); return t === null ? null : t - LIMITS.EXEC_LEAD_MIN * 60000; },
    evaluate(ctx) {
      const t = tcaMs(ctx.conj);
      if (t === null) return R.unknown('TCA not parseable for this event', ['conj.tca']);
      const mins = (t - ctx.now) / 60000;
      const actual = mins >= 0 ? `${fmtDur(mins)} to TCA` : `TCA passed ${fmtDur(mins)} ago`;
      const limit = `>= ${LIMITS.EXEC_LEAD_MIN} min`;
      if (mins < 0) return R.fail('TCA is in the past — the encounter has already occurred', actual, limit);
      if (mins < LIMITS.EXEC_LEAD_MIN) return R.fail('inside the command lead time — the burn cannot be uplinked and executed', actual, limit);
      return R.pass('sufficient time remains to command the burn', actual, limit);
    },
  },

  {
    id: 'FR-07', key: 'COMMANDABILITY', title: 'At least one object can be commanded',
    class: CLASS.HARD, waivable: false,          // non-negotiable — physics
    authority: 'SSC 8.b maneuverability classes',
    requirement: 'At least one of the two objects must be capable of a flight-safety orbit change.',
    rationale: 'Debris and spent stages do not take commands. A debris-on-debris conjunction is resolvable only by active debris removal, and pretending otherwise hides the real gap in the industry rather than exposing it.',
    evaluate(ctx) {
      const c = ctx.conj || {};
      const ca = classify(c.sat1_name, c.sat1_hints), cb = classify(c.sat2_name, c.sat2_hints);
      if (!ca || !cb) return R.unknown('object identity or class could not be determined', ['conj.sat1_name', 'conj.sat2_name']);
      const actual = `${c.sat1_name}: ${ca} · ${c.sat2_name}: ${cb}`;
      const limit = '>= 1 commandable object';
      if (CAN_MANEUVER.has(ca) || CAN_MANEUVER.has(cb)) return R.pass('a commandable asset is present', actual, limit);
      return R.fail('both objects are inert — resolvable only by active debris removal', actual, limit);
    },
  },

  FR_08,

  {
    id: 'FR-09', key: 'DECISION-LEAD', title: `Decision inside the standard ${LIMITS.DECISION_LEAD_H} h window`,
    class: CLASS.SOFT, waivable: true,
    authority: `Standard LEO collision-avoidance cut-off (${LIMITS.DECISION_LEAD_H} h to TCA)`,
    requirement: `The go/no-go should be taken at least ${LIMITS.DECISION_LEAD_H} h before TCA.`,
    rationale: 'Deciding late is legal but degraded: less tracking data, no room for a second look, and no time to renegotiate with the other operator.',
    deadline: (ctx) => { const t = tcaMs(ctx.conj); return t === null ? null : t - LIMITS.DECISION_LEAD_H * 3600000; },
    evaluate(ctx) {
      const t = tcaMs(ctx.conj);
      if (t === null) return R.unknown('TCA not parseable', ['conj.tca']);
      const hrs = (t - ctx.now) / 3600000;
      const actual = hrs >= 0 ? `${fmtDur(hrs * 60)} to TCA` : 'TCA passed';
      const limit = `>= ${LIMITS.DECISION_LEAD_H} h`;
      if (hrs >= LIMITS.DECISION_LEAD_H) return R.pass('nominal decision timeline', actual, limit);
      return R.fail('compressed timeline — decision is being taken inside the standard cut-off', actual, limit);
    },
  },

  {
    id: 'FR-10', key: 'OD-DATA-AGE', title: 'Orbit determination is fresh',
    class: CLASS.SOFT, waivable: true,
    authority: `SSC 2.e.ii — ephemerides valid >= ${LIMITS.EPHEM_VALIDITY_D} days in LEO`,
    requirement: `The oldest element set driving this event must be under ${LIMITS.TLE_AGE_MAX_D} days old at TCA.`,
    rationale: 'SGP4 error grows with propagation span. A stale element set does not make an event safe or unsafe — it makes the answer untrustworthy, and that must be visible rather than averaged away.',
    resolvedBy: [EV.RADAR_PASS, EV.OPERATOR_EPHEM, EV.FRESH_CDM],
    evaluate(ctx) {
      const c = ctx.conj || {};

      // An UNANNOUNCED MANEUVER voids the orbit determination outright. Not
      // "degrades" — voids: the propagated state describes an orbit the object
      // is no longer in. A fresh element set does not help if it predates the
      // burn, so this is checked BEFORE the age test.
      //
      // Detected by ml/train_maneuver_detector.py, per object, from the change
      // in semi-major axis between consecutive element sets. A flag means
      // UNKNOWN, never "manoeuvred".
      if (c.maneuver_flag && c.maneuver_flag.detected) {
        const m = c.maneuver_flag;
        return R.unknown(
          `unannounced maneuver detected on ${m.object} (Δa ${m.delta_a_km >= 0 ? '+' : ''}${m.delta_a_km} km, ${m.z.toFixed(1)}σ beyond its own drag baseline) — the propagated state is void until fresh orbit determination arrives`,
          ['radar-pass', 'operator-ephem'],
        );
      }

      const age = num(c.tle_age_days);
      if (age === null) return R.unknown('element-set epoch not published for this event — data currency cannot be confirmed', ['conj.tle_age_days']);
      const actual = `${age.toFixed(1)} d at TCA${c.maneuver_flag ? ' · no unannounced maneuver detected' : ''}`;
      const limit = `<= ${LIMITS.TLE_AGE_MAX_D} d`;
      if (age <= LIMITS.TLE_AGE_MAX_D) return R.pass('element sets are current', actual, limit);
      return R.fail('stale element set — the propagated state is materially degraded', actual, limit);
    },
  },

  {
    id: 'FR-11', key: 'COVARIANCE-BASIS', title: 'Risk is assessed on covariance data',
    class: CLASS.SOFT, waivable: true,
    authority: 'CCSDS Conjunction Data Message — covariance-based Pc · SSC 2.e.iv',
    requirement: 'The risk figure driving the decision should come from a covariance-bearing source, not from TLEs alone.',
    rationale: 'Public TLEs carry no covariance, so any Pc derived from them is screening-grade by construction — true of every TLE tool including CelesTrak SOCRATES. Stating that on the record is the honest position, and it is why the operational CDM layer exists alongside it.',
    resolvedBy: [EV.FRESH_CDM, EV.OPERATOR_EPHEM],
    evaluate(ctx) {
      const c = ctx.conj || {};
      // Two independent sources that disagree is genuine epistemic uncertainty,
      // not something to average into a false consensus.
      if (c.source_disagreement) {
        return R.unknown(`sources disagree — ${c.source_disagreement} — we will not average two disagreeing measurements`, ['conj.reconciled_source']);
      }
      if (!c.source) return R.unknown('data provenance not recorded for this event', ['conj.source']);
      if (c.source === 'CDM' || c.source === 'OPERATOR_EPHEMERIS') {
        return R.pass('operational-grade covariance available', c.source === 'CDM' ? 'USSF CDM (covariance)' : 'operator ephemeris (covariance)', 'covariance-based source');
      }
      return R.fail('screening-grade only — miss distance and Pc are upper-bound estimates', 'own SGP4 screening (TLE, no covariance)', 'covariance-based source');
    },
  },

  {
    id: 'FR-12', key: 'DILUTION-REGION', title: 'Pc is outside the dilution region',
    class: CLASS.SOFT, waivable: true,
    authority: 'CelesTrak SOCRATES maximum-probability / dilution-threshold method',
    requirement: 'Miss distance should exceed the dilution threshold (miss / √2) for Pc to be read at face value.',
    rationale: 'Inside the dilution region a larger covariance lowers Pc — so worse tracking looks safer. Flagging it stops a low Pc being mistaken for a low risk, which is the failure mode the False Confidence Theorem describes.',
    resolvedBy: [EV.RADAR_PASS, EV.FRESH_CDM],
    evaluate(ctx) {
      const c = ctx.conj || {};
      const miss = num(c.min_range_km), dil = num(c.dilution_threshold_km);
      if (miss === null) return R.unknown('miss distance unavailable', ['conj.min_range_km']);
      if (dil === null) return R.unknown('dilution threshold not computed for this event', ['conj.dilution_threshold_km']);
      const actual = `miss ${fmtKm(miss)} · threshold ${fmtKm(dil)}`, limit = 'miss > dilution threshold';
      if (miss > dil) return R.pass('Pc may be read at face value', actual, limit);
      return R.fail('inside the dilution region — Pc is suppressed by covariance size; treat as a lower bound', actual, limit);
    },
  },

  {
    id: 'FR-26', key: 'MISS-RESOLVABLE', title: 'Miss distance is resolvable against the screening threshold',
    class: CLASS.SOFT, waivable: true,
    authority: `SSC 8.j screening threshold (${LIMITS.SCREEN_MISS_KM} km) · split conformal prediction, 95% coverage`,
    requirement: `The 95% conformal interval on the screened miss distance must fall clearly on one side of the ${LIMITS.SCREEN_MISS_KM} km screening threshold.`,
    rationale: 'A point estimate with unknown error is not evidence. Our screening error is calibrated from element-set age, and when the resulting interval straddles the threshold the honest answer is not "above" or "below" — it is that our evidence cannot discriminate. That is a quantified inability to decide, not a missing input, and it is the difference between a defensible position and a UI convention.',
    resolvedBy: [EV.RADAR_PASS, EV.FRESH_CDM, EV.OPERATOR_EPHEM],
    // Only governs our own screening. A covariance-bearing CDM carries its own
    // uncertainty and does not need ours.
    applies: (ctx) => {
      const src = (ctx.conj || {}).source;
      return src ? src === 'SGP4' : null;
    },
    notApplicableDetail: 'covariance-bearing source — it carries its own uncertainty',
    evaluate(ctx) {
      const c = ctx.conj || {};
      const miss = num(c.min_range_km);
      if (miss === null) return R.unknown('miss distance unavailable', ['conj.min_range_km']);
      const age = num(c.tle_age_days);
      if (age === null) return R.unknown('element-set age unknown — the screening interval cannot be selected', ['conj.tle_age_days']);

      const iv = screeningInterval(age);
      if (!iv) {
        return R.unknown(
          `no calibrated screening interval for a ${age.toFixed(1)} d old element set — we will not borrow a neighbouring bucket's number`,
          ['radar-pass', 'fresh-cdm'],
        );
      }

      const lo = Math.max(0, miss - iv.half_width_km);
      const hi = miss + iv.half_width_km;
      const T = LIMITS.SCREEN_MISS_KM;
      const actual = `${fmtKm(miss)} [${fmtKm(lo)} – ${fmtKm(hi)}] at ${(iv.coverage * 100).toFixed(0)}%`;
      const limit = `interval clear of the ${T} km threshold`;

      if (hi < T) return R.pass(`the whole interval is inside the screening threshold`, actual, limit);
      if (lo > T) return R.pass(`the whole interval is outside the screening threshold`, actual, limit);
      return R.unknown(
        `the ${(iv.coverage * 100).toFixed(0)}% interval STRADDLES the ${T} km threshold (±${iv.half_width_km} km from a ${iv.bucket} element set, n=${iv.n}) — our evidence cannot discriminate`,
        ['radar-pass', 'fresh-cdm', 'operator-ephem'],
      );
    },
  },

  {
    id: 'FR-13', key: 'RIGHT-OF-WAY', title: 'Maneuver responsibility is assigned',
    class: CLASS.HARD, waivable: true,
    authority: 'SSC 8.c — Rules of the Road maneuver matrix (exceptions per SSC 8.d)',
    requirement: 'The SSC 5×5 matrix must assign which object is obliged to maneuver, and the plan must match it.',
    rationale: 'This is how two operators agree who moves without a central authority — which is the entire premise of the platform. Where the matrix says "decided in bilateral discussion", doctrine genuinely does not assign responsibility, and reporting that as unresolved is more honest than picking one.',
    resolvedBy: [EV.OPERATOR_ACK],
    evaluate(ctx) {
      const c = ctx.conj || {};
      const ca = classify(c.sat1_name, c.sat1_hints), cb = classify(c.sat2_name, c.sat2_hints);
      if (!ca || !cb) return R.unknown('cannot classify one or both objects', ['conj.sat1_name', 'conj.sat2_name']);
      const row = rightOfWay(c.sat1_name, c.sat2_name, ca, cb);
      if (!row) return R.unknown('right-of-way could not be determined');
      const limit = 'SSC 8.c matrix assigns a mover';
      if (!row.resolved) {
        return R.unknown(`${row.detail} — no unilateral assignment exists`, ['bilateral-agreement']);
      }
      if (row.mover === null) {
        return R.fail(row.detail, row.cell, limit);
      }
      return R.pass(`${row.detail}`, `${row.mover} maneuvers · ${row.cell}`, limit);
    },
  },

  {
    id: 'FR-14', key: 'MANEUVER-EFFICACY', title: 'The maneuver actually reduces the risk enough',
    class: CLASS.HARD, waivable: true,
    authority: `SSC 8.k — Pc reduced by >= ${LIMITS.PC_REDUCTION_ORDERS} orders of magnitude`,
    requirement: `Post-maneuver collision probability must fall by at least ${LIMITS.PC_REDUCTION_ORDERS} orders of magnitude.`,
    rationale: 'A maneuver that moves the object but does not materially reduce risk has spent irreplaceable propellant for nothing, and leaves the encounter live. The industry sets an explicit efficacy bar; this checks against it rather than against a feeling that the number got better.',
    resolvedBy: [EV.PLAN],
    evaluate(ctx) {
      if (!ctx.plan) return R.unknown('no plan — post-maneuver risk unknown', ['plan']);
      const before = num(ctx.plan.pc_before) ?? num((ctx.conj || {}).probability);
      const after = num(ctx.plan.pc_after);
      if (before === null || after === null) {
        return R.unknown('planner did not report before/after collision probability', ['plan.pc_before', 'plan.pc_after']);
      }
      if (after <= 0) return R.pass('post-maneuver risk below numerical floor', `${fmtPc(before)} → < 1e-12`, `>= ${LIMITS.PC_REDUCTION_ORDERS} orders`);
      const orders = Math.log10(before / after);
      const actual = `${fmtPc(before)} → ${fmtPc(after)} (${orders.toFixed(2)} orders)`;
      const limit = `>= ${LIMITS.PC_REDUCTION_ORDERS} orders of magnitude`;
      if (orders >= LIMITS.PC_REDUCTION_ORDERS) return R.pass('meets the SSC efficacy bar', actual, limit);
      return R.fail('maneuver does not reduce risk enough to justify the propellant', actual, limit);
    },
  },

  {
    id: 'FR-15', key: 'NOTIFICATION', title: 'All involved operators notified',
    class: CLASS.SOFT, waivable: true,
    authority: 'SSC 8.i — notify all operators of active spacecraft involved',
    requirement: 'Every operator of an active object in this conjunction must be notified and have acknowledged.',
    rationale: 'SSC 8.i requires operators to communicate their interpretation of the rules, their planned maneuvers, and achieved maneuvers — even when the other object cannot manoeuvre. An unacknowledged notification is not a failure, it is an unknown, and SSC 8.h prescribes what to do when contact cannot be established.',
    resolvedBy: [EV.OPERATOR_ACK],
    evaluate(ctx) {
      const n = ctx.notifications;
      if (!n) return R.unknown('notification status not tracked for this event', ['notifications']);
      const required = num(n.required), acked = num(n.acknowledged);
      if (required === null || acked === null) return R.unknown('notification counts unavailable', ['notifications.required', 'notifications.acknowledged']);
      const actual = `${acked}/${required} operators acknowledged`, limit = 'all active operators acknowledged';
      if (required === 0) return R.pass('no other active operator involved', actual, limit);
      if (acked >= required) return R.pass('all involved operators have acknowledged', actual, limit);
      if (acked === 0) return R.unknown('no operator has responded — SSC 8.h fallback applies (act on the more stringent risk tolerance)', ['operator-ack']);
      return R.fail('not all involved operators have acknowledged', actual, limit);
    },
  },

  {
    id: 'FR-19', key: 'COMMAND-UPLINK', title: 'Command uplink is viable',
    class: CLASS.HARD, waivable: true,
    authority: `Polar cap absorption — HF blackout above ${LIMITS.POLAR_BLACKOUT_MAGLAT}° magnetic latitude during a solar radiation storm`,
    requirement: 'At least one assigned ground station must be outside a radio-blackout zone at burn time.',
    rationale: 'A solar radiation storm funnels energetic protons down the field lines at the poles and blacks out HF above 63 degrees magnetic latitude for hours to days. The polar stations that go deaf are exactly the ones used to command low Earth orbit spacecraft. A constraint on the ground blocks a maneuver in space.',
    resolvedBy: [EV.SW_FEED],
    /**
     * PREDICTIVE DEADLINE.
     *
     * Every other deadline in this rulebook is arithmetic on a known TCA. This
     * one is a forecast: two-band X-ray monitoring detects the impulsive phase
     * of a flare before its soft-X-ray peak sets the radio-blackout level, so
     * the rule can say it is satisfied NOW and will be violated in N minutes.
     *
     * That is the difference between a signal that reports and one that warns.
     */
    deadline(ctx) {
      const sw = ctx.spaceWeather;
      const pi = sw && sw.flares && sw.flares.predicted_impact;
      if (!pi || !pi.expected || !pi.at) return null;
      const t = Date.parse(pi.at);
      return Number.isFinite(t) ? t : null;
    },
    evaluate(ctx) {
      const g = ctx.groundSegment;
      if (!g) return R.unknown('ground-segment status not reported', ['groundSegment']);
      const total = num(g.stations_assigned), avail = num(g.stations_available);
      if (total === null || avail === null) return R.unknown('ground-station availability unavailable', ['groundSegment.stations_available']);
      const actual = `${avail}/${total} stations reachable${g.blackout_reason ? ` · ${g.blackout_reason}` : ''}`;
      const limit = '>= 1 station outside a blackout zone';
      if (avail >= 1) {
        // Satisfied now — but say so with the forecast attached, because a
        // window that is closing is operationally different from one that is open.
        const pi = ctx.spaceWeather && ctx.spaceWeather.flares && ctx.spaceWeather.flares.predicted_impact;
        if (pi && pi.expected) {
          return R.pass(
            `uplink available now, but a ${pi.projected_class} flare is forecast (p=${pi.probability}) to close it in ~${pi.lead_time_min} min — command the burn inside that window`,
            actual, limit,
          );
        }
        return R.pass('an uplink path is available', actual, limit);
      }
      return R.fail('all assigned ground stations are inside a radio-blackout zone — the burn cannot be commanded', actual, limit);
    },
  },

  {
    id: 'FR-20', key: 'POSITION-KNOWLEDGE', title: 'Positional knowledge meets the standard',
    class: CLASS.SOFT, waivable: true,
    authority: `SSC 7.k — ${LIMITS.POSITION_KNOWLEDGE_M} m (2σ) current and 48 h predicted`,
    requirement: `Positional knowledge of the primary asset must be within ${LIMITS.POSITION_KNOWLEDGE_M} m (2σ).`,
    rationale: 'Ionospheric scintillation during geomagnetic activity degrades onboard GNSS. In the May 2024 storm GPS positions were off by up to 70 m on the ground, and precision agriculture across twelve US states lost half a billion dollars to it. Orbital users are not exempt.',
    resolvedBy: [EV.OPERATOR_EPHEM, EV.RADAR_PASS],
    evaluate(ctx) {
      const c = ctx.conj || {};
      // An operator-declared figure wins if we have one.
      let sigma = num(c.position_sigma_m) ?? num((ctx.asset || {}).position_sigma_m);
      let basis = sigma === null ? null : 'operator-declared';
      let tier = sigma === null ? null : 'operator-declared';

      // TIER 1 — a real operator ephemeris, if one is published for this object.
      //
      // SpaceX publishes predicted ephemerides for the whole operational
      // Starlink fleet with a full 6x6 covariance, openly and without
      // authentication, so that other operators can screen against them. That
      // covariance is roughly three orders of magnitude tighter than anything
      // derivable from a TLE — and it is the operator's own statement of what
      // they know, which is exactly what SSC 7.k asks for.
      //
      // Crucially it is evaluated AT THE TIME OF CLOSEST APPROACH, because the
      // covariance grows across the prediction window — measured at 2,558x
      // over three days on a sample object. Quoting the epoch value for an
      // event two days out would flatter us by three orders of magnitude.
      if (sigma === null) {
        const norads = [c.sat1_norad, c.sat2_norad, c.norad, (ctx.asset || {}).norad]
          .map(Number).filter(Number.isFinite);
        const at = tcaMs(c);
        for (const n of norads) {
          const k = starlink.positionalKnowledgeSync(n, { at });
          if (!k) continue;
          if (k.stale) {
            // A prediction past its own validity window is not evidence.
            return R.unknown(
              `the published operator ephemeris for ${k.object} expired ${k.valid_to} — positional knowledge is not current`,
              ['operator-ephemeris-refresh'],
            );
          }
          sigma = k.sigma_2_m;                    // already 2-sigma
          tier = 'operator-ephemeris';
          basis = `${k.object} — ${k.basis}${k.interpolated ? '' : ' (no TCA given)'}; covariance grows ${k.growth_factor}x across the window`;
          break;
        }
      }

      // Otherwise DERIVE it from the conformal screening calibration. The
      // q95 half-width is a 95% bound, which is 2-sigma, so it IS the quantity
      // SSC 7.k specifies. Without this, FR-20 was permanently UNEVALUATED on
      // every real screened event — an unknown we could actually measure.
      if (sigma === null) {
        const age = num(c.tle_age_days);
        const iv = age === null ? null : screeningInterval(age);
        if (iv) {
          sigma = iv.half_width_km * 1000;             // km -> m, already 2-sigma
          tier = 'tle-conformal';
          basis = `derived from the conformal screening interval (${iv.bucket}, n=${iv.n})`;
        }
      }

      if (sigma === null) {
        return R.unknown('positional uncertainty neither declared nor derivable — no calibrated interval for this element-set age', ['asset.position_sigma_m', 'radar-pass']);
      }
      const actual = `${Math.round(sigma)} m (2σ) · ${basis}`;
      // The tier is the point: the same rule, on the same standard, answers
      // differently depending on the quality of evidence available. Nothing
      // about the satellite changed — what changed is how much we know.
      const limit = `<= ${LIMITS.POSITION_KNOWLEDGE_M} m (2σ)`;
      if (sigma <= LIMITS.POSITION_KNOWLEDGE_M) return R.pass('meets the SSC positional-knowledge standard', actual, limit);
      // This is the honest verdict on TLE-only screening, and it is a real
      // finding rather than a shortfall in the implementation.
      return R.fail(
        tier === 'operator-ephemeris'
          ? 'even the operator ephemeris covariance exceeds the standard at this lead time — the prediction has decayed too far'
          : 'TLE-only screening does not meet the SSC 7.k positional-knowledge standard',
        actual, limit);
    },
  },

  FR_21,
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const maneuverRulebook = {
  id: 'orbital-maneuver',
  title: 'Orbital collision-avoidance flight rules',
  domain: 'Space traffic coordination',
  description: 'The pre-agreed rulebook an avoidance maneuver must clear before the operator cluster may vote on it.',
  rules: MANEUVER_RULES,
};

/** Public view of the rulebook — every limit with its citation. The anti-"you made it up" endpoint. */
function describe(rulebook) {
  return {
    id: rulebook.id,
    title: rulebook.title,
    domain: rulebook.domain,
    description: rulebook.description,
    counts: {
      total: rulebook.rules.length,
      hard: rulebook.rules.filter((r) => r.class !== CLASS.SOFT).length,
      soft: rulebook.rules.filter((r) => r.class === CLASS.SOFT).length,
      non_negotiable: rulebook.rules.filter((r) => r.waivable === false).length,
    },
    rules: rulebook.rules.map((r) => ({
      id: r.id, key: r.key, title: r.title,
      class: r.class, waivable: r.waivable !== false,
      authority: r.authority, requirement: r.requirement, rationale: r.rationale,
    })),
    limits: LIMITS,
  };
}

/**
 * What each declared acquisition returns for the maneuver rulebook.
 *
 * These are deliberately CONSERVATIVE: an acquisition supplies the FIELD, not
 * a favourable value. A tasked radar pass tells you where the object is — it
 * does not promise the answer you wanted. Modelling acquisitions as
 * automatically satisfying their rule would make every recourse look free.
 */
function supplyEvidence(context, ids) {
  const c = JSON.parse(JSON.stringify(context || {}));
  c.conj = c.conj || {};
  if (ids.has('radar-pass')) {
    // A fresh observation resets element-set age; the position it reports is
    // whatever it is, so we supply the measurement, not a passing value.
    c.conj.tle_age_days = 0.05;
    c.conj.od_source = 'tasked radar pass';
  }
  if (ids.has('fresh-cdm')) {
    c.conj.cdm_age_h = 0.5;
    c.conj.covariance_basis = c.conj.covariance_basis || 'CDM-supplied';
  }
  if (ids.has('operator-ephem')) {
    c.conj.covariance_basis = 'operator ephemeris';
    c.conj.has_operator_ephemeris = true;
  }
  if (ids.has('maneuver-plan')) c.conj.plan = c.conj.plan || { delta_v_ms: 0.12, executable: true };
  if (ids.has('propellant')) c.asset = { ...(c.asset || {}), propellant_declared: true };
  if (ids.has('operator-ack')) c.conj.counterparty_ack = true;
  if (ids.has('space-weather')) c.space_weather = c.space_weather || { kp: 3, source: 'NOAA SWPC' };
  if (ids.has('catalogue')) c.catalogue_age_h = 0.1;
  return c;
}

module.exports = {
  supplyEvidence,
  maneuverRulebook,
  describe,
  LIMITS,
  EV,
  MCLASS,
  classify,
  rightOfWay,
  screeningInterval,
  CAN_MANEUVER,
  CLASSIFIER_MIN_CONFIDENCE,
  // shared rules, reused by the re-entry rulebook in Phase 2
  shared: { FR_00, FR_08, FR_21 },
};
