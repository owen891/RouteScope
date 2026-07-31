package api

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/bejix/upstream-ops/backend/adjustment"
	"github.com/bejix/upstream-ops/backend/config"
	"github.com/gin-gonic/gin"
)

type adjustmentConfigPayload struct {
	GrossMarginPct float64 `json:"gross_margin_pct"`
}

func adjustmentOperator(c *gin.Context) string {
	if subject, ok := c.Get("authSubject"); ok {
		if value, ok := subject.(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "admin"
}

func adjustmentErrorStatus(err error) int {
	switch {
	case errors.Is(err, adjustment.ErrConfirmationRequired), errors.Is(err, adjustment.ErrInvalidInput):
		return http.StatusBadRequest
	case errors.Is(err, adjustment.ErrRatioDrift), errors.Is(err, adjustment.ErrGroupDrift), errors.Is(err, adjustment.ErrNotRollbackable):
		return http.StatusConflict
	default:
		return http.StatusBadGateway
	}
}

func registerAdjustments(g *gin.RouterGroup, d *Deps) {
	gp := g.Group("/adjustments")
	gp.Use(func(c *gin.Context) {
		if d.Adjustments == nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "adjustments unavailable"})
			return
		}
		c.Next()
	})
	gp.GET("/config", func(c *gin.Context) {
		if d.Runtime == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("runtime config unavailable"))
			return
		}
		cfg, err := config.LoadFile(d.Runtime.ConfigPath())
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": adjustmentConfigPayload{GrossMarginPct: cfg.Adjustment.EffectiveGrossMarginPct()}})
	})
	gp.PUT("/config", func(c *gin.Context) {
		if d.Runtime == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("runtime config unavailable"))
			return
		}
		var in adjustmentConfigPayload
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if math.IsNaN(in.GrossMarginPct) || math.IsInf(in.GrossMarginPct, 0) || in.GrossMarginPct < 0 || in.GrossMarginPct >= 100 {
			fail(c, http.StatusBadRequest, errors.New("gross_margin_pct must be between 0 and 100"))
			return
		}

		path := d.Runtime.ConfigPath()
		cfg, err := config.LoadFile(path)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		cfg.Adjustment.GrossMarginPct = in.GrossMarginPct
		cfg.Adjustment.ProfitMarginPct = 0
		if err := config.Save(path, cfg); err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": in})
	})
	gp.GET("/targets", func(c *gin.Context) {
		items, err := d.Adjustments.ListTargets()
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	})
	gp.GET("/groups", func(c *gin.Context) {
		targetID, err := strconv.ParseUint(c.Query("target_id"), 10, 64)
		if err != nil || targetID == 0 {
			fail(c, http.StatusBadRequest, errors.New("valid target_id is required"))
			return
		}
		items, err := d.Adjustments.ListGroups(uint(targetID))
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	})
	gp.GET("/audits", func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		items, err := d.Adjustments.ListAudits(limit)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	})
	gp.POST("/preview", func(c *gin.Context) {
		var in adjustment.PreviewInput
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		preview, err := d.Adjustments.Preview(c.Request.Context(), in)
		if err != nil {
			fail(c, adjustmentErrorStatus(err), err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": preview})
	})
	gp.POST("/execute", func(c *gin.Context) {
		var in adjustment.ExecuteInput
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		audit, err := d.Adjustments.Execute(c.Request.Context(), in, adjustmentOperator(c))
		if err != nil {
			c.JSON(adjustmentErrorStatus(err), gin.H{"error": err.Error(), "data": audit})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": audit})
	})
	gp.GET("/audits/:id/rollback-preview", func(c *gin.Context) {
		id, err := uintParam(c, "id")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		preview, err := d.Adjustments.RollbackPreview(c.Request.Context(), id)
		if err != nil {
			fail(c, adjustmentErrorStatus(err), err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": preview})
	})
	gp.POST("/rollback", func(c *gin.Context) {
		var in adjustment.RollbackInput
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		audit, err := d.Adjustments.Rollback(c.Request.Context(), in, adjustmentOperator(c))
		if err != nil {
			c.JSON(adjustmentErrorStatus(err), gin.H{"error": err.Error(), "data": audit})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": audit})
	})
}
