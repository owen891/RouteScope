package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bejix/upstream-ops/backend/channel"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestDeleteChannelRejectsLiveControlPlaneReferences(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openTestDB(t)
	channels := storage.NewChannels(db)
	ch := &storage.Channel{
		Name:           "referenced",
		Type:           storage.ChannelTypeNewAPI,
		SiteURL:        "https://example.com",
		Username:       "operator",
		PasswordCipher: "cipher",
		MonitorEnabled: true,
	}
	if err := channels.Create(ch); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := db.Create(&storage.UpstreamSyncAccount{SyncGroupID: 1, SourceChannelID: ch.ID, SourceGroupName: "default"}).Error; err != nil {
		t.Fatalf("create sync account: %v", err)
	}
	if err := db.Create(&storage.GatewayRoute{GatewayGroupID: 1, Position: 0, SourceChannelID: ch.ID}).Error; err != nil {
		t.Fatalf("create gateway route: %v", err)
	}

	r := gin.New()
	registerChannels(r.Group("/api"), &Deps{
		Channels:   channels,
		ChannelSvc: channel.NewService(channels, nil, nil, nil, nil, nil),
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/channels/1", nil))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response struct {
		Error         string `json:"error"`
		SyncAccounts  int64  `json:"sync_accounts"`
		GatewayRoutes int64  `json:"gateway_routes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error == "" || response.SyncAccounts != 1 || response.GatewayRoutes != 1 {
		t.Fatalf("response = %#v", response)
	}
}
