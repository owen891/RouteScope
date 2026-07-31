package api

// phase09-status: automated pass

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/runtimeconfig"
	"github.com/gin-gonic/gin"
)

// phase09-surface: api:GET:/api/auth/me
func TestBaselineCharacterizationAuthMe(t *testing.T) {
	gin.SetMode(gin.TestMode)

	runtime := runtimeconfig.New(
		"", "", nil, nil, nil, nil, nil, nil,
		config.ProxyConfig{}, config.UpstreamConfig{}, config.GatewayConfig{}, nil,
	)
	router := gin.New()
	registerAuth(router.Group("/api"), &Deps{Runtime: runtime})

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}

	var body struct {
		Data struct {
			AuthDisabled bool   `json:"auth_disabled"`
			Username     string `json:"username"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode identity response: %v", err)
	}
	if !body.Data.AuthDisabled || body.Data.Username != "anonymous" {
		t.Fatalf("identity = %#v", body.Data)
	}
}
