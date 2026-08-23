---- MODULE ConstraintGate ----
(**********************************************************************
 * TLA+ specification of the AstroMesh CONSTRAINT GATE.
 *
 * WHY THIS MODULE EXISTS
 *
 * AstroMesh.tla proves the consensus protocol: no conjunction is APPROVED
 * without quorum. It says nothing about the flight rules, and — critically —
 * it had no Emergency action at all. The implementation DID have one, and it
 * set status APPROVED with zero votes. TLC never saw the violation because
 * the model never described the path.
 *
 * That is the gap this module closes. It proves the properties the UI claims:
 *
 *   ConstraintSafety      a maneuver is never APPROVED while a NON-NEGOTIABLE
 *                         rule is violated. Not by the leader, not under an
 *                         emergency, not by any reachable sequence of actions.
 *
 *   NoAuthoriseOnUnknown  a maneuver is never APPROVED while an applicable rule
 *                         is UNEVALUATED. Not knowing is not permission.
 *
 *   WaiverSoundness       a waiver never attaches to a non-waivable rule, and
 *                         never to a rule that was never evaluated.
 *
 *   EmergencyBounded      the emergency path cannot reach any state the normal
 *                         path could not. It buys speed, not authority.
 *
 *   QuorumRespected       APPROVED still implies quorum, INCLUDING via the
 *                         emergency path. This is the invariant the old
 *                         implementation actually violated.
 *
 * Check with:  tlc ConstraintGate.tla -config ConstraintGate.cfg
 **********************************************************************)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
    Nodes,          \* operator nodes, e.g. {1,2,3,4}
    Rules,          \* rule identifiers, e.g. {"r1","r2","r3"}
    HardRules,      \* SUBSET Rules  — violation blocks
    NonNegotiable,  \* SUBSET HardRules — no waiver path exists
    Quorum,         \* votes required to approve
    BuggyEmergency  \* TRUE reinstates the pre-fix emergency path, for demonstration

ASSUME HardRules \subseteq Rules
ASSUME NonNegotiable \subseteq HardRules
ASSUME Quorum \in Nat /\ Quorum > 0
ASSUME BuggyEmergency \in BOOLEAN

RuleStates == {"SATISFIED", "VIOLATED", "UNEVALUATED", "WAIVED", "NOT_APPLICABLE"}
Signals    == {"COMPLETE", "PARTIAL", "BLOCKED", "UNRESOLVED"}
Statuses   == {"MONITORING", "POLLING", "APPROVED", "DENIED"}

(* ------------------------------------------------------------------
   State
   ------------------------------------------------------------------ *)
VARIABLES
    ruleState,      \* [Rules -> RuleStates]
    waived,         \* SUBSET Rules — rules with a waiver on record
    status,         \* the maneuver's authorisation status
    votes,          \* SUBSET Nodes — YES voters
    emergency       \* TRUE once an emergency has been declared

vars == <<ruleState, waived, status, votes, emergency>>

(* ------------------------------------------------------------------
   Derived: the completion signal.
   Mirrors dev/constraints/engine.js exactly, including precedence:
       BLOCKED > UNRESOLVED > PARTIAL > COMPLETE
   ------------------------------------------------------------------ *)
