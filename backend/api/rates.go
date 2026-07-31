package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func registerRates(g *gin.RouterGroup, d *Deps) {
	g.GET("/rate-changes", func(c *gin.Context) {
		var channelID uint
		if s := c.Query("channel_id"); s != "" {
			id, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			channelID = uint(id)
		}
		page, pageSize, err := parsePageQuery(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		var remoteGroupID *int64
		if value := strings.TrimSpace(c.Query("remote_group_id")); value != "" {
			id, parseErr := strconv.ParseInt(value, 10, 64)
			if parseErr != nil || id <= 0 {
				fail(c, http.StatusBadRequest, errors.New("remote_group_id must be a positive integer"))
				return
			}
			remoteGroupID = &id
		}
		modelName := strings.TrimSpace(c.Query("model_name"))
		list, total, err := d.Rates.ListChangesPage(channelID, remoteGroupID, modelName, page, pageSize)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		pages := 1
		if total > 0 {
			pages = int((total + int64(pageSize) - 1) / int64(pageSize))
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"items":     list,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
			"pages":     pages,
		}})
	})
}
