package feishu

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
	larkdispatcher "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
)

const maxCallbackBodyBytes = 1 << 20

type Callback struct {
	dispatcher *larkdispatcher.EventDispatcher
}

func NewCallback(service *Service) (*Callback, error) {
	if service == nil {
		return nil, errors.New("feishu service is nil")
	}
	if !service.Ready() {
		return nil, ErrNotConfigured
	}
	cfg := service.Config()
	dispatcher := larkdispatcher.NewEventDispatcher(cfg.VerificationToken, cfg.EncryptKey).
		OnP2MessageReceiveV1(service.HandleMessage).
		OnP2CardActionTrigger(service.HandleCardAction)
	dispatcher.InitConfig(larkevent.WithLogLevel(larkcore.LogLevelError))
	return &Callback{dispatcher: dispatcher}, nil
}

func (h *Callback) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCallbackBodyBytes))
	if err != nil {
		writeCallbackError(w, http.StatusBadRequest, "invalid callback request")
		return
	}
	resp := h.dispatcher.Handle(r.Context(), &larkevent.EventReq{
		Header:     r.Header.Clone(),
		Body:       body,
		RequestURI: r.RequestURI,
	})
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	if len(resp.Body) > 0 {
		_, _ = w.Write(resp.Body)
	}
}

func writeCallbackError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"msg": message})
}