Applicable == { r \in Rules : ruleState[r] # "NOT_APPLICABLE" }

BlockingRules   == { r \in HardRules : ruleState[r] = "VIOLATED" }
UnevaluatedRules == { r \in Applicable : ruleState[r] = "UNEVALUATED" }
AdvisoryRules   == { r \in (Rules \ HardRules) : ruleState[r] = "VIOLATED" }
WaivedRules     == { r \in Rules : ruleState[r] = "WAIVED" }

Signal ==
    IF BlockingRules # {} THEN "BLOCKED"
    ELSE IF UnevaluatedRules # {} THEN "UNRESOLVED"
    ELSE IF (AdvisoryRules # {} \/ WaivedRules # {}) THEN "PARTIAL"
    ELSE "COMPLETE"

\* Authorisation is the actionable read of the signal. UNRESOLVED is NOT
\* authorised — this single line is the difference between a system that
\* refuses to guess and one that does.
Authorised == Signal \in {"COMPLETE", "PARTIAL"}

(* ------------------------------------------------------------------
   Type invariant
   ------------------------------------------------------------------ *)
TypeOK ==
    /\ ruleState \in [Rules -> RuleStates]
    /\ waived \subseteq Rules
    /\ status \in Statuses
    /\ votes \subseteq Nodes
    /\ emergency \in BOOLEAN

(* ------------------------------------------------------------------
   Initial state — nothing evaluated yet, which is UNRESOLVED, not COMPLETE.
   ------------------------------------------------------------------ *)
Init ==
    /\ ruleState = [r \in Rules |-> "UNEVALUATED"]
    /\ waived = {}
    /\ status = "MONITORING"
    /\ votes = {}
    /\ emergency = FALSE

(* ------------------------------------------------------------------
   Actions
   ------------------------------------------------------------------ *)

\* Evidence arrives and a rule is evaluated to a definite outcome.
Evaluate(r, outcome) ==
    /\ status \in {"MONITORING", "POLLING"}
    /\ ruleState[r] = "UNEVALUATED"
    /\ outcome \in {"SATISFIED", "VIOLATED", "NOT_APPLICABLE"}
    /\ ruleState' = [ruleState EXCEPT ![r] = outcome]
    /\ UNCHANGED <<waived, status, votes, emergency>>

\* Evidence is withdrawn or goes stale — a rule can return to UNEVALUATED.
\* Modelled because it must NOT be possible to keep an approval alive by
\* letting the evidence behind it expire.
Invalidate(r) ==
    /\ status \in {"MONITORING", "POLLING"}
    /\ ruleState[r] \in {"SATISFIED", "VIOLATED"}
    /\ ruleState' = [ruleState EXCEPT ![r] = "UNEVALUATED"]
    /\ waived' = waived \ {r}
    /\ UNCHANGED <<status, votes, emergency>>

\* A named party waives a rule.
\*
\* THE TWO GUARDS ARE THE WHOLE POINT:
\*   r \notin NonNegotiable   — non-negotiable rules have no waiver path
\*   ruleState[r] = "VIOLATED" — you cannot waive what was never evaluated
WaiveRule(r) ==
    /\ status \in {"MONITORING", "POLLING"}
    /\ r \notin NonNegotiable
    /\ ruleState[r] = "VIOLATED"
    /\ ruleState' = [ruleState EXCEPT ![r] = "WAIVED"]
    /\ waived' = waived \cup {r}
    /\ UNCHANGED <<status, votes, emergency>>

\* THE GATE. The poll may only open when the constraint work permits it.
OpenPoll ==
    /\ status = "MONITORING"
    /\ Authorised
    /\ status' = "POLLING"
    /\ UNCHANGED <<ruleState, waived, votes, emergency>>

CastVote(n) ==
    /\ status = "POLLING"
    /\ n \notin votes
    /\ votes' = votes \cup {n}
    /\ UNCHANGED <<ruleState, waived, status, emergency>>

\* Commit. Both guards are required: quorum AND a still-authorised signal.
\* Re-checking Authorised here is what stops an approval sneaking through on
\* evidence that expired while the poll was open.
Approve ==
    /\ status = "POLLING"
    /\ Cardinality(votes) >= Quorum
    /\ Authorised
    /\ status' = "APPROVED"
    /\ UNCHANGED <<ruleState, waived, votes, emergency>>

Deny ==
    /\ status = "POLLING"
    /\ status' = "DENIED"
    /\ UNCHANGED <<ruleState, waived, votes, emergency>>

\* EMERGENCY.
\*
\* This is the action the original model did not have, and the implementation
\* got wrong. An emergency auto-waives the WAIVABLE hard rules that are
\* currently violated. It does NOT touch non-negotiable rules, it does NOT
\* create evidence for unevaluated ones, and it does NOT bypass the poll.
DeclareEmergency ==
    /\ status = "MONITORING"
    /\ ~emergency
    \* Refused outright if any non-negotiable rule is violated.
    /\ \A r \in NonNegotiable : ruleState[r] # "VIOLATED"
    \* Refused outright if anything applicable is unevaluated: an emergency is
    \* not evidence.
    /\ UnevaluatedRules = {}
    /\ ruleState' = [ r \in Rules |->
           IF /\ r \in HardRules
              /\ r \notin NonNegotiable
              /\ ruleState[r] = "VIOLATED"
           THEN "WAIVED"
           ELSE ruleState[r] ]
    /\ waived' = waived \cup { r \in HardRules :
           /\ r \notin NonNegotiable
           /\ ruleState[r] = "VIOLATED" }
    /\ emergency' = TRUE
    /\ UNCHANGED <<status, votes>>

