# AstroMesh — Complete Feature Documentation

**Team Xcution (UYN691W1) · FAR AWAY 2026 Round 2 · Challenge #518 — Constraint Awareness: Completion Signal**

> This document is self-contained. Read it top to bottom and you will understand the
> whole system without opening the code.

---

## 0. Read this first — the idea in plain words

### The problem we were given

> Extend the MVP with a capability related to **limits, conditions, and non-negotiable
> requirements**. Show whether the related work is **complete, partial, blocked, or
> unresolved**. It must fit naturally into the existing MVP and stay **independent of any
> specific hackathon theme**.

### What we built, in one paragraph

AstroMesh is a satellite collision-avoidance system. In Round 1 it found conjunctions
(two objects about to pass dangerously close) and let four space agencies vote on whether
to fire a thruster. In Round 2 we put a **constraint gate** in front of every irreversible
action. Nothing gets approved until the gate says so — and the gate never answers yes or no.
It answers with **one of four states**, and it always shows its working.

### The four states

| State | Meaning | Can you act? |
|---|---|---|
| 🟢 **COMPLETE** | Every rule was checked. Every rule passed. | Yes |
| 🟡 **PARTIAL** | Every rule was checked. Some failed, but all the failures are waivable and were waived by a human who is now on record. | Yes, with the waiver attached |
| 🔴 **BLOCKED** | A **non-negotiable** rule failed. There is no waiver path in the code. | **No** |
| ⚪ **UNRESOLVED** | A rule could not be evaluated — the data is missing, stale, or the sensor doesn't exist. | **No** |

**Precedence, when several apply at once:** `BLOCKED > UNRESOLVED > PARTIAL > COMPLETE`.
The worst state always wins. There is no averaging, no scoring, no "mostly fine".

### The two rules the whole system is built on

**1. UNRESOLVED is never a pass.**
Most software treats missing data as "no problem found". We treat it as its own blocking
answer. "I don't know" is different from "it's fine", and conflating them is how accidents
happen.

**2. You cannot waive what you never measured.**
A human can override a rule that was *checked* and *failed*. A human cannot override a rule
that was never checked at all — the engine refuses. Otherwise a waiver becomes a way to make
ignorance look like approval.

### Why this is the right answer to the challenge

The challenge asked for something **theme-independent**. So we made the engine know nothing
about space. It is a generic evaluator; the rules are **data files** it loads. To prove it, we
wrote a second rulebook about **software release engineering** — CVEs, rollback plans,
on-call rotas, test coverage — and ran it through the identical engine with **zero code
changes**. Same binary, different JSON, completely different domain. That is proof by
construction, not a claim in a slide.

---

## 1. Glossary — every term used in this document

| Term | Plain meaning |
|---|---|
| **Conjunction** | Two space objects predicted to pass close to each other |
| **Pc** | Probability of collision. Industry acts at Pc ≥ 1e-4 (1 in 10,000) |
| **Miss distance** | How close they'll actually get, in km |
| **Δv (delta-v)** | The speed change a thruster burn produces, in m/s. This is the currency of propellant — every burn spends some forever |
| **COLA** | Collision Avoidance. "COLA clear" = the escape maneuver doesn't fly you into something else |
| **TLE** | Two-Line Element. The public format describing an orbit |
| **SGP4** | The standard maths that turns a TLE into a position at a given time |
| **OD** | Orbit Determination — the fix on where an object actually is. It goes stale |
| **Covariance** | The uncertainty ellipsoid around a predicted position |
| **CDM** | Conjunction Data Message. The standard warning format operators receive |
| **Ec** | Casualty expectancy — expected human casualties from re-entry debris. Legal limit 1e-4 |
| **Re-entry footprint** | The ground area where surviving debris could land |
| **Kp index** | Global geomagnetic disturbance, 0–9. 9 = severe storm |
| **Conformal prediction** | A statistical method giving an error bound that is guaranteed correct a stated % of the time, without assuming the errors follow any particular distribution |
| **OOD** | Out-of-distribution — input the model has never seen anything like, so it should decline to answer |
| **TLA+ / TLC** | A formal specification language and its model checker. TLC explores *every reachable state* of a design and proves properties hold |
| **SSC** | Space Safety Coalition — publishes the industry best-practice document we encode |

---

## 2. The original MVP (Round 1) — what already existed

