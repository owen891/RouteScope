package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/contextview"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func registerContextView(g *gin.RouterGroup, d *Deps) {
	if d.ContextView == nil {
		return
	}
	g.GET("/overview", func(c *gin.Context) {
		page, pageSize, err := parsePageQuery(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := d.ContextView.Overview(c.Request.Context(), page, pageSize)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	})
	g.GET("/channels/:id/context", func(c *gin.Context) {
		id, err := uintParam(c, "id")
		if err != nil || id == 0 {
			if err == nil {
				err = errors.New("valid channel id is required")
			}
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := d.ContextView.Channel(c.Request.Context(), id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, err)
			return
		}
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	})
	g.GET("/timeline", func(c *gin.Context) {
		page, pageSize, err := parsePageQuery(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		query := contextview.TimelineQuery{
			ResourceKind: strings.TrimSpace(c.Query("resource_kind")),
			Source:       strings.TrimSpace(c.Query("source")),
			Page:         page,
			PageSize:     pageSize,
		}
		if raw := strings.TrimSpace(c.Query("resource_id")); raw != "" {
			id, parseErr := strconv.ParseUint(raw, 10, 64)
			if parseErr != nil || id == 0 {
				fail(c, http.StatusBadRequest, errors.New("resource_id must be a positive integer"))
				return
			}
			query.ResourceID = uint(id)
		}
		if raw := strings.TrimSpace(c.Query("since")); raw != "" {
			value, parseErr := time.Parse(time.RFC3339, raw)
			if parseErr != nil {
				fail(c, http.StatusBadRequest, errors.New("since must be RFC3339"))
				return
			}
			query.Since = &value
		}
		if raw := strings.TrimSpace(c.Query("until")); raw != "" {
			value, parseErr := time.Parse(time.RFC3339, raw)
			if parseErr != nil {
				fail(c, http.StatusBadRequest, errors.New("until must be RFC3339"))
				return
			}
			query.Until = &value
		}
		result, err := d.ContextView.Timeline(c.Request.Context(), query)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	})
	g.GET("/resources/:kind/:id/deletion-precheck", func(c *gin.Context) {
		id, err := uintParam(c, "id")
		if err != nil || id == 0 {
			if err == nil {
				err = errors.New("valid resource id is required")
			}
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := d.ContextView.DeletePreflight(c.Request.Context(), strings.TrimSpace(c.Param("kind")), id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, err)
			return
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	})
}
