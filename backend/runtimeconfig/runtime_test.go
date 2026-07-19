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
	"github.com/bejix/upstream-ops/backend/notify"
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

func TestApplyFromFileInvalidSchedulerPreservesCollaborators(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	newProxy := config.ProxyConfig{Enabled: true, Protocol: "http", Host: "new-proxy", Port: 8080}
	newUpstream := config.UpstreamConfig{TimeoutSeconds: 45, UserAgent: "new-agent"}
	if err := config.Save(path, &config.Config{
		Scheduler: config.SchedulerConfig{BalanceCron: "not a cron"},
		Proxy:     newProxy,
		Upstream:  newUpstream,
		Notifications: config.NotificationsConfig{
			SendMaxAttempts: 3,
		},
	}); err != nil {
		t.Fatalf("save config: %v", err)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	oldProxy := config.ProxyConfig{Enabled: true, Protocol: "http", Host: "old-proxy", Port: 3128}
	oldUpstream := config.UpstreamConfig{TimeoutSeconds: 15, UserAgent: "old-agent"}
	channelSvc := channel.NewService(nil, nil, nil, nil, nil, nil)
	channelSvc.UpdateProxyConfig(oldProxy)
	channelSvc.UpdateUpstreamConfig(oldUpstream)
	dispatcher := notify.NewDispatcherWithCooldown(nil, nil, log, notify.Policy{
		NotificationPrefix: "[old] ",
		SendMaxAttempts:    1,
	}, nil)
	dispatcher.UpdateProxyConfig(oldProxy)
	oldScheduler := scheduler.New(config.SchedulerConfig{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, oldProxy, log)
	mgr := New(
		path,
		"fallback-secret",
		log,
		dispatcher,
		channelSvc,
		nil,
		oldScheduler,
		oldProxy,
		oldUpstream,
		func(scfg config.SchedulerConfig, pcfg config.ProxyConfig) *scheduler.Scheduler {
			return scheduler.New(scfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, pcfg, log)
		},
	)

	if _, err := mgr.ApplyFromFile(); err == nil {
		t.Fatal("ApplyFromFile succeeded with an invalid scheduler cron")
	}
	if got := channelSvc.CurrentProxyConfig(); got != oldProxy {
		t.Fatalf("channel proxy changed after failed apply: %#v", got)
	}
	conn := &fakeHTTPConfigConnector{}
	channelSvc.ApplyHTTPConfig(conn)
	if conn.cfg.Timeout != 15*time.Second || conn.cfg.UserAgent != "old-agent" {
		t.Fatalf("channel upstream changed after failed apply: %#v", conn.cfg)
	}
	if got := dispatcher.CurrentProxyConfig(); got != oldProxy {
		t.Fatalf("dispatcher proxy changed after failed apply: %#v", got)
	}
	if got := dispatcher.Policy(); got.NotificationPrefix != "[old] " || got.SendMaxAttempts != 1 {
		t.Fatalf("dispatcher policy changed after failed apply: %#v", got)
	}
	if got := mgr.CurrentProxy(); got != oldProxy {
		t.Fatalf("manager proxy changed after failed apply: %#v", got)
	}
	if got := mgr.CurrentUpstream(); got != oldUpstream {
		t.Fatalf("manager upstream changed after failed apply: %#v", got)
	}
	if mgr.scheduler != oldScheduler {
		t.Fatal("manager scheduler changed after failed apply")
	}
}
