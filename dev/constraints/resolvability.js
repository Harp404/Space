/**
 * Is this constraint resolvable at all?        dev/constraints/resolvability.js
 * =============================================================================
 * THE QUESTION THIS ANSWERS
 *
 * Everywhere else in the system, UNRESOLVED means "we did not measure it".
 * That is one kind of not-knowing, and it is the easy kind: go and measure.
 *
 * There are two harder kinds, and they are DIFFERENT from each other in a way
 * that matters operationally:
 *
 *   NOT YET      the bound is achievable, but not with this much data.
 *                Quantifiable: "you need at least N calibration samples for a
 *                bound this tight; you have n." A schedule fixes it.
 *
 *   NOT EVER     the bound is unachievable in principle, whatever data you
 *                collect. No schedule fixes it. Someone must change the
 *                requirement, or accept a weaker guarantee.
 *
 * Telling an operator "collect more data" when the answer is NOT EVER wastes a
 * mission. Telling them "impossible" when 400 more CDMs would settle it is
 * equally wrong. So we distinguish them, and both answers are theorems rather
 * than judgement.
 *
 * ---------------------------------------------------------------------------
 * THE COVERAGE LAW  (Vovk 2012)
 *
 * For split conformal with n calibration points and target miss rate alpha,
 * the realised coverage C on future data is not a number — it is a random
 * variable, and its distribution is known exactly:
 *
 *     C ~ Beta(n + 1 - l, l),      l = floor((n + 1) * alpha)
 *
 * So we can state, with confidence, how far realised coverage may drift from
 * the target at a given sample size. That converts "we have 37 samples" from a
 * caveat into a bound.
 *
 * THE DEGENERATE CASE
 *
 * The conformal quantile is the ceil((n+1)(1-alpha))-th smallest calibration
 * residual. If ceil((n+1)(1-alpha)) > n — equivalently n < 1/alpha - 1 — that
 * order statistic does not exist and the prediction interval is the whole real
 * line. The bound is not "wide", it is INFINITE, and no threshold comparison
 * against it can ever succeed. That is a proof of BLOCKED, not a policy.
 *
 * THE IMPOSSIBILITY  (Barber, Candes, Ramdas & Tibshirani 2021, arXiv:1903.04684)
 *
 * Distribution-free conditional coverage — a guarantee that holds for THIS
 * object rather than on average across objects — is impossible at any finite
 * interval width. A guarantee conditioned on a specific satellite is therefore
 * NOT EVER, no matter how much data is collected. We cite it rather than
 * quietly promising marginal coverage and letting a reader assume conditional.
 *
 * Zero dependencies. Pure arithmetic, deterministic.
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Beta distribution helpers — enough for an inverse CDF, no dependency.
// ---------------------------------------------------------------------------

/** log Gamma, Lanczos approximation. Accurate to ~1e-13 for our range. */
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Regularised incomplete beta I_x(a,b), via the continued fraction. */
function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 3e-14;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betacdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b)
    + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? bt * betacf(a, b, x) / a
    : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Inverse Beta CDF by bisection — slow, exact enough, and obviously correct. */
