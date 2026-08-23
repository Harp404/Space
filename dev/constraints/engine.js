/**
 * Constraint Awareness — the engine.       dev/constraints/engine.js
 * =============================================================================
 * A generic evaluator for rulebooks. Given a set of rules and a context object,
 * it returns ONE completion signal:
 *
 *   COMPLETE    every applicable rule evaluated and satisfied
 *   PARTIAL     hard rules pass; a soft rule is violated or a waiver is on record
 *   BLOCKED     a HARD rule is violated
 *   UNRESOLVED  a rule could not be evaluated — the evidence does not exist yet
 *
 * Precedence: BLOCKED > UNRESOLVED > PARTIAL > COMPLETE.
 * A hard violation is decisive even with unknowns still open: you already know
 * enough to say no.
 *
 * TWO INVARIANTS CARRY THE WHOLE IDEA
 *
 *   1. UNRESOLVED IS NOT A PASS.  Most systems show a green tick for "no
 *      violation found", silently conflating *checked and clean* with *never
 *      checked*. Here an unevaluated rule holds the signal open and names
 *      exactly what is missing.
 *
 *   2. YOU CANNOT WAIVE WHAT YOU NEVER MEASURED.  A waiver only converts a rule
 *      that genuinely evaluated to VIOLATED, on a rule that is waivable at all.
 *      Applied to an unevaluated rule it is refused, with a reason.
 *
 * THIS FILE KNOWS NOTHING ABOUT ITS DOMAIN.
 * It has never heard of a satellite. It takes a rulebook and a context and
 * returns a signal. That is what makes the capability portable — the same engine
 * gates an orbital maneuver, a software release, or anything else with limits,
 * conditions and non-negotiable requirements. See ./rulebooks/.
 *
 * Zero dependencies. Pure functions. Deterministic: same input, same output,
 * every time. See engine.test.js.
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The state of a single rule. */
const STATE = {
  SATISFIED:      'SATISFIED',       // evaluated, limit met
  VIOLATED:       'VIOLATED',        // evaluated, limit breached
  UNEVALUATED:    'UNEVALUATED',     // could not be evaluated — the input does not exist
  NOT_APPLICABLE: 'NOT_APPLICABLE',  // this rule does not govern this case
  WAIVED:         'WAIVED',          // breached, but a named party accepted the exception
};

/** The completion signal for the whole body of work. */
const SIGNAL = {
  COMPLETE:   'COMPLETE',
  PARTIAL:    'PARTIAL',
  BLOCKED:    'BLOCKED',
  UNRESOLVED: 'UNRESOLVED',
};

/** Rule classes. HARD blocks; SOFT degrades to PARTIAL but never blocks. */
const CLASS = { HARD: 'HARD', SOFT: 'SOFT' };

// ---------------------------------------------------------------------------
// Evaluator helpers, handed to every rule so rulebooks stay declarative.
// Each returns the {state, actual, limit, detail} shape the engine expects.
// ---------------------------------------------------------------------------

const R = {
  /** Limit met. */
  pass(detail, actual, limit) { return { state: STATE.SATISFIED, detail, actual, limit }; },
  /** Limit breached. */
  fail(detail, actual, limit) { return { state: STATE.VIOLATED, detail, actual, limit }; },
  /**
   * The input does not exist, so we do not know. NEVER use pass() for this —
   * that is the exact mistake this whole module exists to prevent.
   */
  unknown(detail, missing) { return { state: STATE.UNEVALUATED, detail, missing }; },
  /** This rule does not govern this case. Excluded from the counts. */
  na(detail, actual, limit) { return { state: STATE.NOT_APPLICABLE, detail, actual, limit }; },

  /** Convenience: fail-safe numeric comparison that returns unknown() for a missing value. */
  atMost(value, limit, fmt, unit) {
    const v = numOrNull(value);
    if (v === null) return R.unknown('value not available');
    const f = fmt || ((x) => `${x}${unit ? ' ' + unit : ''}`);
    const shown = { actual: f(v), limit: `<= ${f(limit)}` };
    return v <= limit ? R.pass('within limit', shown.actual, shown.limit)
                      : R.fail('over limit', shown.actual, shown.limit);
  },
  atLeast(value, limit, fmt, unit) {
    const v = numOrNull(value);
    if (v === null) return R.unknown('value not available');
    const f = fmt || ((x) => `${x}${unit ? ' ' + unit : ''}`);
    const shown = { actual: f(v), limit: `>= ${f(limit)}` };
    return v >= limit ? R.pass('within limit', shown.actual, shown.limit)
                      : R.fail('under limit', shown.actual, shown.limit);
  },
};

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a rulebook against a context.
 *
 * @param {object}   opts
 * @param {object}   opts.rulebook  { id, title, domain, rules: [...] }
 * @param {object}   opts.context   whatever the rules need; opaque to the engine
 * @param {Array}    opts.waivers   [{ rule_id, party, reason, ts }]
 * @param {number}   opts.now       epoch ms — injectable so tests are deterministic
 * @returns {object} the completion report
 */
