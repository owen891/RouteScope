package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/storage"
	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
	larkcallback "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	"gorm.io/gorm"
)

type sentMessage struct {
	openID         string
	text           string
	idempotencyKey string
}

type fakeMessenger struct {
	messages []sentMessage
	err      error
}

func (f *fakeMessenger) SendText(_ context.Context, openID, text, idempotencyKey string) error {
	if f.err != nil {
		return f.err
	}
	f.messages = append(f.messages, sentMessage{openID: openID, text: text, idempotencyKey: idempotencyKey})
	return nil
}

func newTestService(t *testing.T, cfg config.FeishuConfig) (*Service, *gorm.DB, *fakeMessenger) {
	t.Helper()
	db, err := storage.Open(storage.DBConfig{Driver: storage.DBDriverSQLite, Path: filepath.Join(t.TempDir(), "feishu.db")})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql.DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	messenger := &fakeMessenger{}
	service, err := NewService(cfg, storage.NewFeishuStore(db), "test-binding-hash-key", messenger, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return service, db, messenger
}

func readyConfig() config.FeishuConfig {
	return config.FeishuConfig{
		Enabled:           true,
		AppID:             "test-app-id",
		AppSecret:         "test-app-secret",
		VerificationToken: "test-verification-token",
		CallbackPath:      "/callbacks/feishu",
	}
}

func TestBindingCodeIsHashedSingleUseAndMessageIsIdempotent(t *testing.T) {
	service, db, messenger := newTestService(t, readyConfig())
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	code, err := service.GenerateBindingCode(context.Background())
	if err != nil {
		t.Fatalf("GenerateBindingCode: %v", err)
	}
	var stored storage.FeishuBindingCode
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("find stored binding code: %v", err)
	}
	canonical := strings.ReplaceAll(code.Code, "-", "")
	if stored.CodeHash == canonical || strings.Contains(stored.CodeHash, canonical) || len(stored.CodeHash) != 64 {
		t.Fatalf("binding code was not stored as a SHA-256 HMAC: %#v", stored)
	}

	event := textMessageEvent("evt-bind-1", "ou_approver_123456", code.Command, "p2p")
	if err := service.HandleMessage(context.Background(), event); err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}
	binding, err := storage.NewFeishuStore(db).Binding()
	if err != nil || binding == nil || binding.OpenID != "ou_approver_123456" {
		t.Fatalf("binding = %#v, err=%v", binding, err)
	}
	if len(messenger.messages) != 1 || !strings.Contains(messenger.messages[0].text, "绑定成功") {
		t.Fatalf("messages = %#v", messenger.messages)
	}

	if err := service.HandleMessage(context.Background(), event); err != nil {
		t.Fatalf("duplicate HandleMessage: %v", err)
	}
	if len(messenger.messages) != 1 {
		t.Fatalf("duplicate event sent %d messages, want 1", len(messenger.messages))
	}
	if _, err := service.GenerateBindingCode(context.Background()); !errors.Is(err, ErrAlreadyBound) {
		t.Fatalf("GenerateBindingCode after binding error = %v", err)
	}
}

func TestBindingCodeExpiryAttemptLimitAndDuplicateFailure(t *testing.T) {
	t.Run("expired", func(t *testing.T) {
		service, db, messenger := newTestService(t, readyConfig())
		now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
		service.now = func() time.Time { return now }
		code, err := service.GenerateBindingCode(context.Background())
		if err != nil {
			t.Fatalf("GenerateBindingCode: %v", err)
		}
		now = now.Add(11 * time.Minute)
		if err := service.HandleMessage(context.Background(), textMessageEvent("evt-expired", "ou_expired_123456", code.Command, "p2p")); err != nil {
			t.Fatalf("HandleMessage: %v", err)
		}
		binding, err := storage.NewFeishuStore(db).Binding()
		if err != nil || binding != nil {
			t.Fatalf("expired code created binding = %#v, err=%v", binding, err)
		}
		if len(messenger.messages) != 1 || !strings.Contains(messenger.messages[0].text, "已过期") {
			t.Fatalf("messages = %#v", messenger.messages)
		}
	})

	t.Run("attempt limit and duplicate event", func(t *testing.T) {
		service, db, _ := newTestService(t, readyConfig())
		now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
		service.now = func() time.Time { return now }
		if _, err := service.GenerateBindingCode(context.Background()); err != nil {
			t.Fatalf("GenerateBindingCode: %v", err)
		}
		first := textMessageEvent("evt-wrong-1", "ou_wrong_123456", "绑定 ZZZZ-ZZZZ", "p2p")
		if err := service.HandleMessage(context.Background(), first); err != nil {
			t.Fatalf("first HandleMessage: %v", err)
		}
		if err := service.HandleMessage(context.Background(), first); err != nil {
			t.Fatalf("duplicate HandleMessage: %v", err)
		}
		var stored storage.FeishuBindingCode
		if err := db.First(&stored).Error; err != nil {
			t.Fatalf("find binding code: %v", err)
		}
		if stored.FailedAttempts != 1 {
			t.Fatalf("duplicate event attempts = %d, want 1", stored.FailedAttempts)
		}
		for i := 2; i <= 5; i++ {
			eventID := "evt-wrong-" + string(rune('0'+i))
			if err := service.HandleMessage(context.Background(), textMessageEvent(eventID, "ou_wrong_123456", "绑定 ZZZZ-ZZZZ", "p2p")); err != nil {
				t.Fatalf("attempt %d: %v", i, err)
			}
		}
		if err := db.First(&stored, stored.ID).Error; err != nil {
			t.Fatalf("reload binding code: %v", err)
		}
		if stored.FailedAttempts != 5 || stored.RevokedAt == nil {
			t.Fatalf("attempt-limited code = %#v", stored)
		}
	})
}

