/**
 * Live delegate consensus.        dev/constraints/delegates.js
 * =============================================================================
 * WHAT THIS IS FOR
 *
 * The consensus vote has always been the weakest part of the story to tell,
 * because four simulated agencies voting in a loop looks like a loop. So this
 * lets REAL PEOPLE be the delegates: they scan a code, pick an agency, and
 * vote from their own phone while the maneuver is on screen.
 *
 * THE POINT IS NOT THE VOTING. IT IS WHAT THE VOTE CANNOT DO.
 *
 * A room of humans can reach unanimous YES and the maneuver still will not be
 * authorised, because the constraint gate arbitrates first and a non-negotiable
 * rule has no waiver path. That is the whole thesis, made physical:
 *
 *     consensus decides WHETHER TO ACT
 *     constraints decide WHETHER ACTING IS PERMITTED
 *
 * and the second is not a vote. This module therefore never returns an
 * authorisation of its own — it returns a tally, and the gate decides what the
 * tally is allowed to mean.
 *
 * DESIGN NOTES
 *
 * * No database. A session is in-memory and dies with the process, because a
 *   demo that depends on persistence has one more thing to fail on stage.
 * * No auth. Delegates are identified by an unguessable token issued at join.
 *   This is a demo instrument, not an election system, and it says so.
 * * Simulated delegates remain available and are clearly labelled, so the demo
 *   works with zero phones in the room — the failure mode of "nobody scanned"
 *   must not be fatal.
 *
 * Zero dependencies. Deterministic where it can be.
 * =============================================================================
 */

'use strict';

const crypto = require('crypto');

// The agencies a delegate may speak for. Postures mirror voting.js so a human
// delegate and a simulated one are answering the same question.
const AGENCIES = [
  { id: 'ISRO',   label: 'ISRO',   cares: ['FR-10', 'FR-09'] },
  { id: 'ESA',    label: 'ESA',    cares: ['FR-11', 'FR-12'] },
  { id: 'JAXA',   label: 'JAXA',   cares: ['FR-10', 'FR-12'] },
  { id: 'SPACEX', label: 'SpaceX', cares: ['FR-04', 'FR-09'] },
];

const VOTES = ['YES', 'NO', 'ABSTAIN'];

class DelegateSession {
  constructor({ quorum = 3 } = {}) {
    this.id = crypto.randomBytes(4).toString('hex');
    this.opened_at = Date.now();
    this.quorum = quorum;
    this.delegates = new Map();     // token -> delegate
    this.subject = null;            // what is being voted on
    this.closed = false;
  }

  /** Open a vote on a specific proposal. Clears any previous ballots. */
  openVote(subject) {
    this.subject = subject;
    this.closed = false;
    for (const d of this.delegates.values()) { d.vote = null; d.reason = null; d.voted_at = null; }
    return this.state();
  }

  join({ name, agency }) {
    const a = AGENCIES.find((x) => x.id === String(agency || '').toUpperCase());
    const token = crypto.randomBytes(12).toString('base64url');
    const d = {
      token,
      id: crypto.randomBytes(3).toString('hex'),
      name: String(name || '').slice(0, 24) || 'Delegate',
      agency: a ? a.id : AGENCIES[this.delegates.size % AGENCIES.length].id,
      simulated: false,
      vote: null, reason: null, voted_at: null,
      joined_at: Date.now(),
    };
    this.delegates.set(token, d);
    return d;
  }

  cast({ token, vote, reason }) {
    const d = this.delegates.get(token);
    if (!d) return { ok: false, reason: 'unknown delegate — rejoin from the code' };
    if (this.closed) return { ok: false, reason: 'the vote is closed' };
    const v = String(vote || '').toUpperCase();
    if (!VOTES.includes(v)) return { ok: false, reason: `vote must be one of ${VOTES.join(', ')}` };
    d.vote = v;
    d.reason = String(reason || '').slice(0, 140) || null;
    d.voted_at = Date.now();
    return { ok: true, delegate: this.publicDelegate(d) };
  }

