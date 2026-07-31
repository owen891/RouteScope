package api

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/gin-gonic/gin"
)

const (
	backupManifestName = "manifest.json"
	backupConfigName   = "config.yaml"
	// Web exports use the RouteScope product name. The deployed SQLite path is
	// intentionally independent of this name and remains backward compatible.
	backupSQLiteName       = "routescope.db"
	backupLegacySQLiteName = "upstream-ops.db"
	backupUploadField      = "backup"
	backupMaxUpload        = 512 << 20
)

type backupFileManifest struct {
	Driver string `json:"driver,omitempty"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type backupSecurityManifest struct {
	AppSecretSHA256 string `json:"app_secret_sha256"`
}

type backupManifest struct {
	Version         int                    `json:"version"`
	Mode            string                 `json:"mode"`
	Driver          string                 `json:"driver"`
	Database        backupFileManifest     `json:"database"`
	Config          backupFileManifest     `json:"config"`
	AppSecretSHA256 string                 `json:"app_secret_sha256,omitempty"`
	Security        backupSecurityManifest `json:"security,omitempty"`
	CreatedAt       time.Time              `json:"created_at"`
}

type backupInfo struct {
	Tag       string    `json:"tag"`
	CreatedAt time.Time `json:"created_at"`
	Driver    string    `json:"driver"`
	Mode      string    `json:"mode"`
	SizeBytes int64     `json:"size_bytes"`
	Valid     bool      `json:"valid"`
	Error     string    `json:"error,omitempty"`
}

type backupService struct {
	deps *Deps
	mu   sync.Mutex
}

func registerBackups(g *gin.RouterGroup, d *Deps) {
	svc := &backupService{deps: d}
	gs := g.Group("/settings/backups")
	gs.GET("", func(c *gin.Context) { svc.list(c) })
	gs.POST("", func(c *gin.Context) { svc.create(c) })
	gs.GET("/:tag/download", func(c *gin.Context) { svc.download(c) })
	gs.POST("/restore", func(c *gin.Context) { svc.restore(c) })
}

func (s *backupService) list(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.listLocked()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"items": items}})
}

func (s *backupService) create(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, err := s.createLocked()
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errWebBackupUnsupported) {
			status = http.StatusNotImplemented
		}
		fail(c, status, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": item})
}

func (s *backupService) download(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tag := c.Param("tag")
	dir, manifest, err := s.snapshotDirAndManifest(tag)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	if err := verifyBackupFiles(dir, manifest); err != nil {
		fail(c, http.StatusConflict, err)
		return
	}
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="routescope-backup-%s.zip"`, tag))
	zw := zip.NewWriter(c.Writer)
	for _, name := range []string{backupManifestName, manifest.Config.Name, manifest.Database.Name} {
		if err := addFileToZip(zw, filepath.Join(dir, name), name); err != nil {
			_ = zw.Close()
			return
		}
	}
	if err := zw.Close(); err != nil {
		return
	}
}

func (s *backupService) restore(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, backupMaxUpload)
	file, header, err := c.Request.FormFile(backupUploadField)
	if err != nil {
		fail(c, http.StatusBadRequest, fmt.Errorf("backup upload is required: %w", err))
		return
	}
	defer file.Close()
	if header.Size > backupMaxUpload {
		fail(c, http.StatusRequestEntityTooLarge, errors.New("backup upload is too large"))
		return
	}
	tmpDir, err := os.MkdirTemp("", "routescope-restore-")
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	defer os.RemoveAll(tmpDir)
	tmpZip := filepath.Join(tmpDir, "upload.zip")
	out, err := os.OpenFile(tmpZip, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	written, copyErr := io.Copy(out, io.LimitReader(file, backupMaxUpload+1))
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil || written > backupMaxUpload {
		fail(c, http.StatusBadRequest, errors.New("failed to store backup upload"))
		return
	}
	if err := extractBackupZip(tmpZip, tmpDir); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	manifestBytes, err := os.ReadFile(filepath.Join(tmpDir, backupManifestName))
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("backup manifest is missing"))
		return
	}
	var manifest backupManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		fail(c, http.StatusBadRequest, fmt.Errorf("invalid backup manifest: %w", err))
		return
	}
	manifest = normalizeManifest(manifest)
	if err := validateManifest(manifest); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if err := s.validateRestoreSource(tmpDir, manifest); err != nil {
		fail(c, http.StatusConflict, err)
		return
	}
	current, err := s.createLocked()
	if err != nil {
		fail(c, http.StatusInternalServerError, fmt.Errorf("create pre-restore safety backup: %w", err))
		return
	}
	if err := s.installRestore(tmpDir, manifest); err != nil {
		fail(c, http.StatusInternalServerError, err)
		s.scheduleRestart()
		return
	}
	result := gin.H{
		"restored":         true,
		"restart_required": true,
		"safety_backup":    current.Tag,
		"message":          "恢复文件已校验并替换，服务正在重启后加载恢复数据",
	}
	c.JSON(http.StatusAccepted, gin.H{"data": result})
	s.scheduleRestart()
}

