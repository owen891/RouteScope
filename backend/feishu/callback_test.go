package feishu

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
)

func TestCallbackChallengeAndTokenValidation(t *testing.T) {
	service, _, _ := newTestService(t, readyConfig())
	callback, err := NewCallback(service)
	if err != nil {
		t.Fatalf("NewCallback: %v", err)
	}

	t.Run("valid challenge", func(t *testing.T) {
		body := `{"challenge":"challenge-value","token":"test-verification-token","type":"url_verification"}`
		recorder := httptest.NewRecorder()
		callback.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callbacks/feishu", strings.NewReader(body)))
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
		}
		if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
			t.Fatalf("content-type = %q", contentType)
		}
		if strings.TrimSpace(recorder.Body.String()) != `{"challenge":"challenge-value"}` {
			t.Fatalf("body = %s", recorder.Body.String())
		}
	})

	t.Run("invalid verification token", func(t *testing.T) {
		body := `{"challenge":"challenge-value","token":"wrong-token","type":"url_verification"}`
		recorder := httptest.NewRecorder()
		callback.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callbacks/feishu", strings.NewReader(body)))
		if recorder.Code < 400 {
			t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
		}
		if strings.Contains(recorder.Body.String(), "test-verification-token") {
			t.Fatal("response exposed the configured verification token")
		}
	})
}

func TestCallbackRejectsInvalidSignatureAndCiphertext(t *testing.T) {
	cfg := readyConfig()
	cfg.EncryptKey = "test-encrypt-key"
	service, _, _ := newTestService(t, cfg)
	callback, err := NewCallback(service)
	if err != nil {
		t.Fatalf("NewCallback: %v", err)
	}
	plainEvent := `{"schema":"2.0","header":{"event_id":"evt-signature","event_type":"im.message.receive_v1","token":"test-verification-token"},"event":{}}`
	encryptedBodyBytes, err := json.Marshal(map[string]string{"encrypt": encryptEventForTest(t, plainEvent, cfg.EncryptKey)})
	if err != nil {
		t.Fatalf("marshal encrypted body: %v", err)
	}
	encryptedBody := string(encryptedBodyBytes)

	t.Run("missing signature", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		callback.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/callbacks/feishu", strings.NewReader(encryptedBody)))
		if recorder.Code < 400 {
			t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
		}
		if strings.Contains(recorder.Body.String(), encryptedBody) || strings.Contains(recorder.Body.String(), cfg.EncryptKey) {
			t.Fatal("response exposed callback ciphertext or Encrypt Key")
		}
	})

	t.Run("valid signature with damaged ciphertext", func(t *testing.T) {
		body := `{"encrypt":"not-valid-ciphertext"}`
		timestamp := "1721900000"
		nonce := "test-nonce"
		req := httptest.NewRequest(http.MethodPost, "/callbacks/feishu", strings.NewReader(body))
		req.Header.Set(larkevent.EventRequestTimestamp, timestamp)
		req.Header.Set(larkevent.EventRequestNonce, nonce)
		req.Header.Set(larkevent.EventSignature, larkevent.Signature(timestamp, nonce, cfg.EncryptKey, body))
		recorder := httptest.NewRecorder()
		callback.ServeHTTP(recorder, req)
		if recorder.Code < 400 {
			t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
		}
		if strings.Contains(recorder.Body.String(), body) || strings.Contains(recorder.Body.String(), cfg.EncryptKey) {
			t.Fatal("response exposed callback request or Encrypt Key")
		}
	})
}

func encryptEventForTest(t *testing.T, plain, secret string) string {
	t.Helper()
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatalf("NewCipher: %v", err)
	}
	padding := aes.BlockSize - len(plain)%aes.BlockSize
	padded := append([]byte(plain), bytes.Repeat([]byte{byte(padding)}, padding)...)
	iv := []byte("0123456789abcdef")
	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ciphertext, padded)
	payload := append(append([]byte{}, iv...), ciphertext...)
	return base64.StdEncoding.EncodeToString(payload)
}
