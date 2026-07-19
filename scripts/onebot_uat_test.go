package scripts

import (
	"os"
	"strings"
	"testing"
)

func TestOneBotUATScriptsAreExplicitAndRedacted(t *testing.T) {
	for _, name := range []string{"onebot-uat.sh", "onebot-uat.ps1"} {
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		text := string(body)
		required := []string{"send_group_msg", "send_private_msg", "retcode", "message_id", "dry-run", "failure-case"}
		if strings.HasSuffix(name, ".ps1") {
			required = append(required, "Confirm")
		} else {
			required = append(required, "ONEBOT_CONFIRM")
		}
		for _, required := range required {
			if !strings.Contains(text, required) {
				t.Errorf("%s missing %q", name, required)
			}
		}
		if strings.Contains(text, "echo \"$ACCESS_TOKEN") || strings.Contains(text, "Write-Host $AccessToken") {
			t.Errorf("%s may print access token", name)
		}
	}
}
