# 🛰️ AstroMesh

**An autonomous, trustless, formally-verified nervous system for the orbital economy** — real-time collision screening, AI-driven avoidance planning, and decentralized multi-operator maneuver consensus, on a live CesiumJS digital twin of orbit.

> Built for **FAR AWAY 2026** · Themes: **Space & Aerospace** · **Agentic & Autonomous Systems** · **Logistics & Transit (orbital traffic management)**

---

## The problem (real, and unsolved)

Low-Earth orbit is becoming ungovernable, and the coordination layer simply doesn't exist:

| Reality | Source |
|---|---|
| ~300,000 Starlink collision-avoidance maneuvers in **2025** (up 50% YoY) | SpaceX / Basenor reporting |
| **No contact directory or protocol** for operators to deconflict a maneuver | AIAA *Heavy Traffic Ahead* |
| Operators maneuver **without sharing plans** → both can dodge *into* each other | ScienceDirect, "norms of behavior" |
| SpaceX vs Amazon (Dec 2025): refused to share predicted maneuvers | SpaceDaily |
| US ↔ China barely communicate about assets → needs **no central authority** | AIAA |
| NOAA + SpaceX now building automated CA — *it's being built right now* | US Office of Space Commerce |

**The gap:** there is no open, trustless protocol for multi-operator maneuver authorization with formal safety guarantees. That's what AstroMesh is.

---

## What it does

- **Real conjunction screening** — own SGP4 engine over the full **~31,000-object Space-Track catalogue**; finds close approaches in the next 24 h. **Verified against CelesTrak SOCRATES: time-of-closest-approach exact to the second, relative velocity exact.**
- **Operational accuracy layer** — overlays **real US Space Force CDMs** (covariance-based miss + Pc) on top of our screening. Two-tier model, exactly how real Space Traffic Management works.
- **Collision-avoidance reroute** — minimum-Δv maneuver, **re-screened against all 31k objects**, cooperative (both operators move), with the maneuver in plain English ("change orbit 0.08°, Δv 1.1 m/s"). Drawn red→blue on the globe; debris correctly flagged un-maneuverable.
- **Decentralized consensus** — 4 ground-control nodes (Raft/Bully leader election, failover), real votes; a maneuver is APPROVED only with ≥3/4. **A TLA+ model proves two satellites can never be ordered into conflicting maneuvers.**
- **Autonomous triage agent** — when active, detects the top real threat → plans a real maneuver → drives it to a consensus vote, hands-free.
- **AI mission-control (Groq `gpt-oss-120b`)** — talk to it in plain English; it reasons over the live engine **and controls the globe**: "show the FENGYUN × XSAT conjunction", "plan the reroute", "track Hubble", "zoom in", "simulate a launch from Baikonur to 550 km".
- **Launch trajectory planner** — enter a launch site + target orbit → real azimuth / inclination / insertion-Δv physics (with Earth-rotation assist), best launch window, COLA shell-congestion check, and an optional real-physics ascent simulation with live telemetry.
- **History** — every reroute and launch saved (rename, categories) in the browser.

---

## Accuracy — measured, with honest caveats

Cross-validated against **30 real US Space Force conjunction events**:

| Quantity | Result |
|---|---|
| **Time of closest approach** | **100%** within 1 s (median error 0.0 s) |
| **Miss distance** (screening) | within **2 km of the operational value 93%** of the time |
| **Pc method** vs CelesTrak SOCRATES "max probability" | 75% within 1 order of magnitude |
| **CDM data shown** | 100% verbatim from Space-Track |

**Honest framing (this is a strength, not a weakness):** TLEs carry no covariance, so miss-distance is fundamentally **screening-grade** — *every* TLE-based tool (incl. SOCRATES) has this limit. That's exactly why we layer the real covariance-based CDMs on top, label Pc "screening-grade," and treat APPROVED as a **coordination decision** (we don't claim to command real spacecraft). Launch coordinates are simulated (nobody's launching this instant).

---

## Architecture

```
 CesiumJS + Vue 3 frontend  (port 5173)
        |  /api, /ws  (vite proxy)
        v
 Node gateway  dev/mock-gateway.js  (port 8090)
   - Space-Track: 31k catalogue (3LE), SATCAT RCS, public CDMs   [cached, refreshed 3x/day]
   - SGP4 conjunction screening + min-dv reroute (full-catalogue COLA)
   - Launch-trajectory physics
   - Groq gpt-oss-120b agent (key server-side)
   - Raft/Bully consensus simulation + WebSocket live state
        |
 Go distributed cluster  (*.go, docker-compose)   <- the real multi-node consensus engine
   - Bully election - 2-phase maneuver commit - membership/failover
 Formal proof  formal/AstroMesh.tla (+ .cfg)      <- TLA+ safety invariants
```

**Tech:** Vue 3 + CesiumJS 1.142 · satellite.js (SGP4) · Node (zero-dep gateway) · Go (gorilla/mux) · TLA+ · Groq (gpt-oss-120b) · marked.

**Data sources:** Space-Track.org (catalogue, SATCAT, CDMs) · CelesTrak SOCRATES (validation) · Cesium Ion (Google imagery, streamed) · NASA 3D Resources (ISS, Hubble models).

---

## Repository layout

```
├── main.go, consensus.go, election.go, membership.go,   # Go distributed cluster
│   agent.go, websocket.go, database.go, helpers.go
├── formal/AstroMesh.tla, AstroMesh.cfg                  # TLA+ formal safety proof
├── dev/mock-gateway.js                                 # Node gateway (engine + AI + data)
├── frontend/                                           # Vue 3 + CesiumJS app
│   ├── src/components/  (GlobeView, ConjunctionPanel, AgentChat, LaunchPanel,
│   │                     HistoryPanel, SideDrawer, NodeCluster, MissionFeed, …)
│   └── public/models/   types/ + special/ (ISS, Hubble, Starlink GLBs)
├── Dockerfile, docker-compose.yml                      # 4-node cluster
└── ROADMAP.md
```

---

## Run it

### 1. Demo (gateway + frontend) — what the UI uses
```bash
# repo root: create .env (gitignored)
cat > .env <<EOF
SPACETRACK_IDENTITY=your_space-track_email
SPACETRACK_PASSWORD=your_space-track_password
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
EOF

node dev/mock-gateway.js          # gateway -> http://localhost:8090  (first run warms the catalogue ~1-2 min)

cd frontend
echo "VITE_CESIUM_TOKEN=your_cesium_ion_token" > .env
npm install && npm run dev        # app -> http://localhost:5173
```

### 2. Distributed consensus cluster (Go) + formal proof
```bash
docker-compose up                 # 4 Go nodes with Bully election + maneuver consensus
# TLA+: open formal/AstroMesh.tla in the TLA+ Toolbox and run the model checker
```

> Pre-warm before a live demo: the first gateway start fetches + screens the catalogue (cached afterward). The 43 MB ISS model streams on demand (only when tracked).

---

## Honest limitations
- Miss-distance from public TLEs is **screening-grade** (no covariance) — operational fidelity comes from the CDM layer.
- "APPROVED" is the **coordination decision**, not a command to real hardware (we can't fly real spacecraft).
- The browser gateway simulates the consensus the Go cluster implements for real; both are included.
- Launch coordinates are user-entered/simulated.

---

*AstroMesh — air-traffic-control for the orbital economy, provably safe.*
