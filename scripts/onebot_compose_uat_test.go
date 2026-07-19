package scripts

import (
	"os"
	"strings"
	"testing"
)

func TestOneBotComposeUATContract(t *testing.T) {
	compose, err := os.ReadFile("../docker-compose.onebot-uat.yml")
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"onebot-fixture", "onebot-check", "depends_on", "healthcheck", "18419", "uat-only-app-secret-not-production"} {
		if !strings.Contains(string(compose), required) {
			t.Errorf("compose UAT missing %q", required)
		}
	}
	for _, name := range []string{"onebot-compose-uat.ps1", "onebot-compose-uat.sh"} {
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "onebot-check") || !strings.Contains(string(body), "not real QQ delivery") {
			t.Errorf("%s missing explicit UAT boundary", name)
		}
	}
}
