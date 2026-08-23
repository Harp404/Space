/**
 * Re-entry / disposal engine.        dev/constraints/reentry.js
 * =============================================================================
 * THE RETURN LEG
 *
 * AstroMesh covers launch (ascent planner) and on-orbit (conjunctions, consensus).
 * It did not cover RETURN — and return is where the industry is moving fastest:
 *
 *   • SpaceX controlled-deorbited 260 Starlink satellites in six months
 *     (1 Dec 2025 – 31 May 2026), and is lowering the whole shell 550 → 480 km
 *     through 2026.
 *   • Varda returned capsules W-5 and W-6 in 2026 and expects monthly cadence.
 *   • Inversion's "Arc" is marketed as a reusable satellite, first flight 2026.
 *
 * And there is a live, public, unresolved dispute over exactly the number this
 * file computes. The FAA told Congress that by 2035 Starlink re-entries would
 * account for 85% of all ground casualty risk — 28,000 surviving fragments a
 * year, 0.6 casualties a year. SpaceX called that "preposterous, unjustified and
 * inaccurate" and puts the risk at essentially zero. Nobody outside those two
 * organisations can check either number.
 *
 * This shows its work.
 *
 * WHAT IS COMPUTED
 *
 *   1. Descent trajectory from the deorbit burn to entry interface (120 km).
 *   2. A MONTE CARLO FOOTPRINT — not a line. Re-entry uncertainty is dominated
 *      by atmospheric drag, so the footprint is a probability distribution.
 *      Each sample perturbs ballistic coefficient, atmospheric density (scaled
 *      by live geomagnetic activity) and burn execution error.
 *   3. Casualty expectancy Ec, integrated over that distribution against the
 *      real ground consequence raster.
 *   4. The consequence CLASS crossed — what is underneath, not just how many.
 *
 * THE REGULATORY NUMBER IS NOT TOUCHED
 *
 *   Ec = A_c × PD, exactly per NASA-STD-8719.14, so it stays directly comparable
 *   to what FAA and SpaceX publish. The consequence class is reported ALONGSIDE
 *   it as a separate second number, never folded in. Bending Ec with our own
 *   weighting would make it incomparable and the whole argument would collapse
 *   under a single question.
 *
 * AND THE CHAIN THAT CLOSES THE SYSTEM
 *
 *   solar storm (live NOAA) → density uncertainty rises → the footprint WIDENS
 *   → it overlaps populated ground → Ec crosses 1e-4 → the deorbit is BLOCKED.
 *
 *   One live geophysical input propagates through five subsystems and blocks a
 *   decision. If the footprint gets so wide we cannot tell, the answer is
 *   UNRESOLVED — wait for better data — which is what real operations do.
 *
 * Zero dependencies beyond the raster file.
 * =============================================================================
 */

'use strict';

const exposure = require('./exposure.js');

const fs = require('fs');
const path = require('path');

const RASTER_FILE = path.join(__dirname, '..', 'cache', 'consequence-raster.json');

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const LIMITS = {
  EC_MAX: 1e-4,                  // NASA-STD-8719.14 / SSC 5.d — casualty expectancy
  ENTRY_INTERFACE_KM: 120,       // conventional entry interface altitude
  MC_SAMPLES: 20000,             // Monte Carlo samples per footprint
  // Beyond this, the footprint is too wide to characterise and the honest
  // answer is UNRESOLVED rather than a number nobody should trust.
  FOOTPRINT_MAX_KM: 12000,
  AIR_TRAFFIC_ALERT: 40,         // scheduled route crossings per cell = dense corridor
};

// Debris casualty area by object class, m². Taken from published re-entry
// survivability work rather than modelled here — fragment-level ablation is a
// research programme, not a hackathon feature, and pretending otherwise would be
// the dishonest part.
const CASUALTY_AREA_M2 = {
  DEMISABLE_SMALLSAT: 0.3,       // design-for-demise, aluminium/composite
  TYPICAL_LEO_PAYLOAD: 3.5,
  LARGE_PAYLOAD: 12,
  ROCKET_BODY: 25,               // dense refractory components survive
  UNKNOWN: null,                 // → UNRESOLVED, never a default guess
};

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

