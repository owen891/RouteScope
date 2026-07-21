package scripts

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	_ "github.com/glebarez/sqlite"
)

func TestBackupAndRestoreWorkflow(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(dataDir, "upstream-ops.db")
	configPath := filepath.Join(dataDir, "config.yaml")
	originalConfig := []byte("app_secret: redacted-fixture\n")
	createSQLiteFixture(t, dbPath)
	originalDB, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, originalConfig, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath+"-wal", []byte("wal-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath+"-shm", []byte("shm-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer health.Close()

	env := append(os.Environ(),
		"UPSTREAM_OPS_ROOT="+root,
		"UPSTREAM_OPS_DATA_DIR="+dataDir,
		"UPSTREAM_OPS_BACKUP_DIR="+backupDir,
		"UPSTREAM_OPS_STOP_APP=0",
		"BACKUP_TAG=fixture-v1",
		"UPSTREAM_OPS_HEALTH_URL="+health.URL+"/healthz",
	)
	if _, _, err := runBackupTool(t, env, "backup"); err != nil {
		t.Fatalf("backup failed: %v", err)
	}
	manifestPath := filepath.Join(backupDir, "fixture-v1", "manifest.json")
	manifestBody, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Mode     string `json:"mode"`
		Database struct {
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			SHA256 string `json:"sha256"`
		} `json:"database"`
		Config struct {
			Name string `json:"name"`
		} `json:"config"`
	}
	if err := json.Unmarshal(manifestBody, &manifest); err != nil {
		t.Fatalf("manifest is not JSON: %v", err)
	}
	if manifest.Mode != "sidecars" || manifest.Database.Name != "upstream-ops.db" || manifest.Database.Size != int64(len(originalDB)) || manifest.Database.SHA256 == "" || manifest.Config.Name != "config.yaml" {
		t.Fatalf("unexpected manifest: %s", manifestBody)
	}
	if _, _, err := runBackupTool(t, env, "verify", "fixture-v1"); err != nil {
		t.Fatalf("verify failed: %v", err)
	}

	if err := os.WriteFile(dbPath, []byte("mutated-db"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte("mutated: true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath+"-wal", []byte("stale-wal"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runBackupTool(t, env, "restore", "fixture-v1"); err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	assertFileBytes(t, dbPath, originalDB)
	assertFileBytes(t, configPath, originalConfig)
	assertFileBytes(t, dbPath+"-wal", []byte("wal-fixture"))
	if _, err := os.Stat(dbPath + "-shm"); err != nil {
		t.Fatalf("snapshot SHM should be restored: %v", err)
	}
	assertFileBytes(t, dbPath+"-shm", []byte("shm-fixture"))
}

func TestBackupRejectsTamperedSnapshotWithoutChangingLiveFiles(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(dataDir, "upstream-ops.db")
	configPath := filepath.Join(dataDir, "config.yaml")
	if err := os.WriteFile(dbPath, []byte("live-db"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte("live-config"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := append(os.Environ(),
		"UPSTREAM_OPS_ROOT="+root,
		"UPSTREAM_OPS_DATA_DIR="+dataDir,
		"UPSTREAM_OPS_BACKUP_DIR="+backupDir,
		"UPSTREAM_OPS_STOP_APP=0",
		"BACKUP_TAG=fixture-v1",
		"UPSTREAM_OPS_HEALTH_URL=http://127.0.0.1:1/healthz",
	)
	if _, _, err := runBackupTool(t, env, "backup"); err != nil {
		t.Fatalf("backup failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(backupDir, "fixture-v1", "upstream-ops.db"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	beforeDB, _ := os.ReadFile(dbPath)
	beforeConfig, _ := os.ReadFile(configPath)
	if _, stderr, err := runBackupTool(t, env, "restore", "fixture-v1"); err == nil {
		t.Fatal("tampered restore unexpectedly succeeded")
	} else if !strings.Contains(string(stderr), "checksum mismatch") {
		t.Fatalf("tampered restore error = %q", stderr)
	}
	assertFileBytes(t, dbPath, beforeDB)
	assertFileBytes(t, configPath, beforeConfig)
	if _, _, err := runBackupTool(t, env, "restore", "../fixture-v1"); err == nil {
		t.Fatal("unsafe restore unexpectedly succeeded")
	}
}

func createSQLiteFixture(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open SQLite fixture: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		t.Fatalf("enable WAL: %v", err)
	}
	if _, err := db.Exec("CREATE TABLE channels (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO channels(name) VALUES ('fixture-channel')"); err != nil {
		t.Fatalf("seed SQLite fixture: %v", err)
	}
}

func runBackupTool(t *testing.T, env []string, args ...string) (stdout, stderr []byte, err error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		ps, lookErr := exec.LookPath("powershell.exe")
		if lookErr != nil {
			t.Fatalf("PowerShell is required on Windows: %v", lookErr)
		}
		psArgs := []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", filepath.Join("scripts", "backup-data.ps1"), "-Command", args[0]}
		if len(args) > 1 {
			psArgs = append(psArgs, "-Tag", args[1])
		}
		cmd = exec.CommandContext(ctx, ps, psArgs...)
	} else {
		bash, lookErr := exec.LookPath("bash")
		if lookErr != nil {
			t.Fatalf("bash is required on Unix: %v", lookErr)
		}
		cmd = exec.CommandContext(ctx, bash, append([]string{"scripts/backup-data.sh"}, args...)...)
	}
	cmd.Dir = mustRepoRoot(t)
	cmd.Env = env
	var out, errOut bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errOut
	err = cmd.Run()
	if ctx.Err() != nil {
		err = fmt.Errorf("backup tool timed out: %w", ctx.Err())
	}
	return out.Bytes(), errOut.Bytes(), err
}

func mustRepoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Dir(wd)
}

func assertFileBytes(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s = %q, want %q", path, got, want)
	}
}
