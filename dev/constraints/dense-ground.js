/**
 * Sub-cell ground characterisation.        dev/constraints/dense-ground.js
 * =============================================================================
 * WHAT THIS ADDS
 *
 * The consequence raster answers "what is under this 0.5 degree cell" with a
 * single class. A cell is about 55 km across, so that is one answer for an area
 * larger than most metropolitan regions — a footprint clipping the edge of a
 * city gets the same verdict as one centred on it.
 *
 * DINOv3-SAT gives us 16x16 patch classes per cell, ~3.4 km each: 18.2 million
 * sub-cells across 71,032 cells. So a footprint can be scored by WHERE inside a
 * cell the built-up ground actually is.
 *
 * WHAT MAKES IT TRUSTWORTHY, AND WHERE IT ISN'T
 *
 * The layer was validated against GHS-POP, which played no part in training it:
 * BUILT fraction rises with population at Spearman +0.75, a 158x separation
 * between the emptiest and densest deciles, and 24,849 cells the model calls
 * >90% water contain a median of zero people.
 *
 * It also has a MEASURED BLIND SPOT. Above 60 degrees north the correlation
 * collapses (rho -0.04 in the 60-66 band) — boreal forest and snow read as
 * sparse regardless of what is built there. Rather than hide that, the envelope
 * is enforced here: outside the trusted bands this module refuses to answer and
 * the caller falls back to the ground datasets, or reports UNEVALUATED.
 *
 * That refusal covers 8.1% of scanned cells and 0.4% of the people in them.
 *
 * Zero dependencies. Artefacts are optional — absent means "unavailable",
 * never a substituted guess.
 * =============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NX = 720, RES = 0.5;

let dense;        // undefined = not tried, null = absent
let shelter;

function loadJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', rel), 'utf8')); }
  catch { return null; }
}

function loadDense() {
  if (dense !== undefined) return dense;
  const j = loadJson('dense-consequence.json');
  dense = (j && j.cells && Array.isArray(j.classes)) ? j : null;
  return dense;
}

function loadShelter() {
  if (shelter !== undefined) return shelter;
  const j = loadJson('sheltering.json');
  shelter = (j && j.cells) ? j : null;
  return shelter;
}

function cellKey(lat, lon) {
  const ix = Math.floor(((lon + 180) % 360) / RES);
  const iy = Math.floor((90 - lat) / RES);
  if (iy < 0 || iy >= 360 || ix < 0 || ix >= NX) return null;
  return String(iy * NX + ix);
}

/** Is this latitude inside the band where the vision layer was shown to work? */
function insideEnvelope(lat) {
  const env = loadJson(path.join('models', 'vision-envelope.json'));
  if (!env || !Array.isArray(env.trusted_bands)) return true;   // no envelope = no restriction
  return env.trusted_bands.some(([lo, hi]) => lat >= lo && lat < hi);
}

/**
 * Land-cover at ~3.4 km for the sub-cell containing this point.
 * Returns null when unavailable OR outside the measured envelope — the caller
 * must treat both as "fall back", never as a pass.
 */
function subCellClass(lat, lon) {
  const d = loadDense();
  if (!d) return null;
  if (!insideEnvelope(lat)) {
    return { outside_envelope: true, lat: +lat.toFixed(2),
      reason: 'latitude is outside the band where the vision layer was shown to track population — imagery is not used here' };
  }
  const key = cellKey(lat, lon);
  if (key === null) return null;
  const grid = d.cells[key];
  if (!grid) return null;

  const g = d.grid || 16;
  // position of the point INSIDE its 0.5 degree cell
  const iy = Math.floor((90 - lat) / RES);
  const ix = Math.floor(((lon + 180) % 360) / RES);
  const fy = ((90 - lat) / RES) - iy;
  const fx = (((lon + 180) % 360) / RES) - ix;
  const sy = Math.min(g - 1, Math.max(0, Math.floor(fy * g)));
  const sx = Math.min(g - 1, Math.max(0, Math.floor(fx * g)));
  const id = grid[sy * g + sx];

  return {
    cls: d.classes[id] || 'UNKNOWN',
    sub_cell_km: d.sub_cell_km,
    accuracy: d.accuracy ? d.accuracy.patch_linear_vote : null,
    source: 'DINOv3-SAT patch classification, validated against GHS-POP',
  };
}

/** Class mix across a whole footprint, at sub-cell rather than cell resolution. */
function footprintMix(points) {
  const d = loadDense();
  if (!d || !Array.isArray(points) || !points.length) return null;
  const counts = {};
  let used = 0, outside = 0, missing = 0;
  for (const p of points) {
    const r = subCellClass(p.lat, p.lon);
    if (!r) { missing++; continue; }
    if (r.outside_envelope) { outside++; continue; }
    counts[r.cls] = (counts[r.cls] || 0) + 1;
    used++;
  }
  const total = points.length;
  if (!used) {
    return { available: false, outside_envelope: outside, missing,
      reason: 'no footprint sample fell on ground the vision layer is trusted for' };
  }
  const frac = {};
  for (const [k, v] of Object.entries(counts)) frac[k] = +(v / used).toFixed(4);
  return {
    available: true,
    sub_cell_km: d.sub_cell_km,
    sampled: total, characterised: used,
    outside_envelope: outside, missing,
    // Refusing to characterise is itself a result the rule needs to see.
    coverage: +(used / total).toFixed(4),
    fractions: frac,
    built_fraction: frac.BUILT || 0,
    unknown_fraction: frac.UNKNOWN || 0,
    accuracy: d.accuracy ? d.accuracy.patch_linear_vote : null,
    source: 'DINOv3-SAT 3.4 km land cover; envelope enforced above 60N',
  };
}

/**
 * Degree of urbanisation under a point, from GHS-SMOD.
 *
 * Reported as a separate sourced attribute. It is NOT multiplied into Ec:
 * NASA-STD-8719.14 defines Ec without a sheltering term, and inventing a
 * coefficient would make the regulated number incomparable to the figures
 * regulators publish.
 */
function urbanisation(lat, lon) {
  const s = loadShelter();
  if (!s) return null;
  const key = cellKey(lat, lon);
  if (key === null) return null;
  const code = s.cells[key];
  if (code === undefined) return null;
  return {
    code,
    label: s.classes[String(code)] || s.classes[code] || 'UNKNOWN',
    source: s.source,
    note: 'Reported alongside Ec, never folded into it.',
  };
}

/** Worst urbanisation class anywhere under a footprint. */
function footprintUrbanisation(points) {
  const s = loadShelter();
  if (!s || !Array.isArray(points) || !points.length) return null;
  let worst = null, worstCode = -1;
  const hist = {};
  for (const p of points) {
    const u = urbanisation(p.lat, p.lon);
    if (!u) continue;
    hist[u.label] = (hist[u.label] || 0) + 1;
    if (u.code > worstCode) { worstCode = u.code; worst = u; }
  }
  if (!worst) return null;
  return { worst: worst.label, code: worstCode, histogram: hist, source: s.source };
}

function provenance() {
  const d = loadDense(), s = loadShelter();
  return {
    dense_available: !!d,
    dense: d ? {
      cells: d.cells_scored, sub_cells: d.sub_cells, sub_cell_km: d.sub_cell_km,
      accuracy: d.accuracy, ood_method: d.ood_method, model: d.model,
    } : null,
    sheltering_available: !!s,
    sheltering: s ? { source: s.source, cells: Object.keys(s.cells).length } : null,
  };
}

module.exports = { subCellClass, footprintMix, urbanisation, footprintUrbanisation, provenance };
