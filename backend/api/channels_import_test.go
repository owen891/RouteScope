package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/channel"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

type tokenValidationChannelServiceStub struct {
	*channel.Service
	got    channel.CreateInput
	result *channel.TokenValidationResult
	err    error
}

func (s *tokenValidationChannelServiceStub) ValidateTokenCredential(_ context.Context, in channel.CreateInput) (*channel.TokenValidationResult, error) {
	s.got = in
	return s.result, s.err
}

func TestValidateChannelTokenEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &tokenValidationChannelServiceStub{
		result: &channel.TokenValidationResult{
			TokenCredential: `{"access_token":"refreshed","refresh_token":"refresh"}`,
			Refreshed:       true,
		},
	}
	r := gin.New()
	registerChannels(r.Group("/api"), &Deps{ChannelSvc: stub})

	req := httptest.NewRequest(http.MethodPost, "/api/channels/validate-token", strings.NewReader(`{
		"name":"demo",
		"type":"sub2api",
		"site_url":"https://upstream.example.com",
		"credential_mode":"token",
		"token_credential":"{\"access_token\":\"old\",\"refresh_token\":\"refresh\"}"
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if stub.got.Type != storage.ChannelTypeSub2API || stub.got.CredentialMode != storage.CredentialModeToken {
		t.Fatalf("service input = %#v", stub.got)
	}
	var response struct {
		Data struct {
			Valid           bool   `json:"valid"`
			TokenCredential string `json:"token_credential"`
			Refreshed       bool   `json:"refreshed"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Data.Valid || !response.Data.Refreshed || !strings.Contains(response.Data.TokenCredential, "refreshed") {
		t.Fatalf("response = %#v", response.Data)
	}
}
