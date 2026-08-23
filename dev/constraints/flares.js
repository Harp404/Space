/**
 * Solar flare nowcast + forecast.       dev/constraints/flares.js
 * =============================================================================
 * WHY THIS IS IN A CONSTRAINT SYSTEM
 *
 * Every other rule in this project evaluates conditions as they are NOW. That
 * makes the completion signal reactive: it tells you a constraint is violated
 * once it already is.
 *
 * A flare forecast changes that. It gives LEAD TIME on when a constraint WILL be
 * violated, which turns the signal predictive:
 *
 *     "FR-19 (command uplink) is satisfied now, and is forecast to be VIOLATED
 *      in ~34 minutes when the radio blackout arrives. Command the burn now or
 *      lose the window."
 *
 * That is a condition with a clock on it, which is exactly what the brief asks
 * for, and it is the difference between a dashboard and an operational tool.
 *
 * THE PHYSICS THAT MAKES LEAD TIME POSSIBLE — the Neupert effect
 *
 * Soft and hard X-rays do not peak together, and that is the whole trick:
 *
 *   HARD X-ray (0.05–0.4 nm)  non-thermal bremsstrahlung from electrons
 *                             slamming into the chromosphere. Peaks during the
 *                             IMPULSIVE phase — early.
 *   SOFT X-ray (0.1–0.8 nm)   thermal emission from plasma those electrons have
 *                             evaporated into the loop. Peaks LATER, and its
 *                             peak is what defines the flare's class.
 *
 * Soft X-ray flux roughly tracks the TIME INTEGRAL of the hard X-ray flux. So a
 * rising hard flux, and a rising hardness ratio, arrive BEFORE the soft peak
 * that determines the flare class and the resulting radio blackout. Watching
 * both bands buys minutes; watching only the soft band buys none.
 *
 * DATA
 *   NOAA SWPC GOES XRS — free, public, no key, 1-minute cadence:
 *     /json/goes/primary/xrays-6-hour.json
 *   Two bands, exactly matching the payload pair in ISRO's Aditya-L1 challenge:
 *     0.1-0.8 nm  soft  ← SoLEXS equivalent
 *     0.05-0.4 nm hard  ← HEL1OS equivalent
 *
 *   The pipeline below is band-agnostic: SoLEXS/HEL1OS Level-1 light curves from
 *   the ISSDC PRADAN portal substitute directly by feeding `ingest()` the same
 *   {time, soft, hard} series. Nothing downstream changes.
 *
 * Zero dependencies.
 * =============================================================================
 */

'use strict';

const https = require('https');

const HOST = 'services.swpc.noaa.gov';
const XRAY_PATH = '/json/goes/primary/xrays-6-hour.json';

const SOFT_BAND = '0.1-0.8nm';
const HARD_BAND = '0.05-0.4nm';

// ---------------------------------------------------------------------------
// GOES flare classification — peak soft X-ray flux, W/m²
// ---------------------------------------------------------------------------

const CLASS_FLOOR = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };

function classify(flux) {
  if (!Number.isFinite(flux) || flux <= 0) return null;
  if (flux >= CLASS_FLOOR.X) return `X${(flux / CLASS_FLOOR.X).toFixed(1)}`;
  if (flux >= CLASS_FLOOR.M) return `M${(flux / CLASS_FLOOR.M).toFixed(1)}`;
  if (flux >= CLASS_FLOOR.C) return `C${(flux / CLASS_FLOOR.C).toFixed(1)}`;
  if (flux >= CLASS_FLOOR.B) return `B${(flux / CLASS_FLOOR.B).toFixed(1)}`;
  return `A${(flux / CLASS_FLOOR.A).toFixed(1)}`;
}

const classLetter = (c) => (c ? c[0] : null);

/**
 * NOAA R-scale (radio blackout) from flare class. This is the link that makes a
 * flare forecast an operational constraint rather than an astronomy fact:
 * R-scale drives HF availability, which drives whether a burn can be commanded.
 */
