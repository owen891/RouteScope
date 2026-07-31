package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/connector"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

type upstreamUsageStub struct {
	channelService
	mu    sync.Mutex
	items map[uint]*connector.UsageAnalytics
	errs  map[uint]error
	seen  map[uint]connector.UsageAnalyticsQuery
}

func (s *upstreamUsageStub) GetUsageAnalytics(_ context.Context, channelID uint, query connector.UsageAnalyticsQuery) (*connector.UsageAnalytics, error) {
	if s.seen != nil {
		s.mu.Lock()
		s.seen[channelID] = query
		s.mu.Unlock()
	}
	if err := s.errs[channelID]; err != nil {
		return nil, err
	}
	return s.items[channelID], nil
}

func TestParseUpstreamUsageQueryValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name string
		url  string
		want string
	}{
		{name: "invalid start", url: "/?start_date=bad&end_date=2026-07-29", want: "start_date"},
		{name: "invalid end", url: "/?start_date=2026-07-01&end_date=bad", want: "end_date"},
		{name: "reversed", url: "/?start_date=2026-07-30&end_date=2026-07-29", want: "不能晚于"},
		{name: "too large", url: "/?start_date=2025-01-01&end_date=2026-07-29", want: "366"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodGet, tc.url, nil)
			if _, err := parseUpstreamUsageQuery(ctx); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want containing %q", err, tc.want)
			}
		})
	}
	if _, err := optionalChannelID("0"); err == nil {
		t.Fatal("optionalChannelID(0) should fail")
	}
	if id, err := optionalChannelID("12"); err != nil || id != 12 {
		t.Fatalf("optionalChannelID = %d, %v", id, err)
	}
}

func TestListUpstreamUsageAnalyticsAggregatesChannels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	for _, ch := range []*storage.Channel{
		{Name: "Walkcoding", Type: storage.ChannelTypeSub2API, SiteURL: "https://one.example", Username: "one", PasswordCipher: "x", MonitorEnabled: true},
		{Name: "Other", Type: storage.ChannelTypeSub2API, SiteURL: "https://two.example", Username: "two", PasswordCipher: "x", MonitorEnabled: true},
		{Name: "Unsupported", Type: storage.ChannelTypeNewAPI, SiteURL: "https://three.example", Username: "three", PasswordCipher: "x", MonitorEnabled: true},
	} {
		if err := channels.Create(ch); err != nil {
			t.Fatalf("create channel: %v", err)
		}
	}
	stub := &upstreamUsageStub{
		items: map[uint]*connector.UsageAnalytics{
			1: {Source: "upstream_api", StartDate: "2026-07-28", EndDate: "2026-07-29", Granularity: "day", Totals: connector.UsageTotals{Requests: 100, TotalTokens: 1000, ActualCost: 2, StandardCost: 20, AverageDurationMS: 100}},
			2: {Source: "upstream_api", StartDate: "2026-07-28", EndDate: "2026-07-29", Granularity: "day", Totals: connector.UsageTotals{Requests: 300, TotalTokens: 9000, ActualCost: 3, StandardCost: 30, AverageDurationMS: 300}},
		},
		errs: map[uint]error{3: errors.New("connector unsupported")},
		seen: map[uint]connector.UsageAnalyticsQuery{},
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/channels/usage-analytics?start_date=2026-07-28&end_date=2026-07-29", nil)
	listUpstreamUsageAnalytics(ctx, &Deps{Channels: channels, ChannelSvc: stub})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data struct {
			Totals   connector.UsageTotals  `json:"totals"`
			Channels []upstreamUsageChannel `json:"channels"`
			Errors   []upstreamUsageError   `json:"errors"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Data.Channels) != 2 || len(body.Data.Errors) != 1 {
		t.Fatalf("response = %#v", body.Data)
	}
	if body.Data.Totals.Requests != 400 || body.Data.Totals.TotalTokens != 10000 || body.Data.Totals.ActualCost != 5 || body.Data.Totals.StandardCost != 50 {
		t.Fatalf("totals = %#v", body.Data.Totals)
	}
	if body.Data.Totals.AverageDurationMS != 250 {
		t.Fatalf("weighted average = %.2f, want 250", body.Data.Totals.AverageDurationMS)
	}
	if len(stub.seen) != 3 || stub.seen[1].StartDate != "2026-07-28" {
		t.Fatalf("seen queries = %#v", stub.seen)
	}
}

func TestListUpstreamUsageAnalyticsChannelFilterAndNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	if err := channels.Create(&storage.Channel{Name: "Walkcoding", Type: storage.ChannelTypeSub2API, SiteURL: "https://one.example", Username: "one", PasswordCipher: "x", MonitorEnabled: true}); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	stub := &upstreamUsageStub{items: map[uint]*connector.UsageAnalytics{1: {Source: "upstream_api"}}, errs: map[uint]error{}, seen: map[uint]connector.UsageAnalyticsQuery{}}

	for _, tc := range []struct {
		url  string
		code int
	}{
		{url: "/api/channels/usage-analytics?channel_id=1&start_date=2026-07-28&end_date=2026-07-29", code: http.StatusOK},
		{url: "/api/channels/usage-analytics?channel_id=99&start_date=2026-07-28&end_date=2026-07-29", code: http.StatusNotFound},
		{url: "/api/channels/usage-analytics?channel_id=nope", code: http.StatusBadRequest},
	} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, tc.url, nil)
		listUpstreamUsageAnalytics(ctx, &Deps{Channels: channels, ChannelSvc: stub})
		if recorder.Code != tc.code {
			t.Fatalf("%s status = %d body=%s", tc.url, recorder.Code, recorder.Body.String())
		}
	}
}

type upstreamUsageCountingStub struct {
	channelService
	mu        sync.Mutex
	calls     int
	analytics *connector.UsageAnalytics
}

func (s *upstreamUsageCountingStub) GetUsageAnalytics(_ context.Context, _ uint, _ connector.UsageAnalyticsQuery) (*connector.UsageAnalytics, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	return s.analytics, nil
}

func (s *upstreamUsageCountingStub) Calls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func TestListUpstreamUsageAnalyticsUsesPersistentSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	if err := channels.Create(&storage.Channel{Name: "Cached", Type: storage.ChannelTypeSub2API, SiteURL: "https://cached.example", Username: "one", PasswordCipher: "x", MonitorEnabled: true}); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	stub := &upstreamUsageCountingStub{analytics: &connector.UsageAnalytics{
		Source: "upstream_api", StartDate: "2026-07-23", EndDate: "2026-07-29", Granularity: "day",
		Totals: connector.UsageTotals{Requests: 100, TotalTokens: 1_000_000, ActualCost: 1},
	}}
	deps := &Deps{Channels: channels, UsageSnapshots: storage.NewUpstreamUsageSnapshots(db), ChannelSvc: stub}

	request := func(rawURL string) []byte {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, rawURL, nil)
		listUpstreamUsageAnalytics(ctx, deps)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d body=%s", rawURL, recorder.Code, recorder.Body.String())
		}
		return recorder.Body.Bytes()
	}

	request("/api/channels/usage-analytics?start_date=2026-07-23&end_date=2026-07-29")
	if stub.Calls() != 1 {
		t.Fatalf("first calls = %d, want 1", stub.Calls())
	}
	body := request("/api/channels/usage-analytics?start_date=2026-07-23&end_date=2026-07-29")
	if stub.Calls() != 1 {
		t.Fatalf("cached calls = %d, want 1", stub.Calls())
	}
	var decoded struct {
		Data struct {
			Cache struct {
				Persisted      bool `json:"persisted"`
				CachedChannels int  `json:"cached_channels"`
			} `json:"cache"`
			Channels []struct {
				Cached bool `json:"cached"`
			} `json:"channels"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode cached response: %v", err)
	}
	if !decoded.Data.Cache.Persisted || decoded.Data.Cache.CachedChannels != 1 || len(decoded.Data.Channels) != 1 || !decoded.Data.Channels[0].Cached {
		t.Fatalf("cached response = %#v", decoded.Data)
	}

	request("/api/channels/usage-analytics?start_date=2026-07-23&end_date=2026-07-29&refresh=true")
	if stub.Calls() != 2 {
		t.Fatalf("forced calls = %d, want 2", stub.Calls())
	}
}

