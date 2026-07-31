// Package routeadvice ranks read-only route candidates and records operator choices.
// It never changes gateway or upstream routing automatically.
package routeadvice

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

var (
	ErrConfirmationRequired = errors.New("explicit confirmation is required")
	ErrCandidateNotFound    = errors.New("route candidate not found")
	ErrCandidateIneligible  = errors.New("route candidate is not eligible")
)

const rateFreshnessLimit = 15 * time.Minute

type Candidate struct {
	Priority         int        `json:"priority"`
	ChannelID        uint       `json:"channel_id"`
	ChannelName      string     `json:"channel_name"`
	ChannelType      string     `json:"channel_type"`
	Eligible         bool       `json:"eligible"`
	Recommended      bool       `json:"recommended"`
	CurrentPrimary   bool       `json:"current_primary"`
	Score            float64    `json:"score"`
	Ratio            float64    `json:"ratio"`
	CompletionRatio  float64    `json:"completion_ratio"`
	RateSeenAt       time.Time  `json:"rate_seen_at"`
	Balance          *float64   `json:"balance,omitempty"`
	BalanceThreshold float64    `json:"balance_threshold"`
	HealthStatus     string     `json:"health_status"`
	HealthSampledAt  *time.Time `json:"health_sampled_at,omitempty"`
	Reasons          []string   `json:"reasons"`
	Risks            []string   `json:"risks"`
}

type Result struct {
	ModelName            string                `json:"model_name"`
	GeneratedAt          time.Time             `json:"generated_at"`
	RecommendedChannelID *uint                 `json:"recommended_channel_id,omitempty"`
	CurrentPrimary       *storage.PrimaryRoute `json:"current_primary,omitempty"`
	Candidates           []Candidate           `json:"candidates"`
}

type Service struct {
	channels     *storage.Channels
	rates        *storage.Rates
	observations *storage.Observations
	store        *storage.RouteAdviceStore
	now          func() time.Time
}

func NewService(channels *storage.Channels, rates *storage.Rates, observations *storage.Observations, store *storage.RouteAdviceStore) *Service {
	return &Service{
		channels: channels, rates: rates, observations: observations, store: store, now: time.Now,
	}
}

