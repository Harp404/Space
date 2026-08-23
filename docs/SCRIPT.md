# AstroMesh — demo script

**Round 2 · Challenge #518 — Constraint Awareness: Completion Signal**
Three minutes. Spoken text in plain type, actions in **bold**.

---

## 1 · What it is  ·  0:00–0:25

**[Boot, globe flies in]**

AstroMesh is a collision-avoidance system for satellites.

In Round 1 we built the operational layer: a live catalogue of thirty-one
thousand tracked objects, all-pairs conjunction screening, an avoidance planner
that checks a new orbit against the whole catalogue, launch-window planning,
multi-operator consensus voting, and a natural-language mission-control
assistant.

That system told you about risk. Round 2 makes it refuse to act on risk it
cannot justify.

---

## 2 · The capability  ·  0:25–0:45

**[Point at the signal card]**

We added a constraint gate. Every irreversible action passes through it, and it
reports one of four states: complete, partial, blocked, or unresolved.

Two rules hold everywhere. Unresolved is never treated as a pass. And you
cannot waive a rule that was never measured.

Right now the fleet signal reads BLOCKED, so nothing can be authorised.

---

## 3 · A refusal, with reasons  ·  0:45–1:15

**[RISK tab → VOTE on the top card]**

Here is a real conjunction. I'll put it to the operator vote.

The gate refused it and listed why. Flight Rule seven requires that at least one
of the two objects can be commanded. Both are debris, so neither can be moved.
That rule is non-negotiable — there is no waiver path in the engine, so a
unanimous vote cannot approve it.

The rows in grey are rules we could not evaluate at all. We report those as
unresolved and treat them as blocking, because not knowing is not the same as
being fine.

---

## 4 · Where a verdict comes from  ·  1:15–2:00

**[HOW tab — corridor draws on the globe]**

This walks one real event through every layer: the Long March 5B stage that
re-entered in November 2022 and closed airspace over Spain and France.

Each step gives a number and its source.

Corridor width comes from the live geomagnetic index — density uncertainty of
plus or minus forty-nine percent, measured from our own calibration.

The ground underneath is classified by DINOv3, a satellite vision model, across
eighteen million cells at three-point-four kilometres. We validated it against
population data it had never seen. Above sixty degrees north it stops
classifying, because we measured that it becomes unreliable there.

Casualty expectancy for this footprint is twenty times the legal limit.

And this step is the finding. The standard regulatory method averages population
into latitude bands, so it cannot tell which longitude the debris is heading
for. On the same footprint it reports half the risk. Across eighteen thousand
footprints, it understates exposure ninety-four percent of the time over
densely populated ground.

**[FOLLOW DESCENT — 10 seconds]**

The same descent from the vehicle. Altitude, flight path angle, downrange. The
corridor is the recorded event; the motion is a replay, and the caption says so.

---

## 5 · Constraints move  ·  2:00–2:25

**[STORMS tab → REPLAY GANNON]**

This is the Gannon storm of May 2024, when about half of all low-orbit
satellites manoeuvred within days.

Radio fails over the poles, navigation degrades in the auroral regions, and our
reachable ground stations drop from eight to three. Flight Rule nineteen needs
the command uplink available long enough to send the manoeuvre, so the deadline
to decide moves earlier.

A constraint is not a fixed checkbox. Real conditions can remove your ability to
act while you are still deciding.

---

## 6 · Independent of the theme  ·  2:25–2:45

**[PROVE IT]**

The challenge required this to work outside any one domain.

Same engine, no code changes, running a software release gate instead — tests,
security vulnerabilities, rollback plans, error budgets. Same four states, same
precedence. We also encode an FAA aircraft-dispatch rulebook the same way.

The rules are data. Orbital operations is just where we needed it first.

---

## 7 · Close  ·  2:45–3:00

**[FILTERS → GPU SCREEN, then back to the signal]**

This screened every pair in the catalogue, about half a billion, on the laptop's
GPU. It is a coarse filter — candidates are re-screened with full propagation
before anything acts.

Four states: complete, partial, blocked, unresolved. The repository has the
supporting work: a model checker over a hundred and forty-eight thousand states,
property tests across generated rulebooks, and coverage guarantees for the
statistical bounds.

Two of those results describe the limits of what the system can determine.

---

## Round 2 — the checklist

Say these if there is time; each is on screen.

| Point | Where |
|---|---|
| Four states with strict precedence, blocked over unresolved | signal card |
| Non-negotiable rules with no waiver path | FR-05, FR-07, FR-08 in the rulebook |
| Unresolved as a blocking state | grey rows |
| Two-tier evidence: operator ephemeris 3 m vs TLE 1,689 m | FR-20 |
| Live official re-entry predictions | HOW, step 4 |
| Vision model with a measured refusal band | HOW, step 5 |
| 2-D exposure vs the 1-D regulatory method | HOW, step 9 |
| Countdown to self-blocking | signal card, "self-blocks in" |
| Cheapest set of measurements that would clear it | HOW, unresolved steps |
| Decision receipts, hash-chained and replayable | HOW, bottom |
| Quorum loss blocks everything | FLEET → STOP two nodes |
| Autonomous agent bound by the same gate | MISSION → ACTIVATE |

## Notes

- One take per scene; cut between them.
- Don't narrate clicking. Click, then speak to what appears.
- When the gate refuses, don't apologise — that is the product working.
- Never say "formally verified" without saying what was checked and to what bounds.
- Keep the recorded fallback cued.
