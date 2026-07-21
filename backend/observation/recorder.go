package observation

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

// Recorder writes normalized observation facts (OBS-01/02/03).
type Recorder struct {
	repo *storage.Observations
}

func NewRecorder(repo *storage.Observations) *Recorder {
	return &Recorder{repo: repo}
}

func (r *Recorder) enabled() bool { return r != nil && r.repo != nil }

func (r *Recorder) RecordBalance(channelID uint, source storage.ObservationSource, balance float64, sampledAt time.Time) {
	if !r.enabled() {
		return
	}
	if sampledAt.IsZero() {
		sampledAt = time.Now()
	}
	payload, _ := json.Marshal(map[string]any{"balance": balance})
	_ = r.repo.Append(&storage.Observation{
		ChannelID:   channelID,
		Kind:        storage.ObservationBalance,
		Source:      source,
		Success:     true,
		Summary:     fmt.Sprintf("balance=%.4f", balance),
		PayloadJSON: string(payload),
		SampledAt:   sampledAt,
	})
}

func (r *Recorder) RecordCost(channelID uint, source storage.ObservationSource, todayCost, totalCost float64, sampledAt time.Time) {
	if !r.enabled() {
		return
	}
	if sampledAt.IsZero() {
		sampledAt = time.Now()
	}
	payload, _ := json.Marshal(map[string]any{"today_cost": todayCost, "total_cost": totalCost})
	_ = r.repo.Append(&storage.Observation{
		ChannelID:   channelID,
		Kind:        storage.ObservationCost,
		Source:      source,
		Success:     true,
		Summary:     fmt.Sprintf("today=%.4f total=%.4f", todayCost, totalCost),
		PayloadJSON: string(payload),
		SampledAt:   sampledAt,
	})
}

func (r *Recorder) RecordRates(channelID uint, source storage.ObservationSource, count int, sampledAt time.Time) {
	if !r.enabled() {
		return
	}
	if sampledAt.IsZero() {
		sampledAt = time.Now()
	}
	payload, _ := json.Marshal(map[string]any{"group_count": count})
	_ = r.repo.Append(&storage.Observation{
		ChannelID:   channelID,
		Kind:        storage.ObservationRate,
		Source:      source,
		Success:     true,
		Summary:     fmt.Sprintf("groups=%d", count),
		PayloadJSON: string(payload),
		SampledAt:   sampledAt,
	})
}

func (r *Recorder) RecordAnnouncement(channelID uint, source storage.ObservationSource, title string, sampledAt time.Time) {
	if !r.enabled() {
		return
	}
	if sampledAt.IsZero() {
		sampledAt = time.Now()
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "announcement"
	}
	payload, _ := json.Marshal(map[string]any{"title": title})
	_ = r.repo.Append(&storage.Observation{
		ChannelID:   channelID,
		Kind:        storage.ObservationAnnouncement,
		Source:      source,
		Success:     true,
		Summary:     title,
		PayloadJSON: string(payload),
		SampledAt:   sampledAt,
	})
}

func (r *Recorder) RecordHealth(channelID uint, source storage.ObservationSource, success bool, statusCode int, latencyMS int64, errClass, errMsg string, sampledAt time.Time) {
	if !r.enabled() {
		return
	}
	if sampledAt.IsZero() {
		sampledAt = time.Now()
	}
	payload, _ := json.Marshal(map[string]any{
		"status_code": statusCode,
		"latency_ms":  latencyMS,
		"error_class": errClass,
	})
	summary := "ok"
	if !success {
		summary = "fail"
		if errClass != "" {
			summary = errClass
		}
	}
	_ = r.repo.Append(&storage.Observation{
		ChannelID:    channelID,
		Kind:         storage.ObservationHealth,
		Source:       source,
		Success:      success,
		Summary:      summary,
		PayloadJSON:  string(payload),
		ErrorClass:   errClass,
		ErrorMessage: errMsg,
		SampledAt:    sampledAt,
	})
}

func ClassifyError(err error) string {
	if err == nil {
		return ""
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "timeout"), strings.Contains(s, "deadline exceeded"):
		return "timeout"
	case strings.Contains(s, "401"), strings.Contains(s, "unauthorized"), strings.Contains(s, "refresh token"):
		return "auth"
	case strings.Contains(s, "403"), strings.Contains(s, "forbidden"):
		return "forbidden"
	case strings.Contains(s, "cloudflare"), strings.Contains(s, "captcha"), strings.Contains(s, "turnstile"):
		return "protection"
	case strings.Contains(s, "connection refused"), strings.Contains(s, "no such host"), strings.Contains(s, "network"):
		return "network"
	default:
		return "upstream_error"
	}
}