function betainv(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (betacdf(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// The capability.
// ---------------------------------------------------------------------------

/**
 * What coverage can a split-conformal bound actually promise at this n?
 *
 * @param {number} n      calibration sample count
 * @param {number} alpha  target miss rate (0.05 = 95% coverage)
 * @param {number} conf   confidence for the interval on realised coverage
 */
function coverageEnvelope(n, alpha = 0.1, conf = 0.95) {
  const target = 1 - alpha;
  // The order statistic the conformal quantile needs.
  const rank = Math.ceil((n + 1) * (1 - alpha));
  const degenerate = rank > n;

  if (degenerate) {
    return {
      n, alpha, target,
      degenerate: true,
      // Not "wide". Infinite. No comparison against it can succeed.
      interval_is_infinite: true,
      min_n_for_any_finite_bound: Math.ceil(1 / alpha) - 1,
      verdict: 'BLOCKED',
      why: `a ${(target * 100).toFixed(0)}% conformal bound needs the ${rank}-th smallest of ${n} calibration residuals, which does not exist. The prediction interval is the whole real line, so no threshold comparison against it can ever succeed. At least ${Math.ceil(1 / alpha) - 1} samples are required before ANY finite bound exists.`,
      citation: 'Vovk (2012), conditional validity of split conformal',
    };
  }

  const l = Math.floor((n + 1) * alpha);
  const a = n + 1 - l, b = Math.max(l, 1e-9);
  const lo = betainv((1 - conf) / 2, a, b);
  const hi = betainv(1 - (1 - conf) / 2, a, b);

  return {
    n, alpha, target, degenerate: false,
    // Realised coverage is a random variable with a KNOWN distribution.
    coverage_distribution: `Beta(${a}, ${l})`,
    expected_coverage: +(a / (a + b)).toFixed(4),
    coverage_ci: [+lo.toFixed(4), +hi.toFixed(4)],
    confidence: conf,
    half_width_pct: +(((hi - lo) / 2) * 100).toFixed(2),
    citation: 'Vovk (2012); realised coverage ~ Beta(n+1-l, l), l = floor((n+1)alpha)',
  };
}

/**
 * The number that turns "not enough data" into a schedule.
 *
 * How many calibration samples are needed before realised coverage sits within
 * +/- tol of target, at the stated confidence?
 */
function requiredSamples(alpha = 0.1, tol = 0.05, conf = 0.95, nMax = 200000) {
  // The first NON-degenerate sample size is ceil(1/alpha) - 1, not ceil(1/alpha):
  // at n = ceil(1/alpha) - 1 the required order statistic is exactly n, which
  // exists. Starting one higher silently skipped a valid answer and made the
  // reported minimum off by one.
  let lo = Math.max(2, Math.ceil(1 / alpha) - 1), hi = nMax;
  const ok = (n) => {
    const e = coverageEnvelope(n, alpha, conf);
    if (e.degenerate) return false;
    return (e.coverage_ci[1] - e.coverage_ci[0]) / 2 <= tol;
  };
  if (!ok(hi)) return { achievable: false, alpha, tol, conf, searched_to: nMax };
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid; else lo = mid + 1;
  }
  return { achievable: true, n_required: lo, alpha, tol, conf };
}

/**
 * The classification the engine consumes.
 *
 * Returns one of:
 *   RESOLVED     the bound holds at this sample size
 *   NOT_YET      achievable, but needs more data — with the number
 *   NOT_EVER     unachievable in principle, with the citation
 *   BLOCKED      the bound is infinite; no comparison can succeed
 */
function resolvability({ n, alpha = 0.1, tol = 0.05, conf = 0.95, conditional = false }) {
  // The impossibility comes first, because no amount of data changes it and
  // reporting a sample-size shortfall would imply that collecting more would help.
  if (conditional) {
    return {
      state: 'NOT_EVER',
      why: 'a guarantee conditioned on THIS object — rather than on average across objects — is impossible distribution-free at any finite interval width. Collecting more data does not change this; the requirement itself has to change, or a weaker (marginal) guarantee has to be accepted.',
      citation: 'Barber, Candes, Ramdas & Tibshirani (2021), arXiv:1903.04684',
      remedy: 'accept marginal coverage, or condition on a coarse group rather than the individual object',
    };
  }

  const env = coverageEnvelope(n, alpha, conf);
  if (env.degenerate) {
    return { state: 'BLOCKED', why: env.why, citation: env.citation, envelope: env };
  }

  const need = requiredSamples(alpha, tol, conf);
  const halfWidth = (env.coverage_ci[1] - env.coverage_ci[0]) / 2;
  if (halfWidth <= tol) {
    return {
      state: 'RESOLVED',
      why: `realised coverage is ${(env.coverage_ci[0] * 100).toFixed(1)}–${(env.coverage_ci[1] * 100).toFixed(1)}% at ${(conf * 100).toFixed(0)}% confidence, within the +/-${(tol * 100).toFixed(0)}% tolerance`,
      envelope: env,
    };
  }
  return {
    state: 'NOT_YET',
    why: `a ${((1 - alpha) * 100).toFixed(0)}% bound within +/-${(tol * 100).toFixed(0)}% needs at least ${need.achievable ? need.n_required.toLocaleString() : '>' + 200000} calibration samples; ${n.toLocaleString()} are available, which admits ${(env.coverage_ci[0] * 100).toFixed(1)}–${(env.coverage_ci[1] * 100).toFixed(1)}%`,
    n_available: n,
    n_required: need.achievable ? need.n_required : null,
    shortfall: need.achievable ? Math.max(0, need.n_required - n) : null,
    envelope: env,
    remedy: 'collect more calibration data in this regime — this is a schedule, not a wall',
  };
}

module.exports = { resolvability, coverageEnvelope, requiredSamples, betacdf, betainv };