function evaluate({ rulebook, context, waivers = [], now = Date.now() } = {}) {
  if (!rulebook || !Array.isArray(rulebook.rules)) {
    throw new TypeError('evaluate() needs a rulebook with a rules array');
  }
  const ctx = { ...(context || {}), now };
  const waiverList = Array.isArray(waivers) ? waivers : [];

  const rules = rulebook.rules.map((rule) => evaluateOne(rule, ctx, waiverList, now));

  // NOT_APPLICABLE rules are excluded from every count — a rule that does not
  // govern this case is neither work done nor work outstanding.
  const applicable = rules.filter((r) => r.state !== STATE.NOT_APPLICABLE);

  const blocking    = rules.filter((r) => r.class === CLASS.HARD && r.state === STATE.VIOLATED);
  const unevaluated = applicable.filter((r) => r.state === STATE.UNEVALUATED);
  const advisory    = rules.filter((r) => r.class === CLASS.SOFT && r.state === STATE.VIOLATED);
  const waived      = rules.filter((r) => r.state === STATE.WAIVED);
  const satisfied   = applicable.filter((r) => r.state === STATE.SATISFIED);

  const counts = {
    total:          rules.length,
    applicable:     applicable.length,
    satisfied:      satisfied.length,
    violated:       blocking.length + advisory.length,
    blocking:       blocking.length,
    advisory:       advisory.length,
    waived:         waived.length,
    unevaluated:    unevaluated.length,
    not_applicable: rules.length - applicable.length,
  };

  const { signal, headline } = deriveSignal({ counts, blocking, unevaluated, advisory, waived });

  return {
    rulebook:   { id: rulebook.id, title: rulebook.title, domain: rulebook.domain },
    signal,
    headline,
    // Authorisation is the actionable read of the signal. UNRESOLVED is NOT
    // authorised — not knowing is not the same as being allowed.
    authorised: signal === SIGNAL.COMPLETE || signal === SIGNAL.PARTIAL,
    counts,
    // Closed work over applicable work. Waived counts as closed (it was decided),
    // unevaluated never does.
    progress: counts.applicable
      ? Math.round(((counts.satisfied + counts.waived) / counts.applicable) * 100)
      : 0,
    blocking:    blocking.map(brief),
    unevaluated: unevaluated.map(brief),
    advisory:    advisory.map(brief),
    waived:      waived.map(brief),
    next_actions: nextActions({ signal, blocking, unevaluated, advisory }),
    // Earliest moment this signal degrades on its own if nobody acts.
    deadline: earliestDeadline(rules, now),
    // Evidence that, if obtained, would close currently-unevaluated rules.
    // Consumed by the value-of-information planner.
    evidence_needed: evidenceNeeded(unevaluated),
    rules,
    evaluated_at: new Date(now).toISOString(),
  };
}

