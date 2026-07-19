package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/go-resty/resty/v2"
)

func init() {
	Register(storage.NotifyQQBot, func(raw string) (Notifier, error) { return newQQBot(raw) })
}

// qqBotConfig drives OneBot v11-compatible HTTP APIs
// (go-cqhttp / NapCat / Lagrange.OneBot / LLOneBot, etc.).
//
// Required:
//   - base_url: e.g. http://127.0.0.1:5700  (no trailing path)
//
// Target (one of):
//   - group_id: send_group_msg
//   - user_id:  send_private_msg
//
// Optional:
//   - access_token: Authorization: Bearer <token> and/or ?access_token=
//   - message_type: "group" | "private" (auto if group_id/user_id set)
type qqBotConfig struct {
	BaseURL      string `json:"base_url"`
	AccessToken  string `json:"access_token,omitempty"`
	GroupID      string `json:"group_id,omitempty"`
	UserID       string `json:"user_id,omitempty"`
	MessageType  string `json:"message_type,omitempty"` // group | private
	UseQueryAuth bool   `json:"use_query_auth,omitempty"`
}

type qqBot struct {
	cfg  qqBotConfig
	http *resty.Client
}

func newQQBot(raw string) (*qqBot, error) {
	var cfg qqBotConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, err
	}
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.AccessToken = strings.TrimSpace(cfg.AccessToken)
	cfg.GroupID = strings.TrimSpace(cfg.GroupID)
	cfg.UserID = strings.TrimSpace(cfg.UserID)
	cfg.MessageType = strings.ToLower(strings.TrimSpace(cfg.MessageType))
	if cfg.BaseURL == "" {
		return nil, errors.New("qqbot base_url is required")
	}
	if cfg.MessageType == "" {
		if cfg.GroupID != "" {
			cfg.MessageType = "group"
		} else if cfg.UserID != "" {
			cfg.MessageType = "private"
		}
	}
	switch cfg.MessageType {
	case "group":
		if cfg.GroupID == "" {
			return nil, errors.New("qqbot group_id is required for group messages")
		}
	case "private":
		if cfg.UserID == "" {
			return nil, errors.New("qqbot user_id is required for private messages")
		}
	default:
		return nil, errors.New("qqbot requires group_id or user_id (message_type group|private)")
	}
	return &qqBot{cfg: cfg, http: resty.New()}, nil
}

func (q *qqBot) Type() storage.NotificationChannelType { return storage.NotifyQQBot }

func (q *qqBot) SetProxy(proxyURL string) {
	if proxyURL != "" {
		q.http.SetProxy(proxyURL)
	}
}

func (q *qqBot) Send(ctx context.Context, msg Message) error {
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

	var endpoint string
	body := map[string]any{"message": text}
	if q.cfg.MessageType == "group" {
		endpoint = q.cfg.BaseURL + "/send_group_msg"
		body["group_id"] = parseFlexibleID(q.cfg.GroupID)
	} else {
		endpoint = q.cfg.BaseURL + "/send_private_msg"
		body["user_id"] = parseFlexibleID(q.cfg.UserID)
	}
	if q.cfg.UseQueryAuth && q.cfg.AccessToken != "" {
		endpoint = endpoint + "?access_token=" + url.QueryEscape(q.cfg.AccessToken)
	}

	req := q.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(body)
	if q.cfg.AccessToken != "" {
		req.SetHeader("Authorization", "Bearer "+q.cfg.AccessToken)
	}
	resp, err := req.Post(endpoint)
	if err != nil {
		return err
	}
	if resp.IsError() {
		return errors.New("qqbot returned " + resp.Status())
	}

	// OneBot typically returns {"status":"ok","retcode":0,...}
	var result struct {
		Status  string `json:"status"`
		RetCode *int   `json:"retcode"`
		Msg     string `json:"msg"`
		Wording string `json:"wording"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(resp.Body(), &result); err == nil {
		if result.RetCode != nil && *result.RetCode != 0 {
			reason := firstNonEmpty(result.Wording, result.Msg, result.Message, fmt.Sprintf("retcode %d", *result.RetCode))
			return fmt.Errorf("qqbot retcode %d: %s", *result.RetCode, reason)
		}
		if result.Status != "" && !strings.EqualFold(result.Status, "ok") {
			return fmt.Errorf("qqbot status %s", result.Status)
		}
	}
	return nil
}

func parseFlexibleID(v string) any {
	// Prefer number when pure digits (OneBot expects number for many implementations).
	if v == "" {
		return v
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return v
		}
	}
	var n json.Number = json.Number(v)
	// resty/json will encode Number as number
	return n
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
