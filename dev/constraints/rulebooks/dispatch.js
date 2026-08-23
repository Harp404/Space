/**
 * Aircraft dispatch — FAA MMEL.   dev/constraints/rulebooks/dispatch.js
 * =============================================================================
 * WHY THIS RULEBOOK EXISTS
 *
 * The release-gate rulebook already shows the engine running a domain with no
 * space content. A fair reviewer notes that both are software, and that we may
 * simply have built a software gate twice.
 *
 * So here is a third domain with no software content either: whether an
 * aircraft may legally take off with something broken.
 *
 * It is the strongest available test of the claim, for three reasons:
 *
 *   1. It is NATIVELY four-state. The Minimum Equipment List does not answer
 *      yes/no. It answers: dispatch permitted; permitted with a placard, a
 *      proviso and a repair deadline; no dispatch; or the item is not listed
 *      and therefore not classified. Those are our four states, arrived at by
 *      an industry that has been doing this since the 1960s.
 *
 *   2. It CARRIES DEADLINES. Repair categories A/B/C/D are rectification
 *      intervals, so a dispatchable aircraft self-blocks at a computable
 *      instant. The same horizon machinery that says "FR-10 ages out in 6 h"
 *      says "this Category B item grounds the aircraft in 62 hours".
 *
 *   3. It is REGULATED AND REAL. This is not an analogy we invented; it is a
 *      structure in daily use, defined in FAA Policy Letter PL-25.
 *
 * SCOPE — READ THIS BEFORE QUOTING ANYTHING
 *
 * This encodes the PL-25 category structure and a SMALL, ILLUSTRATIVE set of
 * items. It is not an operator's MEL, it is not approved by anybody, and the
 * real system has a Master-MEL-to-operator-MEL derivation step we do not model.
 * We are demonstrating that the engine is domain-free, not shipping a dispatch
 * tool. Saying so plainly is cheaper than being caught not saying it.
 *
 * Source: FAA Policy Letter PL-25, Revision 24 (draft)
 *   https://www.faa.gov/aircraft/draft_docs/mmelpl/PL-25_Rev_24_Draft.pdf
 *
 * ZERO ENGINE CHANGES. Same evaluate(), same four states, same precedence.
 * =============================================================================
 */

'use strict';

const { R } = require('../engine.js');

/**
 * PL-25 rectification intervals. Category A is per-item — the MMEL states the
 * interval in its Remarks column rather than fixing one globally — so it is
 * modelled as such rather than given an invented number.
 */
const CATEGORY = {
  A: { id: 'A', hours: null, label: 'as specified in the item remarks' },
  B: { id: 'B', hours: 3 * 24, label: '3 consecutive calendar days' },
  C: { id: 'C', hours: 10 * 24, label: '10 consecutive calendar days' },
  D: { id: 'D', hours: 120 * 24, label: '120 consecutive calendar days' },
};

