package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

var nodeID int
var httpPort string
var peerPorts []string
var peerHosts []string // optional container hostnames (PEER_HOSTS env)

func main() {
	id, _ := strconv.Atoi(os.Getenv("NODE_ID"))
	nodeID = id
	httpPort = os.Getenv("HTTP_PORT")
	if httpPort == "" {
		httpPort = "8080"
	}

	peers := os.Getenv("PEER_PORTS")
	if peers != "" {
		for _, p := range strings.Split(peers, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				peerPorts = append(peerPorts, p)
			}
		}
	}

	hosts := os.Getenv("PEER_HOSTS")
	if hosts != "" {
		for _, h := range strings.Split(hosts, ",") {
			h = strings.TrimSpace(h)
			if h != "" {
				peerHosts = append(peerHosts, h)
			}
		}
	}

	initDB()
	initMembership()

	go startHub()
	go runElection()
	go runWatchdog()
	go runTriageAgent()

	r := mux.NewRouter()

	// Health & cluster
	r.HandleFunc("/health", handleHealth).Methods("GET")
	r.HandleFunc("/current-leader", handleCurrentLeader).Methods("GET")
	r.HandleFunc("/replication-summary", handleReplicationSummary).Methods("GET")
	r.HandleFunc("/reset", handleReset).Methods("POST")

	// Public API
	r.HandleFunc("/api/network", handleNetwork).Methods("GET")
	r.HandleFunc("/api/satellites", handleSatellites).Methods("GET")
	r.HandleFunc("/api/conjunctions", handleConjunctions).Methods("GET")
	r.HandleFunc("/api/maneuver/request", handleManeuverRequest).Methods("POST")
	r.HandleFunc("/api/maneuver/emergency", handleEmergencyOverride).Methods("POST")
	r.HandleFunc("/api/agent/toggle", handleAgentToggle).Methods("POST")

	// Node chaos control
	r.HandleFunc("/control/node/{id}/{action}", handleNodeControl).Methods("POST")

	// Internal consensus messages
	r.HandleFunc("/internal/prepare", handleInternalPrepare).Methods("POST")
	r.HandleFunc("/internal/commit", handleInternalCommit).Methods("POST")
	r.HandleFunc("/internal/abort", handleInternalAbort).Methods("POST")

	// Internal election messages
	r.HandleFunc("/internal/election", handleElectionMsg).Methods("POST")
	r.HandleFunc("/internal/coordinator", handleCoordinatorMsg).Methods("POST")

	// WebSocket
	r.HandleFunc("/ws", handleWebSocket)

	// CORS middleware
	handler := corsMiddleware(r)

	log.Printf("[AstroMesh] Node %d starting on :%s peers=%v", nodeID, httpPort, peerPorts)
	srv := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func runWatchdog() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		broadcastNetworkUpdate()
	}
}
