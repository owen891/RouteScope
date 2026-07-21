package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/crypto"
	"github.com/bejix/upstream-ops/backend/notify"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestQQBotNotificationTestEndpointGroupBearer(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any
	onebot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","retcode":0,"message_id":101}`))
	}))
	defer onebot.Close()

	deps, channel := newQQBotIntegrationDeps(t, onebot.URL, map[string]any{
		"access_token": "bearer-fixture",
		"group_id":     "123456",
		"message_type": "group",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/notifications/channels/"+itoa(channel.ID)+"/test", nil)
	rec := httptest.NewRecorder()
	deps.router.ServeHTTP(rec, req)

	assertNotifyTestOK(t, rec)
	if gotAuth != "Bearer bearer-fixture" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody["group_id"] != float64(123456) {
		t.Fatalf("group_id = %#v", gotBody["group_id"])
	}
	if !strings.Contains(gotBody["message"].(string), "UpstreamOps") {
		t.Fatalf("message = %#v", gotBody["message"])
	}
}

func TestQQBotNotificationTestEndpointPrivateQueryAuth(t *testing.T) {
	var gotToken string
	var gotBody map[string]any
	onebot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.URL.Query().Get("access_token")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","retcode":0}`))
	}))
	defer onebot.Close()

	deps, channel := newQQBotIntegrationDeps(t, onebot.URL, map[string]any{
		"access_token":   "query +&= fixture",
		"user_id":        "user-10001",
		"message_type":   "private",
		"use_query_auth": true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/notifications/channels/"+itoa(channel.ID)+"/test", nil)
	rec := httptest.NewRecorder()
	deps.router.ServeHTTP(rec, req)

	assertNotifyTestOK(t, rec)
	if gotToken != "query +&= fixture" {
		t.Fatalf("query access token = %q", gotToken)
	}
	if gotBody["user_id"] != "user-10001" {
		t.Fatalf("user_id = %#v", gotBody["user_id"])
	}
}

func TestQQBotNotificationTestEndpointBusinessFailure(t *testing.T) {
	onebot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"failed","retcode":100,"wording":"group not found"}`))
	}))
	defer onebot.Close()

	deps, channel := newQQBotIntegrationDeps(t, onebot.URL, map[string]any{
		"group_id": "999999",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/notifications/channels/"+itoa(channel.ID)+"/test", nil)
	rec := httptest.NewRecorder()
	deps.router.ServeHTTP(rec, req)

	var body struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rec.Code != http.StatusOK || body.OK || !strings.Contains(body.Error, "group not found") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestQQBotNotificationTestEndpointHTTPFailure(t *testing.T) {
	onebot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("fixture upstream unavailable"))
	}))
	defer onebot.Close()

	deps, channel := newQQBotIntegrationDeps(t, onebot.URL, map[string]any{
		"group_id": "123456",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/notifications/channels/"+itoa(channel.ID)+"/test", nil)
	rec := httptest.NewRecorder()
	deps.router.ServeHTTP(rec, req)

	var body struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rec.Code != http.StatusOK || body.OK || !strings.Contains(body.Error, "502") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

type qqBotIntegrationDeps struct {
	router  *gin.Engine
	channel *storage.NotificationChannel
}

func newQQBotIntegrationDeps(t *testing.T, baseURL string, cfg map[string]any) (qqBotIntegrationDeps, *storage.NotificationChannel) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	repo := storage.NewNotifications(db)
	cipher, err := crypto.NewCipher("integration-test-app-secret")
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	cfg["base_url"] = baseURL
	rawCfg, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	cipherCfg, err := cipher.Encrypt(string(rawCfg))
	if err != nil {
		t.Fatalf("encrypt config: %v", err)
	}
	channel := &storage.NotificationChannel{
		Name:          "QQ integration fixture",
		Type:          storage.NotifyQQBot,
		ConfigCipher:  cipherCfg,
		Subscriptions: "[]",
		Enabled:       true,
	}
	if err := repo.CreateChannel(channel); err != nil {
		t.Fatalf("create notification channel: %v", err)
	}
	dispatcher := notify.NewDispatcher(repo, cipher, slog.Default(), notify.Policy{SendMaxAttempts: 1})
	router := gin.New()
	api := router.Group("/api")
	registerNotifications(api, &Deps{Notifies: repo, Dispatcher: dispatcher})
	return qqBotIntegrationDeps{router: router, channel: channel}, channel
}

func assertNotifyTestOK(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var body struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rec.Code != http.StatusOK || !body.OK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func itoa(v uint) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
