package storage

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

type Observations struct{ db *gorm.DB }

func NewObservations(db *gorm.DB) *Observations { return &Observations{db: db} }

func (r *Observations) Append(o *Observation) error {
	if o == nil {
		return gorm.ErrInvalidData
	}
	if o.SampledAt.IsZero() {
		o.SampledAt = time.Now()
	}
	return r.db.Create(o).Error
}

func (r *Observations) Latest(channelID uint, kind ObservationKind) (*Observation, error) {
	var item Observation
	err := r.db.Where("channel_id = ? AND kind = ?", channelID, kind).
		Order("sampled_at DESC").Order("id DESC").First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

type ObservationQuery struct {
	ChannelID uint
	Kind      ObservationKind
	Since     *time.Time
	Until     *time.Time
	Limit     int
}

func (r *Observations) List(q ObservationQuery) ([]Observation, error) {
	if q.Limit <= 0 {
		q.Limit = 100
	}
	if q.Limit > 500 {
		q.Limit = 500
	}
	tx := r.db.Model(&Observation{}).Order("sampled_at DESC").Limit(q.Limit)
	if q.ChannelID > 0 {
		tx = tx.Where("channel_id = ?", q.ChannelID)
	}
	if q.Kind != "" {
		tx = tx.Where("kind = ?", q.Kind)
	}
	if q.Since != nil {
		tx = tx.Where("sampled_at >= ?", *q.Since)
	}
	if q.Until != nil {
		tx = tx.Where("sampled_at <= ?", *q.Until)
	}
	var list []Observation
	if err := tx.Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Observations) DeleteBefore(cutoff time.Time) (int64, error) {
	res := r.db.Where("sampled_at < ?", cutoff).Delete(&Observation{})
	return res.RowsAffected, res.Error
}
