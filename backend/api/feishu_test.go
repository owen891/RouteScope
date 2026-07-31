package api

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func TestFeishuCallbackRoutePrecedesSPAFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := storage.Open(storage.DBConfig{Driver: storage.DBDriverSQLite, Path: filepath.Join(t.TempDir(), "api.db")})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql.DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	frontend := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>spa</html>"), Mode: fs.FileMode(0o644)},
	}
	router := gin.New()
	Register(router, &Deps{
		DB: db,
		FeishuCallback: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"challenge":"ok"}`))
		}),
		FeishuCallbackPath: "/callbacks/feishu",
		Frontend:           frontend,
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callbacks/feishu", strings.NewReader(`{}`)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Header().Get("Content-Type"), "application/json") || strings.Contains(recorder.Body.String(), "<html>") {
		t.Fatalf("callback was captured by SPA fallback: content-type=%q body=%s", recorder.Header().Get("Content-Type"), recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callbacks/unknown", strings.NewReader(`{}`)))
	if recorder.Code != http.StatusNotFound || strings.Contains(recorder.Body.String(), "<html>") {
		t.Fatalf("unknown callback should not return SPA: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestUnconfiguredFeishuCallbackReturnsJSON503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	registerFeishuCallback(router, &Deps{FeishuCallbackPath: "/callbacks/feishu"})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callbacks/feishu", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Header().Get("Content-Type"), "application/json") || strings.Contains(recorder.Body.String(), "<html>") {
		t.Fatalf("unconfigured callback response is not JSON: headers=%v body=%s", recorder.Header(), recorder.Body.String())
	}
}

func TestFeishuBindingChangesRequireAdministratorAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	registerFeishu(router.Group("/api"), &Deps{})
	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/feishu/binding-code"},
		{method: http.MethodDelete, path: "/api/feishu/binding"},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(tc.method, tc.path, nil))
		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s status = %d, body=%s", tc.method, tc.path, recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), "administrator authentication must be enabled") {
			t.Fatalf("%s %s body = %s", tc.method, tc.path, recorder.Body.String())
		}
	}
}