| # | Feature | What it does |
|---|---|---|
| 1 | **3D Earth + fly-in animation** | WebGL globe with a cinematic entry, live orbits rendered on it |
| 2 | **Live satellite catalogue** | 31,000+ real objects pulled from Space-Track with real TLEs |
| 3 | **SGP4 propagation** | Computes where everything is, in the browser |
| 4 | **Conjunction screening** | Checks the catalogue against itself for close approaches |
| 5 | **Mission feed** | Live scrolling stream of conjunctions, passes, alerts |
| 6 | **Multi-agency consensus vote** | ISRO / ESA / JAXA / SpaceX each vote on a proposed maneuver |
| 7 | **AI mission-control chat** | Ask questions in English (`gpt-oss-120b` via Groq) |
| 8 | **Launch window planner** | Checks an ascent corridor for debris crossings |
| 9 | **History panel** | Replayable timeline of past decisions |
| 10 | **First TLA+ model** | `formal/AstroMesh.tla` — early spec of the approval protocol |

**What was wrong with it (and we fixed):** the agency votes were `Math.random() < 0.70`, and
the emergency override set status to APPROVED with **zero votes**, fabricating unanimous
consent. Both are gone. Details in §6 and §9.

---

## 3. The constraint engine — the core of Round 2

**File:** `dev/constraints/engine.js` · ~400 lines · **zero dependencies** · knows nothing about space.

### 3.1 How it works

You hand it three things:

```
evaluate({ rulebook, context, waivers })  ->  { signal, rules[], authorised }
```

- **rulebook** — a list of rule objects (data)
- **context** — the facts about the thing being judged
- **waivers** — human overrides, each with an author and a reason

It returns each rule's state, the overall signal, and whether action is authorised.

### 3.2 The five rule states

| State | When |
|---|---|
| `SATISFIED` | Checked, passed |
| `VIOLATED` | Checked, failed |
| `UNEVALUATED` | **Could not check** — missing data, stale data, or the rule threw an error |
| `NOT_APPLICABLE` | This rule doesn't apply to this situation |
| `WAIVED` | Was VIOLATED, a human waived it, and the rule permitted waiving |

`authorised` is true only for **COMPLETE** or **PARTIAL**.

### 3.3 The safety properties, and how each is enforced in code

| Property | Mechanism |
|---|---|
| **Errors never look like success** | Rule evaluation is wrapped. A rule that throws becomes `UNEVALUATED`, never `SATISFIED`. A crash cannot be mistaken for a pass |
| **Unknown applicability is unknown** | If a rule's `applies()` returns `null` (can't tell), the rule is `UNEVALUATED` — not skipped |
| **Non-negotiables cannot be bypassed** | Rules carry `waivable: false`. There is no override branch. Not a policy — an absence of code |
| **Waivers are sound** | A waiver converts only a genuine `VIOLATED` on a `waivable: true` rule. Waiving `UNEVALUATED` is refused and logged |
| **Nothing expires silently** | A rule's `deadline()` hook says *when* it will go stale, so the UI counts down before the block happens |
| **Every dead end has an exit** | A rule's `resolvedBy()` hook names the single measurement that would clear it. No UNRESOLVED state is a shrug |
| **Scale** | `rollup()` aggregates thousands of assets into one fleet signal; worst state wins |
| **The rulebook audits itself** | Rule FR-00 checks the rulebook for coverage gaps and reports them as findings |

---

## 4. The rulebooks — 39 rules across 3 domains

Rules are **data**, not code paths. This is what makes the system theme-independent.

### 4.1 Orbital maneuver — 20 rules (`rulebooks/orbital.js`)

**Non-negotiable (no waiver exists):**
**FR-03** COLA clear · **FR-05** disposal reserve · **FR-07** commandability · **FR-08** quorum

