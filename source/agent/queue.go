package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const queueDir = "./queue"

// initQueue creates the queue directory if it doesn't exist
func initQueue() error {
	return os.MkdirAll(queueDir, 0755)
}

// saveToQueue saves JSON data to a file in the queue directory
func saveToQueue(jsonData string) error {
	// ensure queue directory exists
	if err := initQueue(); err != nil {
		return fmt.Errorf("failed to initialize queue: %w", err)
	}

	// create filename with timestamp
	filename := fmt.Sprintf("hash_%d.json", time.Now().Unix())
	filepath := filepath.Join(queueDir, filename)

	// write JSON data to file
	err := os.WriteFile(filepath, []byte(jsonData), 0644)
	if err != nil {
		return fmt.Errorf("failed to save to queue: %w", err)
	}

	fmt.Printf("Saved hash data to queue: %s\n", filepath)
	return nil
}

// processQueue sends all queued JSON files to the server
func processQueue(apiURL string, apiKey string) {
	// check if queue directory exists
	if _, err := os.Stat(queueDir); os.IsNotExist(err) {
		return
	}

	// read all files in queue directory
	files, err := os.ReadDir(queueDir)
	if err != nil {
		fmt.Printf("Error reading queue directory: %v\n", err)
		return
	}

	// process each file
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}

		filepath := filepath.Join(queueDir, file.Name())

		// read file content
		jsonData, err := os.ReadFile(filepath)
		if err != nil {
			fmt.Printf("Error reading queued file %s: %v\n", file.Name(), err)
			continue
		}

		// attempt to send to server
		err = jsonApiCall(string(jsonData), apiURL, apiKey)
		if err != nil {
			fmt.Printf("Failed to send queued file %s: %v\n", file.Name(), err)
			// keep file in queue for next attempt
			continue
		}

		// successfully sent, delete the file
		err = os.Remove(filepath)
		if err != nil {
			fmt.Printf("Warning: Failed to remove queued file %s: %v\n", file.Name(), err)
		} else {
			fmt.Printf("Successfully sent and removed queued file: %s\n", file.Name())
		}
	}
}
