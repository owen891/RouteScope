package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/routeadvice"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestRouteAdviceEndpointsRequireConfirmationAndRecordPrimary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	rates := storage.NewRates(db)
	observations := storage.NewObservations(db)
	balance := 25.0
	channel := &storage.Channel{
		Name: "candidate", Type: storage.ChannelTypeNewAPI, SiteURL: "https://example.com",
		Username: "u", PasswordCipher: "x", MonitorEnabled: true, LastBalance: &balance,
	}
	if err := channels.Create(channel); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := rates.Upsert(&storage.RateSnapshot{
		ChannelID: channel.ID, ModelName: "gpt-pro", Ratio: 0.2, LastSeenAt: time.Now(),
	}); err != nil {
		t.Fatalf("upsert rate: %v", err)
	}
	service := routeadvice.NewService(channels, rates, observations, storage.NewRouteAdviceStore(db))
	router := gin.New()
	registerRouteAdvice(router.Group("/api"), &Deps{RouteAdvice: service})

	get := httptest.NewRequest(http.MethodGet, "/api/route-advice?model=gpt-pro", nil)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, get)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status=%d body=%s", getRec.Code, getRec.Body.String())
	}

	unconfirmed := httptest.NewRequest(http.MethodPost, "/api/route-advice/primary", strings.NewReader(`{"model_name":"gpt-pro","channel_id":1}`))
	unconfirmed.Header.Set("Content-Type", "application/json")
	unconfirmedRec := httptest.NewRecorder()
	router.ServeHTTP(unconfirmedRec, unconfirmed)
	if unconfirmedRec.Code != http.StatusBadRequest {
		t.Fatalf("unconfirmed status=%d body=%s", unconfirmedRec.Code, unconfirmedRec.Body.String())
	}

	confirmed := httptest.NewRequest(http.MethodPost, "/api/route-advice/primary", strings.NewReader(`{"model_name":"gpt-pro","channel_id":1,"confirm":true}`))
	confirmed.Header.Set("Content-Type", "application/json")
	confirmedRec := httptest.NewRecorder()
	router.ServeHTTP(confirmedRec, confirmed)
	if confirmedRec.Code != http.StatusOK {
		t.Fatalf("confirmed status=%d body=%s", confirmedRec.Code, confirmedRec.Body.String())
	}
	var response struct {
		Data struct {
			Changed bool `json:"changed"`
		} `json:"data"`
	}
	if err := json.Unmarshal(confirmedRec.Body.Bytes(), &response); err != nil || !response.Data.Changed {
		t.Fatalf("response=%s err=%v", confirmedRec.Body.String(), err)
	}
}