func (s *backupService) scheduleRestart() {
	if s.deps.Restart == nil {
		return
	}
	go func() {
		time.Sleep(750 * time.Millisecond)
		s.deps.Restart()
	}()
}

var errWebBackupUnsupported = errors.New("Web 备份目前仅支持 SQLite 部署；MySQL 请先使用服务器备份工具")

func (s *backupService) createLocked() (*backupInfo, error) {
	configPath := s.deps.Runtime.ConfigPath()
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}
	driver := strings.ToLower(strings.TrimSpace(cfg.Database.Driver))
	if driver == "" {
		driver = strings.ToLower(s.deps.DB.Dialector.Name())
	}
	if driver != "sqlite" {
		return nil, errWebBackupUnsupported
	}
	dataDir := filepath.Dir(configPath)
	backupRoot := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(backupRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create backup directory: %w", err)
	}
	tag := time.Now().UTC().Format("20060102_150405")
	for i := 1; ; i++ {
		candidate := tag
		if i > 1 {
			candidate = fmt.Sprintf("%s_%02d", tag, i)
		}
		if _, err := os.Stat(filepath.Join(backupRoot, candidate)); errors.Is(err, os.ErrNotExist) {
			tag = candidate
			break
		}
	}
	staging := filepath.Join(backupRoot, "."+tag+".tmp")
	target := filepath.Join(backupRoot, tag)
	if err := os.RemoveAll(staging); err != nil {
		return nil, err
	}
	if err := os.Mkdir(staging, 0o700); err != nil {
		return nil, fmt.Errorf("create snapshot staging directory: %w", err)
	}
	defer os.RemoveAll(staging)
	dbPath := cfg.Database.ToStorageConfig().SQLitePath()
	if !filepath.IsAbs(dbPath) {
		dbPath, err = filepath.Abs(dbPath)
		if err != nil {
			return nil, fmt.Errorf("resolve database path: %w", err)
		}
	}
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("database file is unavailable: %w", err)
	}
	dbSnapshot := filepath.Join(staging, backupSQLiteName)
	if err := s.deps.DB.Exec("VACUUM INTO ?", dbSnapshot).Error; err != nil {
		return nil, fmt.Errorf("create SQLite consistency snapshot: %w", err)
	}
	if err := copyFile(configPath, filepath.Join(staging, backupConfigName), 0o600); err != nil {
		return nil, fmt.Errorf("copy config: %w", err)
	}
	manifest, err := makeManifest(staging, "sqlite-online", driver, cfg.Security.AppSecret)
	if err != nil {
		return nil, err
	}
	if err := writeJSON(filepath.Join(staging, backupManifestName), manifest); err != nil {
		return nil, err
	}
	if err := os.Rename(staging, target); err != nil {
		return nil, fmt.Errorf("publish backup: %w", err)
	}
	item := backupInfoFromManifest(tag, manifest)
	return &item, nil
}

