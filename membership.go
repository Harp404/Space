package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NodeInfo holds runtime state for a cluster peer.
type NodeInfo struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Port   string `json:"port"`
	Online bool   `json:"online"`
	LogID  int    `json:"log_id"`
}

var (
	membersMu sync.RWMutex
	members   map[int]*NodeInfo
)

var nodeNames = map[int]string{
	1: "ISRO",
	2: "ESA",
	3: "JAXA",
	4: "SpaceX",
}

func initMembership() {
	membersMu.Lock()
	members = make(map[int]*NodeInfo)

	// Register all 4 known nodes
	allPorts := buildAllPorts()
	for id, name := range nodeNames {
		port := allPorts[id]
		online := (id == nodeID) // self is online; others discovered via heartbeat
		members[id] = &NodeInfo{
			ID:     id,
			Name:   name,
			Port:   port,
			Online: online,
			LogID:  0,
		}
	}
	membersMu.Unlock()

	log.Printf("[Membership] self=%d name=%s port=%s", nodeID, nodeNames[nodeID], httpPort)
	go heartbeatLoop()
}

// buildAllPorts returns a map from node ID to HTTP port.
// Self is httpPort; peers come from peerPorts (in order, skipping self).
func buildAllPorts() map[int]string {
	result := make(map[int]string)

	// Start from all ports including self
	// Peer ports exclude self – we need to figure out ordering.
	// Convention: nodes are ID 1-4, ports provided as peer ports are the OTHER nodes.
	// We combine self port + peer ports, then assign by sorted node IDs.

	allIDs := []int{1, 2, 3, 4}
	allPorts := make([]string, 0, 4)

	// We only know our own port and the peer ports.
	// Insert self at position nodeID-1 and fill the rest from peerPorts.
	peerIdx := 0
	for _, id := range allIDs {
		if id == nodeID {
			allPorts = append(allPorts, httpPort)
		} else {
			if peerIdx < len(peerPorts) {
				allPorts = append(allPorts, peerPorts[peerIdx])
				peerIdx++
			} else {
				allPorts = append(allPorts, "")
			}
		}
	}

	for i, id := range allIDs {
		result[id] = allPorts[i]
	}
	return result
}

func heartbeatLoop() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		pingPeers()
	}
}

func pingPeers() {
	membersMu.RLock()
	toCheck := make([]*NodeInfo, 0, len(members))
	for _, m := range members {
		if m.ID != nodeID && m.Port != "" {
			toCheck = append(toCheck, m)
		}
	}
	membersMu.RUnlock()

	for _, peer := range toCheck {
		go func(p *NodeInfo) {
			ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, "GET",
				peerURL(p.Port, "/health"), nil)
			if err != nil {
				markPeer(p.ID, false, 0)
				return
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				markPeer(p.ID, false, 0)
				return
			}
			defer resp.Body.Close()

			var health struct {
				NodeID   int `json:"node_id"`
				LeaderID int `json:"leader_id"`
			}
			json.NewDecoder(resp.Body).Decode(&health)
			markPeer(p.ID, true, 0)
		}(peer)
	}
}

func markPeer(id int, online bool, logID int) {
	membersMu.Lock()
	defer membersMu.Unlock()
	if m, ok := members[id]; ok {
		m.Online = online
		if logID > 0 {
			m.LogID = logID
		}
	}
}

func getOnlineNodes() []NodeInfo {
	membersMu.RLock()
	defer membersMu.RUnlock()
	result := make([]NodeInfo, 0, len(members))
	for _, m := range members {
		result = append(result, *m)
	}
	// stable order
	sorted := make([]NodeInfo, 4)
	for _, n := range result {
		if n.ID >= 1 && n.ID <= 4 {
			sorted[n.ID-1] = n
		}
	}
	out := make([]NodeInfo, 0, 4)
	for _, n := range sorted {
		if n.ID != 0 {
			out = append(out, n)
		}
	}
	return out
}

func getPeerPort(id int) string {
	membersMu.RLock()
	defer membersMu.RUnlock()
	if m, ok := members[id]; ok {
		return m.Port
	}
	return ""
}

// ---- HTTP handlers ----

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"node_id":%d,"status":"ok","leader_id":%d}`, nodeID, getLeaderID())
}

func handleCurrentLeader(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"currentLeaderId":%d}`, getLeaderID())
}

func handleReplicationSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getReplSummary())
}

func handleNodeControl(w http.ResponseWriter, r *http.Request) {
	vars := muxVars(r)
	idStr := vars["id"]
	action := vars["action"]

	targetID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	membersMu.Lock()
	if m, ok := members[targetID]; ok {
		switch strings.ToLower(action) {
		case "stop":
			m.Online = false
			log.Printf("[NodeControl] node %d forced OFFLINE", targetID)
		case "start":
			m.Online = true
			log.Printf("[NodeControl] node %d forced ONLINE", targetID)
		}
	}
	membersMu.Unlock()

	broadcastNetworkUpdate()
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"ok":true}`)
}

// muxVars extracts gorilla/mux route vars from the request.
func muxVars(r *http.Request) map[string]string {
	// Import gorilla/mux vars inline to avoid circular package issues
	// (mux is imported in main.go; we call mux.Vars here)
	return _muxVars(r)
}
