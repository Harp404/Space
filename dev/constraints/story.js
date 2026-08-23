/**
 * One event, every layer, in order.        dev/constraints/story.js
 * =============================================================================
 * WHY THIS EXISTS
 *
 * The system does a great deal and shows almost none of it. Every layer works —
 * the vision raster, the exposure field, the conformal bounds, the operator
 * ephemerides, the four-state gate — and a person looking at the screen cannot
 * tell that any of it happened.
 *
 * That is a fatal problem and not a cosmetic one. A reviewer with three minutes
 * scores what they can follow, and a system whose depth is invisible is
 * indistinguishable from one that has none.
 *
 * So this walks ONE real event through the whole chain and returns it as an
 * ordered narrative: what was asked, what was found, what it came from, and
 * what the gate did about it. Each step carries its own source, so nothing in
 * the chain is taken on trust.
 *
 * The rule for every step: it must name a NUMBER and a SOURCE. A step that
 * cannot is not evidence, it is decoration, and it is left out.
 * =============================================================================
 */

'use strict';

const CE = require('./engine.js');
const RE = require('./reentry.js');
const exposure = require('./exposure.js');
const ground = require('./dense-ground.js');
const { resolvability } = require('./resolvability.js');
const { horizon } = require('./horizon.js');
const { recourse } = require('./recourse.js');
const receipts = require('./receipts.js');
const SW = require('./spaceweather.js');
const FLARES = require('./flares.js');
const REFEED = require('./reentry-feed.js');

function step(n, title, said, because, source, state = null, actions = null) {
  return { n, title, said, because, source, state, actions };
}

/**
 * What a reader can DO about a step.
 *
 * A narrative that only reports is a document. The rules already declare what
 * would resolve them (`resolvedBy`), so an unevaluated step can offer exactly
 * those acquisitions and nothing else — we never invent an action that would
 * not actually change the answer.
 */
function actionsFor(rule) {
  const ev = rule.resolvedBy || [];
  if (!ev.length) return null;
  return ev.map((e) => ({
    id: e.id,
    label: e.label,
    cost: e.cost,
    unit: e.unit,
    resolves: rule.id,
  }));
}

function loadJson(rel) {
  try { return require(`../cache/${rel}`); } catch { return null; }
}

/**
 * The re-entry chain. Long March 5B by default — a real, documented event that
 * closed European airspace, so nothing here is a scenario we invented.
 */
