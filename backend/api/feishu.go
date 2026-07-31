package api

import (
	"errors"
	"net/http"
	"strings"

	control "github.com/bejix/upstream-ops/backend/feishu"
	"github.com/gin-gonic/gin"
)

func registerFeishuCallback(r *gin.Engine, d *Deps) {
	path := strings.TrimSpace(d.FeishuCallbackPath)
	if path == "" {
		path = "/callbacks/feishu"
	}
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "/api/") || path == "/healthz" {
		path = "/callbacks/feishu"
	}
	if d.FeishuCallback == nil {
		r.POST(path, func(c *gin.Context) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "feishu callback is not configured"})
		})
		return
	}
	r.POST(path, gin.WrapH(d.FeishuCallback))
}

func registerFeishu(g *gin.RouterGroup, d *Deps) {
	group := g.Group("/feishu")
	group.GET("/status", func(c *gin.Context) {
		if d.Feishu == nil {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{
				"enabled":       false,
				"configured":    false,
				"callback_path": "/callbacks/feishu",
				"bound":         false,
			}})
			return
		}
		status, err := d.Feishu.Status()
		if err != nil {
			fail(c, http.StatusInternalServerError, errors.New("read feishu control status failed"))
			return
		}
		status.AdminAuthEnabled = d.Runtime != nil && d.Runtime.CurrentAuth() != nil
		c.JSON(http.StatusOK, gin.H{"data": status})
	})
	group.POST("/binding-code", func(c *gin.Context) {
		if !requireFeishuAdminAuth(c, d) {
			return
		}
		if d.Feishu == nil {
			fail(c, http.StatusServiceUnavailable, control.ErrNotConfigured)
			return
		}
		code, err := d.Feishu.GenerateBindingCode(c.Request.Context())
		if err != nil {
			switch {
			case errors.Is(err, control.ErrDisabled), errors.Is(err, control.ErrNotConfigured):
				fail(c, http.StatusServiceUnavailable, err)
			case errors.Is(err, control.ErrAlreadyBound):
				fail(c, http.StatusConflict, err)
			default:
				fail(c, http.StatusInternalServerError, errors.New("create feishu binding code failed"))
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": code})
	})
	group.DELETE("/binding", func(c *gin.Context) {
		if !requireFeishuAdminAuth(c, d) {
			return
		}
		if d.Feishu == nil {
			fail(c, http.StatusServiceUnavailable, control.ErrNotConfigured)
			return
		}
		if err := d.Feishu.Unbind(c.Request.Context()); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("clear feishu binding failed"))
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
	})
}

func requireFeishuAdminAuth(c *gin.Context, d *Deps) bool {
	if d.Runtime == nil || d.Runtime.CurrentAuth() == nil {
		fail(c, http.StatusServiceUnavailable, errors.New("administrator authentication must be enabled for Feishu binding changes"))
		return false
	}
	return true
}