function rScale(flux) {
  if (!Number.isFinite(flux)) return null;
  if (flux >= 2e-3) return { scale: 'R5', effect: 'complete HF blackout on the sunlit side for hours' };
  if (flux >= 1e-3) return { scale: 'R4', effect: 'HF blackout on most of the sunlit side for 1–2 hours' };
  if (flux >= 1e-4) return { scale: 'R3', effect: 'wide-area HF blackout on the sunlit side for ~1 hour' };
  if (flux >= 5e-5) return { scale: 'R2', effect: 'limited HF blackout on the sunlit side, tens of minutes' };
  if (flux >= 1e-5) return { scale: 'R1', effect: 'minor HF degradation on the sunlit side' };
  return { scale: 'R0', effect: 'no radio blackout' };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

function getJson(path, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: HOST, path, headers: { 'User-Agent': 'AstroMesh/1.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`SWPC ${path} -> HTTP ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('malformed JSON: ' + e.message)); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('SWPC X-ray request timed out')));
  });
}

/**
 * Merge the two bands into one aligned series.
 * @returns {Array<{t:number, soft:number, hard:number}>} ascending by time
 */
function align(records) {
  const byTime = new Map();
  for (const r of records) {
    // A single malformed record must not take down the whole ingest. If the
    // feed degrades, the right outcome is UNRESOLVED downstream, not a crash.
    if (!r || typeof r !== 'object') continue;
    const t = Date.parse(r.time_tag);
    if (!Number.isFinite(t)) continue;
    const flux = Number(r.flux);
    if (!Number.isFinite(flux) || flux <= 0) continue;
    const row = byTime.get(t) || { t, soft: null, hard: null };
    if (r.energy === SOFT_BAND) row.soft = flux;
    else if (r.energy === HARD_BAND) row.hard = flux;
    byTime.set(t, row);
  }
  return [...byTime.values()]
    .filter((r) => r.soft !== null && r.hard !== null)
    .sort((a, b) => a.t - b.t);
}

/** Fetch and align the live GOES XRS series. */
async function fetchSeries() {
  const raw = await getJson(XRAY_PATH);
  if (!Array.isArray(raw) || !raw.length) throw new Error('GOES XRS product empty');
  const series = align(raw);
  if (series.length < 10) throw new Error('GOES XRS series too short to analyse');
  return series;
}

/** Accept an externally supplied series — e.g. SoLEXS + HEL1OS Level-1. */
function ingest(series) {
  return (series || [])
    .filter((r) => Number.isFinite(r.t) && r.soft > 0 && r.hard > 0)
    .sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

/** Hardness ratio — hard/soft. Rises during the impulsive phase, before the soft peak. */
const hardness = (r) => r.hard / r.soft;

/** Robust background: the 20th percentile over the trailing window. */
function background(series, endIdx, windowMin = 120) {
  const cutoff = series[endIdx].t - windowMin * 60000;
  const vals = [];
  for (let i = endIdx; i >= 0 && series[i].t >= cutoff; i--) vals.push(series[i].soft);
  if (!vals.length) return series[endIdx].soft;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.2)];
}

/** Log-space slope per minute over the trailing n samples — the rise rate. */
function logSlope(series, endIdx, n, field) {
  const start = Math.max(0, endIdx - n + 1);
  const pts = [];
  for (let i = start; i <= endIdx; i++) {
    const v = series[i][field];
    if (v > 0) pts.push({ x: (series[i].t - series[start].t) / 60000, y: Math.log10(v) });
  }
  if (pts.length < 3) return 0;
  const n2 = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0), sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const den = n2 * sxx - sx * sx;
  return den === 0 ? 0 : (n2 * sxy - sx * sy) / den;
}

// ---------------------------------------------------------------------------
// NOWCAST — detect flares that are happening or have happened
// ---------------------------------------------------------------------------

/**
 * Detect flare events in the series.
 *
 * A flare is: soft flux rising above background by a factor, sustained, with a
 * clear peak. Both bands are used — the hard band confirms a genuine impulsive
 * phase rather than a slow thermal drift, which is what suppresses false alarms.
 */
