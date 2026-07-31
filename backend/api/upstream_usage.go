package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bejix/upstream-ops/backend/connector"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

const (
	upstreamUsageFreshFor   = 10 * time.Minute
	upstreamUsageRetryAfter = 2 * time.Minute
	upstreamUsageTimeout    = 45 * time.Second
)

var upstreamUsageRefreshes sync.Map

type upstreamUsageService interface {
	GetUsageAnalytics(ctx context.Context, channelID uint, query connector.UsageAnalyticsQuery) (*connector.UsageAnalytics, error)
}

type upstreamUsageChannel struct {
	ChannelID   uint                        `json:"channel_id"`
	ChannelName string                      `json:"channel_name"`
	ChannelType storage.ChannelType         `json:"channel_type"`
	Source      string                      `json:"source"`
	StartDate   string                      `json:"start_date"`
	EndDate     string                      `json:"end_date"`
	Granularity string                      `json:"granularity"`
	Totals      connector.UsageTotals       `json:"totals"`
	Models      []connector.UsageModelStat  `json:"models"`
	Groups      []connector.UsageGroupStat  `json:"groups,omitempty"`
	Trend       []connector.UsageTrendPoint `json:"trend,omitempty"`
	FetchedAt   *time.Time                  `json:"fetched_at,omitempty"`
	Cached      bool                        `json:"cached"`
	Stale       bool                        `json:"stale"`
	Refreshing  bool                        `json:"refreshing"`
}

type upstreamUsageError struct {
	ChannelID     uint                `json:"channel_id"`
	ChannelName   string              `json:"channel_name"`
	ChannelType   storage.ChannelType `json:"channel_type"`
	Error         string              `json:"error"`
	LastAttemptAt *time.Time          `json:"last_attempt_at,omitempty"`
	Cached        bool                `json:"cached"`
	Retrying      bool                `json:"retrying"`
	HasStaleData  bool                `json:"has_stale_data"`
}

type upstreamUsageFetchResult struct {
	item       *upstreamUsageChannel
	errItem    *upstreamUsageError
	cacheHit   bool
	liveFetch  bool
	refreshing bool
}