| Rule | The constraint | Authority |
|---|---|---|
| FR-00 | The rulebook audits its own coverage | — |
| FR-01 | Action threshold: Pc ≥ 1e-4 **or** miss < 5 km | SSC §8.j |
| FR-02 | If threshold crossed, mitigation is mandatory | SSC §8.j |
| **FR-03** | The escape burn must not create a *new* conjunction | SSC §8.d |
| FR-04 | Δv must fit inside the collision-avoidance allocation | operator ledger |
| **FR-05** | The end-of-life disposal reserve is untouchable | FCC 5-year rule, ISO 24113 |
| FR-06 | Enough lead time to physically execute the burn | ops |
| **FR-07** | The asset must be commandable — you can't move what you can't reach | SSC §8.h |
| **FR-08** | Consensus quorum met | protocol |
| FR-09 | Enough lead time to decide | ops |
| FR-10 | Orbit determination not stale (+ has it manoeuvred since?) | SSC §2.e.ii |
| FR-11 | Covariance has a stated basis; flags disagreement between sources | CCSDS CDM |
| FR-12 | **Probability dilution check** — is a *low* Pc low because it's safe, or because the uncertainty is so large the number is meaningless? | False Confidence Theorem, arXiv 1706.08565 |
| FR-13 | Right-of-way — who is obliged to move | SSC §8.c, 5×5 matrix |
| FR-14 | Efficacy: the burn must drop Pc by ≥1.5 orders of magnitude, or it isn't worth the fuel | SSC §8.k |
| FR-15 | The other operator must be notified | SSC §8.i |
| FR-19 | Command uplink survivable — **deadline predicted from the solar flare forecast** | NOAA R-scale |
| FR-20 | Positional knowledge ≤500 m (2σ) — **σ derived from our own conformal calibration** | SSC §7.k |
| FR-21 | Drag model still valid for this object | per-object ML |
| FR-26 | Is the miss distance even **resolvable** against the 5 km threshold, given our error bars? | conformal |

**FR-12 and FR-26 are the two rules judges remember.** FR-12 says a reassuringly small Pc can
be an artefact of huge uncertainty. FR-26 says: if our error bar is ±5 km and the threshold is
5 km, we cannot answer the question at all — that is UNRESOLVED, not a pass.

**The right-of-way matrix (FR-13)** implements SSC §8.c: five maneuverability classes
(maneuverable / limited / degraded / non-maneuverable / unknown) crossed against each other.
Cells that the standard resolves to "bilateral discussion required" return **UNRESOLVED** —
we do not invent an answer the standard declines to give.

### 4.2 Re-entry / the return leg — 9 rules (`rulebooks/reentry.js`)

**Non-negotiable:** **FR-22** descent COLA · **FR-17a** casualty expectancy · **FR-08** quorum

| Rule | The constraint |
|---|---|
| **FR-17a** | Ec < 1e-4 — NASA-STD-8719.14, reported **unmodified** |
| FR-17b | Ground consequence class under the footprint |
| **FR-22** | The descent path itself must be collision-clear |
| FR-23 | Airspace clearance |
| FR-24 | Maritime clearance — **permanently UNEVALUATED** |
| FR-25 | Recovery window |
| FR-00, FR-21 | Self-audit, drag validity |

> **FR-24 is deliberately unresolvable.** We have no AIS (ship tracking) feed. Rather than
> assume the ocean is empty, the rule reports that it cannot be evaluated, forever. It is the
> clearest single demonstration that this system reports what it doesn't know. We left it in
> on purpose and we lead with it.

### 4.3 Release gate — 10 rules (`rulebooks/release-gate.js`) — **the theme-independence proof**

Zero space content. Same engine. **Zero engine changes.**

| Rule | The constraint |
|---|---|
| RG-01 | Tests pass |
| **RG-02** | No critical CVE — **non-negotiable** |
| **RG-03** | Rollback plan exists — **non-negotiable** |
| RG-04 | Required approvals present |
| RG-05 | Error budget not exhausted |
| RG-06 | On-call engineer assigned |
| RG-07 | Coverage threshold |
| RG-08 | Performance regression check |
| RG-09 | High-severity CVEs |
| RG-10 | Change size within limits |

Five bundled scenarios drive it to **all four signal states**. The demo switches domain live:
same screen, same engine, satellites → software deploys.

---

## 5. Rule authoring — write your own constraints, safely

**File:** `dev/constraints/authoring.js`

Judges can add a rule during the demo. Safely:

| Guard | How |
|---|---|
| **No code execution** | Rules are built from a fixed **field allow-list** and a fixed **operator set**. No `eval`, no `new Function()`, no string is ever executed |
| **Semantic probe** | Every new rule is fired against synthetic contexts designed to expose inverted logic before it is accepted |
| **Auto-formalisation** | `toTla()` emits a TLA+ fragment for the authored rule, so a hand-written rule joins the formal model |

