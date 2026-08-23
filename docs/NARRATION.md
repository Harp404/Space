# AstroMesh — narration

*Read aloud. Nothing here is a stage direction — this is only what is spoken.*
*Total: approximately 3 minutes at a measured pace.*

---

This is AstroMesh. It is a live orbital traffic system, screening thirty-one
thousand tracked objects against the real catalogue for collisions.

There is one thing I would like you to watch, and it is in the top left corner.
It says: blocked. Not error — blocked. Something is outstanding, and this system
will not authorise anything until it has been resolved.

That is the capability we built for this round. Every irreversible action here
passes through a gate, and the gate answers in four states: complete, partial,
blocked, or unresolved.

---

Here is a real conjunction — two objects on a converging pass. I am going to put
it to the operator vote.

The gate refused it.

It has named its reasons. Flight Rule seven: at least one of the two objects
must be commandable. Both of these are dead debris. Nobody can move either one,
and no amount of agreement changes that.

That rule is non-negotiable. There is no waiver path for it anywhere in the
engine — not a permission we withheld, an absence of code. A unanimous yes from
every operator on Earth could not override it.

And these rows in grey are not failures. They are unresolved: rules the system
could not evaluate at all. Most software treats missing data as no problem
found. We treat it as blocking, because we don't know is a different answer from
it's fine — and conflating those two is how accidents happen.

---

Now let me show you where a verdict comes from.

This is the Long March 5B core stage, November 2022 — a twenty-tonne rocket
body that came down uncontrolled and closed airspace over Spain and southern
France.

Every step here states a number, and where that number came from.

The corridor is this wide because of the live geomagnetic index from NOAA.
Atmospheric density uncertainty is plus or minus forty-nine percent — measured
from a thousand and forty-seven samples, not assumed. A solar storm widens this
corridor. We do not choose to.

What is underneath it comes from DINOv3, Meta's satellite vision model:
eighteen million sub-cells at three-point-four kilometre resolution. We
validated it against a population raster the model has never seen, and the
correlation is zero point seven five. Above sixty degrees north it refuses to
classify anything, because we measured that it fails there and encoded the
refusal.

The casualty expectancy for this footprint is twenty times over the legal limit.

And here is the part I would ask you to sit with. The regulator's own tool
computes that number against a population map that has been flattened into
latitude bands. It cannot see which longitude the debris is heading for. Given
the same footprint, it reports roughly half the risk.

We measured that difference across eighteen thousand footprints. Over the
densest ground on Earth, the standard method understates exposure ninety-four
percent of the time.

---

This is the same descent, from the vehicle.

Altitude, flight path angle, downrange distance. The ground scrolling underneath
is the vision model's classification — red is built up, blue is water, and grey
is where the model declines to answer.

To be precise about what you are watching: the corridor and the entry parameters
are the recorded event. The motion along it is a kinematic replay. Nobody has
telemetry from an uncontrolled tumbling rocket stage, and the caption on screen
says exactly that.

---

May 2024. The Gannon storm — the largest satellite migration ever recorded,
when roughly half of all objects in low Earth orbit manoeuvred within days.

Watch the whole planet. Over both poles, high frequency radio goes dead. The
auroral ovals expand, and satellite navigation degrades inside them. Around the
equator, a scintillation belt. Our ground stations drop from eight reachable to
three.

And that reaches directly into the rulebook. Flight Rule nineteen requires that
the command uplink survives long enough to send the manoeuvre. The Sun has just
shortened the window in which we can command a satellite, so the deadline to
decide has moved.

That is the whole argument in one event. A constraint is not a checkbox on a
form. It is something the physical world can take away from you while you are
deciding.

---

This challenge asked for a capability that stays independent of any particular
theme. So here is the identical engine — the same binary, with zero changes —
running a software release gate. Test results, security vulnerabilities,
rollback plans, error budgets.

And a third domain: aircraft dispatch, under the FAA's Minimum Equipment List.
That system is natively four-state. An aircraft may dispatch; it may dispatch
with a placard, a procedure, and a repair deadline; it may not dispatch; or the
item is not listed and therefore not yet classified. An industry arrived at
these four states decades before we did.

There is a test in the repository that asserts the engine contains no
domain-specific vocabulary at all. The rules are data. Orbit is simply where we
needed this first.

---

One last thing.

That just screened every pair in the catalogue — approximately half a billion
of them — as a compute shader running on this laptop's own graphics card. It is
a coarse filter. Every candidate it finds is re-screened with full orbital
propagation before anything acts on it. The verdict never comes from that pass,
and the interface says so.

Four states. Complete, partial, blocked, unresolved.

Three of them are backed by something outside our own judgement: a model checker
that explored a hundred and forty-eight thousand states, property tests across
thousands of generated rulebooks, and finite-sample coverage theorems.

And two of those are statements about what we cannot do.

Thank you.
