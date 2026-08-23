/**
 * Ground consequence raster builder.
 *      node dev/constraints/build-consequence-raster.js
 * =============================================================================
 * Builds the static global raster that the re-entry rules evaluate against, from
 * REAL public datasets. Run once; the output ships as a compact file so the demo
 * has no download and no GPU dependency at runtime.
 *
 * INPUTS (all free, all real, downloaded into research/data/)
 *
 *   cities15000.txt   GeoNames — 34,099 settlements with real populations
 *                     https://download.geonames.org/export/dump/
 *   airports.dat      OpenFlights — 7,698 airports with coordinates
 *   routes.dat        OpenFlights — 67,663 scheduled routes
 *   land.geojson      Natural Earth 110m land polygons — https://www.naturalearthdata.com/
 *                     (used ONLY to distinguish characterised open water from
 *                      ground we have never looked at; those must not be conflated)
 *
 * OUTPUT  dev/cache/consequence-raster.json
 *
 *   0.5° global grid (720 × 360 = 259,200 cells) holding, per populated cell:
 *     pop        population exposure          (persons per cell)
 *     air        air traffic exposure         (great-circle route crossings)
 *     cls        consequence class            (see CLASSES)
 *
 * WHY 0.5°
 *   A re-entry footprint is hundreds to thousands of kilometres long, because
 *   along-track timing uncertainty dominates. A 100 m answer would be false
 *   precision. 0.5° (~55 km) is already finer than the physics supports.
 *
 * HONEST SCOPE — say this out loud rather than waiting to be asked
 *   • GeoNames covers settlements ≥15,000 people. It is NOT a gridded population
 *     product; GHSL (EU Copernicus, 100 m) is the production upgrade. Population
 *     here is therefore an UNDERCOUNT of rural exposure, which we state rather
 *     than hide, and which makes our casualty numbers optimistic — the direction
 *     that matters for honesty.
 *   • Air traffic is modelled as great-circle paths between scheduled airport
 *     pairs. Real tracks follow airways and shift daily. It is an exposure
 *     proxy, not a flight plan.
 *   • Ocean cells are characterised as OPEN_WATER from the Natural Earth land
 *     mask. This matters: "measured open water" and "never looked at" are
 *     different states, and collapsing them would be exactly the mistake this
 *     whole project exists to prevent.
 *   • Maritime exposure (vessels on that water) is NOT modelled — FR-24 reports
 *     UNEVALUATED until an AIS density layer is loaded.
 *   • DINOv3 consequence classification (see dinov3-consequence.py) refines the
 *     `cls` field where imagery is available. Until then classes are derived
 *     from the datasets above.
 *
 * Zero dependencies.
 * =============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'research', 'data');
const OUT = path.join(__dirname, '..', 'cache', 'consequence-raster.json');

const RES = 0.5;                       // degrees per cell
const NX = Math.round(360 / RES);      // 720
const NY = Math.round(180 / RES);      // 360

/**
 * Consequence classes and their severity weights.
 *
 * CRITICAL INVARIANT: these weights are NEVER folded into the regulatory
 * casualty-expectancy number. Ec is computed and reported exactly per
 * NASA-STD-8719.14 so it stays directly comparable to what FAA and SpaceX
 * publish. The class is a SEPARATE second number. Bending Ec with our own
 * weighting would make it incomparable and the whole re-entry argument would
 * collapse under one question.
 */
const CLASSES = {
  UNKNOWN:      { w: null, label: 'unknown — not characterised' },
  OPEN_WATER:   { w: 0.0,  label: 'open water' },
  SPARSE:       { w: 0.2,  label: 'sparse / rural' },
  POPULATED:    { w: 1.0,  label: 'populated' },
  DENSE_URBAN:  { w: 2.0,  label: 'dense urban' },
  AIRPORT:      { w: null, label: 'major airport', critical: true },
  AIR_CORRIDOR: { w: null, label: 'dense air corridor', critical: true },
};

const key = (ix, iy) => iy * NX + ix;
const lonToIx = (lon) => Math.min(NX - 1, Math.max(0, Math.floor((lon + 180) / RES)));
const latToIy = (lat) => Math.min(NY - 1, Math.max(0, Math.floor((90 - lat) / RES)));
const ixToLon = (ix) => -180 + (ix + 0.5) * RES;
const iyToLat = (iy) => 90 - (iy + 0.5) * RES;

// ---------------------------------------------------------------------------

