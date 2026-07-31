package storage

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UpstreamUsageSnapshots persists read-through cache entries for upstream billing analytics.
type UpstreamUsageSnapshots struct{ db *gorm.DB }

func NewUpstreamUsageSnapshots(db *gorm.DB) *UpstreamUsageSnapshots {
	return &UpstreamUsageSnapshots{db: db}
}

func (r *UpstreamUsageSnapshots) Find(channelID uint, startDate, endDate, granularity string) (*UpstreamUsageSnapshot, error) {
	var item UpstreamUsageSnapshot
	err := r.db.Where(
		"channel_id = ? AND start_date = ? AND end_date = ? AND granularity = ?",
		channelID, startDate, endDate, granularity,
	).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *UpstreamUsageSnapshots) SaveSuccess(channelID uint, startDate, endDate, granularity, payload string, at time.Time) error {
	item := &UpstreamUsageSnapshot{
		ChannelID: channelID, StartDate: startDate, EndDate: endDate, Granularity: granularity,
		PayloadJSON: payload, LastError: "", FetchedAt: &at, LastAttemptAt: at, UpdatedAt: at,
	}
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "channel_id"}, {Name: "start_date"}, {Name: "end_date"}, {Name: "granularity"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"payload_json", "last_error", "fetched_at", "last_attempt_at", "updated_at",
		}),
	}).Create(item).Error
}

// SaveFailure records a failed refresh while preserving the last successful payload and fetched time.
func (r *UpstreamUsageSnapshots) SaveFailure(channelID uint, startDate, endDate, granularity, message string, at time.Time) error {
	item, err := r.Find(channelID, startDate, endDate, granularity)
	if err != nil {
		return err
	}
	if item == nil {
		item = &UpstreamUsageSnapshot{
			ChannelID: channelID, StartDate: startDate, EndDate: endDate, Granularity: granularity,
			LastError: message, LastAttemptAt: at, UpdatedAt: at,
		}
		return r.db.Create(item).Error
	}
	return r.db.Model(item).Updates(map[string]any{
		"last_error": message, "last_attempt_at": at, "updated_at": at,
	}).Error
}