let raster = null;
let densityModel;

/** The calibrated density-uncertainty artefact, if it has been built. */
function loadDensityModel() {
  if (densityModel !== undefined) return densityModel;
  try {
    const f = path.join(__dirname, '..', 'cache', 'models', 'density-uncertainty.json');
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    densityModel = (m && Array.isArray(m.bins) && m.bins.length) ? m : null;
  } catch { densityModel = null; }
  return densityModel;
}

function loadRaster() {
  if (raster) return raster;
  if (!fs.existsSync(RASTER_FILE)) return null;
  try {
    raster = JSON.parse(fs.readFileSync(RASTER_FILE, 'utf8'));
    return raster;
  } catch { return null; }
}

/** Look up one ground cell. Returns null when the cell was never characterised. */
function cellAt(lat, lon) {
  const r = loadRaster();
  if (!r) return null;
  const ix = Math.min(r.nx - 1, Math.max(0, Math.floor((lon + 180) / r.resolution_deg)));
  const iy = Math.min(r.ny - 1, Math.max(0, Math.floor((90 - lat) / r.resolution_deg)));
  const v = r.cells[iy * r.nx + ix];
  if (!v) return { pop: 0, air: 0, cls: 'UNKNOWN', characterised: false };
  return { pop: v[0], air: v[1], cls: r.class_names[v[2]], characterised: true };
}

/** Cell area in km² at a given latitude — cells shrink toward the poles. */
function cellAreaKm2(lat, resDeg) {
  const R = 6371.0;
  const d2r = Math.PI / 180;
  return (resDeg * d2r * R) * (resDeg * d2r * R * Math.cos(lat * d2r));
}

// ---------------------------------------------------------------------------
// Deterministic RNG — the same deorbit must produce the same footprint every
// time, or the whole "deterministic, reproducible" claim collapses.
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Box–Muller, driven by the seeded RNG. */
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Ground track
// ---------------------------------------------------------------------------

/**
 * Advance a sub-satellite point along its ground track by a downrange distance.
 * Standard great-circle propagation on a given heading.
 */
function advance(lat, lon, headingDeg, distKm) {
  const R = 6371.0, d2r = Math.PI / 180, r2d = 180 / Math.PI;
  const δ = distKm / R;
  const θ = headingDeg * d2r;
  const φ1 = lat * d2r, λ1 = lon * d2r;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * r2d, lon: (((λ2 * r2d) + 540) % 360) - 180 };
}

/** Heading of the ground track at a given latitude for a given inclination. */
function trackHeading(latDeg, incDeg, ascending = true) {
  const d2r = Math.PI / 180, r2d = 180 / Math.PI;
  const i = incDeg * d2r, φ = latDeg * d2r;
  // Spherical trigonometry of a great circle at inclination i:
  //
  //     sin(heading) = cos(i) / cos(latitude)
  //
  // Check it at the two points where the answer is known. At the equator the
  // track crosses at angle i to it, so the heading from north is 90 - i, and
  // sin(90 - i) = cos(i). At the maximum latitude, where |latitude| = i, the
  // track is momentarily due east: sin(h) = cos(i)/cos(i) = 1, so h = 90.
  //
  // This previously used acos, which inverted both cases — it returned due
  // NORTH at maximum latitude and walked ground tracks straight over the pole.
  // A footprint reached 84.9 N for an object in a 41.5 degree orbit, which is
  // geometrically impossible: a ground track can never exceed its inclination.
  const sinH = Math.cos(i) / Math.max(1e-6, Math.cos(φ));
  const clamped = Math.max(-1, Math.min(1, sinH));
  const h = Math.asin(clamped) * r2d;
  return ascending ? h : 180 - h;
}

// ---------------------------------------------------------------------------
// The footprint
// ---------------------------------------------------------------------------

