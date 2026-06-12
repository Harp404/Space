/**
 * AstroMesh Mock Gateway — dev/mock-gateway.js
 * Pure Node.js (zero npm deps) development server on port 8090.
 * Simulates the full 4-node AstroMesh cluster with Bully election + 2PC consensus.
 *
 * Usage: node mock-gateway.js
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = 8090;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let nodes, satellites, conjunctions, leaderId, agentEnabled;
let tleCache = { data: null, ts: 0 };

function seedState() {
  nodes = [
    { id: 1, name: 'ISRO',   online: true },
    { id: 2, name: 'ESA',    online: true },
    { id: 3, name: 'JAXA',   online: true },
    { id: 4, name: 'SpaceX', online: true },
  ];

  satellites = [
    // All NORAD IDs verified real & currently tracked on CelesTrak (2026-06-10) — name matches the actual catalogued object
    { id:  1, norad_id: 25544, name: 'ISS (ZARYA)',        operator: 'NASA/Roscosmos', lat:  28.5,  lon:   77.2,  alt_km:  408, status: 'NOMINAL',   risk_score: 15 },
    { id:  2, norad_id: 44714, name: 'STARLINK-1008',      operator: 'SpaceX',         lat:  53.1,  lon: -120.3,  alt_km:  550, status: 'NOMINAL',   risk_score: 45 },
    { id:  3, norad_id: 33757, name: 'COSMOS-2251 DEB',    operator: 'DEBRIS',         lat:  72.8,  lon:   45.1,  alt_km:  786, status: 'NOMINAL',   risk_score: 82 },
    { id:  4, norad_id: 33773, name: 'IRIDIUM-33 DEB',     operator: 'DEBRIS',         lat: -33.2,  lon:  155.4,  alt_km:  776, status: 'NOMINAL',   risk_score: 78 },
    { id:  5, norad_id: 40697, name: 'SENTINEL-2A',        operator: 'ESA',            lat:  15.7,  lon:   32.8,  alt_km:  786, status: 'NOMINAL',   risk_score: 22 },
    { id:  6, norad_id: 44804, name: 'CARTOSAT-3',         operator: 'ISRO',           lat:  20.1,  lon:   78.9,  alt_km:  509, status: 'NOMINAL',   risk_score: 18 },
    { id:  7, norad_id: 36411, name: 'GOES-15',            operator: 'NOAA',           lat:   0.0,  lon: -135.0,  alt_km:35786, status: 'NOMINAL',   risk_score:  5 },
    { id:  8, norad_id: 44718, name: 'STARLINK-1012',      operator: 'SpaceX',         lat:  48.5,  lon:   12.3,  alt_km:  550, status: 'NOMINAL',   risk_score: 55 },
    { id:  9, norad_id: 33758, name: 'COSMOS-2251 DEB',    operator: 'DEBRIS',         lat: -45.2,  lon:  100.1,  alt_km:  786, status: 'NOMINAL',   risk_score: 71 },
    { id: 10, norad_id: 39766, name: 'ALOS-2',             operator: 'JAXA',           lat:  35.7,  lon:  139.7,  alt_km:  628, status: 'NOMINAL',   risk_score: 12 },
    { id: 11, norad_id: 44723, name: 'STARLINK-1017',      operator: 'SpaceX',         lat:  61.2,  lon:  -88.4,  alt_km:  550, status: 'NOMINAL',   risk_score: 62 },
    { id: 12, norad_id: 44057, name: 'ONEWEB-0012',        operator: 'OneWeb',         lat:  55.0,  lon:   20.0,  alt_km: 1200, status: 'NOMINAL',   risk_score: 38 },
    { id: 13, norad_id: 44058, name: 'ONEWEB-0010',        operator: 'OneWeb',         lat:  57.3,  lon:   25.8,  alt_km: 1200, status: 'NOMINAL',   risk_score: 41 },
    { id: 14, norad_id: 16182, name: 'SL-16 R/B',          operator: 'DEBRIS',         lat: -60.1,  lon:   88.2,  alt_km:  853, status: 'NOMINAL',   risk_score: 74 },
    { id: 15, norad_id: 29733, name: 'FENGYUN-1C DEB',     operator: 'DEBRIS',         lat:  40.1,  lon:  110.5,  alt_km:  845, status: 'NOMINAL',   risk_score: 90 },
    { id: 16, norad_id: 50032, name: 'COSMOS-1408 DEB',    operator: 'DEBRIS',         lat:  65.4,  lon:   58.7,  alt_km:  802, status: 'NOMINAL',   risk_score: 69 },
    { id: 17, norad_id: 44725, name: 'STARLINK-1020',      operator: 'SpaceX',         lat:  44.2,  lon:  -70.3,  alt_km:  550, status: 'NOMINAL',   risk_score: 33 },
    { id: 18, norad_id: 33775, name: 'IRIDIUM-33 DEB',     operator: 'DEBRIS',         lat:  30.5,  lon:  120.1,  alt_km:  776, status: 'NOMINAL',   risk_score: 57 },
    { id: 19, norad_id: 44741, name: 'STARLINK-1036',      operator: 'SpaceX',         lat: -12.8,  lon:  -60.2,  alt_km:  550, status: 'NOMINAL',   risk_score: 28 },
    { id: 20, norad_id: 44059, name: 'ONEWEB-0008',        operator: 'OneWeb',         lat:  80.1,  lon:   15.4,  alt_km: 1200, status: 'NOMINAL',   risk_score: 47 },
  ];

  conjunctions = [
    {
      id: 1, sat1_id: 3,  sat2_id: 4,  sat1_name: 'COSMOS-2251 DEB', sat2_name: 'IRIDIUM-33 DEB',
      tca: '2026-06-10T14:32:00Z', min_range_km: 0.08, probability: 0.12, risk_index: 88.5, status: 'MONITORING',
    },
    {
      id: 2, sat1_id: 2,  sat2_id: 8,  sat1_name: 'STARLINK-1008',   sat2_name: 'STARLINK-1012',
      tca: '2026-06-10T18:45:00Z', min_range_km: 0.31, probability: 0.07, risk_index: 67.2, status: 'MONITORING',
    },
    {
      id: 3, sat1_id: 9,  sat2_id: 5,  sat1_name: 'COSMOS-2251 DEB', sat2_name: 'SENTINEL-2A',
      tca: '2026-06-11T02:12:00Z', min_range_km: 0.55, probability: 0.04, risk_index: 52.1, status: 'MONITORING',
    },
    {
      id: 4, sat1_id: 15, sat2_id: 14, sat1_name: 'FENGYUN-1C DEB',  sat2_name: 'SL-16 R/B',
      tca: '2026-06-11T09:05:00Z', min_range_km: 0.19, probability: 0.09, risk_index: 79.4, status: 'MONITORING',
    },
    {
      id: 5, sat1_id: 16, sat2_id: 12, sat1_name: 'COSMOS-1408 DEB', sat2_name: 'ONEWEB-0012',
      tca: '2026-06-11T21:30:00Z', min_range_km: 0.42, probability: 0.03, risk_index: 44.0, status: 'APPROVED',
    },
    {
      id: 6, sat1_id: 11, sat2_id: 17, sat1_name: 'STARLINK-1017',   sat2_name: 'STARLINK-1020',
      tca: '2026-06-12T06:18:00Z', min_range_km: 0.27, probability: 0.05, risk_index: 38.7, status: 'RESOLVED',
    },
    {
      id: 7, sat1_id: 18, sat2_id: 1,  sat1_name: 'IRIDIUM-33 DEB',  sat2_name: 'ISS (ZARYA)',
      tca: '2026-06-12T14:50:00Z', min_range_km: 0.93, probability: 0.01, risk_index: 22.3, status: 'MONITORING',
    },
    {
      id: 8, sat1_id: 3,  sat2_id: 15, sat1_name: 'COSMOS-2251 DEB', sat2_name: 'FENGYUN-1C DEB',
      tca: '2026-06-13T03:44:00Z', min_range_km: 0.12, probability: 0.10, risk_index: 91.0, status: 'MONITORING',
    },
  ];

  leaderId = computeLeader();
  agentEnabled = false;
}

function computeLeader() {
  const online = nodes.filter(n => n.online);
  if (online.length === 0) return null;
  return online.reduce((best, n) => (n.id > best.id ? n : best)).id;
}

seedState();

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

const wsClients = new Set();

/** Compute Sec-WebSocket-Accept from the client key */
function wsAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

