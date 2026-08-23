/**
 * Property-based tests for the constraint engine.
 * =============================================================================
 * WHY PROPERTIES RATHER THAN EXAMPLES
 *
 * Our example tests check that the engine behaves correctly on the situations
 * we thought of. That is exactly the set of situations least likely to contain
 * a bug, because we thought of them.
 *
 * These tests instead state properties that must hold for EVERY rulebook and
 * EVERY context, and let fast-check search for a counterexample. When it finds
 * one it shrinks it to the smallest failing case and prints a seed, so the
 * failure is reproducible rather than a one-off.
 *
 * The important one is SAFETY: a COMPLETE signal must imply that every rule
 * was actually evaluated. That is a statement about the whole space of
 * rulebooks an operator could write, not about the handful we wrote.
 *
 *   node --test dev/constraints/engine.properties.test.js
 * =============================================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { evaluate, rollup, STATE, SIGNAL, R } = require('./engine.js');

const RUNS = Number(process.env.PROPERTY_RUNS || 500);

// ---------------------------------------------------------------------------
// Generators — arbitrary rulebooks, including ones we would never write.
// ---------------------------------------------------------------------------

/** A rule whose outcome we dictate, so the property can reason about it. */
const outcomeArb = fc.constantFrom('pass', 'fail', 'unknown', 'na', 'throw');

const ruleArb = fc.record({
  outcome: outcomeArb,
  waivable: fc.boolean(),
  applies: fc.constantFrom(true, false, null),   // null = cannot tell
});

function buildRulebook(specs) {
  return {
    id: 'generated',
    domain: 'property-test',
    rules: specs.map((s, i) => ({
      id: `P-${String(i).padStart(2, '0')}`,
      title: `generated rule ${i}`,
      waivable: s.waivable,
      applies: () => s.applies,
      evaluate: () => {
        switch (s.outcome) {
          case 'pass': return R.pass('generated pass');
          case 'fail': return R.fail('generated failure');
          case 'unknown': return R.unknown('generated unknown');
          case 'na': return R.na('generated not applicable');
          // A rule that throws is the case real rulebooks hit in production
          // and the case authors never write a test for.
          case 'throw': throw new Error('rule blew up');
          default: return R.unknown('unreachable');
        }
      },
    })),
  };
}

const rulebookArb = fc.array(ruleArb, { minLength: 1, maxLength: 8 }).map(buildRulebook);

// ---------------------------------------------------------------------------
// THE SAFETY PROPERTY — the one the whole project rests on.
// ---------------------------------------------------------------------------

test('SAFETY: COMPLETE implies every applicable rule was actually evaluated', () => {
  fc.assert(
    fc.property(rulebookArb, (rulebook) => {
      const rep = evaluate({ rulebook, context: {} });
      if (rep.signal !== SIGNAL.COMPLETE) return true;
      // Not one rule may be UNEVALUATED. "We didn't check" can never
      // contribute to "everything is fine".
      return rep.rules.every((r) => r.state !== STATE.UNEVALUATED);
    }),
    { numRuns: RUNS },
  );
});

test('SAFETY: a rule that throws never becomes SATISFIED', () => {
  fc.assert(
    fc.property(fc.array(ruleArb, { minLength: 1, maxLength: 6 }), (specs) => {
      const rep = evaluate({ rulebook: buildRulebook(specs), context: {} });
      return rep.rules.every((r, i) =>
        specs[i].outcome !== 'throw' || r.state !== STATE.SATISFIED);
    }),
    { numRuns: RUNS },
  );
});

test('SAFETY: any UNEVALUATED rule forces UNRESOLVED or BLOCKED', () => {
  fc.assert(
    fc.property(rulebookArb, (rulebook) => {
      const rep = evaluate({ rulebook, context: {} });
      const anyUnknown = rep.rules.some((r) => r.state === STATE.UNEVALUATED);
      if (!anyUnknown) return true;
      return rep.signal === SIGNAL.UNRESOLVED || rep.signal === SIGNAL.BLOCKED;
    }),
    { numRuns: RUNS },
  );
});

// ---------------------------------------------------------------------------
// WAIVER SOUNDNESS — you cannot waive what you never measured.
// ---------------------------------------------------------------------------