  /** Fill empty seats with clearly-labelled simulated delegates. */
  seatSimulated(votes) {
    for (const [agency, vote] of Object.entries(votes || {})) {
      const token = `sim:${agency}`;
      this.delegates.set(token, {
        token, id: `sim-${agency.toLowerCase()}`,
        name: `${agency} (simulated)`, agency,
        simulated: true,
        vote, reason: 'posture-driven simulated delegate',
        voted_at: Date.now(), joined_at: Date.now(),
      });
    }
    return this.state();
  }

  clearSimulated() {
    for (const t of [...this.delegates.keys()]) {
      if (t.startsWith('sim:')) this.delegates.delete(t);
    }
  }

  publicDelegate(d) {
    // never leak the token
    const { token, ...rest } = d;
    return rest;
  }

  tally() {
    const rows = [...this.delegates.values()];
    const counts = { YES: 0, NO: 0, ABSTAIN: 0, PENDING: 0 };
    for (const d of rows) counts[d.vote || 'PENDING']++;
    const cast = counts.YES + counts.NO + counts.ABSTAIN;
    return {
      counts,
      seated: rows.length,
      cast,
      human: rows.filter((d) => !d.simulated).length,
      quorum: this.quorum,
      quorum_met: cast >= this.quorum,
      // The tally's OPINION. Deliberately not called a decision — the gate
      // decides, and it may refuse this outright.
      consensus: counts.YES > counts.NO ? 'FAVOURS_ACTION'
        : counts.NO > counts.YES ? 'OPPOSES_ACTION' : 'SPLIT',
      unanimous_yes: cast > 0 && counts.YES === cast,
    };
  }

  state() {
    return {
      session: this.id,
      opened_at: this.opened_at,
      closed: this.closed,
      subject: this.subject,
      agencies: AGENCIES.map((a) => ({ id: a.id, label: a.label, cares: a.cares })),
      delegates: [...this.delegates.values()]
        .sort((a, b) => a.joined_at - b.joined_at)
        .map((d) => this.publicDelegate(d)),
      tally: this.tally(),
      note: 'A tally is not an authorisation. The constraint gate arbitrates, and non-negotiable rules have no waiver path.',
    };
  }

  close() { this.closed = true; return this.state(); }
}

/**
 * Combine a human tally with a constraint report.
 *
 * This is the function the whole feature exists for. Read the order: the gate
 * is consulted FIRST, and if it refuses, the vote is recorded and overridden.
 * Unanimity does not enter into it.
 */
function arbitrate(tally, report) {
  const gateAuthorises = !!(report && report.authorised);
  const blockers = (report && report.rules || [])
    .filter((r) => r.state === 'VIOLATED' && r.waivable === false)
    .map((r) => ({ id: r.id, title: r.title }));
  const unknowns = (report && report.rules || [])
    .filter((r) => r.state === 'UNEVALUATED')
    .map((r) => ({ id: r.id, title: r.title }));

  let outcome, because;
  if (!gateAuthorises && blockers.length) {
    outcome = 'REFUSED';
    because = `${blockers.length} non-negotiable rule${blockers.length > 1 ? 's' : ''} violated — no waiver path exists`;
  } else if (!gateAuthorises && unknowns.length) {
    outcome = 'REFUSED';
    because = `${unknowns.length} rule${unknowns.length > 1 ? 's' : ''} could not be evaluated — unknown is not a pass`;
  } else if (!tally.quorum_met) {
    outcome = 'PENDING';
    because = `quorum not met (${tally.cast}/${tally.quorum} ballots cast)`;
  } else if (tally.consensus !== 'FAVOURS_ACTION') {
    outcome = 'DECLINED';
    because = 'the delegates did not favour action';
  } else {
    outcome = 'APPROVED';
    because = 'the gate permits it and the delegates favour it';
  }

  return {
    outcome, because,
    signal: report ? report.signal : null,
    gate_authorises: gateAuthorises,
    blockers, unknowns,
    tally,
    // The line that makes the point, ready for the UI to display verbatim.
    overridden: outcome === 'REFUSED' && tally.consensus === 'FAVOURS_ACTION',
    override_note: (outcome === 'REFUSED' && tally.unanimous_yes)
      ? 'Every delegate voted YES. The maneuver is still refused: a non-negotiable constraint is not subject to a vote.'
      : null,
  };
}

module.exports = { DelegateSession, arbitrate, AGENCIES, VOTES };
