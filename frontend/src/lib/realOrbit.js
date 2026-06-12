// Real satellite orbits from CelesTrak TLE data + SGP4 propagation (satellite.js).
// CelesTrak is free, no API key. We proxy it through Vite (/celestrak) to dodge CORS.
import * as satellite from 'satellite.js'

const satrecMap = new Map()   // noradId(number) → satrec

// localStorage TLE cache — TLEs only update a few times/day, so reuse for 6 h.
// This stops repeated page reloads from hammering CelesTrak (which gets us 403-blocked).
const TLE_TTL_MS = 6 * 3600 * 1000
function cacheGet(key) {
  try {
    const raw = localStorage.getItem('tle:' + key)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (Date.now() - o.t > TLE_TTL_MS) return null
    return o.v
  } catch { return null }
}
function cacheSet(key, v) {
  try { localStorage.setItem('tle:' + key, JSON.stringify({ t: Date.now(), v })) } catch { /* quota */ }
}

// Fetch a TLE for one NORAD catalog number. Returns {name, line1, line2} or null.
async function fetchOne(noradId) {
  const cached = cacheGet('c' + noradId)
  if (cached) return cached
  try {
    const res = await fetch(`/celestrak/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=tle`)
    if (!res.ok) return null
    const text = (await res.text()).trim()
    const lines = text.split('\n').map(l => l.trimEnd())
    if (lines.length < 3) return null            // empty / not found
    const out = { name: lines[0].trim(), line1: lines[1], line2: lines[2] }
    cacheSet('c' + noradId, out)
    return out
  } catch {
    return null
  }
}

// Fetch TLEs for a list of NORAD IDs and build SGP4 satrecs.
// Returns the set of NORAD IDs that successfully resolved.
export async function loadRealTLEs(noradIds) {
  const ok = new Set()
  // small concurrency so we don't hammer CelesTrak
  const ids = [...new Set(noradIds.filter(Boolean))]
  const BATCH = 6
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH)
    const tles  = await Promise.all(slice.map(fetchOne))
    tles.forEach((tle, j) => {
      if (!tle) return
      try {
        const rec = satellite.twoline2satrec(tle.line1, tle.line2)
        if (rec && !rec.error) { satrecMap.set(slice[j], rec); ok.add(slice[j]) }
      } catch { /* skip bad TLE */ }
    })
  }
  return ok
}

export function hasRealOrbit(noradId) {
  return satrecMap.has(noradId)
}

// Fetch ONE CelesTrak GROUP (a single request returning many satellites) and
// register satrecs ONLY for the NORAD IDs we actually want. This is the
// rate-limit-safe way: a handful of group calls (cached 6 h) instead of one
// request per satellite. Returns the set of wanted NORAD IDs found in it.
export async function loadGroupForNorads(group, wantedNorads) {
  const wanted = new Set(wantedNorads)
  const found = new Set()
  try {
    let text = cacheGet('g' + group)
    if (!text) {
      const res = await fetch(`/celestrak/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`)
      if (!res.ok) return found                      // don't retry — avoids 403 storms
      text = await res.text()
      if (text && text.length > 50) cacheSet('g' + group, text)
    }
    const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.length)
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const l1 = lines[i + 1], l2 = lines[i + 2]
      if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
      const norad = parseInt(l2.substring(2, 7))
      if (!wanted.has(norad) || satrecMap.has(norad)) continue
      try {
        const rec = satellite.twoline2satrec(l1, l2)
        if (rec && !rec.error) { satrecMap.set(norad, rec); found.add(norad) }
      } catch { /* skip bad TLE */ }
    }
  } catch { /* network error — caller falls back to gateway positions */ }
  return found
}

// Fetch ONE satellite by NORAD id on demand (for search). Returns a display record or null.
export async function loadByNorad(noradId, idOffset = 100000) {
  const tle = await fetchOne(noradId)
  if (!tle) return null
  try {
    const rec = satellite.twoline2satrec(tle.line1, tle.line2)
    if (!rec || rec.error) return null
    satrecMap.set(noradId, rec)
    const n = parseFloat(tle.line2.substring(52, 63))
    const a = Math.cbrt(398600.4418 / Math.pow((n * 2 * Math.PI) / 86400, 2))
    return {
      id: idOffset + noradId,
      norad_id: noradId,
      name: tle.name,
      operator: operatorFor(tle.name),
      alt_km: Math.max(120, Math.round(a - 6371)),
      status: 'NOMINAL',
      risk_score: 10,
      _real: true,
      _group: 'search',
    }
  } catch { return null }
}

