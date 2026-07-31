package feishu

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/storage"
	larkcallback "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

const (
	messageReceiptKind = "message"
	cardReceiptKind    = "card_action"
	bindingAlphabet    = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

type Status struct {
	Enabled              bool       `json:"enabled"`
	Configured           bool       `json:"configured"`
	EncryptionConfigured bool       `json:"encryption_configured"`
	AdminAuthEnabled     bool       `json:"admin_auth_enabled"`
	CallbackPath         string     `json:"callback_path"`
	BindCodeTTLMinutes   int        `json:"bind_code_ttl_minutes"`
	BindCodeMaxAttempts  int        `json:"bind_code_max_attempts"`
	Bound                bool       `json:"bound"`
	BoundOpenIDMasked    string     `json:"bound_open_id_masked,omitempty"`
	BoundAt              *time.Time `json:"bound_at,omitempty"`
}

type BindingCode struct {
	Code      string    `json:"code"`
	Command   string    `json:"command"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Service struct {
	cfg       config.FeishuConfig
	store     *storage.FeishuStore
	messenger Messenger
	hashKey   []byte
	log       *slog.Logger
	now       func() time.Time
}

func NewService(cfg config.FeishuConfig, store *storage.FeishuStore, hashKey string, messenger Messenger, log *slog.Logger) (*Service, error) {
	if store == nil {
		return nil, errors.New("feishu store is nil")
	}
	if strings.TrimSpace(hashKey) == "" {
		return nil, errors.New("feishu binding hash key is empty")
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		cfg:       cfg.WithDefaults(),
		store:     store,
		messenger: messenger,
		hashKey:   []byte(hashKey),
		log:       log,
		now:       time.Now,
	}, nil
}

func (s *Service) Config() config.FeishuConfig {
	return s.cfg
}

func (s *Service) Configured() bool {
	return strings.TrimSpace(s.cfg.AppID) != "" &&
		strings.TrimSpace(s.cfg.AppSecret) != "" &&
		strings.TrimSpace(s.cfg.VerificationToken) != ""
}

func (s *Service) Ready() bool {
	return s.cfg.Enabled && s.Configured() && s.messenger != nil
}

func (s *Service) Status() (Status, error) {
	binding, err := s.store.Binding()
	if err != nil {
		return Status{}, err
	}
	status := Status{
		Enabled:              s.cfg.Enabled,
		Configured:           s.Configured(),
		EncryptionConfigured: strings.TrimSpace(s.cfg.EncryptKey) != "",
		CallbackPath:         s.cfg.CallbackPath,
		BindCodeTTLMinutes:   s.cfg.BindCodeTTLMinutes,
		BindCodeMaxAttempts:  s.cfg.BindCodeMaxAttempts,
		Bound:                binding != nil,
	}
	if binding != nil {
		boundAt := binding.BoundAt
		status.BoundAt = &boundAt
		status.BoundOpenIDMasked = maskOpenID(binding.OpenID)
	}
	return status, nil
}

func (s *Service) GenerateBindingCode(ctx context.Context) (*BindingCode, error) {
	if !s.cfg.Enabled {
		return nil, ErrDisabled
	}
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	binding, err := s.store.Binding()
	if err != nil {
		return nil, err
	}
	if binding != nil {
		return nil, ErrAlreadyBound
	}
	plain, canonical, err := newBindingCode()
	if err != nil {
		return nil, err
	}
	now := s.now()
	expiresAt := now.Add(time.Duration(s.cfg.BindCodeTTLMinutes) * time.Minute)
	if err := s.store.CreateBindingCode(s.bindingCodeHash(canonical), expiresAt, s.cfg.BindCodeMaxAttempts, now); err != nil {
		if errors.Is(err, storage.ErrFeishuBindingExists) {
			return nil, ErrAlreadyBound
		}
		return nil, err
	}
	s.log.InfoContext(ctx, "feishu binding code created", "expires_at", expiresAt)
	return &BindingCode{
		Code:      plain,
		Command:   "绑定 " + plain,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *Service) Unbind(ctx context.Context) error {
	if err := s.store.ClearBinding(s.now()); err != nil {
		return err
	}
	s.log.WarnContext(ctx, "feishu approver binding cleared")
	return nil
}

func (s *Service) HandleMessage(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
	if event == nil || event.EventV2Base == nil || event.EventV2Base.Header == nil || event.Event == nil {
		return errors.New("invalid feishu message event")
	}
	message := event.Event.Message
	sender := event.Event.Sender
	if message == nil || sender == nil || sender.SenderId == nil {
		return errors.New("invalid feishu message payload")
	}
	if value(message.ChatType) != "p2p" {
		return nil
	}
	openID := strings.TrimSpace(value(sender.SenderId.OpenId))
	if openID == "" {
		return errors.New("feishu sender open_id is empty")
	}
	eventID := strings.TrimSpace(event.EventV2Base.Header.EventID)
	claimed, err := s.store.ClaimCallback(eventID, messageReceiptKind, s.now())
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}

	reply, outcome := s.messageReply(openID, message)
	if err := s.sendText(ctx, openID, reply, "feishu-message-"+eventID); err != nil {
		s.completeCallback(eventID, messageReceiptKind, "send_failed")
		return err
	}
	s.completeCallback(eventID, messageReceiptKind, outcome)
	return nil
}

func (s *Service) messageReply(openID string, message *larkim.EventMessage) (string, string) {
	if value(message.MessageType) != "text" || message.Content == nil {
		return "目前只支持文本命令。请在 UpstreamOps 后台生成绑定码后发送：绑定 <代码>", "help"
	}
	var content struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(value(message.Content)), &content); err != nil {
		return "消息格式无法识别。请发送：绑定 <代码>", "invalid_message"
	}
	code, ok := parseBindingCommand(content.Text)
	if !ok {
		return "UpstreamOps 控制机器人已连接。请在后台生成绑定码后发送：绑定 <代码>", "help"
	}

	binding, err := s.store.Binding()
	if err != nil {
		s.log.Error("read feishu binding failed", "err", err)
		return "绑定状态读取失败，请稍后重试。", "store_error"
	}
	if binding != nil {
		if hmac.Equal([]byte(binding.OpenID), []byte(openID)) {
			return "当前飞书账号已经绑定，无需重复操作。", "already_bound"
		}
		return "系统已绑定其他飞书账号。如需更换，请先在 UpstreamOps 管理后台解除绑定。", "binding_locked"
	}

	err = s.store.ConsumeBindingCode(s.bindingCodeHash(code), openID, s.now())
	switch {
	case err == nil, errors.Is(err, storage.ErrFeishuBindingAlreadySet):
		return "绑定成功。以后告警和批准卡片只会发送到当前飞书账号。", "bound"
	case errors.Is(err, storage.ErrFeishuBindingExists):
		return "系统已绑定其他飞书账号。如需更换，请先在 UpstreamOps 管理后台解除绑定。", "binding_locked"
	case errors.Is(err, storage.ErrFeishuCodeExpired), errors.Is(err, storage.ErrFeishuNoActiveCode):
		return "绑定码不存在或已过期，请回到 UpstreamOps 后台重新生成。", "code_expired"
	case errors.Is(err, storage.ErrFeishuCodeAttemptLimit):
		return "绑定码尝试次数已用完，请回到 UpstreamOps 后台重新生成。", "attempt_limit"
	case errors.Is(err, storage.ErrFeishuCodeInvalid):
		return "绑定码不正确，请检查后重试。", "invalid_code"
	default:
		s.log.Error("consume feishu binding code failed", "err", err)
		return "绑定失败，请稍后重试。", "store_error"
	}
}

func (s *Service) HandleCardAction(ctx context.Context, event *larkcallback.CardActionTriggerEvent) (*larkcallback.CardActionTriggerResponse, error) {
	if event == nil || event.EventV2Base == nil || event.EventV2Base.Header == nil || event.Event == nil || event.Event.Operator == nil {
		return nil, errors.New("invalid feishu card action")
	}
	eventID := strings.TrimSpace(event.EventV2Base.Header.EventID)
	claimed, err := s.store.ClaimCallback(eventID, cardReceiptKind, s.now())
	if err != nil {
		return nil, err
	}
	if !claimed {
		return cardToast("info", "该操作已处理，请勿重复点击。"), nil
	}
	openID := strings.TrimSpace(event.Event.Operator.OpenID)
	binding, err := s.store.Binding()
	if err != nil {
		s.completeCallback(eventID, cardReceiptKind, "store_error")
		return nil, err
	}
	if binding == nil || openID == "" || !hmac.Equal([]byte(binding.OpenID), []byte(openID)) {
		s.completeCallback(eventID, cardReceiptKind, "forbidden")
		return cardToast("error", "当前飞书账号没有批准权限。"), nil
	}
	s.completeCallback(eventID, cardReceiptKind, "verified_only")
	s.log.InfoContext(ctx, "feishu card action identity verified", "event_id", eventID)
	return cardToast("info", "批准通道已验证；容灾执行仍处于禁用状态。"), nil
}

func (s *Service) sendText(ctx context.Context, openID, text, idempotencyKey string) error {
	if s.messenger == nil {
		return ErrNotConfigured
	}
	return s.messenger.SendText(ctx, openID, text, idempotencyKey)
}

func (s *Service) completeCallback(eventID, kind, outcome string) {
	if err := s.store.CompleteCallback(eventID, kind, outcome, s.now()); err != nil {
		s.log.Error("complete feishu callback receipt failed", "event_id", eventID, "kind", kind, "err", err)
	}
}

func (s *Service) bindingCodeHash(code string) string {
	mac := hmac.New(sha256.New, s.hashKey)
	_, _ = mac.Write([]byte(normalizeBindingCode(code)))
	return hex.EncodeToString(mac.Sum(nil))
}

func newBindingCode() (display string, canonical string, err error) {
	chars := make([]byte, 8)
	for i := range chars {
		n, randomErr := rand.Int(rand.Reader, big.NewInt(int64(len(bindingAlphabet))))
		if randomErr != nil {
			return "", "", fmt.Errorf("generate feishu binding code: %w", randomErr)
		}
		chars[i] = bindingAlphabet[n.Int64()]
	}
	canonical = string(chars)
	return canonical[:4] + "-" + canonical[4:], canonical, nil
}

func parseBindingCommand(text string) (string, bool) {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) != 2 || fields[0] != "绑定" {
		return "", false
	}
	code := normalizeBindingCode(fields[1])
	return code, len(code) == 8
}

func normalizeBindingCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	code = strings.ReplaceAll(code, "-", "")
	return code
}

func maskOpenID(openID string) string {
	openID = strings.TrimSpace(openID)
	if len(openID) <= 10 {
		return "***"
	}
	return openID[:6] + "…" + openID[len(openID)-4:]
}

func cardToast(kind, content string) *larkcallback.CardActionTriggerResponse {
	return &larkcallback.CardActionTriggerResponse{Toast: &larkcallback.Toast{Type: kind, Content: content}}
}

func value(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