func (s *backupService) listLocked() ([]backupInfo, error) {
	root := filepath.Join(filepath.Dir(s.deps.Runtime.ConfigPath()), "backups")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return []backupInfo{}, nil
	}
	if err != nil {
		return nil, err
	}
	items := make([]backupInfo, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		manifest, err := readManifest(filepath.Join(dir, backupManifestName))
		if err != nil {
			items = append(items, backupInfo{Tag: entry.Name(), Valid: false, Error: err.Error()})
			continue
		}
		item := backupInfoFromManifest(entry.Name(), manifest)
		if err := verifyBackupFiles(dir, manifest); err != nil {
			item.Valid = false
			item.Error = err.Error()
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Tag > items[j].Tag })
	return items, nil
}

func (s *backupService) snapshotDirAndManifest(tag string) (string, backupManifest, error) {
	if !safeBackupTag(tag) {
		return "", backupManifest{}, errors.New("invalid backup tag")
	}
	dir := filepath.Join(filepath.Dir(s.deps.Runtime.ConfigPath()), "backups", tag)
	manifest, err := readManifest(filepath.Join(dir, backupManifestName))
	return dir, manifest, err
}

func (s *backupService) validateRestoreSource(dir string, manifest backupManifest) error {
	if err := verifyBackupFiles(dir, manifest); err != nil {
		return err
	}
	if err := s.sqliteIntegrityCheck(filepath.Join(dir, manifest.Database.Name)); err != nil {
		return err
	}
	cfg, err := config.Load(s.deps.Runtime.ConfigPath())
	if err != nil {
		return fmt.Errorf("load current config: %w", err)
	}
	driver := strings.ToLower(strings.TrimSpace(cfg.Database.Driver))
	if driver == "" {
		driver = strings.ToLower(s.deps.DB.Dialector.Name())
	}
	if manifest.Driver != driver {
		return fmt.Errorf("backup database driver %q does not match current deployment %q", manifest.Driver, driver)
	}
	if manifest.AppSecretSHA256 != "" {
		current := sha256.Sum256([]byte(cfg.Security.AppSecret))
		if hex.EncodeToString(current[:]) != manifest.AppSecretSHA256 {
			return errors.New("APP_SECRET does not match the backup encryption key")
		}
	}
	restoredFileCfg, err := config.LoadFile(filepath.Join(dir, manifest.Config.Name))
	if err != nil {
		return fmt.Errorf("restored config is invalid: %w", err)
	}
	restoredCfg, err := config.ApplyEnvironmentOverrides(restoredFileCfg)
	if err != nil {
		return fmt.Errorf("apply deployment overrides to restored config: %w", err)
	}
	if strings.ToLower(strings.TrimSpace(restoredCfg.Database.Driver)) != "" &&
		strings.ToLower(strings.TrimSpace(restoredCfg.Database.Driver)) != driver {
		return errors.New("restored config database driver does not match the current deployment")
	}
	currentPath, err := sqlitePath(cfg)
	if err != nil {
		return err
	}
	restoredPath, err := sqlitePath(restoredCfg)
	if err != nil {
		return err
	}
	if currentPath != restoredPath {
		return errors.New("restored config database path does not match the current deployment")
	}
	return nil
}

func (s *backupService) installRestore(dir string, manifest backupManifest) error {
	configPath := s.deps.Runtime.ConfigPath()
	dataDir := filepath.Dir(configPath)
	dbPath := filepath.Join(dataDir, backupSQLiteName)
	if cfg, err := config.Load(configPath); err == nil {
		if candidate, resolveErr := sqlitePath(cfg); resolveErr == nil {
			dbPath = candidate
		}
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return err
	}
	dbTmp := dbPath + ".restore.tmp"
	cfgTmp := configPath + ".restore.tmp"
	if err := copyFile(filepath.Join(dir, manifest.Database.Name), dbTmp, 0o600); err != nil {
		return fmt.Errorf("stage database restore: %w", err)
	}
	if err := copyFile(filepath.Join(dir, manifest.Config.Name), cfgTmp, 0o600); err != nil {
		_ = os.Remove(dbTmp)
		return fmt.Errorf("stage config restore: %w", err)
	}
	// Closing the pool allows replacement on Windows; the process is restarted
	// immediately after the response so all repositories reopen cleanly.
	if sqlDB, err := s.deps.DB.DB(); err == nil {
		_ = sqlDB.Close()
	}
	for _, sidecar := range []string{dbPath + "-wal", dbPath + "-shm"} {
		if err := os.Remove(sidecar); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove stale SQLite sidecar %s: %w", filepath.Base(sidecar), err)
		}
	}
	return replaceRestorePair(dbTmp, dbPath, cfgTmp, configPath)
}

