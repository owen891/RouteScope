package auth

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestLoginVerifyAndRejectTamperedToken(t *testing.T) {
	svc, err := New("admin", "correct-password", "test-secret", time.Hour)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	for _, credentials := range [][2]string{
		{"wrong-admin", "correct-password"},
		{"admin", "wrong-password"},
		{"wrong-admin", "wrong-password"},
	} {
		if _, _, err := svc.Login(credentials[0], credentials[1]); err == nil {
			t.Fatalf("expected invalid credentials error for username %q", credentials[0])
		}
	}
	token, expiresAt, err := svc.Login("admin", "correct-password")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if expiresAt.Before(time.Now().Add(59 * time.Minute)) {
		t.Fatalf("expiresAt = %v", expiresAt)
	}
	if subject, err := svc.Verify(token); err != nil || subject != "admin" {
		t.Fatalf("Verify = %q, %v", subject, err)
	}

	parts := strings.Split(token, ".")
	tampered := parts[0] + "." + strings.Repeat("A", len(parts[1]))
	if _, err := svc.Verify(tampered); err == nil {
		t.Fatal("expected tampered token to be rejected")
	}
}

func TestVerifyRejectsInvalidTokenClasses(t *testing.T) {
	svc, err := New("admin", "correct-password", "test-secret", time.Hour)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	tests := []struct {
		name  string
		token func() string
	}{
		{name: "missing separator", token: func() string { return "not-a-token" }},
		{name: "too many segments", token: func() string { return "a.b.c" }},
		{name: "invalid payload encoding", token: func() string { return "!.AA" }},
		{name: "invalid signature encoding", token: func() string { return "AA.!" }},
		{name: "expired", token: func() string {
			token, signErr := svc.sign(claims{Sub: "admin", Exp: time.Now().Add(-time.Minute).Unix()})
			if signErr != nil {
				t.Fatalf("sign expired token: %v", signErr)
			}
			return token
		}},
		{name: "wrong subject", token: func() string {
			token, signErr := svc.sign(claims{Sub: "other-admin", Exp: time.Now().Add(time.Hour).Unix()})
			if signErr != nil {
				t.Fatalf("sign wrong-subject token: %v", signErr)
			}
			return token
		}},
		{name: "signed malformed claims", token: func() string {
			payload := []byte("not-json")
			return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(svc.mac(payload))
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.Verify(tc.token()); err == nil {
				t.Fatal("Verify accepted invalid token")
			}
		})
	}
}

func TestMiddlewareProtectsAPIAndAllowsPublicRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc, err := New("admin", "correct-password", "test-secret", time.Hour)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	token, _, err := svc.Login("admin", "correct-password")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	router := gin.New()
	router.Use(svc.Middleware())
	router.GET("/healthz", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.GET("/api/version", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.POST("/api/auth/login", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.GET("/api/channels", func(c *gin.Context) {
		subject, _ := c.Get("authSubject")
		c.String(http.StatusOK, "%v", subject)
	})

	for _, path := range []string{"/healthz", "/api/version"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d", path, recorder.Code)
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/auth/login", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("POST /api/auth/login status = %d", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/channels", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/channels", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Body.String() != "admin" {
		t.Fatalf("authenticated response = %d %q", recorder.Code, recorder.Body.String())
	}

	for _, path := range []string{
		"/healthz/extra",
		"/api/version/details",
		"/api/auth/login/extra",
	} {
		recorder = httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("near-public GET %s status = %d, want 401", path, recorder.Code)
		}
	}
}