func TestListUpstreamUsageAnalyticsCacheOnlyNeverCallsUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	if err := channels.Create(&storage.Channel{Name: "Cached only", Type: storage.ChannelTypeSub2API, SiteURL: "https://cached-only.example", Username: "one", PasswordCipher: "x", MonitorEnabled: true}); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	snapshots := storage.NewUpstreamUsageSnapshots(db)
	analytics := connector.UsageAnalytics{
		Source: "upstream_api", StartDate: "2026-07-25", EndDate: "2026-07-31", Granularity: "day",
		Totals: connector.UsageTotals{Requests: 12, TotalTokens: 3456, ActualCost: 0.42, AverageDurationMS: 1250},
	}
	payload, err := json.Marshal(analytics)
	if err != nil {
		t.Fatalf("marshal analytics: %v", err)
	}
	if err := snapshots.SaveSuccess(1, analytics.StartDate, analytics.EndDate, analytics.Granularity, string(payload), time.Now()); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}

	stub := &upstreamUsageCountingStub{analytics: &analytics}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/channels/usage-analytics?start_date=2026-07-25&end_date=2026-07-31&cache_only=true", nil)
	listUpstreamUsageAnalytics(ctx, &Deps{Channels: channels, UsageSnapshots: snapshots, ChannelSvc: stub})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if stub.Calls() != 0 {
		t.Fatalf("upstream calls = %d, want 0", stub.Calls())
	}
	var body struct {
		Data struct {
			Channels []upstreamUsageChannel `json:"channels"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Data.Channels) != 1 || body.Data.Channels[0].Totals.TotalTokens != 3456 {
		t.Fatalf("channels = %#v", body.Data.Channels)
	}
}

func TestListUpstreamUsageAnalyticsRejectsCacheOnlyRefresh(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/channels/usage-analytics?start_date=2026-07-25&end_date=2026-07-31&cache_only=true&refresh=true", nil)

	listUpstreamUsageAnalytics(ctx, &Deps{Channels: channels})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "不能同时") {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}
