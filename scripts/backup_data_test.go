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
	liveDB := createSQLiteFixture(t, dbPath)
	t.Cleanup(func() { _ = liveDB.Close() })
	if err := os.WriteFile(configPath, originalConfig, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dbPath + "-wal"); err != nil {
		t.Fatalf("fixture should keep an active WAL: %v", err)
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
		"BACKUP_TAG=fixture-v2",
		"UPSTREAM_OPS_HEALTH_URL="+health.URL+"/healthz",
	)
	if _, stderr, err := runBackupTool(t, env, "backup"); err != nil {
		t.Fatalf("backup failed: %v: %s", err, stderr)
	}
	manifestPath := filepath.Join(backupDir, "fixture-v2", "manifest.json")
	manifestBody, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Version  int    `json:"version"`
		Mode     string `json:"mode"`
		Database struct {
			Driver string `json:"driver"`
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
	if manifest.Version != 3 || manifest.Mode != "sqlite-online" || manifest.Database.Driver != "sqlite" || manifest.Database.Name != "upstream-ops.db" || manifest.Database.Size <= 0 || manifest.Database.SHA256 == "" || manifest.Config.Name != "config.yaml" {
		t.Fatalf("unexpected manifest: %s", manifestBody)
	}
	snapshotDB := filepath.Join(backupDir, "fixture-v2", "upstream-ops.db")
	assertSQLiteChannel(t, snapshotDB, "fixture-channel")
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(snapshotDB + suffix); !os.IsNotExist(err) {
			t.Fatalf("online snapshot should not contain %s sidecar", suffix)
		}
	}
	if _, _, err := runBackupTool(t, env, "verify", "fixture-v2"); err != nil {
		t.Fatalf("verify failed: %v", err)
	}

	if err := liveDB.Close(); err != nil {
		t.Fatal(err)
	}
	mutateSQLiteChannel(t, dbPath, "mutated-channel")
	if err := os.WriteFile(configPath, []byte("mutated: true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath+"-wal", []byte("stale-wal"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath+"-shm", []byte("stale-shm"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, stderr, err := runBackupTool(t, env, "restore", "fixture-v2"); err != nil {
		t.Fatalf("restore failed: %v: %s", err, stderr)
	}
	assertSQLiteChannel(t, dbPath, "fixture-channel")
	assertFileBytes(t, configPath, originalConfig)
	for _, suffix := range []string{"-wal", "-shm"} {
		if body, err := os.ReadFile(dbPath + suffix); err == nil && bytes.HasPrefix(body, []byte("stale-")) {
			t.Fatalf("restore kept stale SQLite sidecar %s", suffix)
		}
	}
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
	db := createSQLiteFixture(t, dbPath)
	if err := db.Close(); err != nil {
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
		"BACKUP_TAG=fixture-v2",
		"UPSTREAM_OPS_HEALTH_URL=http://127.0.0.1:1/healthz",
	)
	if _, stderr, err := runBackupTool(t, env, "backup"); err != nil {
		t.Fatalf("backup failed: %v: %s", err, stderr)
	}
	snapshotDB := filepath.Join(backupDir, "fixture-v2", "upstream-ops.db")
	f, err := os.OpenFile(snapshotDB, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("tampered")); err != nil {
		f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	beforeDB, _ := os.ReadFile(dbPath)
	beforeConfig, _ := os.ReadFile(configPath)
	if _, stderr, err := runBackupTool(t, env, "restore", "fixture-v2"); err == nil {
		t.Fatal("tampered restore unexpectedly succeeded")
	} else if !strings.Contains(string(stderr), "checksum mismatch") {
		t.Fatalf("tampered restore error = %q", stderr)
	}
	assertFileBytes(t, dbPath, beforeDB)
	assertFileBytes(t, configPath, beforeConfig)
	if _, _, err := runBackupTool(t, env, "restore", "../fixture-v2"); err == nil {
		t.Fatal("unsafe restore unexpectedly succeeded")
	}
}

func TestBackupRejectsMismatchedAppSecretWithoutChangingLiveFiles(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(dataDir, "upstream-ops.db")
	configPath := filepath.Join(dataDir, "config.yaml")
	db := createSQLiteFixture(t, dbPath)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte("fixture: original\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	baseEnv := []string{
		"UPSTREAM_OPS_ROOT=" + root,
		"UPSTREAM_OPS_DATA_DIR=" + dataDir,
		"UPSTREAM_OPS_BACKUP_DIR=" + backupDir,
		"UPSTREAM_OPS_STOP_APP=0",
		"BACKUP_TAG=fixture-secret",
		"APP_SECRET=backup-secret",
	}
	if _, stderr, err := runBackupTool(t, append(os.Environ(), baseEnv...), "backup"); err != nil {
		t.Fatalf("backup failed: %v: %s", err, stderr)
	}
	beforeDB, _ := os.ReadFile(dbPath)
	beforeConfig, _ := os.ReadFile(configPath)
	wrongEnv := append(os.Environ(), baseEnv[:len(baseEnv)-1]...)
	wrongEnv = append(wrongEnv, "APP_SECRET=wrong-secret")
	if _, stderr, err := runBackupTool(t, wrongEnv, "restore", "fixture-secret"); err == nil {
		t.Fatal("restore with mismatched APP_SECRET unexpectedly succeeded")
	} else if !strings.Contains(string(stderr), "does not match the snapshot encryption key") {
		t.Fatalf("mismatched APP_SECRET error = %q", stderr)
	}
	assertFileBytes(t, dbPath, beforeDB)
	assertFileBytes(t, configPath, beforeConfig)
}

func TestBackupRejectsMismatchedDatabaseDriverBeforeRestore(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(dataDir, "upstream-ops.db")
	configPath := filepath.Join(dataDir, "config.yaml")
	db := createSQLiteFixture(t, dbPath)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte("fixture: original\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := append(os.Environ(),
		"UPSTREAM_OPS_ROOT="+root,
		"UPSTREAM_OPS_DATA_DIR="+dataDir,
		"UPSTREAM_OPS_BACKUP_DIR="+backupDir,
		"UPSTREAM_OPS_STOP_APP=0",
		"BACKUP_TAG=fixture-driver",
	)
	if _, stderr, err := runBackupTool(t, env, "backup"); err != nil {
		t.Fatalf("backup failed: %v: %s", err, stderr)
	}
	manifestPath := filepath.Join(backupDir, "fixture-driver", "manifest.json")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest = bytes.Replace(manifest, []byte(`"driver":"sqlite"`), []byte(`"driver":"mysql"`), 1)
	manifest = bytes.Replace(manifest, []byte(`"name":"upstream-ops.db"`), []byte(`"name":"upstream-ops.sql"`), 1)
	if err := os.WriteFile(manifestPath, manifest, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(backupDir, "fixture-driver", "upstream-ops.db"), filepath.Join(backupDir, "fixture-driver", "upstream-ops.sql")); err != nil {
		t.Fatal(err)
	}
	if _, stderr, err := runBackupTool(t, env, "restore", "fixture-driver"); err == nil {
		t.Fatal("restore with mismatched database driver unexpectedly succeeded")
	} else if !strings.Contains(string(stderr), "does not match current deployment") {
		t.Fatalf("mismatched driver error = %q", stderr)
	}
}

func createSQLiteFixture(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open SQLite fixture: %v", err)
	}
	db.SetMaxOpenConns(1)
	for _, statement := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA wal_autocheckpoint=0",
		"CREATE TABLE channels (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
		"INSERT INTO channels(name) VALUES ('fixture-channel')",
	} {
		if _, err := db.Exec(statement); err != nil {
			db.Close()
			t.Fatalf("seed SQLite fixture with %q: %v", statement, err)
		}
	}
	return db
}

func mutateSQLiteChannel(t *testing.T, path, name string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("UPDATE channels SET name = ?", name); err != nil {
		t.Fatalf("mutate SQLite fixture: %v", err)
	}
}

func assertSQLiteChannel(t *testing.T, path, want string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var got string
	if err := db.QueryRow("SELECT name FROM channels ORDER BY id LIMIT 1").Scan(&got); err != nil {
		t.Fatalf("query SQLite fixture: %v", err)
	}
	if got != want {
		t.Fatalf("channel name = %q, want %q", got, want)
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
