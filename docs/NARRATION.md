# AstroMesh — narration

*Spoken text only. About two and a half minutes.*

---

**[Boot / globe]**

AstroMesh is a collision-avoidance system for satellites. It screens about
thirty-one thousand tracked objects against the real catalogue.

The panel on the left shows the current state of the system, and right now it
says BLOCKED. That means there is outstanding work, and the system will not
authorise any manoeuvre until that work is resolved.

For this round we added a constraint gate. Every irreversible action has to
pass through it, and it reports one of four states: complete, partial, blocked,
or unresolved.

---

**[Risk tab → VOTE]**

This is a real conjunction between two objects. I'll put it to the operator
vote.

The gate refused it, and it lists the reasons. The first one is Flight Rule
seven, which requires that at least one of the two objects can be commanded.
Both of these are debris, so neither can be moved.

That rule is marked non-negotiable. There is no waiver path for it in the
engine, so even a unanimous vote cannot approve this.

The rows in grey are different. Those are rules the system could not evaluate
at all, and we report them as unresolved. A lot of systems would treat missing
data as no problem found. We treat it as blocking, because not knowing is not
the same as being fine.

---

**[How tab → corridor draws]**

This panel walks through one real event: the Long March 5B core stage that
re-entered in November 2022 and closed airspace over Spain and southern France.

Each step gives a number and where that number came from.

The width of the corridor comes from the live geomagnetic index. The density
uncertainty is plus or minus forty-nine percent, and that figure is measured
from our own calibration rather than assumed.

The ground underneath is classified by DINOv3, a satellite vision model. We ran
it over eighteen million cells at three-point-four kilometre resolution and
validated it against a population dataset the model had never seen. Above sixty
degrees north it stops classifying, because we measured that it becomes
unreliable there.

The casualty expectancy for this footprint is about twenty times the legal
limit.

This next step is the one I'd highlight. The standard method used by
regulators averages population into latitude bands, so it cannot tell which
longitude the debris is heading for. On the same footprint it reports roughly
half the risk. We measured this across eighteen thousand footprints, and over
densely populated ground it understates exposure ninety-four percent of the
time.

---

**[Follow descent]**

This is the same descent viewed from the vehicle, with altitude, flight path
angle and downrange distance.

The colours on the ground are the vision model's output. Red is built-up land,
blue is water, and grey is where the model declines to classify.

The corridor and the entry parameters are from the recorded event. The motion
along it is a replay, and the caption on screen says so.

---

**[Storms tab → Gannon]**

This is the Gannon storm from May 2024, when roughly half of all satellites in
low Earth orbit manoeuvred within a few days.

The bands show where the effects apply. Radio communications fail over the
poles, satellite navigation degrades in the auroral regions, and there is
scintillation around the equator. Our reachable ground stations drop from eight
to three.

That feeds back into the rulebook. Flight Rule nineteen requires the command
uplink to be available long enough to send the manoeuvre, so the deadline to
make a decision moves earlier.

That is the point of the whole system. A constraint is not a fixed checkbox.
Conditions in the real world can remove your ability to act while you are still
deciding.

---

**[Prove it]**

The challenge asked for the capability to work independently of any particular
theme.

This is the same engine with no code changes, running a software release gate
instead: test results, security vulnerabilities, rollback plans and error
budgets. Same four states, same precedence.

The rules are data. Orbital operations is simply the domain we needed it for
first.

---

**[GPU screen → close on the signal]**

Finally, this screened every pair in the catalogue, around half a billion of
them, using a compute shader on this laptop's graphics card. It is a coarse
filter, and every candidate it produces is re-screened with full orbital
propagation before anything acts on it.

So: four states, complete, partial, blocked and unresolved.

The repository has the supporting work — a model checker that explored a
hundred and forty-eight thousand states, property tests over generated
rulebooks, and coverage guarantees for the statistical bounds.

Two of those results are about the limits of what the system can determine.
