package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"

	_ "github.com/lib/pq"
)

type Station struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

type Run struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	FromID string `json:"from_id"`
	ToID   string `json:"to_id"`
	Sec    int    `json:"sec"`
	RanAt  string `json:"ran_at"`
}

type RankEntry struct {
	Rank   int    `json:"rank"`
	UserID string `json:"user_id"`
	Sec    int    `json:"sec"`
	RanAt  string `json:"ran_at"`
}

type Segment struct {
	FromID    string `json:"from_id"`
	ToID      string `json:"to_id"`
	RunCount  int    `json:"run_count"`
	RecordSec int    `json:"record_sec"`
}

var db *sql.DB

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("sql.Open:", err)
	}
	defer db.Close()
	if err = db.Ping(); err != nil {
		log.Fatal("db.Ping:", err)
	}
	log.Println("connected to database")

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stations", cors(handleStations))
	mux.HandleFunc("/api/runs", cors(handleRuns))
	mux.HandleFunc("/api/ranking", cors(handleRanking))
	mux.HandleFunc("/api/segments", cors(handleSegments))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Println("listening :" + port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next(w, r)
	}
}

func json200(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func handleStations(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, name, lat, lng FROM stations ORDER BY id")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	stations := []Station{}
	for rows.Next() {
		var s Station
		if err := rows.Scan(&s.ID, &s.Name, &s.Lat, &s.Lng); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		stations = append(stations, s)
	}
	json200(w, stations)
}

func handleRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", 405)
		return
	}

	var body struct {
		UserID string `json:"user_id"`
		FromID string `json:"from_id"`
		ToID   string `json:"to_id"`
		Sec    int    `json:"sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	var run Run
	err := db.QueryRow(
		`INSERT INTO runs (user_id, from_id, to_id, sec)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, user_id, from_id, to_id, sec, ran_at`,
		body.UserID, body.FromID, body.ToID, body.Sec,
	).Scan(&run.ID, &run.UserID, &run.FromID, &run.ToID, &run.Sec, &run.RanAt)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	ranking, _ := getRanking(run.FromID, run.ToID)
	isRecord := len(ranking) > 0 && ranking[0].UserID == run.UserID

	json200(w, map[string]any{
		"run":       run,
		"is_record": isRecord,
		"ranking":   ranking,
	})
}

func handleRanking(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	ranking, err := getRanking(from, to)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	json200(w, ranking)
}

func getRanking(from, to string) ([]RankEntry, error) {
	rows, err := db.Query(
		`SELECT ROW_NUMBER() OVER (ORDER BY sec ASC) AS rank,
		        user_id, sec, ran_at
		 FROM runs
		 WHERE LEAST(from_id, to_id)   = LEAST($1, $2)
		   AND GREATEST(from_id, to_id) = GREATEST($1, $2)
		 ORDER BY sec ASC
		 LIMIT 10`,
		from, to,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []RankEntry{}
	for rows.Next() {
		var e RankEntry
		if err := rows.Scan(&e.Rank, &e.UserID, &e.Sec, &e.RanAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

func handleSegments(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(
		`SELECT from_id, to_id, run_count, record_sec
		 FROM segments
		 WHERE run_count >= 1
		 ORDER BY run_count DESC`,
	)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	segments := []Segment{}
	for rows.Next() {
		var s Segment
		if err := rows.Scan(&s.FromID, &s.ToID, &s.RunCount, &s.RecordSec); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		segments = append(segments, s)
	}
	json200(w, segments)
}
