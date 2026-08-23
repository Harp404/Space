/**
 * Ground exposure field.        dev/constraints/exposure.js
 * =============================================================================
 * WHAT THE REGULATOR ACTUALLY DOES
 *
 * Casualty expectancy — the number that decides whether an uncontrolled
 * re-entry is legal — is computed by NASA's DAS, the flight-qualified tool
 * behind the standard. Its population model is described in NTRS 20170008876
 * (Ostrom, "Improving Estimation of Ground Casualty Risk from Reentering Space
 * Objects"). The operative sentence, verbatim:
 *
 *     "the cells are summed over longitude to re-create the latitude bands"
 *
 * The 2-D population field is collapsed into a 1-D latitude histogram. The
 * paper states its own limitations plainly: the approximation "does not allow
 * for general urbanization trends worldwide", and population that has moved
 * since the 2015 baseline "is not modeled". DAS ran on GPWv2 — 2001 data —
 * until roughly 2017.
 *
 * WHY THAT MATTERS, MEASURED
 *
 * From GHS-POP 2020 aggregated to this grid:
 *     51,780 of 259,200 cells contain anybody at all      (20.0%)
 *     the single most populous cell holds 25.6M people
 *     the top 1% of cells (518) hold 28.4% of humanity
 *
 * Collapsing longitude takes those 518 cells and smears 2.2 billion people
 * evenly across their latitude bands — including across the open ocean at the
 * same latitude. For a footprint a few hundred km wide, that is the difference
 * between "lands in the Pacific" and "lands on a city".
 *
 * WHAT THIS MODULE DOES
 *
 * It provides BOTH fields from one source, so the two methods can be run on
 * the same footprint with the same casualty area and compared:
 *
 *     density2d(lat, lon)   real persons/km² in that cell
 *     density1d(lat)        the DAS-equivalent longitude-collapsed band mean
 *
 * We do not claim the regulator is wrong. We report both numbers and let the
 * difference speak. If the exposure artefact is absent, every function returns
 * null and the caller must treat the result as UNEVALUATED — we do not fall
 * back to an assumed density, because a guessed population is exactly the kind
 * of quiet default this whole system exists to refuse.
 *
 * SOURCE
 *   GHS-POP R2023A, 30 arc-second, EPSG:4326, persons per cell, CC BY 4.0.
 *   European Commission Joint Research Centre.
 *   Built by ml/build_exposure.js — every pixel placed by its own geographic
 *   coordinate from the file's affine transform, no resampling.
 *
 * Zero dependencies. Deterministic.
 * =============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const R_EARTH_KM = 6371.0088;

let field;   // undefined = not tried, null = absent

/** Load the exposure artefact once. Absent is a legitimate state, not an error. */
function load() {
  if (field !== undefined) return field;
  try {
    const p = path.join(__dirname, '..', 'cache', 'exposure.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    field = (j && j.cells && Array.isArray(j.lat_bands)) ? j : null;
  } catch { field = null; }
  return field;
}

/** True area of one grid cell at this row, km². Cells shrink toward the poles. */
function cellAreaKm2(iy, res, ny) {
  const n = (90 - iy * res) * Math.PI / 180;
  const s = (90 - (iy + 1) * res) * Math.PI / 180;
  return R_EARTH_KM * R_EARTH_KM * (res * Math.PI / 180) * (Math.sin(n) - Math.sin(s));
}

function indexOf(lat, lon, res, nx, ny) {
  const ix = Math.floor(((lon + 180) % 360) / res);
  const iy = Math.floor((90 - lat) / res);
  if (iy < 0 || iy >= ny || ix < 0 || ix >= nx) return null;
  return { ix, iy, key: String(iy * nx + ix) };
}

/**
 * The 2-D field: persons/km² actually in this cell.
 * Returns null if the artefact is missing — never a guess.
 */
function density2d(lat, lon) {
  const f = load();
  if (!f) return null;
  const { res_deg: res, nx, ny } = f.grid;
  const at = indexOf(lat, lon, res, nx, ny);
  if (!at) return null;
  const pop = f.cells[at.key] || 0;         // absent key means genuinely nobody
  return pop / cellAreaKm2(at.iy, res, ny);
}

/**
 * The 1-D field: what DAS computes. Everyone in the latitude band spread
 * evenly across all 720 cells of that band, ocean included.
 */
function density1d(lat) {
  const f = load();
  if (!f) return null;
  const { res_deg: res, nx, ny } = f.grid;
  const iy = Math.floor((90 - lat) / res);
  if (iy < 0 || iy >= ny) return null;
  const band = f.lat_bands[iy];
  if (!band) return null;
  return band.pop / (cellAreaKm2(iy, res, ny) * nx);
}

/** Raw population count in a cell, for the UI to quote a real number. */
function population(lat, lon) {
  const f = load();
  if (!f) return null;
  const { res_deg: res, nx, ny } = f.grid;
  const at = indexOf(lat, lon, res, nx, ny);
  if (!at) return null;
  return f.cells[at.key] || 0;
}

/** Provenance, so the UI can cite the source rather than assert a number. */
function provenance() {
  const f = load();
  if (!f) {
    return {
      available: false,
      reason: 'exposure artefact not built — run ml/build_exposure.py',
    };
  }
  return {
    available: true,
    source: f.source,
    epoch: f.epoch,
    world_population: f.world_population,
    populated_cells: f.populated_cells,
    grid: f.grid,
    comparison_basis: 'NTRS 20170008876 — DAS sums population cells over longitude into latitude bands',
  };
}

module.exports = { density2d, density1d, population, provenance, cellAreaKm2, load };
