package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/runtimeconfig"
	"github.com/bejix/upstream-ops/backend/scheduler"
	"github.com/gin-gonic/gin"
)

func TestSaveSettingsKeepsAppVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)

	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{
		App: config.AppConfig{
			Title:              "Old",
			NotificationPrefix: "[Old] ",
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}

	r := gin.New()
	api := r.Group("/api")
	registerSettings(api, &Deps{
		Runtime: runtimeconfig.New(path, "", nil, nil, nil, nil, nil, config.ProxyConfig{}, config.UpstreamConfig{}, nil),
	})

	body := `{
		"app":{"title":"New","notificationPrefix":"[New] "},
		"auth":{"enabled":false,"username":"admin","passwordReplacement":"","tokenSecretReplacement":"","sessionTTLHours":168},
		"scheduler":{"balanceCron":"37 */15 * * * *","rateCron":"13 */30 * * * *","concurrency":4,"retention":{"cron":"0 17 3 * * *","monitorLogsDays":30,"balanceSnapshotsDays":90,"notificationLogsDays":90,"announcementsDays":90}},
		"notifications":{"batchRateChanges":true,"minChangePct":0,"balanceLowCooldownMinutes":60,"subscriptionDailyRemainingThresholdPct":0,"subscriptionWeeklyRemainingThresholdPct":0,"subscriptionMonthlyRemainingThresholdPct":0,"subscriptionExpiryThresholdHours":0,"subscriptionAlertCooldownMinutes":1440,"sendMaxAttempts":3},
		"proxy":{"enabled":true,"versionCheckEnabled":true,"protocol":"socks5","host":"127.0.0.1","port":1080,"username":"u","passwordReplacement":"p"},
		"upstream":{"timeoutSeconds":45,"userAgent":"custom-agent"}
	}`
	req := httptest.NewRequest(http.MethodPut, "/api/settings/config", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	got, err := config.LoadFile(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if got.App.Title != "New" {
		t.Fatalf("title = %q", got.App.Title)
	}
	if got.App.NotificationPrefix != "[New] " {
		t.Fatalf("notification prefix = %q", got.App.NotificationPrefix)
	}
	if !got.Proxy.Enabled || !got.Proxy.VersionCheckEnabled || got.Proxy.Protocol != "socks5" || got.Proxy.Host != "127.0.0.1" || got.Proxy.Port != 1080 || got.Proxy.Username != "u" || got.Proxy.Password != "p" {
		t.Fatalf("proxy = %#v", got.Proxy)
	}
	if got.Upstream.TimeoutSeconds != 45 || got.Upstream.UserAgent != "custom-agent" {
		t.Fatalf("upstream = %#v", got.Upstream)
	}
}

func TestGetSettingsRedactsSecretsAndShowsConfiguredState(t *testing.T) {
	gin.SetMode(gin.TestMode)
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{
		Security: config.SecurityConfig{AppSecret: "file-app-secret"},
		Database: config.DatabaseConfig{Password: "file-database-secret"},
		Auth: config.AuthConfig{
			Enabled:         true,
			Username:        "file-admin",
			Password:        "file-admin-secret",
			TokenSecret:     "file-token-secret",
			SessionTTLHours: 24,
		},
		Proxy: config.ProxyConfig{
			Enabled:  true,
			Host:     "127.0.0.1",
			Password: "file-proxy-secret",
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}
	t.Setenv("AUTH_ENABLED", "true")
	t.Setenv("ADMIN_USERNAME", "env-admin")
	t.Setenv("ADMIN_PASSWORD", "env-admin-secret")
	t.Setenv("AUTH_TOKEN_SECRET", "env-token-secret")
	t.Setenv("APP_SECRET", "env-app-secret")
	t.Setenv("DATABASE_PASSWORD", "env-database-secret")

	r := newSettingsTestRouter(path)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings/config", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	for _, secret := range []string{
		"file-app-secret",
		"file-database-secret",
		"file-admin-secret",
		"file-token-secret",
		"file-proxy-secret",
		"env-admin-secret",
		"env-token-secret",
		"env-app-secret",
		"env-database-secret",
	} {
		if strings.Contains(rec.Body.String(), secret) {
			t.Fatalf("settings response contains secret %q", secret)
		}
	}
	for _, forbidden := range []string{`"security"`, `"database"`, `"appSecret"`} {
		if strings.Contains(rec.Body.String(), forbidden) {
			t.Fatalf("settings response exposes forbidden config key %s", forbidden)
		}
	}

	var response struct {
		Data struct {
			Config struct {
				Auth  map[string]any `json:"auth"`
				Proxy map[string]any `json:"proxy"`
			} `json:"config"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, key := range []string{"password", "tokenSecret", "passwordReplacement", "tokenSecretReplacement"} {
		if _, ok := response.Data.Config.Auth[key]; ok {
			t.Fatalf("auth response exposes forbidden key %q", key)
		}
	}
	for _, key := range []string{"password", "passwordReplacement"} {
		if _, ok := response.Data.Config.Proxy[key]; ok {
			t.Fatalf("proxy response exposes forbidden key %q", key)
		}
	}
	if response.Data.Config.Auth["username"] != "env-admin" || response.Data.Config.Auth["enabled"] != true {
		t.Fatalf("auth response does not reflect effective non-secret state: %#v", response.Data.Config.Auth)
	}
	if response.Data.Config.Auth["passwordConfigured"] != true || response.Data.Config.Auth["tokenSecretConfigured"] != true {
		t.Fatalf("auth configured indicators = %#v", response.Data.Config.Auth)
	}
	if response.Data.Config.Proxy["passwordConfigured"] != true {
		t.Fatalf("proxy configured indicator = %#v", response.Data.Config.Proxy)
	}
}

func TestSaveSettingsPreservesFileSecretsOnBlankReplacement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{
		Auth: config.AuthConfig{
			Password:    "file-admin-secret",
			TokenSecret: "file-token-secret",
		},
		Proxy: config.ProxyConfig{Password: "file-proxy-secret"},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}

	putSettings(t, newSettingsTestRouter(path), settingsBody("", "", ""))
	got, err := config.LoadFile(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if got.Auth.Password != "file-admin-secret" || got.Auth.TokenSecret != "file-token-secret" || got.Proxy.Password != "file-proxy-secret" {
		t.Fatalf("blank replacement changed file secrets: auth=%#v proxy=%#v", got.Auth, got.Proxy)
	}
}

func TestSaveSettingsDoesNotPersistEnvironmentSecretsAndApplyKeepsThemEffective(t *testing.T) {
	gin.SetMode(gin.TestMode)
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := config.Save(path, &config.Config{}); err != nil {
		t.Fatalf("save config: %v", err)
	}
	t.Setenv("AUTH_ENABLED", "true")
	t.Setenv("ADMIN_USERNAME", "env-admin")
	t.Setenv("ADMIN_PASSWORD", "env-admin-secret")
	t.Setenv("AUTH_TOKEN_SECRET", "env-token-secret")
	t.Setenv("APP_SECRET", "env-app-secret")
	t.Setenv("DATABASE_PASSWORD", "env-database-secret")

	mgr := newSettingsTestRuntime(path)
	r := gin.New()
	registerSettings(r.Group("/api"), &Deps{Runtime: mgr})
	putSettings(t, r, settingsBody("", "", ""))

	fileCfg, err := config.LoadFile(path)
	if err != nil {
		t.Fatalf("load file config: %v", err)
	}
	if fileCfg.Auth.Password != "" || fileCfg.Auth.TokenSecret != "" || fileCfg.Security.AppSecret != "" || fileCfg.Database.Password != "" {
		t.Fatalf("environment secrets copied to file: auth=%#v security=%#v database=%#v", fileCfg.Auth, fileCfg.Security, fileCfg.Database)
	}
	if _, err := mgr.ApplyFromFile(); err != nil {
		t.Fatalf("apply config: %v", err)
	}
	if _, _, err := mgr.CurrentAuth().Login("env-admin", "env-admin-secret"); err != nil {
		t.Fatalf("environment credentials not effective after apply: %v", err)
	}
}

func TestSaveSettingsAcceptsExplicitSecretReplacements(t *testing.T) {
	gin.SetMode(gin.TestMode)
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := config.Save(path, &config.Config{}); err != nil {
		t.Fatalf("save config: %v", err)
	}

	putSettings(t, newSettingsTestRouter(path), settingsBody("new-admin-secret", "new-token-secret", "new-proxy-secret"))
	got, err := config.LoadFile(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if got.Auth.Password != "new-admin-secret" || got.Auth.TokenSecret != "new-token-secret" || got.Proxy.Password != "new-proxy-secret" {
		t.Fatalf("explicit replacements not persisted: auth=%#v proxy=%#v", got.Auth, got.Proxy)
	}
}

func newSettingsTestRuntime(path string) *runtimeconfig.Manager {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return runtimeconfig.New(
		path,
		"fallback-secret",
		log,
		nil,
		nil,
		nil,
		nil,
		config.ProxyConfig{},
		config.UpstreamConfig{},
		func(scfg config.SchedulerConfig, pcfg config.ProxyConfig) *scheduler.Scheduler {
			return scheduler.New(scfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, pcfg, log)
		},
	)
}

func newSettingsTestRouter(path string) *gin.Engine {
	r := gin.New()
	registerSettings(r.Group("/api"), &Deps{Runtime: newSettingsTestRuntime(path)})
	return r
}

func putSettings(t *testing.T, r http.Handler, body string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/settings/config", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func settingsBody(passwordReplacement, tokenSecretReplacement, proxyPasswordReplacement string) string {
	body := map[string]any{
		"app": map[string]any{"title": "New", "notificationPrefix": "[New] "},
		"auth": map[string]any{
			"enabled":                false,
			"username":               "admin",
			"passwordReplacement":    passwordReplacement,
			"tokenSecretReplacement": tokenSecretReplacement,
			"sessionTTLHours":        168,
		},
		"scheduler": map[string]any{
			"balanceCron": "",
			"rateCron":    "",
			"concurrency": 4,
			"retention": map[string]any{
				"cron": "",
			},
		},
		"notifications": map[string]any{},
		"proxy": map[string]any{
			"enabled":             true,
			"versionCheckEnabled": true,
			"protocol":            "socks5",
			"host":                "127.0.0.1",
			"port":                1080,
			"username":            "proxy-user",
			"passwordReplacement": proxyPasswordReplacement,
		},
		"upstream": map[string]any{"timeoutSeconds": 45, "userAgent": "custom-agent"},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}
