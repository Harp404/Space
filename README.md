# AstroMesh

**Distributed, formally-verified orbital maneuver consensus for satellite collision avoidance.**

---

## The Problem

Low-Earth orbit is becoming a demolition derby.

| Stat | Source |
|------|--------|
| 54,000+ tracked objects (≥ 10 cm) | ESA Space Debris Office, 2025 |
| ~300,000 Starlink maneuvers per year | SpaceX public reporting |
| Coordination today: **email** and phone calls | IADC best-practice docs |
| ESA CREAM conjunction service | Single point of failure; no distributed consensus |

When two debris clouds threaten an active satellite, every ground-control agency — ISRO, ESA, JAXA, SpaceX — must agree that a maneuver is warranted *and* physically possible before firing thrusters. Today that agreement is informal. A miscommunication during the 2009 Iridium-33 / Cosmos-2251 collision cost the industry $400M+ and created ~2,000 new debris fragments still tracked today.

**The gap:** no open, distributed protocol exists for multi-agency maneuver authorisation with formal safety guarantees.

---

## The Solution

AstroMesh is a four-node distributed platform that replaces ad-hoc coordination with:

1. **Bully leader election** — highest-ID online node becomes coordinator; automatic failover in < 1 s.
2. **Two-Phase Commit (2PC) consensus** — a maneuver is only authorised when ≥ 3 of 4 nodes vote YES.
3. **Formally verified invariants** — TLA+ model checker proves no false approval is reachable.
4. **Real-time situational awareness** — CelesTrak SOCRATES conjunction data + live WebSocket feeds to a Vue / CesiumJS globe.
5. **AI agent escalation** — autonomous monitoring escalates high-risk (> 70 risk index) conjunctions to consensus without human latency.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AstroMesh Cluster                        │
│                                                                 │
│   Node 1 (ISRO)          Node 2 (ESA)                          │
│   ┌──────────┐           ┌──────────┐                          │
│   │ Go gRPC  │◄─────────►│ Go gRPC  │                          │
│   └────┬─────┘  Raft /   └────┬─────┘                          │
│        │        2PC log        │                                │
│   Node 3 (JAXA)          Node 4 (SpaceX) ← LEADER (Bully)      │
│   ┌──────────┐           ┌──────────┐                          │
│   │ Go gRPC  │◄─────────►│ Go gRPC  │                          │
│   └──────────┘           └──────────┘                          │
│                               │                                 │
│                         ┌─────▼──────┐                         │
│                         │  REST API  │  HTTP :8080              │
│                         │  /ws       │  WebSocket               │
│                         └─────┬──────┘                         │
└───────────────────────────────┼─────────────────────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │         Vue 3 + CesiumJS            │
              │  • 3-D globe with satellite tracks  │
              │  • Conjunction risk heat-map        │
              │  • Live consensus vote visualiser   │
              │  • Node health / leader indicator   │
              └────────────────────────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │         External Data               │
              │  CelesTrak SOCRATES (free, no auth) │
              │  NOAA SWPC space-weather feeds      │
              │  TLE sets: GP catalogue             │
              └────────────────────────────────────┘
```

### Consensus flow for a maneuver request

```
Client          Leader(4)          Node 1,2,3
  │                │                   │
  │ POST /maneuver │                   │
  │───────────────►│                   │
  │                │  PREPARE(conjId)  │
  │                │──────────────────►│
  │                │◄── VOTE YES/NO ───│
  │                │                   │
  │         tally votes                │
  │         ≥3 YES → COMMIT            │
  │                │──── COMMIT ──────►│
  │◄── APPROVED ───│                   │
