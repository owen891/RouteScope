package scripts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseCandidateScripts(t *testing.T) {
	for _, name := range []string{"release-candidate.sh", "release-candidate.ps1"} {
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		text := string(body)
		for _, required := range []string{"docker", "build", "compose", "healthz", "candidate", "APP_SECRET"} {
			if !strings.Contains(text, required) {
				t.Errorf("%s missing release contract %q", name, required)
			}
		}
		for _, forbidden := range []string{"docker push", "GITHUB_TOKEN", "echo \"$APP_SECRET"} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s contains forbidden publication/secret output %q", name, forbidden)
			}
		}
	}
	if _, err := os.Stat(filepath.Join("..", "Dockerfile")); err != nil {
		t.Fatalf("release test must run from scripts directory: %v", err)
	}
}
