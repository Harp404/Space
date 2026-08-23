# Architecture & Scale

AstroMesh Round 2 — Challenge #518, *Constraint Awareness: Completion Signal*

---

## 1. The shape of it

```
                        ┌──────────────────────────────────────────┐
                        │        CONSTRAINT ENGINE                 │
                        │     dev/constraints/engine.js            │
                        │                                          │
   rulebook  ─────────► │  rulebook + context → completion signal  │
   context   ─────────► │                                          │
                        │  COMPLETE · PARTIAL · BLOCKED ·          │
                        │  UNRESOLVED                              │
                        │                                          │
                        │  Knows nothing about satellites.         │
                        └──────────────┬───────────────────────────┘
                                       │
        ┌──────────────────┬───────────┴───────────┬────────────────────┐
        ▼                  ▼                       ▼                    ▼
  ┌───────────┐     ┌─────────────┐        ┌──────────────┐     ┌──────────────┐
  │ maneuver  │     │  re-entry   │        │   authored   │     │   release    │
  │ rulebook  │     │  rulebook   │        │  (English →  │     │    gate      │
  │ 19 rules  │     │   9 rules   │        │   verified)  │     │  10 rules    │
  └───────────┘     └─────────────┘        └──────────────┘     └──────────────┘
        │                  │                                     NOT SPACE —
        │                  │                                   the portability
        ▼                  ▼                                       proof
  ┌──────────────────────────────────────────────────────────────┐
  │  vote gate (409) · deterministic poll · propellant ledger    │
  └──────────────────────────────────────────────────────────────┘
```

The engine is the product. The rulebooks are data. That separation is what makes the capability
theme-independent, and it is verified by a test that runs a **software release gate** through the
same code path.

---

## 2. Where the inputs come from

| Layer | Source | Live? | Feeds |
|---|---|---|---|
| Catalogue | Space-Track, ~31k objects, 3×/day | yes | FR-00, FR-03, FR-22 |
| Conjunctions | our own SGP4 screening | computed | FR-01, FR-10, FR-12 |
| CDMs | 19th SDS via Space-Track | yes | FR-11 |
| Operator ephemeris | SpaceX Starlink Space Safety | **operator-gated (403)** | FR-11 — reports UNEVALUATED without access |
| Space weather | NOAA SWPC, no API key | yes, 5 min | FR-19, FR-20, FR-21 |
| Solar X-ray | NOAA GOES XRS, two bands | yes, 2 min | FR-19 **predictive deadline** |
| Ground consequence | GeoNames + OpenFlights + Natural Earth | static, 4.4 MB | FR-17a, FR-17b, FR-23 |
| Maritime | *not loaded* | no | FR-24 → **UNEVALUATED, never "clear water"** |
| Models | trained offline, shipped as JSON | n/a | FR-07, FR-10, FR-13 |

**Every absent source degrades to UNEVALUATED.** Nothing defaults, nothing imputes, nothing
assumes a quiet Sun or an empty ocean.

---

## 3. Scale

### What it handles today

| Quantity | Measured |
|---|---|
| Catalogue screened | **31,572 objects** |
| Conjunction screening | apogee/perigee sieve → coarse → fine TCA refine |
| Ground raster | 259,200 cells, **100% characterised**, 4.4 MB |
| Monte Carlo footprint | 20,000 samples per deorbit, deterministic |
| Constraint evaluation | 28 rules × N events, **pure arithmetic, no I/O** |
| Refresh cadence | 8 h catalogue · 5 min space weather · 2 min X-ray |
| Consensus | 4 nodes, quorum 3, sub-second failover |
| Formal verification | **148,163 states exhaustively checked** |

### How each part scales

**The constraint engine is the easy part.** It is stateless and linear in
`rules × events` with no I/O — 28 rules over 38 events is roughly a thousand comparisons.
100,000 events would still be milliseconds. It is not, and will not become, the bottleneck.

**Conjunction screening is the real cost.** All-pairs over a catalogue is O(n²) — for 31,572
objects that is half a billion pairs. The sieve is what makes it tractable:

