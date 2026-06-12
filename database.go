package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

var db *sql.DB

// ---- Domain structs ----

type NodeState struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Online bool   `json:"online"`
	LogID int    `json:"log_id"`
}

type Satellite struct {
	ID       int     `json:"id"`
	NoradID  string  `json:"norad_id"`
	Name     string  `json:"name"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	AltKm    float64 `json:"alt_km"`
	Status   string  `json:"status"`
	RiskScore float64 `json:"risk_score"`
	Operator string  `json:"operator"`
}

type Conjunction struct {
	ID          int     `json:"id"`
	Sat1ID      int     `json:"sat1_id"`
	Sat2ID      int     `json:"sat2_id"`
	Sat1Name    string  `json:"sat1_name"`
	Sat2Name    string  `json:"sat2_name"`
	TCA         string  `json:"tca"`
	MinRangeKm  float64 `json:"min_range_km"`
	Probability float64 `json:"probability"`
	RiskIndex   float64 `json:"risk_index"`
	Status      string  `json:"status"`
}

type NetworkState struct {
	Nodes        []NodeState   `json:"nodes"`
	Satellites   []Satellite   `json:"satellites"`
	Conjunctions []Conjunction `json:"conjunctions"`
	LeaderID     int           `json:"leader_id"`
}

// ---- Init ----

func initDB() {
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbURL = "postgres://astromesh:astromesh@localhost:5432/astromesh?sslmode=disable"
	}
	var err error
	for i := 0; i < 10; i++ {
		db, err = sql.Open("postgres", dbURL)
		if err == nil {
			err = db.Ping()
		}
		if err == nil {
			break
		}
		log.Printf("[DB] waiting for postgres (%d/10): %v", i+1, err)
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		log.Fatalf("[DB] failed to connect: %v", err)
	}
	createTables()
	seedConstellationData()
	log.Println("[DB] ready")
}

func createTables() {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS nodes (
			id   SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			zone TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS satellites (
			id         SERIAL PRIMARY KEY,
			norad_id   TEXT NOT NULL,
			name       TEXT NOT NULL,
			operator   TEXT NOT NULL,
			status     TEXT NOT NULL DEFAULT 'NOMINAL',
			risk_score FLOAT NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS conjunctions (
			id           SERIAL PRIMARY KEY,
			sat1_id      INT NOT NULL,
			sat2_id      INT NOT NULL,
			tca          TIMESTAMPTZ NOT NULL,
			min_range_km FLOAT NOT NULL,
			probability  FLOAT NOT NULL,
			risk_index   FLOAT NOT NULL,
			status       TEXT NOT NULL DEFAULT 'MONITORING',
			locked_by    INT
		)`,
		`CREATE TABLE IF NOT EXISTS maneuver_log (
			id             SERIAL PRIMARY KEY,
			conjunction_id INT NOT NULL,
			status         TEXT NOT NULL,
			source         TEXT NOT NULL,
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			log.Fatalf("[DB] createTables: %v", err)
		}
	}
}

// ---- Seeding ----

type seedSat struct {
	noradID  string
	name     string
	operator string
	lat, lon, alt float64
}

var seedSats = []seedSat{
	{"25544", "ISS", "NASA", 51.6, -140.0, 408},
	{"20580", "Hubble Space Telescope", "NASA", 28.5, -80.0, 547},
	{"39084", "Starlink-1234", "SpaceX", 53.0, -70.0, 550},
	{"39086", "Starlink-1235", "SpaceX", 53.2, -69.5, 550},
	{"39087", "Starlink-1236", "SpaceX", 53.4, -69.0, 550},
	{"38754", "Sentinel-2A", "ESA", 45.0, 10.0, 786},
	{"33591", "NOAA-19", "NOAA", 38.0, -95.0, 870},
	{"36411", "GOES-16", "NOAA", 0.0, -75.2, 35786},
	{"32711", "GPS-IIF-3", "USAF", 55.0, 40.0, 20200},
	{"24946", "Iridium-33 Debris", "Iridium", 86.0, 90.0, 776},
	{"22675", "Cosmos-2251 Debris", "Russia", 74.0, 130.0, 780},
	{"43013", "CARTOSAT-2F", "ISRO", 97.6, 77.0, 505},
	{"39269", "RISAT-2", "ISRO", 41.0, 72.0, 550},
	{"43685", "ALOS-2", "JAXA", 98.0, 142.0, 628},
	{"28654", "Terra", "NASA", 98.2, -180.0, 705},
	{"27424", "Aqua", "NASA", 98.2, 175.0, 705},
	{"40697", "Sentinel-1A", "ESA", 98.2, 5.0, 693},
	{"41335", "Sentinel-3A", "ESA", 98.6, 15.0, 814},
	{"43566", "Yaogan-30", "CNSA", 35.0, 110.0, 600},
	{"44387", "COSMO-SkyMed 4", "ASI", 97.9, 12.0, 619},
}

func seedConstellationData() {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM satellites").Scan(&count); err != nil || count > 0 {
		return
	}

	// Insert nodes
	nodeNames := map[int]string{1: "ISRO", 2: "ESA", 3: "JAXA", 4: "SpaceX"}
	nodeZones := map[int]string{1: "ASIA-SOUTH", 2: "EUROPE", 3: "ASIA-EAST", 4: "NORTH-AMERICA"}
	for i := 1; i <= 4; i++ {
		db.Exec("INSERT INTO nodes(id,name,zone) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", i, nodeNames[i], nodeZones[i])
	}

	// Insert satellites
	satIDs := make([]int, 0, len(seedSats))
	for _, s := range seedSats {
		var id int
		err := db.QueryRow(
			"INSERT INTO satellites(norad_id,name,operator,status,risk_score) VALUES($1,$2,$3,'NOMINAL',0) RETURNING id",
			s.noradID, s.name, s.operator,
		).Scan(&id)
		if err != nil {
			log.Printf("[DB] seed sat error: %v", err)
			continue
		}
		satIDs = append(satIDs, id)
	}

	// Seed 8 conjunctions
	type conjSeed struct {
		s1, s2  int
		rangeKm float64
		prob    float64
	}
	now := time.Now()
	conjSeeds := []conjSeed{
		{0, 10, 0.08, 0.120},  // ISS vs Iridium debris
		{1, 10, 0.15, 0.090},  // Hubble vs Iridium debris
		{2, 11, 0.22, 0.070},  // Starlink vs Cosmos debris
		{3, 11, 0.45, 0.040},  // Starlink vs Cosmos debris
		{5, 16, 0.80, 0.020},  // Sentinel-2A vs Sentinel-1A
		{8, 9,  0.05, 0.150},  // GPS vs Iridium debris
		{12, 13, 1.20, 0.008}, // RISAT vs ALOS
		{14, 15, 1.80, 0.003}, // Terra vs Aqua
	}

	for i, c := range conjSeeds {
		if c.s1 >= len(satIDs) || c.s2 >= len(satIDs) {
			continue
		}
		riskIndex := c.prob * (1.0 / (c.rangeKm + 0.1)) * 1000
		riskIndex = math.Min(riskIndex, 100.0)
		tca := now.Add(time.Duration(i+1)*6*time.Hour)
		_, err := db.Exec(
			"INSERT INTO conjunctions(sat1_id,sat2_id,tca,min_range_km,probability,risk_index,status) VALUES($1,$2,$3,$4,$5,$6,'MONITORING')",
			satIDs[c.s1], satIDs[c.s2], tca, c.rangeKm, c.prob, riskIndex,
		)
		if err != nil {
			log.Printf("[DB] seed conjunction error: %v", err)
		}
	}
	log.Println("[DB] seed complete")
}

// ---- Queries ----

func getNetworkState() NetworkState {
	return NetworkState{
		Nodes:        getOnlineNodes(),
		Satellites:   getSatellites(),
		Conjunctions: getConjunctions(),
		LeaderID:     getLeaderID(),
	}
}

func getSatellites() []Satellite {
	rows, err := db.Query("SELECT id,norad_id,name,operator,status,risk_score FROM satellites ORDER BY id")
	if err != nil {
		log.Printf("[DB] getSatellites: %v", err)
		return nil
	}
	defer rows.Close()

	// We need lat/lon/alt from the seed data (not stored in DB – derive from index)
	var sats []Satellite
	idx := 0
	for rows.Next() {
		var s Satellite
		rows.Scan(&s.ID, &s.NoradID, &s.Name, &s.Operator, &s.Status, &s.RiskScore)
		if idx < len(seedSats) {
			s.Lat = seedSats[idx].lat
			s.Lon = seedSats[idx].lon
			s.AltKm = seedSats[idx].alt
		}
		idx++
		sats = append(sats, s)
	}
	return sats
}

func getConjunctions() []Conjunction {
	rows, err := db.Query(`
		SELECT c.id, c.sat1_id, c.sat2_id,
		       s1.name, s2.name,
		       c.tca, c.min_range_km, c.probability, c.risk_index, c.status
		FROM conjunctions c
		JOIN satellites s1 ON s1.id = c.sat1_id
		JOIN satellites s2 ON s2.id = c.sat2_id
		ORDER BY c.risk_index DESC
	`)
	if err != nil {
		log.Printf("[DB] getConjunctions: %v", err)
		return nil
	}
	defer rows.Close()

	var conj []Conjunction
	for rows.Next() {
		var c Conjunction
		var tca time.Time
		rows.Scan(&c.ID, &c.Sat1ID, &c.Sat2ID, &c.Sat1Name, &c.Sat2Name,
			&tca, &c.MinRangeKm, &c.Probability, &c.RiskIndex, &c.Status)
		c.TCA = tca.UTC().Format(time.RFC3339)
		conj = append(conj, c)
	}
	return conj
}

func lockConjunction(id, nodeID int) bool {
	res, err := db.Exec(
		"UPDATE conjunctions SET locked_by=$1 WHERE id=$2 AND locked_by IS NULL",
		nodeID, id,
	)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func unlockConjunction(id int) {
	db.Exec("UPDATE conjunctions SET locked_by=NULL WHERE id=$1", id)
}

func updateConjunctionStatus(id int, status string) {
	db.Exec("UPDATE conjunctions SET status=$1, locked_by=NULL WHERE id=$2", status, id)
}

func appendLog(action, detail string) int {
	// Parse conjunction_id out of detail if possible, else 0
	var logID int
	db.QueryRow(
		"INSERT INTO maneuver_log(conjunction_id,status,source) VALUES(0,$1,$2) RETURNING id",
		action, detail,
	).Scan(&logID)
	return logID
}

func getReplSummary() map[string]interface{} {
	nodes := getOnlineNodes()
	result := make(map[string]interface{})
	nodesMap := make(map[string]interface{})
	for _, n := range nodes {
		nodesMap[fmt.Sprintf("%d", n.ID)] = map[string]interface{}{
			"nodeId":    n.ID,
			"lastLogId": n.LogID,
		}
	}
	result["nodes"] = nodesMap
	return result
}

// ---- HTTP handlers ----

func handleNetwork(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	state := getNetworkState()
	json.NewEncoder(w).Encode(state)
}

func handleSatellites(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getSatellites())
}

func handleConjunctions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getConjunctions())
}

func handleReset(w http.ResponseWriter, r *http.Request) {
	db.Exec("DELETE FROM maneuver_log")
	db.Exec("UPDATE conjunctions SET status='MONITORING', locked_by=NULL")
	db.Exec("UPDATE satellites SET risk_score=0, status='NOMINAL'")
	broadcastNetworkUpdate()
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"ok":true}`)
}
