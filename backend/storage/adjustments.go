package storage

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

type AdjustmentAudits struct{ db *gorm.DB }

func NewAdjustmentAudits(db *gorm.DB) *AdjustmentAudits { return &AdjustmentAudits{db: db} }

func (r *AdjustmentAudits) Create(item *AdjustmentAudit) error {
	return r.db.Create(item).Error
}

func (r *AdjustmentAudits) FindByID(id uint) (*AdjustmentAudit, error) {
	var item AdjustmentAudit
	if err := r.db.First(&item, id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *AdjustmentAudits) List(limit int) ([]AdjustmentAudit, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var list []AdjustmentAudit
	if err := r.db.Order("created_at DESC").Order("id DESC").Limit(limit).Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// Complete transitions a pending record exactly once. Completed audit rows are immutable.
func (r *AdjustmentAudits) Complete(id uint, status, summary, errorMessage string, completedAt time.Time) error {
	result := r.db.Model(&AdjustmentAudit{}).
		Where("id = ? AND status = ?", id, "pending").
		Updates(map[string]any{
			"status": status, "upstream_summary": summary,
			"error_message": errorMessage, "completed_at": completedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("adjustment audit is no longer pending")
	}
	return nil
}

func (r *AdjustmentAudits) SetNotificationError(id uint, message string) error {
	return r.db.Model(&AdjustmentAudit{}).Where("id = ?", id).Update("notification_error", message).Error
}
