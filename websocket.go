package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// wsMessage is the envelope sent over WebSocket.
type wsMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// wsClient represents a connected WebSocket client.
type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

// Hub manages all connected WebSocket clients.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*wsClient]struct{}
	register   chan *wsClient
	unregister chan *wsClient
	broadcast  chan []byte
}

var hub = &Hub{
	clients:    make(map[*wsClient]struct{}),
	register:   make(chan *wsClient, 32),
	unregister: make(chan *wsClient, 32),
	broadcast:  make(chan []byte, 256),
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
}

// startHub runs the hub event loop.
func startHub() {
	for {
		select {
		case c := <-hub.register:
			hub.mu.Lock()
			hub.clients[c] = struct{}{}
			hub.mu.Unlock()
			log.Printf("[WS] client connected (total=%d)", len(hub.clients))

			// Send full state immediately on connect
			go func() {
				state := getNetworkState()
				msg := wsMessage{Type: "NETWORK_UPDATE", Payload: state}
				data, _ := json.Marshal(msg)
				c.send <- data
			}()

		case c := <-hub.unregister:
			hub.mu.Lock()
			if _, ok := hub.clients[c]; ok {
				delete(hub.clients, c)
				close(c.send)
			}
			hub.mu.Unlock()
			log.Printf("[WS] client disconnected (total=%d)", len(hub.clients))

		case data := <-hub.broadcast:
			hub.mu.RLock()
			for c := range hub.clients {
				select {
				case c.send <- data:
				default:
					// Client too slow – drop message
				}
			}
			hub.mu.RUnlock()
		}
	}
}

// handleWebSocket upgrades an HTTP connection to WebSocket.
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] upgrade error: %v", err)
		return
	}

	client := &wsClient{
		conn: conn,
		send: make(chan []byte, 64),
	}

	hub.register <- client

	// Writer goroutine
	go func() {
		defer func() {
			conn.Close()
		}()
		for data := range client.send {
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		}
	}()

	// Reader goroutine (keep connection alive; ignore client messages)
	defer func() {
		hub.unregister <- client
	}()
	conn.SetReadLimit(512)
	conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		return nil
	})
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
		// Reset deadline on any message
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	}
}

// broadcastNetworkUpdate sends a full NETWORK_UPDATE event to all clients.
func broadcastNetworkUpdate() {
	state := getNetworkState()
	msg := wsMessage{Type: "NETWORK_UPDATE", Payload: state}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case hub.broadcast <- data:
	default:
	}
}

// broadcastEvent sends a typed event to all connected WebSocket clients.
func broadcastEvent(eventType string, payload interface{}) {
	msg := wsMessage{Type: eventType, Payload: payload}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case hub.broadcast <- data:
	default:
	}
}