> The probe earns its place: it caught the language model compiling **"fewer than three
> approvals"** into `count < 3` — backwards, and it would have passed a code review. A rule
> that is *wrong* is more dangerous than a rule that is *missing*, because it looks green.

---

## 6. Deterministic consensus — replacing the coin flip

**File:** `dev/constraints/voting.js`. The original `Math.random() < 0.70` is gone.

Each agency now votes from a **posture** — the rules it weights most heavily, reflecting its
real institutional priorities:

| Agency | Weights |
|---|---|
| **ISRO** | FR-10 (orbit determination age), FR-09 (decision lead time) |
| **ESA** | FR-11 (covariance basis), FR-12 (probability dilution) |
| **JAXA** | FR-10, FR-12 |
| **SpaceX** | FR-04 (Δv budget), FR-09 |

**200 repeated polls of the same conjunction produce 1 outcome.** The result is reproducible,
explainable, and defensible — you can say *why* ESA voted no.

**Emergency override** (`emergencyWaivers()`): auto-waives only rules that are *waivable*,
**refuses non-negotiables**, **refuses unevaluated rules**, and still requires quorum. It is a
fast path, not a back door.

---

## 7. The propellant ledger — the hardest limit there is

**File:** `dev/constraints/ledger.js`

Propellant is finite, unreplenishable, and every avoidance burn spends it permanently. It is
the cleanest possible non-negotiable: approve enough maneuvers and the system BLOCKS on a
limit that cannot be argued with.

**Two budgets, one tank:**

| Budget | Status |
|---|---|
| `ca_allocation` | Collision avoidance. Spendable |
| `disposal_reserve` | Ring-fenced for controlled deorbit at end of life. **Protected by FR-05, non-negotiable** |

Spending the reserve trades a *probabilistic* collision today for a *guaranteed* piece of dead
debris tomorrow. That's why FR-05 has no waiver path.

The ledger **refuses structurally** to touch the reserve — a bug elsewhere in the system cannot
spend it. It also refuses negative burns: a ledger that can be credited is not a ledger.

**Honesty:** no public feed of operator propellant exists. Starting balances are seeded
deterministically from the object name and every record carries `simulated: true` plus a source
string saying so. **Consumption is real** — approve a maneuver and the fuel is actually gone.

---

## 8. The return leg — re-entry

**Files:** `dev/constraints/reentry.js`, `build-consequence-raster.js`

Satellites are increasingly designed to come back. That return is an irreversible action with
ground consequences, so it needs the same gate.

| Feature | Detail |
|---|---|
| **Monte Carlo footprint** | 20,000 seeded samples → a dispersion ellipse on the ground. Deterministic across restarts |
| **Ground consequence raster** | A global 0.5° grid built from **four real public datasets** |
| ↳ GeoNames `cities15000` | 34,096 settlements, 3.94 billion people |
| ↳ OpenFlights | 7,698 airports + 66,771 routes rasterised into air corridors |
| ↳ Natural Earth 110m | land / water polygons |
| ↳ NASA GIBS | satellite imagery (see §10) |
| **Casualty expectancy** | `Ec = A_c × P_D` per NASA-STD-8719.14 — **reported unmodified** |
| **Consequence class** | A **separate** number: OPEN_WATER · SPARSE · POPULATED · DENSE_URBAN · AIRPORT · AIR_CORRIDOR |
| **Retarget planner** | Propose a different footprint and re-run the entire gate against it |
| **Historical replay** | The **Long March 5B** uncontrolled re-entry, replayed through the gate |

> We never blend the consequence class into Ec to make Ec look better. The regulated number
> stays the regulated number. Two numbers, both shown.

---

## 9. Space weather — the geospatial disruption layer

**Files:** `dev/constraints/spaceweather.js`, `flares.js`

A solar storm cannot be prevented. But it **can** be treated as a constraint: if the storm will
black out your radio link in 40 minutes, your window to command the satellite closes then —
whether or not the maneuver is otherwise approved.

