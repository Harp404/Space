/**
 * Software release gate.      dev/constraints/rulebooks/release-gate.js
 * =============================================================================
 * THE THEME-INDEPENDENCE PROOF
 *
 * The challenge statement says the capability must "remain independent of any
 * specific hackathon theme". Asserting that would be cheap. This demonstrates it.
 *
 * This file is a rulebook about SHIPPING SOFTWARE. It shares nothing with orbital
 * mechanics — no satellites, no propagator, no space weather. It runs through
 * exactly the same engine (../engine.js), produces exactly the same four states,
 * obeys the same precedence, and honours the same two invariants:
 *
 *     UNRESOLVED is never a pass.
 *     You cannot waive what you never measured.
 *
 * ZERO CHANGES TO THE ENGINE. The engine has never heard of a satellite, and it
 * has never heard of a CVE either. It takes a rulebook and a context and returns
 * a completion signal. That is the capability; orbit is just where we needed it
 * first.
 *
 * The same shape would gate a clinical discharge, a drug batch release, a
 * structural sign-off, or a loan approval — anything with limits, conditions and
 * non-negotiable requirements where somebody has to say whether the work is
 * complete, partial, blocked, or unresolved.
 * =============================================================================
 */

'use strict';

const { CLASS, R } = require('../engine');

const LIMITS = {
  COVERAGE_MIN_PCT: 80,
  CRITICAL_CVES_MAX: 0,
  HIGH_CVES_MAX: 3,
  PERF_REGRESSION_MAX_PCT: 5,
  ERROR_BUDGET_MIN_PCT: 20,        // remaining error budget before a risky deploy
  APPROVALS_MIN: 2,
  MAX_CHANGE_LINES: 2000,          // beyond this, review quality degrades sharply
};

