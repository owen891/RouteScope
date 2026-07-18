package runtimeconfig

import (
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/auth"
	"github.com/bejix/upstream-ops/backend/channel"
	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/connector"
	"github.com/bejix/upstream-ops/backend/scheduler"
)

type fakeHTTPConfigConnector struct {
	cfg connector.HTTPConfig
}

func (f *fakeHTTPConfigConnector) SetHTTPConfig(cfg connector.HTTPConfig) {
	f.cfg = cfg
}

func TestApplyFromFileUpdatesUpstreamConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{
		Scheduler: config.SchedulerConfig{
			BalanceCron: "",
			RateCron:    "",
			Retention:   config.RetentionConfig{Cron: ""},
		},
		Upstream: config.UpstreamConfig{
			TimeoutSeconds: 45,
			UserAgent:      "custom-agent",
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}

	channelSvc := channel.NewService(nil, nil, nil, nil, nil, nil)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	mgr := New(
		path,
		"",
		log,
		nil,
		channelSvc,
		nil,
		nil,
		config.ProxyConfig{},
		config.UpstreamConfig{},
		func(scfg config.SchedulerConfig, pcfg config.ProxyConfig) *scheduler.Scheduler {
			return scheduler.New(scfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, pcfg, log)
		},
	)

	result, err := mgr.ApplyFromFile()
	if err != nil {
		t.Fatalf("ApplyFromFile: %v", err)
	}
	if len(result.AppliedSections) == 0 {
		t.Fatalf("applied sections empty")
	}
	if got := mgr.CurrentUpstream(); got.TimeoutSeconds != 45 || got.UserAgent != "custom-agent" {
		t.Fatalf("current upstream = %#v", got)
	}

	conn := &fakeHTTPConfigConnector{}
	channelSvc.ApplyHTTPConfig(conn)
	if conn.cfg.Timeout != 45*time.Second {
		t.Fatalf("timeout = %s", conn.cfg.Timeout)
	}
	if conn.cfg.UserAgent != "custom-agent" {
		t.Fatalf("user agent = %q", conn.cfg.UserAgent)
	}
}

func TestApplyFromFileUsesEnvironmentAuthOverrides(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{
		Auth: config.AuthConfig{
			Enabled:         false,
			Username:        "file-admin",
			Password:        "file-password",
			TokenSecret:     "file-token-secret",
			SessionTTLHours: 24,
		},
		Scheduler: config.SchedulerConfig{
			BalanceCron: "",
			RateCron:    "",
			Retention:   config.RetentionConfig{Cron: ""},
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}
	t.Setenv("AUTH_ENABLED", "true")
	t.Setenv("ADMIN_USERNAME", "env-admin")
	t.Setenv("ADMIN_PASSWORD", "env-password")
	t.Setenv("AUTH_TOKEN_SECRET", "env-token-secret")

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	mgr := New(
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

	if _, err := mgr.ApplyFromFile(); err != nil {
		t.Fatalf("ApplyFromFile: %v", err)
	}
	svc := mgr.CurrentAuth()
	if svc == nil {
		t.Fatal("auth service is nil after environment-enabled apply")
	}
	if _, _, err := svc.Login("env-admin", "env-password"); err != nil {
		t.Fatalf("environment credentials rejected: %v", err)
	}
	if _, _, err := svc.Login("file-admin", "file-password"); err == nil {
		t.Fatal("file credentials accepted despite environment overrides")
	}
}

func TestApplyFromFileInvalidAuthPreservesCurrentServices(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{
		Auth: config.AuthConfig{
			Enabled:         true,
			Username:        "admin",
			Password:        "",
			TokenSecret:     "new-token-secret",
			SessionTTLHours: 24,
		},
		Scheduler: config.SchedulerConfig{
			BalanceCron: "",
			RateCron:    "",
			Retention:   config.RetentionConfig{Cron: ""},
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}
	t.Setenv("AUTH_ENABLED", "")
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("AUTH_TOKEN_SECRET", "")

	oldAuth, err := auth.New("old-admin", "old-password", "old-token-secret", time.Hour)
	if err != nil {
		t.Fatalf("create old auth: %v", err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	oldScheduler := scheduler.New(config.SchedulerConfig{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, config.ProxyConfig{}, log)
	factoryCalled := false
	mgr := New(
		path,
		"fallback-secret",
		log,
		nil,
		nil,
		oldAuth,
		oldScheduler,
		config.ProxyConfig{},
		config.UpstreamConfig{},
		func(scfg config.SchedulerConfig, pcfg config.ProxyConfig) *scheduler.Scheduler {
			factoryCalled = true
			return scheduler.New(scfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, pcfg, log)
		},
	)

	if _, err := mgr.ApplyFromFile(); err == nil {
		t.Fatal("ApplyFromFile succeeded with invalid effective auth config")
	}
	if factoryCalled {
		t.Fatal("scheduler factory called before auth validation completed")
	}
	if mgr.CurrentAuth() != oldAuth {
		t.Fatal("current auth service changed after failed apply")
	}
	if mgr.scheduler != oldScheduler {
		t.Fatal("current scheduler changed after failed apply")
	}
}