/**
 * Monte Carlo re-entry footprint.
 *
 * @param {object} o
 * @param {number} o.entry_lat, o.entry_lon   sub-satellite point at entry interface
 * @param {number} o.inclination_deg
 * @param {number} o.ballistic_coefficient    kg/m² (mass / Cd·A)
 * @param {number} o.kp                       live geomagnetic index — drives density uncertainty
 * @param {number} o.burn_error_frac          1σ deorbit burn execution error
 * @param {number} o.samples
 * @param {string} o.seed
 */
function footprint(o) {
  const samples = o.samples || LIMITS.MC_SAMPLES;
  const rng = makeRng(seedFrom(o.seed || 'astromesh'));
  const inc = o.inclination_deg ?? 53;
  const bc = o.ballistic_coefficient ?? 80;
  const kp = Number.isFinite(o.kp) ? o.kp : null;

  // Nominal downrange from entry interface to ground. Higher ballistic
  // coefficient → shallower deceleration → the object flies further.
  const nominalDownrangeKm = 400 + bc * 8;

  // 1σ along-track dispersion. Three contributors, added in quadrature:
  //
  //   density   the dominant term. Thermospheric density uncertainty is ~15% in
  //             quiet conditions and rises sharply with geomagnetic activity —
  //             this is why re-entry predictions degrade during a storm.
  //   ballistic  attitude and tumbling change the effective area.
  //   burn       deorbit burn execution error maps into entry timing.
  //
  // If Kp is unknown we return null and the caller reports UNRESOLVED rather
  // than assuming quiet conditions.
  if (kp === null) {
    return { unresolved: true, reason: 'geomagnetic activity unknown — atmospheric density uncertainty cannot be bounded, so the footprint cannot be characterised' };
  }
  //
  // MEASURED, not assumed. ml/train_density_model.py calibrates this from the
  // observed decay scatter of 13 drag-only objects (rocket bodies and debris,
  // perigees 186-302 km) crossed with 94 years of GFZ Kp.
  //
  // The measurement corrected the hardcode this replaces in two ways:
  //   • quiet-time uncertainty is ~0.49, not 0.15 — over 3x higher
  //   • the shape is a THRESHOLD, not a ramp: flat below Kp 5, then a ~1.5x step
  //
  // Falls back to the original physically-motivated guess when the artefact is
  // absent, and says which one it used.
  const densityCal = loadDensityModel();
  let densitySigmaFrac, densityBasis;
  if (densityCal) {
    const bin = densityCal.bins.find((b) => kp >= b.kp_lo && kp < b.kp_hi);
    if (bin) {
      densitySigmaFrac = bin.relative_sigma;
      densityBasis = `measured (Kp ${bin.kp_lo}-${bin.kp_hi} bin, n=${bin.n})`;
    } else {
      densitySigmaFrac = kp >= 5 ? (densityCal.storm_sigma ?? densityCal.quiet_sigma) : densityCal.quiet_sigma;
      densityBasis = 'measured (extrapolated beyond the calibrated bins)';
    }
  } else {
    densitySigmaFrac = 0.15 + 0.10 * Math.max(0, kp - 3);
    densityBasis = 'assumed — density calibration artefact not present';
  }
  const ballisticSigmaFrac = 0.10;
  const burnSigmaFrac = o.burn_error_frac ?? 0.02;
  const sigmaFrac = Math.hypot(densitySigmaFrac, ballisticSigmaFrac, burnSigmaFrac);
  const sigmaKm = nominalDownrangeKm * sigmaFrac;

  // Cross-track dispersion is far smaller than along-track — the object is
  // still travelling at orbital velocity along its plane.
  const crossSigmaKm = Math.max(5, sigmaKm * 0.04);

  const heading = trackHeading(o.entry_lat, inc, o.ascending !== false);

  let popSum = 0, popSq = 0, characterised = 0;
  let maxAir = 0, criticalHits = 0;
  const classHits = {};
  // Parallel accumulators for the dual-method exposure comparison.
  let exp2Sum = 0, exp2N = 0, exp1Sum = 0, exp1N = 0;
  const pts = [];
  let minDown = Infinity, maxDown = -Infinity;
  const r = loadRaster();
  const res = r ? r.resolution_deg : 0.5;

  for (let i = 0; i < samples; i++) {
    const down = nominalDownrangeKm + gaussian(rng) * sigmaKm;
    const cross = gaussian(rng) * crossSigmaKm;
    if (down < minDown) minDown = down;
    if (down > maxDown) maxDown = down;

    const along = advance(o.entry_lat, o.entry_lon, heading, Math.max(0, down));
    const p = advance(along.lat, along.lon, heading + 90, cross);

    const c = cellAt(p.lat, p.lon);
    if (c) {
      if (c.characterised) {
        characterised++;
        // The raster's own coarse population, kept so behaviour is unchanged
        // when the GHS-POP exposure artefact is absent.
        const density = c.pop / cellAreaKm2(p.lat, res);   // persons per km²
        popSum += density;
        popSq += density * density;

        // The two real fields, sampled at the SAME point so the comparison is
        // like for like: the 2-D field GHS-POP actually measures, and the 1-D
        // longitude-collapsed field NASA's DAS uses (NTRS 20170008876).
        const e2 = exposure.density2d(p.lat, p.lon);
        const e1 = exposure.density1d(p.lat);
        if (e2 !== null) { exp2Sum += e2; exp2N++; }
        if (e1 !== null) { exp1Sum += e1; exp1N++; }
        if (c.air > maxAir) maxAir = c.air;
        classHits[c.cls] = (classHits[c.cls] || 0) + 1;
        if (r && r.classes[c.cls] && r.classes[c.cls].critical) criticalHits++;
      } else {
        classHits.UNKNOWN = (classHits.UNKNOWN || 0) + 1;
      }
    }
    if (i % Math.ceil(samples / 240) === 0) pts.push({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) });
  }

  const meanDensity = popSum / samples;                       // persons/km², expectation over the footprint
  const spanKm = maxDown - minDown;
  const characterisedFrac = characterised / samples;

  // ---- renderable geometry -------------------------------------------
  // `points` are Monte Carlo samples in SAMPLE ORDER, which is random.
  // Drawing a polyline through them produces a scribble that crosses itself
  // hundreds of times, and misrepresents the result badly: it reads as a path
  // the object might fly, when it is really a cloud of possible impact points.
  //
  // So we also emit the two things that CAN honestly be drawn as lines:
  //
  //   centreline  the nominal ground track, ordered by downrange distance
  //   corridor    a closed ribbon at +/- 2 sigma cross-track, which is the
  //               dispersion the samples were actually drawn from
  //
  // The samples stay available for a scatter overlay, which is the correct way
  // to draw a distribution.
  const STEPS = 96;
  const centreline = [];
  const leftEdge = [];
  const rightEdge = [];
  for (let k = 0; k <= STEPS; k++) {
    const down = minDown + ((maxDown - minDown) * k) / STEPS;
    const along = advance(o.entry_lat, o.entry_lon, heading, Math.max(0, down));
    centreline.push({ lat: +along.lat.toFixed(3), lon: +along.lon.toFixed(3) });
    const l = advance(along.lat, along.lon, heading + 90, 2 * crossSigmaKm);
    const r = advance(along.lat, along.lon, heading + 90, -2 * crossSigmaKm);
    leftEdge.push({ lat: +l.lat.toFixed(3), lon: +l.lon.toFixed(3) });
    rightEdge.push({ lat: +r.lat.toFixed(3), lon: +r.lon.toFixed(3) });
  }
  const corridor = leftEdge.concat(rightEdge.slice().reverse());


  return {
    unresolved: false,
    samples,
    nominal_downrange_km: +nominalDownrangeKm.toFixed(0),
    sigma_km: +sigmaKm.toFixed(0),
    span_km: +spanKm.toFixed(0),
    cross_track_sigma_km: +crossSigmaKm.toFixed(1),
    heading_deg: +heading.toFixed(1),
    dispersion: {
      density_sigma_frac: +densitySigmaFrac.toFixed(3),
      ballistic_sigma_frac: ballisticSigmaFrac,
      burn_sigma_frac: burnSigmaFrac,
      combined_sigma_frac: +sigmaFrac.toFixed(3),
      density_basis: densityBasis,
      driven_by: densitySigmaFrac > ballisticSigmaFrac ? 'atmospheric density (geomagnetic activity)' : 'ballistic coefficient',
      kp,
    },
    mean_population_density: +meanDensity.toFixed(3),
    // Measured exposure over the same samples. null when the GHS-POP artefact
    // has not been built — never a substituted guess.
    exposure_2d_per_km2: exp2N ? +(exp2Sum / exp2N).toFixed(4) : null,
    exposure_1d_per_km2: exp1N ? +(exp1Sum / exp1N).toFixed(4) : null,
    exposure_source: exposure.provenance(),
    max_air_traffic: maxAir,
    critical_fraction: +(criticalHits / samples).toFixed(4),
    class_hits: classHits,
    characterised_fraction: +characterisedFrac.toFixed(3),
    points: pts,
    // Ordered along-track, so a polyline through this is a real ground track
    // rather than an artefact of Monte Carlo sample ordering.
    centreline,
    // Closed +/-2 sigma ribbon: the dispersion the samples were drawn from.
    corridor,
  };
}

