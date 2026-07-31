package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/bejix/upstream-ops/backend/global"
	"github.com/gin-gonic/gin"
)

const (
	githubRepoURL = "https://github.com/owen891/RouteScope"
)

type versionResponse struct {
	Name            string `json:"name"`
	Title           string `json:"title"`
	Version         string `json:"version"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
	RepoURL         string `json:"repo_url"`
	ReleaseURL      string `json:"release_url"`
	UpdateError     string `json:"update_error"`
}

func registerVersion(api *gin.RouterGroup, d *Deps) {
	api.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, buildVersionResponse(c.Request.Context(), d))
	})
}

func buildVersionResponse(_ context.Context, d *Deps) versionResponse {
	app := config.AppConfig{Title: "UpstreamOps"}
	if d != nil && d.Runtime != nil {
		if cfg, err := config.LoadFile(d.Runtime.ConfigPath()); err == nil {
			app = cfg.App
		}
	}

	resp := versionResponse{
		Name:          "upstream-ops",
		Title:         app.Title,
		Version:       global.VERSION,
		LatestVersion: global.VERSION,
		RepoURL:       githubRepoURL,
		ReleaseURL:    githubRepoURL,
	}
	return resp
}

func isVersionNewer(latest, current string) bool {
	lv, ok := parseVersion(latest)
	if !ok {
		return false
	}
	cv, ok := parseVersion(current)
	if !ok {
		return false
	}
	for i := range lv {
		if lv[i] > cv[i] {
			return true
		}
		if lv[i] < cv[i] {
			return false
		}
	}
	return false
}

func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimSpace(strings.TrimPrefix(v, "v"))
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}
