package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/go-resty/resty/v2"
)

func init() {
	Register(storage.NotifyQQOfficial, func(raw string) (Notifier, error) { return newQQOfficial(raw) })
}

// qqOfficialConfig drives QQ Open Platform bot messaging.
//
// Required:
//   - app_id / app_secret: from q.qq.com bot credentials
//   - message_type: "group" | "private"
//   - group_openid (group) or user_openid (private/C2C)
//
// Optional:
//   - openapi_base_url: default https://api.sgroup.qq.com
//   - token_url: default https://bots.qq.com/app/getAppAccessToken
//
// Notes:
//   - Uses openid values from the official bot platform, not numeric QQ numbers.
//   - Active push is subject to QQ platform rate limits and group-owner settings.
//     See https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html
type qqOfficialConfig struct {
	AppID         string `json:"app_id"`
	AppSecret     string `json:"app_secret"`
	MessageType   string `json:"message_type,omitempty"` // group | private
	GroupOpenID   string `json:"group_openid,omitempty"`
	UserOpenID    string `json:"user_openid,omitempty"`
	OpenAPIBase   string `json:"openapi_base_url,omitempty"`
	TokenURL      string `json:"token_url,omitempty"`
}

type qqOfficial struct {
	cfg  qqOfficialConfig
	http *resty.Client

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

func newQQOfficial(raw string) (*qqOfficial, error) {
	var cfg qqOfficialConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, err
	}
	cfg.AppID = strings.TrimSpace(cfg.AppID)
	cfg.AppSecret = strings.TrimSpace(cfg.AppSecret)
	cfg.MessageType = strings.ToLower(strings.TrimSpace(cfg.MessageType))
	cfg.GroupOpenID = strings.TrimSpace(cfg.GroupOpenID)
	cfg.UserOpenID = strings.TrimSpace(cfg.UserOpenID)
	cfg.OpenAPIBase = strings.TrimRight(strings.TrimSpace(cfg.OpenAPIBase), "/")
	cfg.TokenURL = strings.TrimSpace(cfg.TokenURL)
	if cfg.OpenAPIBase == "" {
		cfg.OpenAPIBase = "https://api.sgroup.qq.com"
	}
	if cfg.TokenURL == "" {
		cfg.TokenURL = "https://bots.qq.com/app/getAppAccessToken"
	}
	if cfg.AppID == "" || cfg.AppSecret == "" {
		return nil, errors.New("qqofficial app_id and app_secret are required")
	}
	if cfg.MessageType == "" {
		if cfg.GroupOpenID != "" {
			cfg.MessageType = "group"
		} else if cfg.UserOpenID != "" {
			cfg.MessageType = "private"
		}
	}
	switch cfg.MessageType {
	case "group":
		if cfg.GroupOpenID == "" {
			return nil, errors.New("qqofficial group_openid is required for group messages")
		}
	case "private":
		if cfg.UserOpenID == "" {
			return nil, errors.New("qqofficial user_openid is required for private messages")
		}
	default:
		return nil, errors.New("qqofficial requires message_type group|private with matching openid")
	}
	return &qqOfficial{cfg: cfg, http: resty.New().SetTimeout(15 * time.Second)}, nil
}

func (q *qqOfficial) Type() storage.NotificationChannelType { return storage.NotifyQQOfficial }

func (q *qqOfficial) SetProxy(proxyURL string) {
	if proxyURL != "" {
		q.http.SetProxy(proxyURL)
	}
}

func (q *qqOfficial) Send(ctx context.Context, msg Message) error {
	text := strings.TrimSpace(msg.Subject)
	if body := strings.TrimSpace(msg.Body); body != "" {
		if text != "" {
			text = text + "\n" + body
		} else {
			text = body
		}
	}
	if text == "" {
		text = string(msg.Event)
	}

	token, err := q.accessToken(ctx, false)
	if err != nil {
		return err
	}
	if err := q.sendMessage(ctx, token, text); err != nil {
		// one forced token refresh on unauthorized-style failures
		if !isAuthFailure(err) {
			return err
		}
		token, err = q.accessToken(ctx, true)
		if err != nil {
			return err
		}
		return q.sendMessage(ctx, token, text)
	}
	return nil
}