/** Evaluate one rule, apply waiver semantics, and never let a throw become a pass. */
function evaluateOne(rule, ctx, waiverList, now) {
  const row = {
    id: rule.id,
    key: rule.key,
    title: rule.title,
    class: rule.class === CLASS.SOFT ? CLASS.SOFT : CLASS.HARD,
    waivable: rule.waivable !== false,
    authority: rule.authority || null,
    requirement: rule.requirement || null,
    rationale: rule.rationale || null,
    state: STATE.UNEVALUATED,
    actual: null,
    limit: null,
    detail: null,
    missing: null,
    waiver: null,
    deadline: null,
    resolved_by: rule.resolvedBy || null,
  };

  // An `applies` gate that itself cannot be decided must not silently exclude
  // the rule — an undecidable applicability question is its own unknown.
  if (typeof rule.applies === 'function') {
    let applicable;
    try { applicable = rule.applies(ctx); } catch (e) {
      row.state = STATE.UNEVALUATED;
      row.detail = 'cannot determine whether this rule applies: ' + e.message;
      return row;
    }
    if (applicable === false) {
      row.state = STATE.NOT_APPLICABLE;
      row.detail = rule.notApplicableDetail || 'does not govern this case';
      return row;
    }
    if (applicable == null) {
      row.state = STATE.UNEVALUATED;
      row.detail = 'cannot determine whether this rule applies';
      return row;
    }
  }

  let out;
  try {
    out = rule.evaluate(ctx);
  } catch (e) {
    // A rule that throws is an unknown, never a pass. Failing open here would
    // defeat the entire purpose of the module.
    out = { state: STATE.UNEVALUATED, detail: 'evaluator error: ' + e.message };
  }
  if (!out || !out.state) {
    out = { state: STATE.UNEVALUATED, detail: 'evaluator returned no state' };
  }

  row.state  = out.state;
  row.actual = out.actual ?? null;
  row.limit  = out.limit ?? null;
  row.detail = out.detail ?? null;
  row.missing = out.missing ?? null;

  // When this rule will degrade on its own, if it can.
  if (typeof rule.deadline === 'function') {
    try {
      const d = rule.deadline(ctx);
      if (Number.isFinite(d) && d > now) row.deadline = d;
    } catch { /* a deadline we cannot compute is simply absent */ }
  }

  applyWaiver(row, waiverList.find((w) => w && w.rule_id === rule.id) || null);
  return row;
}

/**
 * Waiver semantics — the second invariant lives here.
 * A waiver converts VIOLATED -> WAIVED, and only when the rule is waivable.
 * It can never touch UNEVALUATED, and never touches a non-negotiable rule.
 */
function applyWaiver(row, waiver) {
  if (!waiver) return;

  if (!row.waivable) {
    row.waiver_rejected = 'this rule is non-negotiable and cannot be waived';
    return;
  }
  if (row.state === STATE.UNEVALUATED) {
    row.waiver_rejected = 'cannot waive a rule that has not been evaluated';
    return;
  }
  if (row.state !== STATE.VIOLATED) {
    row.waiver_rejected = 'no violation to waive';
    return;
  }
  row.state = STATE.WAIVED;
  row.waiver = {
    party: waiver.party || waiver.operator || 'unnamed',
    reason: waiver.reason || 'no reason given',
    ts: waiver.ts || null,
  };
}

/** Precedence: BLOCKED > UNRESOLVED > PARTIAL > COMPLETE. */
function deriveSignal({ counts, blocking, unevaluated, advisory, waived }) {
  if (blocking.length) {
    const nonNegotiable = blocking.filter((r) => !r.waivable);
    return {
      signal: SIGNAL.BLOCKED,
      headline: `${blocking.length} hard rule${blocking.length > 1 ? 's' : ''} violated — authorisation refused`
        + (nonNegotiable.length ? ` · ${nonNegotiable.length} non-negotiable, no override path` : ''),
    };
  }
  if (unevaluated.length) {
    return {
      signal: SIGNAL.UNRESOLVED,
      headline: `${counts.satisfied}/${counts.applicable} rules closed — ${unevaluated.length} cannot be evaluated yet`,
    };
  }
  if (advisory.length || waived.length) {
    const bits = [];
    if (advisory.length) bits.push(`${advisory.length} advisory violation${advisory.length > 1 ? 's' : ''}`);
    if (waived.length) bits.push(`${waived.length} waived`);
    return {
      signal: SIGNAL.PARTIAL,
      headline: `all hard rules pass · ${bits.join(' · ')} — proceeding with exceptions on record`,
    };
  }
  return {
    signal: SIGNAL.COMPLETE,
    headline: `all ${counts.applicable} applicable rules evaluated and satisfied — cleared`,
  };
}

