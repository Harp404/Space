/**
 * Deterministic operator voting.        dev/constraints/voting.js
 * =============================================================================
 * WHAT THIS REPLACES
 *
 * Before this file, the cluster voted like this:
 *
 *     const voteYes = conj.risk_index > 40 || Math.random() < 0.70;
 *
 * A coin flip. The same event could be approved and denied on consecutive runs,
 * no operator could explain its own vote, and the TLA+ safety proof described a
 * protocol the implementation did not actually follow.
 *
 * Now every vote is a pure function of the constraint report. Same event, same
 * answer, every time — and each vote carries the rule id that drove it.
 *
 * HOW A NODE DECIDES
 *
 *   1. Report BLOCKED     -> NO. A hard rule is violated; nobody authorises that.
 *   2. Report UNRESOLVED  -> NO. "We do not vote on what we have not evaluated."
 *   3. Otherwise, check this operator's own published sensitivities.
 *      A rule that is VIOLATED, or WAIVED by somebody else, is a NO for an
 *      operator that holds it as a red line.
 *   4. Otherwise YES.
 *
 * WHY A WAIVER DOES NOT BIND EVERY OPERATOR
 *
 * A waiver is one party's acceptance of a risk. It is not consent from the
 * others. An operator sensitive to a waived rule still votes NO — which is what
 * makes this a negotiation between independent parties rather than a rubber
 * stamp, and is the point of having a quorum at all.
 *
 * Zero dependencies. Pure functions.
 * =============================================================================
 */

'use strict';

const { STATE, SIGNAL } = require('./engine');

// ---------------------------------------------------------------------------
// Operator postures.
//
// Real operators do not share risk tolerances — SSC 8.f asks crewed-vehicle
// operators to publish theirs precisely because they differ. These are each
// node's published red lines: the rules it will not proceed past, even when the
// aggregate signal permits it.
// ---------------------------------------------------------------------------

// NAMING — READ THIS BEFORE QUOTING ANY OF IT
//
// These are NOT agencies casting votes. No space agency has any involvement in
// this system, and presenting one as having voted would be a false claim about
// a real organisation.
//
// They are four REVIEW PROFILES: independent stances that weight different
// rules in our own rulebook, modelled on the published risk priorities of the
// operator types named in each profile's `modelled_on` field. Their purpose is
// to test whether a decision is FRAGILE — if a maneuver is approved under one
// weighting and refused under another, the disagreement is the finding, and it
// is surfaced rather than averaged away.
//
// Each profile's sensitivity is declared in advance and served over the API
// alongside the rulebook, so a reviewer can check that the profile voted the
// way its published stance says it should.

const POSTURES = {
  1: {
    name: 'ISRO (modelled)',
    modelled_on: 'Earth-observation operators with long revisit cycles (e.g. ISRO)',
    stance: 'data currency and decision timeline',
    sensitive_to: ['FR-10', 'FR-09'],
    reason: 'operates Earth-observation assets with long revisit cycles; will not act on stale orbit determination or inside a compressed decision window',
  },
  2: {
    name: 'ESA (modelled)',
    modelled_on: 'operators requiring covariance-bearing data before accepting a Pc (e.g. ESA)',
    stance: 'covariance basis and probability dilution',
    sensitive_to: ['FR-11', 'FR-12'],
    reason: 'requires covariance-bearing data before accepting a Pc figure; treats the dilution region as disqualifying',
  },
  3: {
    name: 'JAXA (modelled)',
    modelled_on: 'operators treating element-set currency and dilution as coupled (e.g. JAXA)',
    stance: 'orbit-determination quality',
    sensitive_to: ['FR-10', 'FR-12'],
    reason: 'holds element-set currency and dilution as coupled indicators of whether the estimate can be trusted at all',
  },
  4: {
    name: 'SpaceX (modelled)',
    modelled_on: 'large-constellation operators where per-maneuver cost compounds (e.g. SpaceX)',
    stance: 'propellant cost and execution timeline',
    sensitive_to: ['FR-04', 'FR-09'],
    reason: 'operates a large constellation where per-maneuver propellant compounds across thousands of assets',
  },
};

/**
 * Published review profiles — served alongside the rulebook so a vote can be
 * checked against its declared stance before it is cast, not rationalised
 * after.
 */
function postures() {
  return Object.entries(POSTURES).map(([id, p]) => ({
    node_id: Number(id), name: p.name, stance: p.stance,
    sensitive_to: p.sensitive_to, reason: p.reason,
  }));
}

// ---------------------------------------------------------------------------
// One node's vote
// ---------------------------------------------------------------------------

/**
 * @param {number} nodeId
 * @param {object} report  a constraint report from engine.evaluate()
 * @returns {{vote:'YES'|'NO', rule_id:string|null, reason:string, basis:string}}
 */
