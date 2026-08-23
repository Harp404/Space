/**
 * Propellant ledger.        dev/constraints/ledger.js
 * =============================================================================
 * Propellant is the hardest limit in orbit. It is strictly finite, cannot be
 * replenished, and every avoidance maneuver spends some of it permanently. An
 * asset that has spent its allocation cannot manoeuvre again, no matter how
 * urgent the next conjunction is.
 *
 * That makes it the cleanest demonstration of a non-negotiable requirement:
 * approve enough maneuvers on one asset and the system BLOCKS on a limit that
 * cannot be argued with, waived away, or escalated past.
 *
 * TWO BUDGETS, ONE TANK
 *
 *   ca_allocation      the collision-avoidance budget. Spendable.
 *   disposal_reserve   ring-fenced for controlled deorbit at end of mission.
 *                      Protected by FCC's 5-year rule and ISO 24113, and by
 *                      FR-05, which is non-negotiable.
 *
 * Spending the disposal reserve trades a probabilistic collision today for a
 * guaranteed derelict tomorrow. That is why FR-05 has no waiver path.
 *
 * HONESTY NOTE — READ THIS BEFORE CLAIMING ANYTHING
 *
 * No public feed of operator propellant state exists. In a real deployment the
 * operator declares it; here it is seeded deterministically from the object
 * name so the same asset shows the same history across restarts, and debited
 * for real whenever a maneuver is approved. Every record carries
 * `simulated: true` and a `source` string saying so, and the UI must surface
 * that. Consumption is real; the starting balance is declared.
 *
 * Zero dependencies. Deterministic.
 * =============================================================================
 */

'use strict';

const DEFAULTS = {
  CA_ALLOCATION_MS: 15,      // per-asset collision-avoidance allocation
  DISPOSAL_RESERVE_MS: 30,   // ring-fenced for end-of-life disposal
};

const SOURCE = 'operator-declared (simulated — no public propellant feed exists)';

/** Stable 32-bit hash so an asset's declared history survives a restart. */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

class PropellantLedger {
  /**
   * @param {object} opts
   * @param {number} opts.allocation       default CA allocation, m/s
   * @param {number} opts.reserve          default disposal reserve, m/s
   * @param {boolean} opts.seedHistory     seed a plausible declared spend history
   */
  constructor({ allocation = DEFAULTS.CA_ALLOCATION_MS, reserve = DEFAULTS.DISPOSAL_RESERVE_MS, seedHistory = true } = {}) {
    this.allocation = allocation;
    this.reserve = reserve;
    this.seedHistory = seedHistory;
    this.assets = new Map();
    this.burns = [];            // every debit, in order — the audit trail
  }

  /** Read (creating on first touch) the declared propellant state for an asset. */
  get(asset) {
    const name = String(asset || '').trim();
    if (!name) return null;
    if (!this.assets.has(name)) {
      // 0.00 - 13.99 m/s already spent this mission, stable per asset name.
      const used = this.seedHistory ? +(((hash(name) % 1400) / 100)).toFixed(2) : 0;
      this.assets.set(name, {
        asset: name,
        ca_allocation_ms: this.allocation,
        ca_used_ms: Math.min(used, this.allocation),
        disposal_reserve_ms: this.reserve,
        maneuvers: 0,
        simulated: true,
        source: SOURCE,
      });
    }
    const a = this.assets.get(name);
    return {
      ...a,
      ca_remaining_ms: +(a.ca_allocation_ms - a.ca_used_ms).toFixed(2),
    };
  }

  /**
   * Would this burn fit? Answers the two FR-04 / FR-05 questions without
   * mutating anything, so the constraint engine stays side-effect free.
   */
  check(asset, dvMs) {
    const state = this.get(asset);
    if (!state) return null;
    const need = Number(dvMs);
    if (!Number.isFinite(need)) return null;
    // A ledger that can be CREDITED is not a ledger. A negative or zero burn
    // would subtract from `ca_used_ms` and hand the asset propellant it has
    // already spent — so the spend direction is the only direction.
    if (need <= 0) return null;
    return {
      ...state,
      requested_ms: +need.toFixed(3),
      fits_allocation: need <= state.ca_remaining_ms,
      // Anything beyond the allocation can only come from the disposal reserve.
      would_touch_reserve: need > state.ca_remaining_ms,
      shortfall_ms: need > state.ca_remaining_ms ? +(need - state.ca_remaining_ms).toFixed(2) : 0,
    };
  }

  /**
   * Debit an approved maneuver. Refuses to touch the disposal reserve — the
   * ledger enforces FR-05 structurally, not just by policy, so a bug elsewhere
   * cannot spend it.
   */
  debit(asset, dvMs, meta = {}) {
    const c = this.check(asset, dvMs);
    if (!c) {
      const n = Number(dvMs);
      return {
        ok: false,
        reason: Number.isFinite(n) && n <= 0
          ? 'refused — a burn must be a positive Δv; propellant is spent, never credited'
          : 'unknown asset or invalid Δv',
      };
    }
    if (c.would_touch_reserve) {
      return {
        ok: false,
        reason: `refused — ${c.shortfall_ms} m/s short; this burn would draw on the ${c.disposal_reserve_ms} m/s disposal reserve, which is ring-fenced under FCC / ISO 24113`,
        state: c,
      };
    }
    const a = this.assets.get(c.asset);
    a.ca_used_ms = +(a.ca_used_ms + c.requested_ms).toFixed(2);
    a.maneuvers += 1;
    const record = {
      asset: c.asset,
      delta_v_ms: c.requested_ms,
      remaining_after_ms: +(a.ca_allocation_ms - a.ca_used_ms).toFixed(2),
      conjunction_id: meta.conjunction_id ?? null,
      ts: meta.ts ?? null,
    };
    this.burns.push(record);
    return { ok: true, record, state: this.get(c.asset) };
  }

  /** Every asset that has been touched, most-depleted first. */
  summary() {
    const rows = [...this.assets.keys()].map((k) => this.get(k));
    rows.sort((a, b) => a.ca_remaining_ms - b.ca_remaining_ms);
    return {
      assets: rows,
      total_burns: this.burns.length,
      total_dv_ms: +this.burns.reduce((s, b) => s + b.delta_v_ms, 0).toFixed(2),
      // Assets that can no longer fund a routine avoidance burn (0.1 - 1 m/s).
      exhausted: rows.filter((r) => r.ca_remaining_ms < 1).map((r) => r.asset),
      simulated: true,
      source: SOURCE,
    };
  }

  /** Restore a known state — used by the replay scenarios so they are reproducible. */
  seed(asset, { used_ms = 0, allocation_ms, reserve_ms } = {}) {
    const name = String(asset || '').trim();
    if (!name) return null;
    this.assets.set(name, {
      asset: name,
      ca_allocation_ms: allocation_ms ?? this.allocation,
      ca_used_ms: used_ms,
      disposal_reserve_ms: reserve_ms ?? this.reserve,
      maneuvers: 0,
      simulated: true,
      source: SOURCE,
    });
    return this.get(name);
  }

  reset() { this.assets.clear(); this.burns.length = 0; }
}

module.exports = { PropellantLedger, DEFAULTS };