// ---------------------------------------------------------------------------
// Casualty expectancy — the regulatory number, computed exactly and unmodified.
// ---------------------------------------------------------------------------

/**
 * Ec = A_c × PD
 *
 * A_c  debris casualty area (m²), from published survivability data
 * PD   population density (persons/km²), here the EXPECTATION over the Monte
 *      Carlo footprint rather than a latitude-band average, which is what
 *      NASA's DAS uses and is considerably coarser.
 */
function casualtyExpectancy(footprintResult, casualtyAreaM2) {
  if (!footprintResult || footprintResult.unresolved) return null;
  if (!Number.isFinite(casualtyAreaM2)) return null;
  const areaKm2 = casualtyAreaM2 / 1e6;

  // Prefer the measured GHS-POP field when it is available; fall back to the
  // raster's coarser population otherwise. Ec is linear in density, so the
  // ratio of the two exposure fields IS the ratio of the two Ec values — no
  // casualty area needs to be assumed to compare the methods.
  const d2 = footprintResult.exposure_2d_per_km2;
  const d1 = footprintResult.exposure_1d_per_km2;
  const density = d2 !== null ? d2 : footprintResult.mean_population_density;
  const ec = areaKm2 * density;

  // THE COMPARISON.
  // NASA's DAS computes the regulatory Ec against a population field that has
  // been "summed over longitude to re-create the latitude bands" (Ostrom,
  // NTRS 20170008876). We keep the 2-D field. Over 18,257 sampled footprints
  // the 1-D method is conservative 81% of the time — but over the densest
  // decile of ground it UNDERSTATES exposure 94.1% of the time, by a median of
  // 3.9x. We report both numbers and let the operator see the difference; we
  // do not decide for them which regulator to satisfy.
  const das = (d1 !== null && d2 !== null) ? {
    ec_1d_latitude_band: +(areaKm2 * d1).toExponential(3),
    ec_2d_measured: +(areaKm2 * d2).toExponential(3),
    ratio: +(d2 / Math.max(d1, 1e-12)).toFixed(2),
    understated_by_1d: d2 > d1,
    method_1d: 'population summed over longitude into latitude bands — the DAS approximation',
    method_2d: 'GHS-POP persons-per-cell sampled at the Monte Carlo footprint points',
    reference: 'Ostrom, NTRS 20170008876; measured comparison in dev/cache/models/ec-method-comparison.json',
  } : null;

  return {
    ec,
    density_basis: d2 !== null
      ? 'GHS-POP 2-D measured exposure field'
      : 'consequence raster (GHS-POP exposure artefact not built)',
    das_comparison: das,
    casualty_area_m2: casualtyAreaM2,
    mean_population_density_per_km2: +density.toFixed(4),
    limit: LIMITS.EC_MAX,
    within_limit: ec < LIMITS.EC_MAX,
    formula: 'Ec = A_c × PD  (NASA-STD-8719.14 / SSC 5.d)',
    note: 'A_c is taken from published re-entry survivability data, not modelled here. Population density is the expectation over the Monte Carlo footprint, not a latitude-band average.',
  };
}

