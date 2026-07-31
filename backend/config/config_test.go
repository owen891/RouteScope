package config

import (
	"errors"
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
	if cfg.Adjustment.GrossMarginPct != 0 {
		t.Fatalf("gross margin = %v", cfg.Adjustment.GrossMarginPct)
	}
}

func TestAdjustmentConfigReadsLegacyMarkupField(t *testing.T) {
	cfg := AdjustmentConfig{ProfitMarginPct: 12.5}
	if got := cfg.EffectiveGrossMarginPct(); got != 12.5 {
		t.Fatalf("effective gross margin = %v", got)
	}
}

func TestRequiresAdminAuth(t *testing.T) {
	for _, tc := range []struct {
		mode string
		want bool
	}{
		{mode: "release", want: true},
		{mode: " Production ", want: true},
		{mode: "debug", want: false},
		{mode: "test", want: false},
		{mode: "", want: false},
	} {
		if got := RequiresAdminAuth(tc.mode); got != tc.want {
			t.Errorf("RequiresAdminAuth(%q) = %t, want %t", tc.mode, got, tc.want)
		}
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

func TestSaveRenameFailurePreservesExistingConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	original := []byte("app:\n  title: previous\n")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	originalRename := renameConfigFile
	renameConfigFile = func(_, _ string) error {
		return errors.New("rename failed")
	}
	t.Cleanup(func() { renameConfigFile = originalRename })

	if err := Save(path, &Config{App: AppConfig{Title: "replacement"}}); err == nil {
		t.Fatal("Save succeeded despite rename failure")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read existing config: %v", err)
	}
	if string(got) != string(original) {
		t.Fatalf("existing config changed after failed rename: got %q, want %q", got, original)
	}
}

func TestGatewayConfigWithDefaults(t *testing.T) {
	cfg := GatewayConfig{}.WithDefaults()
	if cfg.TempPauseSeconds != DefaultGatewayTempPauseSeconds {
		t.Fatalf("temp pause = %d", cfg.TempPauseSeconds)
	}
	if cfg.ForwardTimeoutSeconds != DefaultGatewayForwardTimeoutSeconds {
		t.Fatalf("forward timeout = %d", cfg.ForwardTimeoutSeconds)
	}
	if cfg.RouteBatchConcurrency != DefaultGatewayRouteBatchConcurrency {
		t.Fatalf("batch concurrency = %d", cfg.RouteBatchConcurrency)
	}
	custom := GatewayConfig{RouteBatchConcurrency: 16, ForwardTimeoutSeconds: 120}.WithDefaults()
	if custom.RouteBatchConcurrency != 16 || custom.ForwardTimeoutSeconds != 120 {
		t.Fatalf("custom = %#v", custom)
	}
	if custom.ModelsCacheTTLSeconds != DefaultGatewayModelsCacheTTLSeconds {
		t.Fatalf("models cache ttl = %d", custom.ModelsCacheTTLSeconds)
	}
}

func TestLoadFeishuSecretsFromFilesAndEnvironment(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	for name, value := range map[string]string{
		"app-secret":         "file-app-secret\n",
		"verification-token": "file-verification-token\n",
		"encrypt-key":        "file-encrypt-key\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := Save(path, &Config{Feishu: FeishuConfig{
		Enabled:               true,
		AppID:                 "test-app-id",
		AppSecretFile:         "app-secret",
		VerificationTokenFile: "verification-token",
		EncryptKeyFile:        "encrypt-key",
	}}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	t.Setenv("FEISHU_APP_SECRET", "env-app-secret")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Feishu.AppSecret != "env-app-secret" {
		t.Fatalf("app secret = %q", cfg.Feishu.AppSecret)
	}
	if cfg.Feishu.VerificationToken != "file-verification-token" || cfg.Feishu.EncryptKey != "file-encrypt-key" {
		t.Fatalf("resolved Feishu secrets are incomplete")
	}
	if cfg.Feishu.CallbackPath != "/callbacks/feishu" || cfg.Feishu.BindCodeTTLMinutes != 10 || cfg.Feishu.BindCodeMaxAttempts != 5 {
		t.Fatalf("Feishu defaults = %#v", cfg.Feishu)
	}
}

func TestLoadFeishuSecretFileFailureDoesNotExposeContents(t *testing.T) {
	t.Setenv("FEISHU_APP_SECRET", "")
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := Save(path, &Config{Feishu: FeishuConfig{
		Enabled:       true,
		AppSecretFile: "missing-secret",
	}}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	_, err := Load(path)
	if err == nil || !strings.Contains(err.Error(), "read Feishu App Secret file") {
		t.Fatalf("Load error = %v", err)
	}
}

func TestSaveDoesNotPersistFeishuSecretValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &Config{Feishu: FeishuConfig{
		AppSecret:         "sentinel-feishu-app-secret",
		VerificationToken: "sentinel-feishu-verification-token",
		EncryptKey:        "sentinel-feishu-encrypt-key",
		AppSecretFile:     "/run/secrets/feishu-app-secret",
	}}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	for _, secret := range []string{cfg.Feishu.AppSecret, cfg.Feishu.VerificationToken, cfg.Feishu.EncryptKey} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("config file contains Feishu secret %q", secret)
		}
	}
	if !strings.Contains(string(body), cfg.Feishu.AppSecretFile) {
		t.Fatal("config file did not retain the non-secret file path")
	}
}
