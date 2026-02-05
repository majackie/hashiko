package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func shouldSkip(path string, additionalSkips []string) bool {
	// check against predefined skip paths
	for _, skip := range skipPaths {
		if strings.Contains(path, skip) {
			return true
		}
	}

	// check against additional skip paths
	for _, skip := range additionalSkips {
		if strings.Contains(path, skip) {
			return true
		}
	}

	// if none matched, do not skip
	return false
}

func hashDirectory(dirPath string, additionalSkips []string) string {
	// create a new SHA256 hash
	hash := sha256.New()

	// walk through the directory
	filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// skip unwanted paths
		if shouldSkip(path, additionalSkips) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// write file path to hash
		hash.Write([]byte(path))

		// if it's a regular file, read its content and write to hash
		if info.Mode().IsRegular() {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()
			io.Copy(hash, file)
		}

		// continue walking
		return nil
	})

	// return the final hash as a hex string
	return hex.EncodeToString(hash.Sum(nil))
}

type HashResult struct {
	Timestamp string            `json:"timestamp"`
	AgentID   string            `json:"agent_id"`
	EventType string            `json:"event_type"`
	Hashes    map[string]string `json:"hashes"`
}

func hashToJson(agentID, eventType, hashBoot, hashBin, hashSbin, hashEtc, hashRoot string) (string, error) {
	// create a struct to hold the results
	result := HashResult{
		Timestamp: time.Now().Format(time.RFC3339),
		AgentID:   agentID,
		EventType: eventType,
		Hashes: map[string]string{
			dirBoot: hashBoot,
			dirBin:  hashBin,
			dirSbin: hashSbin,
			dirEtc:  hashEtc,
			dirRoot: hashRoot,
		},
	}

	// marshal the struct to JSON
	jsonOutput, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return "", err
	}

	// return the JSON string
	return string(jsonOutput), nil
}

func jsonApiCall(jsonData string, apiURL string) error {
	// send the JSON data to the specified API endpoint
	resp, err := http.Post(apiURL, "application/json", bytes.NewBuffer([]byte(jsonData)))
	if err != nil {
		return err
	}

	// ensure the response body is closed
	defer resp.Body.Close()

	// check for non-200 status codes
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API returned status: %d", resp.StatusCode)
	}

	// complete successfully
	return nil
}

func main() {
	agentID := "agent-001"
	eventType := "hash_report"
	apiURL := "http://localhost:8899/api/store"

	// Step 1: Process any previously queued hash data
	fmt.Println("Processing queued hash data...")
	processQueue(apiURL)

	// Step 2: Compute current hashes
	fmt.Println("Computing current file hashes...")
	hashBoot := hashDirectory(dirBoot, nil)
	hashBin := hashDirectory(dirBin, nil)
	hashSbin := hashDirectory(dirSbin, nil)
	hashEtc := hashDirectory(dirEtc, skipEtcPaths)
	hashRoot := hashDirectory(dirRoot, nil)

	// Step 3: Create JSON from current hashes
	jsonOutput, err := hashToJson(agentID, eventType, hashBoot, hashBin, hashSbin, hashEtc, hashRoot)
	if err != nil {
		fmt.Printf("Error creating JSON: %v\n", err)
		return
	}
	fmt.Println(jsonOutput)

	// Step 4: Attempt to send current hash data to server
	err = jsonApiCall(jsonOutput, apiURL)
	if err != nil {
		fmt.Printf("Error sending to API: %v\n", err)
		// Server unavailable, save to queue
		err = saveToQueue(jsonOutput)
		if err != nil {
			fmt.Printf("Error saving to queue: %v\n", err)
		}
		return
	}

	fmt.Println("Successfully sent current hash data to server")
}