function nodeVote(nodeId, report) {
  const posture = POSTURES[nodeId] || { name: `node ${nodeId}`, stance: 'general safety', sensitive_to: [] };

  if (report.signal === SIGNAL.BLOCKED) {
    const b = report.blocking[0];
    return {
      vote: 'NO', rule_id: b.id, basis: 'HARD_VIOLATION',
      reason: `${b.id} ${b.title} — hard rule violated${b.waivable === false ? ' (non-negotiable)' : ''}`,
    };
  }

  if (report.signal === SIGNAL.UNRESOLVED) {
    const u = report.unevaluated[0];
    return {
      vote: 'NO', rule_id: u.id, basis: 'UNEVALUATED',
      reason: `${u.id} ${u.title} — not evaluated; this operator does not vote on an unknown`,
    };
  }

  const byId = new Map(report.rules.map((r) => [r.id, r]));
  for (const id of posture.sensitive_to) {
    const r = byId.get(id);
    if (!r) continue;
    if (r.state === STATE.VIOLATED) {
      return {
        vote: 'NO', rule_id: id, basis: 'OPERATOR_RED_LINE',
        reason: `${id} ${r.title} — ${posture.name} holds this as a red line (${posture.stance})`,
      };
    }
    if (r.state === STATE.WAIVED) {
      const who = (r.waiver && r.waiver.party) || 'another operator';
      return {
        vote: 'NO', rule_id: id, basis: 'WAIVER_NOT_ACCEPTED',
        reason: `${id} ${r.title} — waived by ${who}; ${posture.name} does not accept another party's exception`,
      };
    }
  }

  return {
    vote: 'YES', rule_id: null, basis: report.signal === SIGNAL.COMPLETE ? 'ALL_RULES_SATISFIED' : 'NO_RED_LINE_TOUCHED',
    reason: report.signal === SIGNAL.COMPLETE
      ? 'all applicable flight rules satisfied'
      : `no rule in ${posture.name}'s published sensitivities is violated`,
  };
}

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

/**
 * Run the go/no-go poll across the online nodes.
 *
 * @param {Array}  onlineNodes  [{ id, name, online }]
 * @param {object} report
 * @param {number} quorum
 */
function poll(onlineNodes, report, quorum = 3) {
  const votes = (onlineNodes || []).filter((n) => n && n.online !== false).map((n) => {
    const v = nodeVote(n.id, report);
    return {
      node_id: n.id,
      node_name: n.name || (POSTURES[n.id] && POSTURES[n.id].name) || `node ${n.id}`,
      vote: v.vote,
      rule_id: v.rule_id,
      basis: v.basis,
      reason: v.reason,
    };
  });

  const yes = votes.filter((v) => v.vote === 'YES').length;
  const approved = yes >= quorum;

  return {
    status: approved ? 'APPROVED' : 'DENIED',
    approved,
    votes,
    yes_count: yes,
    no_count: votes.length - yes,
    quorum,
    // Everything a reviewer needs to reproduce this outcome without running it.
    basis: {
      signal: report.signal,
      headline: report.headline,
      deterministic: true,
      note: 'Each vote is a pure function of the constraint report and the operator\'s published sensitivities. Re-running with the same inputs yields the identical result.',
    },
  };
}

// ---------------------------------------------------------------------------
// Emergency path
// ---------------------------------------------------------------------------

/**
 * Emergency override — the honest version.
 *
 * The old implementation set status APPROVED directly, with zero real votes,
 * and fabricated unanimous YES from whichever nodes happened to be online. That
 * contradicted the invariant formal/AstroMesh.tla proves:
 *
 *     APPROVED => Cardinality(votes) >= Quorum
 *
 * An emergency is a reason to accept known risk faster. It is not a reason to
 * skip the poll, and it is not a reason to cross a non-negotiable line.
 *
 * So: emergency generates automatic named waivers for the *waivable* hard rules
 * that are currently violated, then re-evaluates and runs a real poll. If a
 * non-negotiable rule is violated, it refuses — no override path exists.
 *
 * @returns {{allowed:boolean, waivers:Array, refused_by:Array, reason:string}}
 */
function emergencyWaivers(report, { party = 'EMERGENCY', reason = 'declared emergency', ts = null } = {}) {
  const nonNegotiable = report.blocking.filter((r) => r.waivable === false);
  if (nonNegotiable.length) {
    return {
      allowed: false,
      waivers: [],
      refused_by: nonNegotiable.map((r) => ({ id: r.id, title: r.title, detail: r.detail })),
      reason: `Emergency override refused. ${nonNegotiable.length} non-negotiable rule${nonNegotiable.length > 1 ? 's are' : ' is'} violated: `
        + nonNegotiable.map((r) => `${r.id} ${r.title}`).join('; ')
        + '. These rules have no override path — not for an emergency, not for the leader, not for anyone.',
    };
  }

  // Unevaluated rules cannot be waived either. An emergency does not create evidence.
  if (report.unevaluated.length) {
    return {
      allowed: false,
      waivers: [],
      refused_by: report.unevaluated.map((r) => ({ id: r.id, title: r.title, detail: r.detail })),
      reason: `Emergency override refused. ${report.unevaluated.length} rule${report.unevaluated.length > 1 ? 's have' : ' has'} not been evaluated: `
        + report.unevaluated.map((r) => `${r.id} ${r.title}`).join('; ')
        + '. An emergency is not evidence — obtain the missing inputs first.',
    };
  }

  const waivers = report.blocking.map((r) => ({
    rule_id: r.id, party, reason: `${reason} — auto-waived under emergency declaration`, ts,
  }));

  return {
    allowed: true,
    waivers,
    refused_by: [],
    reason: waivers.length
      ? `Emergency declared. ${waivers.length} waivable hard rule${waivers.length > 1 ? 's' : ''} auto-waived and recorded against ${party}. Quorum is still required.`
      : 'Emergency declared. No hard rules were violated; the poll proceeds normally.',
  };
}

module.exports = { nodeVote, poll, postures, emergencyWaivers, POSTURES };