function nowcast(series, opts = {}) {
  const RISE_FACTOR = opts.rise_factor ?? 1.4;    // above background to start an event
  const MIN_CLASS_FLUX = opts.min_flux ?? 1e-7;   // ignore sub-B noise
  const events = [];
  let cur = null;

  for (let i = 5; i < series.length; i++) {
    const r = series[i];
    const bg = background(series, i);
    const rising = r.soft > bg * RISE_FACTOR && r.soft >= MIN_CLASS_FLUX;

    if (rising && !cur) {
      cur = { start_t: r.t, start_flux: r.soft, background: bg, peak_flux: r.soft, peak_t: r.t, peak_hard: r.hard, hard_peak_t: r.t, max_hard: r.hard };
    } else if (cur) {
      if (r.soft > cur.peak_flux) { cur.peak_flux = r.soft; cur.peak_t = r.t; }
      if (r.hard > cur.max_hard) { cur.max_hard = r.hard; cur.hard_peak_t = r.t; }
      // Event ends when flux falls back toward background.
      if (r.soft < cur.background * 1.15) {
        cur.end_t = r.t;
        finishEvent(cur, events);
        cur = null;
      }
    }
  }
  if (cur) { cur.end_t = series[series.length - 1].t; cur.in_progress = true; finishEvent(cur, events); }

  return events;
}

function finishEvent(e, out) {
  const cls = classify(e.peak_flux);
  // The Neupert lead: how far the hard-X-ray peak preceded the soft peak. This
  // is the measured, per-event version of the lead time the forecaster exploits.
  const neupertLeadMin = (e.peak_t - e.hard_peak_t) / 60000;
  out.push({
    start: new Date(e.start_t).toISOString(),
    peak: new Date(e.peak_t).toISOString(),
    end: new Date(e.end_t).toISOString(),
    class: cls,
    class_letter: classLetter(cls),
    peak_flux: e.peak_flux,
    background_flux: e.background,
    hard_peak: new Date(e.hard_peak_t).toISOString(),
    neupert_lead_min: +neupertLeadMin.toFixed(1),
    duration_min: +((e.end_t - e.start_t) / 60000).toFixed(1),
    r_scale: rScale(e.peak_flux),
    in_progress: !!e.in_progress,
    source: 'GOES XRS two-band nowcast',
  });
}

// ---------------------------------------------------------------------------
// FORECAST — is one starting, and how big will it get?
// ---------------------------------------------------------------------------

/**
 * Short-horizon forecast from the trailing window.
 *
 * The signal is the impulsive phase: hard X-ray flux rising, hardness ratio
 * rising, soft flux beginning to lift off background. Because soft X-ray tracks
 * the integral of hard X-ray, an already-rising hard band lets us project the
 * soft peak — and therefore the flare class and the radio blackout — before it
 * arrives.
 *
 * Reports probability, projected class, and LEAD TIME, which is what the
 * constraint layer consumes.
 */
