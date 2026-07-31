package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/adjustment"
	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/crypto"
	"github.com/bejix/upstream-ops/backend/runtimeconfig"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestAdjustmentEndpointsRequireConfirmationAndPersistAudit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ratio := 0.5
	remoteWrites := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/admin/groups/10" || r.Header.Get("x-api-key") != "admin-key" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodPut {
			var body struct {
				Ratio float64 `json:"rate_multiplier"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode update: %v", err)
			}
			ratio = body.Ratio
			remoteWrites++
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"data": map[string]any{"id": 10, "name": "GPT mix", "rate_multiplier": ratio, "status": "active"},
		})
	}))
	defer remote.Close()

	db := openTestDB(t)
	cipher, err := crypto.NewCipher("adjustment-api-test")
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	keyCipher, err := cipher.Encrypt("admin-key")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	targets := storage.NewUpstreamSyncTargets(db)
	groups := storage.NewUpstreamSyncTargetGroups(db)
	if err := targets.Create(&storage.UpstreamSyncTarget{Name: "prod", BaseURL: remote.URL, AdminAPIKeyCipher: keyCipher, Enabled: true}); err != nil {
		t.Fatalf("create target: %v", err)
	}
	if err := groups.Upsert(&storage.UpstreamSyncTargetGroup{TargetID: 1, RemoteGroupID: 10, Name: "GPT mix", Ratio: 0.5, Status: "active"}); err != nil {
		t.Fatalf("create group: %v", err)
	}
	service := adjustment.NewService(targets, groups, storage.NewAdjustmentAudits(db), cipher, nil)
	configPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := config.Save(configPath, &config.Config{Adjustment: config.AdjustmentConfig{GrossMarginPct: 12.5}}); err != nil {
		t.Fatalf("save config: %v", err)
	}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("authSubject", "alice"); c.Next() })
	registerAdjustments(router.Group("/api"), &Deps{
		Adjustments: service,
		Runtime: runtimeconfig.New(
			configPath, "", nil, nil, nil, nil, nil, nil,
			config.ProxyConfig{}, config.UpstreamConfig{}, config.GatewayConfig{}, nil,
		),
	})

	request := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		router.ServeHTTP(rec, req)
		return rec
	}

	preview := request(http.MethodPost, "/api/adjustments/preview", `{"target_id":1,"remote_group_id":10,"new_ratio":0.7}`)
	if preview.Code != http.StatusOK || !strings.Contains(preview.Body.String(), `"before_ratio":0.5`) {
		t.Fatalf("preview status=%d body=%s", preview.Code, preview.Body.String())
	}
	unconfirmed := request(http.MethodPost, "/api/adjustments/execute", `{"target_id":1,"remote_group_id":10,"expected_group_name":"GPT mix","expected_current_ratio":0.5,"new_ratio":0.7}`)
	if unconfirmed.Code != http.StatusBadRequest || remoteWrites != 0 {
		t.Fatalf("unconfirmed status=%d writes=%d body=%s", unconfirmed.Code, remoteWrites, unconfirmed.Body.String())
	}
	confirmed := request(http.MethodPost, "/api/adjustments/execute", `{"target_id":1,"remote_group_id":10,"expected_group_name":"GPT mix","expected_current_ratio":0.5,"new_ratio":0.7,"confirm":true}`)
	if confirmed.Code != http.StatusOK || remoteWrites != 1 || !strings.Contains(confirmed.Body.String(), `"operator":"alice"`) {
		t.Fatalf("confirmed status=%d writes=%d body=%s", confirmed.Code, remoteWrites, confirmed.Body.String())
	}
	audits := request(http.MethodGet, "/api/adjustments/audits", "")
	if audits.Code != http.StatusOK || !strings.Contains(audits.Body.String(), `"status":"succeeded"`) {
		t.Fatalf("audits status=%d body=%s", audits.Code, audits.Body.String())
	}

	configView := request(http.MethodGet, "/api/adjustments/config", "")
	if configView.Code != http.StatusOK || !strings.Contains(configView.Body.String(), `"gross_margin_pct":12.5`) {
		t.Fatalf("config status=%d body=%s", configView.Code, configView.Body.String())
	}
	configUpdate := request(http.MethodPut, "/api/adjustments/config", `{"gross_margin_pct":20}`)
	if configUpdate.Code != http.StatusOK {
		t.Fatalf("config update status=%d body=%s", configUpdate.Code, configUpdate.Body.String())
	}
	savedConfig, err := config.LoadFile(configPath)
	if err != nil {
		t.Fatalf("load saved config: %v", err)
	}
	if savedConfig.Adjustment.GrossMarginPct != 20 {
		t.Fatalf("saved gross margin=%v", savedConfig.Adjustment.GrossMarginPct)
	}
	invalidConfig := request(http.MethodPut, "/api/adjustments/config", `{"gross_margin_pct":100}`)
	if invalidConfig.Code != http.StatusBadRequest {
		t.Fatalf("invalid config status=%d body=%s", invalidConfig.Code, invalidConfig.Body.String())
	}
}
