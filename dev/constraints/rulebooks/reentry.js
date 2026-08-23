/**
 * Re-entry / disposal flight rules.   dev/constraints/rulebooks/reentry.js
 * =============================================================================
 * The rulebook a controlled deorbit must clear. Same engine, same four states,
 * different body of work — which is the point: the capability is the rulebook
 * plus the signal, not anything specific to conjunctions.
 *
 * Shares FR-00 (self-audit), FR-08 (quorum) and FR-21 (drag model validity) with
 * the maneuver rulebook, because those govern any orbital decision.
 *
 * Authorities
 *   NASA-STD-8719.14   casualty expectancy < 1e-4
 *   SSC 5.d            re-entry residual casualty risk < 0.0001 per spacecraft
 *   SSC 8.j / COLA     screening of the descent path
 *   Starlink practice  target open ocean, away from populated islands and
 *                      heavily trafficked airline and maritime routes
 *   Wright/Boley/Byers, "Airspace closures due to reentering space objects",
 *                      Scientific Reports 2025 — 26%/yr chance a busy airspace
 *                      region is disrupted by an uncontrolled re-entry
 * =============================================================================
 */

'use strict';

const ground = require('../dense-ground.js');

const { CLASS, R } = require('../engine');
const { shared, LIMITS: ORB, EV } = require('./orbital');
const RE = require('../reentry');

const LIMITS = {
  EC_MAX: RE.LIMITS.EC_MAX,                       // 1e-4
  FOOTPRINT_MAX_KM: RE.LIMITS.FOOTPRINT_MAX_KM,   // beyond this we cannot characterise it
  AIR_TRAFFIC_ALERT: RE.LIMITS.AIR_TRAFFIC_ALERT,
  // A footprint we have not characterised over most of its extent cannot be
  // used to clear a deorbit — that is an unknown, not a low number.
  MIN_CHARACTERISED_FRACTION: 0.6,
  RECOVERY_DAYLIGHT_ONLY: true,
};

