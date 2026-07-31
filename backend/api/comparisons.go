package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/bejix/upstream-ops/backend/comparison"
	"github.com/gin-gonic/gin"
)

func registerComparisons(g *gin.RouterGroup, d *Deps) {
	gc := g.Group("/comparisons")
	gc.GET("/rates", func(c *gin.Context) {
		if d.Comparisons == nil {
			fail(c, http.StatusServiceUnavailable, fmt.Errorf("comparisons unavailable"))
			return
		}
		q := strings.TrimSpace(c.Query("q"))
		dev := 20.0
		if s := strings.TrimSpace(c.Query("deviation_pct")); s != "" {
			if v, err := strconv.ParseFloat(s, 64); err == nil {
				dev = v
			}
		}
		res, err := d.Comparisons.CompareRates(q, dev)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": res})
	})
	gc.GET("/rates/export", func(c *gin.Context) {
		if d.Comparisons == nil {
			fail(c, http.StatusServiceUnavailable, fmt.Errorf("comparisons unavailable"))
			return
		}
		q := strings.TrimSpace(c.Query("q"))
		dev := 20.0
		if s := strings.TrimSpace(c.Query("deviation_pct")); s != "" {
			if v, err := strconv.ParseFloat(s, 64); err == nil {
				dev = v
			}
		}
		res, err := d.Comparisons.CompareRates(q, dev)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		format := strings.ToLower(strings.TrimSpace(c.DefaultQuery("format", "json")))
		switch format {
		case "csv":
			c.Header("Content-Disposition", `attachment; filename="rate-comparisons.csv"`)
			c.Header("Content-Type", "text/csv; charset=utf-8")
			w := csv.NewWriter(c.Writer)
			_ = w.Write([]string{
				"model_name", "channel_id", "channel_name", "channel_type",
				"ratio", "completion_ratio", "median_ratio", "deviation_pct", "outlier",
				"last_seen_at", "last_change_at", "last_old_ratio", "last_new_ratio",
			})
			for _, m := range res.Models {
				for _, e := range m.Entries {
					lastChange := ""
					if e.LastChangeAt != nil {
						lastChange = e.LastChangeAt.Format(timeRFC3339)
					}
					oldR, newR := "", ""
					if e.LastOldRatio != nil {
						oldR = strconv.FormatFloat(*e.LastOldRatio, 'f', -1, 64)
					}
					if e.LastNewRatio != nil {
						newR = strconv.FormatFloat(*e.LastNewRatio, 'f', -1, 64)
					}
					_ = w.Write([]string{
						m.ModelName,
						strconv.FormatUint(uint64(e.ChannelID), 10),
						e.ChannelName,
						e.ChannelType,
						strconv.FormatFloat(e.Ratio, 'f', -1, 64),
						strconv.FormatFloat(e.CompletionRatio, 'f', -1, 64),
						strconv.FormatFloat(m.MedianRatio, 'f', -1, 64),
						strconv.FormatFloat(e.DeviationPct, 'f', 2, 64),
						strconv.FormatBool(e.Outlier),
						e.LastSeenAt.Format(timeRFC3339),
						lastChange,
						oldR,
						newR,
					})
				}
			}
			w.Flush()
		default:
			c.Header("Content-Disposition", `attachment; filename="rate-comparisons.json"`)
			c.Header("Content-Type", "application/json; charset=utf-8")
			enc := json.NewEncoder(c.Writer)
			enc.SetIndent("", "  ")
			_ = enc.Encode(res)
		}
	})
}

// keep comparison package referenced when only used via Deps in other files of package api.
var _ = comparison.NewService

const timeRFC3339 = "2006-01-02T15:04:05Z07:00"
