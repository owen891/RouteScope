package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQQBotSendGroup(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"status":"ok","retcode":0}`))
	}))
	defer srv.Close()

	raw, _ := json.Marshal(map[string]any{
		"base_url":     srv.URL,
		"access_token": "secret",
		"group_id":     "123456",
		"message_type": "group",
	})
	n, err := newQQBot(string(raw))
	if err != nil {
		t.Fatalf("newQQBot: %v", err)
	}
	if err := n.Send(context.Background(), Message{Subject: "标题", Body: "内容", Event: "balance_low"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotPath != "/send_group_msg" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer secret" {
		t.Fatalf("auth = %q", gotAuth)
	}
	msg, _ := gotBody["message"].(string)
	if !strings.Contains(msg, "标题") || !strings.Contains(msg, "内容") {
		t.Fatalf("message = %#v", gotBody["message"])
	}
}

func TestQQBotRequiresTarget(t *testing.T) {
	_, err := newQQBot(`{"base_url":"http://127.0.0.1:5700"}`)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestQQBotSendPrivateWithQueryAuth(t *testing.T) {
	var gotPath string
	var gotToken string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.URL.Query().Get("access_token")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"status":"ok","retcode":0}`))
	}))
	defer srv.Close()

	raw, _ := json.Marshal(map[string]any{
		"base_url":       srv.URL + "/",
		"access_token":   "secret +&= token",
		"user_id":        "123456",
		"message_type":   "private",
		"use_query_auth": true,
	})
	n, err := newQQBot(string(raw))
	if err != nil {
		t.Fatalf("newQQBot: %v", err)
	}
	if err := n.Send(context.Background(), Message{Body: "private message"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotPath != "/send_private_msg" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotToken != "secret +&= token" {
		t.Fatalf("query token = %q", gotToken)
	}
	if gotBody["user_id"] != float64(123456) {
		t.Fatalf("body = %#v", gotBody)
	}
}

func TestQQBotReturnsOneBotBusinessError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"failed","retcode":100,"wording":"group not found"}`))
	}))
	defer srv.Close()

	raw, _ := json.Marshal(map[string]any{
		"base_url": srv.URL,
		"group_id": "123456",
	})
	n, err := newQQBot(string(raw))
	if err != nil {
		t.Fatalf("newQQBot: %v", err)
	}
	err = n.Send(context.Background(), Message{Body: "message"})
	if err == nil || !strings.Contains(err.Error(), "group not found") {
		t.Fatalf("error = %v", err)
	}
}

func TestQQBotReturnsHTTPStatusError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`upstream unavailable`))
	}))
	defer srv.Close()

	raw, _ := json.Marshal(map[string]any{
		"base_url": srv.URL,
		"group_id": "123456",
	})
	n, err := newQQBot(string(raw))
	if err != nil {
		t.Fatalf("newQQBot: %v", err)
	}
	err = n.Send(context.Background(), Message{Body: "message"})
	if err == nil || !strings.Contains(err.Error(), "502") {
		t.Fatalf("error = %v", err)
	}
}
