package gateway

import (
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/connector"
	"github.com/bejix/upstream-ops/backend/storage"
)

var baselineScoredRoutes []ScoredRoute

func BenchmarkBaselineGatewayRouteSelection(b *testing.B) {
	const (
		routeCount   = 256
		channelCount = 8
	)
	routes := make([]storage.GatewayRoute, routeCount)
	groupsByChannel := make(map[uint][]connector.APIKeyGroup, channelCount)
	for channelIndex := 1; channelIndex <= channelCount; channelIndex++ {
		groupID := int64(channelIndex)
		groupsByChannel[uint(channelIndex)] = []connector.APIKeyGroup{{
			ID:    &groupID,
			Name:  "fixture",
			Ratio: float64(channelIndex) / 100,
		}}
	}
	for routeIndex := range routes {
		channelID := uint(routeIndex%channelCount + 1)
		groupID := int64(channelID)
		routes[routeIndex] = storage.GatewayRoute{
			ID:                    uint(routeIndex + 1),
			Position:              routeCount - routeIndex,
			SourceChannelID:       channelID,
			SourceGroupID:         &groupID,
			Weight:                routeIndex%10 + 1,
			RateConvertMode:       "raw",
			RateConvertValue:      1,
			BillingRateMultiplier: 1,
			Enabled:               true,
			SourceAPIKeyCipher:    "synthetic-fixture",
		}
	}
	fixedNow := time.Date(2026, time.July, 30, 12, 0, 0, 0, time.UTC)
	warm := SortRoutes(routes, groupsByChannel, "asc", fixedNow, nil)
	if len(warm) != routeCount {
		b.Fatalf("warm up route selection: routes=%d", len(warm))
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		baselineScoredRoutes = SortRoutes(routes, groupsByChannel, "asc", fixedNow, nil)
		if len(baselineScoredRoutes) != routeCount {
			b.Fatalf("selected routes = %d, want %d", len(baselineScoredRoutes), routeCount)
		}
	}
	b.StopTimer()
	b.ReportMetric(routeCount, "routes/op")
}
