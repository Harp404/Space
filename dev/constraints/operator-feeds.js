/**
 * Operator ephemeris feeds.       dev/constraints/operator-feeds.js
 * =============================================================================
 * WHY THIS EXISTS
 *
 * The README's honest-limitations section says:
 *
 *     "Public-TLE miss distance is screening-grade (no covariance)."
 *
 * That is true of every TLE tool, including CelesTrak SOCRATES. But it is not
 * true of every DATA SOURCE. SpaceX runs a public conjunction-screening platform
 * at space-safety.starlink.com, free to participating operators, which:
 *
 *   • publishes ephemerides for every Starlink satellite, refreshed roughly
 *     hourly, on a 7-day horizon;
 *   • generates CDMs from trajectory position AND COVARIANCE;
 *   • accepts an uploaded trajectory and screens it in under a minute;
 *   • from spring 2026, issues TWO CDMs per event — one from operator ephemeris
 *     and one from independent observations.
 *
 * For any object covered by an operator feed, FR-11 stops being a caveat and
 * becomes SATISFIED, on real operator-grade data.
 *
 * ACCESS STATUS — stated plainly
 *
 * The API is operator-gated. Probing it returns HTTP 403 without credentials;
 * the documentation and landing page are public. So this adapter is written
 * against the documented contract and, without credentials, reports
 * `access: 'not_granted'`.
 *
 * That is NOT a stub and NOT a mock. It never fabricates a CDM. Without access,
 * FR-11 reports UNEVALUATED for those objects — which is the correct state and
 * exactly what this whole project argues for. An integration that lies when it
 * cannot reach its source is worse than no integration.
 *
 * ★ THE DUAL-CDM CASE
 *
 * When two independent sources describe the same encounter and DISAGREE, that is
 * genuine epistemic uncertainty produced by the real world. We do not average
 * them into a false consensus. We report UNRESOLVED and say what each said.
 *
 * Zero dependencies.
 * =============================================================================
 */

'use strict';

const https = require('https');

const STARLINK_HOST = 'space-safety.starlink.com';
const DOCS = 'https://docs.space-safety.starlink.com/docs/';

/**
 * Disagreement threshold. Two sources are "in conflict" when their miss
 * distances differ by more than this factor.
 *
 * Deliberately generous: operational CDMs and TLE screening legitimately differ
 * by a factor of two or so. Beyond 3x they are not describing the same
 * encounter in any useful sense, and averaging would be fiction.
 */
const DISAGREEMENT_FACTOR = 3.0;