function loadCities() {
  const file = path.join(DATA, 'cities15000.txt');
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — see the header for the download URL`);
  const cells = new Map();
  let count = 0, totalPop = 0;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    // GeoNames tab-separated: 4=lat 5=lon 14=population
    const f = line.split('\t');
    const lat = Number(f[4]), lon = Number(f[5]), pop = Number(f[14]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(pop) || pop <= 0) continue;
    const k = key(lonToIx(lon), latToIy(lat));
    cells.set(k, (cells.get(k) || 0) + pop);
    count++; totalPop += pop;
  }
  console.log(`  cities:   ${count.toLocaleString()} settlements, ${(totalPop / 1e9).toFixed(2)}B people, ${cells.size.toLocaleString()} occupied cells`);
  return cells;
}

function loadAirports() {
  const file = path.join(DATA, 'airports.dat');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const byId = new Map();
  const cells = new Map();
  let n = 0;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const f = parseCsv(line);
    // OpenFlights: 0=id 4=IATA 6=lat 7=lon 12=type
    const id = f[0], lat = Number(f[6]), lon = Number(f[7]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    byId.set(id, { lat, lon, iata: f[4] });
    cells.set(key(lonToIx(lon), latToIy(lat)), true);
    n++;
  }
  console.log(`  airports: ${n.toLocaleString()} airports, ${cells.size.toLocaleString()} occupied cells`);
  return { byId, cells };
}

/** Rasterise scheduled routes as great-circle paths — an air-traffic exposure proxy. */
function loadRoutes(airportsById) {
  const file = path.join(DATA, 'routes.dat');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const cells = new Map();
  let n = 0, skipped = 0;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    // OpenFlights routes: 3=source airport id, 5=dest airport id
    const f = line.split(',');
    const a = airportsById.get(f[3]), b = airportsById.get(f[5]);
    if (!a || !b) { skipped++; continue; }
    for (const p of greatCircle(a.lat, a.lon, b.lat, b.lon, 40)) {
      const k = key(lonToIx(p.lon), latToIy(p.lat));
      cells.set(k, (cells.get(k) || 0) + 1);
    }
    n++;
  }
  console.log(`  routes:   ${n.toLocaleString()} routes rasterised (${skipped.toLocaleString()} skipped: unknown airport), ${cells.size.toLocaleString()} cells with traffic`);
  return cells;
}

/** Sample a great-circle path between two points. */
function greatCircle(lat1, lon1, lat2, lon2, steps) {
  const d2r = Math.PI / 180, r2d = 180 / Math.PI;
  const φ1 = lat1 * d2r, λ1 = lon1 * d2r, φ2 = lat2 * d2r, λ2 = lon2 * d2r;
  const dφ = φ2 - φ1, dλ = λ2 - λ1;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const δ = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  if (δ === 0) return [{ lat: lat1, lon: lon1 }];

  const out = [];
  const n = Math.max(2, Math.min(steps, Math.ceil((δ * r2d) / RES)));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * δ) / Math.sin(δ);
    const B = Math.sin(f * δ) / Math.sin(δ);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push({ lat: Math.atan2(z, Math.hypot(x, y)) * r2d, lon: Math.atan2(y, x) * r2d });
  }
  return out;
}

/** Minimal CSV parser honouring quoted fields (airport names contain commas). */
function parseCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------

/**
 * Rasterise the Natural Earth land polygons.
 *
 * Ray-casting point-in-polygon at each cell centre. 110m resolution polygons at
 * a 0.5° grid is the right pairing — finer polygons would be wasted here.
 */
function loadLandMask() {
  const file = path.join(DATA, 'land.geojson');
  if (!fs.existsSync(file)) {
    console.log('  land:     land.geojson missing — ocean cells will stay UNKNOWN (honest, but less useful)');
    return null;
  }
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Collect rings with bounding boxes so most cells are rejected cheaply.
  const rings = [];
  for (const f of gj.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const ring = poly[i];
        let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
        rings.push({ ring, minLon, maxLon, minLat, maxLat, hole: i > 0 });
      }
    }
  }

  const land = new Set();
  for (let iy = 0; iy < NY; iy++) {
    const lat = iyToLat(iy);
    for (let ix = 0; ix < NX; ix++) {
      const lon = ixToLon(ix);
      let inside = false;
      for (const r of rings) {
        if (lon < r.minLon || lon > r.maxLon || lat < r.minLat || lat > r.maxLat) continue;
        if (pointInRing(lon, lat, r.ring)) inside = r.hole ? false : true;
      }
      if (inside) land.add(key(ix, iy));
    }
  }
  console.log(`  land:     ${rings.length.toLocaleString()} rings, ${land.size.toLocaleString()} land cells (${(NX * NY - land.size).toLocaleString()} ocean)`);
  return land;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function classify(pop, air, isAirport) {
  if (isAirport) return 'AIRPORT';
  if (air >= 60) return 'AIR_CORRIDOR';
  if (pop >= 1_000_000) return 'DENSE_URBAN';
  if (pop >= 50_000) return 'POPULATED';
  if (pop > 0) return 'SPARSE';
  return null;      // no data — stays UNKNOWN, which reads as UNRESOLVED
}

function build() {
  console.log('Building ground consequence raster from real public datasets...\n');
  const cityCells = loadCities();
  const { byId, cells: airportCells } = loadAirports();
  const routeCells = loadRoutes(byId);
  const landMask = loadLandMask();

  const cells = {};
  const touched = new Set([...cityCells.keys(), ...airportCells.keys(), ...routeCells.keys()]);

  // Every ocean cell is CHARACTERISED as open water. This is the whole reason
  // the land mask is here: "we measured it and it is open water" is a different
  // state from "we never looked", and the completion signal must not conflate
  // the two.
  let water = 0, rural = 0;

  let critical = 0, dense = 0;
  const openWaterIdx2 = Object.keys(CLASSES).indexOf('OPEN_WATER');
  const sparseIdx2 = Object.keys(CLASSES).indexOf('SPARSE');
  for (const k of touched) {
    const pop = cityCells.get(k) || 0;
    const air = routeCells.get(k) || 0;
    const isAirport = airportCells.has(k);
    const cls = classify(pop, air, isAirport);
    if (!cls) {
      // A cell with light air traffic but no settlement is still characterised
      // ground — fall back to the land mask rather than leaving a hole that
      // would read as "never looked at".
      if (landMask) {
        cells[k] = [0, air, landMask.has(k) ? sparseIdx2 : openWaterIdx2];
        if (landMask.has(k)) rural++; else water++;
      }
      continue;
    }
    if (CLASSES[cls].critical) critical++;
    if (cls === 'DENSE_URBAN') dense++;
    // Compact triple: [population, air-traffic count, class index]
    cells[k] = [pop, air, Object.keys(CLASSES).indexOf(cls)];
  }

  if (landMask) {
    const openWaterIdx = Object.keys(CLASSES).indexOf('OPEN_WATER');
    const sparseIdx = Object.keys(CLASSES).indexOf('SPARSE');
    for (let iy = 0; iy < NY; iy++) {
      for (let ix = 0; ix < NX; ix++) {
        const k = key(ix, iy);
        if (touched.has(k)) continue;
        if (landMask.has(k)) {
          // Land with no settlement >= 15,000 and no airport or route. We know
          // what it is — Natural Earth says land, GeoNames says no town — so it
          // is SPARSE, not unknown. The rural population there is undercounted
          // (stated in `limitations`), which biases our casualty numbers
          // OPTIMISTIC. That is the direction worth being explicit about.
          cells[k] = [0, 0, sparseIdx];
          rural++;
        } else {
          cells[k] = [0, 0, openWaterIdx];
          water++;
        }
      }
    }
  }

  const raster = {
    version: 1,
    built_at: new Date().toISOString(),
    resolution_deg: RES,
    nx: NX, ny: NY,
    class_names: Object.keys(CLASSES),
    classes: CLASSES,
    cells,
    stats: {
      occupied_cells: Object.keys(cells).length,
      total_cells: NX * NY,
      critical_cells: critical,
      dense_urban_cells: dense,
      open_water_cells: water,
      rural_land_cells: rural,
    },
    sources: [
      'GeoNames cities15000 (settlements >= 15,000) — https://download.geonames.org/export/dump/',
      'OpenFlights airports.dat + routes.dat — https://github.com/jpatokal/openflights',
      'Natural Earth 110m land polygons — https://www.naturalearthdata.com/',
    ],
    limitations: [
      'Land cells with no settlement >= 15,000 are classed SPARSE with zero recorded population. Real rural population there is non-zero, so casualty estimates are OPTIMISTIC — stated explicitly rather than hidden.',
      'Population is settlement-based, not gridded: rural exposure is UNDERCOUNTED, which makes casualty estimates optimistic. GHSL (EU Copernicus, 100 m) is the production upgrade.',
      'Air traffic is modelled as great-circle paths between scheduled airport pairs; real tracks follow airways and shift daily. Exposure proxy, not a flight plan.',
      'Maritime exposure is not modelled. Cells with no data are UNKNOWN and read as UNRESOLVED, never as empty ocean.',
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(raster));
  const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);

  console.log(`\n  occupied cells: ${raster.stats.occupied_cells.toLocaleString()} of ${(NX * NY).toLocaleString()} (${((raster.stats.occupied_cells / (NX * NY)) * 100).toFixed(1)}%)`);
  console.log(`  dense urban:    ${dense.toLocaleString()}`);
  console.log(`  critical:       ${critical.toLocaleString()} (airports + dense air corridors)`);
  console.log(`  open water:     ${water.toLocaleString()} (characterised, NOT the same as unknown)`);
  console.log(`  rural land:     ${rural.toLocaleString()} (land, no settlement >= 15k)`);
  console.log(`\n  wrote ${OUT} (${mb} MB)`);
}

if (require.main === module) build();

module.exports = { CLASSES, RES, NX, NY, key, lonToIx, latToIy, ixToLon, iyToLat, greatCircle, build };
