// Package adjustment provides confirmed, audited Sub2API group-ratio changes.
package adjustment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/bejix/upstream-ops/backend/connector/sub2api"
	"github.com/bejix/upstream-ops/backend/crypto"
	"github.com/bejix/upstream-ops/backend/notify"
	"github.com/bejix/upstream-ops/backend/storage"
)

var (
	ErrConfirmationRequired = errors.New("explicit confirmation is required")
	ErrInvalidInput         = errors.New("invalid adjustment input")
	ErrRatioDrift           = errors.New("remote ratio changed after preview")
	ErrGroupDrift           = errors.New("remote group identity changed after preview")
	ErrNotRollbackable      = errors.New("adjustment is not rollbackable")
)

const ratioEpsilon = 0.000000001

var secretAssignmentPattern = regexp.MustCompile(`(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret)(["']?\s*[:=]\s*["']?)([^"',\s}\]]+)`)
var bearerPattern = regexp.MustCompile(`(?i)bearer\s+[a-z0-9._~+/=-]+`)

type adminClient interface {
	GetGroup(context.Context, sub2api.AdminTarget, int64) (*sub2api.AdminGroup, error)
	UpdateGroupRatio(context.Context, sub2api.AdminTarget, int64, float64) (*sub2api.AdminGroup, bool, error)
}

type dispatcher interface {
	Dispatch(context.Context, notify.Message) error
}

type PreviewInput struct {
	TargetID      uint    `json:"target_id"`
	RemoteGroupID int64   `json:"remote_group_id"`
	NewRatio      float64 `json:"new_ratio"`
}

type ExecuteInput struct {
	TargetID             uint    `json:"target_id"`
	RemoteGroupID        int64   `json:"remote_group_id"`
	ExpectedGroupName    string  `json:"expected_group_name"`
	ExpectedCurrentRatio float64 `json:"expected_current_ratio"`
	NewRatio             float64 `json:"new_ratio"`
	Confirm              bool    `json:"confirm"`
}

type RollbackInput struct {
	AuditID              uint    `json:"audit_id"`
	ExpectedCurrentRatio float64 `json:"expected_current_ratio"`
	Confirm              bool    `json:"confirm"`
}

type Preview struct {
	Action        string    `json:"action"`
	SourceAuditID *uint     `json:"source_audit_id,omitempty"`
	TargetID      uint      `json:"target_id"`
	TargetName    string    `json:"target_name"`
	RemoteGroupID int64     `json:"remote_group_id"`
	GroupName     string    `json:"group_name"`
	GroupStatus   string    `json:"group_status"`
	BeforeRatio   float64   `json:"before_ratio"`
	AfterRatio    float64   `json:"after_ratio"`
	ChangePercent float64   `json:"change_percent"`
	ImpactScope   string    `json:"impact_scope"`
	Executable    bool      `json:"executable"`
	Blockers      []string  `json:"blockers"`
	GeneratedAt   time.Time `json:"generated_at"`
}