```
apogee/perigee filter    O(n²) pair rejection on scalars, no propagation
        ↓  ~99% rejected
coarse screen            300 s steps over a 24 h window
        ↓
fine TCA refinement      only for candidates inside the gate
```

**Naming the ceiling.** At ~31k objects a full screening pass takes 1–2 minutes on one core. At
100k it becomes the bottleneck — which is precisely where a GNN pre-filter earns its place
(published work reports 100,000 objects in 920 ms at 90.3% recall). The architecture for that is
already the one we use elsewhere: **the model proposes, the physics disposes**, and anything
flagged-but-unverified sits at UNRESOLVED rather than being silently trusted.

**Consensus.** Quorum is `⌈n/2⌉+1`; nothing assumes four nodes. Forty operators works with the
same protocol and the same TLA+ model, re-checked with a larger `Nodes` constant.

**The demo path has no scaling risk at all.** `SNAPSHOT=1` serves 13.9 MB of frozen real data,
and FR-00 still audits its age.

---

## 4. Failure behaviour

This is the part worth reading twice, because it is the product.

| Failure | What happens |
|---|---|
| Space-Track stale | **FR-00 BLOCKS the whole system.** It audits our own evidence first |
| NOAA down | FR-19/FR-21 → UNEVALUATED → UNRESOLVED. Never "conditions are fine" |
| GOES X-ray down | FR-19 loses its predictive deadline, keeps its current-state check |
| Operator feed gated | FR-11 → UNEVALUATED. We never label screening-grade data operator-grade |
| Model artefact absent | The rule it feeds reports UNEVALUATED. No default, no imputation |
| Model artefact mismatched | **REFUSED at load.** Better no model than one fed the wrong columns |
| A rule evaluator throws | That rule becomes UNEVALUATED, never SATISFIED |
| Sources disagree | UNRESOLVED. We do not average two disagreeing measurements |
| Verifier unreachable | An authored rule is **refused**, not admitted unverified |
| Snapshot goes stale | FR-00 blocks, exactly as with live data |

There is no path in this system where absence becomes permission.

---

## 5. Verification

| What | How | Result |
|---|---|---|
| Engine semantics | `node dev/constraints/engine.test.js` | **65/65**, offline, <1 s |
| Vote determinism | same event × 200 polls | **1 distinct outcome** |
| Formal safety | `tlc -config ConstraintGate.cfg` | **148,163 states, 0 violations** |
| The old bug | `tlc -config ConstraintGateBug.cfg` | **2-state counterexample** |
| Propagator | vs ESA dSGP4, 800 propagations | **0.000 m** |
| Classifier | real catalogue rows | ISS→CREWED, STARLINK→AUTOMATED_COLA, DEB→NONMANEUVERABLE |
| Portability | release-gate rulebook | 4/4 states, **0 engine changes** |

---

## 6. Honest limitations

Stated here rather than waiting to be asked.

- **Population is settlement-based** (GeoNames ≥15,000), not gridded. Rural exposure is
  undercounted, so our casualty numbers are **optimistic**. GHSL at 100 m is the upgrade.
- **Maritime exposure is not modelled.** FR-24 reports UNEVALUATED.
- **Debris casualty area is taken from published survivability data**, not modelled. Fragment
  ablation is a research programme.
- **The classifier's MANEUVERABLE precision is 0.52.** Weak supervision from names; the objects
  it exists for are the ones we cannot score.
- **The maneuver detector separates active from inert by only 3.2% vs 2.0%.** A robust z-score
  adapts to each object, so a constellation that manoeuvres constantly gets a wide baseline and
  its own burns stop looking anomalous. Most useful on objects that manoeuvre rarely.
- **The flare forecast projects the peak of a flare already beginning.** It does not predict
  onset from a quiet Sun.
- **Propellant state is operator-declared** and simulated here; no public feed exists. Flagged
  `simulated: true` in every payload. Consumption is real; the starting balance is declared.
- **APPROVED is a coordination decision**, not a command to hardware.
