package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// clearSkips saves and clears skipPaths so temp dirs under /tmp aren't skipped.
// Returns a restore function to defer.
func clearSkips(t *testing.T) func() {
	t.Helper()
	orig := skipPaths
	skipPaths = nil
	return func() { skipPaths = orig }
}

func TestShouldSkip(t *testing.T) {
	tests := []struct {
		path  string
		skips []string
		want  bool
	}{
		{"/root/.cache/something", nil, true},
		{"/root/.bash_history", nil, true},
		{"/root/.viminfo", nil, true},
		{"/tmp/foo", nil, true},
		{"/etc/passwd", nil, false},
		{"/usr/bin/ls", nil, false},
		{"/etc/mtab", []string{"mtab"}, true},
		{"/etc/resolv.conf", []string{"resolv.conf"}, true},
		{"/etc/adjtime", []string{"adjtime"}, true},
		{"/etc/hostname", []string{"mtab"}, false},
	}
	for _, tt := range tests {
		got := shouldSkip(tt.path, tt.skips)
		if got != tt.want {
			t.Errorf("shouldSkip(%q, %v) = %v, want %v", tt.path, tt.skips, got, tt.want)
		}
	}
}

func TestHashFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	content := []byte("hashiko test content")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	got, err := hashFile(path)
	if err != nil {
		t.Fatalf("hashFile returned error: %v", err)
	}

	h := sha256.New()
	h.Write(content)
	want := hex.EncodeToString(h.Sum(nil))

	if got != want {
		t.Errorf("hashFile = %q, want %q", got, want)
	}

	// deterministic
	got2, _ := hashFile(path)
	if got != got2 {
		t.Error("hashFile is not deterministic")
	}
}

func TestHashFileMissing(t *testing.T) {
	_, err := hashFile("/nonexistent/path/does_not_exist.txt")
	if err == nil {
		t.Error("expected error for missing file, got nil")
	}
}

func TestHashFilesReturnsAllFiles(t *testing.T) {
	defer clearSkips(t)()

	dir := t.TempDir()
	subdir := filepath.Join(dir, "sub")
	os.MkdirAll(subdir, 0755)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("aaa"), 0644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("bbb"), 0644)
	os.WriteFile(filepath.Join(subdir, "c.txt"), []byte("ccc"), 0644)

	result := hashFiles(dir, nil)

	if len(result) != 3 {
		t.Errorf("expected 3 files, got %d", len(result))
	}
	for _, name := range []string{"a.txt", "b.txt"} {
		if _, ok := result[filepath.Join(dir, name)]; !ok {
			t.Errorf("missing %q in result", name)
		}
	}
	if _, ok := result[filepath.Join(subdir, "c.txt")]; !ok {
		t.Error("missing sub/c.txt in result")
	}
}

func TestHashFilesSkipsLargeFiles(t *testing.T) {
	defer clearSkips(t)()

	orig := maxFileSizeBytes
	maxFileSizeBytes = 10
	defer func() { maxFileSizeBytes = orig }()

	dir := t.TempDir()
	small := filepath.Join(dir, "small.txt")
	large := filepath.Join(dir, "large.bin")
	os.WriteFile(small, []byte("tiny"), 0644)
	os.WriteFile(large, make([]byte, 11), 0644)

	result := hashFiles(dir, nil)

	if _, ok := result[small]; !ok {
		t.Error("small file should be included")
	}
	if _, ok := result[large]; ok {
		t.Error("large file should be skipped")
	}
}

func TestHashFilesSkipPaths(t *testing.T) {
	// keep global skipPaths active; create files with names that match/don't match
	defer clearSkips(t)()
	skipPaths = []string{".bash_history"}

	dir := t.TempDir()
	keep := filepath.Join(dir, "keep.txt")
	skip := filepath.Join(dir, ".bash_history")
	os.WriteFile(keep, []byte("keep"), 0644)
	os.WriteFile(skip, []byte("history"), 0644)

	result := hashFiles(dir, nil)

	if _, ok := result[keep]; !ok {
		t.Error("keep.txt should be in result")
	}
	if _, ok := result[skip]; ok {
		t.Error(".bash_history should be skipped")
	}
}

func TestHashFilesAdditionalSkips(t *testing.T) {
	defer clearSkips(t)()

	dir := t.TempDir()
	normal := filepath.Join(dir, "normal.conf")
	volatile := filepath.Join(dir, "resolv.conf")
	os.WriteFile(normal, []byte("normal"), 0644)
	os.WriteFile(volatile, []byte("volatile"), 0644)

	result := hashFiles(dir, []string{"resolv.conf"})

	if _, ok := result[normal]; !ok {
		t.Error("normal.conf should be in result")
	}
	if _, ok := result[volatile]; ok {
		t.Error("resolv.conf should be skipped via additionalSkips")
	}
}

func TestHashFilesChangeDetection(t *testing.T) {
	defer clearSkips(t)()

	dir := t.TempDir()
	path := filepath.Join(dir, "watched.txt")
	os.WriteFile(path, []byte("original content"), 0644)

	before := hashFiles(dir, nil)
	os.WriteFile(path, []byte("modified content"), 0644)
	after := hashFiles(dir, nil)

	if before[path] == after[path] {
		t.Error("hash should differ after file content changes")
	}
}

func TestHashFilesIgnoresDirectories(t *testing.T) {
	defer clearSkips(t)()

	dir := t.TempDir()
	subdir := filepath.Join(dir, "subdir")
	os.MkdirAll(subdir, 0755)

	result := hashFiles(dir, nil)
	if _, ok := result[subdir]; ok {
		t.Error("directory should not appear as a hash key")
	}
}
