package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/runtimeconfig"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestWebBackupCreateListDownloadAndRestore(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yaml")
	dbPath := filepath.Join(root, backupSQLiteName)
	t.Setenv("APP_SECRET", "web-backup-secret")
	t.Setenv("DATABASE_DRIVER", "sqlite")
	t.Setenv("DATABASE_PATH", dbPath)
	if err := config.Save(configPath, &config.Config{
		Database: config.DatabaseConfig{Driver: "sqlite", Path: dbPath},
		Security: config.SecurityConfig{AppSecret: "web-backup-secret"},
	}); err != nil {
		t.Fatalf("save config: %v", err)
	}
	db, err := storage.Open(storage.DBConfig{Driver: storage.DBDriverSQLite, Path: dbPath})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() {
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	}()
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	runtime := runtimeconfig.New(configPath, "web-backup-secret", nil, nil, nil, nil, nil, nil, config.ProxyConfig{}, config.UpstreamConfig{}, config.GatewayConfig{}, nil)
	r := gin.New()
	registerBackups(r.Group("/api"), &Deps{DB: db, Runtime: runtime})

	create := httptest.NewRecorder()
	r.ServeHTTP(create, httptest.NewRequest(http.MethodPost, "/api/settings/backups", nil))
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	var created struct {
		Data backupInfo `json:"data"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if !created.Data.Valid || created.Data.Tag == "" {
		t.Fatalf("created backup = %#v", created.Data)
	}

	list := httptest.NewRecorder()
	r.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/api/settings/backups", nil))
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte(created.Data.Tag)) {
		t.Fatalf("list status/body = %d/%s", list.Code, list.Body.String())
	}

	download := httptest.NewRecorder()
	r.ServeHTTP(download, httptest.NewRequest(http.MethodGet, "/api/settings/backups/"+created.Data.Tag+"/download", nil))
	if download.Code != http.StatusOK {
		t.Fatalf("download status = %d, body = %s", download.Code, download.Body.String())
	}
	zipReader, err := zip.NewReader(bytes.NewReader(download.Body.Bytes()), int64(download.Body.Len()))
	if err != nil {
		t.Fatalf("open downloaded zip: %v", err)
	}
	if len(zipReader.File) != 3 {
		t.Fatalf("downloaded zip files = %d", len(zipReader.File))
	}
	zipNames := make(map[string]bool, len(zipReader.File))
	for _, file := range zipReader.File {
		zipNames[file.Name] = true
	}
	if !zipNames[backupSQLiteName] || zipNames[backupLegacySQLiteName] {
		t.Fatalf("downloaded zip database names = %#v, want only %q", zipNames, backupSQLiteName)
	}

	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile(backupUploadField, "backup.zip")
	if err != nil {
		t.Fatalf("create multipart part: %v", err)
	}
	if _, err := io.Copy(part, bytes.NewReader(download.Body.Bytes())); err != nil {
		t.Fatalf("copy backup upload: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}
	restoreReq := httptest.NewRequest(http.MethodPost, "/api/settings/backups/restore", &upload)
	restoreReq.Header.Set("Content-Type", writer.FormDataContentType())
	restore := httptest.NewRecorder()
	r.ServeHTTP(restore, restoreReq)
	if restore.Code != http.StatusAccepted {
		t.Fatalf("restore status = %d, body = %s", restore.Code, restore.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "backups")); err != nil {
		t.Fatalf("backup directory after restore: %v", err)
	}
}
