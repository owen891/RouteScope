package contextview

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:contextview-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestChannelContextTracksSourcesAndLinks(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	balance := 12.5
	cost := 3.25
	channel := storage.Channel{Name: "primary", Type: storage.ChannelTypeNewAPI, SiteURL: "https://upstream.example", Username: "operator", PasswordCipher: "cipher", LastBalance: &balance, LastBalanceAt: ptrTime(now.Add(-5 * time.Minute)), TodayCost: &cost}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.Observation{ChannelID: channel.ID, Kind: storage.ObservationHealth, Source: storage.ObservationSourceProbe, Success: true, Summary: "ok", SampledAt: now.Add(-2 * time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.BalanceSnapshot{ChannelID: channel.ID, Balance: 10, SampledAt: now.Add(-3 * time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.RateSnapshot{ChannelID: channel.ID, ModelName: "model-a", Ratio: 1, FirstSeenAt: now.Add(-time.Hour), LastSeenAt: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.UpstreamSyncAccount{SyncGroupID: 7, SourceChannelID: channel.ID, SourceGroupName: "relay-a", Enabled: true, UpdatedAt: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.GatewayRoute{GatewayGroupID: 8, SourceChannelID: channel.ID, SourceKind: storage.GatewayRouteSourceMonitor, Enabled: true, UpdatedAt: now.Add(-2 * time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	firstToken := int64(120)
	if err := db.Create(&storage.GatewayUsageLog{RouteID: 1, ChannelID: channel.ID, RequestID: "request-1", RequestedModel: "model-a", Success: true, FirstTokenMS: &firstToken, CreatedAt: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}

	service := NewService(db).WithClock(func() time.Time { return now })
	result, err := service.Channel(context.Background(), channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Resource.Key != "channel:1" {
		t.Fatalf("unexpected channel key: %s", result.Resource.Key)
	}
	if result.Fields.Health.Freshness != FreshnessFresh || result.Fields.Health.Confidence != ConfidenceHigh {
		t.Fatalf("health provenance lost: %+v", result.Fields.Health)
	}
	if result.Fields.Balance.Value != balance || result.Fields.Balance.Source != "channels:last_balance" {
		t.Fatalf("balance source lost: %+v", result.Fields.Balance)
	}
	if !result.Fields.Balance.Conflict || result.Fields.TTFT.Missing {
		t.Fatalf("conflict or TTFT provenance lost: balance=%+v ttft=%+v", result.Fields.Balance, result.Fields.TTFT)
	}
	if result.Fields.Rates.Value == nil || result.Fields.Rates.Missing {
		t.Fatalf("rates should be present: %+v", result.Fields.Rates)
	}
	if len(result.Links) != 2 {
		t.Fatalf("expected two links, got %d", len(result.Links))
	}
	if result.Links[0].Resource.Key != "sync_account:1" || result.Links[1].Resource.Key != "gateway_route:1" {
		t.Fatalf("unexpected stable links: %+v", result.Links)
	}
}

func TestOverviewBatchesChannelFactQueries(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		balance := float64(10 + i)
		channel := storage.Channel{
			Name:           fmt.Sprintf("overview-%d", i),
			Type:           storage.ChannelTypeNewAPI,
			SiteURL:        "https://upstream.example",
			Username:       "operator",
			PasswordCipher: "cipher",
			LastBalance:    &balance,
			LastBalanceAt:  ptrTime(now.Add(-time.Minute)),
		}
		if err := db.Create(&channel).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&storage.Observation{ChannelID: channel.ID, Kind: storage.ObservationHealth, Source: storage.ObservationSourceSchedule, Success: true, Summary: "ok", SampledAt: now.Add(-time.Minute)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&storage.BalanceSnapshot{ChannelID: channel.ID, Balance: balance, SampledAt: now.Add(-time.Minute)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&storage.RateSnapshot{ChannelID: channel.ID, ModelName: "model", Ratio: 1, FirstSeenAt: now.Add(-time.Hour), LastSeenAt: now.Add(-time.Minute)}).Error; err != nil {
			t.Fatal(err)
		}
	}

	queryCount := 0
	if err := db.Callback().Query().Before("gorm:query").Register("contextview:overview-query-count", func(*gorm.DB) {
		queryCount++
	}); err != nil {
		t.Fatalf("register query counter: %v", err)
	}
	result, err := NewService(db).WithClock(func() time.Time { return now }).Overview(context.Background(), 1, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || result.Items[0].Fields.Health.Missing || result.Items[0].Fields.Rates.Missing {
		t.Fatalf("overview facts = %+v", result.Items)
	}
	if queryCount > 14 {
		t.Fatalf("overview ran %d queries for 3 channels; expected bounded source queries", queryCount)
	}
}

func TestTimelinePreservesOriginalSourcesAndFiltersByResource(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	channel := storage.Channel{Name: "timeline", Type: storage.ChannelTypeNewAPI, SiteURL: "https://upstream.example", Username: "operator", PasswordCipher: "cipher"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.Observation{ChannelID: channel.ID, Kind: storage.ObservationHealth, Source: storage.ObservationSourceManual, Success: false, ErrorMessage: "timeout", SampledAt: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.RouteAdviceAudit{ModelName: "model-a", Action: "set_primary", ChannelID: channel.ID, Operator: "admin", SnapshotJSON: "{}", CreatedAt: now.Add(-2 * time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.AdjustmentAudit{Action: "execute", TargetID: 1, TargetName: "relay", RemoteGroupID: 2, GroupName: "group", BeforeRatio: 1, AfterRatio: 1.1, Operator: "admin", InputJSON: "{}", Status: "succeeded", CreatedAt: now.Add(-3 * time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}

	service := NewService(db).WithClock(func() time.Time { return now })
	result, err := service.Timeline(context.Background(), TimelineQuery{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 || len(result.Items) != 2 {
		t.Fatalf("unexpected timeline page: %+v", result)
	}
	if result.Items[0].Source != "observations:manual" || result.Items[0].Status != "failed" {
		t.Fatalf("observation provenance lost: %+v", result.Items[0])
	}
	filtered, err := service.Timeline(context.Background(), TimelineQuery{ResourceKind: ResourceChannel, ResourceID: channel.ID, Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Total != 2 {
		t.Fatalf("expected channel-scoped timeline to exclude global adjustment, got %d", filtered.Total)
	}
}

func TestTimelinePaginatesPastPerSourceLegacyLimit(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	channel := storage.Channel{Name: "timeline-many", Type: storage.ChannelTypeNewAPI, SiteURL: "https://upstream.example", Username: "operator", PasswordCipher: "cipher"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	rows := make([]storage.Observation, 0, 205)
	for i := 0; i < 205; i++ {
		rows = append(rows, storage.Observation{
			ChannelID: channel.ID,
			Kind:      storage.ObservationHealth,
			Source:    storage.ObservationSourceSchedule,
			Success:   true,
			Summary:   fmt.Sprintf("sample-%03d", i),
			SampledAt: now.Add(-time.Duration(i) * time.Minute),
		})
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	page, err := NewService(db).Timeline(context.Background(), TimelineQuery{Source: "observation", Page: 11, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 205 || page.Pages != 11 || len(page.Items) != 5 {
		t.Fatalf("timeline page = %+v", page)
	}
	if page.Items[0].Summary != "sample-200" || page.Items[4].Summary != "sample-204" {
		t.Fatalf("unexpected final timeline events: %+v", page.Items)
	}
}

func TestDeletePreflightReportsReferences(t *testing.T) {
	db := testDB(t)
	channel := storage.Channel{Name: "referenced", Type: storage.ChannelTypeNewAPI, SiteURL: "https://upstream.example", Username: "operator", PasswordCipher: "cipher"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&storage.UpstreamSyncAccount{SyncGroupID: 3, SourceChannelID: channel.ID, SourceGroupName: "relay"}).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(db)
	result, err := service.DeletePreflight(context.Background(), ResourceChannel, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Safe || len(result.References) != 1 {
		t.Fatalf("expected blocking sync reference: %+v", result)
	}
	if result.References[0].Resource.Key != "sync_account:1" {
		t.Fatalf("unexpected reference: %+v", result.References[0])
	}
}

func ptrTime(value time.Time) *time.Time { return &value }
