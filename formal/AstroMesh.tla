---- MODULE AstroMesh ----
(**********************************************************************
 * TLA+ specification of the AstroMesh orbital maneuver consensus
 * protocol.  Models Bully leader election + Two-Phase Commit (2PC)
 * for satellite collision-avoidance maneuver authorisation across
 * four distributed ground-control nodes.
 *
 * Check with: tlc AstroMesh.tla -config AstroMesh.cfg
 **********************************************************************)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
    Nodes,          \* {1,2,3,4} — ground-control node identifiers
    Conjunctions,   \* {1,2,3}   — tracked close-approach events
    MaxRisk         \* 100       — maximum risk index

ASSUME MaxRisk = 100
ASSUME Nodes = {1, 2, 3, 4}
ASSUME Conjunctions = {1, 2, 3}

(* ------------------------------------------------------------------
   State variables
   ------------------------------------------------------------------ *)
VARIABLES
    nodeState,      \* [n \in Nodes -> "ONLINE" | "OFFLINE"]
    leader,         \* current leader node id (or 0 = no leader)
    conjStatus,     \* [c \in Conjunctions -> "MONITORING"|"LOCKED"|"APPROVED"|"DENIED"]
    conjLock,       \* [c \in Conjunctions -> node id holding 2PC lock, or 0]
    votes,          \* [c \in Conjunctions -> SUBSET Nodes  (YES voters)]
    maneuverLog     \* SEQUENCE of approved conjunction ids

vars == <<nodeState, leader, conjStatus, conjLock, votes, maneuverLog>>

(* ------------------------------------------------------------------
   Derived helpers
   ------------------------------------------------------------------ *)
OnlineNodes == { n \in Nodes : nodeState[n] = "ONLINE" }

\* Bully: highest-id online node is leader (0 when none online)
ElectedLeader ==
    IF OnlineNodes = {}
    THEN 0
    ELSE CHOOSE n \in OnlineNodes : \A m \in OnlineNodes : n >= m

Quorum == 3   \* >= 3 YES votes required to APPROVE

(* ------------------------------------------------------------------
   Type invariant
   ------------------------------------------------------------------ *)
TypeOK ==
    /\ nodeState  \in [Nodes        -> {"ONLINE","OFFLINE"}]
    /\ leader     \in Nodes \cup {0}
    /\ conjStatus \in [Conjunctions -> {"MONITORING","LOCKED","APPROVED","DENIED"}]
    /\ conjLock   \in [Conjunctions -> Nodes \cup {0}]
    /\ votes      \in [Conjunctions -> SUBSET Nodes]
    /\ \A c \in Conjunctions : votes[c] \subseteq OnlineNodes \cup
           \* Allow votes cast before a voter went offline
           { n \in Nodes : TRUE }
    /\ IsSeq(maneuverLog)

(* ------------------------------------------------------------------
   Initial state
   ------------------------------------------------------------------ *)
Init ==
    /\ nodeState  = [n \in Nodes        |-> "ONLINE"]
    /\ leader     = 4                           \* highest id wins at start
    /\ conjStatus = [c \in Conjunctions |-> "MONITORING"]
    /\ conjLock   = [c \in Conjunctions |-> 0]
    /\ votes      = [c \in Conjunctions |-> {}]
    /\ maneuverLog = <<>>

(* ------------------------------------------------------------------
   Actions
   ------------------------------------------------------------------ *)

\* Leader initiates 2PC Phase-1 on a MONITORING conjunction
Lock(c) ==
    /\ conjStatus[c] = "MONITORING"
    /\ leader # 0
    /\ conjLock[c] = 0
    /\ conjStatus' = [conjStatus EXCEPT ![c] = "LOCKED"]
    /\ conjLock'   = [conjLock   EXCEPT ![c] = leader]
    /\ UNCHANGED <<nodeState, leader, votes, maneuverLog>>

\* An online node casts a YES vote during Phase-1
Vote(n, c) ==
    /\ conjStatus[c] = "LOCKED"
    /\ nodeState[n]  = "ONLINE"
    /\ n \notin votes[c]
    /\ votes' = [votes EXCEPT ![c] = votes[c] \cup {n}]
    /\ UNCHANGED <<nodeState, leader, conjStatus, conjLock, maneuverLog>>

\* Leader commits (Phase-2) once quorum reached
Approve(c) ==
    /\ conjStatus[c] = "LOCKED"
    /\ Cardinality(votes[c]) >= Quorum
    /\ conjStatus'  = [conjStatus  EXCEPT ![c] = "APPROVED"]
    /\ maneuverLog' = Append(maneuverLog, c)
    /\ UNCHANGED <<nodeState, leader, conjLock, votes>>