| Feature | Detail |
|---|---|
| **Live NOAA SWPC** | Planetary K-index, alerts, warnings. No API key |
| **GOES XRS two-band** | 0.1–0.8 nm soft + 0.05–0.4 nm hard X-ray |
| **Neupert effect** | Hard X-rays peak **before** the soft X-ray maximum — this physics gives real lead time on a flare |
| **Radio blackout mapping** | NOAA R-scale → HF-degraded regions, including **polar cap absorption above 63° magnetic latitude** |
| **Full NOAA scales** | Geomagnetic G1–G5, radiation S1–S5, blackout R1–R5 |
| **GFZ Potsdam archive** | Kp/ap since 1932 — 276,536 records (CC BY 4.0) |
| **Historical replay** | The **Gannon storm**, May 2024, Kp 9, replayed live |
| **Wired into the gate** | A storm doesn't just colour the globe — it sets the **deadline on FR-19** and can BLOCK a maneuver outright |
| **Zone rendering** | Clean boundary polylines, off by default, toggleable |

---

## 10. Machine learning — eight models

**Architecture principle: train offline, ship JSON, infer in plain JavaScript.**
There is **no model server, no inference API, and no GPU at demo time**. Every model becomes a
JSON file of coefficients or calibration bands that the gateway reads. Reproducible, auditable,
fast, and impossible to rate-limit or take down mid-pitch.

| Model | Script | Result | Feeds |
|---|---|---|---|
| **Maneuverability classifier** | `train_class_classifier.py` | **93.2%** 5-class · **94.1%** commandable-vs-inert | FR-13 right-of-way class |
| **Maneuver detector** | `train_maneuver_detector.py` | active 3.2% vs inert 2.0% — separation confirmed | FR-10 maneuver flag |
| **Density uncertainty** | `train_density_model.py` | quiet 0.504 → storm 0.759 = **1.51× step** (a threshold, not a ramp) | FR-21, re-entry dispersion |
| **Conformal calibration** | `calibrate_conformal.py` | 0.5–1.5 d p95 **1.689 km** · 1.5–3.0 d **5.061 km** · 3–7 d **failed, not shipped** | FR-20 σ, FR-26 resolvability |
| **dSGP4 validation** | `validate_dsgp4.py` + `compare_dsgp4.js` | **0.000 m** vs ESA reference | propagator trust |
| **Chronos-2 baseline** | `chronos_baseline.py` | beats persistence by **25.8%** on Kp | space weather lead time |
| **DINOv3-SAT** | `dinov3_consequence.py` | see §10.1 | FR-17b class + **OOD → UNEVALUATED** |
| **Risk forecaster** | `train_risk_forecaster.py` | ESA Kelvins, 162,634 real CDMs (not yet run) | Pc forecast |

**Why conformal prediction matters here.** Split conformal gives a **distribution-free,
finite-sample** coverage guarantee — an error bound that is provably right 95% of the time
without assuming the errors are Gaussian. That is exactly what a completion signal needs: not
a point estimate, but a bound you can defend. It is what lets FR-26 say *"we cannot resolve
this"* with a number behind it instead of a feeling.

### 10.1 DINOv3-SAT — the vision layer

**Model:** `facebook/dinov3-vitl16-pretrain-sat493m` — Meta's DINOv3 vision transformer,
ViT-L/16, ~300M parameters, **pretrained self-supervised on 493 million satellite images**.
It learned what ground looks like without a single human label.

**Why a vision model at all.** The re-entry footprint asks a question tabular data answers
badly: *what is actually underneath this ellipse?* GeoNames gives population points,
OpenFlights gives airports, Natural Earth gives coastlines — but none of them sees a port, an
industrial estate, a dry lakebed, or a city that grew since the last census. DINOv3 looks at
the photograph.

**Pipeline — frozen backbone, linear probe:**

| Stage | What happens |
|---|---|
| 1. **Tiles** | One NASA GIBS satellite image per 0.5° cell — ~55 km square, RGB PNG, 512², named `<ix>_<iy>.png`. **5,000 fetched, 0 failed** |
| 2. **Embed** | DINOv3 runs **inference only** — no training, no backward pass, no optimiser. Each tile → one 1024-d vector |
| 3. **Probe** | A small linear classifier maps embeddings → six consequence classes |
| 4. **Export** | Written back into `consequence-raster.json`. **DINOv3 never runs at demo time** |

Labels are derived from the raster's own dataset-grounded classes, so every label traces to
GeoNames / OpenFlights / Natural Earth — citable, not my personal judgement.