function operatorFor(name) {
  const n = name.toUpperCase()
  if (n.includes('STARLINK')) return 'SpaceX'
  if (n.includes('ONEWEB'))   return 'OneWeb'
  if (n.includes('ISS') || n.includes('CSS') || n.includes('TIANHE')) return 'STATION'
  if (n.includes('DEB') || n.includes('R/B')) return 'DEBRIS'
  if (n.includes('IRIDIUM'))  return 'Iridium'
  if (n.includes('GLOBALSTAR')) return 'Globalstar'
  return 'OTHER'
}

// Fetch a whole CelesTrak GROUP (TLE format), register satrecs, return display records.
// Every returned object is a REAL catalogued satellite with a real name + live orbit.
export async function loadGroup(group, limit = 60, idOffset = 100000, groupKey = group) {
  try {
    let text = cacheGet('g' + group)
    if (!text) {
      const res = await fetch(`/celestrak/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`)
      if (!res.ok) return []
      text = await res.text()
      if (text && text.length > 50) cacheSet('g' + group, text)
    }
    const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.length)
    const out = []
    for (let i = 0; i + 2 < lines.length && out.length < limit; i += 3) {
      const name = lines[i].trim()
      const l1 = lines[i + 1], l2 = lines[i + 2]
      if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
      const norad = parseInt(l2.substring(2, 7))
      if (!norad || satrecMap.has(norad)) continue
      try {
        const rec = satellite.twoline2satrec(l1, l2)
        if (!rec || rec.error) continue
        satrecMap.set(norad, rec)
        // mean motion (rev/day) from TLE line 2 cols 53-63 → semi-major axis → altitude
        const n = parseFloat(l2.substring(52, 63))
        const a = Math.cbrt(398600.4418 / Math.pow((n * 2 * Math.PI) / 86400, 2))
        const altKm = Math.max(120, Math.round(a - 6371))
        out.push({
          id: idOffset + norad,
          norad_id: norad,
          name,
          operator: operatorFor(name),
          alt_km: altKm,
          status: 'NOMINAL',
          risk_score: 8 + (norad % 17),   // low, varied — context objects
          _real: true,
          _group: groupKey,
        })
      } catch { /* skip bad record */ }
    }
    return out
  } catch {
    return []
  }
}

// Real geodetic position at a JS Date. Returns {lat, lng, altitude(m)} or null.
export function realLatLng(noradId, jsDate) {
  const rec = satrecMap.get(noradId)
  if (!rec) return null
  const pv = satellite.propagate(rec, jsDate)
  if (!pv || !pv.position) return null
  const gmst = satellite.gstime(jsDate)
  const geo  = satellite.eciToGeodetic(pv.position, gmst)
  return {
    lat:      satellite.degreesLat(geo.latitude),
    lng:      satellite.degreesLong(geo.longitude),
    altitude: geo.height * 1000,   // km → m
  }
}

// Fast Earth-fixed (ECEF) position in METRES for one object. Cheaper than
// realLatLng (no geodetic round-trip) — used for the big 30k points cloud.
// Pass a precomputed gmst to avoid recomputing it per object in bulk loops.
export function ecefAt(noradId, jsDate, gmst) {
  const rec = satrecMap.get(noradId)
  if (!rec) return null
  const pv = satellite.propagate(rec, jsDate)
  if (!pv || !pv.position) return null
  const g = gmst ?? satellite.gstime(jsDate)
  const ecf = satellite.eciToEcf(pv.position, g)   // km, ECEF
  return { x: ecf.x * 1000, y: ecf.y * 1000, z: ecf.z * 1000 }
}
export function gmstOf(jsDate) { return satellite.gstime(jsDate) }