func (s *Service) Advice(modelName string) (*Result, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil, errors.New("model is required")
	}
	now := s.now()
	channels, err := s.channels.List()
	if err != nil {
		return nil, err
	}
	channelByID := make(map[uint]storage.Channel, len(channels))
	for _, channel := range channels {
		channelByID[channel.ID] = channel
	}
	snapshots, err := s.rates.ListByModel(modelName)
	if err != nil {
		return nil, err
	}
	primary, err := s.store.FindPrimary(modelName)
	if err != nil {
		return nil, err
	}

	validRatios := make([]float64, 0, len(snapshots))
	minRatio := 0.0
	for _, snapshot := range snapshots {
		if snapshot.Ratio <= 0 {
			continue
		}
		validRatios = append(validRatios, snapshot.Ratio)
		if minRatio == 0 || snapshot.Ratio < minRatio {
			minRatio = snapshot.Ratio
		}
	}
	medianRatio := median(validRatios)
	candidates := make([]Candidate, 0, len(snapshots))
	for _, snapshot := range snapshots {
		channel, ok := channelByID[snapshot.ChannelID]
		if !ok {
			continue
		}
		candidate := Candidate{
			ChannelID:        channel.ID,
			ChannelName:      channel.Name,
			ChannelType:      string(channel.Type),
			Eligible:         true,
			Ratio:            snapshot.Ratio,
			CompletionRatio:  snapshot.CompletionRatio,
			RateSeenAt:       snapshot.LastSeenAt,
			Balance:          channel.LastBalance,
			BalanceThreshold: channel.BalanceThreshold,
			HealthStatus:     "unknown",
			Reasons:          []string{},
			Risks:            []string{},
		}
		if primary != nil && primary.ChannelID == channel.ID {
			candidate.CurrentPrimary = true
			candidate.Reasons = append(candidate.Reasons, "current_primary")
		}
		if !channel.MonitorEnabled {
			candidate.Eligible = false
			candidate.Risks = append(candidate.Risks, "monitor_disabled")
		}
		if strings.TrimSpace(channel.LastError) != "" {
			candidate.Eligible = false
			candidate.HealthStatus = "unhealthy"
			candidate.Risks = append(candidate.Risks, classifyChannelError(channel.LastError))
		} else {
			candidate.Score += 20
			candidate.Reasons = append(candidate.Reasons, "no_channel_error")
		}
		if s.observations != nil {
			latest, err := s.observations.Latest(channel.ID, storage.ObservationHealth)
			if err != nil {
				return nil, err
			}
			if latest != nil {
				t := latest.SampledAt
				candidate.HealthSampledAt = &t
				healthAge := now.Sub(latest.SampledAt)
				if healthAge >= 0 && healthAge <= 2*time.Minute {
					if latest.Success {
						candidate.HealthStatus = "healthy"
						candidate.Score += 25
						candidate.Reasons = append(candidate.Reasons, "recent_probe_healthy")
					} else {
						candidate.HealthStatus = "unhealthy"
						candidate.Eligible = false
						candidate.Risks = append(candidate.Risks, "probe_failed")
					}
				} else {
					candidate.Risks = append(candidate.Risks, "health_stale")
				}
			} else {
				candidate.Risks = append(candidate.Risks, "health_unknown")
			}
		}
		if channel.LastBalance == nil {
			candidate.Score += 3
			candidate.Risks = append(candidate.Risks, "balance_unknown")
		} else if channel.BalanceThreshold > 0 && *channel.LastBalance < channel.BalanceThreshold {
			candidate.Eligible = false
			candidate.Risks = append(candidate.Risks, "low_balance")
		} else {
			candidate.Score += 10
			candidate.Reasons = append(candidate.Reasons, "balance_safe")
		}
		if snapshot.Ratio <= 0 {
			candidate.Eligible = false
			candidate.Risks = append(candidate.Risks, "invalid_rate")
		} else {
			candidate.Score += 20 * minRatio / snapshot.Ratio
			if snapshot.Ratio <= medianRatio {
				candidate.Reasons = append(candidate.Reasons, "competitive_rate")
			} else {
				candidate.Risks = append(candidate.Risks, "above_median_rate")
			}
		}
		rateAge := now.Sub(snapshot.LastSeenAt)
		if rateAge >= 0 && rateAge <= rateFreshnessLimit {
			candidate.Score += 25
			candidate.Reasons = append(candidate.Reasons, "rate_fresh")
		} else {
			candidate.Eligible = false
			candidate.Risks = append(candidate.Risks, "rate_stale")
		}
		candidate.Score = math.Round(candidate.Score*100) / 100
		candidates = append(candidates, candidate)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Eligible != candidates[j].Eligible {
			return candidates[i].Eligible
		}
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		if candidates[i].Ratio != candidates[j].Ratio {
			return candidates[i].Ratio < candidates[j].Ratio
		}
		return candidates[i].ChannelName < candidates[j].ChannelName
	})
	var recommended *uint
	for i := range candidates {
		candidates[i].Priority = i + 1
		if recommended == nil && candidates[i].Eligible {
			candidates[i].Recommended = true
			id := candidates[i].ChannelID
			recommended = &id
		}
	}
	return &Result{
		ModelName: modelName, GeneratedAt: now, RecommendedChannelID: recommended,
		CurrentPrimary: primary, Candidates: candidates,
	}, nil
}

func (s *Service) SetPrimary(modelName string, channelID uint, operator string, confirmed bool) (*storage.PrimaryRoute, bool, error) {
	if !confirmed {
		return nil, false, ErrConfirmationRequired
	}
	result, err := s.Advice(modelName)
	if err != nil {
		return nil, false, err
	}
	for _, candidate := range result.Candidates {
		if candidate.ChannelID != channelID {
			continue
		}
		if !candidate.Eligible {
			return nil, false, ErrCandidateIneligible
		}
		snapshot, err := json.Marshal(candidate)
		if err != nil {
			return nil, false, err
		}
		return s.store.SetPrimary(result.ModelName, channelID, operator, string(snapshot), s.now())
	}
	return nil, false, ErrCandidateNotFound
}

func (s *Service) ListPrimaries() ([]storage.PrimaryRoute, error) {
	return s.store.ListPrimaries()
}

func (s *Service) ListAudits(modelName string, limit int) ([]storage.RouteAdviceAudit, error) {
	return s.store.ListAudits(modelName, limit)
}

func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[middle]
	}
	return (sorted[middle-1] + sorted[middle]) / 2
}

func classifyChannelError(message string) string {
	message = strings.ToLower(message)
	switch {
	case strings.Contains(message, "token"), strings.Contains(message, "unauthorized"),
		strings.Contains(message, "401"), strings.Contains(message, "鉴权"), strings.Contains(message, "过期"):
		return "credential_invalid"
	case strings.Contains(message, "timeout"), strings.Contains(message, "deadline"),
		strings.Contains(message, "connection"), strings.Contains(message, "network"), strings.Contains(message, "dns"):
		return "network_error"
	default:
		return "channel_error"
	}
}
