/**
 * Conformal prediction.        dev/constraints/conformal.js
 * =============================================================================
 * WHY UNRESOLVED NEEDS A STATISTICAL FOUNDATION
 *
 * Every rule in this project compares a point estimate to a limit:
 *
 *     Pc = 3.1e-5   vs   red threshold 1e-4     →  SATISFIED
 *
 * But a point estimate with unknown error is not evidence. If the true value
 * could plausibly be anywhere from 8e-6 to 2.4e-4, then the honest answer is
 * not "satisfied" — it is "our evidence cannot discriminate against this limit".
 * That is UNRESOLVED, and this module is what earns the right to say it.
 *
 * THE PROBLEM IS REAL AND PUBLISHED
 *
 * Balch, Martin & Ferson, "Satellite Conjunction Analysis and the False
 * Confidence Theorem" (arXiv 1706.08565), prove the standard Pc metric is
 * epistemically misleading: probability dilution means MORE uncertainty
 * produces a LOWER Pc, so worse tracking looks safer. FR-12 already flags the
 * dilution region. Conformal prediction is the principled response.
 *
 * WHAT CONFORMAL PREDICTION GIVES US
 *
 * Split conformal prediction produces intervals with a DISTRIBUTION-FREE,
 * FINITE-SAMPLE coverage guarantee: at level 1−α, the interval contains the
 * true value at least (1−α) of the time, regardless of the underlying
 * distribution and without assuming the model is correct. It needs no training,
 * only a calibration set of past (prediction, truth) pairs.
 *
 * The mechanics are deliberately simple:
 *   1. Collect nonconformity scores on a calibration set — how wrong we were.
 *   2. Take the ⌈(n+1)(1−α)⌉/n empirical quantile of those scores.
 *   3. The interval is the prediction ± that quantile.
 *
 * For a strictly positive, multiplicatively-distributed quantity like Pc or a
 * miss distance, the scores are taken in LOG SPACE, so the interval is a
 * multiplicative band — which is how these errors actually behave.
 *
 * HOW IT CHANGES A RULE
 *
 *   point estimate below the limit, whole interval below   →  SATISFIED
 *   point estimate above the limit, whole interval above   →  VIOLATED
 *   interval STRADDLES the limit                           →  UNEVALUATED
 *                                                             (→ UNRESOLVED)
 *
 * The third case is the point. It is not "missing data" — it is quantified
 * inability to discriminate, and it is the difference between a UI convention
 * and a defensible position.
 *
 * Zero dependencies. Deterministic.
 * =============================================================================
 */

'use strict';

/**
 * Fit a split-conformal calibrator from past (predicted, actual) pairs.
 *
 * @param {Array<{predicted:number, actual:number}>} pairs
 * @param {object} opts
 * @param {number} opts.alpha  miscoverage rate; 0.05 → 95% coverage
 * @param {boolean} opts.log   work in log space (default true — right for Pc,
 *                             miss distance, flux, anything strictly positive)
 */
function calibrate(pairs, opts = {}) {
  const alpha = opts.alpha ?? 0.05;
  const useLog = opts.log !== false;

  const scores = [];
  for (const p of pairs || []) {
    const pred = Number(p.predicted), act = Number(p.actual);
    if (!Number.isFinite(pred) || !Number.isFinite(act)) continue;
    if (useLog && (pred <= 0 || act <= 0)) continue;
    scores.push(useLog ? Math.abs(Math.log10(act) - Math.log10(pred)) : Math.abs(act - pred));
  }

  const n = scores.length;
  if (n < 20) {
    // A guarantee computed from a handful of points is not a guarantee. Refusing
    // to produce one is the correct behaviour, and it propagates as UNRESOLVED
    // rather than as a suspiciously tight interval.
    return {
      ok: false,
      n,
      reason: `calibration set too small (${n} pairs; need >= 20 for a meaningful finite-sample guarantee)`,
    };
  }

  scores.sort((a, b) => a - b);
  // Split-conformal quantile: ceil((n+1)(1-alpha)) / n, clipped into range.
  const rank = Math.ceil((n + 1) * (1 - alpha));
  const q = scores[Math.min(n - 1, Math.max(0, rank - 1))];

  return {
    ok: true,
    n,
    alpha,
    coverage: 1 - alpha,
    log: useLog,
    quantile: q,
    // In log space the quantile is a multiplicative factor.
    factor: useLog ? Math.pow(10, q) : null,
    method: 'split conformal prediction — distribution-free, finite-sample coverage',
    guarantee: `the interval contains the true value with probability >= ${(100 * (1 - alpha)).toFixed(0)}%, without assuming a distribution or that the model is correct`,
  };
}

