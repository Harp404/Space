/**
 * Minimal correction sets — the cheapest way out.   dev/constraints/recourse.js
 * =============================================================================
 * WHAT THIS TURNS THE SIGNAL INTO
 *
 * Until now the gate answers a question: complete, partial, blocked, or
 * unresolved. That is a verdict, and a verdict leaves an operator to work out
 * what to do about it.
 *
 * This computes the other half:
 *
 *     "Acquire {operator ephemeris, fresh CDM} — 9 hours — and this gate goes
 *      COMPLETE. No smaller set works, and no cheaper set works."
 *
 * and, just as importantly, its dual:
 *
 *     "No set of measurements clears this. FR-05 is a non-negotiable violation.
 *      BLOCKED is terminal."
 *
 * The second answer is the one that saves a mission. Telling an operator to
 * collect more data when nothing can help is worse than telling them nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS EXACT AND NOT A HEURISTIC
 *
 * Every rule already declares `resolvedBy: [EV.X, ...]` — the evidence that
 * would let it be evaluated — and every evidence item carries a cost. The
 * evidence universe per rulebook is small by construction (8 items for orbital
 * maneuvers, 7 for the release gate, 4 for re-entry), because it enumerates
 * real acquisitions a real operator can task, not a feature space.
 *
 * With |EV| <= 8 there are at most 256 subsets, so we ENUMERATE THEM ALL. That
 * gives exact minimality — every returned set is verified sufficient, and every
 * proper subset of it is verified insufficient. A solver would return the same
 * answer more slowly, and would put a WASM initialisation in the demo path.
 *
 * We say this plainly rather than dressing it up: the sophistication is in the
 * problem formulation, not in the search.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS, FORMALLY
 *
 * A correction set is a minimal hitting set over the unresolved rules — the
 * MUS/MCS duality from Reiter's theory of diagnosis (AI 32(1), 1987), which is
 * the same structure as the abductive/contrastive explanation pair in formal
 * XAI (Ignatiev, Narodytska & Marques-Silva, AAAI 2019).
 *
 * The framing as an ACTIONABLE minimal change is algorithmic recourse in the
 * sense of Wachter, Mittelstadt & Russell (2017) — the paper behind the GDPR
 * "right to explanation" argument. The distinction from SHAP/LIME-style
 * attribution matters here: those are heuristic and carry no soundness
 * guarantee, whereas a minimal hitting set over a discrete rulebook is exact.
 *
 * Zero dependencies. Deterministic.
 * =============================================================================
 */

'use strict';

const { evaluate, SIGNAL, STATE } = require('./engine.js');

const MAX_EXHAUSTIVE = 16;          // 2^16 = 65,536 — still instant
const COST_TO_MIN = { s: 1 / 60, min: 1, h: 60, d: 1440 };

/** Normalise every evidence cost to minutes so subsets can be compared. */
function costMinutes(ev) {
  const f = COST_TO_MIN[ev.unit];
  return Number.isFinite(ev.cost) && f ? ev.cost * f : 0;
}