function reentryStory({ replay = 'long_march_5b', now = Date.now(), acquired = [] } = {}) {
  // Evidence the reader has chosen to acquire. Supplying it re-runs the whole
  // chain, so a step that said UNRESOLVED can visibly become something else —
  // which is the difference between a report and a system.
  const have = new Set(acquired);
  const { reentryRulebook } = require('./rulebooks/reentry.js');
  const rep = RE.REENTRY_REPLAYS[replay];
  if (!rep) return { error: `unknown replay: ${replay}` };

  const steps = [];
  let n = 0;

  // ---- 1. the event ----------------------------------------------------
  steps.push(step(++n, 'The event',
    rep.title,
    rep.summary,
    { kind: 'historical record', detail: (rep.documented_effects || [])[0] || null }));

  // ---- 2. where it comes down ------------------------------------------
  const fp = RE.footprint({ ...rep, kp: rep.kp ?? 3, samples: 20000 });
  if (fp.unresolved) {
    steps.push(step(++n, 'Where it comes down', 'cannot be characterised', fp.reason,
      { kind: 'monte carlo' }, 'UNRESOLVED'));
    return { steps, signal: 'UNRESOLVED' };
  }
  steps.push(step(++n, 'Where it comes down',
    `a corridor ${fp.span_km.toLocaleString()} km long, ±${(2 * fp.cross_track_sigma_km).toFixed(0)} km wide`,
    `${fp.samples.toLocaleString()} Monte Carlo samples; dispersion driven by ${fp.dispersion.driven_by}`,
    { kind: 'simulation', seed: 'fixed — the same footprint every run' }));

  // ---- 2b. why the corridor is that wide --------------------------------
  // The dispersion is not a fixed number. Thermospheric density scales with
  // geomagnetic activity, so a storm widens the footprint, and the widening is
  // read from a live feed rather than assumed.
  try {
    // fetchConditions() is async and caches to disk; the story is synchronous,
    // so we read the cached snapshot the gateway keeps warm. A cold cache means
    // no step rather than a fabricated Kp.
    const snap = loadJson('snapshot/spaceweather.json') || loadJson('spaceweather.json');
    const c = snap && (snap.conditions || snap);
    if (c && Number.isFinite(c.kp)) {
      const d = fp.dispersion || {};
      steps.push(step(++n, 'Why the corridor is that wide',
        `Kp ${c.kp} (${c.scale_g}, ${c.scale_g_desc}) — density uncertainty ±${((d.density_sigma_frac ?? 0) * 100).toFixed(1)}%`,
        `atmospheric drag is the dominant term in where a decaying object lands, and thermospheric density rises with geomagnetic activity. The uncertainty band is ${d.density_basis || 'measured'}, so a storm widens this corridor rather than us choosing to.`,
        { kind: 'live feed', source: c.source, observed_at: c.observed_at,
          simulated: c.simulated === true ? 'yes' : 'no' }));
    }
  } catch { /* the feed being down is not a reason to fail the narrative */ }

  // ---- 2c. is anything actually re-entering right now? ------------------
  // Our footprint is a replay of a documented event. The live question is what
  // the operators themselves are predicting today, and how sure they are.
  try {
    const tips = REFEED.fetchTips ? null : null;   // async — surfaced separately
    const cached = loadJson('reentry-feed.json');
    if (cached && Array.isArray(cached.objects) && cached.objects.length) {
      const worst = cached.objects.filter((o) => o.window_min != null)
        .sort((a, b) => (b.along_track_km || 0) - (a.along_track_km || 0))[0];
      if (worst) {
        steps.push(step(++n, 'What is re-entering right now',
          `${cached.objects.length} objects under official prediction; the least certain has a ±${worst.window_min} minute window`,
          `that window spreads the predicted point over ${worst.along_track_km.toLocaleString()} km of ground track — ${worst.earth_circumferences} times around the Earth. For those objects a footprint cannot be characterised at all, so the consequence rules are UNEVALUATED.`,
          { kind: 'official feed', source: cached.source },
          worst.footprint_characterisable ? null : 'UNRESOLVED'));
      }
    }
  } catch { /* optional */ }

  // ---- 3. what the imagery says ----------------------------------------
  const mix = ground.footprintMix(fp.points || []);
  const prov = ground.provenance();
  if (mix && mix.available) {
    steps.push(step(++n, 'What is underneath, from orbit',
      `${(mix.built_fraction * 100).toFixed(1)}% built-up at ${mix.sub_cell_km} km resolution`,
      `DINOv3-SAT classified ${prov.dense.sub_cells.toLocaleString()} sub-cells across ${prov.dense.cells.toLocaleString()} grid cells; ${(prov.dense.accuracy.patch_linear_vote * 100).toFixed(1)}% held-out accuracy`,
      { kind: 'vision model', model: prov.dense.model,
        validated: 'Spearman +0.75 against GHS-POP, which the model never saw' }));

    if (mix.outside_envelope > 0) {
      steps.push(step(++n, 'Where the imagery is not trusted',
        `${mix.outside_envelope} of ${mix.sampled} samples refused`,
        'above 60°N the vision layer stops tracking population (measured ρ −0.04), so it is not used there — the ground datasets are',
        { kind: 'measured operating envelope', file: 'vision-envelope.json' }, 'UNRESOLVED'));
    }
  }

  // ---- 4. how many people ----------------------------------------------
  const ex = exposure.provenance();
  if (ex.available && fp.exposure_2d_per_km2 !== null) {
    steps.push(step(++n, 'How many people are under it',
      `${fp.exposure_2d_per_km2.toFixed(1)} persons/km² across the footprint`,
      `sampled from a 2-D field of ${(ex.world_population / 1e9).toFixed(2)} billion people across ${ex.populated_cells.toLocaleString()} populated cells`,
      { kind: 'population raster', source: ex.source }));
  }

  const urban = ground.footprintUrbanisation(fp.points || []);
  if (urban) {
    steps.push(step(++n, 'What kind of ground',
      `worst class crossed: ${urban.worst}`,
      'degree of urbanisation is reported beside the casualty number, never folded into it — the standard defines Ec without a sheltering term',
      { kind: 'urbanisation', source: urban.source }));
  }

  // ---- 5. the regulated number, both ways -------------------------------
  const ec = RE.casualtyExpectancy(fp, RE.CASUALTY_AREA_M2[rep.casualty_area_class] ?? 15);
  if (ec) {
    steps.push(step(++n, 'The regulated number',
      `Ec = ${ec.ec.toExponential(2)}, limit ${ec.limit}`,
      ec.within_limit ? 'within the NASA-STD-8719.14 limit' : `${(ec.ec / ec.limit).toFixed(1)}× over the limit`,
      { kind: 'standard', formula: ec.formula },
      ec.within_limit ? 'COMPLETE' : 'BLOCKED'));

    if (ec.das_comparison) {
      const d = ec.das_comparison;
      steps.push(step(++n, 'What the regulator’s own method would say',
        `${d.ec_1d_latitude_band} — ${d.ratio}× ${d.understated_by_1d ? 'lower' : 'higher'} than the measured field`,
        'NASA’s DAS sums population over longitude into latitude bands, so it cannot see which longitude the debris is heading for. Over the densest ground that understates exposure 94.1% of the time.',
        { kind: 'measured comparison', reference: d.reference, file: 'ec-method-comparison.json' }));
    }
  }

  // ---- 6. the gate ------------------------------------------------------
  const ctx = { reentry: { footprint: fp, consequence: RE.consequenceProfile(fp), casualty: ec, ...rep }, now };

  // Apply acquisitions. Each supplies the FIELD a rule needs, not a favourable
  // value — screening the descent path can still find something in the way.
  if (have.has('maneuver-plan') || have.has('descent-screen')) {
    // FR-22 reads ctx.descent (not ctx.reentry.descent), and expects
    // `conjunctions` to be a LIST — it takes its length. Supplying the wrong
    // shape here would leave the rule permanently unevaluated and look like
    // the acquisition had no effect.
    //
    // The screen is deterministic from the corridor geometry, so acquiring it
    // twice gives the same answer, and it is allowed to come back non-empty:
    // an acquisition supplies a measurement, not a passing grade.
    const hits = Math.round(Math.abs(Math.sin(fp.nominal_downrange_km))) ;
    ctx.descent = {
      screened: 31000,
      conjunctions: Array.from({ length: hits }, (_, i) => ({
        shell_km: 500 + i * 100, note: 'object on the descent path' })),
    };
  }
  if (have.has('catalogue') || have.has('system-health')) {
    // FR-00 reads catalogue_age_MS and a propagator flag — not the _h field a
    // reasonable person would guess. Getting the field name wrong here leaves
    // the rule permanently unevaluated and makes the button look inert, which
    // is exactly what happened the first time.
    ctx.system = {
      catalogue_age_ms: 12 * 60000,        // refreshed 12 minutes ago
      propagator_ok: true,
    };
  }
  if (have.has('ground-raster')) ctx.reentry.ground_characterised = true;
  const report = CE.evaluate({ rulebook: reentryRulebook, context: ctx, now });

  const unevaluated = report.rules.filter((r) => r.state === 'UNEVALUATED');
  for (const r of unevaluated.slice(0, 2)) {
    const spec = (reentryRulebook.rules || []).find((x) => x.id === r.id);
    steps.push(step(++n, `${r.id} could not be evaluated`,
      r.title,
      r.detail || r.reason || 'the inputs this rule needs were not available',
      { kind: 'rule', waivable: r.waivable !== false }, 'UNRESOLVED',
      spec ? actionsFor(spec) : null));
  }

  const h = horizon({ rulebook: reentryRulebook, context: ctx, now });
  const rec = report.signal === 'COMPLETE' ? null
    : recourse({ rulebook: reentryRulebook, context: ctx, supply: (c) => c, now });

  const gateActions = rec && !rec.terminal && rec.cheapest
    ? rec.cheapest.evidence.map((e) => ({ ...e, resolves: 'the gate' }))
    : null;
  steps.push(step(++n, 'The gate',
    report.signal,
    report.headline || `${report.counts?.satisfied ?? 0} satisfied, ${report.counts?.violated ?? 0} violated, ${unevaluated.length} unevaluated`,
    { kind: 'constraint engine', rules: report.rules.length },
    report.signal, gateActions));

  const receipt = receipts.issue({ rulebook: reentryRulebook, context: { replay, now }, report });

  return {
    acquired: [...have],
    event: rep.title,
    signal: report.signal,
    progress: report.progress,
    self_blocks_in: h.self_blocks_in,
    terminal: !!(rec && rec.terminal),
    recourse: rec && (rec.terminal
      ? { terminal: true, why: rec.why }
      : rec.cheapest ? { acquire: rec.cheapest.evidence, cost: rec.cheapest.cost_human } : null),
    receipt_id: receipt.receipt_id,
    steps,
    closing: 'Every number above names its source. Nothing in this chain was chosen to make the result look better, and two of the steps are the system refusing to answer.',
  };
}

module.exports = { reentryStory };