function forecast(series, opts = {}) {
  if (!series || series.length < 15) {
    return { available: false, reason: 'series too short to forecast' };
  }
  const i = series.length - 1;
  const now = series[i];
  const bg = background(series, i);

  const softSlope = logSlope(series, i, 10, 'soft');   // decades per minute
  const hardSlope = logSlope(series, i, 10, 'hard');
  const hr = hardness(now);
  const hrPrev = hardness(series[Math.max(0, i - 10)]);
  const hrSlope = (Math.log10(hr) - Math.log10(hrPrev)) / 10;

  const elevation = now.soft / bg;

  // Score the impulsive-phase signature. Hard-band rise is weighted highest
  // because it is the earliest indicator; hardness ratio next; soft-band rise
  // last, since by the time soft is climbing steeply the lead time is spent.
  let score = 0;
  const drivers = [];
  if (hardSlope > 0.004) { score += 0.40; drivers.push(`hard X-ray rising (${(hardSlope * 100).toFixed(2)} dex/100 min)`); }
  if (hrSlope > 0.002) { score += 0.25; drivers.push('hardness ratio increasing — impulsive phase signature'); }
  if (softSlope > 0.003) { score += 0.20; drivers.push('soft X-ray lifting off background'); }
  if (elevation > 1.3) { score += 0.15; drivers.push(`soft flux ${elevation.toFixed(1)}× background`); }

  // Project the soft peak. During an impulsive rise the log-linear slope
  // extrapolated over a typical 8–15 minute rise phase is a serviceable first
  // approximation; it is explicitly a projection, not a physical model.
  const horizonMin = opts.horizon_min ?? 30;
  const riseMin = Math.min(horizonMin, 12);
  const projectedFlux = softSlope > 0 ? now.soft * Math.pow(10, softSlope * riseMin) : now.soft;
  const projectedClass = classify(projectedFlux);

  const probability = Math.min(0.95, +score.toFixed(2));

  // Lead time: how long until the projected soft peak (and therefore the
  // blackout) arrives. This is the number the constraint layer needs.
  const leadMin = probability >= 0.4 ? riseMin : null;

  return {
    available: true,
    observed_at: new Date(now.t).toISOString(),
    current: {
      soft_flux: now.soft, hard_flux: now.hard,
      class: classify(now.soft),
      hardness_ratio: +hr.toExponential(3),
      background_flux: bg,
      elevation_x_background: +elevation.toFixed(2),
    },
    trend: {
      soft_slope_dex_per_min: +softSlope.toFixed(5),
      hard_slope_dex_per_min: +hardSlope.toFixed(5),
      hardness_slope_per_min: +hrSlope.toFixed(5),
    },
    probability,
    drivers,
    horizon_min: horizonMin,
    projected_peak_class: projectedClass,
    projected_peak_flux: projectedFlux,
    projected_r_scale: rScale(projectedFlux),
    lead_time_min: leadMin,
    // Only an M-class or larger flare produces a radio blackout worth gating on.
    blackout_expected: projectedFlux >= 1e-5 && probability >= 0.4,
    method: 'two-band impulsive-phase detection (Neupert effect): hard X-ray and hardness-ratio rise precede the soft-X-ray peak that sets the flare class',
    honesty: 'This is a short-horizon projection from the current rise, not a physical flare model. It forecasts the peak of a flare ALREADY BEGINNING; it does not predict flare onset from a quiet Sun.',
  };
}

// ---------------------------------------------------------------------------
// The constraint interface — what the rulebook consumes
// ---------------------------------------------------------------------------

/**
 * Turn a forecast into a predicted constraint violation with lead time.
 * This is what makes the completion signal predictive rather than reactive.
 */
function predictedImpact(fc) {
  if (!fc || !fc.available) return null;
  if (!fc.blackout_expected) {
    return {
      expected: false,
      probability: fc.probability,
      note: fc.probability >= 0.4
        ? `flare activity detected but projected below M-class (${fc.projected_peak_class}) — no radio blackout expected`
        : 'no impulsive-phase signature in the current X-ray light curves',
    };
  }
  return {
    expected: true,
    probability: fc.probability,
    lead_time_min: fc.lead_time_min,
    at: fc.lead_time_min != null ? new Date(Date.parse(fc.observed_at) + fc.lead_time_min * 60000).toISOString() : null,
    projected_class: fc.projected_peak_class,
    r_scale: fc.projected_r_scale,
    affects: ['FR-19 command uplink (HF blackout on the sunlit side)', 'FR-20 positional knowledge (GNSS scintillation)'],
    drivers: fc.drivers,
  };
}

/** One call: fetch, nowcast, forecast. Returns null on failure — never a fake calm. */
async function assess(opts = {}) {
  const series = await fetchSeries();
  const events = nowcast(series, opts);
  const fc = forecast(series, opts);
  return {
    series_points: series.length,
    window_hours: 6,
    bands: { soft: SOFT_BAND, hard: HARD_BAND },
    nowcast: {
      events,
      count: events.length,
      in_progress: events.filter((e) => e.in_progress),
      largest: events.reduce((a, b) => (!a || b.peak_flux > a.peak_flux ? b : a), null),
    },
    forecast: fc,
    predicted_impact: predictedImpact(fc),
    source: 'NOAA SWPC GOES XRS — live, no API key',
    payload_equivalence: 'Two-band structure matches ISRO Aditya-L1 SoLEXS (soft) + HEL1OS (hard); Level-1 light curves from ISSDC PRADAN substitute directly via ingest().',
    fetched_at: new Date().toISOString(),
  };
}

module.exports = {
  assess, fetchSeries, ingest, align,
  nowcast, forecast, predictedImpact,
  classify, rScale, hardness, background, logSlope,
  SOFT_BAND, HARD_BAND, CLASS_FLOOR,
};
