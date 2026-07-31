package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/bejix/upstream-ops/backend/connector"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

type upstreamModelPriceService interface {
	GetModelPrices(ctx context.Context, channelID uint) ([]connector.ModelPriceResult, error)
}

type upstreamModelPriceItem struct {
	ChannelID                      uint                `json:"channel_id"`
	ChannelName                    string              `json:"channel_name"`
	ChannelType                    storage.ChannelType `json:"channel_type"`
	SourceName                     string              `json:"source_name"`
	Platform                       string              `json:"platform"`
	GroupID                        int64               `json:"group_id"`
	GroupName                      string              `json:"group_name"`
	RateMultiplier                 float64             `json:"rate_multiplier"`
	PeakRateEnabled                bool                `json:"peak_rate_enabled"`
	PeakRateMultiplier             float64             `json:"peak_rate_multiplier"`
	ModelName                      string              `json:"model_name"`
	BillingMode                    string              `json:"billing_mode"`
	TierLabel                      string              `json:"tier_label"`
	MinTokens                      *int                `json:"min_tokens,omitempty"`
	MaxTokens                      *int                `json:"max_tokens,omitempty"`
	BaseInputPricePerMillion       *float64            `json:"base_input_price_per_million,omitempty"`
	BaseOutputPricePerMillion      *float64            `json:"base_output_price_per_million,omitempty"`
	BaseCacheWritePricePerMillion  *float64            `json:"base_cache_write_price_per_million,omitempty"`
	BaseCacheReadPricePerMillion   *float64            `json:"base_cache_read_price_per_million,omitempty"`
	BaseImageInputPricePerMillion  *float64            `json:"base_image_input_price_per_million,omitempty"`
	BaseImageOutputPricePerMillion *float64            `json:"base_image_output_price_per_million,omitempty"`
	InputPricePerMillion           *float64            `json:"input_price_per_million,omitempty"`
	OutputPricePerMillion          *float64            `json:"output_price_per_million,omitempty"`
	CacheWritePricePerMillion      *float64            `json:"cache_write_price_per_million,omitempty"`
	CacheReadPricePerMillion       *float64            `json:"cache_read_price_per_million,omitempty"`
	ImageInputPricePerMillion      *float64            `json:"image_input_price_per_million,omitempty"`
	ImageOutputPricePerMillion     *float64            `json:"image_output_price_per_million,omitempty"`
	BasePerRequestPrice            *float64            `json:"base_per_request_price,omitempty"`
	PerRequestPrice                *float64            `json:"per_request_price,omitempty"`
	PeakInputPricePerMillion       *float64            `json:"peak_input_price_per_million,omitempty"`
	PeakOutputPricePerMillion      *float64            `json:"peak_output_price_per_million,omitempty"`
	PeakCacheWritePricePerMillion  *float64            `json:"peak_cache_write_price_per_million,omitempty"`
	PeakCacheReadPricePerMillion   *float64            `json:"peak_cache_read_price_per_million,omitempty"`
	PeakImageInputPricePerMillion  *float64            `json:"peak_image_input_price_per_million,omitempty"`
	PeakImageOutputPricePerMillion *float64            `json:"peak_image_output_price_per_million,omitempty"`
	PeakPerRequestPrice            *float64            `json:"peak_per_request_price,omitempty"`
}

type upstreamModelPriceError struct {
	ChannelID   uint                `json:"channel_id"`
	ChannelName string              `json:"channel_name"`
	ChannelType storage.ChannelType `json:"channel_type"`
	Error       string              `json:"error"`
}

func listUpstreamModelPrices(c *gin.Context, d *Deps) {
	if d.Channels == nil || d.ChannelSvc == nil {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("channel service unavailable"))
		return
	}
	service, ok := d.ChannelSvc.(upstreamModelPriceService)
	if !ok {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("upstream model pricing unavailable"))
		return
	}

	channels, err := d.Channels.List()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	selectedID := uint(0)
	if raw := strings.TrimSpace(c.Query("channel_id")); raw != "" {
		value, parseErr := strconv.ParseUint(raw, 10, 64)
		if parseErr != nil || value == 0 || uint64(uint(value)) != value {
			fail(c, http.StatusBadRequest, fmt.Errorf("channel_id 必须是正整数"))
			return
		}
		selectedID = uint(value)
	}

	ctx := c.Request.Context()
	var wg sync.WaitGroup
	var mu sync.Mutex
	items := make([]upstreamModelPriceItem, 0)
	errorsOut := make([]upstreamModelPriceError, 0)
	semaphore := make(chan struct{}, 4)
	for i := range channels {
		channel := channels[i]
		if selectedID != 0 && channel.ID != selectedID {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			prices, priceErr := service.GetModelPrices(ctx, channel.ID)
			mu.Lock()
			defer mu.Unlock()
			if priceErr != nil {
				errorsOut = append(errorsOut, upstreamModelPriceError{
					ChannelID: channel.ID, ChannelName: channel.Name, ChannelType: channel.Type,
					Error: priceErr.Error(),
				})
				return
			}
			for _, price := range prices {
				items = append(items, expandUpstreamModelPrice(channel, price)...)
			}
		}()
	}
	wg.Wait()

	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.ChannelID != b.ChannelID {
			return a.ChannelID < b.ChannelID
		}
		if a.SourceName != b.SourceName {
			return a.SourceName < b.SourceName
		}
		if a.ModelName != b.ModelName {
			return a.ModelName < b.ModelName
		}
		if a.GroupName != b.GroupName {
			return a.GroupName < b.GroupName
		}
		return tokenFloor(a.MinTokens) < tokenFloor(b.MinTokens)
	})
	sort.Slice(errorsOut, func(i, j int) bool { return errorsOut[i].ChannelID < errorsOut[j].ChannelID })
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"items": items, "errors": errorsOut}})
}