func listUpstreamUsageAnalytics(c *gin.Context, d *Deps) {
	if d.Channels == nil {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("channel service unavailable"))
		return
	}

	query, err := parseUpstreamUsageQuery(c)
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	selectedID, err := optionalChannelID(c.Query("channel_id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	forceRefresh, err := optionalBool(c.Query("refresh"))
	if err != nil {
		fail(c, http.StatusBadRequest, fmt.Errorf("refresh 必须是布尔值"))
		return
	}
	cacheOnly, err := optionalBool(c.Query("cache_only"))
	if err != nil {
		fail(c, http.StatusBadRequest, fmt.Errorf("cache_only 必须是布尔值"))
		return
	}
	if cacheOnly && forceRefresh {
		fail(c, http.StatusBadRequest, fmt.Errorf("cache_only 与 refresh 不能同时为 true"))
		return
	}
	var service upstreamUsageService
	if !cacheOnly {
		var ok bool
		service, ok = d.ChannelSvc.(upstreamUsageService)
		if !ok {
			fail(c, http.StatusServiceUnavailable, fmt.Errorf("upstream usage analytics unavailable"))
			return
		}
	}
	channels, err := d.Channels.List()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}

	ctx := c.Request.Context()
	var wg sync.WaitGroup
	var mu sync.Mutex
	results := make([]upstreamUsageFetchResult, 0)
	semaphore := make(chan struct{}, 4)
	matched := false
	for i := range channels {
		channel := channels[i]
		if selectedID != 0 && channel.ID != selectedID {
			continue
		}
		matched = true
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-semaphore }()

			var result upstreamUsageFetchResult
			if cacheOnly {
				result = fetchCachedUpstreamUsage(d, channel, query)
			} else {
				result = fetchUpstreamUsage(ctx, d, service, channel, query, forceRefresh)
			}
			mu.Lock()
			results = append(results, result)
			mu.Unlock()
		}()
	}
	if selectedID != 0 && !matched {
		fail(c, http.StatusNotFound, fmt.Errorf("channel not found"))
		return
	}
	wg.Wait()

	items := make([]upstreamUsageChannel, 0, len(results))
	errorsOut := make([]upstreamUsageError, 0)
	cachedChannels := 0
	liveChannels := 0
	refreshingChannels := 0
	for _, result := range results {
		if result.item != nil {
			items = append(items, *result.item)
		}
		if result.errItem != nil {
			errorsOut = append(errorsOut, *result.errItem)
		}
		if result.cacheHit {
			cachedChannels++
		}
		if result.liveFetch {
			liveChannels++
		}
		if result.refreshing {
			refreshingChannels++
		}
	}

	sort.Slice(items, func(i, j int) bool { return items[i].ChannelID < items[j].ChannelID })
	sort.Slice(errorsOut, func(i, j int) bool { return errorsOut[i].ChannelID < errorsOut[j].ChannelID })

	var totals connector.UsageTotals
	var weightedDuration float64
	for _, item := range items {
		weightedDuration += item.Totals.AverageDurationMS * float64(item.Totals.Requests)
		addUsageTotals(&totals, item.Totals)
	}
	if totals.Requests > 0 {
		totals.AverageDurationMS = weightedDuration / float64(totals.Requests)
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"source": "upstream_api", "start_date": query.StartDate, "end_date": query.EndDate,
		"totals": totals, "channels": items, "errors": errorsOut,
		"cache": gin.H{
			"persisted": d.UsageSnapshots != nil, "fresh_for_seconds": int(upstreamUsageFreshFor.Seconds()),
			"cached_channels": cachedChannels, "live_channels": liveChannels,
			"refreshing_channels": refreshingChannels, "generated_at": time.Now(),
		},
	}})
}

func fetchCachedUpstreamUsage(d *Deps, channel storage.Channel, query connector.UsageAnalyticsQuery) upstreamUsageFetchResult {
	if d.UsageSnapshots == nil {
		return upstreamUsageFetchResult{}
	}
	snapshot, err := d.UsageSnapshots.Find(channel.ID, query.StartDate, query.EndDate, query.Granularity)
	if err != nil {
		if d.Log != nil {
			d.Log.Warn("load cached upstream usage snapshot failed", "channel_id", channel.ID, "err", err)
		}
		return upstreamUsageFetchResult{}
	}
	if snapshot == nil {
		return upstreamUsageFetchResult{}
	}
	result, ok := usageResultFromSnapshot(channel, query, snapshot)
	if !ok {
		return upstreamUsageFetchResult{}
	}
	return result
}

