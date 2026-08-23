/**
 * Time to violation.        dev/constraints/horizon.js
 * =============================================================================
 * WHAT THIS ADDS TO THE SIGNAL
 *
 * A completion signal is a snapshot: this gate is COMPLETE right now. That is
 * less useful than it sounds, because the interesting question in operations is
 * not "is it open" but "how long does it stay open".
 *
 * This gives the signal a margin and a countdown:
 *
 *     COMPLETE · margin 1.4 km · self-blocks in 6 h 12 m when FR-10 ages out
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `expiry - now` WITH CITATIONS ATTACHED
 *
 * Signal Temporal Logic gives a formula a REAL-VALUED robustness rather than a
 * boolean: how far the signal is from flipping the verdict. Its time-robustness
 * variant measures the same thing along the time axis — how far a signal can be
 * shifted before the truth value changes. That is, precisely, time to violation.
 *
 * The property we actually want from the formalism is composition:
 *
 *     robustness(A AND B) = min(robustness(A), robustness(B))
 *     robustness(A OR  B) = max(robustness(A), robustness(B))
 *
 * So a gate with twenty rules gets ONE principled margin and ONE principled
 * countdown — the earliest violation across all of them — instead of twenty
 * ad-hoc timers that have to be reconciled by hand. That is the whole reason to
 * borrow the formalism rather than write a subtraction.
 *
 *   Donzé & Maler, Robust Satisfaction of Temporal Logic over Real-Valued
 *   Signals, FORMATS 2010, LNCS 6246:92-106.
 *   Deshmukh et al., Robust Online Monitoring of Signal Temporal Logic, RV 2015
 *   — the partial-trace case, which is ours.
 *
 * ---------------------------------------------------------------------------
 * THE RULE WE IMPOSE ON OURSELVES
 *
 * Time robustness requires knowing how the signal EVOLVES. For a clock-driven
 * quantity that is exact: element-set age advances at one second per second.
 * For the Starlink covariance it is measured — the operator publishes the
 * growth curve. For a conjunction's miss distance it is not knowable without
 * assuming a dynamics model we would be inventing.
 *
 * So we compute a countdown only where the evolution law is known, and report
 * UNRESOLVED where it is not. A confident countdown derived from a guessed
 * trajectory would be exactly the failure this system exists to prevent.
 *
 * Zero dependencies. Deterministic.
 * =============================================================================
 */

'use strict';

const { evaluate, STATE, SIGNAL } = require('./engine.js');

// How a quantity is known to evolve. Anything not listed here has no countdown.
const LAW = {
  /** Advances at exactly one second per second. Exact, not modelled. */
  CLOCK: 'clock',
  /** The operator publishes the growth curve; we read it. */
  PUBLISHED: 'published',
  /** Calibrated from data we hold, with a stated coverage. */
  CALIBRATED: 'calibrated',
  /** We would have to invent a dynamics model. No countdown is emitted. */
  UNKNOWN: 'unknown',
};

/**
 * Per-rule time robustness by bisection over the deadline hook.
 *
 * A rule that declares `deadline(ctx)` is telling us the wall-clock instant at
 * which it flips. That is a clock-driven law, so the countdown is exact rather
 * than extrapolated.
 */
function ruleHorizon(rule, context, now) {
  if (typeof rule.deadline !== 'function') {
    return { rule_id: rule.id, law: LAW.UNKNOWN, countdown_ms: null,
      why: 'this rule declares no deadline, and its inputs have no known evolution law — a countdown would be invented' };
  }
  let at;
  try { at = rule.deadline(context); } catch { at = null; }
  if (!Number.isFinite(at)) {
    return { rule_id: rule.id, law: LAW.UNKNOWN, countdown_ms: null,
      why: 'the deadline hook could not be evaluated from the current context' };
  }
  return {
    rule_id: rule.id,
    title: rule.title,
    law: LAW.CLOCK,
    deadline_ms: at,
    countdown_ms: at - now,
    expired: at <= now,
    waivable: rule.waivable !== false,
  };
}

