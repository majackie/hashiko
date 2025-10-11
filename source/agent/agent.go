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
	Hashes    map[string]string `json:"hashes"`
}

func hashToJson(hashBoot, hashBin, hashSbin, hashEtc, hashRoot string) (string, error) {
	// create a struct to hold the results
	result := HashResult{
		Timestamp: time.Now().String(),
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
	hashBoot := hashDirectory(dirBoot, nil)
	hashBin := hashDirectory(dirBin, nil)
	hashSbin := hashDirectory(dirSbin, nil)
	hashEtc := hashDirectory(dirEtc, skipEtcPaths)
	hashRoot := hashDirectory(dirRoot, nil)

	jsonOutput, err := hashToJson(hashBoot, hashBin, hashSbin, hashEtc, hashRoot)
	if err != nil {
		println("Error creating JSON:", err.Error())
		return
	}
	print(jsonOutput)

	err = jsonApiCall(jsonOutput, "http://localhost:8800/api/store")
	if err != nil {
		println("Error sending to API:", err.Error())
		return
	}
}
