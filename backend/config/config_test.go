package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLoadAppliesUpstreamDefaults(t *testing.T) {
	cfg, err := LoadFile(filepath.Join(t.TempDir(), "missing.yaml"))
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.Upstream.TimeoutSeconds != DefaultUpstreamTimeoutSeconds {
		t.Fatalf("timeout seconds = %d", cfg.Upstream.TimeoutSeconds)
	}
	if cfg.Upstream.UserAgent != DefaultUpstreamUserAgent {
		t.Fatalf("user agent = %q", cfg.Upstream.UserAgent)
	}
}

func TestUpstreamConfigWithDefaultsKeepsCustomUserAgent(t *testing.T) {
	cfg := UpstreamConfig{
		TimeoutSeconds: 0,
		UserAgent:      "custom-agent",
	}.WithDefaults()
	if cfg.TimeoutSeconds != DefaultUpstreamTimeoutSeconds {
		t.Fatalf("timeout seconds = %d", cfg.TimeoutSeconds)
	}
	if cfg.UserAgent != "custom-agent" {
		t.Fatalf("user agent = %q", cfg.UserAgent)
	}
}

func TestLoadEnvironmentOverridesBoundDeploymentValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	fileCfg := &Config{
		Security: SecurityConfig{AppSecret: "file-app-secret"},
		Auth: AuthConfig{
			Enabled:     false,
			Username:    "file-admin",
			Password:    "file-password",
			TokenSecret: "file-token-secret",
		},
		Database: DatabaseConfig{
			Driver:   "sqlite",
			Path:     "file.db",
			Host:     "file-host",
			Port:     3306,
			User:     "file-user",
			Password: "file-database-password",
			Name:     "file-database",
		},
		Server: ServerConfig{Port: 8418, Mode: "debug"},
		Log:    LogConfig{Level: "info"},
	}
	if err := Save(path, fileCfg); err != nil {
		t.Fatalf("Save: %v", err)
	}

	t.Setenv("APP_SECRET", "env-app-secret")
	t.Setenv("AUTH_ENABLED", "true")
	t.Setenv("ADMIN_USERNAME", "env-admin")
	t.Setenv("ADMIN_PASSWORD", "env-password")
	t.Setenv("AUTH_TOKEN_SECRET", "env-token-secret")
	t.Setenv("DATABASE_DRIVER", "mysql")
	t.Setenv("DATABASE_PATH", "env.db")
	t.Setenv("DATABASE_HOST", "env-host")
	t.Setenv("DATABASE_PORT", "3307")
	t.Setenv("DATABASE_USER", "env-user")
	t.Setenv("DATABASE_PASSWORD", "env-database-password")
	t.Setenv("DATABASE_NAME", "env-database")
	t.Setenv("SERVER_PORT", "9418")
	t.Setenv("SERVER_MODE", "release")
	t.Setenv("LOG_LEVEL", "debug")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Security.AppSecret != "env-app-secret" {
		t.Fatalf("app secret = %q", cfg.Security.AppSecret)
	}
	if !cfg.Auth.Enabled || cfg.Auth.Username != "env-admin" || cfg.Auth.Password != "env-password" || cfg.Auth.TokenSecret != "env-token-secret" {
		t.Fatalf("auth config = %#v", cfg.Auth)
	}
	if cfg.Database.Driver != "mysql" || cfg.Database.Path != "env.db" || cfg.Database.Host != "env-host" || cfg.Database.Port != 3307 || cfg.Database.User != "env-user" || cfg.Database.Password != "env-database-password" || cfg.Database.Name != "env-database" {
		t.Fatalf("database config = %#v", cfg.Database)
	}
	if cfg.Server.Port != 9418 || cfg.Server.Mode != "release" {
		t.Fatalf("server config = %#v", cfg.Server)
	}
	if cfg.Log.Level != "debug" {
		t.Fatalf("log config = %#v", cfg.Log)
	}
}

func TestLoadFileBaselineDoesNotPersistEnvironmentSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	t.Setenv("APP_SECRET", "sentinel-app-secret")
	t.Setenv("ADMIN_PASSWORD", "sentinel-admin-password")
	t.Setenv("AUTH_TOKEN_SECRET", "sentinel-token-secret")
	t.Setenv("DATABASE_PASSWORD", "sentinel-database-password")

	baseline, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if err := Save(path, baseline); err != nil {
		t.Fatalf("Save: %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	for _, secret := range []string{
		"sentinel-app-secret",
		"sentinel-admin-password",
		"sentinel-token-secret",
		"sentinel-database-password",
	} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("config file contains environment secret %q", secret)
		}
	}

	effective, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if effective.Security.AppSecret != "sentinel-app-secret" || effective.Auth.Password != "sentinel-admin-password" || effective.Auth.TokenSecret != "sentinel-token-secret" || effective.Database.Password != "sentinel-database-password" {
		t.Fatalf("effective environment secrets were not retained")
	}
}

func TestSaveRestrictsConfigPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not enforced on Windows")
	}

	for _, tc := range []struct {
		name     string
		existing bool
	}{
		{name: "new file"},
		{name: "existing permissive file", existing: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.yaml")
			if tc.existing {
				if err := os.WriteFile(path, []byte("app: {}\n"), 0o666); err != nil {
					t.Fatalf("seed config: %v", err)
				}
				if err := os.Chmod(path, 0o666); err != nil {
					t.Fatalf("chmod seed config: %v", err)
				}
			}
			if err := Save(path, &Config{}); err != nil {
				t.Fatalf("Save: %v", err)
			}
			info, err := os.Stat(path)
			if err != nil {
				t.Fatalf("Stat: %v", err)
			}
			if got := info.Mode().Perm(); got != 0o600 {
				t.Fatalf("permissions = %04o, want 0600", got)
			}
		})
	}
}
