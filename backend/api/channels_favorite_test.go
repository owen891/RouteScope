package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/channel"
	"github.com/bejix/upstream-ops/backend/storage"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type favoriteChannelServiceStub struct {
	*channel.Service
	updated      *storage.Channel
	err          error
	lastID       uint
	lastFavorite bool
}

func (s *favoriteChannelServiceStub) SetFavorite(id uint, favorite bool) (*storage.Channel, error) {
	s.lastID = id
	s.lastFavorite = favorite
	if s.err != nil {
		return nil, s.err
	}
	updated := *s.updated
	updated.ID = id
	updated.Favorite = favorite
	return &updated, nil
}

func favoriteRouter(stub *favoriteChannelServiceStub) *gin.Engine {
	r := gin.New()
	registerChannels(r.Group("/api"), &Deps{ChannelSvc: stub})
	return r
}

func favoriteRequest(t *testing.T, r http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestSetChannelFavorite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &favoriteChannelServiceStub{updated: &storage.Channel{
		Name:           "favorite-channel",
		Type:           storage.ChannelTypeNewAPI,
		SiteURL:        "https://favorite.example.com",
		Username:       "operator",
		PasswordCipher: "encrypted-secret",
	}}
	r := favoriteRouter(stub)

	for _, tc := range []struct {
		name     string
		body     string
		favorite bool
	}{
		{name: "favorite", body: `{"favorite":true}`, favorite: true},
		{name: "unfavorite", body: `{"favorite":false}`, favorite: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := favoriteRequest(t, r, "/api/channels/42/favorite", tc.body)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if stub.lastID != 42 || stub.lastFavorite != tc.favorite {
				t.Fatalf("service call = (%d, %t), want (42, %t)", stub.lastID, stub.lastFavorite, tc.favorite)
			}
			var response struct {
				Data storage.Channel `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Data.ID != 42 || response.Data.Favorite != tc.favorite {
				t.Fatalf("response channel = %#v", response.Data)
			}
		})
	}
}

func TestSetChannelFavoriteValidationAndNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &favoriteChannelServiceStub{updated: &storage.Channel{}}
	r := favoriteRouter(stub)

	for _, tc := range []struct {
		name string
		path string
		body string
	}{
		{name: "missing field", path: "/api/channels/1/favorite", body: `{}`},
		{name: "invalid id", path: "/api/channels/nope/favorite", body: `{"favorite":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := favoriteRequest(t, r, tc.path, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
		})
	}

	stub.err = gorm.ErrRecordNotFound
	rec := favoriteRequest(t, r, "/api/channels/404/favorite", `{"favorite":true}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("not found status = %d, body = %s", rec.Code, rec.Body.String())
	}

	stub.err = errors.New("database unavailable")
	rec = favoriteRequest(t, r, "/api/channels/1/favorite", `{"favorite":true}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("internal error status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
