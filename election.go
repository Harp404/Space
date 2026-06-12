package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

var (
	leaderID    atomic.Int32
	electionMu  sync.Mutex
	inElection  atomic.Bool
)

func getLeaderID() int {
	return int(leaderID.Load())
}

func setLeaderID(id int) {
	old := int(leaderID.Load())
	leaderID.Store(int32(id))
	if old != id {
		log.Printf("[Election] leader changed %d -> %d", old, id)
		broadcastEvent("LEADER_CHANGE", map[string]int{"leader_id": id})
	}
}

func isLeader() bool {
	return nodeID != 0 && getLeaderID() == nodeID
}

// runElection is the background goroutine that monitors leader liveness.
func runElection() {
	// Give other nodes time to start
	time.Sleep(3 * time.Second)

	// Initial election
	triggerElection()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		lid := getLeaderID()
		if lid == 0 {
			triggerElection()
			continue
		}
		if lid == nodeID {
			// We are the leader; nothing to check
			continue
		}
		// Ping leader
		port := getPeerPort(lid)
		if port == "" {
			triggerElection()
			continue
		}
		if !pingNode(port) {
			log.Printf("[Election] leader %d unreachable, starting election", lid)
			triggerElection()
		}
	}
}

func pingNode(port string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET",
		peerURL(port, "/health"), nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// triggerElection runs the Bully algorithm.
// The node with the highest ID among online nodes becomes the leader.
func triggerElection() {
	if !inElection.CompareAndSwap(false, true) {
		return
	}
	defer inElection.Store(false)

	electionMu.Lock()
	defer electionMu.Unlock()

	log.Printf("[Election] node %d starting bully election", nodeID)

	// Find highest online ID >= our own
	highestID := nodeID
	nodes := getOnlineNodes()
	for _, n := range nodes {
		if n.ID > nodeID {
			// Send election message to higher node
			port := getPeerPort(n.ID)
			if port == "" {
				continue
			}
			if sendElectionMsg(port, nodeID) {
				// Higher node acknowledged – it will take over
				log.Printf("[Election] node %d defers to node %d", nodeID, n.ID)
				time.Sleep(500 * time.Millisecond)
				return
			}
		}
	}

	// No higher node responded – we are the new leader
	_ = highestID
	log.Printf("[Election] node %d declaring itself leader", nodeID)
	setLeaderID(nodeID)

	// Announce to all peers
	for _, n := range nodes {
		if n.ID != nodeID {
			port := getPeerPort(n.ID)
			if port != "" {
				go sendCoordinatorMsg(port, nodeID)
			}
		}
	}
}

func sendElectionMsg(port string, fromID int) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	body, _ := json.Marshal(map[string]int{"from_id": fromID})
	req, err := http.NewRequestWithContext(ctx, "POST",
		peerURL(port, "/internal/election"),
		bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func sendCoordinatorMsg(port string, newLeader int) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	body, _ := json.Marshal(map[string]int{"leader_id": newLeader})
	req, err := http.NewRequestWithContext(ctx, "POST",
		peerURL(port, "/internal/coordinator"),
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

// ---- Internal HTTP handlers ----

func handleElectionMsg(w http.ResponseWriter, r *http.Request) {
	var msg struct {
		FromID int `json:"from_id"`
	}
	json.NewDecoder(r.Body).Decode(&msg)

	if msg.FromID < nodeID {
		// We are higher – acknowledge and start our own election
		w.WriteHeader(http.StatusOK)
		go triggerElection()
	} else {
		// Sender is higher or equal – defer
		w.WriteHeader(http.StatusConflict)
	}
}

func handleCoordinatorMsg(w http.ResponseWriter, r *http.Request) {
	var msg struct {
		LeaderID int `json:"leader_id"`
	}
	json.NewDecoder(r.Body).Decode(&msg)
	if msg.LeaderID > 0 {
		setLeaderID(msg.LeaderID)
		markPeer(msg.LeaderID, true, 0)
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"ok":true}`)
}
