package storage

import (
	"crypto/hmac"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrFeishuBindingExists     = errors.New("feishu binding already exists")
	ErrFeishuBindingAlreadySet = errors.New("feishu account is already bound")
	ErrFeishuNoActiveCode      = errors.New("no active feishu binding code")
	ErrFeishuCodeExpired       = errors.New("feishu binding code expired")
	ErrFeishuCodeInvalid       = errors.New("feishu binding code invalid")
	ErrFeishuCodeAttemptLimit  = errors.New("feishu binding code attempt limit reached")
)

// FeishuStore 封装飞书身份绑定和回调幂等状态。
type FeishuStore struct {
	db *gorm.DB
}

func NewFeishuStore(db *gorm.DB) *FeishuStore {
	return &FeishuStore{db: db}
}

func (s *FeishuStore) Binding() (*FeishuBinding, error) {
	var binding FeishuBinding
	err := s.db.Order("id ASC").First(&binding).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find feishu binding: %w", err)
	}
	return &binding, nil
}

func (s *FeishuStore) CreateBindingCode(codeHash string, expiresAt time.Time, maxAttempts int, now time.Time) error {
	codeHash = strings.TrimSpace(codeHash)
	if codeHash == "" || maxAttempts <= 0 {
		return errors.New("invalid feishu binding code settings")
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&FeishuBinding{}).Count(&count).Error; err != nil {
			return fmt.Errorf("count feishu bindings: %w", err)
		}
		if count > 0 {
			return ErrFeishuBindingExists
		}
		if err := tx.Model(&FeishuBindingCode{}).
			Where("used_at IS NULL AND revoked_at IS NULL").
			Update("revoked_at", now).Error; err != nil {
			return fmt.Errorf("revoke previous feishu binding codes: %w", err)
		}
		if err := tx.Create(&FeishuBindingCode{
			CodeHash:    codeHash,
			ExpiresAt:   expiresAt,
			MaxAttempts: maxAttempts,
			CreatedAt:   now,
		}).Error; err != nil {
			return fmt.Errorf("create feishu binding code: %w", err)
		}
		return nil
	})
}

func (s *FeishuStore) ConsumeBindingCode(codeHash, openID string, now time.Time) error {
	codeHash = strings.TrimSpace(codeHash)
	openID = strings.TrimSpace(openID)
	if codeHash == "" || openID == "" {
		return ErrFeishuCodeInvalid
	}

	var outcome error
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var binding FeishuBinding
		err := tx.Order("id ASC").First(&binding).Error
		switch {
		case err == nil:
			if hmac.Equal([]byte(binding.OpenID), []byte(openID)) {
				outcome = ErrFeishuBindingAlreadySet
			} else {
				outcome = ErrFeishuBindingExists
			}
			return nil
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return fmt.Errorf("find feishu binding: %w", err)
		}

		var code FeishuBindingCode
		err = tx.Where("used_at IS NULL AND revoked_at IS NULL").Order("id DESC").First(&code).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			outcome = ErrFeishuNoActiveCode
			return nil
		}
		if err != nil {
			return fmt.Errorf("find active feishu binding code: %w", err)
		}
		if !now.Before(code.ExpiresAt) {
			if err := tx.Model(&code).Update("revoked_at", now).Error; err != nil {
				return fmt.Errorf("expire feishu binding code: %w", err)
			}
			outcome = ErrFeishuCodeExpired
			return nil
		}
		if code.FailedAttempts >= code.MaxAttempts {
			outcome = ErrFeishuCodeAttemptLimit
			return nil
		}
		if !hmac.Equal([]byte(code.CodeHash), []byte(codeHash)) {
			code.FailedAttempts++
			updates := map[string]any{"failed_attempts": code.FailedAttempts}
			if code.FailedAttempts >= code.MaxAttempts {
				updates["revoked_at"] = now
				outcome = ErrFeishuCodeAttemptLimit
			} else {
				outcome = ErrFeishuCodeInvalid
			}
			if err := tx.Model(&code).Updates(updates).Error; err != nil {
				return fmt.Errorf("record feishu binding failure: %w", err)
			}
			return nil
		}

		binding = FeishuBinding{ID: 1, OpenID: openID, BoundAt: now}
		if err := tx.Create(&binding).Error; err != nil {
			return fmt.Errorf("create feishu binding: %w", err)
		}
		if err := tx.Model(&code).Update("used_at", now).Error; err != nil {
			return fmt.Errorf("consume feishu binding code: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return outcome
}

func (s *FeishuStore) ClearBinding(now time.Time) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("1 = 1").Delete(&FeishuBinding{}).Error; err != nil {
			return fmt.Errorf("delete feishu binding: %w", err)
		}
		if err := tx.Model(&FeishuBindingCode{}).
			Where("used_at IS NULL AND revoked_at IS NULL").
			Update("revoked_at", now).Error; err != nil {
			return fmt.Errorf("revoke feishu binding codes: %w", err)
		}
		return nil
	})
}

func (s *FeishuStore) ClaimCallback(eventID, kind string, now time.Time) (bool, error) {
	eventID = strings.TrimSpace(eventID)
	kind = strings.TrimSpace(kind)
	if eventID == "" || kind == "" {
		return false, errors.New("feishu callback identity is empty")
	}
	receipt := &FeishuCallbackReceipt{EventID: eventID, Kind: kind, CreatedAt: now}
	result := s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(receipt)
	if result.Error != nil {
		return false, fmt.Errorf("claim feishu callback: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (s *FeishuStore) CompleteCallback(eventID, kind, outcome string, now time.Time) error {
	result := s.db.Model(&FeishuCallbackReceipt{}).
		Where("event_id = ? AND kind = ?", strings.TrimSpace(eventID), strings.TrimSpace(kind)).
		Updates(map[string]any{"outcome": strings.TrimSpace(outcome), "completed_at": now})
	if result.Error != nil {
		return fmt.Errorf("complete feishu callback: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return errors.New("feishu callback receipt not found")
	}
	return nil
}
