package observation

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

// ProbeService runs health probes and records HealthProbeRun + health observations.
type ProbeService struct {
	probes   *storage.HealthProbes
	channels *storage.Channels
	obs      *Recorder
	client   *http.Client
}

func NewProbeService(probes *storage.HealthProbes, channels *storage.Channels, obs *Recorder) *ProbeService {
	return &ProbeService{
		probes:   probes,
		channels: channels,
		obs:      obs,
		client:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *ProbeService) Run(ctx context.Context, configID uint) (*storage.HealthProbeRun, error) {
	cfg, err := s.probes.FindConfig(configID)
	if err != nil {
		return nil, err
	}
	url := strings.TrimSpace(cfg.URL)
	var channelID *uint
	if cfg.ChannelID != nil {
		channelID = cfg.ChannelID
		if url == "" {
			ch, err := s.channels.FindByID(*cfg.ChannelID)
			if err != nil {
				return nil, err
			}
			// Reachability probe against site root when no explicit URL is configured.
			url = strings.TrimRight(strings.TrimSpace(ch.SiteURL), "/")
		}
	}
	if url == "" {
		return nil, fmt.Errorf("probe url is empty")
	}
	timeout := time.Duration(cfg.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	started := time.Now()
	resp, err := s.client.Do(req)
	finished := time.Now()
	run := &storage.HealthProbeRun{
		ConfigID:   cfg.ID,
		ChannelID:  channelID,
		URL:        url,
		StartedAt:  started,
		FinishedAt: finished,
		LatencyMS:  finished.Sub(started).Milliseconds(),
	}
	if err != nil {
		run.Success = false
		run.ErrorClass = classifyProbeError(err)
		run.ErrorMessage = err.Error()
	} else {
		defer resp.Body.Close()
		run.StatusCode = resp.StatusCode
		run.Success = resp.StatusCode >= 200 && resp.StatusCode < 500
		if !run.Success {
			run.ErrorClass = "http_error"
			run.ErrorMessage = fmt.Sprintf("status %d", resp.StatusCode)
		}
	}
	if err := s.probes.AppendRun(run); err != nil {
		return nil, err
	}
	if channelID != nil && s.obs != nil {
		s.obs.RecordHealth(*channelID, storage.ObservationSourceProbe, run.Success, run.StatusCode, run.LatencyMS, run.ErrorClass, run.ErrorMessage, started)
	}
	return run, nil
}

func classifyProbeError(err error) string {
	if err == nil {
		return ""
	}
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		return "timeout"
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "timeout"), strings.Contains(s, "deadline exceeded"):
		return "timeout"
	case strings.Contains(s, "no such host"), strings.Contains(s, "dns"):
		return "dns"
	case strings.Contains(s, "connection refused"), strings.Contains(s, "network is unreachable"):
		return "network"
	case strings.Contains(s, "tls"), strings.Contains(s, "x509"), strings.Contains(s, "certificate"):
		return "tls"
	default:
		return "request_error"
	}
}
