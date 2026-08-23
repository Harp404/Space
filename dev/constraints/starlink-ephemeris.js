/**
 * Operator ephemerides.        dev/constraints/starlink-ephemeris.js
 * =============================================================================
 * WHAT THIS IS
 *
 * SpaceX publishes predicted ephemerides for the entire operational Starlink
 * fleet, openly and without authentication, so that other operators can screen
 * conjunctions against them:
 *
 *     https://api.starlink.com/public-files/ephemerides/MANIFEST.txt
 *
 * Each file is a 3-day prediction at 60-second steps in the MEME frame, and —
 * this is the part that matters — every state carries a full 6x6 COVARIANCE in
 * the UVW (radial / in-track / cross-track) frame.
 *
 * WHY IT CHANGES A RULE'S ANSWER
 *
 * FR-20 requires positional knowledge within 500 m (2 sigma), per Space Safety
 * Coalition best practice 7.k. Our own screening is TLE-derived, and our
 * conformal calibration measured that honestly at 1689 m (2 sigma) — which
 * FAILS the standard, and we say so rather than pretending otherwise.
 *
 * An operator ephemeris carries a covariance that is roughly three orders of
 * magnitude tighter. So the same rule, on the same object, returns:
 *
 *     TLE-only                  1689 m (2s)  ->  VIOLATED
 *     operator ephemeris        ~3 m   (2s)  ->  SATISFIED
 *
 * Nothing about the satellite changed. What changed is how much we know about
 * it. That is precisely the distinction this whole system exists to make
 * visible, and here it is grounded in a public feed rather than an argument.
 *
 * WHAT WE DO NOT CLAIM
 *
 * * Coverage is Starlink only. Every other object stays TLE-only, and the
 *   report says which tier each object was screened at. We never quote the
 *   good number for an object that did not get the good data.
 * * A covariance is the operator's own estimate of their own knowledge. It is
 *   evidence, not ground truth. We report it as sourced, not as fact.
 * * The feed is a PREDICTION with a stated validity window. Past the window it
 *   is stale, and a stale ephemeris makes FR-20 UNEVALUATED, not SATISFIED.
 *
 * Zero dependencies. Network access is optional — everything degrades to
 * "unavailable", never to a fabricated value.
 * =============================================================================
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'api.starlink.com';
const BASE = '/public-files/ephemerides';
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'starlink');
const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;      // the feed refreshes daily
const SSC_LIMIT_2SIGMA_M = 500;                  // SSC best practice 7.k

let manifestCache = null;                        // { fetched, entries: Map }

function get(pathname, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: HOST, path: pathname, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`starlink ${pathname} -> HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

/**
 * Filenames encode everything we need to index the fleet without downloading
 * 11,000 files:
 *
 *   MEME_58853_STARLINK-31238_2341021_Operational_1471688520_UNCLASSIFIED.txt
 *        ^^^^^ ^^^^^^^^^^^^^^          ^^^^^^^^^^^
 *        NORAD   object name           operational status
 */
function parseName(line) {
  const f = line.trim();
  if (!f || !f.endsWith('.txt')) return null;
  const p = f.split('_');
  if (p.length < 6 || p[0] !== 'MEME') return null;
  const norad = Number(p[1]);
  if (!Number.isFinite(norad)) return null;
  return { file: f, norad, name: p[2], status: p[4] };
}

/** The fleet index. Cached on disk so a demo never depends on the network. */
async function manifest({ force = false } = {}) {
  if (!force && manifestCache && Date.now() - manifestCache.fetched < MANIFEST_TTL_MS) {
    return manifestCache;
  }
  const cachePath = path.join(CACHE_DIR, 'manifest.json');
  if (!force) {
    try {
      const j = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Date.now() - j.fetched < MANIFEST_TTL_MS) {
        manifestCache = { fetched: j.fetched, entries: new Map(j.entries) };
        return manifestCache;
      }
    } catch { /* no cache yet — fall through and fetch */ }
  }

  const body = await get(`${BASE}/MANIFEST.txt`, 60000);
  const entries = new Map();
  for (const line of body.split('\n')) {
    const e = parseName(line);
    if (e) entries.set(e.norad, e);
  }
  if (!entries.size) throw new Error('starlink manifest parsed to zero entries');

  manifestCache = { fetched: Date.now(), entries };
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      fetched: manifestCache.fetched,
      entries: [...entries.entries()],
    }));
  } catch { /* cache is a convenience, not a requirement */ }
  return manifestCache;
}

/**
 * Parse one ephemeris.
 *
 * Layout: three header lines, a frame line, then repeating blocks of
 *   1 line  epoch + position(km) + velocity(km/s)     [MEME]
 *   3 lines 21 lower-triangular terms of the 6x6 covariance  [UVW, km^2]
 *
 * We keep only what a constraint needs: the validity window and the position
 * uncertainty. Holding 4,320 full states per satellite would cost megabytes to
 * answer a question about metres.
 */
