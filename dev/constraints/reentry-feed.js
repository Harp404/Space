/**
 * Official re-entry predictions.        dev/constraints/reentry-feed.js
 * =============================================================================
 * WHAT THIS REPLACES
 *
 * Our re-entry work has been driven by objects we chose and a footprint we
 * modelled. The physics was real, but the EVENTS were ours. That is a fair
 * question for anyone to ask: "is anything actually re-entering, or did you
 * pick one?"
 *
 * Space-Track publishes two classes that answer it with the operational truth:
 *
 *   tip     Tracking and Impact Prediction messages, issued by the 18th Space
 *           Defense Squadron for objects on final decay. Each carries a
 *           predicted DECAY_EPOCH, an uncertainty WINDOW in minutes, and a
 *           predicted impact LAT/LON. They are re-issued as the estimate
 *           tightens — roughly T-4d, T-3d, T-2d, T-1d, T-12h, T-6h, T-2h.
 *
 *   decay   The record of what actually came down, and when.
 *
 * USSPACECOM grants blanket redistribution approval for decay and re-entry
 * data, so this is usable rather than merely visible.
 *
 * WHY IT IS MORE THAN A DATA SOURCE
 *
 * A TIP message is a prediction that CARRIES ITS OWN UNCERTAINTY, and that
 * uncertainty shrinks over a sequence of messages. That is exactly the shape of
 * a completion signal:
 *
 *     WINDOW is +/- 900 minutes  ->  the impact point is anywhere on a
 *                                    circumference. FR-23 airspace and FR-17b
 *                                    consequence CANNOT be evaluated. UNRESOLVED.
 *     WINDOW narrows to +/- 20   ->  the footprint is a region. Now they can.
 *
 * So the same object walks from UNRESOLVED to a real verdict as the Space Force
 * issues better messages — driven by an external feed, on its own schedule,
 * not by anything we control. We could not stage that if we wanted to.
 *
 * HONESTY
 *
 * * A TIP predicted point is where the object is expected to reach a reference
 *   altitude, not where debris lands. We never present it as an impact point
 *   for surviving fragments, and our own footprint stays a separate number.
 * * WINDOW is the operator's stated uncertainty. We use it; we do not shrink it.
 * * If the feed is unavailable, this returns nothing. It never invents an event.
 *
 * Zero dependencies beyond node:https.
 * =============================================================================
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'reentry-feed.json');
const TTL_MS = 3 * 60 * 60 * 1000;      // TIPs are re-issued a few times a day

// Ground speed of a decaying object is ~7.5 km/s, so an uncertainty window in
// minutes maps to an enormous along-track distance. This is the number that
// makes the point: +/-900 minutes is most of the planet.
const GROUND_SPEED_KMS = 7.5;

function httpsGet(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function spaceTrack(queryPath, { identity, password }) {
  if (!identity || !password) throw new Error('Space-Track credentials not configured');
  const body = `identity=${encodeURIComponent(identity)}&password=${encodeURIComponent(password)}`;
  const login = await httpsGet({
    hostname: 'www.space-track.org', path: '/ajaxauth/login', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  const cookies = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (login.status !== 200 || !cookies) throw new Error(`Space-Track login failed (${login.status})`);
  const res = await httpsGet({
    hostname: 'www.space-track.org', path: queryPath, method: 'GET',
    headers: { Cookie: cookies },
  });
  if (res.status !== 200) throw new Error(`Space-Track query failed (${res.status})`);
  return JSON.parse(res.body);
}

/**
 * Turn one TIP into the terms a constraint can reason about.
 *
 * The key derived quantity is `along_track_km`: how far along the ground track
 * the stated time uncertainty spreads the predicted point. An operator's
 * "+/- 900 minutes" is not a caveat, it is 810,000 km of ground track — twenty
 * times around the Earth. A footprint cannot be characterised from that, and
 * the rule should say so rather than draw an ellipse.
 */
