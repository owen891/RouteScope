package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func BenchmarkBaselineStorageBalanceTrend(b *testing.B) {
	db, err := Open(DBConfig{
		Driver: DBDriverSQLite,
		Path:   filepath.Join(b.TempDir(), "baseline-storage.db"),
	})
	if err != nil {
		b.Fatalf("open fixture database: %v", err)
	}
	if err := AutoMigrate(db); err != nil {
		b.Fatalf("migrate fixture database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		b.Fatalf("get fixture database handle: %v", err)
	}
	b.Cleanup(func() { _ = sqlDB.Close() })

	fixedNow := time.Date(2026, time.July, 30, 12, 0, 0, 0, trendLocation)
	previousNow := trendNow
	trendNow = func() time.Time { return fixedNow }
	b.Cleanup(func() { trendNow = previousNow })

	const (
		days              = 30
		channels          = 32
		samplesPerDay     = 4
		totalSnapshotRows = days * channels * samplesPerDay
	)
	snapshots := make([]BalanceSnapshot, 0, totalSnapshotRows)
	for day := 0; day < days; day++ {
		date := fixedNow.AddDate(0, 0, -day)
		for channelID := 1; channelID <= channels; channelID++ {
			for sample := 0; sample < samplesPerDay; sample++ {
				snapshots = append(snapshots, BalanceSnapshot{
					ChannelID: uint(channelID),
					Balance:   float64(channelID*100 + day*10 + sample),
					SampledAt: time.Date(date.Year(), date.Month(), date.Day(), 3+sample*5, 0, 0, 0, trendLocation),
				})
			}
		}
	}
	if err := db.CreateInBatches(&snapshots, 256).Error; err != nil {
		b.Fatalf("seed fixture snapshots: %v", err)
	}

	rates := NewRates(db)
	warm, err := rates.AggregateBalanceTrend(days)
	if err != nil || len(warm) != days {
		b.Fatalf("warm up balance trend: rows=%d err=%v", len(warm), err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rows, err := rates.AggregateBalanceTrend(days)
		if err != nil {
			b.Fatalf("aggregate balance trend: %v", err)
		}
		if len(rows) != days {
			b.Fatalf("balance trend rows = %d, want %d", len(rows), days)
		}
	}
	b.StopTimer()
	b.ReportMetric(totalSnapshotRows, "snapshots/op")
}
