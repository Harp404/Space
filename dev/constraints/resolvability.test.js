/**
 * Tests for the resolvability capability.
 *
 * These check the two things that must not silently break: the degenerate
 * case (where the interval is infinite and the answer is a proof, not a
 * preference), and the monotonicity of the coverage envelope in n.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolvability, coverageEnvelope, requiredSamples, betacdf } = require('./resolvability.js');

test('below 1/alpha - 1 samples the conformal interval is provably infinite', () => {
  const alpha = 0.05;
  const threshold = Math.ceil(1 / alpha) - 1;   // 19
  for (let n = 1; n < threshold; n++) {
    const e = coverageEnvelope(n, alpha);
    assert.equal(e.degenerate, true, `n=${n} should be degenerate`);
    assert.equal(resolvability({ n, alpha }).state, 'BLOCKED');
  }
  assert.equal(coverageEnvelope(threshold + 1, alpha).degenerate, false);
});

test('the coverage envelope tightens monotonically as n grows', () => {
  let prev = Infinity;
  for (const n of [40, 80, 160, 320, 640, 1280, 4237]) {
    const e = coverageEnvelope(n, 0.05);
    const width = e.coverage_ci[1] - e.coverage_ci[0];
    assert.ok(width <= prev + 1e-9, `width grew at n=${n}: ${width} > ${prev}`);
    prev = width;
  }
});

test('the envelope brackets the target coverage', () => {
  for (const n of [50, 200, 1000]) {
    const e = coverageEnvelope(n, 0.05);
    assert.ok(e.coverage_ci[0] <= 0.95 && e.coverage_ci[1] >= 0.95,
      `target 0.95 outside [${e.coverage_ci}] at n=${n}`);
  }
});

test('requiredSamples is consistent with the envelope it is derived from', () => {
  for (const tol of [0.10, 0.05, 0.02]) {
    const need = requiredSamples(0.05, tol);
    assert.ok(need.achievable);
    const at = coverageEnvelope(need.n_required, 0.05);
    assert.ok((at.coverage_ci[1] - at.coverage_ci[0]) / 2 <= tol + 1e-9,
      `n_required=${need.n_required} does not meet tol=${tol}`);
    // and one fewer sample must NOT meet it, or the search is not tight
    const below = coverageEnvelope(need.n_required - 1, 0.05);
    if (!below.degenerate) {
      assert.ok((below.coverage_ci[1] - below.coverage_ci[0]) / 2 > tol - 1e-9,
        `n_required=${need.n_required} is not minimal for tol=${tol}`);
    }
  }
});

test('a conditional guarantee is NOT_EVER regardless of sample size', () => {
  for (const n of [10, 1000, 1e6]) {
    const v = resolvability({ n, alpha: 0.05, conditional: true });
    assert.equal(v.state, 'NOT_EVER');
    assert.match(v.citation, /1903\.04684/);
  }
});

test('betacdf agrees with known closed forms', () => {
  // Beta(1,1) is uniform.
  for (const x of [0.1, 0.5, 0.9]) assert.ok(Math.abs(betacdf(x, 1, 1) - x) < 1e-9);
  // Beta(2,1) has CDF x^2.
  for (const x of [0.2, 0.7]) assert.ok(Math.abs(betacdf(x, 2, 1) - x * x) < 1e-9);
});