/** Ordered, specific list of what must happen to reach COMPLETE. */
function nextActions({ signal, blocking, unevaluated, advisory }) {
  const out = [];
  for (const r of blocking) {
    out.push({
      rule_id: r.id,
      severity: 'BLOCKING',
      action: r.waivable
        ? `Resolve ${r.id} (${r.title}) or file a named waiver — ${r.detail}`
        : `Resolve ${r.id} (${r.title}) — NON-NEGOTIABLE, no waiver available: ${r.detail}`,
    });
  }
  for (const r of unevaluated) {
    out.push({
      rule_id: r.id,
      severity: 'UNKNOWN',
      action: `Obtain the evidence for ${r.id} (${r.title}) — ${r.detail}`,
      evidence: r.resolved_by || null,
    });
  }
  for (const r of advisory) {
    out.push({ rule_id: r.id, severity: 'ADVISORY', action: `Acknowledge ${r.id} (${r.title}) — ${r.detail}` });
  }
  if (!out.length && signal === SIGNAL.COMPLETE) {
    out.push({ rule_id: null, severity: 'NONE', action: 'No outstanding constraint work.' });
  }
  return out;
}

/**
 * The earliest moment the signal degrades with no action taken. Only rules that
 * currently pass can have a live deadline — a rule already violated has nothing
 * left to lose.
 */
function earliestDeadline(rules, now) {
  let best = null;
  for (const r of rules) {
    if (!r.deadline) continue;
    if (r.state !== STATE.SATISFIED && r.state !== STATE.WAIVED) continue;
    if (best === null || r.deadline < best.at) {
      best = { at: r.deadline, rule_id: r.id, title: r.title, class: r.class };
    }
  }
  if (!best) return null;
  return { ...best, at_iso: new Date(best.at).toISOString(), in_ms: best.at - now };
}

/** Distinct evidence items that would close currently-unevaluated rules. */
function evidenceNeeded(unevaluatedRules) {
  const byKey = new Map();
  for (const r of unevaluatedRules) {
    for (const ev of r.resolved_by || []) {
      const key = typeof ev === 'string' ? ev : ev.id;
      if (!key) continue;
      const entry = byKey.get(key) || {
        evidence: key,
        label: (typeof ev === 'object' && ev.label) || key,
        cost: (typeof ev === 'object' && ev.cost) || null,
        closes: [],
      };
      entry.closes.push(r.id);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.closes.length - a.closes.length);
}

function brief(r) {
  return {
    id: r.id, key: r.key, title: r.title, class: r.class, waivable: r.waivable,
    actual: r.actual, limit: r.limit, detail: r.detail,
    authority: r.authority, resolved_by: r.resolved_by,
  };
}

// ---------------------------------------------------------------------------
// Aggregate — "show whether THE RELATED WORK is complete, partial, blocked or
// unresolved" applies to the whole body of work, not just one item.
// ---------------------------------------------------------------------------

/**
 * Roll many reports into one fleet-level completion signal.
 * @param {Array} reports
 */
function rollup(reports) {
  const list = (reports || []).filter(Boolean);
  const by = { COMPLETE: 0, PARTIAL: 0, BLOCKED: 0, UNRESOLVED: 0 };
  let applicable = 0, closed = 0;

  for (const r of list) {
    if (by[r.signal] !== undefined) by[r.signal]++;
    applicable += r.counts.applicable;
    closed += r.counts.satisfied + r.counts.waived;
  }

  // The overall signal takes the worst state present — an aggregate is only as
  // resolved as its least-resolved member.
  let signal = SIGNAL.COMPLETE;
  if (by.BLOCKED) signal = SIGNAL.BLOCKED;
  else if (by.UNRESOLVED) signal = SIGNAL.UNRESOLVED;
  else if (by.PARTIAL) signal = SIGNAL.PARTIAL;

  const soonest = list
    .map((r) => r.deadline)
    .filter(Boolean)
    .sort((a, b) => a.at - b.at)[0] || null;

  return {
    signal,
    items: list.length,
    by,
    rules_applicable: applicable,
    rules_closed: closed,
    progress: applicable ? Math.round((closed / applicable) * 100) : 0,
    headline: list.length
      ? `${list.length} items · ${by.COMPLETE} complete · ${by.PARTIAL} partial · ${by.BLOCKED} blocked · ${by.UNRESOLVED} unresolved`
      : 'no items',
    next_deadline: soonest,
  };
}

// ---------------------------------------------------------------------------

module.exports = {
  evaluate,
  rollup,
  STATE,
  SIGNAL,
  CLASS,
  R,
  // exported for rulebooks and tests
  _internal: { deriveSignal, applyWaiver, earliestDeadline, evidenceNeeded },
};