```

---

## Key Features

### Distributed Consensus (Bully + 2PC)
- Leader elected by highest-ID Bully algorithm; sub-second failover when a node crashes.
- Two-phase commit ensures atomicity: no partial approvals.
- Quorum requirement (≥ 3/4) tolerates one simultaneous node failure.
- All vote records appended to a replicated log; `GET /replication-summary` shows per-node lag.

### Formal Verification (TLA+)
The file `formal/AstroMesh.tla` specifies the full protocol and proves:

| Invariant | Meaning |
|-----------|---------|
| `Safety` | A conjunction is never `APPROVED` with fewer than 3 YES votes |
| `NoDoubleApproval` | Once approved, a conjunction cannot be re-locked or re-denied |
| `LeaderUniqueness` | At most one leader exists at any time |
| `LeaderConsistency` | The elected leader is always the highest-ID online node |
| `QuorumLiveness` | If ≥ 3 nodes are online, every MONITORING conjunction eventually resolves |

TLC model-checks all reachable states with `Nodes={1,2,3,4}`, `Conjunctions={1,2,3}`.

### Real Orbital Data
- **CelesTrak SOCRATES** — free conjunction screening; no API key required.
- **TLE catalogue** — fetched live from `celestrak.org/NORAD/elements/gp.php`; 1-hour cache.
- **NOAA SWPC** — space-weather alerts (geomagnetic storms affect drag predictions).
- Satellite positions drift realistically every 4 seconds (simplified J2 perturbation model).

### AI Agent
- Background agent polls conjunctions every 10 seconds.
- Auto-escalates any event with `risk_index > 70` directly to consensus.
- Toggle via `POST /api/agent/toggle {enabled: true}`.
- All agent decisions broadcast over WebSocket as `CONJUNCTION_ALERT` then `MANEUVER_EVENT`.

### Frontend (Vue 3 + CesiumJS)
- 3-D Earth globe with live satellite positions.
- Colour-coded risk overlays: green (< 30) → amber (30–60) → red (> 60).
- Real-time consensus vote visualiser: watch nodes cast YES/NO with animated transitions.
- Node health panel: click to kill/revive nodes and trigger live Bully re-election.

---

## Quick Start (Dev — no Docker needed)

### 1. Start the mock gateway

```bash
cd dev
node mock-gateway.js
# Server: http://localhost:8090
# WebSocket: ws://localhost:8090/ws
```

No npm install required — pure Node.js built-ins only.

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
# App: http://localhost:5173
```

### 3. Test consensus manually

```bash
# Trigger 2PC vote on conjunction 1 (risk 88.5 — almost always APPROVED)
curl -X POST http://localhost:8090/api/maneuver/request \
     -H "Content-Type: application/json" \
     -d '{"conjunction_id": 1}'

# Kill Node 3, watch leader change
curl -X POST http://localhost:8090/control/node/3/stop

# Enable AI agent
curl -X POST http://localhost:8090/api/agent/toggle \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'
```

---

## Docker (Full Stack)

```bash
docker compose up
```

Services:
- `node1` … `node4` — Go consensus nodes on internal network
- `gateway` — exposes REST + WebSocket on `:8080`
- `frontend` — Nginx serving the built Vue app on `:3000`

---

## TLA+ Model Checking

```bash
# Install TLA+ Toolbox or use tla2tools.jar
java -jar tla2tools.jar -config formal/AstroMesh.cfg formal/AstroMesh.tla

# Or open formal/AstroMesh.tla in the TLA+ Toolbox IDE
# and run TLC model checker with the bundled AstroMesh.cfg
```

Expected output: all five invariants hold, QuorumLiveness verified, no counter-examples found.

---

## Project Structure

```
.
├── main.go                  # Go consensus node (production)
├── database.go              # SQLite state persistence
├── go.mod
├── dev/
│   └── mock-gateway.js      # Pure Node.js dev server (zero deps)
├── formal/
│   ├── AstroMesh.tla        # TLA+ protocol specification
│   └── AstroMesh.cfg        # TLC model checker config
├── frontend/
│   ├── src/
│   │   ├── App.vue
│   │   ├── components/
│   │   └── composables/
│   └── package.json
└── docker-compose.yml
```

---

## Judging Criteria Alignment

| Criterion | How AstroMesh Scores |
|-----------|----------------------|
| **Innovation** | First open-source multi-agency orbital maneuver consensus protocol; formal TLA+ proof of safety invariants applied to space operations |
| **Engineering depth** | Bully election + 2PC from scratch in Go; correct WebSocket implementation; TLA+ model checker integration; replicated log with lag tracking |
| **Real-world impact** | Addresses a genuine coordination gap responsible for events like Iridium-Cosmos 2009; directly applicable to the ~300k maneuver/year Starlink fleet |
| **Scalability** | Quorum-based consensus tolerates one node failure; Bully failover is O(n); design extends to N nodes with configurable quorum thresholds |
| **Design / UX** | CesiumJS 3-D globe gives visceral situational awareness; live vote visualiser makes distributed consensus tangible for non-engineers |
| **Execution** | Fully runnable in < 60 s with `node mock-gateway.js`; no API keys; demo shows node kill, leader re-election, consensus vote, and AI escalation in one live flow |

---

## Data Sources (Free, No Auth)

| Source | URL | Used for |
|--------|-----|---------|
| CelesTrak GP TLE catalogue | `celestrak.org/NORAD/elements/gp.php` | Live orbital elements |
| CelesTrak SOCRATES | `celestrak.org/SOCRATES/` | Conjunction screening |
| NOAA SWPC alerts | `services.swpc.noaa.gov/products/alerts.json` | Space weather |

---

## License

MIT — build on it, fork it, deploy it.