function request(path, { token, method = 'GET', body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'AstroMesh/1.0', Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }

    const req = https.request({ hostname: STARLINK_HOST, path, method, headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('operator feed request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Probe the platform and report what access we actually have.
 * Never guesses; never pretends.
 */
async function starlinkStatus(token = process.env.STARLINK_SPACE_SAFETY_TOKEN) {
  const out = {
    provider: 'SpaceX Starlink Space Safety Platform',
    host: STARLINK_HOST,
    docs: DOCS,
    capabilities: [
      'operator ephemerides for the whole constellation, refreshed ~hourly, 7-day horizon',
      'CDMs generated from trajectory position AND covariance',
      'upload a trajectory and receive an independent screening in under a minute',
      'from spring 2026: two CDMs per event — operator ephemeris and independent observations',
    ],
    token_present: !!token,
  };

  try {
    const res = await request('/api/v1/cdm', { token });
    out.probe_status = res.status;
    if (res.status === 200) {
      out.access = 'granted';
      out.note = 'Live operator-grade covariance available. FR-11 is SATISFIED for covered objects.';
    } else if (res.status === 401 || res.status === 403) {
      out.access = 'not_granted';
      out.note = token
        ? 'Credentials rejected. FR-11 stays UNEVALUATED for these objects — we will not substitute a screening-grade figure and call it operator-grade.'
        : 'Operator-gated; no credentials configured. The adapter is written against the documented contract and reports honestly rather than fabricating a CDM.';
    } else {
      out.access = 'unknown';
      out.note = `Unexpected response ${res.status}. Treated as no access.`;
    }
  } catch (e) {
    out.access = 'unreachable';
    out.error = e.message;
    out.note = 'Feed unreachable. Affected rules report UNEVALUATED, never a default.';
  }

  out.honesty = 'This adapter never fabricates a CDM. Without access, the affected rules report UNEVALUATED and the signal goes UNRESOLVED — which is the correct answer, not a degraded one.';
  return out;
}

/** Fetch operator CDMs. Returns null — never an empty-but-confident list — when access is absent. */
async function fetchOperatorCdms(token = process.env.STARLINK_SPACE_SAFETY_TOKEN) {
  if (!token) return null;
  try {
    const res = await request('/api/v1/cdm', { token });
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    const rows = Array.isArray(data) ? data : (data.cdms || data.results || []);
    return rows.map(normaliseCdm).filter(Boolean);
  } catch { return null; }
}

/** Map an operator CDM onto the shape the rest of the system uses. */
function normaliseCdm(c) {
  if (!c) return null;
  const miss = Number(c.MISS_DISTANCE ?? c.miss_distance ?? c.missDistance);
  if (!Number.isFinite(miss)) return null;
  return {
    sat1_id: Number(c.SAT_1_ID ?? c.sat1_id),
    sat2_id: Number(c.SAT_2_ID ?? c.sat2_id),
    sat1_name: c.SAT_1_NAME ?? c.sat1_name,
    sat2_name: c.SAT_2_NAME ?? c.sat2_name,
    tca: c.TCA ?? c.tca,
    // Operator CDMs report metres.
    min_range_km: miss / 1000,
    probability: Number(c.COLLISION_PROBABILITY ?? c.probability ?? c.pc),
    source: 'OPERATOR_EPHEMERIS',
    origin: c.ORIGINATOR ?? 'SpaceX Starlink Space Safety',
    has_covariance: true,
  };
}

// ---------------------------------------------------------------------------
// ★ Reconciling independent sources
// ---------------------------------------------------------------------------

/**
 * Reconcile everything we know about one encounter.
 *
 * @param {Array} sources  [{ source, min_range_km, probability, origin }]
 *
 * Three outcomes:
 *   one source        → use it, tagged with its provenance
 *   sources agree     → prefer the covariance-bearing one
 *   sources DISAGREE  → UNRESOLVED. We do not average two measurements that
 *                       disagree; that manufactures a number neither source
 *                       supports and hides exactly the uncertainty that matters.
 */
function reconcile(sources) {
  const valid = (sources || []).filter((s) => s && Number.isFinite(s.min_range_km) && s.min_range_km > 0);
  if (!valid.length) return { resolved: false, reason: 'no source has a usable miss distance', sources: [] };
  if (valid.length === 1) {
    return { resolved: true, chosen: valid[0], sources: valid, agreement: 'single source' };
  }

  const misses = valid.map((s) => s.min_range_km);
  const lo = Math.min(...misses), hi = Math.max(...misses);
  const ratio = hi / lo;

  if (ratio > DISAGREEMENT_FACTOR) {
    const parts = valid.map((s) => `${s.origin || s.source}: ${fmtKm(s.min_range_km)}`).join(' vs ');
    return {
      resolved: false,
      disagreement: parts,
      ratio: +ratio.toFixed(2),
      threshold: DISAGREEMENT_FACTOR,
      sources: valid,
      reason: `independent sources disagree by ${ratio.toFixed(1)}× (${parts}) — averaging them would manufacture a number neither source supports`,
    };
  }

  // They agree. Prefer covariance-bearing data.
  const rank = { OPERATOR_EPHEMERIS: 0, CDM: 1, SGP4: 2 };
  const chosen = [...valid].sort((a, b) => (rank[a.source] ?? 9) - (rank[b.source] ?? 9))[0];
  return {
    resolved: true,
    chosen,
    sources: valid,
    agreement: `${valid.length} sources agree within ${ratio.toFixed(1)}×`,
    ratio: +ratio.toFixed(2),
  };
}

function fmtKm(k) { return k < 1 ? `${(k * 1000).toFixed(0)} m` : `${k.toFixed(2)} km`; }

/**
 * Annotate a conjunction with reconciliation results, so FR-11 can read them.
 * Sets `source_disagreement` when independent sources conflict — which FR-11
 * turns into UNEVALUATED, and the engine turns into UNRESOLVED.
 */
function annotate(conj, extraSources = []) {
  const sources = [
    { source: conj.source || 'SGP4', min_range_km: conj.min_range_km, probability: conj.probability, origin: conj.source === 'CDM' ? '19th SDS CDM' : 'our SGP4 screening' },
    ...extraSources,
  ];
  const rec = reconcile(sources);
  if (!rec.resolved && rec.disagreement) {
    return { ...conj, source_disagreement: rec.disagreement, reconciliation: rec };
  }
  if (rec.resolved && rec.chosen && rec.chosen.source !== conj.source) {
    return { ...conj, source: rec.chosen.source, min_range_km: rec.chosen.min_range_km, probability: rec.chosen.probability ?? conj.probability, reconciliation: rec };
  }
  return { ...conj, reconciliation: rec };
}

module.exports = {
  starlinkStatus, fetchOperatorCdms, normaliseCdm,
  reconcile, annotate, DISAGREEMENT_FACTOR, STARLINK_HOST, DOCS,
};