func (s *backupService) sqliteIntegrityCheck(path string) error {
	sqlDB, err := s.deps.DB.DB()
	if err != nil {
		return fmt.Errorf("open database pool for integrity check: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("reserve database connection for integrity check: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "ATTACH DATABASE ? AS restore_check", path); err != nil {
		return fmt.Errorf("open restored SQLite snapshot: %w", err)
	}
	defer func() { _, _ = conn.ExecContext(context.Background(), "DETACH DATABASE restore_check") }()
	rows, err := conn.QueryContext(ctx, "PRAGMA restore_check.integrity_check")
	if err != nil {
		return fmt.Errorf("run restored SQLite integrity check: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			return fmt.Errorf("read restored SQLite integrity result: %w", err)
		}
		if result != "ok" {
			return fmt.Errorf("restored SQLite integrity check failed: %s", result)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read restored SQLite integrity results: %w", err)
	}
	return nil
}

func validateManifest(m backupManifest) error {
	if m.Version != 1 || m.Driver != "sqlite" || !isSQLiteBackupName(m.Database.Name) || m.Config.Name != backupConfigName {
		return errors.New("unsupported or invalid backup manifest")
	}
	if m.Database.Size <= 0 || len(m.Database.SHA256) != sha256.Size*2 || len(m.Config.SHA256) != sha256.Size*2 {
		return errors.New("backup manifest checksums or sizes are invalid")
	}
	return nil
}

func isSQLiteBackupName(name string) bool {
	return name == backupSQLiteName || name == backupLegacySQLiteName
}

func sqlitePath(cfg *config.Config) (string, error) {
	path := cfg.Database.ToStorageConfig().SQLitePath()
	if !filepath.IsAbs(path) {
		resolved, err := filepath.Abs(path)
		if err != nil {
			return "", fmt.Errorf("resolve SQLite path: %w", err)
		}
		path = resolved
	}
	return filepath.Clean(path), nil
}

func verifyBackupFiles(dir string, m backupManifest) error {
	if err := validateManifest(m); err != nil {
		return err
	}
	for _, item := range []backupFileManifest{m.Database, m.Config} {
		path := filepath.Join(dir, item.Name)
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("backup file %s is missing: %w", item.Name, err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("backup file %s is not a regular file", item.Name)
		}
		if info.Size() != item.Size {
			return fmt.Errorf("backup file %s size mismatch", item.Name)
		}
		hash, err := hashFile(path)
		if err != nil {
			return err
		}
		if hash != item.SHA256 {
			return fmt.Errorf("backup file %s checksum mismatch", item.Name)
		}
	}
	return nil
}

func makeManifest(dir, mode, driver, appSecret string) (backupManifest, error) {
	db, err := fileManifest(filepath.Join(dir, backupSQLiteName), backupSQLiteName)
	if err != nil {
		return backupManifest{}, err
	}
	cfg, err := fileManifest(filepath.Join(dir, backupConfigName), backupConfigName)
	if err != nil {
		return backupManifest{}, err
	}
	m := backupManifest{Version: 1, Mode: mode, Driver: driver, Database: db, Config: cfg, CreatedAt: time.Now().UTC()}
	if strings.TrimSpace(appSecret) != "" {
		hash := sha256.Sum256([]byte(appSecret))
		m.AppSecretSHA256 = hex.EncodeToString(hash[:])
	}
	return m, nil
}

func fileManifest(path, name string) (backupFileManifest, error) {
	info, err := os.Stat(path)
	if err != nil {
		return backupFileManifest{}, err
	}
	hash, err := hashFile(path)
	if err != nil {
		return backupFileManifest{}, err
	}
	return backupFileManifest{Name: name, Size: info.Size(), SHA256: hash}, nil
}

func backupInfoFromManifest(tag string, m backupManifest) backupInfo {
	return backupInfo{Tag: tag, CreatedAt: m.CreatedAt, Driver: m.Driver, Mode: m.Mode, SizeBytes: m.Database.Size + m.Config.Size, Valid: true}
}

func readManifest(path string) (backupManifest, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return backupManifest{}, err
	}
	if !info.Mode().IsRegular() {
		return backupManifest{}, errors.New("backup manifest is not a regular file")
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return backupManifest{}, err
	}
	var m backupManifest
	if err := json.Unmarshal(bytes, &m); err != nil {
		return backupManifest{}, err
	}
	m = normalizeManifest(m)
	return m, nil
}

// normalizeManifest accepts both the Web v1 shape and the CLI v3 shape. The
// CLI backup helpers shipped driver and secret nested under database/security.
func normalizeManifest(m backupManifest) backupManifest {
	if m.Driver == "" {
		m.Driver = m.Database.Driver
	}
	if m.AppSecretSHA256 == "" {
		m.AppSecretSHA256 = m.Security.AppSecretSHA256
	}
	if m.Version == 3 {
		m.Version = 1
	}
	return m
}

func extractBackupZip(path, dest string) error {
	r, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("invalid backup zip: %w", err)
	}
	defer r.Close()
	seen := map[string]bool{}
	var totalSize uint64
	for _, file := range r.File {
		if file.FileInfo().IsDir() || filepath.Base(file.Name) != file.Name || strings.Contains(file.Name, "\\") || strings.Contains(file.Name, "..") {
			return errors.New("backup zip contains an unsafe path")
		}
		if seen[file.Name] || (file.Name != backupManifestName && file.Name != backupConfigName && !isSQLiteBackupName(file.Name)) {
			return errors.New("backup zip contains unexpected files")
		}
		if file.UncompressedSize64 > backupMaxUpload {
			return errors.New("backup zip entry is too large")
		}
		totalSize += file.UncompressedSize64
		if totalSize > backupMaxUpload {
			return errors.New("backup zip expands beyond the allowed size")
		}
		seen[file.Name] = true
		src, err := file.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(filepath.Join(dest, file.Name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			_ = src.Close()
			return err
		}
		written, copyErr := io.Copy(out, io.LimitReader(src, backupMaxUpload+1))
		_ = src.Close()
		closeErr := out.Close()
		if copyErr != nil || closeErr != nil || written > backupMaxUpload {
			return errors.New("failed to extract backup zip")
		}
	}
	if !seen[backupManifestName] {
		return errors.New("backup zip manifest is missing")
	}
	return nil
}

func addFileToZip(zw *zip.Writer, path, name string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, file)
	return err
}