test('WAIVERS: waiving an unmeasured or non-negotiable rule never authorises', () => {
  fc.assert(
    fc.property(rulebookArb, (rulebook) => {
      // Waive absolutely everything — the most hostile possible operator.
      const waivers = rulebook.rules.map((r) => ({
        rule_id: r.id, by: 'property-test', reason: 'blanket waiver',
      }));
      const rep = evaluate({ rulebook, context: {}, waivers });
      for (const r of rep.rules) {
        if (r.state !== STATE.WAIVED) continue;
        // Only a genuinely VIOLATED, waivable rule may end up WAIVED.
        const spec = rulebook.rules.find((x) => x.id === r.id);
        if (spec.waivable === false) return false;
      }
      // And a blanket waiver can never turn an unknown into an authorisation.
      const stillUnknown = rep.rules.some((r) => r.state === STATE.UNEVALUATED);
      return !(stillUnknown && rep.authorised);
    }),
    { numRuns: RUNS },
  );
});

// ---------------------------------------------------------------------------
// DETERMINISM & ORDER INDEPENDENCE — the lattice properties.
// ---------------------------------------------------------------------------

test('DETERMINISM: the same inputs always produce the same signal', () => {
  fc.assert(
    fc.property(rulebookArb, (rulebook) => {
      const a = evaluate({ rulebook, context: {}, now: 0 });
      const b = evaluate({ rulebook, context: {}, now: 0 });
      return a.signal === b.signal && a.progress === b.progress;
    }),
    { numRuns: RUNS },
  );
});

test('LATTICE: rule order does not change the signal', () => {
  fc.assert(
    fc.property(
      fc.array(ruleArb, { minLength: 2, maxLength: 7 }),
      fc.integer({ min: 0, max: 1000 }),
      (specs, seed) => {
        const a = evaluate({ rulebook: buildRulebook(specs), context: {}, now: 0 });
        // deterministic shuffle driven by the generated seed
        const shuffled = specs.map((s, i) => [((i * 31 + seed) % specs.length), s])
          .sort((x, y) => x[0] - y[0]).map((p) => p[1]);
        const b = evaluate({ rulebook: buildRulebook(shuffled), context: {}, now: 0 });
        return a.signal === b.signal;
      },
    ),
    { numRuns: RUNS },
  );
});

test('LATTICE: rollup is order-independent and takes the worst state', () => {
  fc.assert(
    fc.property(fc.array(rulebookArb, { minLength: 1, maxLength: 5 }), (books) => {
      const reports = books.map((rulebook) => evaluate({ rulebook, context: {}, now: 0 }));
      const a = rollup(reports);
      const b = rollup([...reports].reverse());
      if (a.signal !== b.signal) return false;
      // the aggregate can never be better than the worst member
      const RANK = { COMPLETE: 0, PARTIAL: 1, UNRESOLVED: 2, BLOCKED: 3 };
      const worst = Math.max(...reports.map((r) => RANK[r.signal]));
      return RANK[a.signal] >= worst;
    }),
    { numRuns: Math.max(100, RUNS / 2) },
  );
});

// ---------------------------------------------------------------------------
// MONOTONICITY — evidence may only ever help, never hurt.
// ---------------------------------------------------------------------------

test('MONOTONICITY: turning an unknown into a pass never worsens the signal', () => {
  fc.assert(
    fc.property(
      fc.array(ruleArb, { minLength: 1, maxLength: 6 }),
      fc.nat(),
      (specs, pick) => {
        const RANK = { COMPLETE: 0, PARTIAL: 1, UNRESOLVED: 2, BLOCKED: 3 };
        const before = evaluate({ rulebook: buildRulebook(specs), context: {}, now: 0 });
        const i = specs.findIndex((s, n) => n >= pick % specs.length && s.outcome === 'unknown');
        if (i < 0) return true;
        const after = specs.map((s, n) => (n === i ? { ...s, outcome: 'pass' } : s));
        const rep = evaluate({ rulebook: buildRulebook(after), context: {}, now: 0 });
        return RANK[rep.signal] <= RANK[before.signal];
      },
    ),
    { numRuns: RUNS },
  );
});
