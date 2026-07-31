package syncer

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/bejix/upstream-ops/backend/storage"
)

func BenchmarkBaselineSyncerListGroups(b *testing.B) {
	db, err := storage.Open(storage.DBConfig{
		Driver: storage.DBDriverSQLite,
		Path:   filepath.Join(b.TempDir(), "baseline-syncer.db"),
	})
	if err != nil {
		b.Fatalf("open fixture database: %v", err)
	}
	if err := storage.AutoMigrate(db); err != nil {
		b.Fatalf("migrate fixture database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		b.Fatalf("get fixture database handle: %v", err)
	}
	b.Cleanup(func() { _ = sqlDB.Close() })

	const (
		groupCount       = 64
		accountsPerGroup = 4
	)
	groups := storage.NewUpstreamSyncGroups(db)
	accounts := storage.NewUpstreamSyncAccounts(db)
	for groupIndex := 0; groupIndex < groupCount; groupIndex++ {
		group := &storage.UpstreamSyncGroup{
			DisplayName:        fmt.Sprintf("Fixture Group %03d", groupIndex),
			NameTemplate:       "fixture-{id}",
			Name:               fmt.Sprintf("fixture-%03d", groupIndex),
			TargetID:           uint(groupIndex%4 + 1),
			TargetGroupIDsJSON: fmt.Sprintf("[%d,%d]", groupIndex+1, groupIndex+101),
			Platform:           "openai",
			ModelLimitsMode:    "sync_upstream",
			RateSortDirection:  "asc",
			Enabled:            true,
		}
		if err := groups.Create(group); err != nil {
			b.Fatalf("seed sync group %d: %v", groupIndex, err)
		}
		items := make([]storage.UpstreamSyncAccount, accountsPerGroup)
		for accountIndex := range items {
			sourceGroupID := int64(groupIndex*accountsPerGroup + accountIndex + 1)
			items[accountIndex] = storage.UpstreamSyncAccount{
				SourceChannelID:  uint(accountIndex + 1),
				SourceGroupID:    &sourceGroupID,
				SourceGroupName:  fmt.Sprintf("source-%03d", sourceGroupID),
				Concurrency:      10,
				Weight:           accountIndex + 1,
				RateConvertMode:  "raw",
				RateConvertValue: 1,
				Enabled:          true,
			}
		}
		if err := accounts.SaveForGroup(group.ID, items); err != nil {
			b.Fatalf("seed sync accounts for group %d: %v", groupIndex, err)
		}
	}

	service := New(nil, nil, nil, nil, nil, nil, nil, groups, accounts, nil, nil)
	warm, err := service.ListSyncGroups()
	if err != nil || len(warm) != groupCount {
		b.Fatalf("warm up sync group list: groups=%d err=%v", len(warm), err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		list, err := service.ListSyncGroups()
		if err != nil {
			b.Fatalf("list sync groups: %v", err)
		}
		if len(list) != groupCount {
			b.Fatalf("sync groups = %d, want %d", len(list), groupCount)
		}
	}
	b.StopTimer()
	b.ReportMetric(groupCount, "groups/op")
	b.ReportMetric(groupCount*accountsPerGroup, "accounts/op")
}
