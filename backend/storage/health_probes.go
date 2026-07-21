package storage

import (
	"time"

	"gorm.io/gorm"
)

type HealthProbes struct{ db *gorm.DB }

func NewHealthProbes(db *gorm.DB) *HealthProbes { return &HealthProbes{db: db} }

func (r *HealthProbes) ListConfigs() ([]HealthProbeConfig, error) {
	var list []HealthProbeConfig
	if err := r.db.Order("id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *HealthProbes) FindConfig(id uint) (*HealthProbeConfig, error) {
	var c HealthProbeConfig
	if err := r.db.First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *HealthProbes) CreateConfig(c *HealthProbeConfig) error {
	return r.db.Create(c).Error
}

func (r *HealthProbes) UpdateConfig(c *HealthProbeConfig) error {
	return r.db.Save(c).Error
}

func (r *HealthProbes) DeleteConfig(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("config_id = ?", id).Delete(&HealthProbeRun{}).Error; err != nil {
			return err
		}
		return tx.Delete(&HealthProbeConfig{}, id).Error
	})
}

func (r *HealthProbes) AppendRun(run *HealthProbeRun) error {
	if run == nil {
		return gorm.ErrInvalidData
	}
	if run.StartedAt.IsZero() {
		run.StartedAt = time.Now()
	}
	return r.db.Create(run).Error
}

func (r *HealthProbes) ListRuns(configID uint, limit int) ([]HealthProbeRun, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	tx := r.db.Order("started_at DESC").Limit(limit)
	if configID > 0 {
		tx = tx.Where("config_id = ?", configID)
	}
	var list []HealthProbeRun
	if err := tx.Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}