func fetchUpstreamUsage(ctx context.Context, d *Deps, service upstreamUsageService, channel storage.Channel, query connector.UsageAnalyticsQuery, forceRefresh bool) upstreamUsageFetchResult {
	var snapshot *storage.UpstreamUsageSnapshot
	if d.UsageSnapshots != nil {
		cached, err := d.UsageSnapshots.Find(channel.ID, query.StartDate, query.EndDate, query.Granularity)
		if err != nil {
			if d.Log != nil {
				d.Log.Warn("load upstream usage snapshot failed", "channel_id", channel.ID, "err", err)
			}
		} else {
			snapshot = cached
		}
	}

	if !forceRefresh && snapshot != nil {
		result, ok := usageResultFromSnapshot(channel, query, snapshot)
		if ok {
			stale := snapshot.FetchedAt == nil || time.Since(*snapshot.FetchedAt) > upstreamUsageFreshFor
			retryDue := snapshot.LastAttemptAt.IsZero() || time.Since(snapshot.LastAttemptAt) > upstreamUsageRetryAfter
			if stale && retryDue {
				result.refreshing = startBackgroundUsageRefresh(d, service, channel, query)
				if result.item != nil {
					result.item.Refreshing = result.refreshing
				}
				if result.errItem != nil {
					result.errItem.Retrying = result.refreshing
				}
			}
			return result
		}
	}

	analytics, usageErr := service.GetUsageAnalytics(ctx, channel.ID, query)
	attemptedAt := time.Now()
	if usageErr != nil || analytics == nil {
		if usageErr == nil {
			usageErr = fmt.Errorf("upstream returned empty usage analytics")
		}
		if d.UsageSnapshots != nil {
			if err := d.UsageSnapshots.SaveFailure(channel.ID, query.StartDate, query.EndDate, query.Granularity, usageErr.Error(), attemptedAt); err != nil && d.Log != nil {
				d.Log.Warn("save upstream usage failure failed", "channel_id", channel.ID, "err", err)
			}
		}
		if snapshot != nil && snapshot.PayloadJSON != "" {
			result, ok := usageResultFromSnapshot(channel, query, snapshot)
			if ok {
				result.liveFetch = true
				result.errItem = usageError(channel, usageErr.Error(), &attemptedAt, false, false, true)
				return result
			}
		}
		return upstreamUsageFetchResult{
			errItem:   usageError(channel, usageErr.Error(), &attemptedAt, false, false, false),
			liveFetch: true,
		}
	}

	if d.UsageSnapshots != nil {
		payload, err := json.Marshal(analytics)
		if err == nil {
			err = d.UsageSnapshots.SaveSuccess(channel.ID, query.StartDate, query.EndDate, query.Granularity, string(payload), attemptedAt)
		}
		if err != nil && d.Log != nil {
			d.Log.Warn("save upstream usage snapshot failed", "channel_id", channel.ID, "err", err)
		}
	}
	return upstreamUsageFetchResult{
		item:      usageChannel(channel, analytics, &attemptedAt, false, false, false),
		liveFetch: true,
	}
}

func usageResultFromSnapshot(channel storage.Channel, query connector.UsageAnalyticsQuery, snapshot *storage.UpstreamUsageSnapshot) (upstreamUsageFetchResult, bool) {
	var result upstreamUsageFetchResult
	stale := snapshot.FetchedAt == nil || time.Since(*snapshot.FetchedAt) > upstreamUsageFreshFor
	if snapshot.PayloadJSON != "" {
		var analytics connector.UsageAnalytics
		if err := json.Unmarshal([]byte(snapshot.PayloadJSON), &analytics); err != nil {
			return upstreamUsageFetchResult{}, false
		}
		result.item = usageChannel(channel, &analytics, snapshot.FetchedAt, true, stale, false)
	}
	if snapshot.LastError != "" {
		attemptedAt := snapshot.LastAttemptAt
		result.errItem = usageError(channel, snapshot.LastError, &attemptedAt, true, false, result.item != nil)
	}
	if result.item == nil && result.errItem == nil {
		return upstreamUsageFetchResult{}, false
	}
	result.cacheHit = true
	return result, true
}

func usageChannel(channel storage.Channel, analytics *connector.UsageAnalytics, fetchedAt *time.Time, cached, stale, refreshing bool) *upstreamUsageChannel {
	return &upstreamUsageChannel{
		ChannelID: channel.ID, ChannelName: channel.Name, ChannelType: channel.Type,
		Source: analytics.Source, StartDate: analytics.StartDate, EndDate: analytics.EndDate,
		Granularity: analytics.Granularity, Totals: analytics.Totals,
		Models: analytics.Models, Groups: analytics.Groups, Trend: analytics.Trend,
		FetchedAt: fetchedAt, Cached: cached, Stale: stale, Refreshing: refreshing,
	}
}

func usageError(channel storage.Channel, message string, attemptedAt *time.Time, cached, retrying, hasStaleData bool) *upstreamUsageError {
	return &upstreamUsageError{
		ChannelID: channel.ID, ChannelName: channel.Name, ChannelType: channel.Type,
		Error: message, LastAttemptAt: attemptedAt, Cached: cached, Retrying: retrying, HasStaleData: hasStaleData,
	}
}