/** Evidence a dispatcher can actually obtain, with what it costs to get. */
const EV = {
  MEL_LOOKUP:  { id: 'mel-lookup',   label: 'MMEL entry for the affected item', cost: 5,  unit: 'min' },
  MAINT_SIGN:  { id: 'maint-signoff', label: 'maintenance sign-off of the (M) procedure', cost: 45, unit: 'min' },
  OPS_PROC:    { id: 'ops-proc',     label: 'flight-crew acknowledgement of the (O) procedure', cost: 10, unit: 'min' },
  PLACARD:     { id: 'placard',      label: 'placard fitted and logged', cost: 10, unit: 'min' },
  DEFER_LOG:   { id: 'defer-log',    label: 'deferral entry with the discovery time', cost: 5, unit: 'min' },
  WX_BRIEF:    { id: 'wx-brief',     label: 'route weather and alternates briefing', cost: 15, unit: 'min' },
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** When does the rectification interval expire? */
function repairDeadline(ctx) {
  const d = ctx.defect || {};
  const cat = CATEGORY[String(d.category || '').toUpperCase()];
  const found = num(d.discovered_ms);
  if (!cat || found === null) return null;
  const hours = cat.hours ?? num(d.remarks_interval_h);
  if (hours === null) return null;
  return found + hours * 3600000;
}

const dispatchRulebook = {
  id: 'dispatch',
  domain: 'aircraft dispatch (FAA MMEL)',
  title: 'Minimum Equipment List dispatch gate',
  summary: 'Whether an aircraft may be released to service with an inoperative item.',
  rules: [

    // ---- the item must be listed at all -------------------------------
    {
      id: 'MEL-01', key: 'LISTED', title: 'The inoperative item is listed in the MEL',
      waivable: false,
      authority: '14 CFR 121.628 / PL-25 — relief exists only for listed items',
      requirement: 'An inoperative item must appear in the approved MEL for relief to exist.',
      rationale: 'If an item is not listed, there is no approved relief and the aircraft is not airworthy with it inoperative. This is the cleanest non-negotiable in aviation: absence of permission is not permission.',
      resolvedBy: [EV.MEL_LOOKUP],
      evaluate(ctx) {
        const d = ctx.defect || {};
        if (d.listed === undefined || d.listed === null) {
          return R.unknown('the MEL has not been consulted for this item', ['mel-lookup']);
        }
        if (d.listed === false) {
          return R.fail('the item is not listed in the MEL, so no relief exists', `${d.item || 'item'} not listed`, 'must appear in the approved MEL');
        }
        return R.pass('the item is listed and relief exists', `${d.item || 'item'} listed`, 'must appear in the approved MEL');
      },
    },

    // ---- rectification interval ---------------------------------------
    {
      id: 'MEL-02', key: 'INTERVAL', title: 'Rectification interval has not expired',
      waivable: false,
      authority: 'PL-25 repair categories A / B (3 days) / C (10 days) / D (120 days)',
      requirement: 'The deferral must be within its category interval, counted from discovery.',
      rationale: 'A repair interval is the whole reason a deferral is legal. It converts "broken" into "broken, and it will be fixed by a date" — which is a completion signal with a deadline attached, and exactly why this rulebook composes with the horizon machinery.',
      resolvedBy: [EV.DEFER_LOG, EV.MEL_LOOKUP],
      // The hook that makes the countdown work — same one the orbital rules use.
      deadline: (ctx) => repairDeadline(ctx),
      evaluate(ctx) {
        // The engine passes only the context — deliberately, so a rule cannot
        // reach for ambient state. Time therefore has to arrive as data, which
        // is also what makes these rules reproducible in a test.
        const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
        const d = ctx.defect || {};
        const cat = CATEGORY[String(d.category || '').toUpperCase()];
        if (!cat) return R.unknown('no repair category recorded for this deferral', ['mel-lookup']);
        if (num(d.discovered_ms) === null) {
          return R.unknown('the discovery time is not recorded, so the interval cannot be counted', ['defer-log']);
        }
        const due = repairDeadline(ctx);
        if (due === null) {
          return R.unknown(`category ${cat.id} takes its interval from the item remarks, which are not recorded`, ['mel-lookup']);
        }
        const leftH = (due - now) / 3600000;
        const actual = leftH >= 0 ? `${leftH.toFixed(1)} h remaining of category ${cat.id}` : `expired ${Math.abs(leftH).toFixed(1)} h ago`;
        const limit = `category ${cat.id} — ${cat.label}`;
        if (leftH < 0) return R.fail('the rectification interval has expired; the aircraft is grounded until repair', actual, limit);
        return R.pass('within the rectification interval', actual, limit);
      },
    },

    // ---- the (M) proviso ------------------------------------------------
    {
      id: 'MEL-03', key: 'MAINT-PROC', title: '(M) maintenance procedure completed',
      waivable: false,
      authority: 'PL-25 — (M) denotes a required maintenance procedure',
      requirement: 'Where the MEL entry carries (M), the maintenance procedure must be accomplished and signed.',
      rationale: 'An (M) proviso is not advisory. Dispatching without it means the aircraft is outside the configuration the relief was granted for, so the relief does not apply.',
      resolvedBy: [EV.MAINT_SIGN],
      evaluate(ctx) {
        const d = ctx.defect || {};
        if (!d.proviso_m) return R.na('this MEL entry carries no (M) proviso');
        if (d.maint_signoff === undefined) return R.unknown('the (M) procedure has not been signed off', ['maint-signoff']);
        return d.maint_signoff
          ? R.pass('(M) procedure accomplished and signed', 'signed', 'required when (M) applies')
          : R.fail('the (M) maintenance procedure has not been accomplished', 'not signed', 'required when (M) applies');
      },
    },

    // ---- the (O) proviso ------------------------------------------------
    {
      id: 'MEL-04', key: 'OPS-PROC', title: '(O) operations procedure acknowledged',
      waivable: true,
      authority: 'PL-25 — (O) denotes a required operations procedure',
      requirement: 'Where the MEL entry carries (O), the flight crew must acknowledge the procedure.',
      rationale: 'The crew has to know what changes about how they fly the aeroplane. This is waivable in our model only because acknowledgement can be given verbally and logged after — the procedure itself is not optional.',
      resolvedBy: [EV.OPS_PROC],
      evaluate(ctx) {
        const d = ctx.defect || {};
        if (!d.proviso_o) return R.na('this MEL entry carries no (O) proviso');
        if (d.crew_ack === undefined) return R.unknown('the flight crew has not acknowledged the (O) procedure', ['ops-proc']);
        return d.crew_ack
          ? R.pass('(O) procedure acknowledged by the crew', 'acknowledged', 'required when (O) applies')
          : R.fail('the (O) operations procedure has not been acknowledged', 'not acknowledged', 'required when (O) applies');
      },
    },

    // ---- placarding -----------------------------------------------------
    {
      id: 'MEL-05', key: 'PLACARD', title: 'Inoperative item is placarded',
      waivable: true,
      authority: '14 CFR 121.628(a)(3) — inoperative items must be placarded',
      requirement: 'The inoperative item must be placarded to inform the crew.',
      rationale: 'A placard is how the deferral survives a crew change. Without it the next crew does not know the item is inoperative, and the deferral exists only in paperwork.',
      resolvedBy: [EV.PLACARD],
      evaluate(ctx) {
        const d = ctx.defect || {};
        if (d.placarded === undefined) return R.unknown('placarding has not been confirmed', ['placard']);
        return d.placarded
          ? R.pass('item placarded and logged', 'placarded', 'required for every deferred item')
          : R.fail('the inoperative item is not placarded', 'not placarded', 'required for every deferred item');
      },
    },

    // ---- operational conditions ----------------------------------------
    {
      id: 'MEL-06', key: 'CONDITIONS', title: 'Route conditions permit dispatch with this item',
      waivable: true,
      authority: 'MEL provisos frequently restrict route, weather or equipment redundancy',
      requirement: 'Dispatch conditions attached to the MEL entry must be met for this route.',
      rationale: 'Relief is often conditional — day only, no known icing, not ETOPS. A conditional pass is the honest shape of a great many real dispatch decisions, and it is why this domain needs PARTIAL and not just yes/no.',
      resolvedBy: [EV.WX_BRIEF],
      evaluate(ctx) {
        const d = ctx.defect || {};
        const f = ctx.flight || {};
        const conds = d.conditions || [];
        if (!conds.length) return R.na('this entry attaches no operational conditions');
        if (f.briefed === undefined) return R.unknown('the route has not been briefed against the MEL conditions', ['wx-brief']);
        const broken = conds.filter((c) => f[c.key] !== c.required);
        if (!broken.length) {
          return R.pass('all attached dispatch conditions are met', conds.map((c) => c.key).join(', '), 'all conditions met');
        }
        return R.fail(`dispatch conditions not met: ${broken.map((c) => c.key).join(', ')}`, broken.map((c) => `${c.key}=${f[c.key]}`).join(', '), 'all conditions met');
      },
    },
  ],
};

/**
 * What each acquisition supplies. Same contract as the other rulebooks, so the
 * recourse engine works here with no special-casing.
 */
function supplyEvidence(context, ids) {
  const c = JSON.parse(JSON.stringify(context || {}));
  c.defect = c.defect || {};
  c.flight = c.flight || {};
  if (ids.has('mel-lookup')) {
    if (c.defect.listed === undefined) c.defect.listed = true;
    if (!c.defect.category) c.defect.category = 'C';
  }
  if (ids.has('maint-signoff')) c.defect.maint_signoff = true;
  if (ids.has('ops-proc')) c.defect.crew_ack = true;
  if (ids.has('placard')) c.defect.placarded = true;
  if (ids.has('defer-log') && c.defect.discovered_ms === undefined) {
    c.defect.discovered_ms = Date.now();
  }
  if (ids.has('wx-brief')) c.flight.briefed = true;
  return c;
}

const DAY = 86400000;

/**
 * Scenarios store an OFFSET, not a timestamp.
 *
 * Baking `Date.now()` into a fixture at module load makes every downstream
 * assertion drift with the clock — a countdown test computed against a fixed
 * evaluation time was out by eleven hours purely because the module had been
 * loaded earlier. Offsets resolved against the evaluation clock are
 * reproducible.
 */
function at(context, now) {
  const c = JSON.parse(JSON.stringify(context));
  if (c.defect && Number.isFinite(c.defect.discovered_h_ago)) {
    c.defect.discovered_ms = now - c.defect.discovered_h_ago * 3600000;
  }
  c.now = now;
  return c;
}

/** Scenarios that reach all four states, on a domain with no software in it. */
const SCENARIOS = {
  clean: {
    label: 'Cabin reading light inoperative (Category D)',
    context: {
      defect: { item: 'Passenger reading light', listed: true, category: 'D',
        discovered_h_ago: 72, placarded: true, proviso_m: false, proviso_o: false },
      flight: { briefed: true },
    },
  },
  not_looked_up: {
    label: 'Item deferred, MEL never consulted',
    context: { defect: { item: 'APU generator' }, flight: {} },
  },
  not_listed: {
    label: 'Item not in the MEL at all',
    context: {
      defect: { item: 'Rudder trim actuator', listed: false, category: 'C',
        discovered_h_ago: 24, placarded: true },
      flight: { briefed: true },
    },
  },
  interval_expired: {
    label: 'Category B item, four days old',
    context: {
      defect: { item: 'Anti-skid system', listed: true, category: 'B',
        discovered_h_ago: 96, placarded: true, proviso_m: true, maint_signoff: true },
      flight: { briefed: true },
    },
  },
  awaiting_crew_ack: {
    label: '(O) procedure not yet acknowledged',
    context: {
      defect: { item: 'One pack inoperative', listed: true, category: 'C',
        discovered_h_ago: 48, placarded: true, proviso_o: true },
      flight: { briefed: true },
    },
  },
  condition_broken: {
    label: 'Day-only relief, night departure',
    context: {
      defect: { item: 'Landing light', listed: true, category: 'C',
        discovered_h_ago: 24, placarded: true,
        conditions: [{ key: 'daylight', required: true }] },
      flight: { briefed: true, daylight: false },
    },
  },
};

module.exports = { dispatchRulebook, supplyEvidence, SCENARIOS, CATEGORY, EV, at };