function parseEphemeris(text) {
  const lines = text.split('\n');
  const head = {};
  for (const l of lines.slice(0, 4)) {
    const m1 = l.match(/ephemeris_start:(\S+ \S+ \S+)\s+ephemeris_stop:(\S+ \S+ \S+)\s+step_size:(\d+)/);
    if (m1) { head.start = m1[1]; head.stop = m1[2]; head.step_s = Number(m1[3]); }
    const m2 = l.match(/^created:(.+)$/);
    if (m2) head.created = m2[1].trim();
    const m3 = l.match(/^ephemeris_source:(\S+)/);
    if (m3) head.source = m3[1];
  }

  const states = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^\d{13}\./.test(t)) continue;
    const s = t.split(/\s+/).map(Number);
    if (s.length < 7) continue;
    const cov = `${lines[i + 1] || ''} ${lines[i + 2] || ''} ${lines[i + 3] || ''}`
      .trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (cov.length < 21) continue;
    // Diagonal of a row-packed 6x6 lower triangle: 0, 2, 5, 9, 14, 20.
    const varU = cov[0], varV = cov[2], varW = cov[5];   // km^2
    states.push({
      stamp: s[0],
      r_km: [s[1], s[2], s[3]],
      v_kms: [s[4], s[5], s[6]],
      // RSS of the three position variances -> a single 1-sigma radius.
      sigma_1_m: Math.sqrt(Math.max(0, varU + varV + varW)) * 1000,
    });
    i += 3;
  }
  return { ...head, states };
}

/**
 * The state nearest a wanted time.
 *
 * Stamps are packed as YYYYDDDHHMMSS.sss (day-of-year), which is not a format
 * Date.parse understands, so we unpack it rather than guess.
 */
function stampToMs(stamp) {
  const s = String(stamp);
  const year = Number(s.slice(0, 4));
  const doy = Number(s.slice(4, 7));
  const hh = Number(s.slice(7, 9));
  const mm = Number(s.slice(9, 11));
  const ss = Number(s.slice(11, 13));
  if (![year, doy, hh, mm, ss].every(Number.isFinite)) return null;
  return Date.UTC(year, 0, 1, hh, mm, ss) + (doy - 1) * 86400000;
}

function nearestState(states, wantMs) {
  let best = null, bestGap = Infinity;
  for (const st of states) {
    const t = stampToMs(st.stamp);
    if (t == null) continue;
    const gap = Math.abs(t - wantMs);
    if (gap < bestGap) { bestGap = gap; best = st; }
  }
  // Outside the window there is nothing to interpolate to; refusing is correct.
  return bestGap <= 12 * 3600 * 1000 ? best : null;
}

