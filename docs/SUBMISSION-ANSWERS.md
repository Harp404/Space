# Submission answers

---

## "Explain how well you implemented the task, and why is it the best possible way to do so?"

**The task.** Extend the MVP with a capability about limits, conditions and
non-negotiable requirements — showing whether the related work is complete,
partial, blocked or unresolved — that fits the existing product and stays
independent of any theme.

**What we built.** A constraint gate that sits in front of every irreversible
action. It returns one of the four required states, with precedence
`BLOCKED > UNRESOLVED > PARTIAL > COMPLETE`, and it enforces two invariants
everywhere: *unresolved is never a pass*, and *you cannot waive a rule that was
never measured*.

**Why this is the right design rather than one of several.**

1. **The engine knows nothing about the domain; rules are data.** This is the
   only structure that makes theme independence provable rather than claimed.
   The same binary evaluates orbital manoeuvres, a software release gate and an
   FAA aircraft-dispatch rulebook, with zero code changes — and a test asserts
   the engine source contains no domain vocabulary at all. An engine with
   domain logic could only ever *assert* portability.

2. **Non-negotiable means an absence of code, not a policy flag.** Rules marked
   `waivable: false` have no override branch anywhere. This cannot be
   misconfigured, escalated past, or forgotten under pressure, which a
   permission model cannot promise.

3. **Failure is loud by construction.** A rule that throws becomes UNEVALUATED,
   never SATISFIED. A rule whose applicability is unknown is UNEVALUATED, not
   skipped. Most gates fail open under exactly these conditions.

4. **Every dead end carries its exit.** Each unresolved rule names the
   measurement that would clear it, and the gate computes the cheapest
   sufficient set — with minimality verified by re-evaluating every proper
   subset — or proves the state terminal, in which case it recommends nothing.
   A four-state signal that cannot say what to do next is a diagnosis without a
   treatment.

**Evidence it works, rather than assurances.**

- **Formal:** a TLA+ specification model-checked with TLC over 148,163 states
  and eight invariants, including a two-state counterexample that reproduces a
  real bug we shipped and fixed.
- **Property-based:** eight properties over thousands of generated rulebooks —
  among them *COMPLETE implies every rule was actually evaluated*, and *a rule
  that throws never becomes SATISFIED*. 224 assertions pass in total.
- **External:** our satellite-vision layer was validated against a population
  dataset it never saw (Spearman +0.75), and its failure band above 60°N was
  measured and encoded as a refusal rather than hidden.
- **Reproducible:** every decision emits an RFC 8785 canonical-JSON,
  hash-chained receipt that replays byte-for-byte.

**It fits the MVP because it constrains what the MVP already did.** Round 1
planned manoeuvres and voted on them. Round 2 puts the gate in front of that
vote — the API itself returns 409 when unauthorised, so the interface cannot
route around it.

**What we are careful not to claim.** The model check is bounded, not a proof
for unbounded inputs. Minimality is verified exhaustively over a small declared
evidence universe, not proved over a logical encoding. Propellant balances are
operator-declared and flagged as such in every record, and one rule — maritime
clearance — is permanently unevaluable because we have no AIS feed, which we
left visible on purpose. A system arguing that unknowns must be reported would
be a poor advertisement for itself if it hid its own.

---

## "What makes it innovative?"

The novel part is not the four states — those are deliberately isomorphic to
OASIS XACML's Permit / Deny / Indeterminate / NotApplicable, because inventing
decision semantics is how projects get them wrong. Three things are new:

1. **The same rule returns a different state depending on the quality of
   evidence available.** Positional knowledge is read from SpaceX's public
   Starlink ephemerides where they exist — 3 m at closest approach, which passes
   the standard — and from our own TLE-derived conformal bound where they do
   not — 1,689 m, which fails it. Nothing about the satellite changed; what
   changed is how much is known about it.

2. **Two provably different kinds of "unresolved."** One is fixable with data,
   and the system states how much is needed, from the coverage law for
   split conformal prediction. The other is impossible in principle, and it
   cites why. Telling an operator to collect more data when nothing can help
   wastes a mission.

3. **A measured finding against the incumbent method.** Casualty expectancy is
   computed on a real 2-D population field and beside the 1-D latitude-band
   method the regulatory tool uses. Across 18,257 sampled footprints the 1-D
   method understates exposure 94.1% of the time over the densest ground, by a
   median factor of 3.9. That is a falsifiable result, not a feature.
