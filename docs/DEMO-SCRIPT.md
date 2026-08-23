# AstroMesh — demo video script

**Target: 3 minutes.** Judges stack-rank from memory, so the film has one job —
make the four-state signal *legible*, then make it *earned*.

Two rules from the judging research, and the whole script obeys them:

1. **Something working must be on screen inside 90 seconds.** No slide intro.
2. **One causal chain, shown whole**, beats a tour of nine features.

Everything below is on screen in the running app. Nothing is mocked for the
film. Where a layer is a replay rather than live, the script says so *out loud*
— that candour is worth more than the extra second it costs.

---

## Before you record

| Check | Why |
|---|---|
| Gateway + frontend running; page reloaded once | boot animation is a nice cold open |
| `HOW` tab opened once already | warms the corridor + ground layers so nothing stalls on camera |
| Browser at 1600×900, zoom 100% | matches the layout everything was tuned for |
| Wifi off for a dry run | if it survives that, it survives the venue |

---

## 0:00 — 0:12 · Cold open

**On screen:** the app as it loads. Globe flies in. `BLOCKED 44%` sits in the sidebar.

> "This is a live orbital traffic system. Thirty-one thousand tracked objects,
> real catalogue, real conjunctions.
> The bar at the top left is the only thing I need you to watch: it says
> **BLOCKED**. Not *error* — **blocked**. Something is outstanding, and the
> system will not authorise anything until it is resolved."

*Don't explain the architecture. Let them see it running.*

---

## 0:12 — 0:45 · The gate refuses — and names why

**Do:** `RISK` tab → top card → **VOTE**.

**On screen:** toast — `OPERATOR VOTE REFUSED`. The rulebook fills the panel.

> "Four operator profiles just voted on this maneuver. The gate refused them.
>
> Here's why — **FR-07: at least one object must be commandable.** Both of these
> are dead debris. Nobody can move either one.
>
> That rule is **non-negotiable**. There is no waiver path in the code — not a
> permission, an *absence of code*. A unanimous yes from every operator on
> Earth could not override it."

**Then point at the grey rows:**

> "And these aren't failures — they're **UNRESOLVED**. Rules we could not
> evaluate. Most systems would call that 'no problem found'. We call it
> blocking, because *we don't know* is different from *it's fine*."

*This is the thesis. Everything after is evidence.*

---

## 0:45 — 1:30 · One event, every layer

**Do:** `HOW` tab. The globe flies to the corridor and paints it.

> "Long March 5B, November 2022 — a twenty-tonne stage that closed Spanish and
> French airspace. Every step here names a number **and where the number came from**."

Walk the panel, pausing on four:

**① Why the corridor is that wide**
> "Kp from the live NOAA feed. Atmospheric density uncertainty ±49 percent —
> *measured*, from 1,047 samples. A solar storm widens this corridor; we don't
> choose to."

**② What's underneath**
> "DINOv3 — Meta's satellite vision model. Eighteen million sub-cells at 3.4
> kilometres. We validated it against a population raster **it never saw**:
> correlation 0.75. And above sixty north it *refuses* to classify, because we
> measured that it fails there."

**③ The regulated number**
> "Casualty expectancy: **twenty times over the legal limit**."

**④ The finding — slow down here**
> "Now the interesting part. NASA's own tool computes this against a population
> map **flattened into latitude bands** — it can't see which longitude the
> debris is heading for. Same footprint, and it reports **half the risk**.
>
> We measured that across eighteen thousand footprints: over the densest ground,
> the regulator's method understates exposure **ninety-four percent of the time**."

*If you cut anything, do not cut ④. It is the one claim no other team can answer.*

---

## 1:30 — 1:55 · Ride it down

**Do:** `⏵ FOLLOW DESCENT`. Let it run ~12 s. Optionally `¼×` over land.

> "Same data, from the vehicle. Altitude, flight-path angle, downrange — and the
> ground scrolling underneath is the vision model's classification: red is
> built-up, blue is water, grey is where it declines to answer.
>
> To be precise: the corridor and the parameters are the recorded event. The
> motion is a kinematic replay along it — nobody has telemetry from a tumbling
> stage, and the caption on screen says exactly that."

*Volunteering the limit is the point. Judges test for it.*

---

## 1:55 — 2:20 · A storm on the Sun, inside the rulebook

**Do:** `STORMS` tab → **⚡ REPLAY GANNON**.

**On screen:** three bands paint; stations drop 8 → 3; header goes Kp 9 · G5.

> "May 2024, the Gannon storm — the largest satellite migration ever recorded.
>
> Watch the whole planet. Polar caps: HF radio dead. Auroral oval: GNSS
> degraded. Equatorial belt: scintillation. Our ground stations go from eight
> reachable to three —
>
> — and *that* reaches into the gate. FR-19 says the command uplink must survive.
> The Sun just shortened the window to command a satellite, so the deadline to
> decide moved. That's the whole argument: a constraint isn't a checkbox, it's a
> thing the physical world can take away from you."

