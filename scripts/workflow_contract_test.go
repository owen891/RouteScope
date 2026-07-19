package scripts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestWorkflowContracts(t *testing.T) {
	root := repositoryRoot(t)
	quality := readWorkflow(t, filepath.Join(root, ".github", "workflows", "quality.yml"))
	publish := readWorkflow(t, filepath.Join(root, ".github", "workflows", "publish.yml"))

	assertQualityWorkflow(t, quality)
	assertPublishWorkflow(t, publish)
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	root := filepath.Dir(wd)
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("resolve repository root from %s: %v", wd, err)
	}
	return root
}

func readWorkflow(t *testing.T, path string) *yaml.Node {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read workflow %s: %v", path, err)
	}
	var node yaml.Node
	if err := yaml.Unmarshal(contents, &node); err != nil {
		t.Fatalf("parse workflow %s: %v", path, err)
	}
	if node.Kind != yaml.DocumentNode || len(node.Content) != 1 {
		t.Fatalf("workflow %s is not a YAML document", path)
	}
	return node.Content[0]
}

func assertQualityWorkflow(t *testing.T, root *yaml.Node) {
	t.Helper()
	triggers := requiredMap(t, root, "on")
	for _, trigger := range []string{"push", "pull_request", "workflow_dispatch", "workflow_call"} {
		if mapValue(triggers, trigger) == nil {
			t.Errorf("quality workflow missing %s trigger", trigger)
		}
	}
	push := requiredMap(t, triggers, "push")
	if !sequenceContains(mapValue(push, "branches-ignore"), "main") {
		t.Error("quality push trigger must cover feature branches by ignoring main")
	}
	assertOnlyPermissions(t, root, "contents", "read")
	assertNoSecrets(t, root, "quality workflow")

	jobs := requiredMap(t, root, "jobs")
	for _, job := range []string{"backend", "frontend", "compose", "windows"} {
		if mapValue(jobs, job) == nil {
			t.Errorf("quality workflow missing %s job", job)
		}
	}
	assertJobCommand(t, jobs, "backend", "go test ./scripts -run '^(TestBashSecurityTools|TestOneBotUATScriptsAreExplicitAndRedacted|TestWorkflowContracts)$' -count=1")
	assertJobCommand(t, jobs, "backend", "go test ./... -count=1")
	assertJobCommand(t, jobs, "frontend", "pnpm install --frozen-lockfile")
	assertJobCommand(t, jobs, "frontend", "pnpm lint")
	assertJobCommand(t, jobs, "frontend", "pnpm test")
	assertJobCommand(t, jobs, "frontend", "pnpm build")
	assertJobCommand(t, jobs, "frontend", "pnpm exec playwright install --with-deps chromium")
	assertJobCommand(t, jobs, "frontend", "pnpm test:e2e")
	assertJobCommand(t, jobs, "compose", "docker compose config --quiet")
	assertJobCommand(t, jobs, "windows", "go test ./scripts -run '^(TestOneBotUATScriptsAreExplicitAndRedacted|TestPowerShellSecurityTools)$' -count=1")
	assertNoScalar(t, root, "continue-on-error")
	assertScalar(t, root, "10.4.0")
	assertScalar(t, root, "20")
}

func assertPublishWorkflow(t *testing.T, root *yaml.Node) {
	t.Helper()
	assertOnlyPermissions(t, root, "contents", "read")
	jobs := requiredMap(t, root, "jobs")
	quality := requiredMap(t, jobs, "quality")
	if scalarValue(mapValue(quality, "uses")) != "./.github/workflows/quality.yml" {
		t.Error("publish quality job must call the local reusable quality workflow")
	}
	build := requiredMap(t, jobs, "build-and-push")
	if !sequenceContains(mapValue(build, "needs"), "quality") && scalarValue(mapValue(build, "needs")) != "quality" {
		t.Error("build-and-push must need quality")
	}
	assertOnlyPermissions(t, build, "contents", "read", "packages", "write")
	assertJobCommand(t, jobs, "build-and-push", "docker/login-action@v3")
	assertJobCommand(t, jobs, "build-and-push", "docker/build-push-action@v5")
	if !containsScalar(build, "secrets.GITHUB_TOKEN") {
		t.Error("build-and-push must use GITHUB_TOKEN for GHCR authentication")
	}
	for key, value := range mappingValues(jobs) {
		if key == "build-and-push" || key == "quality" {
			continue
		}
		if containsScalar(value, "docker/login-action@") || containsScalar(value, "docker/build-push-action@") {
			t.Errorf("registry login/build is outside build-and-push job: %s", key)
		}
	}
}

func assertJobCommand(t *testing.T, jobs *yaml.Node, job, want string) {
	t.Helper()
	value := mapValue(jobs, job)
	if value == nil || !containsScalar(value, want) {
		t.Errorf("%s job missing exact command %q", job, want)
	}
}

func assertOnlyPermissions(t *testing.T, node *yaml.Node, allowed ...string) {
	t.Helper()
	permissions := requiredMap(t, node, "permissions")
	if len(permissions.Content) != len(allowed) {
		t.Errorf("unexpected permissions: %s", scalarValue(permissions))
	}
	for i := 0; i < len(allowed); i += 2 {
		if scalarValue(mapValue(permissions, allowed[i])) != allowed[i+1] {
			t.Errorf("permission %s must be %s", allowed[i], allowed[i+1])
		}
	}
}

func assertNoSecrets(t *testing.T, node *yaml.Node, label string) {
	t.Helper()
	if containsScalar(node, "secrets.") {
		t.Errorf("%s must not reference secrets", label)
	}
}

func assertNoScalar(t *testing.T, node *yaml.Node, value string) {
	t.Helper()
	if containsScalar(node, value) {
		t.Errorf("workflow must not contain %q", value)
	}
}

func assertScalar(t *testing.T, node *yaml.Node, value string) {
	t.Helper()
	if !containsScalar(node, value) {
		t.Errorf("workflow missing %q", value)
	}
}

func requiredMap(t *testing.T, node *yaml.Node, key string) *yaml.Node {
	t.Helper()
	value := mapValue(node, key)
	if value == nil || value.Kind != yaml.MappingNode {
		t.Fatalf("missing mapping %q", key)
	}
	return value
}

func mapValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func mappingValues(node *yaml.Node) map[string]*yaml.Node {
	values := make(map[string]*yaml.Node)
	if node == nil || node.Kind != yaml.MappingNode {
		return values
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		values[node.Content[i].Value] = node.Content[i+1]
	}
	return values
}

func sequenceContains(node *yaml.Node, want string) bool {
	if node == nil || node.Kind != yaml.SequenceNode {
		return false
	}
	for _, item := range node.Content {
		if item.Value == want {
			return true
		}
	}
	return false
}

func scalarValue(node *yaml.Node) string {
	if node == nil || node.Kind != yaml.ScalarNode {
		return ""
	}
	return node.Value
}

func containsScalar(node *yaml.Node, want string) bool {
	if node == nil {
		return false
	}
	if node.Kind == yaml.ScalarNode && strings.Contains(node.Value, want) {
		return true
	}
	for _, child := range node.Content {
		if containsScalar(child, want) {
			return true
		}
	}
	return false
}
