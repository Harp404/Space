// Conjunction-screening Web Worker.
// Pulls the full catalogue (3LE) from the gateway, then for a set of PRIMARY
// objects screens against all others for close approaches over a time window:
//   apogee–perigee sieve  →  coarse SGP4 screen  →  fine TCA refine  →  Pc.
// Runs off the main thread so the globe stays smooth. Posts progress + results.
import * as satellite from 'satellite.js'

const MU = 398600.4418      // km^3/s^2
const RE = 6378.137         // km

function orbitParams(rec) {
  const nRadSec = rec.no / 60
  const a = Math.cbrt(MU / (nRadSec * nRadSec))
  const e = rec.ecco
  return { peri: a * (1 - e) - RE, apo: a * (1 + e) - RE }
}

// Screening-grade probability of collision (2-D circular Gaussian, Foster-style).
// Honest: TLEs carry no covariance, so we assume a 1-sigma positional uncertainty
// and a combined hard-body radius. This is a SCREENING estimate, not operational.
function probCollision(missKm) {
  const sigma = 3.0          // km, combined 1-sigma — TLE error grows to a few km over a day
  const hbr = 0.03           // km, combined hard-body radius (~30 m)
  const pc = (hbr * hbr) / (2 * sigma * sigma) * Math.exp(-(missKm * missKm) / (2 * sigma * sigma))
  return Math.min(pc, 1)
}

self.onmessage = async (ev) => {
  const {
    primaries,                 // array of NORAD ids to screen (the "watch list")
    startMs = Date.now(),
    hours = 24,
    coarseSec = 240,
    gateKm = 25,               // apogee-perigee altitude gate
    candidateKm = 10,          // keep approaches closer than this
    maxResults = 12,
  } = ev.data

  // 1) Fetch + parse the catalogue.
  let txt = ''
  try {
    const res = await fetch('/api/catalogue')
    txt = await res.text()
  } catch (e) {
    self.postMessage({ error: 'catalogue fetch failed: ' + e.message }); return
  }
  const lines = txt.split('\n').map((l) => l.trimEnd())
  const objs = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    let name = lines[i]; if (name.startsWith('0 ')) name = name.slice(2).trim()
    const l1 = lines[i + 1], l2 = lines[i + 2]
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
    const norad = parseInt(l2.substring(2, 7)); if (!norad) continue
    try {
      const rec = satellite.twoline2satrec(l1, l2)
      if (!rec || rec.error) continue
      objs.push({ norad, name, rec, ...orbitParams(rec) })
    } catch { /* skip */ }
  }

  // 2) Candidate pairs via apogee-perigee sieve.
  const primarySet = new Set(primaries)
  const prim = objs.filter((o) => primarySet.has(o.norad))
  const pairs = []
  for (const A of prim) {
    for (const B of objs) {
      if (A.norad >= B.norad) continue                 // unordered, no self
      if (A.peri > B.apo + gateKm || B.peri > A.apo + gateKm) continue
      pairs.push([A, B])
    }
  }

  // 3) Coarse screen — propagate only the involved objects once per step (cached).
  const involved = new Map()
  for (const [A, B] of pairs) { involved.set(A.norad, A); involved.set(B.norad, B) }
  const inv = [...involved.values()]
  const steps = Math.ceil((hours * 3600) / coarseSec)
  const best = new Map()
  for (let s = 0; s <= steps; s++) {
    const d = new Date(startMs + s * coarseSec * 1000)
    for (const o of inv) { const pv = satellite.propagate(o.rec, d); o._p = (pv && pv.position) ? pv.position : null }
    for (const [A, B] of pairs) {
      if (!A._p || !B._p) continue
      const dx = A._p.x - B._p.x, dy = A._p.y - B._p.y, dz = A._p.z - B._p.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const k = A.norad + '-' + B.norad
      const c = best.get(k)
      if (!c || dist < c.d) best.set(k, { d: dist, t: d.getTime(), A, B })
    }
    if (s % 20 === 0) self.postMessage({ progress: s / steps, screened: pairs.length, objects: objs.length })
  }

  // 4) Fine TCA refine for sub-candidate-threshold events, + Pc + relative speed.
  const results = []
  for (const c of best.values()) {
    if (c.d > candidateKm) continue
    let bestD = c.d, bestT = c.t
    for (let tt = c.t - coarseSec * 1000; tt <= c.t + coarseSec * 1000; tt += 2000) {
      const d = new Date(tt)
      const pa = satellite.propagate(c.A.rec, d), pb = satellite.propagate(c.B.rec, d)
      if (!pa.position || !pb.position) continue
      const dx = pa.position.x - pb.position.x, dy = pa.position.y - pb.position.y, dz = pa.position.z - pb.position.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist < bestD) { bestD = dist; bestT = tt }
    }
    // relative speed over 1 s at TCA
    const d1 = new Date(bestT), d2 = new Date(bestT + 1000)
    const a1 = satellite.propagate(c.A.rec, d1), b1 = satellite.propagate(c.B.rec, d1)
    const a2 = satellite.propagate(c.A.rec, d2), b2 = satellite.propagate(c.B.rec, d2)
    let relV = 0
    if (a1.position && b1.position && a2.position && b2.position) {
      const r1x = a1.position.x - b1.position.x, r1y = a1.position.y - b1.position.y, r1z = a1.position.z - b1.position.z
      const r2x = a2.position.x - b2.position.x, r2y = a2.position.y - b2.position.y, r2z = a2.position.z - b2.position.z
      relV = Math.sqrt((r2x - r1x) ** 2 + (r2y - r1y) ** 2 + (r2z - r1z) ** 2)
    }
    results.push({
      a: c.A.norad, aName: c.A.name, b: c.B.norad, bName: c.B.name,
      tcaMs: bestT, missKm: bestD, relVelKmS: relV, pc: probCollision(bestD),
    })
  }
  results.sort((x, y) => x.missKm - y.missKm)
  self.postMessage({ conjunctions: results.slice(0, maxResults), screened: pairs.length, objects: objs.length, done: true })
}