func startBackgroundUsageRefresh(d *Deps, service upstreamUsageService, channel storage.Channel, query connector.UsageAnalyticsQuery) bool {
	if d.UsageSnapshots == nil {
		return false
	}
	key := fmt.Sprintf("%d:%s:%s:%s", channel.ID, query.StartDate, query.EndDate, query.Granularity)
	if _, loaded := upstreamUsageRefreshes.LoadOrStore(key, struct{}{}); loaded {
		return true
	}
	go func() {
		defer upstreamUsageRefreshes.Delete(key)
		ctx, cancel := context.WithTimeout(context.Background(), upstreamUsageTimeout)
		defer cancel()
		analytics, err := service.GetUsageAnalytics(ctx, channel.ID, query)
		attemptedAt := time.Now()
		if err != nil || analytics == nil {
			if err == nil {
				err = fmt.Errorf("upstream returned empty usage analytics")
			}
			if saveErr := d.UsageSnapshots.SaveFailure(channel.ID, query.StartDate, query.EndDate, query.Granularity, err.Error(), attemptedAt); saveErr != nil && d.Log != nil {
				d.Log.Warn("save background upstream usage failure failed", "channel_id", channel.ID, "err", saveErr)
			}
			return
		}
		payload, marshalErr := json.Marshal(analytics)
		if marshalErr == nil {
			marshalErr = d.UsageSnapshots.SaveSuccess(channel.ID, query.StartDate, query.EndDate, query.Granularity, string(payload), attemptedAt)
		}
		if marshalErr != nil && d.Log != nil {
			d.Log.Warn("save background upstream usage snapshot failed", "channel_id", channel.ID, "err", marshalErr)
		}
	}()
	return true
}

func parseUpstreamUsageQuery(c *gin.Context) (connector.UsageAnalyticsQuery, error) {
	now := time.Now()
	start := strings.TrimSpace(c.Query("start_date"))
	end := strings.TrimSpace(c.Query("end_date"))
	if end == "" {
		end = now.Format("2006-01-02")
	}
	if start == "" {
		start = now.AddDate(0, 0, -6).Format("2006-01-02")
	}
	startTime, err := time.Parse("2006-01-02", start)
	if err != nil {
		return connector.UsageAnalyticsQuery{}, fmt.Errorf("start_date 必须是 YYYY-MM-DD")
	}
	endTime, err := time.Parse("2006-01-02", end)
	if err != nil {
		return connector.UsageAnalyticsQuery{}, fmt.Errorf("end_date 必须是 YYYY-MM-DD")
	}
	if startTime.After(endTime) {
		return connector.UsageAnalyticsQuery{}, fmt.Errorf("start_date 不能晚于 end_date")
	}
	if endTime.Sub(startTime) > 366*24*time.Hour {
		return connector.UsageAnalyticsQuery{}, fmt.Errorf("时间范围不能超过 366 天")
	}
	return connector.UsageAnalyticsQuery{StartDate: start, EndDate: end, Granularity: "day"}, nil
}

func optionalChannelID(raw string) (uint, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 || uint64(uint(value)) != value {
		return 0, fmt.Errorf("channel_id 必须是正整数")
	}
	return uint(value), nil
}

func optionalBool(raw string) (bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false, nil
	}
	return strconv.ParseBool(raw)
}

func addUsageTotals(dst *connector.UsageTotals, src connector.UsageTotals) {
	dst.Requests += src.Requests
	dst.InputTokens += src.InputTokens
	dst.OutputTokens += src.OutputTokens
	dst.CacheCreationTokens += src.CacheCreationTokens
	dst.CacheReadTokens += src.CacheReadTokens
	dst.TotalTokens += src.TotalTokens
	dst.ActualCost += src.ActualCost
	dst.StandardCost += src.StandardCost
}
