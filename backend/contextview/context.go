// Package contextview exposes a read-only, provenance-aware view over the
// existing operational fact tables. It deliberately does not replace those
// tables with a polymorphic event store.
package contextview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
	"gorm.io/gorm"
)

const (
	ResourceChannel      = "channel"
	ResourceSyncAccount  = "sync_account"
	ResourceGatewayRoute = "gateway_route"
	ResourcePoolMember   = "pool_member"
)

type Freshness string

const (
	FreshnessFresh   Freshness = "fresh"
	FreshnessStale   Freshness = "stale"
	FreshnessExpired Freshness = "expired"
	FreshnessUnknown Freshness = "unknown"
	FreshnessMissing Freshness = "missing"
)

type Confidence string

const (
	ConfidenceHigh   Confidence = "high"
	ConfidenceMedium Confidence = "medium"
	ConfidenceLow    Confidence = "low"
	ConfidenceNone   Confidence = "none"
)

// ResourceRef is the stable cross-domain identity used by Context and
// Timeline. The key is source-scoped and remains explainable without adding a
// second identity table; future pool members use the same kind:id contract.
type ResourceRef struct {
	Kind  string `json:"kind"`
	ID    uint   `json:"id"`
	Key   string `json:"key"`
	Label string `json:"label"`
}

type ResourceLink struct {
	Relation   string      `json:"relation"`
	Resource   ResourceRef `json:"resource"`
	Source     string      `json:"source"`
	Confidence Confidence  `json:"confidence"`
}

type ContextField struct {
	Value      any        `json:"value"`
	Source     string     `json:"source"`
	SampledAt  *time.Time `json:"sampled_at,omitempty"`
	Freshness  Freshness  `json:"freshness"`
	Confidence Confidence `json:"confidence"`
	Missing    bool       `json:"missing"`
	Conflict   bool       `json:"conflict"`
	Reason     string     `json:"reason,omitempty"`
}

type ContextFields struct {
	Health   ContextField `json:"health"`
	Balance  ContextField `json:"balance"`
	Rates    ContextField `json:"rates"`
	Cost     ContextField `json:"cost"`
	TTFT     ContextField `json:"ttft"`
	Capacity ContextField `json:"capacity"`
	Incident ContextField `json:"incident"`
}

type ContextIssue struct {
	Code      string     `json:"code"`
	Severity  string     `json:"severity"`
	Message   string     `json:"message"`
	Source    string     `json:"source,omitempty"`
	SampledAt *time.Time `json:"sampled_at,omitempty"`
}

type ChannelContext struct {
	Resource    ResourceRef    `json:"resource"`
	ChannelName string         `json:"channel_name"`
	GeneratedAt time.Time      `json:"generated_at"`
	Fields      ContextFields  `json:"fields"`
	Links       []ResourceLink `json:"links"`
	Issues      []ContextIssue `json:"issues"`
}

type Overview struct {
	Items       []ChannelContext `json:"items"`
	Total       int64            `json:"total"`
	Page        int              `json:"page"`
	PageSize    int              `json:"page_size"`
	Pages       int              `json:"pages"`
	GeneratedAt time.Time        `json:"generated_at"`
}

type TimelineQuery struct {
	ResourceKind string
	ResourceID   uint
	Source       string
	Since        *time.Time
	Until        *time.Time
	Page         int
	PageSize     int
}

type TimelineEvent struct {
	ID         string       `json:"id"`
	Kind       string       `json:"kind"`
	Action     string       `json:"action"`
	Resource   *ResourceRef `json:"resource,omitempty"`
	Source     string       `json:"source"`
	Status     string       `json:"status"`
	Summary    string       `json:"summary"`
	OccurredAt time.Time    `json:"occurred_at"`
	Confidence Confidence   `json:"confidence"`
	OriginalID uint         `json:"original_id"`
}

