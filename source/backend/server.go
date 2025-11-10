package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

// global DB connection
var db *sql.DB

func init() {
	// load .env file
	if err := godotenv.Load(); err != nil {
		fmt.Println("Warning: .env file not found")
	}
	// connect to DB
	var err error
	db, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		panic(err)
	}
	// verify DB connection
	if err := db.Ping(); err != nil {
		panic("Failed to connect to DB: " + err.Error())
	}
	// create table if not exists
	db.Exec(`
		CREATE TABLE IF NOT EXISTS hash_records (
			id SERIAL PRIMARY KEY,
			timestamp TEXT NOT NULL,
			hash_boot TEXT NOT NULL,
			hash_bin TEXT NOT NULL,
			hash_sbin TEXT NOT NULL,
			hash_etc TEXT NOT NULL,
			hash_root TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_timestamp ON hash_records(id DESC);
	`)
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	// only accept POST
	var data map[string]any
	// decode JSON body
	json.NewDecoder(r.Body).Decode(&data)
	// extract timestamp and hashes
	timestamp := data["timestamp"].(string)
	// type assertion to map
	hashes := data["hashes"].(map[string]any)
	// get client IP
	clientIP, _, _ := net.SplitHostPort(r.RemoteAddr)
	if clientIP == "::1" {
		clientIP = "127.0.0.1"
	}
	// log the received API call with client IP
	fmt.Printf("Received API call from %s\n", clientIP)
	// insert into DB
	_, err := db.Exec(`
		INSERT INTO hash_records 
		(timestamp, hash_boot, hash_bin, hash_sbin, hash_etc, hash_root)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, timestamp, hashes["/boot"], hashes["/usr/bin"], hashes["/usr/sbin"], hashes["/etc"], hashes["/root"])
	// handle DB error
	if err != nil {
		http.Error(w, "DB insert failed", http.StatusInternalServerError)
		return
	}
	// respond with success
	fmt.Println("Inserted record successfully")
	// set response headers
	w.Header().Set("Content-Type", "application/json")
	// send JSON response
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleView(w http.ResponseWriter, r *http.Request) {
	// query all records ordered by id desc
	rows, _ := db.Query(`SELECT id, timestamp, hash_boot, hash_bin, hash_sbin, hash_etc, hash_root FROM hash_records ORDER BY id DESC`)
	// handle DB error
	defer rows.Close()
	// collect records
	var records []map[string]string
	for rows.Next() {
		var id int
		var timestamp, boot, bin, sbin, etc, root string
		// scan row into variables
		rows.Scan(&id, &timestamp, &boot, &bin, &sbin, &etc, &root)
		// append to records slice
		records = append(records, map[string]string{
			"id":        fmt.Sprint(id),
			"timestamp": timestamp,
			"boot":      boot,
			"bin":       bin,
			"sbin":      sbin,
			"etc":       etc,
			"root":      root,
		})
	}
	// set response headers
	w.Header().Set("Content-Type", "application/json")
	// send JSON response
	json.NewEncoder(w).Encode(records)
}

func main() {
	defer db.Close()

	http.HandleFunc("/api/store", handleStore)
	http.HandleFunc("/api/view", handleView)
	http.Handle("/", http.FileServer(http.Dir("../frontend")))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8800"
	}

	fmt.Printf("Server running on http://localhost:%s/\n", port)
	http.ListenAndServe(":"+port, nil)
}
