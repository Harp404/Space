package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// VoteResult holds the outcome of a single node's vote.
type VoteResult struct {
	NodeID  int    `json:"node_id"`
	Vote    string `json:"vote"`
	Message string `json:"message"`
}

var conjLockMu sync.Mutex

// executeManeuverConsensus runs 2-Phase Commit across the cluster.
// Only the current leader may initiate this.
func executeManeuverConsensus(conjunctionID int, source string) (bool, []VoteResult, int64, error) {
	if !isLeader() {
		return false, nil, 0, fmt.Errorf("not the leader")
	}

	conjLockMu.Lock()
	locked := lockConjunction(conjunctionID, nodeID)
	conjLockMu.Unlock()
	if !locked {
		return false, nil, 0, fmt.Errorf("conjunction %d already locked", conjunctionID)
	}
	defer func() {
		// Unlock is handled by updateConjunctionStatus which NULLs locked_by.
		// If we never reached commit/abort, ensure unlock:
	}()

	start := time.Now()

	// ----- Phase 1: PREPARE -----
	votes := []VoteResult{}
	// Self vote
	votes = append(votes, VoteResult{
		NodeID:  nodeID,
		Vote:    "YES",
		Message: fmt.Sprintf("Node %d prepared", nodeID),
	})

	nodes := getOnlineNodes()
	type peerVote struct {
		result VoteResult
	}
	ch := make(chan peerVote, len(nodes))

	for _, n := range nodes {
		if n.ID == nodeID || !n.Online {
			continue
		}
		go func(peer NodeInfo) {
			vote := sendPrepare(peer.Port, conjunctionID)
			ch <- peerVote{result: vote}
		}(n)
	}

	peerCount := 0
	for _, n := range nodes {
		if n.ID != nodeID && n.Online {
			peerCount++
		}
	}
	for i := 0; i < peerCount; i++ {
		select {
		case v := <-ch:
			votes = append(votes, v.result)
		case <-time.After(2 * time.Second):
			votes = append(votes, VoteResult{Vote: "NO", Message: "timeout"})
		}
	}

	// Count yes votes
	yesCount := 0
	for _, v := range votes {
		if v.Vote == "YES" {
			yesCount++
		}
	}

	approved := yesCount >= 3 // quorum = 3 of 4
	duration := time.Since(start).Milliseconds()

	// ----- Phase 2: COMMIT or ABORT -----
	phase2Msg := "commit"
	newStatus := "APPROVED"
	if !approved {
		phase2Msg = "abort"
		newStatus = "DENIED"
	}

	for _, n := range nodes {
		if n.ID == nodeID || !n.Online {
			continue
		}
		go func(peer NodeInfo, msg string) {
			sendPhase2(peer.Port, conjunctionID, msg)
		}(n, phase2Msg)
	}

	updateConjunctionStatus(conjunctionID, newStatus)
	logID := appendLog(newStatus, fmt.Sprintf("conjunction=%d source=%s votes=%d/%d", conjunctionID, source, yesCount, len(votes)))
	_ = logID

	// Update replication state on self
	membersMu.Lock()
	if m, ok := members[nodeID]; ok {
		m.LogID = logID
	}
	membersMu.Unlock()

	return approved, votes, duration, nil
}

func sendPrepare(port string, conjunctionID int) VoteResult {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	body, _ := json.Marshal(map[string]int{"conjunction_id": conjunctionID})
	req, err := http.NewRequestWithContext(ctx, "POST",
		peerURL(port, "/internal/prepare"),
		bytes.NewReader(body))
	if err != nil {
		return VoteResult{Vote: "NO", Message: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return VoteResult{Vote: "NO", Message: err.Error()}
	}
	defer resp.Body.Close()

	var result struct {
		Vote    string `json:"vote"`
		NodeID  int    `json:"node_id"`
		Message string `json:"message"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return VoteResult{
		NodeID:  result.NodeID,
		Vote:    result.Vote,
		Message: result.Message,
	}
}

func sendPhase2(port string, conjunctionID int, action string) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	body, _ := json.Marshal(map[string]interface{}{
		"conjunction_id": conjunctionID,
		"action":         action,
	})
	req, err := http.NewRequestWithContext(ctx, "POST",
		peerURL(port, "/internal/"+action),
		bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

// ---- Public API handlers ----

func handleManeuverRequest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConjunctionID int `json:"conjunction_id"`
		NodeID        int `json:"node_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	approved, votes, durMs, err := executeManeuverConsensus(req.ConjunctionID, fmt.Sprintf("node-%d", req.NodeID))
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	status := "APPROVED"
	if !approved {
		status = "DENIED"
	}

	resp := map[string]interface{}{
		"status":      status,
		"votes":       votes,
		"duration_ms": durMs,
	}

	broadcastEvent("MANEUVER_EVENT", resp)
	broadcastNetworkUpdate()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleEmergencyOverride(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConjunctionID int `json:"conjunction_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	log.Printf("[Emergency] override for conjunction %d", req.ConjunctionID)
	updateConjunctionStatus(req.ConjunctionID, "EMERGENCY")
	appendLog("EMERGENCY_OVERRIDE", fmt.Sprintf("conjunction=%d", req.ConjunctionID))

	resp := map[string]interface{}{
		"status": "EMERGENCY_OVERRIDE",
	}
	broadcastEvent("MANEUVER_EVENT", resp)
	broadcastNetworkUpdate()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ---- Internal Phase handlers ----

func handleInternalPrepare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConjunctionID int `json:"conjunction_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Vote YES if conjunction is still in MONITORING state
	var status string
	db.QueryRow("SELECT status FROM conjunctions WHERE id=$1", req.ConjunctionID).Scan(&status)

	vote := "YES"
	msg := fmt.Sprintf("Node %d prepared", nodeID)
	if status != "MONITORING" {
		vote = "NO"
		msg = fmt.Sprintf("conjunction status is %s", status)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"vote":    vote,
		"node_id": nodeID,
		"message": msg,
	})
}

func handleInternalCommit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConjunctionID int `json:"conjunction_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	updateConjunctionStatus(req.ConjunctionID, "APPROVED")
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"ok":true}`)
}

func handleInternalAbort(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConjunctionID int `json:"conjunction_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	updateConjunctionStatus(req.ConjunctionID, "DENIED")
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"ok":true}`)
}
