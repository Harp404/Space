/**
 * Constraint engine — offline test suite.   node dev/constraints/engine.test.js
 * Zero dependencies, zero network, deterministic.
 *
 * Proves the completion signal is a pure function of the rulebook, and that the
 * two invariants hold: UNRESOLVED is never a pass, and you cannot waive what was
 * never measured.
 */
'use strict';

const { evaluate, rollup, STATE, SIGNAL, CLASS, R } = require('./engine');

let pass = 0, fail = 0;
const G = '\x1b[32m', RD = '\x1b[31m', B = '\x1b[1m', X = '\x1b[0m';

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${RD}✗${X} ${name}${extra ? '  → ' + extra : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t) { console.log(`\n${B}${t}${X}`); }

const NOW = Date.parse('2026-08-22T12:00:00Z');
const HOUR = 3600000;

// --- a tiny synthetic rulebook, so these tests exercise the ENGINE, not a domain ---
const rule = (id, cls, waivable, fn, extra = {}) => ({
  id, key: id, title: `rule ${id}`, class: cls, waivable,
  authority: 'test suite', requirement: 'test', rationale: 'exercises the engine',
  evaluate: fn, ...extra,
});

const book = (...rules) => ({ id: 'test', title: 'Test rulebook', domain: 'test', rules });

const ev = (rb, over = {}) => evaluate({ rulebook: rb, context: {}, now: NOW, ...over });

// ---------------------------------------------------------------------------
section('COMPLETE — every applicable rule evaluated and satisfied');
{
  const r = ev(book(
    rule('A', CLASS.HARD, true, () => R.pass('fine', '1', '<= 2')),
    rule('B', CLASS.SOFT, true, () => R.pass('fine')),
  ));
  eq('signal', r.signal, SIGNAL.COMPLETE);
  eq('progress 100%', r.progress, 100);
  ok('authorised', r.authorised === true);
  eq('nothing blocking', r.blocking.length, 0);
  eq('nothing unevaluated', r.unevaluated.length, 0);
}

// ---------------------------------------------------------------------------
section('BLOCKED — a hard rule is violated');
{
  const r = ev(book(
    rule('A', CLASS.HARD, true, () => R.fail('over', '9', '<= 2')),
    rule('B', CLASS.SOFT, true, () => R.pass('fine')),
  ));
  eq('signal', r.signal, SIGNAL.BLOCKED);
  ok('not authorised', r.authorised === false);
  ok('names the rule', r.blocking[0].id === 'A');
  ok('next action is BLOCKING', r.next_actions[0].severity === 'BLOCKING');
}
{
  const r = ev(book(rule('A', CLASS.SOFT, true, () => R.fail('over'))));
  ok('a SOFT rule NEVER blocks', r.signal !== SIGNAL.BLOCKED);
  eq('it degrades to PARTIAL instead', r.signal, SIGNAL.PARTIAL);
}

// ---------------------------------------------------------------------------
section('UNRESOLVED — invariant 1: not knowing is never a pass');
{
  const r = ev(book(
    rule('A', CLASS.HARD, true, () => R.pass('fine')),
    rule('B', CLASS.HARD, true, () => R.unknown('no data yet')),
  ));
  eq('signal', r.signal, SIGNAL.UNRESOLVED);
  ok('NOT authorised — unknown is not permission', r.authorised === false);
  ok('names what is missing', r.unevaluated[0].id === 'B');
  ok('next action is UNKNOWN', r.next_actions.some((a) => a.severity === 'UNKNOWN'));
  ok('unevaluated does NOT count as closed', r.progress < 100);
}
{
  // A throwing evaluator must degrade to unknown, never silently pass.
  const r = ev(book(rule('A', CLASS.HARD, true, () => { throw new Error('boom'); })));
  eq('a throwing rule is UNEVALUATED', r.rules[0].state, STATE.UNEVALUATED);
  eq('and the signal is UNRESOLVED', r.signal, SIGNAL.UNRESOLVED);
  ok('the error is surfaced', /boom/.test(r.rules[0].detail));
}
{
  const r = ev(book(rule('A', CLASS.HARD, true, () => undefined)));
  eq('an evaluator returning nothing is UNEVALUATED', r.rules[0].state, STATE.UNEVALUATED);
}
{
  const r = ev(book(rule('A', CLASS.HARD, true, () => R.pass('fine'), {
    applies: () => { throw new Error('cannot tell'); },
  })));
  eq('an undecidable applies() gate is UNEVALUATED, not skipped', r.rules[0].state, STATE.UNEVALUATED);
}

// ---------------------------------------------------------------------------
section('NOT_APPLICABLE — excluded from the counts entirely');
{
  const r = ev(book(
    rule('A', CLASS.HARD, true, () => R.pass('fine')),
    rule('B', CLASS.HARD, true, () => R.fail('never runs'), { applies: () => false }),
  ));
  eq('signal is COMPLETE', r.signal, SIGNAL.COMPLETE);
  eq('applicable count excludes it', r.counts.applicable, 1);
  eq('not_applicable counted separately', r.counts.not_applicable, 1);
  eq('an N/A rule cannot block', r.blocking.length, 0);
}

