package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bejix/upstream-ops/backend/global"
	"github.com/gin-gonic/gin"
)

func TestIsVersionNewer(t *testing.T) {
	tests := []struct {
		latest  string
		current string
		want    bool
	}{
		{latest: "0.2.1", current: "0.2.0", want: true},
		{latest: "v0.2.1", current: "0.2.0", want: true},
		{latest: "0.2.0", current: "v0.2.0", want: false},
		{latest: "0.1.9", current: "0.2.0", want: false},
	}
	for _, tt := range tests {
		if got := isVersionNewer(tt.latest, tt.current); got != tt.want {
			t.Fatalf("isVersionNewer(%q, %q) = %v, want %v", tt.latest, tt.current, got, tt.want)
		}
	}
}

func TestVersionEndpointReportsLocalReleaseMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)

	resp := requestVersion(t)

	if resp.UpdateAvailable {
		t.Fatalf("update_available = true, want false")
	}
	if resp.LatestVersion != global.VERSION {
		t.Fatalf("latest_version = %q, want %s", resp.LatestVersion, global.VERSION)
	}
	if resp.ReleaseURL != githubRepoURL {
		t.Fatalf("release_url = %q, want %q", resp.ReleaseURL, githubRepoURL)
	}
	if resp.RepoURL != githubRepoURL {
		t.Fatalf("repo_url = %q, want %q", resp.RepoURL, githubRepoURL)
	}
}

func requestVersion(t *testing.T) versionResponse {
	t.Helper()
	r := gin.New()
	registerVersion(r.Group("/api"), &Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp versionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}
