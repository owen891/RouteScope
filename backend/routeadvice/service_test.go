package routeadvice

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

func testService(t *testing.T) (*Service, *storage.Channels, *storage.Rates, *storage.Observations) {
	t.Helper()
	db, err := storage.Open(storage.DBConfig{Driver: storage.DBDriverSQLite, Path: filepath.Join(t.TempDir(), "route.db")})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	channels := storage.NewChannels(db)
	rates := storage.NewRates(db)
	observations := storage.NewObservations(db)
	return NewService(channels, rates, observations, storage.NewRouteAdviceStore(db)), channels, rates, observations
}

func TestAdviceRanksEligibleCandidateAndExplainsRisks(t *testing.T) {
	svc, channels, rates, observations := testService(t)
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }

	create := func(name string, ratio, balance, threshold float64, lastError string) uint {
		ch := &storage.Channel{
			Name: name, Type: storage.ChannelTypeNewAPI, SiteURL: "https://example.com",
			Username: "u", PasswordCipher: "x", MonitorEnabled: true,
			LastBalance: &balance, BalanceThreshold: threshold, LastError: lastError,
		}
		if err := channels.Create(ch); err != nil {
			t.Fatalf("create channel: %v", err)
		}
		if _, err := rates.Upsert(&storage.RateSnapshot{
			ChannelID: ch.ID, ModelName: "gpt-pro", Ratio: ratio, LastSeenAt: now.Add(-time.Minute),
		}); err != nil {
			t.Fatalf("upsert rate: %v", err)
		}
		return ch.ID
	}
	healthyID := create("healthy", 0.2, 20, 5, "")
	cheapLowBalanceID := create("cheap-low-balance", 0.1, 1, 5, "")
	brokenID := create("broken", 0.3, 20, 5, "token expired")
	if err := observations.Append(&storage.Observation{
		ChannelID: healthyID, Kind: storage.ObservationHealth, Source: storage.ObservationSourceProbe,
		Success: true, SampledAt: now.Add(-time.Minute),
	}); err != nil {
		t.Fatalf("append observation: %v", err)
	}

	result, err := svc.Advice("gpt-pro")
	if err != nil {
		t.Fatalf("advice: %v", err)
	}
	if result.RecommendedChannelID == nil || *result.RecommendedChannelID != healthyID {
		t.Fatalf("recommended = %v, want %d", result.RecommendedChannelID, healthyID)
	}
	byID := map[uint]Candidate{}
	for _, candidate := range result.Candidates {
		byID[candidate.ChannelID] = candidate
	}
	if byID[cheapLowBalanceID].Eligible || !contains(byID[cheapLowBalanceID].Risks, "low_balance") {
		t.Fatalf("low balance candidate = %#v", byID[cheapLowBalanceID])
	}
	if byID[brokenID].Eligible || !contains(byID[brokenID].Risks, "credential_invalid") {
		t.Fatalf("broken candidate = %#v", byID[brokenID])
	}
}

func TestSetPrimaryRequiresConfirmationIsAuditedAndIdempotent(t *testing.T) {
	svc, channels, rates, _ := testService(t)
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	balance := 20.0
	ch := &storage.Channel{
		Name: "healthy", Type: storage.ChannelTypeNewAPI, SiteURL: "https://example.com",
		Username: "u", PasswordCipher: "x", MonitorEnabled: true, LastBalance: &balance,
	}
	if err := channels.Create(ch); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := rates.Upsert(&storage.RateSnapshot{
		ChannelID: ch.ID, ModelName: "gpt-pro", Ratio: 0.2, LastSeenAt: now,
	}); err != nil {
		t.Fatalf("upsert rate: %v", err)
	}
	if _, _, err := svc.SetPrimary("gpt-pro", ch.ID, "admin", false); !errors.Is(err, ErrConfirmationRequired) {
		t.Fatalf("confirmation error = %v", err)
	}
	primary, changed, err := svc.SetPrimary("gpt-pro", ch.ID, "admin", true)
	if err != nil || !changed || primary.ChannelID != ch.ID {
		t.Fatalf("set primary = %#v changed=%v err=%v", primary, changed, err)
	}
	_, changed, err = svc.SetPrimary("gpt-pro", ch.ID, "admin", true)
	if err != nil || changed {
		t.Fatalf("idempotent set changed=%v err=%v", changed, err)
	}
	audits, err := svc.ListAudits("gpt-pro", 10)
	if err != nil {
		t.Fatalf("list audits: %v", err)
	}
	if len(audits) != 1 || audits[0].ChannelID != ch.ID || audits[0].SnapshotJSON == "" {
		t.Fatalf("audits = %#v", audits)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
