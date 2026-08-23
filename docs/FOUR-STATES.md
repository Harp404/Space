# Why four states, and why this order

*Semantic grounding for the completion signal.*

---

## The claim, stated carefully

We did not invent a four-valued answer. We arrived at one, and then found that
runtime verification had derived the same shape thirty years earlier for the
same reason. This document says exactly how far that correspondence goes — and
where it stops — because overclaiming here would be worse than not citing it at
all.

**What we claim:** our precedence order is the *settled-verdict* order, and our
refusal to let UNRESOLVED count as a pass is the same refusal LTL₃ makes.

**What we do not claim:** that this is an LTL monitor, or an implementation of
RV-LTL. It is not. We have not built a Moore machine over an ω-language.

---

## LTL₃ and the refusal to guess

Bauer, Leucker and Schallhart's **LTL₃** evaluates a linear-temporal-logic
formula over a *finite prefix* of an infinite word — that is, over what has
happened so far, when the future has not arrived yet. It is three-valued:

| LTL₃ | meaning |
|---|---|
| ⊤ | every possible continuation satisfies the formula — the verdict is **settled** |
| ⊥ | no possible continuation satisfies it — settled the other way |
| **?** | **both a satisfying and a violating continuation exist — inconclusive** |

The third value exists because collapsing it into either of the other two would
be a lie. A monitor that reports ⊤ when some continuation still violates the
property has claimed knowledge it does not have.

That is our first invariant, exactly: **UNRESOLVED is never a pass.** We reached
it from operations — a gate that treats "we did not measure it" as "it is fine"
will eventually approve something it should not have. LTL₃ reaches it from
semantics. The agreement is worth noting precisely because the two routes are
independent.

> Bauer, Leucker & Schallhart, *Runtime Verification for LTL and TLTL*,
> ACM TOSEM 20(4), 2011.
> <https://cs.uwaterloo.ca/~bbonakda/teaching/CS745/papers/RV.pdf>

## RV-LTL and the four-valued refinement

**RV-LTL** refines the inconclusive verdict into two, giving four values:
satisfied, violated, *presumably satisfied*, *presumably violated* — where the
"presumably" pair covers prefixes whose ω-verdict is not yet settled but whose
finite-word semantics leans one way.

> Bauer, Leucker & Schallhart, *Comparing LTL Semantics for Runtime
> Verification*, Journal of Logic and Computation 20(3):651–674, 2010.
> <https://academic.oup.com/logcom/article-abstract/20/3/651/1016387>

**The correspondence is structural, not an isomorphism.** RV-LTL's axis is
*certain vs presumptive*; ours is *complete vs obstructed*. The honest mapping:

| ours | nearest RV-LTL / LTL₃ notion | settled? |
|---|---|---|
| BLOCKED | ⊥ — no continuation satisfies it | **yes** |
| COMPLETE | ⊤ — every continuation satisfies it | **yes** |
| PARTIAL | presumably satisfied, under recorded waivers | no |
| UNRESOLVED | **?** — inconclusive | no |

## Why BLOCKED dominates

Our precedence is `BLOCKED > UNRESOLVED > PARTIAL > COMPLETE`.

Read through the lens above, this is not a preference. **Settled verdicts
dominate unsettled ones**, and among settled verdicts the negative one dominates
because a violated non-negotiable admits no continuation that satisfies the
rulebook. There is no waiver path in the engine — not as policy, but as an
absence of code.

An unsettled verdict can still become either. That is why UNRESOLVED outranks
PARTIAL: a waived, recorded, human-owned shortfall is a decision someone made,
whereas an unevaluated rule is a decision nobody has made yet. Acting on the
second is acting without an owner.

This is a checkable statement rather than a rhetorical one, and it is checked:
`engine.properties.test.js` asserts across thousands of generated rulebooks that
any UNEVALUATED rule forces UNRESOLVED or BLOCKED, and that a COMPLETE signal
implies every rule was actually evaluated.

## Monitorability, and when BLOCKED is terminal

A property is *monitorable* from a given prefix when some extension still
settles it. Once no extension can, the verdict is final and further observation
is wasted effort.

Our `recourse.js` computes exactly this distinction operationally: if a
non-negotiable rule is violated, no acquisition of evidence changes the outcome,
and the gate reports **terminal** rather than offering a list of measurements.
Telling an operator to collect more data when nothing can help is worse than
telling them nothing.

> Aceto, Achilleos, Francalanza, Ingólfsdóttir & Lehtinen, *An Operational
> Guide to Monitorability*, 2019. <https://arxiv.org/pdf/1902.00435>

## The second invariant has a name too

**You cannot waive what you never measured.**

In eliminative argumentation this is the discipline of *defeaters*: confidence
in a claim rises only as identified defeaters are eliminated by evidence, never
by assertion. A waiver eliminates a defeater that was actually raised; it cannot
eliminate one that was never enumerated.

> Goodenough, Weinstock & Klein, *Eliminative Argumentation: A Basis for
> Arguing Confidence in System Properties*, CMU/SEI-2015-TR-005 (public domain).
> <https://resources.sei.cmu.edu/library/asset-view.cfm?assetid=47781>

The same idea has a visual convention in **GSN**, where an *undeveloped goal* is
drawn as a diamond — a claim with no supporting argument yet — and an
*undeveloped and uninstantiated* goal adds a circle, meaning nobody has even
said what would satisfy it. Our UNRESOLVED state is the first; a rule with no
declared `resolvedBy` is the second, and `auditEvidenceCoverage()` reports those
as a rulebook defect.

> GSN Community Standard v3, SCSC-141C (2021), CC-BY 4.0. <https://scsc.uk/gsn>

We describe this as a **GSN-inspired status vocabulary**, not as GSN
conformance. GSN is a notation for human safety arguments; we borrow its
distinction, not its semantics.

## Prior art we are not claiming parity with

- **XACML 3.0** decision values are Permit / Deny / **Indeterminate** /
  NotApplicable, and its deny-overrides combining algorithm with extended
  Indeterminate is close to our precedence. Our four states are deliberately
  isomorphic in shape — inventing decision semantics from scratch is how you get
  them wrong. What XACML has no analogue for is measurement *freshness*, which
  is where our second invariant lives.
- **AWS Config** ships COMPLIANT / NON_COMPLIANT / NOT_APPLICABLE /
  **INSUFFICIENT_DATA**.
- **Kubernetes** conditions are True / False / **Unknown**, and the API
  convention states that the absence of a condition must be read as Unknown.
- **GitHub Checks** separates `status` from `conclusion`, and has a `neutral`
  conclusion for a check that ran and declines to judge.
- **OPA/Rego** distinguishes `undefined` from `false`; the idiom
  `default allow := false` exists precisely because undefined is not false.

Every one of these is a mature system that independently concluded that "we do
not know" needs its own value. That convergence is the argument.

---

## The short version, for a reviewer in a hurry

Three of our four states are backed by something outside our own judgement, and
two of those are statements about what we **cannot** do:

- **BLOCKED is terminal** when a non-negotiable is violated — proved
  operationally by `recourse.js` finding no correction set, and structurally by
  there being no waiver branch in the engine.
- **UNRESOLVED is provable in two distinct forms** — *not yet* (with the sample
  count that would fix it, from the Beta coverage law) and *not ever* (per-object
  conditional coverage is impossible distribution-free at finite width, Barber
  et al. 2021).
- **COMPLETE implies every rule was evaluated** — asserted as a property over
  thousands of generated rulebooks, not over the handful we thought of.
