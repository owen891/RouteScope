package storage

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

type RouteAdviceStore struct{ db *gorm.DB }

func NewRouteAdviceStore(db *gorm.DB) *RouteAdviceStore { return &RouteAdviceStore{db: db} }

func (r *RouteAdviceStore) FindPrimary(modelName string) (*PrimaryRoute, error) {
	var item PrimaryRoute
	err := r.db.Where("model_name = ?", strings.TrimSpace(modelName)).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *RouteAdviceStore) ListPrimaries() ([]PrimaryRoute, error) {
	var list []PrimaryRoute
	if err := r.db.Order("model_name ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *RouteAdviceStore) ListAudits(modelName string, limit int) ([]RouteAdviceAudit, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	q := r.db.Model(&RouteAdviceAudit{}).Order("created_at DESC").Order("id DESC").Limit(limit)
	if modelName = strings.TrimSpace(modelName); modelName != "" {
		q = q.Where("model_name = ?", modelName)
	}
	var list []RouteAdviceAudit
	if err := q.Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// SetPrimary atomically updates the primary route and appends its audit record.
// Selecting the already-current channel is idempotent and produces no duplicate audit.
func (r *RouteAdviceStore) SetPrimary(modelName string, channelID uint, operator, snapshotJSON string, now time.Time) (*PrimaryRoute, bool, error) {
	modelName = strings.TrimSpace(modelName)
	operator = strings.TrimSpace(operator)
	if operator == "" {
		operator = "admin"
	}
	if now.IsZero() {
		now = time.Now()
	}
	var result *PrimaryRoute
	changed := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var current PrimaryRoute
		err := tx.Where("model_name = ?", modelName).First(&current).Error
		if err == nil && current.ChannelID == channelID {
			copy := current
			result = &copy
			return nil
		}
		var previous *uint
		if err == nil {
			value := current.ChannelID
			previous = &value
			current.ChannelID = channelID
			current.Operator = operator
			current.SelectedAt = now
			if err := tx.Save(&current).Error; err != nil {
				return err
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			current = PrimaryRoute{
				ModelName: modelName, ChannelID: channelID, Operator: operator, SelectedAt: now,
			}
			if err := tx.Create(&current).Error; err != nil {
				return err
			}
		} else {
			return err
		}
		if err := tx.Create(&RouteAdviceAudit{
			ModelName:         modelName,
			Action:            "set_primary",
			PreviousChannelID: previous,
			ChannelID:         channelID,
			Operator:          operator,
			SnapshotJSON:      snapshotJSON,
			CreatedAt:         now,
		}).Error; err != nil {
			return err
		}
		copy := current
		result = &copy
		changed = true
		return nil
	})
	return result, changed, err
}