func TestOnlyPrivateMessagesCanBind(t *testing.T) {
	service, db, messenger := newTestService(t, readyConfig())
	code, err := service.GenerateBindingCode(context.Background())
	if err != nil {
		t.Fatalf("GenerateBindingCode: %v", err)
	}
	if err := service.HandleMessage(context.Background(), textMessageEvent("evt-group", "ou_group_123456", code.Command, "group")); err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}
	binding, err := storage.NewFeishuStore(db).Binding()
	if err != nil || binding != nil {
		t.Fatalf("group message created binding = %#v, err=%v", binding, err)
	}
	if len(messenger.messages) != 0 {
		t.Fatalf("group message received reply = %#v", messenger.messages)
	}
}

func TestCardActionRequiresExactBoundOpenID(t *testing.T) {
	service, _, _ := newTestService(t, readyConfig())
	code, err := service.GenerateBindingCode(context.Background())
	if err != nil {
		t.Fatalf("GenerateBindingCode: %v", err)
	}
	if err := service.HandleMessage(context.Background(), textMessageEvent("evt-bind", "ou_owner_123456", code.Command, "p2p")); err != nil {
		t.Fatalf("bind: %v", err)
	}

	response, err := service.HandleCardAction(context.Background(), cardActionEvent("card-wrong", "ou_intruder_123456"))
	if err != nil {
		t.Fatalf("wrong open_id card action: %v", err)
	}
	if response.Toast == nil || response.Toast.Type != "error" || !strings.Contains(response.Toast.Content, "没有批准权限") {
		t.Fatalf("wrong open_id response = %#v", response)
	}
	response, err = service.HandleCardAction(context.Background(), cardActionEvent("card-owner", "ou_owner_123456"))
	if err != nil {
		t.Fatalf("owner card action: %v", err)
	}
	if response.Toast == nil || !strings.Contains(response.Toast.Content, "仍处于禁用状态") {
		t.Fatalf("owner response = %#v", response)
	}
}

func textMessageEvent(eventID, openID, text, chatType string) *larkim.P2MessageReceiveV1 {
	messageType := "text"
	content := `{"text":` + quoteJSON(text) + `}`
	return &larkim.P2MessageReceiveV1{
		EventV2Base: &larkevent.EventV2Base{Header: &larkevent.EventHeader{EventID: eventID}},
		Event: &larkim.P2MessageReceiveV1Data{
			Sender: &larkim.EventSender{SenderId: &larkim.UserId{OpenId: &openID}},
			Message: &larkim.EventMessage{
				ChatType:    &chatType,
				MessageType: &messageType,
				Content:     &content,
			},
		},
	}
}

func quoteJSON(value string) string {
	body, _ := jsonMarshal(value)
	return string(body)
}

var jsonMarshal = func(value any) ([]byte, error) {
	return json.Marshal(value)
}

func cardActionEvent(eventID, openID string) *larkcallback.CardActionTriggerEvent {
	return &larkcallback.CardActionTriggerEvent{
		EventV2Base: &larkevent.EventV2Base{Header: &larkevent.EventHeader{EventID: eventID}},
		Event: &larkcallback.CardActionTriggerRequest{
			Operator: &larkcallback.Operator{OpenID: openID},
			Action:   &larkcallback.CallBackAction{Value: map[string]interface{}{"action": "approve"}},
		},
	}
}
