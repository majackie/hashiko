package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/user"
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
	Hashes    map[string]string `json:"hashes"`
}

// getAgentID returns a unique identifier in "user@hostname (machine-id)" format.
// /etc/machine-id is a stable unique ID set at OS install time.
// When running under sudo, uses the original invoking user rather than root.
func getAgentID() string {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown-host"
	}
	username := os.Getenv("SUDO_USER")
	if username == "" {
		u, err := user.Current()
		if err == nil {
			username = u.Username
		}
	}
	machineID, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		return username + "@" + hostname
	}
	return username + "@" + hostname + " (" + strings.TrimSpace(string(machineID)) + ")"
}

const configDir = "/etc/hashiko"
const apiKeyFilePath = configDir + "/api_key"
const apiURLFilePath = configDir + "/api_url"

// apiKeyFile returns the path to the persisted API key file
func apiKeyFile() string {
	return apiKeyFilePath
}

// loadAPIURL reads the server URL from /etc/hashiko/api_url, falling back to the env var
func loadAPIURL() string {
	data, err := os.ReadFile(apiURLFilePath)
	if err == nil {
		url := strings.TrimSpace(string(data))
		if url != "" {
			return url
		}
	}
	return os.Getenv("HASHIKO_API_URL")
}

// loadSavedKey reads the agent API key from the local key file
func loadSavedKey() (string, error) {
	data, err := os.ReadFile(apiKeyFile())
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

// saveKey persists the agent API key to /etc/hashiko/api_key (mode 0600)
func saveKey(key string) error {
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return err
	}
	return os.WriteFile(apiKeyFilePath, []byte(key), 0600)
}

// loadWatchPaths reads monitored paths from watch.conf, falling back to defaults
func loadWatchPaths() []string {
	data, err := os.ReadFile(watchConfigFilePath)
	if err != nil {
		return defaultWatchPaths
	}
	var paths []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			paths = append(paths, line)
		}
	}
	if len(paths) == 0 {
		return defaultWatchPaths
	}
	return paths
}

// saveWatchPaths writes monitored paths to /etc/hashiko/watch.conf
func saveWatchPaths(paths []string) error {
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return err
	}
	content := "# Hashiko watch paths - one directory per line\n" + strings.Join(paths, "\n") + "\n"
	return os.WriteFile(watchConfigFilePath, []byte(content), 0644)
}

// fetchWatchPaths fetches monitored paths for this agent from the server
func fetchWatchPaths(apiBaseURL, apiKey, agentID string) ([]string, error) {
	req, err := http.NewRequest("GET", apiBaseURL+"/config?agent_id="+url.QueryEscape(agentID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("config fetch returned status: %d", resp.StatusCode)
	}
	var result struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Paths) == 0 {
		return nil, fmt.Errorf("server returned empty path list")
	}
	return result.Paths, nil
}

// registerAgent exchanges a one-time registration token for the agent API key
func registerAgent(apiBaseURL, registerToken string) (string, error) {
	payload, err := json.Marshal(map[string]string{"register_token": registerToken})
	if err != nil {
		return "", err
	}
	resp, err := http.Post(apiBaseURL+"/register", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registration failed with status: %d", resp.StatusCode)
	}
	var result struct {
		Success bool   `json:"success"`
		APIKey  string `json:"api_key"`
		Error   string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if !result.Success {
		return "", fmt.Errorf("registration rejected: %s", result.Error)
	}
	return result.APIKey, nil
}

func hashToJson(agentID string, hashes map[string]string) (string, error) {
	// create a struct to hold the results
	result := HashResult{
		Timestamp: time.Now().Format(time.RFC3339),
		AgentID:   agentID,
		Hashes:    hashes,
	}

	// marshal the struct to JSON
	jsonOutput, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return "", err
	}

	// return the JSON string
	return string(jsonOutput), nil
}

func jsonApiCall(jsonData string, apiURL string, apiKey string) error {
	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer([]byte(jsonData)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
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
	agentID := getAgentID()
	apiBaseURL := loadAPIURL()
	if apiBaseURL == "" {
		fmt.Println("Error: HASHIKO_API_URL environment variable is not set and /etc/hashiko/api_url not found")
		return
	}
	if !strings.HasPrefix(apiBaseURL, "https://") {
		fmt.Println("Error: HASHIKO_API_URL must use https:// to prevent MITM attacks")
		return
	}
	storeURL := apiBaseURL + "/store"

	// load a previously saved API key; if none exists, register with the server
	apiKey, err := loadSavedKey()
	if err != nil {
		regToken := os.Getenv("HASHIKO_REGISTER_TOKEN")
		if regToken == "" {
			fmt.Println("Error: no saved API key found and HASHIKO_REGISTER_TOKEN is not set")
			return
		}
		apiKey, err = registerAgent(apiBaseURL, regToken)
		if err != nil {
			fmt.Printf("Error registering agent: %v\n", err)
			return
		}
		if err = saveKey(apiKey); err != nil {
			fmt.Printf("Warning: could not save API key: %v\n", err)
		}
		fmt.Println("Agent registered successfully, API key saved.")
	}

	// Step 1: Process any previously queued hash data
	fmt.Println("Processing queued hash data...")
	processQueue(storeURL, apiKey)

	// Step 2: Fetch watch paths from server (writes to local file for offline use)
	// Fall back to local file or hardcoded defaults if server is unreachable
	watchPaths, err := fetchWatchPaths(apiBaseURL, apiKey, agentID)
	if err != nil {
		fmt.Printf("Could not fetch watch config from server (%v), using local config\n", err)
		watchPaths = loadWatchPaths()
	} else {
		if err := saveWatchPaths(watchPaths); err != nil {
			fmt.Printf("Warning: could not save watch config locally: %v\n", err)
		}
	}
	fmt.Printf("Monitoring paths: %v\n", watchPaths)

	// Step 3: Compute current hashes for each watched path
	fmt.Println("Computing current file hashes...")
	hashes := make(map[string]string)
	for _, path := range watchPaths {
		var skips []string
		if path == "/etc" {
			skips = skipEtcPaths
		}
		hashes[path] = hashDirectory(path, skips)
	}

	// Step 4: Create JSON from current hashes
	jsonOutput, err := hashToJson(agentID, hashes)
	if err != nil {
		fmt.Printf("Error creating JSON: %v\n", err)
		return
	}
	fmt.Println(jsonOutput)

	// Step 5: Attempt to send current hash data to server
	err = jsonApiCall(jsonOutput, storeURL, apiKey)
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