/** Apply a calibrator to one prediction. */
function interval(cal, predicted) {
  const p = Number(predicted);
  if (!cal || !cal.ok || !Number.isFinite(p)) return null;
  if (cal.log) {
    if (p <= 0) return null;
    return { point: p, lower: p / cal.factor, upper: p * cal.factor, coverage: cal.coverage, log: true };
  }
  return { point: p, lower: p - cal.quantile, upper: p + cal.quantile, coverage: cal.coverage, log: false };
}

/**
 * Decide a rule against a limit, using the interval rather than the point.
 *
 * @param {object} iv    from interval()
 * @param {number} limit
 * @param {'below'|'above'} want  'below' = the value must be under the limit
 * @returns {{verdict:'SATISFIED'|'VIOLATED'|'UNEVALUATED', detail, actual, limit}}
 */
function decide(iv, limit, want = 'below') {
  if (!iv) return { verdict: 'UNEVALUATED', detail: 'no calibrated interval available' };
  const fmt = (x) => (x < 1e-3 ? x.toExponential(2) : x.toFixed(3));
  const band = `${fmt(iv.point)} [${fmt(iv.lower)} – ${fmt(iv.upper)}] at ${(iv.coverage * 100).toFixed(0)}%`;

  if (want === 'below') {
    if (iv.upper < limit) return { verdict: 'SATISFIED', actual: band, limit: `< ${fmt(limit)}`, detail: 'the entire confidence interval is below the limit' };
    if (iv.lower > limit) return { verdict: 'VIOLATED', actual: band, limit: `< ${fmt(limit)}`, detail: 'the entire confidence interval is above the limit' };
    return {
      verdict: 'UNEVALUATED', actual: band, limit: `< ${fmt(limit)}`,
      detail: `the ${(iv.coverage * 100).toFixed(0)}% interval STRADDLES the limit — our evidence cannot discriminate. This is a quantified inability to decide, not a missing input`,
    };
  }
  if (iv.lower > limit) return { verdict: 'SATISFIED', actual: band, limit: `> ${fmt(limit)}`, detail: 'the entire confidence interval is above the limit' };
  if (iv.upper < limit) return { verdict: 'VIOLATED', actual: band, limit: `> ${fmt(limit)}`, detail: 'the entire confidence interval is below the limit' };
  return {
    verdict: 'UNEVALUATED', actual: band, limit: `> ${fmt(limit)}`,
    detail: `the ${(iv.coverage * 100).toFixed(0)}% interval STRADDLES the limit — our evidence cannot discriminate`,
  };
}

/**
 * Empirical coverage check — does the calibrator deliver what it promises on
 * held-out data? Reported honestly, including when it under-covers.
 */
function checkCoverage(cal, testPairs) {
  if (!cal || !cal.ok) return null;
  let covered = 0, n = 0;
  for (const p of testPairs || []) {
    const iv = interval(cal, p.predicted);
    if (!iv || !Number.isFinite(p.actual)) continue;
    n++;
    if (p.actual >= iv.lower && p.actual <= iv.upper) covered++;
  }
  if (!n) return null;
  const empirical = covered / n;
  return {
    n,
    target: cal.coverage,
    empirical: +empirical.toFixed(4),
    delta: +(empirical - cal.coverage).toFixed(4),
    calibrated: Math.abs(empirical - cal.coverage) < 0.05,
    note: empirical < cal.coverage
      ? 'under-covering: the intervals are too narrow on this data — report it rather than widening them silently'
      : 'coverage at or above target',
  };
}

/**
 * Build a calibration set for TLE-derived screening by pairing our own SGP4
 * screening against the operational CDM for the same object pair.
 *
 * The CDM is covariance-based and treated as the reference. Where both exist for
 * the same pair, the difference is exactly the error our screening layer makes —
 * which is what the conformal interval should reflect.
 */
function pairScreeningWithCdms(screened, cdms, field = 'min_range_km') {
  const byPair = new Map();
  for (const c of cdms || []) {
    const a = Number(c.sat1_id), b = Number(c.sat2_id);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    byPair.set(`${Math.min(a, b)}-${Math.max(a, b)}`, c);
  }
  const pairs = [];
  for (const s of screened || []) {
    const a = Number(s.sat1_id), b = Number(s.sat2_id);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const c = byPair.get(`${Math.min(a, b)}-${Math.max(a, b)}`);
    if (!c) continue;
    const predicted = Number(s[field]), actual = Number(c[field]);
    if (!Number.isFinite(predicted) || !Number.isFinite(actual)) continue;
    pairs.push({ predicted, actual, pair: `${s.sat1_name} × ${s.sat2_name}` });
  }
  return pairs;
}

module.exports = { calibrate, interval, decide, checkCoverage, pairScreeningWithCdms };
