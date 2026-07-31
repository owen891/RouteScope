package api

import (
	"errors"
	"net/http"
	"os"
	"strconv"
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
	Gateway       config.GatewayConfig       `json:"gateway"`
}

type settingsConfigInput struct {
	App           config.AppConfig           `json:"app" binding:"required"`
	Auth          settingsAuthInput          `json:"auth" binding:"required"`
	Scheduler     config.SchedulerConfig     `json:"scheduler" binding:"required"`
	Notifications config.NotificationsConfig `json:"notifications" binding:"required"`
	Proxy         settingsProxyInput         `json:"proxy"`
	Upstream      config.UpstreamConfig      `json:"upstream"`
	Gateway       config.GatewayConfig       `json:"gateway"`
}

type settingsAuthView struct {
	Enabled               bool     `json:"enabled"`
	Username              string   `json:"username"`
	PasswordConfigured    bool     `json:"passwordConfigured"`
	TokenSecretConfigured bool     `json:"tokenSecretConfigured"`
	EnvironmentOverrides  []string `json:"environmentOverrides"`
	SessionTTLHours       int      `json:"sessionTTLHours"`
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
					EnvironmentOverrides:  authEnvironmentOverrides(),
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
				Upstream: cfg.Upstream.WithDefaults(),
				Gateway:  cfg.Gateway.WithDefaults(),
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
	if err := validateAuthEnvironmentOverrides(in.Auth); err != nil {
		fail(c, http.StatusConflict, err)
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
	if replaceSecret(&cfg.Auth.Password, in.Auth.PasswordReplacement) {
		cfg.Auth.TokenVersion++
		if cfg.Auth.TokenVersion == 0 {
			cfg.Auth.TokenVersion = 1
		}
	}
	replaceSecret(&cfg.Auth.TokenSecret, in.Auth.TokenSecretReplacement)
	cfg.Scheduler = in.Scheduler
	cfg.Notifications = in.Notifications
	cfg.Proxy.Enabled = in.Proxy.Enabled
	cfg.Proxy.VersionCheckEnabled = in.Proxy.VersionCheckEnabled
	cfg.Proxy.Protocol = in.Proxy.Protocol
	cfg.Proxy.Host = in.Proxy.Host
	cfg.Proxy.Port = in.Proxy.Port
	cfg.Proxy.Username = in.Proxy.Username
	replaceSecret(&cfg.Proxy.Password, in.Proxy.PasswordReplacement)
	cfg.Upstream = in.Upstream.WithDefaults()
	cfg.Gateway = in.Gateway.WithDefaults()
	if err := validateSettingsAuthentication(cfg); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}

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

func validateSettingsAuthentication(fileCfg *config.Config) error {
	effective, err := config.ApplyEnvironmentOverrides(fileCfg)
	if err != nil {
		return err
	}
	if config.RequiresAdminAuth(effective.Server.Mode) && !effective.Auth.Enabled {
		return errors.New("authentication must be enabled in release or production mode")
	}
	if !effective.Auth.Enabled {
		return nil
	}
	if strings.TrimSpace(effective.Auth.Username) == "" || strings.TrimSpace(effective.Auth.Password) == "" {
		return errors.New("enabled authentication requires an administrator username and password")
	}
	if strings.TrimSpace(effective.Auth.TokenSecret) == "" && strings.TrimSpace(effective.Security.AppSecret) == "" {
		return errors.New("enabled authentication requires an auth token secret or APP_SECRET")
	}
	return nil
}

func replaceSecret(current *string, replacement *string) bool {
	if replacement != nil && strings.TrimSpace(*replacement) != "" {
		if *current == *replacement {
			return false
		}
		*current = *replacement
		return true
	}
	return false
}

func authEnvironmentOverrides() []string {
	fields := []struct {
		name  string
		field string
	}{
		{name: "AUTH_ENABLED", field: "enabled"},
		{name: "ADMIN_USERNAME", field: "username"},
		{name: "ADMIN_PASSWORD", field: "password"},
		{name: "AUTH_TOKEN_SECRET", field: "tokenSecret"},
	}
	overrides := make([]string, 0, len(fields))
	for _, item := range fields {
		if strings.TrimSpace(os.Getenv(item.name)) != "" {
			overrides = append(overrides, item.field)
		}
	}
	return overrides
}

func validateAuthEnvironmentOverrides(in settingsAuthInput) error {
	for _, field := range authEnvironmentOverrides() {
		switch field {
		case "enabled":
			effective, err := strconv.ParseBool(strings.TrimSpace(os.Getenv("AUTH_ENABLED")))
			if err != nil {
				return errors.New("AUTH_ENABLED must be a boolean when set")
			}
			if in.Enabled != effective {
				return errors.New("AUTH_ENABLED controls the effective authentication state; update the deployment environment first")
			}
		case "username":
			if in.Username != os.Getenv("ADMIN_USERNAME") {
				return errors.New("ADMIN_USERNAME controls the effective administrator username; update the deployment environment first")
			}
		case "password":
			if in.PasswordReplacement != nil && strings.TrimSpace(*in.PasswordReplacement) != "" {
				return errors.New("ADMIN_PASSWORD is environment-managed; rotate it in the deployment environment")
			}
		case "tokenSecret":
			if in.TokenSecretReplacement != nil && strings.TrimSpace(*in.TokenSecretReplacement) != "" {
				return errors.New("AUTH_TOKEN_SECRET is environment-managed; rotate it in the deployment environment")
			}
		}
	}
	return nil
}

func applySettingsConfig(c *gin.Context, d *Deps) {
	result, err := d.Runtime.ApplyFromFile()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}
