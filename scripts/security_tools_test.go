package scripts

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	probePasswordSecret = "probe-password-secret-not-for-production"
	probeTokenSecret    = "probe-token-secret-not-for-production"
)

type securityToolRunner struct {
	command string
	prefix  []string
}

type securityToolPaths struct {
	root       string
	credential string
	probe      string
	envBefore  []byte
}

func TestBashSecurityTools(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Bash security tools are verified on Unix-family runners")
	}
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Fatalf("native Bash runner is required: %v", err)
	}
	runner := securityToolRunner{command: bash}
	paths := prepareSecurityTools(t, "print-auth-env.sh", "check-production.sh")

	assertCredentialHelper(t, runner, paths, []string{"operator-retained-password"})
	assertProductionProbe(t, runner, paths.probe)
}

func TestPowerShellSecurityTools(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("PowerShell security tools are verified on Windows runners")
	}
	powerShell, err := findPowerShell()
	if err != nil {
		t.Fatal(err)
	}
	runner := securityToolRunner{
		command: powerShell,
		prefix:  []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"},
	}
	paths := prepareSecurityTools(t, "print-auth-env.ps1", "check-production.ps1")

	assertCredentialHelper(t, runner, paths, []string{"-Password", "operator-retained-password"})
	assertProductionProbe(t, runner, paths.probe, "-BaseUrl")
}