function shapeTip(t, now = Date.now()) {
  const decay = Date.parse(t.DECAY_EPOCH + 'Z') || Date.parse(t.DECAY_EPOCH);
  const msg = Date.parse(t.MSG_EPOCH + 'Z') || Date.parse(t.MSG_EPOCH);
  const windowMin = Number(t.WINDOW);
  const lat = Number(t.LAT), lon = Number(t.LON);
  const alongKm = Number.isFinite(windowMin) ? windowMin * 60 * GROUND_SPEED_KMS : null;

  return {
    norad: Number(t.NORAD_CAT_ID),
    msg_epoch: t.MSG_EPOCH,
    decay_epoch: t.DECAY_EPOCH,
    decay_ms: Number.isFinite(decay) ? decay : null,
    hours_to_decay: Number.isFinite(decay) ? +((decay - now) / 3600000).toFixed(2) : null,
    window_min: Number.isFinite(windowMin) ? windowMin : null,
    // The honest consequence of that window.
    along_track_km: alongKm != null ? Math.round(alongKm) : null,
    earth_circumferences: alongKm != null ? +(alongKm / 40075).toFixed(1) : null,
    predicted_lat: Number.isFinite(lat) ? lat : null,
    predicted_lon: Number.isFinite(lon) ? lon : null,
    direction: t.DIRECTION || null,
    next_report_h: t.NEXT_REPORT != null ? Number(t.NEXT_REPORT) : null,
    source: 'Space-Track TIP (18th Space Defense Squadron)',
    id: t.ID,
    // What the constraint engine needs to decide whether it can evaluate at all.
    footprint_characterisable: alongKm != null && alongKm < 5000,
    reason_if_not: alongKm != null && alongKm >= 5000
      ? `the stated +/-${windowMin} minute window spreads the predicted point over ${Math.round(alongKm).toLocaleString()} km of ground track — a footprint cannot be characterised, so consequence and airspace rules are UNEVALUATED`
      : null,
  };
}

/** Live TIP messages, newest first, cached so the demo survives a dead network. */
async function fetchTips({ identity, password, limit = 60, force = false, now = Date.now() } = {}) {
  if (!force) {
    try {
      const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (now - j.fetched < TTL_MS) return { ...j, cached: true };
    } catch { /* no cache */ }
  }

  const rows = await spaceTrack(
    `/basicspacedata/query/class/tip/orderby/MSG_EPOCH%20desc/limit/${limit}/format/json`,
    { identity, password },
  );

  // Several messages per object; keep the most recent per NORAD, since a later
  // TIP supersedes an earlier one.
  const latest = new Map();
  for (const r of rows) {
    const s = shapeTip(r, now);
    const prev = latest.get(s.norad);
    if (!prev || (s.decay_ms || 0) > (prev.decay_ms || 0)) latest.set(s.norad, s);
  }

  const out = {
    fetched: now,
    source: 'Space-Track class=tip — USSPACECOM grants blanket redistribution approval for decay and re-entry data',
    messages: rows.length,
    objects: [...latest.values()].sort((a, b) => (a.decay_ms || 0) - (b.decay_ms || 0)),
    cached: false,
  };
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
  } catch { /* cache is a convenience */ }
  return out;
}

/**
 * The message sequence for one object, so the UI can show the uncertainty
 * actually collapsing. This is the part no simulation can fake: the Space
 * Force decides when the next message lands, not us.
 */
async function tipHistory(norad, { identity, password, now = Date.now() } = {}) {
  const rows = await spaceTrack(
    `/basicspacedata/query/class/tip/NORAD_CAT_ID/${Number(norad)}/orderby/MSG_EPOCH%20asc/format/json`,
    { identity, password },
  );
  const seq = rows.map((r) => shapeTip(r, now));
  const first = seq[0], last = seq[seq.length - 1];
  return {
    norad: Number(norad),
    messages: seq.length,
    sequence: seq,
    // Did the operator's own uncertainty actually shrink?
    window_first_min: first ? first.window_min : null,
    window_last_min: last ? last.window_min : null,
    tightened_by: (first && last && first.window_min && last.window_min)
      ? +(first.window_min / last.window_min).toFixed(1) : null,
  };
}

module.exports = { fetchTips, tipHistory, shapeTip, GROUND_SPEED_KMS };
