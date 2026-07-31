package comparison

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

func TestCompareRatesMedianAndOutlier(t *testing.T) {
	db, err := storage.Open(storage.DBConfig{
		Driver: storage.DBDriverSQLite,
		Path:   filepath.Join(t.TempDir(), "cmp.db"),
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	channels := storage.NewChannels(db)
	rates := storage.NewRates(db)
	now := time.Now()
	for i, name := range []string{"A", "B", "C"} {
		ch := &storage.Channel{
			Name:           name,
			Type:           storage.ChannelTypeNewAPI,
			SiteURL:        "https://example.com",
			Username:       "u",
			PasswordCipher: "x",
			MonitorEnabled: true,
		}
		if err := channels.Create(ch); err != nil {
			t.Fatalf("create channel: %v", err)
		}
		ratio := []float64{0.1, 0.2, 0.5}[i]
		if _, err := rates.Upsert(&storage.RateSnapshot{
			ChannelID:   ch.ID,
			ModelName:   "gpt-pro",
			Ratio:       ratio,
			FirstSeenAt: now,
			LastSeenAt:  now,
		}); err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}
	svc := NewService(channels, rates)
	res, err := svc.CompareRates("gpt", 50)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(res.Models) != 1 {
		t.Fatalf("models=%d", len(res.Models))
	}
	m := res.Models[0]
	if m.Count != 3 || m.MinRatio != 0.1 || m.MaxRatio != 0.5 {
		t.Fatalf("stats = %#v", m)
	}
	// median of 0.1,0.2,0.5 = 0.2
	if m.MedianRatio != 0.2 {
		t.Fatalf("median=%v", m.MedianRatio)
	}
	var outliers int
	for _, e := range m.Entries {
		if e.Outlier {
			outliers++
		}
	}
	if outliers == 0 {
		t.Fatalf("expected outliers, entries=%#v", m.Entries)
	}
}