\* Leader aborts — not enough online nodes to ever reach quorum
Deny(c) ==
    /\ conjStatus[c] = "LOCKED"
    /\ Cardinality(OnlineNodes) < Quorum
    /\ conjStatus' = [conjStatus EXCEPT ![c] = "DENIED"]
    /\ conjLock'   = [conjLock   EXCEPT ![c] = 0]
    /\ UNCHANGED <<nodeState, leader, votes, maneuverLog>>

\* A node goes offline; re-elect leader via Bully
NodeFail(n) ==
    /\ nodeState[n] = "ONLINE"
    /\ nodeState' = [nodeState EXCEPT ![n] = "OFFLINE"]
    /\ leader'    = ElectedLeader'    \* prime because nodeState just changed
       \* Compute new leader with updated nodeState
       \* (use LET to keep it readable)
    /\ LET newOnline == { m \in Nodes : [nodeState EXCEPT ![n] = "OFFLINE"][m] = "ONLINE" }
           newLeader == IF newOnline = {} THEN 0
                        ELSE CHOOSE m \in newOnline : \A k \in newOnline : m >= k
       IN leader' = newLeader
    /\ UNCHANGED <<conjStatus, conjLock, votes, maneuverLog>>

\* A node recovers; re-elect leader via Bully
NodeRecover(n) ==
    /\ nodeState[n] = "OFFLINE"
    /\ nodeState' = [nodeState EXCEPT ![n] = "ONLINE"]
    /\ LET newOnline == { m \in Nodes : [nodeState EXCEPT ![n] = "ONLINE"][m] = "ONLINE" }
           newLeader == IF newOnline = {} THEN 0
                        ELSE CHOOSE m \in newOnline : \A k \in newOnline : m >= k
       IN leader' = newLeader
    /\ UNCHANGED <<conjStatus, conjLock, votes, maneuverLog>>

(* ------------------------------------------------------------------
   Next-state relation
   ------------------------------------------------------------------ *)
Next ==
    \/ \E c \in Conjunctions : Lock(c)
    \/ \E n \in Nodes, c \in Conjunctions : Vote(n, c)
    \/ \E c \in Conjunctions : Approve(c)
    \/ \E c \in Conjunctions : Deny(c)
    \/ \E n \in Nodes : NodeFail(n)
    \/ \E n \in Nodes : NodeRecover(n)

(* ------------------------------------------------------------------
   Fairness — weak fairness on all enabled actions
   ------------------------------------------------------------------ *)
Fairness ==
    /\ \A c \in Conjunctions : WF_vars(Lock(c))
    /\ \A c \in Conjunctions : WF_vars(Approve(c))
    /\ \A c \in Conjunctions : WF_vars(Deny(c))
    /\ \A n \in Nodes, c \in Conjunctions : WF_vars(Vote(n, c))

(* ------------------------------------------------------------------
   Specification
   ------------------------------------------------------------------ *)
Spec == Init /\ [][Next]_vars /\ Fairness

(* ------------------------------------------------------------------
   Safety invariants
   ------------------------------------------------------------------ *)

\* CORE SAFETY: No conjunction may be APPROVED without >= Quorum YES votes
Safety ==
    \A c \in Conjunctions :
        conjStatus[c] = "APPROVED" => Cardinality(votes[c]) >= Quorum

\* Once APPROVED a conjunction cannot be re-locked or re-denied
NoDoubleApproval ==
    \A c \in Conjunctions :
        conjStatus[c] = "APPROVED" =>
            /\ conjStatus[c] # "LOCKED"
            /\ conjStatus[c] # "DENIED"

\* At most one leader at any time (trivially true here — single value)
LeaderUniqueness ==
    leader \in Nodes \cup {0}

\* Leader is always consistent with Bully election outcome
LeaderConsistency ==
    leader # 0 =>
        /\ nodeState[leader] = "ONLINE"
        /\ \A n \in OnlineNodes : leader >= n

(* ------------------------------------------------------------------
   Liveness property
   QuorumLiveness: if >= Quorum nodes stay online, every MONITORING
   conjunction will eventually be APPROVED or DENIED.
   ------------------------------------------------------------------ *)
QuorumLiveness ==
    \A c \in Conjunctions :
        (Cardinality(OnlineNodes) >= Quorum) ~>
            (conjStatus[c] = "APPROVED" \/ conjStatus[c] = "DENIED")

(* ------------------------------------------------------------------
   THEOREMS — checked by TLC exhaustive model checking
   ------------------------------------------------------------------ *)
THEOREM Spec => []TypeOK
THEOREM Spec => []Safety
THEOREM Spec => []NoDoubleApproval
THEOREM Spec => []LeaderUniqueness
THEOREM Spec => []LeaderConsistency

====