func expandUpstreamModelPrice(channel storage.Channel, price connector.ModelPriceResult) []upstreamModelPriceItem {
	base := upstreamModelPriceItem{
		ChannelID: channel.ID, ChannelName: channel.Name, ChannelType: channel.Type,
		SourceName: price.SourceName, Platform: price.Platform,
		GroupID: price.GroupID, GroupName: price.GroupName,
		RateMultiplier:  price.RateMultiplier,
		PeakRateEnabled: price.PeakRateEnabled, PeakRateMultiplier: price.PeakRateMultiplier,
		ModelName: price.ModelName, BillingMode: price.BillingMode, TierLabel: "默认",
	}
	applyUpstreamPrices(&base, price.InputPrice, price.OutputPrice, price.CacheWritePrice, price.CacheReadPrice,
		price.ImageInputPrice, price.ImageOutputPrice, price.PerRequestPrice)
	items := []upstreamModelPriceItem{base}
	for i := range price.Intervals {
		interval := price.Intervals[i]
		item := base
		item.TierLabel = interval.TierLabel
		if item.TierLabel == "" {
			item.TierLabel = "阶梯价"
		}
		minTokens := interval.MinTokens
		item.MinTokens = &minTokens
		item.MaxTokens = interval.MaxTokens
		applyUpstreamPrices(&item, interval.InputPrice, interval.OutputPrice, interval.CacheWritePrice,
			interval.CacheReadPrice, nil, nil, interval.PerRequestPrice)
		items = append(items, item)
	}
	return items
}

func applyUpstreamPrices(item *upstreamModelPriceItem, input, output, cacheWrite, cacheRead, imageInput, imageOutput, perRequest *float64) {
	item.BaseInputPricePerMillion = scaledPrice(input, 1_000_000)
	item.BaseOutputPricePerMillion = scaledPrice(output, 1_000_000)
	item.BaseCacheWritePricePerMillion = scaledPrice(cacheWrite, 1_000_000)
	item.BaseCacheReadPricePerMillion = scaledPrice(cacheRead, 1_000_000)
	item.BaseImageInputPricePerMillion = scaledPrice(imageInput, 1_000_000)
	item.BaseImageOutputPricePerMillion = scaledPrice(imageOutput, 1_000_000)
	item.InputPricePerMillion = scaledPrice(input, item.RateMultiplier*1_000_000)
	item.OutputPricePerMillion = scaledPrice(output, item.RateMultiplier*1_000_000)
	item.CacheWritePricePerMillion = scaledPrice(cacheWrite, item.RateMultiplier*1_000_000)
	item.CacheReadPricePerMillion = scaledPrice(cacheRead, item.RateMultiplier*1_000_000)
	item.ImageInputPricePerMillion = scaledPrice(imageInput, item.RateMultiplier*1_000_000)
	item.ImageOutputPricePerMillion = scaledPrice(imageOutput, item.RateMultiplier*1_000_000)
	item.BasePerRequestPrice = scaledPrice(perRequest, 1)
	item.PerRequestPrice = scaledPrice(perRequest, item.RateMultiplier)
	if item.PeakRateEnabled && item.PeakRateMultiplier >= 0 {
		peakMultiplier := item.RateMultiplier * item.PeakRateMultiplier * 1_000_000
		item.PeakInputPricePerMillion = scaledPrice(input, peakMultiplier)
		item.PeakOutputPricePerMillion = scaledPrice(output, peakMultiplier)
		item.PeakCacheWritePricePerMillion = scaledPrice(cacheWrite, peakMultiplier)
		item.PeakCacheReadPricePerMillion = scaledPrice(cacheRead, peakMultiplier)
		item.PeakImageInputPricePerMillion = scaledPrice(imageInput, peakMultiplier)
		item.PeakImageOutputPricePerMillion = scaledPrice(imageOutput, peakMultiplier)
		item.PeakPerRequestPrice = scaledPrice(perRequest, item.RateMultiplier*item.PeakRateMultiplier)
	} else {
		item.PeakInputPricePerMillion = nil
		item.PeakOutputPricePerMillion = nil
		item.PeakCacheWritePricePerMillion = nil
		item.PeakCacheReadPricePerMillion = nil
		item.PeakImageInputPricePerMillion = nil
		item.PeakImageOutputPricePerMillion = nil
		item.PeakPerRequestPrice = nil
	}
}

func scaledPrice(value *float64, multiplier float64) *float64 {
	if value == nil {
		return nil
	}
	result := *value * multiplier
	return &result
}

func tokenFloor(value *int) int {
	if value == nil {
		return -1
	}
	return *value
}