func findPowerShell() (string, error) {
	for _, name := range []string{"powershell.exe", "powershell"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("native Windows PowerShell runner is required")
}

func prepareSecurityTools(t *testing.T, credentialName, probeName string) securityToolPaths {
	t.Helper()
	sourceDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	root := t.TempDir()
	scriptDir := filepath.Join(root, "scripts")
	if err := os.MkdirAll(scriptDir, 0o755); err != nil {
		t.Fatalf("create temporary scripts directory: %v", err)
	}
	for _, name := range []string{credentialName, probeName} {
		body, err := os.ReadFile(filepath.Join(sourceDir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if err := os.WriteFile(filepath.Join(scriptDir, name), body, 0o700); err != nil {
			t.Fatalf("copy %s: %v", name, err)
		}
	}
	envBefore := []byte("SENTINEL_ENV_CONTENT=unchanged\r\n")
	if err := os.WriteFile(filepath.Join(root, ".env"), envBefore, 0o600); err != nil {
		t.Fatalf("write sentinel .env: %v", err)
	}
	return securityToolPaths{
		root:       root,
		credential: filepath.Join(scriptDir, credentialName),
		probe:      filepath.Join(scriptDir, probeName),
		envBefore:  envBefore,
	}
}

func assertCredentialHelper(t *testing.T, runner securityToolRunner, paths securityToolPaths, suppliedArgs []string) {
	t.Helper()
	generatedOut, generatedErr, err := runSecurityTool(t, runner, paths.root, paths.credential, nil, nil)
	if err != nil {
		t.Fatalf("generated credential helper failed: %v\nstderr: %s", err, generatedErr)
	}
	generated := parseEnvBlock(t, generatedOut)
	assertCredentialBlock(t, generated, "")
	assertSecretsOnlyOnStdout(t, generated, generatedErr)
	assertEnvUnchanged(t, paths)

	suppliedOut, suppliedErr, err := runSecurityTool(t, runner, paths.root, paths.credential, suppliedArgs, nil)
	if err != nil {
		t.Fatalf("supplied-password credential helper failed: %v\nstderr: %s", err, suppliedErr)
	}
	supplied := parseEnvBlock(t, suppliedOut)
	assertCredentialBlock(t, supplied, "operator-retained-password")
	assertSecretsOnlyOnStdout(t, supplied, suppliedErr)
	assertEnvUnchanged(t, paths)

	if generated["ADMIN_PASSWORD"] == supplied["ADMIN_PASSWORD"] || generated["AUTH_TOKEN_SECRET"] == supplied["AUTH_TOKEN_SECRET"] {
		t.Fatal("generated credentials unexpectedly reused operator-supplied or previous values")
	}
}

func parseEnvBlock(t *testing.T, output []byte) map[string]string {
	t.Helper()
	values := make(map[string]string)
	for _, line := range strings.Split(strings.ReplaceAll(string(output), "\r\n", "\n"), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			values[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return values
}

func assertCredentialBlock(t *testing.T, values map[string]string, suppliedPassword string) {
	t.Helper()
	if values["AUTH_ENABLED"] != "true" || values["ADMIN_USERNAME"] != "admin" {
		t.Fatalf("credential block is not pasteable: %#v", values)
	}
	password := values["ADMIN_PASSWORD"]
	tokenSecret := values["AUTH_TOKEN_SECRET"]
	if suppliedPassword != "" {
		if password != suppliedPassword {
			t.Fatalf("supplied password changed: got %q", password)
		}
	} else if len(password) < 20 {
		t.Fatalf("generated password is too short: length %d", len(password))
	}
	if len(tokenSecret) < 32 {
		t.Fatalf("generated token secret is too short: length %d", len(tokenSecret))
	}
	for _, value := range []string{password, tokenSecret} {
		lower := strings.ToLower(value)
		if value == "" || strings.Contains(lower, "changeme") || strings.Contains(lower, "please-change") || strings.Contains(lower, "placeholder") {
			t.Fatalf("credential helper emitted an empty or placeholder value %q", value)
		}
	}
}

func assertSecretsOnlyOnStdout(t *testing.T, values map[string]string, stderr []byte) {
	t.Helper()
	for _, key := range []string{"ADMIN_PASSWORD", "AUTH_TOKEN_SECRET"} {
		if strings.Contains(string(stderr), values[key]) {
			t.Fatalf("%s leaked to stderr", key)
		}
	}
}

func assertEnvUnchanged(t *testing.T, paths securityToolPaths) {
	t.Helper()
	after, err := os.ReadFile(filepath.Join(paths.root, ".env"))
	if err != nil {
		t.Fatalf("read sentinel .env: %v", err)
	}
	if !bytes.Equal(after, paths.envBefore) {
		t.Fatalf("credential helper modified .env: before=%q after=%q", paths.envBefore, after)
	}
}

func assertProductionProbe(t *testing.T, runner securityToolRunner, probePath string, baseURLArg ...string) {
	t.Helper()
	tests := []struct {
		name              string
		healthStatus      int
		anonymousStatus   int
		healthRedirect    bool
		anonymousRedirect bool
		wantSuccess       bool
	}{
		{name: "health 200 and anonymous 401", healthStatus: http.StatusOK, anonymousStatus: http.StatusUnauthorized, wantSuccess: true},
		{name: "unhealthy health", healthStatus: http.StatusInternalServerError, anonymousStatus: http.StatusUnauthorized},
		{name: "health redirect", healthRedirect: true, anonymousStatus: http.StatusUnauthorized},
		{name: "anonymous redirect", healthStatus: http.StatusOK, anonymousRedirect: true},
		{name: "anonymous 200", healthStatus: http.StatusOK, anonymousStatus: http.StatusOK},
		{name: "anonymous 403", healthStatus: http.StatusOK, anonymousStatus: http.StatusForbidden},
		{name: "anonymous 500", healthStatus: http.StatusOK, anonymousStatus: http.StatusInternalServerError},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var credentialHeaderSeen atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				for _, header := range []string{"Authorization", "Proxy-Authorization", "Cookie"} {
					if r.Header.Get(header) != "" {
						credentialHeaderSeen.Store(true)
					}
				}
				switch r.URL.Path {
				case "/healthz":
					if tc.healthRedirect {
						http.Redirect(w, r, "/redirect-health-target", http.StatusFound)
						return
					}
					w.WriteHeader(tc.healthStatus)
				case "/api/channels":
					if tc.anonymousRedirect {
						http.Redirect(w, r, "/redirect-anonymous-target", http.StatusFound)
						return
					}
					w.WriteHeader(tc.anonymousStatus)
				case "/redirect-health-target":
					w.WriteHeader(http.StatusOK)
				case "/redirect-anonymous-target":
					w.WriteHeader(http.StatusUnauthorized)
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()

			args := append(append([]string{}, baseURLArg...), server.URL)
			stdout, stderr, err := runSecurityTool(t, runner, filepath.Dir(filepath.Dir(probePath)), probePath, args, probeEnvironment())
			assertProbeResult(t, tc.wantSuccess, err, stdout, stderr)
			if credentialHeaderSeen.Load() {
				t.Fatal("production probe sent a credential-bearing header")
			}
		})
	}

	t.Run("connection refusal", func(t *testing.T) {
		baseURL := unusedLocalURL(t)
		args := append(append([]string{}, baseURLArg...), baseURL)
		stdout, stderr, err := runSecurityTool(t, runner, filepath.Dir(filepath.Dir(probePath)), probePath, args, probeEnvironment())
		assertProbeResult(t, false, err, stdout, stderr)
	})
}

func assertProbeResult(t *testing.T, wantSuccess bool, err error, stdout, stderr []byte) {
	t.Helper()
	if wantSuccess && err != nil {
		t.Fatalf("production probe failed: %v\nstdout: %s\nstderr: %s", err, stdout, stderr)
	}
	if !wantSuccess && err == nil {
		t.Fatalf("production probe unexpectedly succeeded\nstdout: %s\nstderr: %s", stdout, stderr)
	}
	combined := string(stdout) + string(stderr)
	for _, secret := range []string{probePasswordSecret, probeTokenSecret} {
		if strings.Contains(combined, secret) {
			t.Fatalf("production probe echoed secret %q", secret)
		}
	}
}

func probeEnvironment() []string {
	return []string{
		"ADMIN_PASSWORD=" + probePasswordSecret,
		"AUTH_TOKEN_SECRET=" + probeTokenSecret,
		"NO_PROXY=127.0.0.1,localhost",
		"no_proxy=127.0.0.1,localhost",
	}
}

func unusedLocalURL(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve unused port: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release unused port: %v", err)
	}
	return "http://" + address
}

func runSecurityTool(
	t *testing.T,
	runner securityToolRunner,
	dir string,
	script string,
	args []string,
	extraEnv []string,
) ([]byte, []byte, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	commandArgs := append(append([]string{}, runner.prefix...), script)
	commandArgs = append(commandArgs, args...)
	cmd := exec.CommandContext(ctx, runner.command, commandArgs...)
	cmd.Dir = dir
	cmd.Env = append(cleanProxyEnvironment(os.Environ()), extraEnv...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return stdout.Bytes(), stderr.Bytes(), fmt.Errorf("command timed out: %w", ctx.Err())
	}
	return stdout.Bytes(), stderr.Bytes(), err
}

func cleanProxyEnvironment(environment []string) []string {
	cleaned := make([]string, 0, len(environment))
	for _, item := range environment {
		key, _, _ := strings.Cut(item, "=")
		switch strings.ToUpper(key) {
		case "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "ADMIN_PASSWORD", "AUTH_TOKEN_SECRET":
			continue
		default:
			cleaned = append(cleaned, item)
		}
	}
	return cleaned
}
