package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQQOfficialSendGroup(t *testing.T) {
	var gotAuth string
	var gotPath string
	var gotBody map[string]any
	var tokenCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			tokenCalls++
			_, _ = w.Write([]byte(`{"access_token":"tok-1","expires_in":7200}`))
		case strings.HasPrefix(r.URL.Path, "/v2/groups/"):
			gotPath = r.URL.Path
			gotAuth = r.Header.Get("Authorization")
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			_, _ = w.Write([]byte(`{"id":"m1","timestamp":"2026-07-21T00:00:00+08:00"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	raw, _ := json.Marshal(map[string]any{
		"app_id":           "1904534724",
		"app_secret":       "secret",
		"message_type":     "group",
		"group_openid":     "group-open-1",
		"openapi_base_url": srv.URL,
		"token_url":        srv.URL + "/token",
	})
	n, err := newQQOfficial(string(raw))
	if err != nil {
		t.Fatalf("newQQOfficial: %v", err)
	}
	if err := n.Send(context.Background(), Message{Subject: "标题", Body: "内容"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if tokenCalls != 1 {
		t.Fatalf("tokenCalls = %d", tokenCalls)
	}
	if gotPath != "/v2/groups/group-open-1/messages" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "QQBot tok-1" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotBody["msg_type"] != float64(0) {
		t.Fatalf("msg_type = %#v", gotBody["msg_type"])
	}
	msg, _ := gotBody["content"].(string)
	if !strings.Contains(msg, "标题") || !strings.Contains(msg, "内容") {
		t.Fatalf("content = %#v", gotBody["content"])
	}
}

func TestQQOfficialSendPrivate(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			_, _ = w.Write([]byte(`{"access_token":"tok-2","expires_in":"3600"}`))
			return
		}
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"id":"m2"}`))
	}))
	defer srv.Close()

	raw, _ := json.Marshal(map[string]any{
		"app_id":           "app",
		"app_secret":       "sec",
		"message_type":     "private",
		"user_openid":      "user-open-9",
		"openapi_base_url": srv.URL,
		"token_url":        srv.URL + "/token",
	})
	n, err := newQQOfficial(string(raw))
	if err != nil {
		t.Fatalf("newQQOfficial: %v", err)
	}
	if err := n.Send(context.Background(), Message{Body: "hello"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotPath != "/v2/users/user-open-9/messages" {
		t.Fatalf("path = %q", gotPath)
	}
}

func TestQQOfficialRequiresOpenID(t *testing.T) {
	_, err := newQQOfficial(`{"app_id":"a","app_secret":"b","message_type":"group"}`)
	if err == nil {
		t.Fatal("expected error")
	}
}