**Out-of-distribution detection is the point.** When an embedding sits too far from every class
centroid, the tile is marked **UNKNOWN** rather than forced into the nearest bucket. An UNKNOWN
cell makes **FR-17b UNEVALUATED**, which makes the re-entry signal **UNRESOLVED**.

> This is the entire thesis of the project in one code path. **A model that is confident
> everywhere is a model that lies somewhere.** Ours is allowed to say *I have not seen this
> before* — and that admission propagates all the way up to a blocked approval.

A healthy UNKNOWN rate is **2–15%**. Near 0% means the threshold is too loose and the model is
pretending. Above 40% means the labels don't cover the imagery. The figure is written into the
artefact (`raster.dinov3.tiles_classified`) so coverage can be quoted honestly.

Tiles are ranked **densest-first**, so a partial run refines exactly the cells carrying the
most people and air traffic. Untiled cells keep their existing dataset class — **DINOv3
refines the raster, it does not replace it**, so a partial run is a legitimate result rather
than a half-finished one.

**Hardware:** one A100 40GB, ~5 minutes for 5,000 tiles, ~2 GB VRAM. The instance is deleted
the moment the job finishes.

---

## 11. Formal verification — we prove it, we don't just test it

**Files:** `formal/ConstraintGate.tla`, `.cfg`, `ConstraintGateBug.cfg`

TLA+ is a specification language; TLC is its model checker. TLC explores **every reachable
state** of the design — not sampled test cases, all of them.

```
148,163 states explored · 33,720 distinct · 0 invariant violations
```

| Invariant | What it makes impossible |
|---|---|
| `ConstraintSafety` | Any approval that violates a non-negotiable |
| `NoApprovalWhileBlocked` | Approving while BLOCKED |
| `NoAuthoriseOnUnknown` | Approving while UNRESOLVED |
| `WaiverSoundness` | Waiving something that was never evaluated |
| `EmergencyBounded` | Emergency override exceeding its bounds |
| `QuorumRespected` | Approval below quorum |
| `ApprovalImpliesAuthorised` | Approval without an authorising signal |
| `TypeOK` | Any malformed state |

**And we prove the bug we found.** `ConstraintGateBug.cfg` re-enables `LegacyEmergencyApprove`
— the original Round-1 behaviour, which set status to APPROVED with zero votes and fabricated
unanimous consent. TLC finds the violation in a **2-state counterexample**.

> We can run the model checker live and watch it catch our own former bug in two steps. That
> is a stronger statement about engineering discipline than any number of green test ticks.

---

## 12. The interface

| Feature | Detail |
|---|---|
| **Always-on signal card** | Top-left. The four-state answer is on screen at all times — never behind a click |
| **Events / Rulebook tabs** | Right panel: every rule, its state, and the reason |
| **Per-rule provenance** | Each rule cites its clause — SSC §8.k, NASA-STD-8719.14, FCC, ISO 24113 |
| **"What would resolve this"** | Every UNRESOLVED rule names the missing measurement. No dead ends |
| **Deadline countdowns** | Rules that will expire show when, before they block |
| **Capability launcher** | Gannon replay · deorbit planner · Long March replay · portability demo · rule author · zone toggle |
| **API enforces the gate** | `/api/maneuver/request` returns **409** when not authorised — the UI physically cannot route around the engine |
| **Earth fly-in** | Kept from Round 1 |
| **Restrained palette** | Deep near-black, brass accent, and **unlit grey for UNRESOLVED** — because unresolved is the *absence of information*, not a warning. Red would be a lie |

---

## 13. Platform and architecture

```
  data sources ──► gateway (Node, 32 endpoints) ──► frontend (Vue + WebGL globe)
                        │
                        ├── constraints/engine.js        domain-agnostic evaluator
                        ├── constraints/rulebooks/*.js   rules as DATA (3 domains)
                        ├── constraints/ledger.js        propellant
                        ├── constraints/voting.js        deterministic consensus
                        ├── constraints/reentry.js       Monte Carlo footprint
                        ├── constraints/spaceweather.js  NOAA / GOES
                        ├── constraints/conformal.js     error bounds
                        └── cache/models/*.json          ML, shipped as coefficients
```

**32 gateway endpoints**, grouped:

