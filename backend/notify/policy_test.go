package notify

import (
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/storage"
)

func TestBuildRateBatchMessageIncludesBalanceAndRatioLayout(t *testing.T) {
	bal := 12.5
	ch := &storage.Channel{
		ID:               1,
		Name:             "魔法AI",
		SiteURL:          "https://example.com",
		LastBalance:      &bal,
		BalanceThreshold: 2,
	}
	msg := BuildRateBatchMessage(ch, storage.EventRateChanged, []RateChange{{
		GroupName: "Pro",
		OldRatio:  0.1,
		NewRatio:  0.12,
	}})
	if !strings.Contains(msg.Subject, "倍率变化") {
		t.Fatalf("subject = %q", msg.Subject)
	}
	for _, want := range []string{"渠道：魔法AI", "余额：12.5000", "阈值：2.0000", "0.1 → 0.12", "+20.00%"} {
		if !strings.Contains(msg.Body, want) {
			t.Fatalf("body missing %q\n%s", want, msg.Body)
		}
	}
}

func TestBuildLoginFailedMessageHumanizesAndShowsBalance(t *testing.T) {
	bal := 3.14
	ch := &storage.Channel{ID: 2, Name: "测试站", LastBalance: &bal}
	msg := BuildLoginFailedMessage(ch, errString("sub2api refresh token: status 401: invalid refresh token"))
	if msg.Event != storage.EventLoginFailed {
		t.Fatalf("event = %s", msg.Event)
	}
	if !strings.Contains(msg.Body, "最近余额：3.1400") {
		t.Fatalf("body = %s", msg.Body)
	}
	if !strings.Contains(msg.Body, "登录态失效") {
		t.Fatalf("expected humanized reason, body = %s", msg.Body)
	}
}

type simpleErr string

func (e simpleErr) Error() string { return string(e) }

func errString(s string) error { return simpleErr(s) }
