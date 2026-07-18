package api

import (
	"net/http"
	"strings"

	"github.com/bejix/upstream-ops/backend/config"
	"github.com/gin-gonic/gin"
)

type settingsConfigView struct {
	App           config.AppConfig           `json:"app"`
	Auth          settingsAuthView           `json:"auth"`
	Scheduler     config.SchedulerConfig     `json:"scheduler"`
	Notifications config.NotificationsConfig `json:"notifications"`
	Proxy         settingsProxyView          `json:"proxy"`
	Upstream      config.UpstreamConfig      `json:"upstream"`
}

type settingsConfigInput struct {
	App           config.AppConfig           `json:"app" binding:"required"`
	Auth          settingsAuthInput          `json:"auth" binding:"required"`
	Scheduler     config.SchedulerConfig     `json:"scheduler" binding:"required"`
	Notifications config.NotificationsConfig `json:"notifications" binding:"required"`
	Proxy         settingsProxyInput         `json:"proxy"`
	Upstream      config.UpstreamConfig      `json:"upstream"`
}

type settingsAuthView struct {
	Enabled               bool   `json:"enabled"`
	Username              string `json:"username"`
	PasswordConfigured    bool   `json:"passwordConfigured"`
	TokenSecretConfigured bool   `json:"tokenSecretConfigured"`
	SessionTTLHours       int    `json:"sessionTTLHours"`
}

type settingsAuthInput struct {
	Enabled                bool    `json:"enabled"`
	Username               string  `json:"username"`
	PasswordReplacement    *string `json:"passwordReplacement"`
	TokenSecretReplacement *string `json:"tokenSecretReplacement"`
	SessionTTLHours        int     `json:"sessionTTLHours"`
}

type settingsProxyView struct {
	Enabled             bool   `json:"enabled"`
	VersionCheckEnabled bool   `json:"versionCheckEnabled"`
	Protocol            string `json:"protocol"`
	Host                string `json:"host"`
	Port                int    `json:"port"`
	Username            string `json:"username"`
	PasswordConfigured  bool   `json:"passwordConfigured"`
}

type settingsProxyInput struct {
	Enabled             bool    `json:"enabled"`
	VersionCheckEnabled bool    `json:"versionCheckEnabled"`
	Protocol            string  `json:"protocol"`
	Host                string  `json:"host"`
	Port                int     `json:"port"`
	Username            string  `json:"username"`
	PasswordReplacement *string `json:"passwordReplacement"`
}

func registerSettings(g *gin.RouterGroup, d *Deps) {
	gs := g.Group("/settings")
	gs.GET("/config", func(c *gin.Context) { getSettingsConfig(c, d) })
	gs.PUT("/config", func(c *gin.Context) { saveSettingsConfig(c, d) })
	gs.POST("/apply", func(c *gin.Context) { applySettingsConfig(c, d) })
	gs.POST("/proxy/test", func(c *gin.Context) { testProxy(c) })
}

func getSettingsConfig(c *gin.Context, d *Deps) {
	cfg, err := config.Load(d.Runtime.ConfigPath())
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"config_path": d.Runtime.ConfigPath(),
			"config": settingsConfigView{
				App: cfg.App,
				Auth: settingsAuthView{
					Enabled:               cfg.Auth.Enabled,
					Username:              cfg.Auth.Username,
					PasswordConfigured:    strings.TrimSpace(cfg.Auth.Password) != "",
					TokenSecretConfigured: strings.TrimSpace(cfg.Auth.TokenSecret) != "" || strings.TrimSpace(cfg.Security.AppSecret) != "",
					SessionTTLHours:       cfg.Auth.SessionTTLHours,
				},
				Scheduler:     cfg.Scheduler,
				Notifications: cfg.Notifications,
				Proxy: settingsProxyView{
					Enabled:             cfg.Proxy.Enabled,
					VersionCheckEnabled: cfg.Proxy.VersionCheckEnabled,
					Protocol:            cfg.Proxy.Protocol,
					Host:                cfg.Proxy.Host,
					Port:                cfg.Proxy.Port,
					Username:            cfg.Proxy.Username,
					PasswordConfigured:  strings.TrimSpace(cfg.Proxy.Password) != "",
				},
				Upstream: cfg.Upstream,
			},
		},
	})
}

func saveSettingsConfig(c *gin.Context, d *Deps) {
	var in settingsConfigInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}

	path := d.Runtime.ConfigPath()
	cfg, err := config.LoadFile(path)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}

	cfg.App.Title = in.App.Title
	cfg.App.NotificationPrefix = in.App.NotificationPrefix
	cfg.Auth.Enabled = in.Auth.Enabled
	cfg.Auth.Username = in.Auth.Username
	cfg.Auth.SessionTTLHours = in.Auth.SessionTTLHours
	applySecretReplacement(&cfg.Auth.Password, in.Auth.PasswordReplacement)
	applySecretReplacement(&cfg.Auth.TokenSecret, in.Auth.TokenSecretReplacement)
	cfg.Scheduler = in.Scheduler
	cfg.Notifications = in.Notifications
	cfg.Proxy.Enabled = in.Proxy.Enabled
	cfg.Proxy.VersionCheckEnabled = in.Proxy.VersionCheckEnabled
	cfg.Proxy.Protocol = in.Proxy.Protocol
	cfg.Proxy.Host = in.Proxy.Host
	cfg.Proxy.Port = in.Proxy.Port
	cfg.Proxy.Username = in.Proxy.Username
	applySecretReplacement(&cfg.Proxy.Password, in.Proxy.PasswordReplacement)
	cfg.Upstream = in.Upstream.WithDefaults()

	if err := config.Save(path, cfg); err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"config_path": path,
			"message":     "已写入配置文件",
		},
	})
}

func applySecretReplacement(current *string, replacement *string) {
	if replacement != nil && strings.TrimSpace(*replacement) != "" {
		*current = *replacement
	}
}

func applySettingsConfig(c *gin.Context, d *Deps) {
	result, err := d.Runtime.ApplyFromFile()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}
