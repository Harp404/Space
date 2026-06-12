package main

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
)

// _muxVars is a thin wrapper so all files can call mux.Vars without importing mux directly.
func _muxVars(r *http.Request) map[string]string {
	return mux.Vars(r)
}

// peerURL builds the base HTTP URL for a peer given its port.
// When PEER_HOSTS are configured (e.g. in Docker), it uses the container hostname
// mapped by position; otherwise it falls back to localhost.
func peerURL(port string, path string) string {
	host := "localhost"
	// peerHosts are in the same order as peerPorts; find matching index
	for i, p := range peerPorts {
		if p == port && i < len(peerHosts) {
			host = peerHosts[i]
			break
		}
	}
	return fmt.Sprintf("http://%s:%s%s", host, port, path)
}
