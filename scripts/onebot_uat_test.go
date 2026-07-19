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
		if strings.HasSuffix(name, ".ps1") {
			for _, required := range []string{"GetResponseStream", "EvidencePath", "RealEndpoint", "real_endpoint", "ConvertTo-Json", "StatusCode", "message_id", "did not return a message_id", "failure-case"} {
				if !strings.Contains(text, required) {
					t.Errorf("%s must preserve HTTP failure evidence with %q", name, required)
				}
			}
		} else {
			for _, required := range []string{"EVIDENCE_PATH", "ONEBOT_REAL_ENDPOINT", "real_endpoint", "json.dump", "require_message_id", "check_response \"group\" \"$status\" 1", "check_response \"private\" \"$status\" 1"} {
				if !strings.Contains(text, required) {
					t.Errorf("%s must require message IDs and write evidence with %q", name, required)
				}
			}
			if strings.Contains(text, "group_target") || strings.Contains(text, "private_target") || strings.Contains(text, "failure_target") {
				t.Errorf("%s must not persist target IDs in external evidence", name)
			}
		}
	}
}