---

## 2:20 — 2:40 · The same engine, somewhere else entirely

**Do:** `STORMS` → **PROVE IT** (or the portability panel).

> "The challenge asked for this to be theme-independent. So here's the identical
> engine — same binary, zero changes — running a **software release gate**:
> CVEs, rollback plans, error budgets.
>
> And a third: **FAA aircraft dispatch**. The Minimum Equipment List is *natively*
> four-state — dispatch, dispatch with a placard and a repair deadline, no
> dispatch, or not yet classified. An industry arrived at our four states decades
> before we did.
>
> There's a test in the repo asserting the engine contains no domain vocabulary
> at all. Rules are data. Orbit is just where we needed it first."

---

## 2:40 — 3:00 · Close

**Do:** `FILTERS` → **⚡ GPU SCREEN** (numbers land in ~1 s), then back to `HOW`.

> "Last thing — that just screened **every pair in the catalogue**, about half a
> billion, as a compute shader on this laptop's GPU. It's the coarse filter;
> candidates get re-screened with full SGP4. The verdict never comes from it.
>
> Four states: complete, partial, blocked, unresolved.
> Three of them are backed by something outside our own judgement — a model
> checker over a hundred and forty-eight thousand states, property tests, and
> coverage theorems.
>
> And two of those are statements about what we **cannot** do."

**Last frame:** the signal card. Stop.

---

## If you have 60 extra seconds

In priority order:

1. **Kill quorum live.** `FLEET` → STOP two nodes. The whole gate slams to
   BLOCKED — *"FR-08 is non-negotiable; I just took the system's authority away
   in four seconds."* Restart them, watch it recover. Cheapest drama on the board.
2. **Recourse.** In the story, an UNRESOLVED step's button: *"acquire this, 20
   seconds, and it clears — and we verified no smaller set works."*
3. **Receipts.** *"Every decision emits a hash-chained receipt that replays
   byte-for-byte. Change one input, the hash changes."*
4. **The autonomous agent.** `ACTIVATE`, then the feed: it plans a maneuver and
   submits itself to the same gate a human faces — and stands down when refused.

## Round 1 features — mention, don't demo

They're visible behind everything anyway; naming them in one breath is enough:

> "The Round 1 system is all still here — the 31,000-object catalogue, SGP4
> screening, the avoidance planner that checks a new orbit against the whole
> catalogue, the launch-window planner, the multi-operator consensus, the AI
> mission-control chat. Round 2 put a gate in front of every irreversible thing
> it can do."

---

## Questions you will get, and the honest answer

| Question | Answer |
|---|---|
| *"Four states — isn't that just XACML?"* | **Say it first, before they do.** "Deliberately isomorphic to XACML's Permit/Deny/Indeterminate/NotApplicable — inventing decision semantics is how you get them wrong. What's new is the second invariant: you cannot waive what you never measured. XACML has no notion of measurement freshness." |
| *"Is the data real?"* | Catalogue, CDMs, TIP re-entry predictions, NOAA space weather, Starlink ephemerides, GHS-POP: **real**. The Monte Carlo dispersion and the descent motion: simulation, labelled on screen. Propellant balances: operator-declared, flagged `simulated: true` in every record. |
| *"148k states is a small model."* | "It's bounded model checking over a finite instance, not a proof for unbounded N — and I'd rather show you the counterexample: this two-state trace reproduces a real bug we shipped and fixed." |
| *"Your rules are JavaScript closures, not logic."* | "Correct. Minimality is verified exhaustively over the evidence universe, not proved over a logical encoding. I'd say 'verified minimal', never 'formally guaranteed'." |
| *"Did the vision model really help?"* | "It's honest about where it doesn't. Above 60°N it declines — we measured the failure and encoded the refusal. 99.6% of the world's population is inside the band where it's validated." |
| *"What didn't work?"* | **Have this ready — it scores.** "We tried to ground FR-07 in real ESA telemetry. Neither our method nor a 3-sigma baseline beat 2.3% recall on a time-ordered split. We didn't ship it. It's in the appendix." |

---

## Delivery notes

- **Cut every 'so' and 'basically'.** Numbers land harder in silence.
- **Never say "formally verified" unqualified.** Say what was checked and to what bounds.
- **When the gate refuses, don't apologise for it.** That is the product working.
  Slow down there instead of speeding up.
- **Have a recorded fallback cued.** The unanimous advice from every judging
  post-mortem: a stalled live demo is the top killer. `demo/astromesh-round2.mp4`.
