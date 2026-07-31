package api

import (
	"math"
	"testing"

	"github.com/bejix/upstream-ops/backend/connector"
	"github.com/bejix/upstream-ops/backend/storage"
)

func TestExpandUpstreamModelPrice(t *testing.T) {
	input := 3e-6
	output := 15e-6
	cacheWrite := 3.75e-6
	cacheRead := 0.3e-6
	imageInput := 4e-6
	imageOutput := 12e-6
	perRequest := 0.04
	longInput := 6e-6
	longOutput := 22.5e-6
	maxTokens := 500000
	items := expandUpstreamModelPrice(storage.Channel{
		ID: 7, Name: "上游站点", Type: storage.ChannelTypeSub2API,
	}, connector.ModelPriceResult{
		SourceName: "内部渠道", Platform: "anthropic", GroupID: 3, GroupName: "pro",
		RateMultiplier: 0.5, PeakRateEnabled: true, PeakRateMultiplier: 0.8,
		ModelName: "claude-test", BillingMode: "token",
		InputPrice: &input, OutputPrice: &output,
		CacheWritePrice: &cacheWrite, CacheReadPrice: &cacheRead,
		ImageInputPrice: &imageInput, ImageOutputPrice: &imageOutput, PerRequestPrice: &perRequest,
		Intervals: []connector.ModelPriceInterval{{
			MinTokens: 200000, MaxTokens: &maxTokens, TierLabel: "长上下文",
			InputPrice: &longInput, OutputPrice: &longOutput,
		}},
	})
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	base := items[0]
	assertPriceNear(t, "base input", base.BaseInputPricePerMillion, 3)
	assertPriceNear(t, "effective input", base.InputPricePerMillion, 1.5)
	assertPriceNear(t, "effective output", base.OutputPricePerMillion, 7.5)
	assertPriceNear(t, "effective cache write", base.CacheWritePricePerMillion, 1.875)
	assertPriceNear(t, "effective cache read", base.CacheReadPricePerMillion, 0.15)
	assertPriceNear(t, "base image input", base.BaseImageInputPricePerMillion, 4)
	assertPriceNear(t, "base image output", base.BaseImageOutputPricePerMillion, 12)
	assertPriceNear(t, "effective image input", base.ImageInputPricePerMillion, 2)
	assertPriceNear(t, "effective image output", base.ImageOutputPricePerMillion, 6)
	assertPriceNear(t, "base per request", base.BasePerRequestPrice, 0.04)
	assertPriceNear(t, "effective per request", base.PerRequestPrice, 0.02)
	assertPriceNear(t, "peak input", base.PeakInputPricePerMillion, 1.2)
	assertPriceNear(t, "peak output", base.PeakOutputPricePerMillion, 6)
	assertPriceNear(t, "peak cache write", base.PeakCacheWritePricePerMillion, 1.5)
	assertPriceNear(t, "peak cache read", base.PeakCacheReadPricePerMillion, 0.12)
	assertPriceNear(t, "peak image input", base.PeakImageInputPricePerMillion, 1.6)
	assertPriceNear(t, "peak image output", base.PeakImageOutputPricePerMillion, 4.8)
	assertPriceNear(t, "peak per request", base.PeakPerRequestPrice, 0.016)

	interval := items[1]
	if interval.TierLabel != "长上下文" || interval.MinTokens == nil || *interval.MinTokens != 200000 || interval.MaxTokens == nil || *interval.MaxTokens != 500000 {
		t.Fatalf("interval metadata = %#v", interval)
	}
	assertPriceNear(t, "interval input", interval.InputPricePerMillion, 3)
	assertPriceNear(t, "interval output", interval.OutputPricePerMillion, 11.25)
}

func TestExpandUpstreamModelPricePreservesFreePeakRate(t *testing.T) {
	input := 2e-6
	items := expandUpstreamModelPrice(storage.Channel{ID: 1}, connector.ModelPriceResult{
		RateMultiplier: 0.5, PeakRateEnabled: true, PeakRateMultiplier: 0,
		InputPrice: &input,
	})
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	assertPriceNear(t, "free peak input", items[0].PeakInputPricePerMillion, 0)
}

func assertPriceNear(t *testing.T, name string, got *float64, want float64) {
	t.Helper()
	if got == nil || math.Abs(*got-want) > 1e-9 {
		t.Fatalf("%s = %v, want %.12f", name, got, want)
	}
}