func copyFile(source, target string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func replaceRestorePair(dbSource, dbTarget, configSource, configTarget string) error {
	dbPrevious := dbTarget + ".restore.previous"
	configPrevious := configTarget + ".restore.previous"
	for _, path := range []string{dbPrevious, configPrevious} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove stale restore file %s: %w", filepath.Base(path), err)
		}
	}
	if err := os.Rename(dbTarget, dbPrevious); err != nil {
		return fmt.Errorf("preserve current database: %w", err)
	}
	if err := os.Rename(configTarget, configPrevious); err != nil {
		_ = os.Rename(dbPrevious, dbTarget)
		return fmt.Errorf("preserve current config: %w", err)
	}
	rollback := func() error {
		_ = os.Remove(dbTarget)
		_ = os.Remove(configTarget)
		dbErr := os.Rename(dbPrevious, dbTarget)
		cfgErr := os.Rename(configPrevious, configTarget)
		return errors.Join(dbErr, cfgErr)
	}
	if err := os.Rename(dbSource, dbTarget); err != nil {
		return errors.Join(fmt.Errorf("install restored database: %w", err), rollback())
	}
	if err := os.Rename(configSource, configTarget); err != nil {
		return errors.Join(fmt.Errorf("install restored config: %w", err), rollback())
	}
	_ = os.Remove(dbPrevious)
	_ = os.Remove(configPrevious)
	return nil
}

func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeJSON(path string, value any) error {
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes, '\n'), 0o600)
}

func safeBackupTag(tag string) bool {
	if tag == "" || len(tag) > 80 || strings.ContainsAny(tag, `/\\`) || tag == "." || tag == ".." {
		return false
	}
	for _, r := range tag {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}
