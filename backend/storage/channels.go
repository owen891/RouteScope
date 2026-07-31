package storage

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

// Channels 渠道仓库。
type Channels struct{ db *gorm.DB }

func NewChannels(db *gorm.DB) *Channels { return &Channels{db: db} }

// ErrChannelDeleteBlocked marks a delete that would leave live control-plane
// resources pointing at a missing upstream channel.
var ErrChannelDeleteBlocked = errors.New("channel deletion blocked by active references")

// ChannelDeleteBlockedError describes the live references that must be removed
// or reconfigured before an upstream channel can be deleted.
type ChannelDeleteBlockedError struct {
	SyncAccounts  int64
	GatewayRoutes int64
}

func (e *ChannelDeleteBlockedError) Error() string {
	return "channel deletion blocked by active references"
}

func (e *ChannelDeleteBlockedError) Unwrap() error { return ErrChannelDeleteBlocked }

func (r *Channels) Create(c *Channel) error { return r.db.Create(c).Error }
func (r *Channels) Update(c *Channel) error { return r.db.Save(c).Error }
func (r *Channels) SetFavorite(id uint, favorite bool) (*Channel, error) {
	result := r.db.Model(&Channel{}).Where("id = ?", id).Update("favorite", favorite)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return r.FindByID(id)
}
func (r *Channels) Delete(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := tx.Select("id", "name").First(&channel, id).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if channel.ID != 0 {
			var blocked ChannelDeleteBlockedError
			if err := tx.Model(&UpstreamSyncAccount{}).Where("source_channel_id = ?", id).Count(&blocked.SyncAccounts).Error; err != nil {
				return err
			}
			if err := tx.Model(&GatewayRoute{}).Where("source_channel_id = ?", id).Count(&blocked.GatewayRoutes).Error; err != nil {
				return err
			}
			if blocked.SyncAccounts > 0 || blocked.GatewayRoutes > 0 {
				return &blocked
			}
		}
		if err := tx.Where("channel_id = ?", id).Delete(&AuthSession{}).Error; err != nil {
			return err
		}
		for _, model := range []any{
			&RateSnapshot{},
			&RateChangeLog{},
			&BalanceSnapshot{},
			&CostSnapshot{},
			&UpstreamUsageSnapshot{},
			&MonitorLog{},
			&NotificationCooldown{},
			&UpstreamAnnouncement{},
			&PrimaryRoute{},
		} {
			if err := tx.Where("channel_id = ?", id).Delete(model).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("upstream_channel_id = ?", id).Delete(&NotificationLog{}).Error; err != nil {
			return err
		}
		if channel.Name != "" {
			pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(channel.Name) + "%"
			if err := tx.Where("upstream_channel_id = 0 AND (subject LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!')", pattern, pattern).
				Delete(&NotificationLog{}).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&Channel{}, id).Error
	})
}
func (r *Channels) FindByID(id uint) (*Channel, error) {
	var c Channel
	if err := r.db.First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}
func (r *Channels) List() ([]Channel, error) {
	var list []Channel
	if err := r.db.Order("sort_order DESC").Order("id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}
func (r *Channels) ListPage(page, pageSize int) ([]Channel, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 && pageSize != -1 {
		pageSize = 20
	}
	var total int64
	if err := r.db.Model(&Channel{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []Channel
	q := r.db.Order("sort_order DESC").Order("id ASC")
	if pageSize != -1 {
		q = q.Offset((page - 1) * pageSize).Limit(pageSize)
	}
	if err := q.Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}
func (r *Channels) ListMonitorEnabled() ([]Channel, error) {
	var list []Channel
	if err := r.db.Where("monitor_enabled = ?", true).Order("sort_order DESC").Order("id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}
func (r *Channels) UpdateBalance(id uint, balance float64, at any, lastErr string) error {
	return r.db.Model(&Channel{}).Where("id = ?", id).Updates(map[string]any{
		"last_balance":    balance,
		"last_balance_at": at,
		"last_error":      lastErr,
	}).Error
}

func (r *Channels) UpdateCosts(id uint, todayCost float64, totalCost float64) error {
	return r.db.Model(&Channel{}).Where("id = ?", id).Updates(map[string]any{
		"today_cost": todayCost,
		"total_cost": totalCost,
	}).Error
}
func (r *Channels) SetLastError(id uint, msg string) error {
	return r.db.Model(&Channel{}).Where("id = ?", id).Update("last_error", msg).Error
}
