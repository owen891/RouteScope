package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
)

func registerObservations(g *gin.RouterGroup, d *Deps) {
	g.GET("/observations", func(c *gin.Context) {
		if d.Observations == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("observations unavailable"))
			return
		}
		q := storage.ObservationQuery{Limit: 100}
		if s := c.Query("channel_id"); s != "" {
			id, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			q.ChannelID = uint(id)
		}
		if k := strings.TrimSpace(c.Query("kind")); k != "" {
			q.Kind = storage.ObservationKind(k)
		}
		if s := c.Query("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil {
				q.Limit = n
			}
		}
		if s := strings.TrimSpace(c.Query("since")); s != "" {
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				q.Since = &t
			} else {
				fail(c, http.StatusBadRequest, errors.New("since must be RFC3339"))
				return
			}
		}
		if s := strings.TrimSpace(c.Query("until")); s != "" {
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				q.Until = &t
			} else {
				fail(c, http.StatusBadRequest, errors.New("until must be RFC3339"))
				return
			}
		}
		list, err := d.Observations.List(q)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
}

func registerHealthProbes(g *gin.RouterGroup, d *Deps) {
	gp := g.Group("/health-probes")
	gp.GET("/configs", func(c *gin.Context) {
		if d.HealthProbes == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("health probes unavailable"))
			return
		}
		list, err := d.HealthProbes.ListConfigs()
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
	gp.POST("/configs", func(c *gin.Context) {
		if d.HealthProbes == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("health probes unavailable"))
			return
		}
		var in storage.HealthProbeConfig
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		in.URL = strings.TrimSpace(in.URL)
		if in.Name == "" {
			fail(c, http.StatusBadRequest, errors.New("name is required"))
			return
		}
		if in.URL == "" && in.ChannelID == nil {
			fail(c, http.StatusBadRequest, errors.New("url or channel_id is required"))
			return
		}
		if in.TimeoutMS <= 0 {
			in.TimeoutMS = 5000
		}
		if err := d.HealthProbes.CreateConfig(&in); err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": in})
	})
	gp.PUT("/configs/:id", func(c *gin.Context) {
		if d.HealthProbes == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("health probes unavailable"))
			return
		}
		id, err := uintParam(c, "id")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		existing, err := d.HealthProbes.FindConfig(id)
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		var in storage.HealthProbeConfig
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		existing.Name = strings.TrimSpace(in.Name)
		existing.URL = strings.TrimSpace(in.URL)
		existing.ChannelID = in.ChannelID
		existing.Enabled = in.Enabled
		if in.TimeoutMS > 0 {
			existing.TimeoutMS = in.TimeoutMS
		}
		if existing.Name == "" {
			fail(c, http.StatusBadRequest, errors.New("name is required"))
			return
		}
		if err := d.HealthProbes.UpdateConfig(existing); err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": existing})
	})
	gp.DELETE("/configs/:id", func(c *gin.Context) {
		if d.HealthProbes == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("health probes unavailable"))
			return
		}
		id, err := uintParam(c, "id")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := d.HealthProbes.DeleteConfig(id); err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	gp.GET("/runs", func(c *gin.Context) {
		if d.HealthProbes == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("health probes unavailable"))
			return
		}
		var configID uint
		if s := c.Query("config_id"); s != "" {
			id, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			configID = uint(id)
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		list, err := d.HealthProbes.ListRuns(configID, limit)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
	gp.POST("/configs/:id/run", func(c *gin.Context) {
		if d.ProbeSvc == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("probe service unavailable"))
			return
		}
		id, err := uintParam(c, "id")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		run, err := d.ProbeSvc.Run(c.Request.Context(), id)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": run})
	})
}