const EV = {
  CI:       { id: 'ci-run',        label: 'complete CI run', cost: 12, unit: 'min' },
  SCAN:     { id: 'security-scan', label: 'dependency vulnerability scan', cost: 4, unit: 'min' },
  PERF:     { id: 'perf-suite',    label: 'performance regression suite', cost: 25, unit: 'min' },
  SLO:      { id: 'slo-query',     label: 'error-budget query against the SLO', cost: 1, unit: 'min' },
  REVIEW:   { id: 'code-review',   label: 'peer approvals', cost: 2, unit: 'h' },
  ROLLBACK: { id: 'rollback-plan', label: 'documented rollback plan', cost: 30, unit: 'min' },
  ONCALL:   { id: 'oncall-roster', label: 'on-call roster confirmation', cost: 5, unit: 'min' },
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

const RULES = [
  {
    id: 'RG-01', key: 'TESTS-PASS', title: 'All tests pass',
    class: CLASS.HARD, waivable: false,          // non-negotiable
    authority: 'Engineering release policy',
    requirement: 'The full test suite must pass on the release candidate.',
    rationale: 'Shipping on a red build means the next failure is indistinguishable from the one already there. There is no deadline that makes that a good trade, so there is no waiver.',
    resolvedBy: [EV.CI],
    evaluate(ctx) {
      const ci = ctx.ci;
      if (!ci) return R.unknown('no CI result for this candidate', ['ci-run']);
      if (ci.status === 'running') return R.unknown('CI still running — the result does not exist yet', ['ci-run']);
      const failed = num(ci.failed);
      if (failed === null) return R.unknown('CI reported no test counts', ['ci-run']);
      const actual = `${ci.passed ?? '?'} passed · ${failed} failed`;
      return failed === 0
        ? R.pass('suite is green', actual, '0 failures')
        : R.fail('the build is red', actual, '0 failures');
    },
  },

  {
    id: 'RG-02', key: 'NO-CRITICAL-CVE', title: 'No unpatched critical vulnerability',
    class: CLASS.HARD, waivable: false,          // non-negotiable
    authority: 'Security policy · CVSS critical severity',
    requirement: `No critical-severity vulnerability may ship (limit ${LIMITS.CRITICAL_CVES_MAX}).`,
    rationale: 'A known critical vulnerability shipped knowingly is not a risk, it is a decision to be breached later. Every organisation that has waived this once has waived it again.',
    resolvedBy: [EV.SCAN],
    evaluate(ctx) {
      const sec = ctx.security;
      if (!sec) return R.unknown('no dependency scan on record', ['security-scan']);
      const crit = num(sec.critical);
      if (crit === null) return R.unknown('scan did not report severity counts', ['security-scan']);
      const actual = `${crit} critical · ${sec.high ?? '?'} high`;
      return crit <= LIMITS.CRITICAL_CVES_MAX
        ? R.pass('no critical vulnerabilities', actual, `<= ${LIMITS.CRITICAL_CVES_MAX} critical`)
        : R.fail('unpatched critical vulnerability — cannot be waived', actual, `<= ${LIMITS.CRITICAL_CVES_MAX} critical`);
    },
  },

  {
    id: 'RG-03', key: 'ROLLBACK-PLAN', title: 'Rollback plan is on record',
    class: CLASS.HARD, waivable: false,          // non-negotiable
    authority: 'Change management policy',
    requirement: 'A documented, tested rollback path must exist before deploy.',
    rationale: 'Every deploy is a bet. A rollback plan is the only thing that makes the bet reversible, and it has to exist before you need it — writing one during an incident is how a ten-minute outage becomes a four-hour one.',
    resolvedBy: [EV.ROLLBACK],
    evaluate(ctx) {
      const r = ctx.rollback;
      if (r == null) return R.unknown('no rollback plan filed', ['rollback-plan']);
      if (r.tested === false) return R.fail('rollback plan exists but has never been exercised', 'untested', 'tested rollback');
      if (r.tested !== true) return R.unknown('rollback plan filed but not marked as tested', ['rollback-plan']);
      return R.pass('tested rollback path on record', r.method || 'documented', 'tested rollback');
    },
  },

  {
    id: 'RG-04', key: 'PEER-REVIEW', title: 'Change has sufficient approvals',
    class: CLASS.HARD, waivable: true,
    authority: `Engineering policy — >= ${LIMITS.APPROVALS_MIN} approvals`,
    requirement: `At least ${LIMITS.APPROVALS_MIN} peer approvals on the change.`,
    rationale: 'Review catches the class of mistake tests do not: the thing that works exactly as written and should not have been written.',
    resolvedBy: [EV.REVIEW],
    evaluate(ctx) {
      const n = num(ctx.approvals);
      if (n === null) return R.unknown('approval count unavailable', ['code-review']);
      return n >= LIMITS.APPROVALS_MIN
        ? R.pass('sufficient approvals', `${n} approvals`, `>= ${LIMITS.APPROVALS_MIN}`)
        : R.fail('insufficient peer review', `${n} approvals`, `>= ${LIMITS.APPROVALS_MIN}`);
    },
  },

  {
    id: 'RG-05', key: 'ERROR-BUDGET', title: 'Error budget available',
    class: CLASS.HARD, waivable: true,
    authority: `SLO policy — >= ${LIMITS.ERROR_BUDGET_MIN_PCT}% of the error budget remaining`,
    requirement: `At least ${LIMITS.ERROR_BUDGET_MIN_PCT}% of the period's error budget must remain.`,
    rationale: 'The error budget is the finite resource a release spends, exactly like propellant. When it is gone, the next incident breaks the commitment to users rather than merely denting it.',
    resolvedBy: [EV.SLO],
    evaluate(ctx) {
      const pct = num(ctx.error_budget_pct);
      if (pct === null) return R.unknown('error budget not queried', ['slo-query']);
      return pct >= LIMITS.ERROR_BUDGET_MIN_PCT
        ? R.pass('budget available', `${pct}% remaining`, `>= ${LIMITS.ERROR_BUDGET_MIN_PCT}%`)
        : R.fail('error budget exhausted — freeze non-critical releases', `${pct}% remaining`, `>= ${LIMITS.ERROR_BUDGET_MIN_PCT}%`);
    },
  },

  {
    id: 'RG-06', key: 'ONCALL', title: 'On-call is staffed',
    class: CLASS.HARD, waivable: true,
    authority: 'Incident response policy',
    requirement: 'A named on-call engineer must be available for the deploy window.',
    rationale: 'Deploying into an unstaffed window means the mean time to acknowledge is however long it takes someone to notice on a weekend.',
    resolvedBy: [EV.ONCALL],
    evaluate(ctx) {
      const o = ctx.oncall;
      if (!o) return R.unknown('on-call roster not confirmed', ['oncall-roster']);
      if (!o.engineer) return R.fail('no on-call engineer for the deploy window', 'unstaffed', 'named engineer');
      return R.pass('on-call staffed', `${o.engineer}${o.window ? ` · ${o.window}` : ''}`, 'named engineer');
    },
  },

  {
    id: 'RG-07', key: 'COVERAGE', title: 'Test coverage meets the bar',
    class: CLASS.SOFT, waivable: true,
    authority: `Engineering policy — >= ${LIMITS.COVERAGE_MIN_PCT}%`,
    requirement: `Line coverage at or above ${LIMITS.COVERAGE_MIN_PCT}%.`,
    rationale: 'Coverage is a weak signal, which is exactly why it is advisory rather than blocking. Low coverage does not mean broken; it means untested, and that should be visible rather than silently accepted.',
    resolvedBy: [EV.CI],
    evaluate(ctx) {
      const c = num(ctx.coverage_pct);
      if (c === null) return R.unknown('coverage not reported by CI', ['ci-run']);
      return c >= LIMITS.COVERAGE_MIN_PCT
        ? R.pass('coverage above the bar', `${c}%`, `>= ${LIMITS.COVERAGE_MIN_PCT}%`)
        : R.fail('coverage below the bar', `${c}%`, `>= ${LIMITS.COVERAGE_MIN_PCT}%`);
    },
  },

  {
    id: 'RG-08', key: 'PERF-REGRESSION', title: 'No significant performance regression',
    class: CLASS.SOFT, waivable: true,
    authority: `Performance policy — <= ${LIMITS.PERF_REGRESSION_MAX_PCT}% p95 regression`,
    requirement: `p95 latency must not regress by more than ${LIMITS.PERF_REGRESSION_MAX_PCT}%.`,
    rationale: 'Performance regressions compound silently across releases until one of them is an incident.',
    resolvedBy: [EV.PERF],
    evaluate(ctx) {
      const p = num(ctx.perf_regression_pct);
      if (p === null) return R.unknown('performance suite has not run against this candidate', ['perf-suite']);
      return p <= LIMITS.PERF_REGRESSION_MAX_PCT
        ? R.pass('within the performance budget', `${p >= 0 ? '+' : ''}${p}% p95`, `<= +${LIMITS.PERF_REGRESSION_MAX_PCT}%`)
        : R.fail('p95 latency regression', `+${p}% p95`, `<= +${LIMITS.PERF_REGRESSION_MAX_PCT}%`);
    },
  },

  {
    id: 'RG-09', key: 'HIGH-CVE', title: 'High-severity vulnerabilities within tolerance',
    class: CLASS.SOFT, waivable: true,
    authority: `Security policy — <= ${LIMITS.HIGH_CVES_MAX} high severity`,
    requirement: `No more than ${LIMITS.HIGH_CVES_MAX} unpatched high-severity vulnerabilities.`,
    rationale: 'High-severity issues are usually exploitable only under conditions you control. Usually.',
    resolvedBy: [EV.SCAN],
    evaluate(ctx) {
      const sec = ctx.security;
      if (!sec) return R.unknown('no dependency scan on record', ['security-scan']);
      const high = num(sec.high);
      if (high === null) return R.unknown('scan did not report high-severity counts', ['security-scan']);
      return high <= LIMITS.HIGH_CVES_MAX
        ? R.pass('within tolerance', `${high} high`, `<= ${LIMITS.HIGH_CVES_MAX}`)
        : R.fail('too many unpatched high-severity issues', `${high} high`, `<= ${LIMITS.HIGH_CVES_MAX}`);
    },
  },

  {
    id: 'RG-10', key: 'CHANGE-SIZE', title: 'Change is reviewable in one sitting',
    class: CLASS.SOFT, waivable: true,
    authority: `Review-quality heuristic — <= ${LIMITS.MAX_CHANGE_LINES} lines`,
    requirement: `Diff size at or below ${LIMITS.MAX_CHANGE_LINES} lines.`,
    rationale: 'Review effectiveness falls off a cliff past a few hundred lines. A 5,000-line approval is a signature, not a review.',
    // Generated or vendored changes are not governed by a human-review heuristic.
    applies: (ctx) => (ctx.change_kind == null ? null : ctx.change_kind !== 'generated'),
    notApplicableDetail: 'generated or vendored change — human-review heuristic does not apply',
    resolvedBy: [EV.REVIEW],
    evaluate(ctx) {
      const n = num(ctx.change_lines);
      if (n === null) return R.unknown('diff size unknown', ['code-review']);
      return n <= LIMITS.MAX_CHANGE_LINES
        ? R.pass('reviewable size', `${n} lines`, `<= ${LIMITS.MAX_CHANGE_LINES}`)
        : R.fail('change is too large to review effectively', `${n} lines`, `<= ${LIMITS.MAX_CHANGE_LINES}`);
    },
  },
];

const releaseRulebook = {
  id: 'software-release',
  title: 'Software release gate',
  domain: 'Software delivery — NOT space',
  description: 'The same constraint engine, the same four states, a completely different domain. Proof that the capability is not tied to any theme.',
  rules: RULES,
};

/** Scenarios that exercise all four states, for the demo tab. */
const SCENARIOS = {
  clean: {
    label: 'Clean release',
    context: {
      ci: { status: 'done', passed: 1284, failed: 0 },
      security: { critical: 0, high: 1 },
      rollback: { tested: true, method: 'blue/green swap' },
      approvals: 3, error_budget_pct: 64,
      oncall: { engineer: 'A. Sharma', window: '09:00–17:00 IST' },
      coverage_pct: 87, perf_regression_pct: 1.2,
      change_lines: 420, change_kind: 'human',
    },
  },
  ci_running: {
    label: 'CI still running',
    context: {
      ci: { status: 'running' },
      security: { critical: 0, high: 1 },
      rollback: { tested: true, method: 'blue/green swap' },
      approvals: 3, error_budget_pct: 64,
      oncall: { engineer: 'A. Sharma' },
      change_lines: 420, change_kind: 'human',
    },
  },
  critical_cve: {
    label: 'Unpatched critical CVE',
    context: {
      ci: { status: 'done', passed: 1284, failed: 0 },
      security: { critical: 1, high: 4 },
      rollback: { tested: true, method: 'blue/green swap' },
      approvals: 3, error_budget_pct: 64,
      oncall: { engineer: 'A. Sharma' },
      coverage_pct: 87, perf_regression_pct: 1.2,
      change_lines: 420, change_kind: 'human',
    },
  },
  budget_burned: {
    label: 'Error budget exhausted',
    context: {
      ci: { status: 'done', passed: 1284, failed: 0 },
      security: { critical: 0, high: 1 },
      rollback: { tested: true, method: 'blue/green swap' },
      approvals: 3, error_budget_pct: 4,
      oncall: { engineer: 'A. Sharma' },
      coverage_pct: 87, perf_regression_pct: 1.2,
      change_lines: 420, change_kind: 'human',
    },
  },
  low_coverage: {
    label: 'Coverage below the bar',
    context: {
      ci: { status: 'done', passed: 1284, failed: 0 },
      security: { critical: 0, high: 1 },
      rollback: { tested: true, method: 'blue/green swap' },
      approvals: 3, error_budget_pct: 64,
      oncall: { engineer: 'A. Sharma' },
      coverage_pct: 61, perf_regression_pct: 1.2,
      change_lines: 420, change_kind: 'human',
    },
  },
};

/**
 * What each declared acquisition actually returns.
 *
 * The recourse engine needs to know what a measurement would PRODUCE, not just
 * that it exists. This is the rulebook's own honest statement of that — kept
 * here, next to the evidence definitions, so the two cannot drift apart.
 *
 * Note that a CI run supplies BOTH test results and coverage, because that is
 * what a CI run actually produces. Modelling it as tests-only would understate
 * what the acquisition buys and make the recommended set larger than it needs
 * to be.
 */
function supplyEvidence(context, ids) {
  const c = JSON.parse(JSON.stringify(context || {}));
  if (ids.has('ci-run')) {
    c.ci = { status: 'done', passed: 1284, failed: 0 };
    c.coverage_pct = Math.max(c.coverage_pct ?? 0, LIMITS.COVERAGE_MIN_PCT);
  }
  if (ids.has('security-scan')) c.security = { critical: 0, high: 1 };
  if (ids.has('perf-suite')) c.perf_regression_pct = 1.2;
  if (ids.has('slo-query')) c.error_budget_pct = 64;
  if (ids.has('code-review')) c.approvals = LIMITS.APPROVALS_MIN ?? 2;
  if (ids.has('rollback-plan')) c.rollback = { tested: true, method: 'blue/green swap' };
  if (ids.has('oncall-roster')) c.oncall = { engineer: 'on-call engineer', window: 'business hours' };
  return c;
}

module.exports = {
  supplyEvidence, releaseRulebook, LIMITS, SCENARIOS };