/** Which consequence classes the footprint crosses, ranked by how often. */
function consequenceProfile(footprintResult) {
  if (!footprintResult || footprintResult.unresolved) return null;
  const r = loadRaster();
  const hits = footprintResult.class_hits || {};
  const total = footprintResult.samples;
  const rows = Object.entries(hits)
    .map(([cls, n]) => ({
      cls,
      label: (r && r.classes[cls] && r.classes[cls].label) || cls,
      critical: !!(r && r.classes[cls] && r.classes[cls].critical),
      fraction: +(n / total).toFixed(4),
    }))
    .sort((a, b) => b.fraction - a.fraction);

  const critical = rows.filter((x) => x.critical);
  const unknown = rows.find((x) => x.cls === 'UNKNOWN');
  return {
    classes: rows,
    worst: critical[0] || rows[0] || null,
    critical_classes: critical,
    unknown_fraction: unknown ? unknown.fraction : 0,
  };
}

// ---------------------------------------------------------------------------
// HISTORICAL RE-ENTRY REPLAYS
//
// Recorded events, so the system can be shown behaving correctly during a
// crisis that actually happened rather than one we invented.
// ---------------------------------------------------------------------------

const REENTRY_REPLAYS = {
  long_march_5b: {
    id: 'long_march_5b',
    title: 'Long March 5B core stage — 4 November 2022',
    summary: 'An uncontrolled re-entry of a 20-tonne rocket core stage that closed European airspace.',
    // The recorded track: the stage crossed Spain and southern France before
    // coming down in the Pacific.
    entry_lat: 41.2,
    entry_lon: -3.7,
    inclination_deg: 41.5,
    ballistic_coefficient: 260,          // a large, dense core stage — flies far
    casualty_area_class: 'ROCKET_BODY',
    kp: 2.0,
    uncontrolled: true,
    documented_effects: [
      'Spain closed airspace over Catalonia; France closed airspace over southern Corsica',
      '46 airports affected, more than 300 flights delayed',
      'The re-entry was entirely uncontrolled — the impact point could not be predicted in advance',
      'Wright, Boley & Byers (Scientific Reports, 2025): a 26% annual chance that a busy airspace region is disrupted by an uncontrolled re-entry, rising as both re-entries and flights increase',
    ],
    citations: [
      'Wright, E., Boley, A., Byers, M. — "Airspace closures due to reentering space objects", Scientific Reports (2025)',
    ],
    the_point: 'Civil aviation authorities had to close airspace reactively, on the day, because nobody could say where it would come down. FR-23 is that check, run before the burn instead of after it.',
  },
};

function reentryReplay(id) {
  const r = REENTRY_REPLAYS[id];
  if (!r) return null;
  const fp = footprint({
    entry_lat: r.entry_lat, entry_lon: r.entry_lon,
    inclination_deg: r.inclination_deg,
    ballistic_coefficient: r.ballistic_coefficient,
    kp: r.kp, seed: r.id,
  });
  return {
    ...r,
    footprint: fp,
    casualty: casualtyExpectancy(fp, CASUALTY_AREA_M2[r.casualty_area_class]),
    consequence: consequenceProfile(fp),
  };
}

module.exports = {
  LIMITS, CASUALTY_AREA_M2,
  loadRaster, cellAt, cellAreaKm2,
  footprint, casualtyExpectancy, consequenceProfile,
  advance, trackHeading, makeRng, seedFrom,
  REENTRY_REPLAYS, reentryReplay,
};