/** Encode a text frame */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + opcode text
    header[1] = len;
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    // write 64-bit big-endian length (high 32 bits are 0 for sane payloads)
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

/** Parse a single WebSocket frame from a buffer; returns {opcode, payload, consumed} or null */
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const fin  = (buf[0] & 0x80) !== 0;   // eslint-disable-line no-unused-vars
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < offset + 2) return null;
    payloadLen = buf.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLen === 127) {
    if (buf.length < offset + 8) return null;
    // treat as 32-bit (high 4 bytes assumed 0)
    payloadLen = buf.readUInt32BE(offset + 4);
    offset += 8;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + payloadLen) return null;

  let payload;
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = buf[offset + i] ^ mask[i % 4];
    }
    offset += payloadLen;
  } else {
    payload = buf.slice(offset, offset + payloadLen);
    offset += payloadLen;
  }

  return { opcode, payload, consumed: offset };
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  const frame = encodeTextFrame(msg);
  for (const sock of wsClients) {
    try { sock.write(frame); } catch (_) { wsClients.delete(sock); }
  }
}

function handleWsUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = wsAccept(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );

  wsClients.add(socket);
  let buf = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length > 0) {
      const frame = parseFrame(buf);
      if (!frame) break;
      buf = buf.slice(frame.consumed);
      if (frame.opcode === 0x8) {
        // close
        wsClients.delete(socket);
        socket.destroy();
        return;
      }
      if (frame.opcode === 0x9) {
        // ping → pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a; pong[1] = 0x00;
        socket.write(pong);
      }
      // text frames from client: ignore for now
    }
  });

  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
}

