/**
 * The theme-independence proof, as a test rather than a claim.
 *
 * If the engine has quietly grown space-specific behaviour, these fail.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('./engine.js');
const { dispatchRulebook, SCENARIOS, supplyEvidence, CATEGORY } = require('./rulebooks/dispatch.js');
const { recourse, auditEvidenceCoverage } = require('./recourse.js');
const { horizon } = require('./horizon.js');

const NOW = Date.parse('2026-08-23T12:00:00Z');
const { at } = require('./rulebooks/dispatch.js');
const ctxOf = (k) => at(SCENARIOS[k].context, NOW);

test('a domain with no software and no space content reaches all four states', () => {
  const seen = new Set();
  for (const k of Object.keys(SCENARIOS)) {
    seen.add(evaluate({ rulebook: dispatchRulebook, context: ctxOf(k), now: NOW }).signal);
  }
  for (const s of ['COMPLETE', 'PARTIAL', 'BLOCKED', 'UNRESOLVED']) {
    // PARTIAL requires a waiver, so it is exercised separately below.
    if (s === 'PARTIAL') continue;
    assert.ok(seen.has(s), `dispatch never reached ${s}; saw ${[...seen].join(', ')}`);
  }
});

test('PARTIAL is reachable by waiving a waivable rule, and only a waivable one', () => {
  const ctx = ctxOf('condition_broken');
  const waived = evaluate({
    rulebook: dispatchRulebook, context: ctx, now: NOW,
    waivers: [{ rule_id: 'MEL-06', by: 'duty ops manager', reason: 'departure retimed to daylight' }],
  });
  assert.equal(waived.signal, 'PARTIAL');

  // MEL-01 is non-negotiable: no relief exists for an unlisted item, and a
  // waiver must not manufacture one.
  const cannot = evaluate({
    rulebook: dispatchRulebook, context: ctxOf('not_listed'), now: NOW,
    waivers: [{ rule_id: 'MEL-01', by: 'anyone', reason: 'we are in a hurry' }],
  });
  assert.equal(cannot.signal, 'BLOCKED');
});

test('an expired rectification interval is terminal, not merely unresolved', () => {
  const r = recourse({
    rulebook: dispatchRulebook, context: ctxOf('interval_expired'),
    supply: supplyEvidence, now: NOW,
  });
  assert.equal(r.terminal, true);
  assert.ok(r.blockers.some((b) => b.id === 'MEL-02'));
  assert.equal(r.sets.length, 0, 'a terminal gate must not recommend acquisitions');
});

test('recourse returns a verified-minimal acquisition set', () => {
  const r = recourse({
    rulebook: dispatchRulebook, context: ctxOf('awaiting_crew_ack'),
    supply: supplyEvidence, now: NOW,
  });
  assert.ok(r.reachable);
  assert.ok(r.minimality_proof.verified_minimal,
    'every proper subset of the recommendation must fail to reach the goal');
});

test('a constraint resolved by waiting has no acquisition route, and says so', () => {
  // You cannot buy daylight. The correct answer is "no measurement helps",
  // which is different from "terminal" and different from "here is a shopping list".
  const r = recourse({
    rulebook: dispatchRulebook, context: ctxOf('condition_broken'),
    supply: supplyEvidence, now: NOW,
  });
  assert.equal(r.reachable, false);
  assert.equal(r.terminal, false);
  assert.ok(r.residual, 'it should report what still fails with everything supplied');
});

test('repair categories carry deadlines, so the gate has a countdown', () => {
  const h = horizon({ rulebook: dispatchRulebook, context: ctxOf('clean'), now: NOW });
  assert.ok(Number.isFinite(h.self_blocks_in_ms));
  assert.equal(h.self_blocks_on.id, 'MEL-02');
  // Category D is 120 days from discovery; the scenario discovered it 3 days ago.
  const expectH = CATEGORY.D.hours - 3 * 24;
  assert.ok(Math.abs(h.self_blocks_in_ms / 3600000 - expectH) < 2,
    `expected ~${expectH} h, got ${(h.self_blocks_in_ms / 3600000).toFixed(1)} h`);
});

test('every dispatch rule declares a route out', () => {
  const a = auditEvidenceCoverage(dispatchRulebook);
  assert.equal(a.verdict, 'COMPLETE', a.why);
});

test('the engine contains no domain-specific vocabulary', () => {
  // The claim is structural: the engine must not know what any of its
  // rulebooks are about. Checked here so it cannot silently stop being true.
  const raw = require('node:fs').readFileSync(require.resolve('./engine.js'), 'utf8');
  // Strip comments: the module doc deliberately SAYS "it has never heard of a
  // satellite", and prose about being domain-agnostic must not be mistaken for
  // domain knowledge. Word boundaries too — 'tle' otherwise matches atLeast
  // and title.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const word of ['satellite', 'orbital', 'conjunction', 'aircraft', 'dispatch', 'CVE', 'TLE', 'maneuver']) {
    assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(code),
      `engine.js CODE references "${word}" — it is no longer domain-agnostic`);
  }
});
