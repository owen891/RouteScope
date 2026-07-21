package storage

import (
	"encoding/json"
	"testing"
	"time"
)

func TestObservationsAppendAndList(t *testing.T) {
	db := openTestDB(t)
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	channels := NewChannels(db)
	ch := &Channel{Name: "obs-ch", Type: ChannelTypeNewAPI, SiteURL: "https://example.com", Username: "u", PasswordCipher: "x"}
	if err := channels.Create(ch); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	obs := NewObservations(db)
	payload, _ := json.Marshal(map[string]any{"balance": 1.23})
	if err := obs.Append(&Observation{
		ChannelID:   ch.ID,
		Kind:        ObservationBalance,
		Source:      ObservationSourceManual,
		Success:     true,
		Summary:     "balance 1.23",
		PayloadJSON: string(payload),
		SampledAt:   time.Now(),
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	list, err := obs.List(ObservationQuery{ChannelID: ch.ID, Kind: ObservationBalance, Limit: 10})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Summary != "balance 1.23" {
		t.Fatalf("list = %#v", list)
	}
}

func TestHealthProbeConfigCRUD(t *testing.T) {
	db := openTestDB(t)
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	hp := NewHealthProbes(db)
	cfg := &HealthProbeConfig{Name: "probe-1", URL: "https://example.com/healthz", Enabled: true, TimeoutMS: 3000}
	if err := hp.CreateConfig(cfg); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := hp.AppendRun(&HealthProbeRun{
		ConfigID:  cfg.ID,
		URL:       cfg.URL,
		Success:   true,
		StatusCode: 200,
		LatencyMS: 12,
		StartedAt: time.Now(),
		FinishedAt: time.Now(),
	}); err != nil {
		t.Fatalf("append run: %v", err)
	}
	runs, err := hp.ListRuns(cfg.ID, 10)
	if err != nil || len(runs) != 1 || !runs[0].Success {
		t.Fatalf("runs = %#v err=%v", runs, err)
	}
}