| Group | Endpoints |
|---|---|
| Constraints | `/api/constraints/{rules, fleet, propellant, authored, author}`, `/:id`, `/:id/waive`, `/:id/acknowledge` |
| Re-entry | `/api/deorbit/{rules, plan, retarget, raster, replays}`, `/replay/:id`, `/:norad` |
| Maneuver | `/api/maneuver/{plan, request, emergency}` |
| Space weather | `/api/spaceweather`, `/api/spaceweather/replay`, `/api/flares` |
| Portability | `/api/portability`, `/rules`, `/evaluate` |
| Catalogue | `/api/catalogue`, `/satellites`, `/satcat`, `/tle`, `/cdms`, `/conjunctions`, `/search`, `/network` |
| Other | `/api/models`, `/api/operator-feeds`, `/api/chat`, `/api/launch/plan`, `/api/agent/toggle` |

- **224 tests passing** — `engine.test.js`, `integration.test.js`
- **Zero runtime dependencies** in the constraint engine
- **Deterministic throughout** — seeded RNG, frozen replays, stable hashes. Nothing in the demo is faked, and nothing is random

---

## 14. Data sources — all free, all verified working

| Source | What we take | Auth |
|---|---|---|
| Space-Track | catalogue (31k), SATCAT, CDMs, `gp_history` | account |
| NOAA SWPC | Kp, alerts, GOES XRS two-band | none |
| GFZ Potsdam | Kp/ap since 1932 — 276,536 records | none |
| GeoNames | `cities15000` — 34,096 settlements | none |
| OpenFlights | 7,698 airports, 66,771 routes | none |
| Natural Earth | 110m land polygons | none |
| NASA GIBS WMS | satellite imagery tiles | none |
| ESA Kelvins | 162,634 real CDMs | registration |
| HuggingFace | DINOv3-SAT weights | gated licence |

---

## 15. Standards and literature encoded

| Source | Used for |
|---|---|
| **Space Safety Coalition**, *Best Practices for the Sustainability of Space Operations* v2.39 (Nov 2024) | §8.j thresholds · §8.k efficacy · §8.c right-of-way matrix · §8.d exceptions · §8.i notification · §8.h loss of contact · §2.e.ii ephemeris validity · §7.k positional knowledge · §5.a PMD · §5.d casualty risk |
| **NASA-STD-8719.14** | Casualty expectancy Ec < 1e-4 |
| **NASA CARA** | Risk bands — red ≥1e-4, yellow 7e-5, green <1e-7 |
| **FCC 5-year deorbit rule** (2022) | Disposal reserve |
| **ISO 24113**, **IADC** | Debris mitigation |
| **CCSDS CDM** | Conjunction message format |
| **NOAA space weather scales** | G1–G5, S1–S5, R1–R5 |
| **Balch, Martin & Ferson**, arXiv 1706.08565 | Probability dilution / False Confidence Theorem → FR-12 |

---

## 16. Honesty ledger — what we do **not** claim

We would rather be attacked for candour than caught overselling. Every one of these is stated
on screen in the product, not just here.

- **Propellant balances are operator-declared and simulated.** No public feed exists. Every record says `simulated: true`. Consumption is real.
- **FR-24 maritime is permanently UNEVALUATED.** We have no AIS feed. We report that rather than assume an empty ocean.
- **The 3–7 day conformal band failed calibration and is not shipped.** We ship two bands, not three, and we say why.
- **Starlink's Space Safety API returns 403.** It is operator-gated. We use only the public documentation.
- **Casualty expectancy is reported unmodified.** The consequence class is a separate number, never blended in to flatter Ec.
- **If the DINOv3 job never runs, nothing breaks.** The raster already carries real classes from three ground datasets. DINOv3 refines; it is not a dependency.
- **Nothing in the demo is faked.** Every replay is a real historical event with real data.

---

## 17. The pitch, in one paragraph

> Most systems answer **yes** or **no**. Ours answers **complete, partial, blocked, or
> unresolved**. It treats "I don't know" as a blocking answer rather than a quiet pass. It
> refuses to let a human waive a rule that was never measured. It proves both of those
> properties with a model checker across 148,163 states — and demonstrates the proof by
> replaying its own former bug in a two-state counterexample. And because the engine is
> domain-agnostic and the rules are data, the same binary gates orbital maneuvers,
> atmospheric re-entries, and software releases with nothing changed but a JSON file.