/** Human-readable countdown. */
function fmt(ms) {
  if (ms == null) return null;
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)} d ${h % 24} h`;
  if (h >= 1) return `${h} h ${String(m).padStart(2, '0')} m`;
  return `${m} m`;
}

/**
 * The gate-level countdown.
 *
 * Composition is min over conjunction, which is what the whole rulebook is: a
 * gate is open only while EVERY rule holds, so the gate's time robustness is
 * the earliest rule violation. Non-negotiable rules are reported separately
 * because their expiry is not merely a deadline — it is an unrecoverable one.
 */
function horizon({ rulebook, context, waivers = [], now = Date.now() }) {
  const report = evaluate({ rulebook, context, waivers, now });
  const rules = rulebook.rules || [];

  const per = rules.map((r) => ruleHorizon(r, context, now));
  const timed = per.filter((h) => Number.isFinite(h.countdown_ms) && !h.expired);
  const expired = per.filter((h) => h.expired);
  const untimed = per.filter((h) => h.law === LAW.UNKNOWN);

  // min over conjunction — the gate closes when the FIRST rule does.
  timed.sort((a, b) => a.countdown_ms - b.countdown_ms);
  const next = timed[0] || null;
  const nextHard = timed.find((h) => !h.waivable) || null;

  return {
    signal: report.signal,
    now,
    // The countdown, composed rather than picked.
    self_blocks_in_ms: next ? next.countdown_ms : null,
    self_blocks_in: next ? fmt(next.countdown_ms) : null,
    self_blocks_on: next ? { id: next.rule_id, title: next.title, waivable: next.waivable } : null,
    // A non-negotiable expiring is a different kind of event: it cannot be
    // waived past when it lands, so it is surfaced even when something else
    // expires sooner.
    next_non_negotiable: nextHard
      ? { id: nextHard.rule_id, title: nextHard.title, in: fmt(nextHard.countdown_ms), in_ms: nextHard.countdown_ms }
      : null,
    already_expired: expired.map((h) => ({ id: h.rule_id, title: h.title })),
    // HONESTY: rules whose evolution we do not know get no countdown, and we
    // say how many rather than quietly excluding them from the minimum.
    no_countdown: {
      count: untimed.length,
      rules: untimed.map((h) => h.rule_id),
      why: 'these rules depend on quantities with no known evolution law. Extrapolating them would require inventing a dynamics model, so no countdown is reported for them and the gate countdown above is a bound over the rules we CAN project, not over all of them.',
    },
    composition: 'min over conjunction — a gate holds only while every rule holds, so its time robustness is the earliest rule violation',
    citation: 'Donze & Maler, FORMATS 2010 (time robustness); Deshmukh et al., RV 2015 (partial traces)',
    per_rule: per,
  };
}

/**
 * Covariance-driven horizon for a specific object.
 *
 * The Starlink ephemeris publishes a covariance that GROWS across its validity
 * window — measured at 2,558x over three days on a sample object. So "when does
 * this object stop meeting the 500 m standard" is answerable from the
 * operator's own numbers rather than from a model of ours.
 */
function positionalHorizon(starlinkModule, norad, { limit_m = 500, now = Date.now(), stepMin = 15, windowH = 72 } = {}) {
  let crossed = null, last = null;
  for (let m = 0; m <= windowH * 60; m += stepMin) {
    const at = now + m * 60000;
    const k = starlinkModule.positionalKnowledgeSync(norad, { at, now });
    if (!k) break;
    last = k;
    if (k.sigma_2_m > limit_m) { crossed = { at, minutes: m, sigma_2_m: k.sigma_2_m }; break; }
  }
  if (!last) {
    return { available: false, law: LAW.UNKNOWN,
      why: 'no operator ephemeris for this object — its positional uncertainty growth is not published, so no countdown can be computed' };
  }
  if (!crossed) {
    return { available: true, law: LAW.PUBLISHED, crosses_limit: false,
      why: `the operator covariance stays within ${limit_m} m (2 sigma) for the whole ${windowH} h window examined` };
  }
  return {
    available: true,
    law: LAW.PUBLISHED,
    crosses_limit: true,
    object: last.object,
    limit_m,
    crosses_in_ms: crossed.at - now,
    crosses_in: fmt(crossed.at - now),
    sigma_2_m_at_crossing: crossed.sigma_2_m,
    resolution_min: stepMin,
    basis: 'SpaceX published ephemeris covariance, sampled forward at the stated resolution',
    why: `positional knowledge degrades past ${limit_m} m (2 sigma) in ${fmt(crossed.at - now)}, after which FR-20 can no longer be satisfied for this object`,
  };
}

module.exports = { horizon, ruleHorizon, positionalHorizon, fmt, LAW };
