# AstroMesh — Build Roadmap & Checklist

**Vision:** An open, real-time **digital twin of orbit** + an autonomous, decentralized,
*formally-verified* **Space Domain Awareness & collision-avoidance coordination platform** —
"air-traffic-control for space." Real data, real orbital math, AI you can talk to.

**Themes claimed:** Space & Aerospace · Agentic & Autonomous Systems · Logistics & Transit (orbital traffic mgmt)

**Win thesis:** innovative *and* shippable *and* verifiable. Detecting collisions already won a 2024 hackathon;
our edge is the **autonomous decentralized coordination protocol + formal safety proof + SDA breadth**, on a
stunning real-data globe. Judges reward real working products and punish fakes — so everything must be REAL.

Legend: `[x]` done · `[~]` in progress · `[ ]` todo · `[?]` stretch / "a bit much"

---

## Phase 0 — Globe foundation ✅ (DONE)
- [x] CesiumJS + Vue globe, Google satellite imagery (highest quality)
- [x] Real satellites from live CelesTrak TLEs + SGP4 (verified ±4km vs wheretheiss.at)
- [x] Real-time day/night + NASA city lights + atmosphere + realistic sun (glTF)
- [x] Static clouds (live OWM available behind flag)
- [x] Place labels (country → city by zoom)
- [x] Idle auto-spin (pauses on zoom, stops zoomed-in)
- [x] Click/search → fly-in → smooth follow (damped) → Return
- [x] Orbit path line (30s refresh, local SGP4)
- [x] Live track info panel (lat/lon/alt/speed/risk)
- [x] Search (name + NORAD, fetch any catalogued object)
- [x] Group filters + "Dangerous only" sidebar
- [x] Far-side occlusion, depth-correct rendering
- [x] Go backend: Raft consensus, leader election, membership, autonomous triage agent, TLA+ formal spec

---

## Phase 1 — Rendering & visuals (IN PROGRESS)
- [~] Per-type 3D models (placeholders in `public/models/types/`: station/comms/debris/payload)
  - [ ] Drop in high-quality models: `station.glb` (ISS), `comms.glb` (Starlink/OneWeb), `debris.glb` (rocket body/fragment), `payload.glb` (imaging/EO)
- [ ] **Full ~30k catalogue as points** (PointPrimitiveCollection), throttled SGP4 (~1–2 Hz)
- [ ] **"Show all tracked objects" toggle** (off by default → reveals the debris-crisis "mess")
- [ ] **Nearest-N model swap** (default ~25 closest to camera get 3D models; recompute periodically)
- [ ] Filter: "models shown" count control

---

## Phase 2 — Conjunction engine ⭐ (FOUNDATION — everything depends on this)
- [ ] SGP4 in Go (lib) — propagate the catalogue
- [ ] Smart sieves: apogee–perigee → space-occupancy (zonal) → orbit-path (goroutine-parallel)
- [ ] TCA search: coarse → cubic-spline refine → multi-stage refine to sub-km miss distance
- [ ] Probability of collision (Pc): **Chan 1997** analytical series (or Alfano erf)
- [ ] Monte-Carlo TLE-uncertainty sampling (supplies missing covariance, honestly)
- [ ] Replace MOCK conjunctions in DB with REAL computed ones → feeds existing agent/consensus/UI
- [ ] **Verify vs CelesTrak SOCRATES Plus** (free, no-auth) — match TCA/miss-distance on real events

---

## Phase 3 — Collision avoidance / auto-route ⭐ (the visual "wow")
- [ ] Maneuver optimizer: search burn (dir × magnitude × timing), re-propagate, re-screen vs WHOLE catalogue
- [ ] Objective = min Δv that clears the threat AND stays clear for N days (no re-route)
- [ ] UI: red risky orbit → green optimized orbit + Δv / fuel cost

---

## Phase 4 — Space Domain Awareness extras (same engine, big innovation)
- [ ] **Maneuver / anomaly detection** ("this sat changed orbit when it shouldn't have")
- [ ] **RPO / proximity-threat detection** ("a sat is shadowing another — possible inspection/spy")
- [ ] **Reentry / decay prediction** ("dead sat reenters over Pacific in 3 days")

---

## Phase 5 — Launch module (scoped — real parts only)
- [ ] **Optimal launch window** (when site rotates under target orbital plane) — real
- [ ] Ascent trajectory to target orbit + **screen vs debris field (COLA)** — real
- [ ] Insertion Δv via vis-viva — real
- [?] Full fuel-optimal ascent guidance (gravity losses/staging) — HARD, likely fake-able → avoid unless time
- [?] Astronaut reentry path + chute timing (EDL) — off-theme, "a bit much" → skip (decay prediction covers reentry)

---

## Phase 6 — Decentralized coordination protocol ⭐ (the differentiator)
- [ ] When 2 operators both flagged → nodes negotiate → consensus picks exactly ONE maneuver (right-of-way / least-Δv)
- [ ] Cryptographically-signed maneuver commitments (zero-trust, no central authority)
- [ ] **TLA+ invariant: protocol can never let two sats pick conflicting maneuvers** (provable safety)
- [ ] Wire to existing Raft consensus + leader election

---

## Phase 7 — Agentic AI layer (Agentic theme)
- [ ] LLM ops-console (Claude) over the REAL engine via tool-use (not a wrapper)
- [ ] Natural language: "anything threatening ISS this week? plan cheapest avoidance" → reasons + acts
- [ ] Autonomous triage agent explains decisions in plain English

---

## Phase 8 — Demo & pitch (judges decide here)
- [ ] The centerpiece demo: real conjunction → fly-in + TCA countdown → "matches SOCRATES" side-by-side → agent recommends burn → consensus approves → orbit shifts → risk green → TLA+ invariant holds
- [ ] "Show all 30k" debris-crisis reveal
- [ ] Reframe narrative: NOT "object dodge" → "the nervous system for the orbital economy, provably safe"
- [ ] 2–5 min video / ≤15 slides, GitHub clean, demo included

---

## Credibility landmines to PRE-EMPT (sharp judges attack these)
- [ ] TLEs have NO covariance; LEO error ~0.1km radial / 0.47km along-track → present Pc as *screening-grade* (match SOCRATES "max probability"), never claim operational fidelity. Saying this signals depth.
- [ ] Don't overclaim launch guidance (scope honestly)
- [ ] Everything verifiable vs a real source (SOCRATES / wheretheiss.at)

## Data sources
- CelesTrak GP/TLE + SOCRATES Plus (no auth — primary feed)
- Space-Track CDMs (real Conjunction Data Messages; free account → Logistics/STM theme)
- ESA DISCOSweb (OAuth2 — debris metadata)

## Notes
- Show ~20–25 by default; full 30k behind toggle (perf: points cheap, models nearest-N only)
- No more deep-research (cost) — normal web search OK