// Real orbital period (minutes) from the satrec's mean motion. Works for ANY
// orbit (LEO/GEO/eccentric) — unlike guessing from a single altitude.
export function periodMinutes(noradId) {
  const rec = satrecMap.get(noradId)
  if (!rec || !rec.no) return null
  return (2 * Math.PI) / rec.no   // satrec.no is rad/min
}

// The orbit as INERTIAL (ECI) points in km over one period, sampled starting
// ~10% before `jsDate`. Drawing these rotated by the *current* gmst each frame
// gives a proper orbit ring (circle for GEO, ellipse for LEO) that the
// satellite always sits on — unlike the Earth-fixed path which warps GEO into
// a figure-8. Returns [{x,y,z}] (ECI km).
export function orbitEciKm(noradId, jsDate, n = 240) {
  const rec = satrecMap.get(noradId)
  if (!rec || !rec.no) return []
  const periodMin = (2 * Math.PI) / rec.no
  const t0 = jsDate.getTime() - 0.1 * periodMin * 60000
  const out = []
  for (let i = 0; i <= n; i++) {
    const pv = satellite.propagate(rec, new Date(t0 + (i / n) * periodMin * 60000))
    if (pv && pv.position) out.push({ x: pv.position.x, y: pv.position.y, z: pv.position.z })
  }
  return out
}
// Rotate one ECI-km point into Earth-fixed metres for the given gmst.
export function eciKmToEcefMeters(pt, gmst) {
  const e = satellite.eciToEcf(pt, gmst)
  return { x: e.x * 1000, y: e.y * 1000, z: e.z * 1000 }
}

// Load the FULL ~31k catalogue from our gateway middleware (/api/catalogue,
// Space-Track 3LE — name + 2 lines per object). Registers every satrec and
// returns [{norad, name, debris}]. The browser never sees Space-Track creds.
export async function loadFullCatalogue() {
  const out = []
  const seen = new Set()
  try {
    const res = await fetch('/api/catalogue')
    if (!res.ok) return out
    const text = await res.text()
    const lines = text.split('\n').map(l => l.trimEnd())
    for (let i = 0; i + 2 < lines.length; i += 3) {
      let name = lines[i]
      const l1 = lines[i + 1], l2 = lines[i + 2]
      if (name.startsWith('0 ')) name = name.slice(2).trim()
      if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
      const norad = parseInt(l2.substring(2, 7))
      if (!norad || seen.has(norad)) continue
      seen.add(norad)
      if (!satrecMap.has(norad)) {
        try {
          const rec = satellite.twoline2satrec(l1, l2)
          if (!rec || rec.error) continue
          satrecMap.set(norad, rec)
        } catch { continue }
      }
      out.push({ norad, name, debris: /\bDEB\b|R\/B|DEBRIS/i.test(name) })
    }
  } catch { /* gateway down — caller falls back to CelesTrak */ }
  return out
}

// Bulk-load the catalogue from one or more CelesTrak GROUPs (cached 6h).
// Registers every satrec and returns [{norad, name, group, debris}] — the
// background "all tracked objects" cloud. One request per group, no per-sat calls.
export async function loadCatalogue(groups) {
  const out = []
  const seen = new Set()
  for (const group of groups) {
    let text = cacheGet('g' + group)
    if (!text) {
      try {
        const res = await fetch(`/celestrak/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`)
        if (!res.ok) continue
        text = await res.text()
        if (text && text.length > 50) cacheSet('g' + group, text)
      } catch { continue }
    }
    const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.length)
    const isDebris = /debris|1999-025/.test(group)
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i].trim(), l1 = lines[i + 1], l2 = lines[i + 2]
      if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
      const norad = parseInt(l2.substring(2, 7))
      if (!norad || seen.has(norad)) continue
      seen.add(norad)
      if (!satrecMap.has(norad)) {
        try {
          const rec = satellite.twoline2satrec(l1, l2)
          if (!rec || rec.error) continue
          satrecMap.set(norad, rec)
        } catch { continue }
      }
      const deb = isDebris || /\bDEB\b|R\/B/.test(name)
      out.push({ norad, name, group, debris: deb })
    }
  }
  return out
}
