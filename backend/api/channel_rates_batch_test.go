package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestChannelRatesBatch(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db := openTestDB(t)
	rates := storage.NewRates(db)
	now := time.Now()
	for _, snapshot := range []storage.RateSnapshot{
		{ChannelID: 2, ModelName: "zeta", Ratio: 2, LastSeenAt: now},
		{ChannelID: 1, ModelName: "alpha", Ratio: 1, LastSeenAt: now},
		{ChannelID: 1, ModelName: "beta", Ratio: 1.5, LastSeenAt: now},
	} {
		if err := db.Create(&snapshot).Error; err != nil {
			t.Fatalf("create rate snapshot: %v", err)
		}
	}

	r := gin.New()
	api := r.Group("/api")
	registerChannels(api, &Deps{Rates: rates})

	req := httptest.NewRequest(http.MethodGet, "/api/channels/rates?ids=2,1,2", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data []storage.RateSnapshot `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Data) != 3 || resp.Data[0].ChannelID != 1 || resp.Data[0].ModelName != "alpha" || resp.Data[2].ChannelID != 2 {
		t.Fatalf("unexpected batch order: %#v", resp.Data)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/channels/rates?ids=0", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid id status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