// ---------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------

// Orbital drift — every 4 s
setInterval(() => {
  for (const sat of satellites) {
    sat.lat = Math.max(-90,  Math.min(90,  sat.lat + (Math.random() - 0.5)));
    sat.lon = ((sat.lon + (Math.random() - 0.5) * 2 + 180) % 360) - 180;
  }
  broadcast('NETWORK_UPDATE', fullState());
}, 4000);

// AI agent — every 10 s
setInterval(() => {
  if (!agentEnabled) return;
  const monitoring = conjunctions.filter(c => c.status === 'MONITORING');
  if (monitoring.length === 0) return;
  const top = monitoring.reduce((a, b) => (a.risk_index >= b.risk_index ? a : b));
  if (top.risk_index > 70) {
    broadcast('CONJUNCTION_ALERT', { conjunction: top, agent: true });
    // simulate auto-maneuver
    setTimeout(() => {
      top.status = 'APPROVED';
      broadcast('MANEUVER_EVENT', {
        conjunction_id: top.id,
        status: 'APPROVED',
        trigger: 'AGENT_AUTO',
        votes: nodes.filter(n => n.online).map(n => ({ node_id: n.id, vote: 'YES' })),
      });
    }, 600);
  }
}, 10000);

// Passive monitoring alerts — fires every 25s to keep the feed alive even with agent off
setInterval(() => {
  const monitoring = conjunctions.filter(c => c.status === 'MONITORING' && c.risk_index > 40);
  if (monitoring.length === 0) return;
  const pick = monitoring[Math.floor(Math.random() * monitoring.length)];
  broadcast('CONJUNCTION_ALERT', {
    conjunction: pick,
    agent: false,
    source: 'SOCRATES_SCREEN',
  });
}, 25000);

// Startup burst — send 3 events after 3s so the feed isn't empty
setTimeout(() => {
  const hi = conjunctions.filter(c => c.risk_index > 60);
  for (const c of hi.slice(0, 3)) {
    broadcast('CONJUNCTION_ALERT', { conjunction: c, source: 'INITIAL_SCREEN' });
  }
  broadcast('LEADER_CHANGE', { previous_leader: null, new_leader: leaderId, reason: 'Cluster initialised — Bully election complete' });
}, 3000);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); }
    });
  });
}

