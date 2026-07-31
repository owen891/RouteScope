package comparison

import (
	"math"
	"sort"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

// ChannelMeta is a read-only channel label used by comparison results.
type ChannelMeta struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// RateEntry is one channel's current rate for a model/group name.
type RateEntry struct {
	ChannelID       uint       `json:"channel_id"`
	ChannelName     string     `json:"channel_name"`
	ChannelType     string     `json:"channel_type"`
	Ratio           float64    `json:"ratio"`
	CompletionRatio float64    `json:"completion_ratio"`
	LastSeenAt      time.Time  `json:"last_seen_at"`
	LastChangeAt    *time.Time `json:"last_change_at,omitempty"`
	LastOldRatio    *float64   `json:"last_old_ratio,omitempty"`
	LastNewRatio    *float64   `json:"last_new_ratio,omitempty"`
	DeviationPct    float64    `json:"deviation_pct"`
	Outlier         bool       `json:"outlier"`
}

// ModelComparison aggregates one model/group across channels.
type ModelComparison struct {
	ModelName   string      `json:"model_name"`
	Count       int         `json:"count"`
	MinRatio    float64     `json:"min_ratio"`
	MaxRatio    float64     `json:"max_ratio"`
	MedianRatio float64     `json:"median_ratio"`
	Entries     []RateEntry `json:"entries"`
}

// RatesResult is the comparison payload (export-safe, no secrets).
type RatesResult struct {
	Query        string            `json:"query,omitempty"`
	DeviationPct float64           `json:"deviation_pct"`
	GeneratedAt  time.Time         `json:"generated_at"`
	Models       []ModelComparison `json:"models"`
	ModelNames   []string          `json:"model_names"`
}

type Service struct {
	channels *storage.Channels
	rates    *storage.Rates
}

func NewService(channels *storage.Channels, rates *storage.Rates) *Service {
	return &Service{channels: channels, rates: rates}
}

// CompareRates builds cross-channel rate comparisons.
// query filters model_name by case-insensitive substring.
// deviationPct marks entries whose ratio differs from median by >= that percent (0 disables outlier flags).
func (s *Service) CompareRates(query string, deviationPct float64) (*RatesResult, error) {
	if deviationPct < 0 {
		deviationPct = 0
	}
	chs, err := s.channels.List()
	if err != nil {
		return nil, err
	}
	meta := make(map[uint]ChannelMeta, len(chs))
	for _, c := range chs {
		meta[c.ID] = ChannelMeta{ID: c.ID, Name: c.Name, Type: string(c.Type)}
	}

	// Load all current snapshots.
	type row struct {
		snap storage.RateSnapshot
		meta ChannelMeta
	}
	byModel := map[string][]row{}
	allNames := map[string]struct{}{}
	for _, c := range chs {
		snaps, err := s.rates.ListByChannel(c.ID)
		if err != nil {
			return nil, err
		}
		m := meta[c.ID]
		for _, snap := range snaps {
			name := strings.TrimSpace(snap.ModelName)
			if name == "" {
				continue
			}
			allNames[name] = struct{}{}
			byModel[name] = append(byModel[name], row{snap: snap, meta: m})
		}
	}

	// Optional recent change map: channel|model -> latest change
	changes, err := s.rates.ListChanges(0, 500)
	if err != nil {
		return nil, err
	}
	type changeKey struct {
		channelID uint
		model     string
	}
	latestChange := map[changeKey]storage.RateChangeLog{}
	for _, chg := range changes {
		k := changeKey{channelID: chg.ChannelID, model: chg.ModelName}
		if prev, ok := latestChange[k]; !ok || chg.ChangedAt.After(prev.ChangedAt) {
			latestChange[k] = chg
		}
	}

	q := strings.ToLower(strings.TrimSpace(query))
	names := make([]string, 0, len(allNames))
	for name := range allNames {
		names = append(names, name)
	}
	sort.Strings(names)

	models := make([]ModelComparison, 0)
	for _, name := range names {
		if q != "" && !strings.Contains(strings.ToLower(name), q) {
			continue
		}
		rows := byModel[name]
		if len(rows) == 0 {
			continue
		}
		ratios := make([]float64, 0, len(rows))
		for _, r := range rows {
			ratios = append(ratios, r.snap.Ratio)
		}
		minR, maxR, medR := stats(ratios)

		entries := make([]RateEntry, 0, len(rows))
		for _, r := range rows {
			dev := 0.0
			if medR != 0 {
				dev = (r.snap.Ratio - medR) / math.Abs(medR) * 100
			} else if r.snap.Ratio != 0 {
				dev = 100
			}
			outlier := deviationPct > 0 && math.Abs(dev) >= deviationPct
			entry := RateEntry{
				ChannelID:       r.meta.ID,
				ChannelName:     r.meta.Name,
				ChannelType:     r.meta.Type,
				Ratio:           r.snap.Ratio,
				CompletionRatio: r.snap.CompletionRatio,
				LastSeenAt:      r.snap.LastSeenAt,
				DeviationPct:    dev,
				Outlier:         outlier,
			}
			if chg, ok := latestChange[changeKey{channelID: r.meta.ID, model: name}]; ok {
				t := chg.ChangedAt
				entry.LastChangeAt = &t
				entry.LastOldRatio = chg.OldRatio
				nr := chg.NewRatio
				entry.LastNewRatio = &nr
			}
			entries = append(entries, entry)
		}
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Ratio == entries[j].Ratio {
				return entries[i].ChannelName < entries[j].ChannelName
			}
			return entries[i].Ratio < entries[j].Ratio
		})
		models = append(models, ModelComparison{
			ModelName:   name,
			Count:       len(entries),
			MinRatio:    minR,
			MaxRatio:    maxR,
			MedianRatio: medR,
			Entries:     entries,
		})
	}
	// Prefer models with more channels first, then name.
	sort.SliceStable(models, func(i, j int) bool {
		if models[i].Count == models[j].Count {
			return models[i].ModelName < models[j].ModelName
		}
		return models[i].Count > models[j].Count
	})

	return &RatesResult{
		Query:        strings.TrimSpace(query),
		DeviationPct: deviationPct,
		GeneratedAt:  time.Now(),
		Models:       models,
		ModelNames:   names,
	}, nil
}

func stats(values []float64) (minV, maxV, median float64) {
	if len(values) == 0 {
		return 0, 0, 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	minV, maxV = sorted[0], sorted[len(sorted)-1]
	n := len(sorted)
	if n%2 == 1 {
		median = sorted[n/2]
	} else {
		median = (sorted[n/2-1] + sorted[n/2]) / 2
	}
	return minV, maxV, median
}
