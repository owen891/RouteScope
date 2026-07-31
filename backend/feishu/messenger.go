package feishu

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// Messenger 只暴露控制通道需要的私聊能力，便于测试并限制调用面。
type Messenger interface {
	SendText(ctx context.Context, openID, text, idempotencyKey string) error
}

type LarkMessenger struct {
	client *lark.Client
}

func NewLarkMessenger(appID, appSecret string) (*LarkMessenger, error) {
	appID = strings.TrimSpace(appID)
	appSecret = strings.TrimSpace(appSecret)
	if appID == "" || appSecret == "" {
		return nil, ErrNotConfigured
	}
	return &LarkMessenger{
		client: lark.NewClient(appID, appSecret, lark.WithLogLevel(larkcore.LogLevelError)),
	}, nil
}

func (m *LarkMessenger) SendText(ctx context.Context, openID, text, idempotencyKey string) error {
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return fmt.Errorf("marshal feishu text message: %w", err)
	}
	bodyBuilder := larkim.NewCreateMessageReqBodyBuilder().
		ReceiveId(openID).
		MsgType("text").
		Content(string(content))
	if idempotencyKey = strings.TrimSpace(idempotencyKey); idempotencyKey != "" {
		bodyBuilder.Uuid(idempotencyKey)
	}
	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("open_id").
		Body(bodyBuilder.Build()).
		Build()
	resp, err := m.client.Im.Message.Create(ctx, req)
	if err != nil {
		return fmt.Errorf("send feishu text message: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("send feishu text message failed: code=%d", resp.Code)
	}
	return nil
}