type TimelinePage struct {
	Items    []TimelineEvent `json:"items"`
	Total    int64           `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
	Pages    int             `json:"pages"`
}

type DeleteReference struct {
	Relation string      `json:"relation"`
	Resource ResourceRef `json:"resource"`
	Source   string      `json:"source"`
	Count    int64       `json:"count"`
	Message  string      `json:"message"`
}

type DeletePreflight struct {
	Resource    ResourceRef       `json:"resource"`
	Safe        bool              `json:"safe"`
	References  []DeleteReference `json:"references"`
	GeneratedAt time.Time         `json:"generated_at"`
}

type Service struct {
	db         *gorm.DB
	now        func() time.Time
	staleAfter time.Duration
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db, now: time.Now, staleAfter: 30 * time.Minute}
}

// WithClock makes freshness and timeline tests deterministic.
func (s *Service) WithClock(now func() time.Time) *Service {
	if now != nil {
		s.now = now
	}
	return s
}

func (s *Service) Channel(ctx context.Context, id uint) (*ChannelContext, error) {
	if id == 0 {
		return nil, errors.New("channel id is required")
	}
	var channel storage.Channel
	if err := s.db.WithContext(ctx).First(&channel, id).Error; err != nil {
		return nil, err
	}
	now := s.now()
	result := &ChannelContext{
		Resource:    resource(ResourceChannel, channel.ID, channel.Name),
		ChannelName: channel.Name,
		GeneratedAt: now,
		Issues:      []ContextIssue{},
		Links:       []ResourceLink{},
	}
	result.Fields.Health = s.healthField(ctx, channel.ID, now)
	result.Fields.Balance = s.balanceField(ctx, channel, now)
	result.Fields.Rates = s.ratesField(ctx, channel.ID, now)
	result.Fields.Cost = s.costField(ctx, channel, now)
	result.Fields.TTFT = s.ttftField(ctx, channel.ID, now)
	result.Fields.Capacity = s.capacityField(ctx, channel.ID, now)
	result.Fields.Incident = s.incidentField(ctx, channel.ID, now)
	result.Links = s.links(ctx, channel.ID)
	result.Issues = contextIssues(result.Fields)
	return result, nil
}

func (s *Service) Overview(ctx context.Context, page, pageSize int) (*Overview, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	var total int64
	q := s.db.WithContext(ctx).Model(&storage.Channel{})
	if err := q.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count channels: %w", err)
	}
	var channels []storage.Channel
	if err := q.Order("sort_order DESC").Order("id ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&channels).Error; err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	channelIDs := make([]uint, 0, len(channels))
	for _, channel := range channels {
		channelIDs = append(channelIDs, channel.ID)
	}
	data := s.loadOverviewData(ctx, channelIDs)
	items := make([]ChannelContext, 0, len(channels))
	for i := range channels {
		items = append(items, s.channelFromOverviewData(channels[i], data))
	}
	pages := int((total + int64(pageSize) - 1) / int64(pageSize))
	if pages == 0 {
		pages = 1
	}
	return &Overview{Items: items, Total: total, Page: page, PageSize: pageSize, Pages: pages, GeneratedAt: s.now()}, nil
}

func (s *Service) channelFromValue(ctx context.Context, channel storage.Channel) (*ChannelContext, error) {
	// Keep the same assembly path as the detail endpoint so overview and detail
	// cannot silently disagree about freshness or link semantics.
	now := s.now()
	item := &ChannelContext{
		Resource:    resource(ResourceChannel, channel.ID, channel.Name),
		ChannelName: channel.Name,
		GeneratedAt: now,
		Issues:      []ContextIssue{},
		Links:       []ResourceLink{},
	}
	item.Fields.Health = s.healthField(ctx, channel.ID, now)
	item.Fields.Balance = s.balanceField(ctx, channel, now)
	item.Fields.Rates = s.ratesField(ctx, channel.ID, now)
	item.Fields.Cost = s.costField(ctx, channel, now)
	item.Fields.TTFT = s.ttftField(ctx, channel.ID, now)
	item.Fields.Capacity = s.capacityField(ctx, channel.ID, now)
	item.Fields.Incident = s.incidentField(ctx, channel.ID, now)
	item.Links = s.links(ctx, channel.ID)
	item.Issues = contextIssues(item.Fields)
	return item, nil
}

type overviewTTFTSample struct {
	ChannelID    uint      `gorm:"column:channel_id"`
	FirstTokenMS *int64    `gorm:"column:first_token_ms"`
	CreatedAt    time.Time `gorm:"column:created_at"`
}

type overviewRateCount struct {
	ChannelID uint  `gorm:"column:channel_id"`
	Count     int64 `gorm:"column:count"`
}

type overviewData struct {
	health              map[uint]storage.Observation
	balanceSnapshots    map[uint]storage.BalanceSnapshot
	balanceObservations map[uint]storage.Observation
	rateCounts          map[uint]int64
	latestRates         map[uint]storage.RateSnapshot
	costSnapshots       map[uint]storage.CostSnapshot
	ttftSamples         map[uint][]overviewTTFTSample
	accounts            map[uint][]storage.UpstreamSyncAccount
	routes              map[uint][]storage.GatewayRoute
	failedObservations  map[uint][]storage.Observation
	failedGatewayUsages map[uint][]storage.GatewayUsageLog
}

func newOverviewData() *overviewData {
	return &overviewData{
		health:              map[uint]storage.Observation{},
		balanceSnapshots:    map[uint]storage.BalanceSnapshot{},
		balanceObservations: map[uint]storage.Observation{},
		rateCounts:          map[uint]int64{},
		latestRates:         map[uint]storage.RateSnapshot{},
		costSnapshots:       map[uint]storage.CostSnapshot{},
		ttftSamples:         map[uint][]overviewTTFTSample{},
		accounts:            map[uint][]storage.UpstreamSyncAccount{},
		routes:              map[uint][]storage.GatewayRoute{},
		failedObservations:  map[uint][]storage.Observation{},
		failedGatewayUsages: map[uint][]storage.GatewayUsageLog{},
	}
}

// loadOverviewData keeps the overview query count bounded by data source,
// rather than multiplying it by the number of channels displayed on a page.
// Queries are intentionally independent: a failed optional fact source is
// represented as missing data, just like the channel detail endpoint.
func (s *Service) loadOverviewData(ctx context.Context, channelIDs []uint) *overviewData {
	data := newOverviewData()
	if len(channelIDs) == 0 {
		return data
	}

	var health []storage.Observation
	if s.rankedOverviewRows(ctx, &health, "observations", channelIDs, "AND t.kind = ?", "t.sampled_at DESC, t.id DESC", 1, storage.ObservationHealth) == nil {
		for _, row := range health {
			data.health[row.ChannelID] = row
		}
	}

	var balanceSnapshots []storage.BalanceSnapshot
	if s.rankedOverviewRows(ctx, &balanceSnapshots, "balance_snapshots", channelIDs, "", "t.sampled_at DESC, t.id DESC", 1) == nil {
		for _, row := range balanceSnapshots {
			data.balanceSnapshots[row.ChannelID] = row
		}
	}
	var balanceObservations []storage.Observation
	if s.rankedOverviewRows(ctx, &balanceObservations, "observations", channelIDs, "AND t.kind = ?", "t.sampled_at DESC, t.id DESC", 1, storage.ObservationBalance) == nil {
		for _, row := range balanceObservations {
			data.balanceObservations[row.ChannelID] = row
		}
	}

	var rateCounts []overviewRateCount
	if err := s.db.WithContext(ctx).Model(&storage.RateSnapshot{}).Select("channel_id, COUNT(*) AS count").Where("channel_id IN ?", channelIDs).Group("channel_id").Scan(&rateCounts).Error; err == nil {
		for _, row := range rateCounts {
			data.rateCounts[row.ChannelID] = row.Count
		}
	}
	var latestRates []storage.RateSnapshot
	if s.rankedOverviewRows(ctx, &latestRates, "rate_snapshots", channelIDs, "", "t.last_seen_at DESC, t.id DESC", 1) == nil {
		for _, row := range latestRates {
			data.latestRates[row.ChannelID] = row
		}
	}

	var costSnapshots []storage.CostSnapshot
	if s.rankedOverviewRows(ctx, &costSnapshots, "cost_snapshots", channelIDs, "", "t.sampled_at DESC, t.id DESC", 1) == nil {
		for _, row := range costSnapshots {
			data.costSnapshots[row.ChannelID] = row
		}
	}
	var ttft []overviewTTFTSample
	if s.rankedOverviewRows(ctx, &ttft, "gateway_usage_logs", channelIDs, "AND t.success = ? AND t.first_token_ms IS NOT NULL", "t.created_at DESC, t.id DESC", 500, true) == nil {
		for _, row := range ttft {
			data.ttftSamples[row.ChannelID] = append(data.ttftSamples[row.ChannelID], row)
		}
	}

	var accounts []storage.UpstreamSyncAccount
	if s.db.WithContext(ctx).Where("source_channel_id IN ?", channelIDs).Find(&accounts).Error == nil {
		for _, row := range accounts {
			data.accounts[row.SourceChannelID] = append(data.accounts[row.SourceChannelID], row)
		}
	}
	var routes []storage.GatewayRoute
	if s.db.WithContext(ctx).Where("source_channel_id IN ?", channelIDs).Find(&routes).Error == nil {
		for _, row := range routes {
			data.routes[row.SourceChannelID] = append(data.routes[row.SourceChannelID], row)
		}
	}

	cutoff := s.now().Add(-7 * 24 * time.Hour)
	var failedObservations []storage.Observation
	if s.rankedOverviewRows(ctx, &failedObservations, "observations", channelIDs, "AND t.success = ? AND t.sampled_at >= ?", "t.sampled_at DESC, t.id DESC", 20, false, cutoff) == nil {
		for _, row := range failedObservations {
			data.failedObservations[row.ChannelID] = append(data.failedObservations[row.ChannelID], row)
		}
	}
	var failedUsages []storage.GatewayUsageLog
	if s.rankedOverviewRows(ctx, &failedUsages, "gateway_usage_logs", channelIDs, "AND t.success = ? AND t.created_at >= ?", "t.created_at DESC, t.id DESC", 20, false, cutoff) == nil {
		for _, row := range failedUsages {
			data.failedGatewayUsages[row.ChannelID] = append(data.failedGatewayUsages[row.ChannelID], row)
		}
	}
	return data
}

func (s *Service) rankedOverviewRows(ctx context.Context, destination any, table string, channelIDs []uint, extraWhere, order string, perChannel int, args ...any) error {
	query := fmt.Sprintf(`SELECT * FROM (
		SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.channel_id ORDER BY %s) AS overview_rank
		FROM %s AS t
		WHERE t.channel_id IN ? %s
	) AS ranked WHERE overview_rank <= ?`, order, table, extraWhere)
	values := make([]any, 0, len(args)+2)
	values = append(values, channelIDs)
	values = append(values, args...)
	values = append(values, perChannel)
	return s.db.WithContext(ctx).Raw(query, values...).Scan(destination).Error
}

func (s *Service) channelFromOverviewData(channel storage.Channel, data *overviewData) ChannelContext {
	now := s.now()
	item := ChannelContext{
		Resource:    resource(ResourceChannel, channel.ID, channel.Name),
		ChannelName: channel.Name,
		GeneratedAt: now,
		Issues:      []ContextIssue{},
		Links:       []ResourceLink{},
	}
	item.Fields.Health = overviewHealthField(channel.ID, data, now)
	item.Fields.Balance = overviewBalanceField(channel, data, now)
	item.Fields.Rates = overviewRatesField(channel.ID, data, now)
	item.Fields.Cost = overviewCostField(channel, data, now)
	item.Fields.TTFT = overviewTTFTField(channel.ID, data, now)
	item.Fields.Capacity = overviewCapacityField(channel.ID, data, now)
	item.Fields.Incident = overviewIncidentField(channel.ID, data, now)
	item.Links = overviewLinks(channel.ID, data)
	item.Issues = contextIssues(item.Fields)
	return item
}

func overviewHealthField(channelID uint, data *overviewData, now time.Time) ContextField {
	item, ok := data.health[channelID]
	if !ok {
		return missingField("observations", "no health observation has been recorded")
	}
	status := "healthy"
	confidence := ConfidenceHigh
	if !item.Success {
		status = "unhealthy"
		confidence = ConfidenceLow
	}
	return makeField(map[string]any{"status": status, "success": item.Success, "summary": item.Summary}, "observations:"+string(item.Source), &item.SampledAt, confidence, now, item.ErrorMessage)
}

func overviewBalanceField(channel storage.Channel, data *overviewData, now time.Time) ContextField {
	snapshot, hasSnapshot := data.balanceSnapshots[channel.ID]
	if channel.LastBalance != nil {
		field := makeField(*channel.LastBalance, "channels:last_balance", channel.LastBalanceAt, ConfidenceHigh, now, "")
		if hasSnapshot && abs(*channel.LastBalance-snapshot.Balance) > 0.000001 {
			field.Conflict = true
			field.Reason = "channel aggregate and latest balance snapshot disagree"
		}
		return field
	}
	if hasSnapshot {
		return makeField(snapshot.Balance, "balance_snapshots", &snapshot.SampledAt, ConfidenceHigh, now, "")
	}
	observation, ok := data.balanceObservations[channel.ID]
	if !ok {
		return missingField("observations", "no balance observation has been recorded")
	}
	var payload struct {
		Balance *float64 `json:"balance"`
	}
	if json.Unmarshal([]byte(observation.PayloadJSON), &payload) == nil && payload.Balance != nil {
		return makeField(*payload.Balance, "observations:"+string(observation.Source), &observation.SampledAt, ConfidenceMedium, now, "fallback from observation payload")
	}
	return missingField("observations", "balance observation has no readable value")
}

func overviewRatesField(channelID uint, data *overviewData, now time.Time) ContextField {
	count := data.rateCounts[channelID]
	if count == 0 {
		return missingField("rate_snapshots", "no rate snapshot has been recorded")
	}
	latest, ok := data.latestRates[channelID]
	if !ok {
		return missingField("rate_snapshots", "latest rate snapshot unavailable")
	}
	return makeField(map[string]any{"model_count": count, "latest_model": latest.ModelName}, "rate_snapshots", &latest.LastSeenAt, ConfidenceHigh, now, "")
}

func overviewCostField(channel storage.Channel, data *overviewData, now time.Time) ContextField {
	if snapshot, ok := data.costSnapshots[channel.ID]; ok {
		return makeField(snapshot.TodayCost, "cost_snapshots", &snapshot.SampledAt, ConfidenceHigh, now, "")
	}
	if channel.TodayCost != nil {
		return makeField(*channel.TodayCost, "channels:today_cost", nil, ConfidenceMedium, now, "channel aggregate has no sample timestamp")
	}
	return missingField("cost_snapshots", "no cost snapshot has been recorded")
}

func overviewTTFTField(channelID uint, data *overviewData, now time.Time) ContextField {
	rows := data.ttftSamples[channelID]
	values := make([]int64, 0, len(rows))
	var latest time.Time
	for _, row := range rows {
		if row.FirstTokenMS != nil && *row.FirstTokenMS >= 0 {
			values = append(values, *row.FirstTokenMS)
		}
		if row.CreatedAt.After(latest) {
			latest = row.CreatedAt
		}
	}
	if len(values) == 0 {
		return missingField("gateway_usage_logs.first_token_ms", "no successful TTFT sample has been recorded")
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	confidence := ConfidenceMedium
	if len(values) >= 10 {
		confidence = ConfidenceHigh
	}
	return makeField(map[string]any{"samples": len(values), "p50_ms": percentile(values, 50), "p95_ms": percentile(values, 95)}, "gateway_usage_logs.first_token_ms", &latest, confidence, now, "derived from successful gateway requests")
}

func overviewCapacityField(channelID uint, data *overviewData, now time.Time) ContextField {
	accounts := data.accounts[channelID]
	routes := data.routes[channelID]
	value := map[string]any{
		"sync_accounts_total":    len(accounts),
		"sync_accounts_enabled":  enabledAccounts(accounts),
		"gateway_routes_total":   len(routes),
		"gateway_routes_enabled": enabledRoutes(routes),
	}
	return makeField(value, "upstream_sync_accounts;gateway_routes", latestAccountTime(accounts, routes), ConfidenceMedium, now, "derived from configured capacity")
}

func overviewIncidentField(channelID uint, data *overviewData, now time.Time) ContextField {
	items := make([]map[string]any, 0, 40)
	for _, item := range data.failedObservations[channelID] {
		items = append(items, map[string]any{"kind": string(item.Kind), "summary": firstNonEmpty(item.Summary, item.ErrorMessage), "occurred_at": item.SampledAt, "source": "observations"})
	}
	for _, item := range data.failedGatewayUsages[channelID] {
		items = append(items, map[string]any{"kind": "gateway", "summary": firstNonEmpty(item.ErrorMessage, item.ErrorType, "gateway request failed"), "occurred_at": item.CreatedAt, "source": "gateway_usage_logs"})
	}
	sort.Slice(items, func(i, j int) bool { return incidentTime(items[i]).After(incidentTime(items[j])) })
	if len(items) > 20 {
		items = items[:20]
	}
	if len(items) == 0 {
		return makeField([]map[string]any{}, "observations;gateway_usage_logs", nil, ConfidenceMedium, now, "no failed incident in the last 7 days")
	}
	latest := incidentTime(items[0])
	return makeField(items, "observations;gateway_usage_logs", &latest, ConfidenceMedium, now, "failed facts retained from authoritative sources")
}

func overviewLinks(channelID uint, data *overviewData) []ResourceLink {
	links := make([]ResourceLink, 0, len(data.accounts[channelID])+len(data.routes[channelID]))
	for _, account := range data.accounts[channelID] {
		links = append(links, ResourceLink{Relation: "sync_account", Resource: resource(ResourceSyncAccount, account.ID, account.SourceGroupName), Source: "upstream_sync_accounts.source_channel_id", Confidence: ConfidenceHigh})
	}
	for _, route := range data.routes[channelID] {
		links = append(links, ResourceLink{Relation: "gateway_route", Resource: resource(ResourceGatewayRoute, route.ID, "route "+strconv.FormatUint(uint64(route.ID), 10)), Source: "gateway_routes.source_channel_id", Confidence: ConfidenceHigh})
	}
	return links
}

func (s *Service) healthField(ctx context.Context, channelID uint, now time.Time) ContextField {
	var item storage.Observation
	err := s.db.WithContext(ctx).Where("channel_id = ? AND kind = ?", channelID, storage.ObservationHealth).
		Order("sampled_at DESC").Order("id DESC").First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return missingField("observations", "no health observation has been recorded")
	}
	if err != nil {
		return missingField("observations", "health observation unavailable")
	}
	status := "healthy"
	confidence := ConfidenceHigh
	if !item.Success {
		status = "unhealthy"
		confidence = ConfidenceLow
	}
	value := map[string]any{"status": status, "success": item.Success, "summary": item.Summary}
	return makeField(value, "observations:"+string(item.Source), &item.SampledAt, confidence, now, item.ErrorMessage)
}

func (s *Service) balanceField(ctx context.Context, channel storage.Channel, now time.Time) ContextField {
	if channel.LastBalance != nil {
		var snapshot storage.BalanceSnapshot
		err := s.db.WithContext(ctx).Where("channel_id = ?", channel.ID).Order("sampled_at DESC").Order("id DESC").First(&snapshot).Error
		field := makeField(*channel.LastBalance, "channels:last_balance", channel.LastBalanceAt, ConfidenceHigh, now, "")
		if err == nil && abs(*channel.LastBalance-snapshot.Balance) > 0.000001 {
			field.Conflict = true
			field.Reason = "channel aggregate and latest balance snapshot disagree"
		}
		return field
	}
	var snapshot storage.BalanceSnapshot
	err := s.db.WithContext(ctx).Where("channel_id = ?", channel.ID).Order("sampled_at DESC").Order("id DESC").First(&snapshot).Error
	if err == nil {
		return makeField(snapshot.Balance, "balance_snapshots", &snapshot.SampledAt, ConfidenceHigh, now, "")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return missingField("balance_snapshots", "balance snapshot unavailable")
	}
	var observation storage.Observation
	err = s.db.WithContext(ctx).Where("channel_id = ? AND kind = ?", channel.ID, storage.ObservationBalance).
		Order("sampled_at DESC").Order("id DESC").First(&observation).Error
	if err != nil {
		return missingField("observations", "no balance observation has been recorded")
	}
	var payload struct {
		Balance *float64 `json:"balance"`
	}
	if json.Unmarshal([]byte(observation.PayloadJSON), &payload) == nil && payload.Balance != nil {
		return makeField(*payload.Balance, "observations:"+string(observation.Source), &observation.SampledAt, ConfidenceMedium, now, "fallback from observation payload")
	}
	return missingField("observations", "balance observation has no readable value")
}

func (s *Service) ttftField(ctx context.Context, channelID uint, now time.Time) ContextField {
	type sample struct {
		FirstTokenMS *int64 `gorm:"column:first_token_ms"`
		CreatedAt    time.Time
	}
	var rows []sample
	if err := s.db.WithContext(ctx).Model(&storage.GatewayUsageLog{}).
		Select("first_token_ms, created_at").
		Where("channel_id = ? AND success = ? AND first_token_ms IS NOT NULL", channelID, true).
		Order("created_at DESC").Limit(500).Find(&rows).Error; err != nil {
		return missingField("gateway_usage_logs.first_token_ms", "TTFT samples unavailable")
	}
	values := make([]int64, 0, len(rows))
	var latest time.Time
	for _, row := range rows {
		if row.FirstTokenMS != nil && *row.FirstTokenMS >= 0 {
			values = append(values, *row.FirstTokenMS)
		}
		if row.CreatedAt.After(latest) {
			latest = row.CreatedAt
		}
	}
	if len(values) == 0 {
		return missingField("gateway_usage_logs.first_token_ms", "no successful TTFT sample has been recorded")
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	value := map[string]any{"samples": len(values), "p50_ms": percentile(values, 50), "p95_ms": percentile(values, 95)}
	confidence := ConfidenceMedium
	if len(values) >= 10 {
		confidence = ConfidenceHigh
	}
	return makeField(value, "gateway_usage_logs.first_token_ms", &latest, confidence, now, "derived from successful gateway requests")
}

func (s *Service) ratesField(ctx context.Context, channelID uint, now time.Time) ContextField {
	var count int64
	if err := s.db.WithContext(ctx).Model(&storage.RateSnapshot{}).Where("channel_id = ?", channelID).Count(&count).Error; err != nil {
		return missingField("rate_snapshots", "rate snapshot count unavailable")
	}
	if count == 0 {
		return missingField("rate_snapshots", "no rate snapshot has been recorded")
	}
	var latest storage.RateSnapshot
	if err := s.db.WithContext(ctx).Where("channel_id = ?", channelID).Order("last_seen_at DESC").Order("id DESC").First(&latest).Error; err != nil {
		return missingField("rate_snapshots", "latest rate snapshot unavailable")
	}
	value := map[string]any{"model_count": count, "latest_model": latest.ModelName}
	return makeField(value, "rate_snapshots", &latest.LastSeenAt, ConfidenceHigh, now, "")
}

func (s *Service) costField(ctx context.Context, channel storage.Channel, now time.Time) ContextField {
	var snapshot storage.CostSnapshot
	err := s.db.WithContext(ctx).Where("channel_id = ?", channel.ID).Order("sampled_at DESC").Order("id DESC").First(&snapshot).Error
	if err == nil {
		return makeField(snapshot.TodayCost, "cost_snapshots", &snapshot.SampledAt, ConfidenceHigh, now, "")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return missingField("cost_snapshots", "cost snapshot unavailable")
	}
	if channel.TodayCost != nil {
		return makeField(*channel.TodayCost, "channels:today_cost", nil, ConfidenceMedium, now, "channel aggregate has no sample timestamp")
	}
	return missingField("cost_snapshots", "no cost snapshot has been recorded")
}

func (s *Service) capacityField(ctx context.Context, channelID uint, now time.Time) ContextField {
	var accounts []storage.UpstreamSyncAccount
	if err := s.db.WithContext(ctx).Where("source_channel_id = ?", channelID).Find(&accounts).Error; err != nil {
		return missingField("upstream_sync_accounts", "sync account capacity unavailable")
	}
	var routes []storage.GatewayRoute
	if err := s.db.WithContext(ctx).Where("source_channel_id = ?", channelID).Find(&routes).Error; err != nil {
		return missingField("gateway_routes", "gateway route capacity unavailable")
	}
	value := map[string]any{
		"sync_accounts_total":    len(accounts),
		"sync_accounts_enabled":  enabledAccounts(accounts),
		"gateway_routes_total":   len(routes),
		"gateway_routes_enabled": enabledRoutes(routes),
	}
	latest := latestAccountTime(accounts, routes)
	return makeField(value, "upstream_sync_accounts;gateway_routes", latest, ConfidenceMedium, now, "derived from configured capacity")
}

func (s *Service) incidentField(ctx context.Context, channelID uint, now time.Time) ContextField {
	cutoff := now.Add(-7 * 24 * time.Hour)
	items := make([]map[string]any, 0)
	var observations []storage.Observation
	if err := s.db.WithContext(ctx).Where("channel_id = ? AND success = ? AND sampled_at >= ?", channelID, false, cutoff).
		Order("sampled_at DESC").Limit(20).Find(&observations).Error; err == nil {
		for _, item := range observations {
			items = append(items, map[string]any{"kind": string(item.Kind), "summary": firstNonEmpty(item.Summary, item.ErrorMessage), "occurred_at": item.SampledAt, "source": "observations"})
		}
	}
	var usage []storage.GatewayUsageLog
	if err := s.db.WithContext(ctx).Where("channel_id = ? AND success = ? AND created_at >= ?", channelID, false, cutoff).
		Order("created_at DESC").Limit(20).Find(&usage).Error; err == nil {
		for _, item := range usage {
			items = append(items, map[string]any{"kind": "gateway", "summary": firstNonEmpty(item.ErrorMessage, item.ErrorType, "gateway request failed"), "occurred_at": item.CreatedAt, "source": "gateway_usage_logs"})
		}
	}
	sort.Slice(items, func(i, j int) bool { return incidentTime(items[i]).After(incidentTime(items[j])) })
	if len(items) > 20 {
		items = items[:20]
	}
	if len(items) == 0 {
		return makeField([]map[string]any{}, "observations;gateway_usage_logs", nil, ConfidenceMedium, now, "no failed incident in the last 7 days")
	}
	latest := incidentTime(items[0])
	return makeField(items, "observations;gateway_usage_logs", &latest, ConfidenceMedium, now, "failed facts retained from authoritative sources")
}

func (s *Service) links(ctx context.Context, channelID uint) []ResourceLink {
	links := []ResourceLink{}
	var accounts []storage.UpstreamSyncAccount
	if s.db.WithContext(ctx).Where("source_channel_id = ?", channelID).Order("id ASC").Find(&accounts).Error == nil {
		for _, account := range accounts {
			links = append(links, ResourceLink{Relation: "sync_account", Resource: resource(ResourceSyncAccount, account.ID, account.SourceGroupName), Source: "upstream_sync_accounts.source_channel_id", Confidence: ConfidenceHigh})
		}
	}
	var routes []storage.GatewayRoute
	if s.db.WithContext(ctx).Where("source_channel_id = ?", channelID).Order("id ASC").Find(&routes).Error == nil {
		for _, route := range routes {
			links = append(links, ResourceLink{Relation: "gateway_route", Resource: resource(ResourceGatewayRoute, route.ID, "route "+strconv.FormatUint(uint64(route.ID), 10)), Source: "gateway_routes.source_channel_id", Confidence: ConfidenceHigh})
		}
	}
	return links
}

func (s *Service) Timeline(ctx context.Context, q TimelineQuery) (*TimelinePage, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	if q.Page > int(^uint(0)>>1)/q.PageSize {
		return nil, errors.New("timeline page is too large")
	}
	fetchLimit := q.Page * q.PageSize
	events := make([]TimelineEvent, 0)
	var total int64
	channelID, syncGroupIDs, routeIDs, err := s.timelineScope(ctx, q)
	if err != nil {
		return nil, err
	}
	if q.Source == "" || q.Source == "observation" {
		var rows []storage.Observation
		tx := s.db.WithContext(ctx).Model(&storage.Observation{})
		if channelID > 0 {
			tx = tx.Where("channel_id = ?", channelID)
		}
		if q.Since != nil {
			tx = tx.Where("sampled_at >= ?", *q.Since)
		}
		if q.Until != nil {
			tx = tx.Where("sampled_at <= ?", *q.Until)
		}
		var count int64
		if err := tx.Count(&count).Error; err != nil {
			return nil, fmt.Errorf("count observation timeline: %w", err)
		}
		total += count
		if err := tx.Order("sampled_at DESC").Order("id DESC").Limit(fetchLimit).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list observation timeline: %w", err)
		}
		for _, row := range rows {
			status := "succeeded"
			confidence := ConfidenceHigh
			summary := row.Summary
			if !row.Success {
				status = "failed"
				confidence = ConfidenceLow
				summary = firstNonEmpty(row.ErrorMessage, row.Summary, "observation failed")
			}
			ref := resource(ResourceChannel, row.ChannelID, "")
			events = append(events, TimelineEvent{ID: "observation:" + strconv.FormatUint(uint64(row.ID), 10), Kind: "observation", Action: string(row.Kind), Resource: &ref, Source: "observations:" + string(row.Source), Status: status, Summary: summary, OccurredAt: row.SampledAt, Confidence: confidence, OriginalID: row.ID})
		}
	}
	if q.Source == "" || q.Source == "route_advice" {
		var rows []storage.RouteAdviceAudit
		tx := s.db.WithContext(ctx).Model(&storage.RouteAdviceAudit{})
		if channelID > 0 {
			tx = tx.Where("channel_id = ?", channelID)
		}
		if q.Since != nil {
			tx = tx.Where("created_at >= ?", *q.Since)
		}
		if q.Until != nil {
			tx = tx.Where("created_at <= ?", *q.Until)
		}
		var count int64
		if err := tx.Count(&count).Error; err != nil {
			return nil, fmt.Errorf("count route advice timeline: %w", err)
		}
		total += count
		if err := tx.Order("created_at DESC").Order("id DESC").Limit(fetchLimit).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list route advice timeline: %w", err)
		}
		for _, row := range rows {
			ref := resource(ResourceChannel, row.ChannelID, "")
			events = append(events, TimelineEvent{ID: "route-advice:" + strconv.FormatUint(uint64(row.ID), 10), Kind: "route_advice", Action: row.Action, Resource: &ref, Source: "route_advice_audits", Status: "succeeded", Summary: "primary route decision for " + row.ModelName, OccurredAt: row.CreatedAt, Confidence: ConfidenceHigh, OriginalID: row.ID})
		}
	}
	if q.Source == "" || q.Source == "adjustment" {
		var rows []storage.AdjustmentAudit
		tx := s.db.WithContext(ctx).Model(&storage.AdjustmentAudit{})
		// AdjustmentAudit currently has no channel/account foreign key. Never
		// pretend a global adjustment belongs to a resource-scoped timeline.
		if q.ResourceKind != "" {
			tx = tx.Where("1 = 0")
		}
		if q.Since != nil {
			tx = tx.Where("created_at >= ?", *q.Since)
		}
		if q.Until != nil {
			tx = tx.Where("created_at <= ?", *q.Until)
		}
		var count int64
		if err := tx.Count(&count).Error; err != nil {
			return nil, fmt.Errorf("count adjustment timeline: %w", err)
		}
		total += count
		if err := tx.Order("created_at DESC").Order("id DESC").Limit(fetchLimit).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list adjustment timeline: %w", err)
		}
		for _, row := range rows {
			status := row.Status
			if status == "" {
				status = "info"
			}
			events = append(events, TimelineEvent{ID: "adjustment:" + strconv.FormatUint(uint64(row.ID), 10), Kind: "adjustment", Action: row.Action, Source: "adjustment_audits", Status: status, Summary: row.TargetName + " / " + row.GroupName, OccurredAt: row.CreatedAt, Confidence: ConfidenceHigh, OriginalID: row.ID})
		}
	}
	if q.Source == "" || q.Source == "sync" {
		var rows []storage.UpstreamSyncLog
		tx := s.db.WithContext(ctx).Model(&storage.UpstreamSyncLog{})
		if len(syncGroupIDs) > 0 {
			tx = tx.Where("sync_group_id IN ?", syncGroupIDs)
		} else if q.ResourceKind != "" {
			tx = tx.Where("1 = 0")
		}
		if q.Since != nil {
			tx = tx.Where("created_at >= ?", *q.Since)
		}
		if q.Until != nil {
			tx = tx.Where("created_at <= ?", *q.Until)
		}
		var count int64
		if err := tx.Count(&count).Error; err != nil {
			return nil, fmt.Errorf("count sync timeline: %w", err)
		}
		total += count
		if err := tx.Order("created_at DESC").Order("id DESC").Limit(fetchLimit).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list sync timeline: %w", err)
		}
		for _, row := range rows {
			status := "succeeded"
			confidence := ConfidenceHigh
			if !row.Success {
				status = "failed"
				confidence = ConfidenceLow
			}
			events = append(events, TimelineEvent{ID: "sync:" + strconv.FormatUint(uint64(row.ID), 10), Kind: "sync", Action: row.Action, Source: "upstream_sync_logs", Status: status, Summary: firstNonEmpty(row.Message, row.Detail, "sync action"), OccurredAt: row.CreatedAt, Confidence: confidence, OriginalID: row.ID})
		}
	}
	if q.Source == "" || q.Source == "gateway" {
		var rows []storage.GatewayUsageLog
		tx := s.db.WithContext(ctx).Model(&storage.GatewayUsageLog{})
		if channelID > 0 {
			tx = tx.Where("channel_id = ?", channelID)
		}
		if len(routeIDs) > 0 {
			tx = tx.Where("route_id IN ?", routeIDs)
		}
		if q.ResourceKind != "" && channelID == 0 && len(routeIDs) == 0 {
			tx = tx.Where("1 = 0")
		}
		if q.Since != nil {
			tx = tx.Where("created_at >= ?", *q.Since)
		}
		if q.Until != nil {
			tx = tx.Where("created_at <= ?", *q.Until)
		}
		var count int64
		if err := tx.Count(&count).Error; err != nil {
			return nil, fmt.Errorf("count gateway timeline: %w", err)
		}
		total += count
		if err := tx.Order("created_at DESC").Order("id DESC").Limit(fetchLimit).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list gateway timeline: %w", err)
		}
		for _, row := range rows {
			status := "succeeded"
			confidence := ConfidenceHigh
			summary := row.RequestedModel
			if !row.Success {
				status = "failed"
				confidence = ConfidenceLow
				summary = firstNonEmpty(row.ErrorMessage, row.ErrorType, "gateway request failed")
			}
			ref := resource(ResourceGatewayRoute, row.RouteID, "")
			events = append(events, TimelineEvent{ID: "gateway:" + strconv.FormatUint(uint64(row.ID), 10), Kind: "gateway", Action: "request", Resource: &ref, Source: "gateway_usage_logs", Status: status, Summary: summary, OccurredAt: row.CreatedAt, Confidence: confidence, OriginalID: row.ID})
		}
	}
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].OccurredAt.Equal(events[j].OccurredAt) {
			return events[i].ID > events[j].ID
		}
		return events[i].OccurredAt.After(events[j].OccurredAt)
	})
	start := (q.Page - 1) * q.PageSize
	if start > len(events) {
		start = len(events)
	}
	end := start + q.PageSize
	if end > len(events) {
		end = len(events)
	}
	items := events[start:end]
	pages := int((total + int64(q.PageSize) - 1) / int64(q.PageSize))
	if pages == 0 {
		pages = 1
	}
	return &TimelinePage{Items: items, Total: total, Page: q.Page, PageSize: q.PageSize, Pages: pages}, nil
}

func (s *Service) timelineScope(ctx context.Context, q TimelineQuery) (uint, []uint, []uint, error) {
	if q.ResourceKind == "" {
		return 0, nil, nil, nil
	}
	if q.ResourceID == 0 {
		return 0, nil, nil, errors.New("resource_id is required")
	}
	switch q.ResourceKind {
	case ResourceChannel:
		var accountIDs []uint
		if err := s.db.WithContext(ctx).Model(&storage.UpstreamSyncAccount{}).Where("source_channel_id = ?", q.ResourceID).Pluck("id", &accountIDs).Error; err != nil {
			return 0, nil, nil, err
		}
		var groupIDs []uint
		if len(accountIDs) > 0 {
			if err := s.db.WithContext(ctx).Model(&storage.UpstreamSyncAccount{}).Where("id IN ?", accountIDs).Distinct("sync_group_id").Pluck("sync_group_id", &groupIDs).Error; err != nil {
				return 0, nil, nil, err
			}
		}
		var routeIDs []uint
		if err := s.db.WithContext(ctx).Model(&storage.GatewayRoute{}).Where("source_channel_id = ?", q.ResourceID).Pluck("id", &routeIDs).Error; err != nil {
			return 0, nil, nil, err
		}
		return q.ResourceID, groupIDs, routeIDs, nil
	case ResourceSyncAccount:
		var account storage.UpstreamSyncAccount
		if err := s.db.WithContext(ctx).First(&account, q.ResourceID).Error; err != nil {
			return 0, nil, nil, err
		}
		return account.SourceChannelID, []uint{account.SyncGroupID}, nil, nil
	case ResourceGatewayRoute:
		var route storage.GatewayRoute
		if err := s.db.WithContext(ctx).First(&route, q.ResourceID).Error; err != nil {
			return 0, nil, nil, err
		}
		return route.SourceChannelID, nil, []uint{route.ID}, nil
	default:
		return 0, nil, nil, fmt.Errorf("unsupported resource kind: %s", q.ResourceKind)
	}
}

func (s *Service) DeletePreflight(ctx context.Context, kind string, id uint) (*DeletePreflight, error) {
	if id == 0 {
		return nil, errors.New("resource id is required")
	}
	var ref ResourceRef
	refs := []DeleteReference{}
	switch kind {
	case ResourceChannel:
		var channel storage.Channel
		if err := s.db.WithContext(ctx).First(&channel, id).Error; err != nil {
			return nil, err
		}
		ref = resource(kind, id, channel.Name)
		var accounts []storage.UpstreamSyncAccount
		if err := s.db.WithContext(ctx).Where("source_channel_id = ?", id).Find(&accounts).Error; err != nil {
			return nil, err
		}
		for _, account := range accounts {
			refs = append(refs, DeleteReference{Relation: "sync_account", Resource: resource(ResourceSyncAccount, account.ID, account.SourceGroupName), Source: "upstream_sync_accounts.source_channel_id", Count: 1, Message: "channel is referenced by a sync account"})
		}
		var routes []storage.GatewayRoute
		if err := s.db.WithContext(ctx).Where("source_channel_id = ?", id).Find(&routes).Error; err != nil {
			return nil, err
		}
		for _, route := range routes {
			refs = append(refs, DeleteReference{Relation: "gateway_route", Resource: resource(ResourceGatewayRoute, route.ID, "route "+strconv.FormatUint(uint64(route.ID), 10)), Source: "gateway_routes.source_channel_id", Count: 1, Message: "channel is referenced by a gateway route"})
		}
	case ResourceSyncAccount:
		var account storage.UpstreamSyncAccount
		if err := s.db.WithContext(ctx).First(&account, id).Error; err != nil {
			return nil, err
		}
		ref = resource(kind, id, account.SourceGroupName)
		var managed storage.UpstreamSyncManagedAccount
		if err := s.db.WithContext(ctx).Where("sync_account_id = ?", id).First(&managed).Error; err == nil {
			refs = append(refs, DeleteReference{Relation: "managed_account", Resource: resource("managed_account", managed.ID, managed.TargetAccountName), Source: "upstream_sync_managed_accounts.sync_account_id", Count: 1, Message: "sync account has a managed remote mapping"})
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	case ResourceGatewayRoute:
		var route storage.GatewayRoute
		if err := s.db.WithContext(ctx).First(&route, id).Error; err != nil {
			return nil, err
		}
		ref = resource(kind, id, "route "+strconv.FormatUint(uint64(id), 10))
		var count int64
		if err := s.db.WithContext(ctx).Model(&storage.GatewayUsageLog{}).Where("route_id = ?", id).Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			refs = append(refs, DeleteReference{Relation: "gateway_usage", Resource: resource("gateway_usage", id, "route usage history"), Source: "gateway_usage_logs.route_id", Count: count, Message: "usage history will lose its route association"})
		}
	case ResourcePoolMember:
		return nil, fmt.Errorf("resource kind %q is not available until Phase 12", kind)
	default:
		return nil, fmt.Errorf("unsupported resource kind: %s", kind)
	}
	return &DeletePreflight{Resource: ref, Safe: len(refs) == 0, References: refs, GeneratedAt: s.now()}, nil
}

func resource(kind string, id uint, label string) ResourceRef {
	if strings.TrimSpace(label) == "" {
		label = kind + " #" + strconv.FormatUint(uint64(id), 10)
	}
	return ResourceRef{Kind: kind, ID: id, Key: kind + ":" + strconv.FormatUint(uint64(id), 10), Label: label}
}

func makeField(value any, source string, sampledAt *time.Time, confidence Confidence, now time.Time, reason string) ContextField {
	freshness := FreshnessUnknown
	if sampledAt == nil {
		if value == nil {
			freshness = FreshnessMissing
		}
	} else {
		age := now.Sub(*sampledAt)
		switch {
		case age < 0 || age <= 30*time.Minute:
			freshness = FreshnessFresh
		case age <= 7*24*time.Hour:
			freshness = FreshnessStale
		default:
			freshness = FreshnessExpired
		}
	}
	if value == nil {
		freshness = FreshnessMissing
		confidence = ConfidenceNone
	}
	return ContextField{Value: value, Source: source, SampledAt: sampledAt, Freshness: freshness, Confidence: confidence, Missing: value == nil, Reason: reason}
}

func missingField(source, reason string) ContextField {
	return ContextField{Value: nil, Source: source, Freshness: FreshnessMissing, Confidence: ConfidenceNone, Missing: true, Reason: reason}
}

func contextIssues(fields ContextFields) []ContextIssue {
	issues := []ContextIssue{}
	for name, field := range map[string]ContextField{"health": fields.Health, "balance": fields.Balance, "rates": fields.Rates, "cost": fields.Cost, "capacity": fields.Capacity, "incident": fields.Incident} {
		if field.Missing {
			issues = append(issues, ContextIssue{Code: "missing_" + name, Severity: "warning", Message: field.Reason, Source: field.Source, SampledAt: field.SampledAt})
		}
		if field.Freshness == FreshnessStale || field.Freshness == FreshnessExpired {
			issues = append(issues, ContextIssue{Code: "stale_" + name, Severity: "warning", Message: name + " fact is not fresh", Source: field.Source, SampledAt: field.SampledAt})
		}
		if field.Confidence == ConfidenceLow {
			issues = append(issues, ContextIssue{Code: "low_confidence_" + name, Severity: "error", Message: name + " fact is based on a failed or degraded observation", Source: field.Source, SampledAt: field.SampledAt})
		}
		if field.Conflict {
			issues = append(issues, ContextIssue{Code: "conflict_" + name, Severity: "error", Message: name + " has conflicting authoritative inputs", Source: field.Source, SampledAt: field.SampledAt})
		}
	}
	if fields.TTFT.Missing {
		issues = append(issues, ContextIssue{Code: "missing_ttft", Severity: "warning", Message: fields.TTFT.Reason, Source: fields.TTFT.Source, SampledAt: fields.TTFT.SampledAt})
	}
	if fields.TTFT.Freshness == FreshnessStale || fields.TTFT.Freshness == FreshnessExpired {
		issues = append(issues, ContextIssue{Code: "stale_ttft", Severity: "warning", Message: "ttft fact is not fresh", Source: fields.TTFT.Source, SampledAt: fields.TTFT.SampledAt})
	}
	return issues
}

func enabledAccounts(list []storage.UpstreamSyncAccount) int {
	n := 0
	for _, item := range list {
		if item.Enabled {
			n++
		}
	}
	return n
}
func enabledRoutes(list []storage.GatewayRoute) int {
	n := 0
	for _, item := range list {
		if item.Enabled {
			n++
		}
	}
	return n
}
func latestAccountTime(accounts []storage.UpstreamSyncAccount, routes []storage.GatewayRoute) *time.Time {
	var latest time.Time
	for _, item := range accounts {
		if item.UpdatedAt.After(latest) {
			latest = item.UpdatedAt
		}
	}
	for _, item := range routes {
		if item.UpdatedAt.After(latest) {
			latest = item.UpdatedAt
		}
	}
	if latest.IsZero() {
		return nil
	}
	return &latest
}
func incidentTime(item map[string]any) time.Time {
	if value, ok := item["occurred_at"].(time.Time); ok {
		return value
	}
	return time.Time{}
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func percentile(values []int64, percent int) int64 {
	if len(values) == 0 {
		return 0
	}
	index := (len(values) - 1) * percent / 100
	return values[index]
}

func abs(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}