func (q *qqOfficial) accessToken(ctx context.Context, force bool) (string, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if !force && q.token != "" && time.Now().Before(q.expiresAt.Add(-60*time.Second)) {
		return q.token, nil
	}

	resp, err := q.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(map[string]string{
			"appId":        q.cfg.AppID,
			"clientSecret": q.cfg.AppSecret,
		}).
		Post(q.cfg.TokenURL)
	if err != nil {
		return "", err
	}
	if resp.IsError() {
		return "", fmt.Errorf("qqofficial token HTTP %s", resp.Status())
	}
	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   any    `json:"expires_in"`
		Code        any    `json:"code"`
		Message     string `json:"message"`
		Msg         string `json:"msg"`
	}
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return "", fmt.Errorf("qqofficial token decode failed: %w", err)
	}
	if result.AccessToken == "" {
		reason := firstNonEmpty(result.Message, result.Msg, "empty access_token")
		return "", fmt.Errorf("qqofficial token failed: %s", reason)
	}
	expires := parseFlexibleSeconds(result.ExpiresIn, 7200)
	if expires < 300 {
		expires = 300
	}
	q.token = result.AccessToken
	q.expiresAt = time.Now().Add(time.Duration(expires) * time.Second)
	return q.token, nil
}

func (q *qqOfficial) sendMessage(ctx context.Context, token, text string) error {
	var endpoint string
	if q.cfg.MessageType == "group" {
		endpoint = q.cfg.OpenAPIBase + "/v2/groups/" + url.PathEscape(q.cfg.GroupOpenID) + "/messages"
	} else {
		endpoint = q.cfg.OpenAPIBase + "/v2/users/" + url.PathEscape(q.cfg.UserOpenID) + "/messages"
	}

	resp, err := q.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("Authorization", "QQBot "+token).
		SetBody(map[string]any{
			"content":  text,
			"msg_type": 0,
		}).
		Post(endpoint)
	if err != nil {
		return err
	}
	var result map[string]any
	_ = json.Unmarshal(resp.Body(), &result)
	if resp.StatusCode() == 401 || resp.StatusCode() == 403 {
		return fmt.Errorf("qqofficial unauthorized: HTTP %s", resp.Status())
	}
	if resp.IsError() {
		return fmt.Errorf("qqofficial send failed: HTTP %s: %s", resp.Status(), summarizeOpenAPIError(result, resp.String()))
	}
	// success responses usually include id/timestamp; some errors still return 200 with code
	if code, ok := result["code"]; ok {
		switch v := code.(type) {
		case float64:
			if v != 0 {
				return fmt.Errorf("qqofficial send failed: code %v: %s", v, summarizeOpenAPIError(result, ""))
			}
		case json.Number:
			if s := v.String(); s != "" && s != "0" {
				return fmt.Errorf("qqofficial send failed: code %s: %s", s, summarizeOpenAPIError(result, ""))
			}
		case string:
			if v != "" && v != "0" {
				return fmt.Errorf("qqofficial send failed: code %s: %s", v, summarizeOpenAPIError(result, ""))
			}
		}
	}
	return nil
}

func parseFlexibleSeconds(v any, fallback int) int {
	switch t := v.(type) {
	case float64:
		if t > 0 {
			return int(t)
		}
	case json.Number:
		if n, err := t.Int64(); err == nil && n > 0 {
			return int(n)
		}
	case string:
		var n int
		if _, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n); err == nil && n > 0 {
			return n
		}
	case int:
		if t > 0 {
			return t
		}
	case int64:
		if t > 0 {
			return int(t)
		}
	}
	return fallback
}

func summarizeOpenAPIError(result map[string]any, raw string) string {
	if result != nil {
		for _, key := range []string{"message", "msg", "error", "err_msg", "errmsg"} {
			if v, ok := result[key]; ok {
				if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
					return s
				}
			}
		}
	}
	raw = strings.TrimSpace(raw)
	if len(raw) > 300 {
		return raw[:300]
	}
	return raw
}

func isAuthFailure(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "unauthorized") || strings.Contains(s, "http 401") || strings.Contains(s, "http 403")
}