type Target struct {
	ID      uint   `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

type Service struct {
	targets    *storage.UpstreamSyncTargets
	groups     *storage.UpstreamSyncTargetGroups
	audits     *storage.AdjustmentAudits
	cipher     *crypto.Cipher
	client     adminClient
	dispatcher dispatcher
	now        func() time.Time
	mu         sync.Mutex
}

func NewService(targets *storage.UpstreamSyncTargets, groups *storage.UpstreamSyncTargetGroups, audits *storage.AdjustmentAudits, cipher *crypto.Cipher, dispatcher dispatcher) *Service {
	return &Service{targets: targets, groups: groups, audits: audits, cipher: cipher, client: sub2api.NewAdminClient(), dispatcher: dispatcher, now: time.Now}
}

func (s *Service) ListTargets() ([]Target, error) {
	items, err := s.targets.List()
	if err != nil {
		return nil, err
	}
	out := make([]Target, 0, len(items))
	for _, item := range items {
		out = append(out, Target{ID: item.ID, Name: item.Name, Enabled: item.Enabled})
	}
	return out, nil
}

func (s *Service) ListGroups(targetID uint) ([]storage.UpstreamSyncTargetGroup, error) {
	if targetID == 0 {
		return nil, errors.New("target_id is required")
	}
	return s.groups.ListByTarget(targetID, true)
}

func (s *Service) ListAudits(limit int) ([]storage.AdjustmentAudit, error) {
	return s.audits.List(limit)
}

func validateRatio(value float64) error {
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return fmt.Errorf("%w: ratio must be a finite number greater than zero", ErrInvalidInput)
	}
	return nil
}

func sameRatio(a, b float64) bool { return math.Abs(a-b) <= ratioEpsilon }

func sanitizeError(message string, exactSecrets ...string) string {
	for _, secret := range exactSecrets {
		if strings.TrimSpace(secret) != "" {
			message = strings.ReplaceAll(message, secret, "[REDACTED]")
		}
	}
	message = bearerPattern.ReplaceAllString(message, "Bearer [REDACTED]")
	message = secretAssignmentPattern.ReplaceAllString(message, `${1}${2}[REDACTED]`)
	runes := []rune(strings.TrimSpace(message))
	if len(runes) > 1000 {
		return string(runes[:1000]) + "..."
	}
	return string(runes)
}

func (s *Service) resolve(ctx context.Context, targetID uint, groupID int64) (*storage.UpstreamSyncTarget, sub2api.AdminTarget, *sub2api.AdminGroup, error) {
	if targetID == 0 || groupID <= 0 {
		return nil, sub2api.AdminTarget{}, nil, fmt.Errorf("%w: target_id and remote_group_id are required", ErrInvalidInput)
	}
	target, err := s.targets.FindByID(targetID)
	if err != nil {
		return nil, sub2api.AdminTarget{}, nil, err
	}
	if !target.Enabled {
		return nil, sub2api.AdminTarget{}, nil, errors.New("target is disabled")
	}
	key, err := s.cipher.Decrypt(target.AdminAPIKeyCipher)
	if err != nil {
		return nil, sub2api.AdminTarget{}, nil, fmt.Errorf("decrypt target credential: %w", err)
	}
	if strings.TrimSpace(key) == "" {
		return nil, sub2api.AdminTarget{}, nil, errors.New("target admin API key is missing")
	}
	adminTarget := sub2api.AdminTarget{BaseURL: target.BaseURL, APIKey: key}
	group, err := s.client.GetGroup(ctx, adminTarget, groupID)
	if err != nil {
		return nil, sub2api.AdminTarget{}, nil, errors.New("read remote group: " + sanitizeError(err.Error(), key))
	}
	return target, adminTarget, group, nil
}

func buildPreview(action string, sourceAuditID *uint, target *storage.UpstreamSyncTarget, group *sub2api.AdminGroup, after float64, now time.Time) *Preview {
	change := 0.0
	if group.Ratio != 0 {
		change = math.Round(((after-group.Ratio)/group.Ratio)*10000) / 100
	}
	blockers := []string{}
	if strings.TrimSpace(group.Name) == "" {
		blockers = append(blockers, "remote_group_name_missing")
	}
	if group.Status != "" && group.Status != "active" {
		blockers = append(blockers, "remote_group_inactive")
	}
	if sameRatio(group.Ratio, after) {
		blockers = append(blockers, "no_change")
	}
	return &Preview{
		Action: action, SourceAuditID: sourceAuditID, TargetID: target.ID, TargetName: target.Name,
		RemoteGroupID: group.ID, GroupName: group.Name, GroupStatus: group.Status,
		BeforeRatio: group.Ratio, AfterRatio: after, ChangePercent: change,
		ImpactScope: "该 Sub2API 分组下所有未设置专属倍率的用户与 API Key",
		Executable:  len(blockers) == 0, Blockers: blockers, GeneratedAt: now,
	}
}

func (s *Service) Preview(ctx context.Context, in PreviewInput) (*Preview, error) {
	if err := validateRatio(in.NewRatio); err != nil {
		return nil, err
	}
	target, _, group, err := s.resolve(ctx, in.TargetID, in.RemoteGroupID)
	if err != nil {
		return nil, err
	}
	return buildPreview("execute", nil, target, group, in.NewRatio, s.now()), nil
}

func (s *Service) RollbackPreview(ctx context.Context, auditID uint) (*Preview, error) {
	audit, err := s.rollbackSource(auditID)
	if err != nil {
		return nil, err
	}
	target, _, group, err := s.resolve(ctx, audit.TargetID, audit.RemoteGroupID)
	if err != nil {
		return nil, err
	}
	return buildPreview("rollback", &audit.ID, target, group, audit.BeforeRatio, s.now()), nil
}

func (s *Service) rollbackSource(auditID uint) (*storage.AdjustmentAudit, error) {
	if auditID == 0 {
		return nil, errors.New("audit_id is required")
	}
	audit, err := s.audits.FindByID(auditID)
	if err != nil {
		return nil, err
	}
	if audit.Status != "succeeded" && audit.Status != "uncertain" {
		return nil, ErrNotRollbackable
	}
	return audit, nil
}

func (s *Service) Execute(ctx context.Context, in ExecuteInput, operator string) (*storage.AdjustmentAudit, error) {
	if !in.Confirm {
		return nil, ErrConfirmationRequired
	}
	if err := validateRatio(in.NewRatio); err != nil {
		return nil, err
	}
	return s.execute(ctx, "execute", nil, in.TargetID, in.RemoteGroupID, in.ExpectedGroupName, in.ExpectedCurrentRatio, in.NewRatio, operator)
}

func (s *Service) Rollback(ctx context.Context, in RollbackInput, operator string) (*storage.AdjustmentAudit, error) {
	if !in.Confirm {
		return nil, ErrConfirmationRequired
	}
	source, err := s.rollbackSource(in.AuditID)
	if err != nil {
		return nil, err
	}
	return s.execute(ctx, "rollback", &source.ID, source.TargetID, source.RemoteGroupID, source.GroupName, in.ExpectedCurrentRatio, source.BeforeRatio, operator)
}

func (s *Service) execute(ctx context.Context, action string, sourceAuditID *uint, targetID uint, groupID int64, expectedName string, expectedRatio, newRatio float64, operator string) (*storage.AdjustmentAudit, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	target, adminTarget, group, err := s.resolve(ctx, targetID, groupID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(expectedName) == "" || group.Name != strings.TrimSpace(expectedName) {
		return nil, ErrGroupDrift
	}
	if !sameRatio(group.Ratio, expectedRatio) {
		return nil, fmt.Errorf("%w: expected %.9g, found %.9g", ErrRatioDrift, expectedRatio, group.Ratio)
	}
	preview := buildPreview(action, sourceAuditID, target, group, newRatio, s.now())
	if !preview.Executable {
		return nil, fmt.Errorf("adjustment is not executable: %s", strings.Join(preview.Blockers, ", "))
	}
	inputJSON, err := json.Marshal(map[string]any{
		"target_id": targetID, "remote_group_id": groupID, "expected_group_name": expectedName,
		"expected_current_ratio": expectedRatio, "new_ratio": newRatio, "confirmed": true,
	})
	if err != nil {
		return nil, err
	}
	now := s.now()
	audit := &storage.AdjustmentAudit{
		Action: action, SourceAuditID: sourceAuditID, TargetID: target.ID, TargetName: target.Name,
		RemoteGroupID: group.ID, GroupName: group.Name, BeforeRatio: group.Ratio, AfterRatio: newRatio,
		Operator: strings.TrimSpace(operator), InputJSON: string(inputJSON), Status: "pending", CreatedAt: now,
	}
	if audit.Operator == "" {
		audit.Operator = "admin"
	}
	if err := s.audits.Create(audit); err != nil {
		return nil, fmt.Errorf("create adjustment audit: %w", err)
	}
	updated, writeUncertain, writeErr := s.client.UpdateGroupRatio(ctx, adminTarget, group.ID, newRatio)
	writeAccepted := writeErr == nil
	if writeAccepted {
		updated, writeErr = s.client.GetGroup(ctx, adminTarget, group.ID)
		if writeErr != nil {
			writeUncertain = true
		}
	}
	status, summary, errorMessage := "succeeded", "", ""
	if writeErr != nil {
		status, errorMessage = "failed", sanitizeError(writeErr.Error(), adminTarget.APIKey)
		if writeUncertain {
			status = "uncertain"
			errorMessage = "remote write result is uncertain: " + sanitizeError(writeErr.Error(), adminTarget.APIKey)
		}
	} else if updated.Name != group.Name || !sameRatio(updated.Ratio, newRatio) {
		status = "uncertain"
		errorMessage = fmt.Sprintf("remote verification mismatch: name=%q ratio=%.9g", updated.Name, updated.Ratio)
	} else {
		raw, _ := json.Marshal(map[string]any{"group_id": updated.ID, "group_name": updated.Name, "ratio": updated.Ratio, "status": updated.Status})
		summary = string(raw)
	}
	completedAt := s.now()
	if completeErr := s.audits.Complete(audit.ID, status, summary, errorMessage, completedAt); completeErr != nil {
		return nil, fmt.Errorf("complete adjustment audit: %w", completeErr)
	}
	audit.Status, audit.UpstreamSummary, audit.ErrorMessage, audit.CompletedAt = status, summary, errorMessage, &completedAt
	if status != "succeeded" {
		return audit, errors.New(errorMessage)
	}
	_ = s.groups.UpdateRatio(target.ID, group.ID, newRatio, completedAt)
	s.notify(ctx, audit)
	return audit, nil
}

func (s *Service) notify(ctx context.Context, audit *storage.AdjustmentAudit) {
	if s.dispatcher == nil || audit == nil {
		return
	}
	event, subject := storage.EventAdjustmentExecuted, "Sub2API 分组倍率已调整"
	if audit.Action == "rollback" {
		event, subject = storage.EventAdjustmentRolledBack, "Sub2API 分组倍率已回滚"
	}
	body := fmt.Sprintf("目标：%s\n分组：%s (#%d)\n倍率：%.9g -> %.9g\n操作者：%s\n审计 ID：%d", audit.TargetName, audit.GroupName, audit.RemoteGroupID, audit.BeforeRatio, audit.AfterRatio, audit.Operator, audit.ID)
	if err := s.dispatcher.Dispatch(ctx, notify.Message{Event: event, Subject: subject, Body: body}); err != nil {
		audit.NotificationError = sanitizeError(err.Error())
		_ = s.audits.SetNotificationError(audit.ID, audit.NotificationError)
	}
}
