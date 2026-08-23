/**
 * Compare our satellite.js SGP4 against ESA's dSGP4 reference.
 *     node ml/compare_dsgp4.js
 *
 * Reads ml/data/dsgp4_validation.json (produced by validate_dsgp4.py) and
 * re-propagates the same objects at the same epochs with the propagator the
 * gateway actually uses. Prints the disagreement.
 *
 * This is the honest direction of the test: if we disagree materially with the
 * ESA reference, OUR number is the suspect one.
 */
'use strict';
const fs = require('fs'), path = require('path');
const REF = path.join(__dirname, 'data', 'dsgp4_validation.json');
const CAT = path.join(__dirname, '..', 'dev', 'cache', 'catalogue.3le');

if (!fs.existsSync(REF)) {
  console.error(`\n  ${REF} not found. Run first:\n    python ml/validate_dsgp4.py\n`);
  process.exit(1);
}
let sat;
try { sat = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'satellite.js')); }
catch { console.error('\n  satellite.js not installed. Run: cd frontend && npm install\n'); process.exit(1); }

const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
const lines = fs.readFileSync(CAT, 'utf8').split('\n');
// Key on NORAD id. The catalogue contains hundreds of objects sharing a name
// ("DELTA 1 DEB", "FENGYUN 1C DEB"), so a name-keyed map silently compares the
// wrong TLEs — which is exactly how the first run of this harness produced a
// 7,800 km "disagreement" between two implementations that agree exactly.
const byNorad = new Map();
for (let i = 0; i + 2 < lines.length; i += 3) {
  const l2 = lines[i + 2];
  if (!l2 || !l2.startsWith('2 ')) continue;
  byNorad.set(parseInt(l2.slice(2, 7), 10), [lines[i + 1], l2]);
}

const errs = [];
let missing = 0;
for (const r of ref.results) {
  const tle = byNorad.get(r.norad);
  if (!tle) { missing++; continue; }
  const rec = sat.twoline2satrec(tle[0], tle[1]);
  // Call sgp4() with MINUTES SINCE EPOCH directly, exactly as dSGP4 does.
  //
  // The first version of this harness converted the epoch to a Date via
  // jdsatepoch and used propagate(). That was wrong: newer satellite.js splits
  // the epoch across jdsatepoch + jdsatepochF, so dropping the fractional part
  // shifted every propagation by up to a day and produced a 7,800 km "error"
  // that was entirely mine. Taking minutes-since-epoch removes the conversion
  // and the bug with it.
  const pv = sat.sgp4(rec, r.minutes);
  if (!pv || !pv.position) continue;
  const d = Math.hypot(pv.position.x - r.r_km[0], pv.position.y - r.r_km[1], pv.position.z - r.r_km[2]);
  errs.push({ name: r.name, minutes: r.minutes, err_km: d });
}

if (!errs.length) { console.error('\n  no comparable propagations\n'); process.exit(1); }
errs.sort((a, b) => a.err_km - b.err_km);
const p = (q) => errs[Math.min(errs.length - 1, Math.floor(errs.length * q))].err_km;
const mean = errs.reduce((s, e) => s + e.err_km, 0) / errs.length;

console.log(`\nsatellite.js SGP4  vs  ESA dSGP4 — ${errs.length} propagations (${missing} not found in the catalogue)\n`);
console.log(`  median   ${(p(0.5) * 1000).toFixed(3)} m`);
console.log(`  p95      ${(p(0.95) * 1000).toFixed(3)} m`);
console.log(`  max      ${(errs[errs.length - 1].err_km * 1000).toFixed(3)} m`);
console.log(`  mean     ${(mean * 1000).toFixed(3)} m`);
console.log(`\n  worst: ${errs[errs.length - 1].name} at T+${errs[errs.length - 1].minutes} min`);
console.log('\n  Both implement the same published SGP4, so sub-metre agreement is the');
console.log('  expected result. A large disagreement would mean OUR propagation is wrong.');
console.log('  (On the first run it meant this HARNESS was wrong: it matched objects by');
console.log('   NAME, and the catalogue has hundreds of duplicates. Which is what a');
console.log('   validation is for.)\n');