/** Convert the header's "YYYY-MM-DD HH:MM:SS UTC" to epoch millis. */
function toMs(s) {
  if (!s) return null;
  const t = Date.parse(s.replace(' UTC', 'Z').replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

/**
 * Positional knowledge for one object, as FR-20 needs it.
 *
 * Returns null when we simply do not have operator data — the caller must
 * treat that as "fall back to the TLE tier", never as a pass.
 */
async function positionalKnowledge(norad, { now = Date.now(), at = null } = {}) {
  let entry;
  try {
    const m = await manifest();
    entry = m.entries.get(Number(norad));
  } catch (e) {
    return { available: false, reason: `manifest unavailable: ${e.message}` };
  }
  if (!entry) {
    return {
      available: false,
      reason: 'no operator ephemeris published for this object — TLE tier applies',
    };
  }

  let text;
  const cachePath = path.join(CACHE_DIR, entry.file);
  try {
    const st = fs.statSync(cachePath);
    if (now - st.mtimeMs < MANIFEST_TTL_MS) text = fs.readFileSync(cachePath, 'utf8');
  } catch { /* not cached */ }
  if (!text) {
    try {
      text = await get(`${BASE}/${entry.file}`, 45000);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cachePath, text);
    } catch (e) {
      return { available: false, reason: `ephemeris fetch failed: ${e.message}` };
    }
  }

  const eph = parseEphemeris(text);
  if (!eph.states.length) {
    return { available: false, reason: 'ephemeris parsed to zero states' };
  }

  const startMs = toMs(eph.start);
  const stopMs = toMs(eph.stop);
  // A prediction outside its own validity window is not evidence.
  const stale = stopMs != null && now > stopMs;

  const sigmas = eph.states.map((s) => s.sigma_1_m);
  const worst = Math.max(...sigmas);

  // Uncertainty GROWS across the prediction window — typically from a few
  // metres at epoch to kilometres three days out. So "does this object meet
  // the 500 m standard" has no single answer: it depends on WHEN you need the
  // position. A conjunction six hours away and one three days away are not the
  // same question, and answering with the epoch value would flatter us badly.
  //
  // `at` is the time the answer is needed — normally the time of closest
  // approach. Without it we report the worst case in the window, because
  // that is the only honest scalar.
  const atState = at ? nearestState(eph.states, at) : null;
  const s1 = atState ? atState.sigma_1_m : worst;
  const basis = atState
    ? `operator covariance interpolated to ${new Date(at).toISOString()}`
    : 'worst case across the whole validity window (no target time given)';

  return {
    available: true,
    stale,
    norad: entry.norad,
    object: entry.name,
    operational: entry.status,
    source: 'SpaceX Starlink public ephemeris (MEME frame, 6x6 UVW covariance)',
    url: `https://${HOST}${BASE}/${entry.file}`,
    created: eph.created,
    valid_from: eph.start,
    valid_to: eph.stop,
    step_s: eph.step_s,
    states: eph.states.length,
    // The numbers FR-20 actually compares against.
    evaluated_at: at ? new Date(at).toISOString() : null,
    basis,
    sigma_1_m: +s1.toFixed(2),
    sigma_2_m: +(2 * s1).toFixed(2),
    sigma_2_m_worst_in_window: +(2 * worst).toFixed(2),
    limit_2sigma_m: SSC_LIMIT_2SIGMA_M,
    sigma_2_m_at_epoch: +(2 * sigmas[0]).toFixed(2),
    // How fast the operator's own knowledge decays — the reason lead time is a
    // constraint and not a preference.
    growth_factor_over_window: +(worst / Math.max(sigmas[0], 1e-9)).toFixed(1),
    meets_ssc_7k: !stale && 2 * s1 < SSC_LIMIT_2SIGMA_M,
    tier: 'operator-ephemeris',
    caveat: 'A covariance is the operator’s own estimate of their own knowledge. It is sourced evidence, not independent ground truth.',
  };
}

/** How much of a conjunction pair is covered by operator data. */
async function coverage(noradList) {
  try {
    const m = await manifest();
    const covered = noradList.filter((n) => m.entries.has(Number(n)));
    return {
      available: true,
      fleet_size: m.entries.size,
      requested: noradList.length,
      covered: covered.length,
      covered_norads: covered,
      fraction: noradList.length ? covered.length / noradList.length : 0,
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

/**
 * SYNCHRONOUS, CACHE-ONLY lookup.
 *
 * Rule evaluation is synchronous by design — a rule must not be able to make a
 * network call, because a rule that can block is a rule that can hang the gate.
 * So the async side warms a disk cache and this reads it. A cache miss returns
 * null, and the caller falls back to the TLE tier. It never waits and never
 * fabricates.
 */
function positionalKnowledgeSync(norad, { at = null, now = Date.now() } = {}) {
  let entry = null;
  if (manifestCache) entry = manifestCache.entries.get(Number(norad));
  if (!entry) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'manifest.json'), 'utf8'));
      manifestCache = { fetched: j.fetched, entries: new Map(j.entries) };
      entry = manifestCache.entries.get(Number(norad));
    } catch { return null; }
  }
  if (!entry) return null;

  let text;
  try { text = fs.readFileSync(path.join(CACHE_DIR, entry.file), 'utf8'); }
  catch { return null; }

  const eph = parseEphemeris(text);
  if (!eph.states.length) return null;

  const stopMs = toMs(eph.stop);
  const stale = stopMs != null && now > stopMs;
  const sigmas = eph.states.map((x) => x.sigma_1_m);
  const worst = Math.max(...sigmas);
  const atState = at ? nearestState(eph.states, at) : null;
  // No target time, or a target outside the window, means we cannot answer for
  // the moment that matters — so we report the worst case rather than the
  // flattering first sample.
  const s1 = atState ? atState.sigma_1_m : worst;

  return {
    norad: entry.norad,
    object: entry.name,
    tier: 'operator-ephemeris',
    stale,
    sigma_1_m: +s1.toFixed(2),
    sigma_2_m: +(2 * s1).toFixed(2),
    sigma_2_m_at_epoch: +(2 * sigmas[0]).toFixed(2),
    sigma_2_m_worst: +(2 * worst).toFixed(2),
    growth_factor: +(worst / Math.max(sigmas[0], 1e-9)).toFixed(1),
    valid_to: eph.stop,
    interpolated: !!atState,
    basis: stale
      ? 'operator ephemeris is past its validity window'
      : atState
        ? 'SpaceX operator ephemeris, covariance at time of closest approach'
        : 'SpaceX operator ephemeris, worst case across the validity window',
  };
}

/**
 * Pre-fetch ephemerides for objects we are about to evaluate, so the
 * synchronous path has something to read. Failures are silent by design: a
 * missing ephemeris is a legitimate state (TLE tier), not an error.
 */
async function warm(noradList, { concurrency = 6 } = {}) {
  let ok = 0, missing = 0;
  const list = [...new Set(noradList.map(Number))].filter(Number.isFinite);
  for (let i = 0; i < list.length; i += concurrency) {
    await Promise.all(list.slice(i, i + concurrency).map(async (n) => {
      const r = await positionalKnowledge(n).catch(() => null);
      if (r && r.available) ok++; else missing++;
    }));
  }
  return { warmed: ok, not_covered: missing, requested: list.length };
}

module.exports = {
  positionalKnowledgeSync, warm,
  manifest, positionalKnowledge, coverage, parseEphemeris, parseName,
  stampToMs, nearestState,
  SSC_LIMIT_2SIGMA_M,
};