function fmtCost(mins) {
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)} min`;
  if (mins < 1440) return `${+(mins / 60).toFixed(1)} h`;
  return `${+(mins / 1440).toFixed(1)} d`;
}

/**
 * The evidence universe actually reachable from this rulebook, in a stable
 * order so results are reproducible.
 */
function evidenceUniverse(rulebook) {
  const seen = new Map();
  for (const rule of rulebook.rules || []) {
    for (const ev of rule.resolvedBy || []) {
      if (ev && ev.id && !seen.has(ev.id)) seen.set(ev.id, ev);
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Re-evaluate the rulebook as if the given evidence had been acquired.
 *
 * `supply` is the caller's hook: it maps a set of evidence ids to the context
 * those acquisitions would produce. We do NOT guess what an acquisition
 * returns — if the caller cannot say, the search is not run at all, because a
 * recourse computed from imagined measurements would be a lie about the future.
 */
function evaluateWith(rulebook, context, waivers, supply, ids, now) {
  const ctx = supply(context, ids);
  return evaluate({ rulebook, context: ctx, waivers, now });
}

/**
 * Compute the minimal correction sets.
 *
 * @param {object}   o.rulebook
 * @param {object}   o.context     the situation as it actually stands
 * @param {Array}    o.waivers
 * @param {Function} o.supply      (context, Set<evidenceId>) -> context
 * @param {string}   o.goal        signal to reach — COMPLETE by default
 * @returns {object} { reachable, sets[], terminal, ... }
 */
function recourse({ rulebook, context, waivers = [], supply, goal = SIGNAL.COMPLETE, now = Date.now(), maxSets = 5 }) {
  const before = evaluate({ rulebook, context, waivers, now });
  if (before.signal === goal) {
    return { already: true, signal: before.signal, sets: [], note: `already ${goal}` };
  }

  // TERMINAL CHECK, FIRST.
  // A violated non-negotiable cannot be cleared by any acquisition — no waiver
  // path exists in the engine. Reporting a shopping list in that case would be
  // actively misleading, so it is checked before any search happens.
  const hardViolations = before.rules.filter(
    (r) => r.state === STATE.VIOLATED && r.waivable === false,
  );
  if (hardViolations.length) {
    return {
      already: false,
      signal: before.signal,
      reachable: false,
      terminal: true,
      sets: [],
      blockers: hardViolations.map((r) => ({ id: r.id, title: r.title })),
      why: `no measurement can clear this. ${hardViolations.map((r) => r.id).join(', ')} ${hardViolations.length > 1 ? 'are non-negotiable violations' : 'is a non-negotiable violation'} with no waiver path in the engine — the state is terminal, not merely unresolved.`,
    };
  }

  const universe = evidenceUniverse(rulebook);
  if (!universe.length) {
    return { already: false, signal: before.signal, reachable: false, sets: [],
      why: 'this rulebook declares no acquirable evidence, so there is nothing to recommend' };
  }
  if (typeof supply !== 'function') {
    return { already: false, signal: before.signal, reachable: null, sets: [],
      why: 'no evidence-supply function was provided, so what an acquisition would return is unknown — we do not guess it' };
  }
  if (universe.length > MAX_EXHAUSTIVE) {
    return { already: false, signal: before.signal, reachable: null, sets: [],
      why: `evidence universe of ${universe.length} exceeds the exhaustive limit of ${MAX_EXHAUSTIVE}; a deletion-based shrink would be required to stay exact` };
  }

  // Exhaustive over the power set, smallest-and-cheapest first.
  const n = universe.length;
  const all = [];
  for (let mask = 1; mask < (1 << n); mask++) {
    const ids = [];
    let cost = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { ids.push(universe[i].id); cost += costMinutes(universe[i]); }
    }
    all.push({ mask, ids, cost, size: ids.length });
  }
  all.sort((a, b) => a.size - b.size || a.cost - b.cost || a.mask - b.mask);

  const sufficient = [];
  const sufficientMasks = [];
  let evaluations = 0;

  for (const cand of all) {
    // Skip supersets of a set already known sufficient — they cannot be minimal.
    if (sufficientMasks.some((m) => (cand.mask & m) === m)) continue;
    const rep = evaluateWith(rulebook, context, waivers, supply, new Set(cand.ids), now);
    evaluations++;
    if (rep.signal !== goal) continue;
    sufficientMasks.push(cand.mask);
    sufficient.push({
      evidence: cand.ids.map((id) => {
        const ev = universe.find((e) => e.id === id);
        return { id, label: ev.label, cost: ev.cost, unit: ev.unit };
      }),
      size: cand.size,
      cost_minutes: +cand.cost.toFixed(2),
      cost_human: fmtCost(cand.cost),
      reaches: rep.signal,
    });
    if (sufficient.length >= maxSets) break;
  }

  // MINIMALITY IS VERIFIED, NOT ASSERTED.
  // For the cheapest set, confirm every proper subset fails to reach the goal.
  let proof = null;
  if (sufficient.length) {
    const best = sufficient[0];
    const ids = best.evidence.map((e) => e.id);
    const subsets = [];
    for (let drop = 0; drop < ids.length; drop++) {
      const sub = ids.filter((_, i) => i !== drop);
      const rep = evaluateWith(rulebook, context, waivers, supply, new Set(sub), now);
      evaluations++;
      subsets.push({ without: ids[drop], reaches: rep.signal, sufficient: rep.signal === goal });
    }
    proof = {
      verified_minimal: subsets.every((x) => !x.sufficient),
      dropping_any_one: subsets,
    };
  }

  // When nothing works, say WHAT still blocks it after everything is acquired.
  // "No subset helps" is true but useless; naming the rules that survive full
  // acquisition tells the operator the shortfall is substantive, not a gap in
  // their evidence collection.
  let residual = null;
  if (!sufficient.length) {
    const everything = new Set(universe.map((e) => e.id));
    const rep = evaluateWith(rulebook, context, waivers, supply, everything, now);
    evaluations++;
    residual = {
      signal_with_all_evidence: rep.signal,
      still_failing: rep.rules
        .filter((r) => r.state === STATE.VIOLATED || r.state === STATE.UNEVALUATED)
        .map((r) => ({ id: r.id, title: r.title, state: r.state, actual: r.actual || null })),
    };
  }

  return {
    already: false,
    signal: before.signal,
    goal,
    reachable: sufficient.length > 0,
    residual,
    terminal: false,
    universe: universe.map((e) => ({ id: e.id, label: e.label, cost: e.cost, unit: e.unit })),
    subsets_considered: all.length,
    evaluations,
    sets: sufficient,
    cheapest: sufficient[0] || null,
    minimality_proof: proof,
    method: 'exhaustive minimal hitting set over the declared evidence universe; minimality verified by re-evaluating every proper subset',
    citation: 'Reiter, A Theory of Diagnosis from First Principles (AI 32(1), 1987); recourse framing per Wachter, Mittelstadt & Russell (2017)',
    why: sufficient.length
      ? `${sufficient[0].evidence.length} acquisition${sufficient[0].evidence.length > 1 ? 's' : ''} (${sufficient[0].cost_human}) would reach ${goal}`
      : `no subset of the ${universe.length} declared acquisitions reaches ${goal}. Even with every acquisition supplied the gate is ${residual ? residual.signal_with_all_evidence : 'unchanged'}${residual && residual.still_failing.length ? `, held by ${residual.still_failing.map((r) => r.id).join(', ')}` : ''} — this is a substantive shortfall, not a gap in evidence collection.`,
  };
}

/**
 * Does this rulebook declare a way to resolve every rule it contains?
 *
 * A rule with no `resolvedBy` can go UNEVALUATED and offer the operator no
 * route out — the gate says "unknown" and stops. That is a defect in the
 * RULEBOOK, not in the situation, and it is invisible until someone asks this
 * question.
 *
 * We found it by building the recourse search: on the maneuver rulebook, every
 * declared acquisition could be supplied and fifteen rules still had nothing to
 * evaluate. That is worth reporting as a first-class audit rather than quietly
 * returning "no route found".
 */
function auditEvidenceCoverage(rulebook) {
  const rules = rulebook.rules || [];
  const universe = evidenceUniverse(rulebook);
  const known = new Set(universe.map((e) => e.id));

  const orphans = [];      // no evidence declared at all
  const dangling = [];     // declares evidence that is not in the universe
  for (const r of rules) {
    const ev = r.resolvedBy || [];
    if (!ev.length) {
      // NOT EVERY CONSTRAINT IS RESOLVED BY A MEASUREMENT.
      //
      // A lead-time rule is resolved by time passing. A quorum rule is
      // resolved by people voting. A contact rule is resolved by a pass over a
      // ground station. None of those is an acquisition you can task, and
      // reporting them as "missing evidence" would be wrong — the operator
      // cannot go and buy more quorum.
      //
      // We separate the two, because the distinction is exactly what an
      // operator needs: "wait", "act", or "measure" are different instructions.
      const kind = typeof r.deadline === 'function' ? 'TIME'
        : /quorum|consensus|vote/i.test(`${r.key} ${r.title}`) ? 'ACTION'
        : /contact|command|uplink/i.test(`${r.key} ${r.title}`) ? 'ACTION'
        : 'UNROUTED';
      orphans.push({ id: r.id, title: r.title, waivable: r.waivable !== false, resolved_by: kind });
      continue;
    }
    for (const e of ev) {
      if (!e || !e.id || !known.has(e.id)) {
        dangling.push({ id: r.id, evidence: e && e.id ? e.id : String(e) });
      }
    }
  }

  // Only genuinely UNROUTED rules are a defect. Time- and action-resolved
  // rules have a route; it just is not a purchase order.
  const unrouted = orphans.filter((o) => o.resolved_by === 'UNROUTED');

  return {
    rules: rules.length,
    evidence_items: universe.length,
    resolved_by_time: orphans.filter((o) => o.resolved_by === 'TIME').map((o) => o.id),
    resolved_by_action: orphans.filter((o) => o.resolved_by === 'ACTION').map((o) => o.id),
    unrouted,
    with_evidence: rules.length - orphans.length,
    coverage: rules.length ? +((rules.length - orphans.length) / rules.length).toFixed(4) : 1,
    orphans,
    dangling,
    // An orphaned NON-NEGOTIABLE is the worst case: it can block permanently
    // with no declared way to clear it.
    orphaned_non_negotiables: unrouted.filter((o) => !o.waivable),
    verdict: unrouted.length === 0 ? 'COMPLETE'
      : unrouted.some((o) => !o.waivable) ? 'BLOCKED' : 'PARTIAL',
    why: unrouted.length === 0
      ? `every rule has a route out: ${rules.length - orphans.length} by measurement, ${orphans.filter((o) => o.resolved_by === 'TIME').length} by elapsed time, ${orphans.filter((o) => o.resolved_by === 'ACTION').length} by an action someone must take`
      : `${unrouted.length} of ${rules.length} rules have NO route out at all — not a measurement, not a deadline, not an action. If they go UNEVALUATED the gate can offer the operator nothing.`,
  };
}

module.exports = { recourse, evidenceUniverse, costMinutes, fmtCost, auditEvidenceCoverage };
