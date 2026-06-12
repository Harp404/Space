package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync/atomic"
	"time"
)

var agentEnabled atomic.Bool

func init() {
	agentEnabled.Store(true)
}

// runTriageAgent monitors conjunctions and autonomously escalates high-risk events.
// It only runs on the leader node.
func runTriageAgent() {
	// Stagger start to let election settle
	time.Sleep(5 * time.Second)

	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if !agentEnabled.Load() {
			continue
		}
		if !isLeader() {
			continue
		}
		triageConjunctions()
	}
}

func triageConjunctions() {
	// Find highest-risk conjunction that still needs action
	rows, err := db.Query(
		`SELECT id, sat1_id, sat2_id, risk_index
		 FROM conjunctions
		 WHERE risk_index > 70 AND status = 'MONITORING' AND locked_by IS NULL
		 ORDER BY risk_index DESC
		 LIMIT 1`,
	)
	if err != nil {
		log.Printf("[Agent] query error: %v", err)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		return
	}

	var id, sat1ID, sat2ID int
	var riskIndex float64
	rows.Scan(&id, &sat1ID, &sat2ID, &riskIndex)
	rows.Close()

	log.Printf("[Agent] escalating conjunction %d (risk=%.1f)", id, riskIndex)

	// Broadcast alert before attempting consensus
	conjs := getConjunctions()
	for _, c := range conjs {
		if c.ID == id {
			broadcastEvent("CONJUNCTION_ALERT", c)
			break
		}
	}

	approved, votes, durMs, err := executeManeuverConsensus(id, "AI_AGENT")
	if err != nil {
		log.Printf("[Agent] consensus error for conjunction %d: %v", id, err)
		return
	}

	status := "APPROVED"
	if !approved {
		status = "DENIED"
	}
	log.Printf("[Agent] conjunction %d -> %s (%dms)", id, status, durMs)

	broadcastEvent("MANEUVER_EVENT", map[string]interface{}{
		"status":         status,
		"votes":          votes,
		"duration_ms":    durMs,
		"source":         "AI_AGENT",
		"conjunction_id": id,
	})
	broadcastNetworkUpdate()
}

// handleAgentToggle enables or disables the autonomous triage agent.
func handleAgentToggle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	agentEnabled.Store(req.Enabled)
	log.Printf("[Agent] agent_enabled=%v", req.Enabled)

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"agent_enabled":%v}`, req.Enabled)
}
