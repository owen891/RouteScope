package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bejix/upstream-ops/backend/routeadvice"
	"github.com/gin-gonic/gin"
)

type setPrimaryRouteInput struct {
	ModelName string `json:"model_name" binding:"required"`
	ChannelID uint   `json:"channel_id" binding:"required"`
	Confirm   bool   `json:"confirm"`
}

func registerRouteAdvice(g *gin.RouterGroup, d *Deps) {
	gp := g.Group("/route-advice")
	gp.GET("", func(c *gin.Context) {
		if d.RouteAdvice == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("route advice unavailable"))
			return
		}
		result, err := d.RouteAdvice.Advice(c.Query("model"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	})
	gp.GET("/primaries", func(c *gin.Context) {
		if d.RouteAdvice == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("route advice unavailable"))
			return
		}
		list, err := d.RouteAdvice.ListPrimaries()
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
	gp.GET("/audits", func(c *gin.Context) {
		if d.RouteAdvice == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("route advice unavailable"))
			return
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		list, err := d.RouteAdvice.ListAudits(strings.TrimSpace(c.Query("model")), limit)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
	gp.POST("/primary", func(c *gin.Context) {
		if d.RouteAdvice == nil {
			fail(c, http.StatusServiceUnavailable, errors.New("route advice unavailable"))
			return
		}
		var in setPrimaryRouteInput
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		operator := "admin"
		if subject, ok := c.Get("authSubject"); ok {
			if value, ok := subject.(string); ok && strings.TrimSpace(value) != "" {
				operator = value
			}
		}
		primary, changed, err := d.RouteAdvice.SetPrimary(in.ModelName, in.ChannelID, operator, in.Confirm)
		if err != nil {
			switch {
			case errors.Is(err, routeadvice.ErrConfirmationRequired), errors.Is(err, routeadvice.ErrCandidateNotFound):
				fail(c, http.StatusBadRequest, err)
			case errors.Is(err, routeadvice.ErrCandidateIneligible):
				fail(c, http.StatusConflict, err)
			default:
				fail(c, http.StatusInternalServerError, err)
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"primary": primary, "changed": changed}})
	})
}
