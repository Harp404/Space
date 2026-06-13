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

## Phase 1 — Rendering & visuals ✅ (DONE)
- [x] Per-type 3D models (station/comms/debris/payload), placeholders swappable for HQ glb
- [x] **Full ~31k catalogue** via Space-Track through the gateway middleware (creds in gitignored `.env`, cached 6h, never in browser)
- [x] Catalogue as points (PointPrimitiveCollection), SGP4 chunked across frames (no hitch)
- [x] **"Show all tracked objects" toggle** (off by default → the debris-crisis reveal)
- [x] **Nearest-N model swap** (default 25 closest get 3D models; adjustable count control)
- [x] Every cloud object clickable (point AND model) → fly-in + follow
- [x] **RCS-proportional model sizing** (real Space-Track SATCAT size class: SMALL/MEDIUM/LARGE) — verified per-NORAD correct; big objects look big, small look small
- [x] Smooth fly-in → follow handoff (velocity-frame pose match + SampledPositionProperty + size-scaled view distance) — verified headless
- [x] Inertial orbit ring (proper circle for GEO, ellipse for LEO)

---

## Phase 2 — Conjunction engine ⭐ (WORKING — real on-globe)
- [x] **Screening math validated + LIVE**: apogee–perigee sieve → coarse SGP4 screen → fine TCA refine, in a **Web Worker** (`lib/conjWorker.js`) so the UI stays smooth. ~36s scan w/ progress bar.
- [x] Real results e.g. **1.44 km Fengyun-1C DEB × Fengyun-1C DEB** (verifiable vs Space-Track).
- [x] **Screening-grade Pc** (Foster-style 2-D Gaussian; honestly labelled, TLE-grade σ).
- [x] On-globe display: glowing line + warning marker + miss-distance label at each TCA; left panel with live TCA countdown + Pc + relative velocity; click → fly to the event.
- [x] **Verified vs CelesTrak SOCRATES** — our engine reproduced a SOCRATES event: **TCA exact to the second, relative velocity exact (15.01 km/s)**. Miss-distance differs honestly (older TLE → screening-grade). Credibility kill-shot.
- [x] **Real conjunctions EVERYWHERE — mock fully removed.** Gateway computes our SGP4 screening once (cached `dev/cache/conjunctions.json`, refreshed w/ catalogue), serves `/api/conjunctions` + `/api/network`. Both the left "Predicted Close Approaches" panel AND the right "Conjunction Risk Monitor" + agent + Raft consensus now run on REAL data. Scan is **instant** (precomputed).
- [x] Co-moving / docked-module false positives filtered (rel-vel gate) → clean, real crossing conjunctions (e.g. Fengyun-1C × Cosmos-2251 DEB at 12.4 km/s).
- [x] **Operational-grade accuracy layer — REAL CDMs.** Gateway pulls live Conjunction Data Messages from Space-Track (`cdm_public`), computed by US Space Force (18 SDS) with **SP ephemerides + covariance** — the actual operational truth. Deduped per object-pair (latest assessment), MIN_RNG correctly read as **metres**, cached + refreshed 3×/day, served at `/api/cdms` + in `/api/network` + WS. Right panel shows a unified ranked list: **OFFICIAL (USSF CDM)** rows on top + our **SCREENING** rows below, each badged. Headline live event: **PEGASUS R/B × SL-14 R/B — 66 m, Pc 1-in-97, emergency-reportable.**
- [x] **Two-tier accuracy model = honest + accurate.** Our SGP4 = broad discovery (TCA + rel-vel verified EXACT vs SOCRATES, miss screening-grade). Real CDMs = operational miss + Pc with covariance for high-interest events. This is exactly how real Space Traffic Management works → also nails the Logistics/Transit theme.
- [x] **Refresh cadence = 3×/day (8h)**, same as SOCRATES; sequential guarded chain (SATCAT → TLEs → conjunctions → CDMs), no overlap.
- [ ] (note) First gateway start computes ~4–5 min (250 primaries) then cached — **pre-warm before demo**.
- [ ] (optional) Go SGP4 engine — the Node gateway engine is the working path.
- [ ] Probability of collision (Pc): **Chan 1997** analytical series (or Alfano erf)
- [ ] Monte-Carlo TLE-uncertainty sampling (supplies missing covariance, honestly)
- [ ] Replace MOCK conjunctions in DB with REAL computed ones → feeds existing agent/consensus/UI
- [ ] **Verify vs CelesTrak SOCRATES Plus** (free, no-auth) — match TCA/miss-distance on real events

---

## Phase 3 — Collision avoidance / auto-route ⭐ (the visual "wow") — DONE
- [x] **Maneuver optimizer LIVE** (`planAvoidance` in gateway, `POST /api/maneuver/plan`): min along-track Δv search; post-burn arc via universal-variable two-body propagation applied as a **differential displacement on the SGP4 truth** (cancels model error — honest); burn 50 min before TCA.
- [x] **Re-screened vs the WHOLE catalogue** — apogee-perigee sieve over ~31k objects (screens 6–9k overlapping), coarse time-march; bumps Δv until the reroute is clear against *everything*. Verified: 0 new conjunctions created.
- [x] **UI:** PLAN button per threat row → draws **red current orbit → green rerouted orbit** + cyan BURN marker on the globe (camera frames the maneuver), plus a result banner (Δv, miss open, objects screened, CLEAR-vs-catalogue). Real numbers: e.g. FENGYUN 1C DEB × XSAT → Δv 1.1 m/s, miss 2.75→10.2 km, 9229 screened, clear.
- [ ] Wire PLAN → consensus VOTE → status green (tie the reroute to the trustless approval flow)

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
- [x] **LLM ops-console LIVE** — Groq `gpt-oss-120b` proxied through the gateway (`/api/chat`, key server-side in gitignored `.env`). Reasons over the REAL live engine state (real conjunctions + USSF CDMs injected as context) — answers with actual miss/Pc/TCA numbers, explains right-of-way + Δv + the consensus step. Chat console in the AIAdvisor panel (verified end-to-end headless).
- [ ] Upgrade to true tool-use (function calling) so the agent can *trigger* consensus votes / maneuver planning, not just describe them
- [ ] Natural language: "anything threatening ISS this week? plan cheapest avoidance" → reasons + acts
- [x] Autonomous triage agent explains decisions in plain English

## Phase 9 — NEW INNOVATION (the win, evidence-backed by 2025 STM literature)
The documented gap: **no trustless protocol exists for operators to deconflict maneuvers** — no contact directory, operators maneuver without sharing plans (SpaceX/Amazon Dec-2025 dispute), ~300k Starlink maneuvers in 2025, US/China don't communicate → needs NO central authority. NOAA+SpaceX are building automated CA right now.
- [ ] **Mutual-maneuver deconfliction** — when 2 operators flag the same conjunction, decentralized consensus picks exactly ONE maneuver (right-of-way / least-Δv), cryptographically signed so neither can defect; TLA+ proves two sats can never be ordered into conflict.
- [ ] **Select-a-satellite → show both orbits + meeting point + safer rerouted orbit** (screened vs the whole catalogue) — the user's hero visual.
- [ ] **ML maneuver/anomaly detection** — "this sat changed orbit when it shouldn't have" (real SDA ML, not trajectory prediction — SGP4 already wins there).

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