// ---------------------------------------------------------------------------
section('PARTIAL — hard rules pass, something advisory or waived');
{
  const r = ev(book(
    rule('A', CLASS.HARD, true, () => R.pass('fine')),
    rule('B', CLASS.SOFT, true, () => R.fail('advisory only')),
  ));
  eq('signal', r.signal, SIGNAL.PARTIAL);
  ok('still authorised', r.authorised === true);
  ok('advisory listed', r.advisory[0].id === 'B');
}

// ---------------------------------------------------------------------------
section('Waivers — invariant 2: you cannot waive the unmeasured');
{
  const rb = book(rule('A', CLASS.HARD, true, () => R.fail('over')));
  const w = [{ rule_id: 'A', party: 'ESA', reason: 'accepted out of band', ts: NOW }];
  const r = ev(rb, { waivers: w });
  eq('a waived violation is no longer BLOCKED', r.signal, SIGNAL.PARTIAL);
  eq('rule state is WAIVED', r.rules[0].state, STATE.WAIVED);
  eq('waiver records who', r.rules[0].waiver.party, 'ESA');
  ok('waived is never COMPLETE', r.signal !== SIGNAL.COMPLETE);
}
{
  const rb = book(rule('A', CLASS.HARD, false, () => R.fail('over')));   // non-negotiable
  const w = [{ rule_id: 'A', party: 'SpaceX', reason: 'schedule pressure', ts: NOW }];
  const r = ev(rb, { waivers: w });
  eq('a non-negotiable rule stays BLOCKED', r.signal, SIGNAL.BLOCKED);
  eq('and stays VIOLATED', r.rules[0].state, STATE.VIOLATED);
  ok('the waiver is explicitly rejected', /non-negotiable/.test(r.rules[0].waiver_rejected));
}
{
  const rb = book(rule('A', CLASS.HARD, true, () => R.unknown('no data')));
  const w = [{ rule_id: 'A', party: 'JAXA', reason: 'assume fine', ts: NOW }];
  const r = ev(rb, { waivers: w });
  eq('a waiver cannot convert UNEVALUATED', r.rules[0].state, STATE.UNEVALUATED);
  eq('signal stays UNRESOLVED', r.signal, SIGNAL.UNRESOLVED);
  ok('rejection explains why', /not been evaluated/.test(r.rules[0].waiver_rejected));
}
{
  const rb = book(rule('A', CLASS.HARD, true, () => R.pass('fine')));
  const r = ev(rb, { waivers: [{ rule_id: 'A', party: 'ISRO', reason: 'just in case' }] });
  eq('waiving a satisfied rule changes nothing', r.rules[0].state, STATE.SATISFIED);
  ok('and is rejected', /no violation to waive/.test(r.rules[0].waiver_rejected));
}

// ---------------------------------------------------------------------------
section('Precedence — BLOCKED > UNRESOLVED > PARTIAL > COMPLETE');
{
  const r = ev(book(
    rule('A', CLASS.HARD, true, () => R.fail('hard violation')),
    rule('B', CLASS.HARD, true, () => R.unknown('unknown')),
    rule('C', CLASS.SOFT, true, () => R.fail('advisory')),
  ));
  eq('hard violation wins over everything', r.signal, SIGNAL.BLOCKED);
}
{
  const r = ev(book(
    rule('B', CLASS.HARD, true, () => R.unknown('unknown')),
    rule('C', CLASS.SOFT, true, () => R.fail('advisory')),
  ));
  eq('unknown wins over advisory', r.signal, SIGNAL.UNRESOLVED);
}

// ---------------------------------------------------------------------------
section('Determinism — same input, same output');
{
  const rb = book(
    rule('A', CLASS.HARD, true, () => R.pass('fine')),
    rule('B', CLASS.SOFT, true, () => R.fail('advisory')),
  );
  const signals = new Set(Array.from({ length: 100 }, () => ev(rb).signal));
  eq('100 evaluations give one signal', signals.size, 1);
  const json = new Set(Array.from({ length: 20 }, () => JSON.stringify(ev(rb).rules)));
  eq('and byte-identical rule output', json.size, 1);
}

// ---------------------------------------------------------------------------
section('Deadlines — conditions that expire');
{
  const rb = book(
    rule('A', CLASS.HARD, true, () => R.pass('fine'), { deadline: () => NOW + 3 * HOUR }),
    rule('B', CLASS.HARD, true, () => R.pass('fine'), { deadline: () => NOW + 9 * HOUR }),
  );
  const r = ev(rb);
  eq('reports the earliest deadline', r.deadline.rule_id, 'A');
  eq('with time remaining', r.deadline.in_ms, 3 * HOUR);
}
{
  const rb = book(rule('A', CLASS.HARD, true, () => R.fail('already over'), { deadline: () => NOW + HOUR }));
  eq('an already-violated rule has no live deadline', ev(rb).deadline, null);
}
{
  const rb = book(rule('A', CLASS.HARD, true, () => R.pass('fine'), { deadline: () => NOW - HOUR }));
  eq('a past deadline is ignored', ev(rb).deadline, null);
}