function fullState() {
  return {
    nodes,
    satellites,
    conjunctions,
    leader_id: leaderId,
  };
}

function replicationSummary() {
  const result = {};
  for (const n of nodes) {
    result[String(n.id)] = {
      nodeId: n.id,
      lastLogId: conjunctions.filter(c => c.status === 'APPROVED').length + Math.floor(Math.random() * 3),
      online: n.online,
    };
  }
  return { nodes: result };
}

// ---------------------------------------------------------------------------
// 2PC consensus
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runConsensus(conj) {
  const delay = 800 + Math.floor(Math.random() * 400);
  await sleep(delay);

  const onlineNodes = nodes.filter(n => n.online);
  const votes = onlineNodes.map(n => {
    const voteYes = conj.risk_index > 40 || Math.random() < 0.70;
    return { node_id: n.id, node_name: n.name, vote: voteYes ? 'YES' : 'NO' };
  });

  const yesCount = votes.filter(v => v.vote === 'YES').length;
  const approved = yesCount >= 3;
  conj.status = approved ? 'APPROVED' : 'DENIED';

  broadcast('MANEUVER_EVENT', {
    conjunction_id: conj.id,
    status: conj.status,
    votes,
    yes_count: yesCount,
    duration_ms: delay,
  });

  return { status: conj.status, votes, duration_ms: delay };
}

// ---------------------------------------------------------------------------
// CelesTrak TLE proxy
// ---------------------------------------------------------------------------

const MOCK_TLE = `ISS (ZARYA)
1 25544U 98067A   26160.50000000  .00016717  00000-0  10270-3 0  9993
2 25544  51.6400 208.9163 0006703  86.2996 273.5478 15.49012691000000
STARLINK-2120
1 48274U 21024B   26160.50000000  .00002103  00000-0  15248-3 0  9991
2 48274  53.0543  10.5234 0001234  90.1234 269.9999 15.06386714000000
STARLINK-1007
1 44713U 19074B   26160.50000000  .00001800  00000-0  13100-3 0  9998
2 44713  53.0002  15.1234 0001100  88.0000 271.9999 15.06380001000000
STARLINK-2609
1 47528U 21015B   26160.50000000  .00001900  00000-0  13800-3 0  9994
2 47528  53.0543  12.5678 0001010  91.2345 268.7654 15.06385714000000
STARLINK-3009
1 48900U 21060B   26160.50000000  .00001700  00000-0  12300-3 0  9997
2 48900  53.0200  18.3456 0001050  87.6543 272.3457 15.06384321000000
`;