(* ------------------------------------------------------------------
   THE ORIGINAL BUG, MODELLED.

   This is what dev/mock-gateway.js actually did before the fix:

       conj.status = 'APPROVED';
       votes: nodes.filter(n => n.online).map(n => ({ ..., vote: 'YES' }))

   It set APPROVED directly, with ZERO real votes, and fabricated unanimous
   consent from whoever happened to be online. One node was enough.

   It is included here — guarded by the BuggyEmergency constant, off by default —
   so the model checker can be shown finding the violation. A proof that only
   ever passes teaches you nothing about whether it was worth writing.

   Run with ConstraintGateBug.cfg to watch TLC produce the counterexample.
   ------------------------------------------------------------------ *)
LegacyEmergencyApprove ==
    /\ BuggyEmergency
    /\ status \in {"MONITORING", "POLLING"}
    /\ status' = "APPROVED"
    /\ emergency' = TRUE
    /\ UNCHANGED <<ruleState, waived, votes>>

\* Terminal. APPROVED and DENIED are final: the decision is made and the record
\* is closed. Modelled explicitly so a terminal state is a legitimate stutter
\* rather than a deadlock TLC reports as an error.
Done ==
    /\ status \in {"APPROVED", "DENIED"}
    /\ UNCHANGED vars

Next ==
    \/ \E r \in Rules, o \in {"SATISFIED", "VIOLATED", "NOT_APPLICABLE"} : Evaluate(r, o)
    \/ \E r \in Rules : Invalidate(r)
    \/ \E r \in Rules : WaiveRule(r)
    \/ OpenPoll
    \/ \E n \in Nodes : CastVote(n)
    \/ Approve
    \/ Deny
    \/ DeclareEmergency
    \/ LegacyEmergencyApprove
    \/ Done

Fairness ==
    /\ WF_vars(OpenPoll)
    /\ WF_vars(Approve)
    /\ WF_vars(Deny)
    /\ \A n \in Nodes : WF_vars(CastVote(n))

Spec == Init /\ [][Next]_vars /\ Fairness

(* ------------------------------------------------------------------
   SAFETY INVARIANTS — the properties the product claims
   ------------------------------------------------------------------ *)

\* A maneuver is never APPROVED while a non-negotiable rule is violated.
\* "Non-negotiable" stops being a word in the UI and becomes a theorem.
ConstraintSafety ==
    status = "APPROVED" =>
        \A r \in NonNegotiable : ruleState[r] # "VIOLATED"

\* Never APPROVED while any hard rule is violated at all.
NoApprovalWhileBlocked ==
    status = "APPROVED" => BlockingRules = {}

\* Never APPROVED while an applicable rule is UNEVALUATED.
\* Not knowing is not permission.
NoAuthoriseOnUnknown ==
    status = "APPROVED" => UnevaluatedRules = {}

\* A waiver never attaches to a non-negotiable rule, and a waived rule is one
\* that genuinely evaluated to VIOLATED first.
WaiverSoundness ==
    /\ \A r \in waived : r \notin NonNegotiable
    /\ \A r \in Rules : ruleState[r] = "WAIVED" => r \in waived

\* The emergency path reaches no state the normal path could not: it still
\* requires quorum, and it still cannot cross a non-negotiable rule.
EmergencyBounded ==
    (emergency /\ status = "APPROVED") =>
        /\ Cardinality(votes) >= Quorum
        /\ \A r \in NonNegotiable : ruleState[r] # "VIOLATED"

\* The invariant the ORIGINAL implementation violated: APPROVED implies quorum,
\* on every path including the emergency one.
QuorumRespected ==
    status = "APPROVED" => Cardinality(votes) >= Quorum

\* An approval is only ever reached through an authorised signal.
ApprovalImpliesAuthorised ==
    status = "APPROVED" => Authorised

(* ------------------------------------------------------------------
   LIVENESS — the gate must not deadlock: with every rule satisfied and
   enough nodes voting, the maneuver is eventually decided.
   ------------------------------------------------------------------ *)
GateLiveness ==
    (\A r \in Rules : ruleState[r] = "SATISFIED") ~>
        (status \in {"APPROVED", "DENIED"} \/ ~Authorised)

(* ------------------------------------------------------------------
   THEOREMS — checked exhaustively by TLC
   ------------------------------------------------------------------ *)
THEOREM Spec => []TypeOK
THEOREM Spec => []ConstraintSafety
THEOREM Spec => []NoApprovalWhileBlocked
THEOREM Spec => []NoAuthoriseOnUnknown
THEOREM Spec => []WaiverSoundness
THEOREM Spec => []EmergencyBounded
THEOREM Spec => []QuorumRespected
THEOREM Spec => []ApprovalImpliesAuthorised

====