const EV_RE = {
  FOOTPRINT:   { id: 'reentry-footprint', label: 'run the Monte Carlo re-entry footprint', cost: 15, unit: 's' },
  CASUALTY_AREA: { id: 'casualty-area',   label: 'published debris casualty area for this bus', cost: 1, unit: 'h' },
  GROUND_CHAR: { id: 'ground-raster',     label: 'characterise the ground under the corridor (imagery)', cost: 1, unit: 'h' },
  RECOVERY:    { id: 'recovery-window',   label: 'confirm the licensed recovery range and window', cost: 2, unit: 'h' },
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------------------------------------------------------------------------

const REENTRY_RULES = [
  shared.FR_00,

  {
    id: 'FR-22', key: 'DESCENT-COLA', title: 'Descent screened through the shells',
    class: CLASS.HARD, waivable: false,          // non-negotiable
    authority: 'COLA screening · IADC / ISO 24113 debris-generation prevention',
    requirement: 'The descent path must be screened against the catalogue and be clear all the way down.',
    rationale: 'A deorbiting satellite crosses every shell beneath it, and those shells are occupied. SpaceX is lowering thousands of satellites from 550 km to 480 km through 2026 — they descend through traffic to get there. Generating debris on the way down would be the worst possible outcome of a disposal, so there is no waiver.',
    resolvedBy: [EV.PLAN],
    evaluate(ctx) {
      const d = ctx.descent;
      if (!d) return R.unknown('descent path not screened yet', ['descent']);
      const n = Array.isArray(d.conjunctions) ? d.conjunctions.length : null;
      if (n === null) return R.unknown('descent screening returned no result', ['descent.conjunctions']);
      const actual = `${n} conjunction(s) on descent · ${d.screened ?? '?'} objects screened`;
      if (n === 0) return R.pass('descent path is clear of the catalogue', actual, '0 conjunctions');
      return R.fail('the descent path passes through occupied space — this rule cannot be waived', actual, '0 conjunctions');
    },
  },

  {
    id: 'FR-17a', key: 'CASUALTY-EXPECTANCY', title: 'Ground casualty expectancy within the legal limit',
    class: CLASS.HARD, waivable: false,          // non-negotiable — regulatory
    authority: `NASA-STD-8719.14 · SSC 5.d — Ec < ${LIMITS.EC_MAX}`,
    requirement: `Expected casualties Ec = A_c × PD must be below ${LIMITS.EC_MAX}.`,
    rationale: 'This is the number the FAA and SpaceX publicly disagree about — the FAA projected 0.6 casualties a year from Starlink re-entries by 2035; SpaceX called that preposterous. Neither side shows its working. We compute it exactly per the standard, over an actual Monte Carlo footprint rather than a latitude-band average, and show every input. It is a legal limit on human life, so there is no override.',
    resolvedBy: [EV_RE.FOOTPRINT, EV_RE.CASUALTY_AREA],
    evaluate(ctx) {
      const rr = ctx.reentry;
      if (!rr) return R.unknown('no deorbit plan on record', ['reentry']);
      if (!rr.footprint) return R.unknown('re-entry footprint not computed', ['reentry.footprint']);
      if (rr.footprint.unresolved) return R.unknown(rr.footprint.reason, ['spaceWeather.kp']);

      // A footprint we could not characterise over most of its extent cannot
      // clear a deorbit. Zero measured population is not the same as zero people.
      const chf = num(rr.footprint.characterised_fraction);
      if (chf !== null && chf < LIMITS.MIN_CHARACTERISED_FRACTION && rr.footprint.mean_population_density === 0) {
        return R.unknown(
          `only ${(chf * 100).toFixed(0)}% of the footprint is characterised ground — an uncharacterised corridor is an unknown, not an empty one`,
          ['ground-raster'],
        );
      }
      if (rr.footprint.span_km > LIMITS.FOOTPRINT_MAX_KM) {
        return R.unknown(`footprint spans ${Math.round(rr.footprint.span_km)} km — too dispersed to characterise; wait for a better atmospheric forecast`, ['spaceWeather.kp']);
      }
      if (!rr.casualty) return R.unknown('debris casualty area not declared for this bus — published survivability data required', ['casualty-area']);

      const ec = num(rr.casualty.ec);
      if (ec === null) return R.unknown('casualty expectancy could not be computed', ['reentry.casualty']);
      const actual = `Ec ${ec.toExponential(2)} · A_c ${rr.casualty.casualty_area_m2} m² · PD ${rr.casualty.mean_population_density_per_km2}/km²`;
      const limit = `< ${LIMITS.EC_MAX}`;
      if (ec < LIMITS.EC_MAX) return R.pass('within the regulatory casualty limit', actual, limit);
      return R.fail(`expected casualties exceed the legal limit by ${(ec / LIMITS.EC_MAX).toFixed(1)}×`, actual, limit);
    },
  },

  {
    id: 'FR-17b', key: 'CONSEQUENCE-CLASS', title: 'Corridor avoids critical infrastructure',
    class: CLASS.HARD, waivable: true,
    authority: 'Starlink stated practice — target open ocean, away from populated islands and heavily trafficked routes',
    requirement: 'The footprint must not cross critical infrastructure (airports, ports, industrial or power sites).',
    rationale: 'Casualty expectancy counts heads. It does not distinguish 400 people in suburbs from 400 people in an airport terminal next to a fuel farm. A hit on critical infrastructure causes cascading harm far beyond the headcount, so it is checked as a SEPARATE number — deliberately never folded into Ec, which must stay comparable to the figures regulators publish.',
    resolvedBy: [EV_RE.FOOTPRINT, EV_RE.GROUND_CHAR],
    evaluate(ctx) {
      const rr = ctx.reentry;
      if (!rr || !rr.consequence) return R.unknown('consequence profile not computed', ['reentry.consequence']);
      const cp = rr.consequence;
      if (cp.unknown_fraction >= 0.5) {
        return R.unknown(`${(cp.unknown_fraction * 100).toFixed(0)}% of the corridor is uncharacterised ground — we do not know what is underneath`, ['ground-raster']);
      }
      const crit = cp.critical_classes || [];

      // SUB-CELL REFINEMENT.
      // The raster answers per 55 km cell. DINOv3-SAT answers per 3.4 km, at a
      // measured 90.0% held-out accuracy, so a footprint clipping the edge of a
      // city is no longer scored the same as one centred on it.
      //
      // The layer refuses to answer above 60 degrees north, where its
      // correlation with population was measured at rho -0.04. Refusing is not
      // a failure mode here — a footprint we cannot characterise is UNEVALUATED,
      // and that is the honest answer.
      const mix = ground.footprintMix((rr.footprint && rr.footprint.points) || []);
      if (mix && mix.available && mix.coverage < 0.5) {
        return R.unknown(
          `only ${(mix.coverage * 100).toFixed(0)}% of the corridor falls on ground the imagery layer is validated for (${mix.outside_envelope} samples above its 60N envelope) — the consequence class cannot be established`,
          ['ground-raster', 'operator-survey'],
        );
      }

      const urban = ground.footprintUrbanisation((rr.footprint && rr.footprint.points) || []);

      let detail = cp.worst ? `worst: ${cp.worst.label} (${(cp.worst.fraction * 100).toFixed(1)}% of footprint)` : 'no class data';
      if (mix && mix.available) {
        detail += ` · ${(mix.built_fraction * 100).toFixed(1)}% built at ${mix.sub_cell_km} km (DINOv3, ${(mix.accuracy * 100).toFixed(0)}% held-out)`;
      }
      // Degree of urbanisation is a SEPARATE sourced attribute. It is never
      // folded into Ec — NASA-STD-8719.14 defines Ec without a sheltering term,
      // and inventing a coefficient would make the regulated number
      // incomparable to the ones regulators publish.
      if (urban) detail += ` · worst urbanisation: ${urban.worst}`;

      const limit = 'no critical infrastructure crossed';
      if (!crit.length) return R.pass('corridor avoids critical infrastructure', detail, limit);
      return R.fail(`corridor crosses ${crit.map((c) => c.label).join(', ')}`, detail, limit);
    },
  },

  {
    id: 'FR-23', key: 'AIRSPACE', title: 'Corridor clear of dense airspace',
    class: CLASS.HARD, waivable: true,
    authority: 'Wright, Boley & Byers, Scientific Reports 2025 · ICAO practice · Starlink stated practice',
    requirement: `The footprint must not cross airspace with more than ${LIMITS.AIR_TRAFFIC_ALERT} scheduled route crossings per cell.`,
    rationale: 'On 4 November 2022 Spain and France closed airspace because a Long March 5B was coming down and nobody could say where — 46 airports affected, over 300 flights delayed. The peer-reviewed figure is a 26% annual chance that a busy airspace region is disrupted this way, rising on both sides as reentries and flights both increase. This is the check that runs before the burn instead of after.',
    resolvedBy: [EV_RE.FOOTPRINT],
    evaluate(ctx) {
      const rr = ctx.reentry;
      if (!rr || !rr.footprint || rr.footprint.unresolved) return R.unknown('footprint not computed', ['reentry.footprint']);
      const air = num(rr.footprint.max_air_traffic);
      if (air === null) return R.unknown('air-traffic exposure not evaluated', ['reentry.footprint.max_air_traffic']);
      const actual = `peak ${air} scheduled route crossings in a footprint cell`;
      const limit = `<= ${LIMITS.AIR_TRAFFIC_ALERT}`;
      if (air <= LIMITS.AIR_TRAFFIC_ALERT) return R.pass('airspace exposure acceptable', actual, limit);
      return R.fail('corridor crosses dense scheduled airspace — coordinate an airspace reservation or retarget', actual, limit);
    },
  },

  {
    id: 'FR-24', key: 'MARITIME', title: 'Corridor clear of shipping lanes',
    class: CLASS.SOFT, waivable: true,
    authority: 'Starlink stated practice — away from heavily trafficked maritime routes',
    requirement: 'The footprint should avoid dense shipping traffic.',
    rationale: 'The standard casualty formula counts people on land. Targeting open ocean moves the risk to sea, where vessels still are. Operators state this constraint explicitly, so it belongs in the rulebook even while our data for it is incomplete — and an incomplete input reports as unevaluated rather than as clear water.',
    resolvedBy: [{ id: 'ais-density', label: 'AIS vessel-density grid', cost: 1, unit: 'h' }],
    evaluate(ctx) {
      const rr = ctx.reentry;
      if (!rr || !rr.footprint) return R.unknown('footprint not computed', ['reentry.footprint']);
      if (!rr.maritime) {
        return R.unknown('AIS vessel-density layer not loaded — maritime exposure is not characterised, which is not the same as clear water', ['ais-density']);
      }
      const d = num(rr.maritime.peak_density);
      if (d === null) return R.unknown('maritime density unavailable', ['reentry.maritime.peak_density']);
      return d <= (rr.maritime.limit ?? 50)
        ? R.pass('maritime exposure acceptable', `peak ${d}`, `<= ${rr.maritime.limit ?? 50}`)
        : R.fail('corridor crosses a dense shipping lane', `peak ${d}`, `<= ${rr.maritime.limit ?? 50}`);
    },
  },

  {
    id: 'FR-25', key: 'RECOVERY-WINDOW', title: 'Recovery window is available',
    class: CLASS.SOFT, waivable: true,
    authority: 'Licensed range availability — Varda / Southern Launch (Koonibba) practice',
    requirement: 'For a recoverable vehicle, a licensed range and an acceptable recovery window must be confirmed.',
    rationale: 'A returning capsule is only as good as the ability to retrieve it. Varda lands at a licensed range in South Australia and expects monthly cadence; the range, the window and the sea state are real constraints on when a deorbit can be commanded. Not applicable to a demisable satellite that is designed to burn up.',
    applies: (ctx) => {
      const rr = ctx.reentry;
      if (!rr) return null;                       // undecidable → unevaluated, honestly
      return rr.recoverable === true;
    },
    notApplicableDetail: 'demisable disposal — nothing is recovered',
    resolvedBy: [EV_RE.RECOVERY],
    evaluate(ctx) {
      const rr = ctx.reentry;
      if (!rr.recovery) return R.unknown('recovery window not confirmed with the range', ['recovery-window']);
      const r = rr.recovery;
      const actual = `${r.range || 'range'} · ${r.window || 'window'}${r.sea_state ? ` · sea state ${r.sea_state}` : ''}`;
      if (r.confirmed === true) return R.pass('licensed range and window confirmed', actual, 'confirmed window');
      if (r.confirmed === false) return R.fail('no recovery window available in the planned period', actual, 'confirmed window');
      return R.unknown('range has not confirmed', ['recovery-window']);
    },
  },

  shared.FR_08,
  shared.FR_21,
];

const reentryRulebook = {
  id: 'orbital-reentry',
  title: 'Controlled re-entry / disposal flight rules',
  domain: 'Space traffic coordination — the return leg',
  description: 'The rulebook a controlled deorbit must clear before it may be authorised.',
  rules: REENTRY_RULES,
};

module.exports = { reentryRulebook, LIMITS, EV_RE };