function fetchTLE(group) {
  return new Promise((resolve) => {
    const now = Date.now();
    if (tleCache.data && now - tleCache.ts < 3600 * 1000) {
      resolve(tleCache.data);
      return;
    }
    const tleUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    https.get(tleUrl, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode === 200 && data.length > 10) {
          tleCache = { data, ts: now };
          resolve(data);
        } else {
          resolve(MOCK_TLE);
        }
      });
    }).on('error', () => resolve(MOCK_TLE));
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path   = parsed.pathname;
  const method = req.method.toUpperCase();

  // Preflight
  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- GET routes ----

  if (method === 'GET' && path === '/health') {
    return json(res, 200, { status: 'ok', leader_id: leaderId });
  }

  if (method === 'GET' && path === '/api/network') {
    return json(res, 200, fullState());
  }

  if (method === 'GET' && path === '/api/conjunctions') {
    return json(res, 200, conjunctions);
  }

  if (method === 'GET' && path === '/api/satellites') {
    return json(res, 200, satellites);
  }

  if (method === 'GET' && path === '/current-leader') {
    return json(res, 200, { currentLeaderId: leaderId });
  }

  if (method === 'GET' && path === '/replication-summary') {
    return json(res, 200, replicationSummary());
  }

  if (method === 'GET' && path === '/api/tle') {
    const group = parsed.searchParams.get('group') || 'starlink';
    const tleData = await fetchTLE(group);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(tleData);
    return;
  }

  // ---- POST routes ----

  if (method === 'POST' && path === '/api/maneuver/request') {
    const body = await readBody(req);
    const conj = conjunctions.find(c => c.id === Number(body.conjunction_id));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });
    if (conj.status === 'APPROVED') return json(res, 200, { status: 'APPROVED', message: 'Already approved' });

    // Check leader
    if (leaderId === null) return json(res, 503, { error: 'No leader elected — too many nodes offline' });

    const result = await runConsensus(conj);
    return json(res, 200, result);
  }

  if (method === 'POST' && path === '/api/maneuver/emergency') {
    const body = await readBody(req);
    const conj = conjunctions.find(c => c.id === Number(body.conjunction_id));
    if (!conj) return json(res, 404, { error: 'Conjunction not found' });

    conj.status = 'APPROVED';
    broadcast('CONJUNCTION_ALERT', { conjunction: conj, emergency: true });
    setTimeout(() => {
      broadcast('MANEUVER_EVENT', {
        conjunction_id: conj.id,
        status: 'APPROVED',
        trigger: 'EMERGENCY',
        votes: nodes.filter(n => n.online).map(n => ({ node_id: n.id, node_name: n.name, vote: 'YES' })),
        duration_ms: 0,
      });
    }, 100);
    return json(res, 200, { status: 'APPROVED', trigger: 'EMERGENCY' });
  }

  if (method === 'POST' && path === '/api/agent/toggle') {
    const body = await readBody(req);
    agentEnabled = Boolean(body.enabled);
    return json(res, 200, { agent_enabled: agentEnabled });
  }

  // Node control
  const stopMatch  = path.match(/^\/control\/node\/(\d+)\/stop$/);
  const startMatch = path.match(/^\/control\/node\/(\d+)\/start$/);

  if (method === 'POST' && stopMatch) {
    const nodeId = Number(stopMatch[1]);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return json(res, 404, { error: 'Node not found' });
    node.online = false;
    const prevLeader = leaderId;
    leaderId = computeLeader();
    if (prevLeader !== leaderId) {
      broadcast('LEADER_CHANGE', { previous_leader: prevLeader, new_leader: leaderId, reason: `Node ${nodeId} went offline` });
    }
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { node_id: nodeId, online: false, leader_id: leaderId });
  }

  if (method === 'POST' && startMatch) {
    const nodeId = Number(startMatch[1]);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return json(res, 404, { error: 'Node not found' });
    node.online = true;
    const prevLeader = leaderId;
    leaderId = computeLeader();
    if (prevLeader !== leaderId) {
      broadcast('LEADER_CHANGE', { previous_leader: prevLeader, new_leader: leaderId, reason: `Node ${nodeId} came online` });
    }
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { node_id: nodeId, online: true, leader_id: leaderId });
  }

  if (method === 'POST' && path === '/reset') {
    seedState();
    broadcast('NETWORK_UPDATE', fullState());
    return json(res, 200, { status: 'reset', leader_id: leaderId });
  }

  // 404
  cors(res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path }));
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[error]', err);
    try {
      cors(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    } catch (_) {}
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws' && req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    // Re-attach any pre-buffered data
    if (head && head.length > 0) socket.unshift(head);
    handleWsUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`\nAstroMesh Mock Gateway running on http://localhost:${PORT}`);
  console.log(`  WebSocket:        ws://localhost:${PORT}/ws`);
  console.log(`  Network state:    GET  /api/network`);
  console.log(`  Conjunctions:     GET  /api/conjunctions`);
  console.log(`  Satellites:       GET  /api/satellites`);
  console.log(`  Maneuver request: POST /api/maneuver/request  {conjunction_id}`);
  console.log(`  Emergency:        POST /api/maneuver/emergency {conjunction_id}`);
  console.log(`  Agent toggle:     POST /api/agent/toggle       {enabled:bool}`);
  console.log(`  Node stop:        POST /control/node/:id/stop`);
  console.log(`  Node start:       POST /control/node/:id/start`);
  console.log(`  Reset:            POST /reset`);
  console.log(`  Health:           GET  /health`);
  console.log(`\nLeader: Node ${leaderId} (Bully — highest online ID)\n`);
});