// ---------------------------------------------------------------------------
section('Evidence — what would resolve the unknowns');
{
  const rb = book(
    rule('A', CLASS.HARD, true, () => R.unknown('need a track'), {
      resolvedBy: [{ id: 'radar-pass', label: 'radar pass on the secondary', cost: 90 }],
    }),
    rule('B', CLASS.SOFT, true, () => R.unknown('need a track'), {
      resolvedBy: [{ id: 'radar-pass', label: 'radar pass on the secondary', cost: 90 }],
    }),
    rule('C', CLASS.SOFT, true, () => R.unknown('need an ephemeris'), {
      resolvedBy: [{ id: 'operator-ephem', label: 'operator ephemeris' }],
    }),
  );
  const r = ev(rb);
  eq('evidence is deduplicated', r.evidence_needed.length, 2);
  eq('ranked by how many rules it closes', r.evidence_needed[0].evidence, 'radar-pass');
  eq('and lists them', r.evidence_needed[0].closes.length, 2);
  ok('carries the cost', r.evidence_needed[0].cost === 90);
}

// ---------------------------------------------------------------------------
section('Rollup — the aggregate signal over many items');
{
  const complete   = ev(book(rule('A', CLASS.HARD, true, () => R.pass('ok'))));
  const partial    = ev(book(rule('A', CLASS.SOFT, true, () => R.fail('advisory'))));
  const unresolved = ev(book(rule('A', CLASS.HARD, true, () => R.unknown('no data'))));
  const blocked    = ev(book(rule('A', CLASS.HARD, true, () => R.fail('over'))));

  const all = rollup([complete, complete, partial, unresolved, blocked]);
  eq('counts items', all.items, 5);
  eq('COMPLETE tallied', all.by.COMPLETE, 2);
  eq('worst state wins', all.signal, SIGNAL.BLOCKED);

  eq('without blocked, unresolved wins', rollup([complete, partial, unresolved]).signal, SIGNAL.UNRESOLVED);
  eq('without unknowns, partial wins', rollup([complete, partial]).signal, SIGNAL.PARTIAL);
  eq('all clear is COMPLETE', rollup([complete, complete]).signal, SIGNAL.COMPLETE);
  eq('empty rolls up to COMPLETE', rollup([]).items, 0);
}

// ---------------------------------------------------------------------------
section('The engine is domain-agnostic');
{
  // Same engine, a rulebook about something that is not space at all.
  const releaseGate = {
    id: 'release', title: 'Release gate', domain: 'software',
    rules: [
      rule('CVE', CLASS.HARD, false, (c) => c.criticalCves === 0
        ? R.pass('no critical CVEs', '0', '0')
        : R.fail('unpatched critical CVE', String(c.criticalCves), '0')),
      rule('COV', CLASS.SOFT, true, (c) => R.atLeast(c.coverage, 80, (x) => `${x}%`)),
      rule('ROLLBACK', CLASS.HARD, true, (c) => c.rollbackPlan == null
        ? R.unknown('no rollback plan on record')
        : R.pass('rollback plan filed')),
    ],
  };

  const r1 = evaluate({ rulebook: releaseGate, context: { criticalCves: 0, coverage: 91, rollbackPlan: 'doc' }, now: NOW });
  eq('a clean release is COMPLETE', r1.signal, SIGNAL.COMPLETE);

  const r2 = evaluate({ rulebook: releaseGate, context: { criticalCves: 1, coverage: 91, rollbackPlan: 'doc' }, now: NOW });
  eq('an unpatched CVE is BLOCKED', r2.signal, SIGNAL.BLOCKED);
  const w = [{ rule_id: 'CVE', party: 'release manager', reason: 'ship it' }];
  eq('and cannot be waived', evaluate({ rulebook: releaseGate, context: { criticalCves: 1, coverage: 91, rollbackPlan: 'd' }, waivers: w, now: NOW }).signal, SIGNAL.BLOCKED);

  const r3 = evaluate({ rulebook: releaseGate, context: { criticalCves: 0, coverage: 91 }, now: NOW });
  eq('a missing rollback plan is UNRESOLVED', r3.signal, SIGNAL.UNRESOLVED);

  const r4 = evaluate({ rulebook: releaseGate, context: { criticalCves: 0, coverage: 61, rollbackPlan: 'doc' }, now: NOW });
  eq('low coverage is PARTIAL', r4.signal, SIGNAL.PARTIAL);
}

// ---------------------------------------------------------------------------
section('Input handling');
{
  let threw = false;
  try { evaluate({}); } catch { threw = true; }
  ok('a missing rulebook throws rather than returning a false pass', threw);
}

console.log(`\n${fail === 0 ? G : RD}${B}${pass} passed, ${fail} failed${X}\n`);
process.exit(fail === 0 ? 0 : 1);
