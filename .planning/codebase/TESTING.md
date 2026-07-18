# Testing Patterns

**Analysis Date:** 2026-07-18

## Test Framework

**Runner:**
- Go standard-library `testing` under Go 1.23, with package tests discovered by `go test ./...`; module version is declared in `go.mod`.
- Vitest 3.2.4 for frontend TypeScript, configured in `frontend/vitest.config.ts` with the `node` environment and `lib/**/*.test.ts` include pattern.
- Config: `frontend/vitest.config.ts` for frontend tests; Go uses conventional discovery without a separate config file.

**Assertion Library:**
- Backend tests use `testing.T` directly with `t.Fatal` and `t.Fatalf`; no third-party assertion or mocking dependency is declared in `go.mod`.
- Frontend tests import `describe`, `it`, `expect` from `vitest` in `frontend/lib/import-and-error.test.ts`.

**Run Commands:**
```bash
go test ./... -count=1                 # Run all backend/package tests without cached results
cd frontend && pnpm test               # Run all Vitest tests once
cd frontend && pnpm lint               # Run frontend ESLint gate
cd frontend && pnpm build              # Build the production frontend gate
./scripts/verify.sh                     # Run the complete Unix local quality workflow
./scripts/verify.ps1                    # Run the complete Windows local quality workflow
go test ./... -cover                    # View per-package Go statement coverage
```

## Test File Organization

**Location:**
- Co-locate Go tests with their package implementation under `backend/<package>/`. The repository contains 21 `_test.go` files and 155 `Test...` functions across `backend/api/`, `backend/auth/`, `backend/captcha/`, `backend/channel/`, `backend/config/`, `backend/connector/`, `backend/monitor/`, `backend/notify/`, `backend/runtimeconfig/`, `backend/scheduler/`, `backend/storage/`, and `backend/syncer/`.
- Co-locate frontend pure-library tests in `frontend/lib/`. `frontend/vitest.config.ts` intentionally excludes component, app, and browser tests by including only `lib/**/*.test.ts`.

**Naming:**
- Name Go files `<subject>_test.go` and functions `TestBehavior` or `TestOperationCondition`, for example `backend/config/proxy_test.go` and `backend/auth/auth_test.go`.
- Name TypeScript files `<subject>.test.ts`; the single suite is `frontend/lib/import-and-error.test.ts`, containing 23 cases.

**Structure:**
```text
backend/<package>/
├── subject.go
└── subject_test.go

frontend/lib/
├── subject.ts
└── subject.test.ts
```

## Test Structure

**Suite Organization:**
```go
func TestProxyConfigURL(t *testing.T) {
	tests := []struct {
		name string
		cfg  ProxyConfig
		want string
	}{
		{name: "http", cfg: ProxyConfig{Protocol: "http", Host: "127.0.0.1", Port: 8080}, want: "http://127.0.0.1:8080"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.cfg.URL()
			if err != nil { t.Fatalf("URL: %v", err) }
			if got != tt.want { t.Fatalf("url = %q, want %q", got, tt.want) }
		})
	}
}
```
Pattern source: `backend/config/proxy_test.go`.

**Patterns:**
- Use table-driven subtests for compact input/output matrices and direct named tests for scenario-heavy flows.
- Fail immediately on setup and action errors with operation-specific messages. Assertions consistently report `got` and expected values, status codes, or decoded bodies.
- Put repeated setup in package-local helpers, call `t.Helper()`, allocate isolated resources with `t.TempDir()`, and register cleanup with `t.Cleanup`; see `backend/storage/storage_test.go`, `backend/api/dashboard_test.go`, and `backend/syncer/service_test.go`.
- Do not use `t.Parallel()` with shared Gin mode, SQLite state, mutable HTTP fakes, or global registries. No test in the repository calls `t.Parallel()`.

## Mocking

**Framework:** Handwritten Go fakes/stubs plus `net/http/httptest`; Vitest mocking APIs are not used.

**Patterns:**
```go
type fakeChannelService struct {
	keys        []connector.APIKey
	createCount int
	lastCreate  connector.APIKeyCreateRequest
}

func (f *fakeChannelService) CreateAPIKey(ctx context.Context, channelID uint, req connector.APIKeyCreateRequest) (*connector.APIKey, error) {
	f.createCount++
	f.lastCreate = req
	return &connector.APIKey{ID: 1, Name: req.Name}, nil
}
```
Pattern sources: `backend/syncer/service_test.go` and `backend/api/channels_api_keys_test.go`.

**What to Mock:**
- Replace narrow service interfaces at handler and orchestration boundaries with stateful structs that capture calls and return configured values.
- Use `httptest.NewServer` or `httptest.NewRecorder` to exercise real HTTP encoding, headers, routing, query strings, provider responses, and error bodies in `backend/connector/newapi/newapi_test.go`, `backend/connector/sub2api/sub2api_test.go`, `backend/notify/qqbot_test.go`, and `backend/auth/auth_test.go`.
- Discard logs with `slog.NewTextHandler(io.Discard, nil)` when logging is incidental to the behavior under test.

**What NOT to Mock:**
- Use a real temporary SQLite database and real GORM repositories for storage, service, API, scheduler, monitor, and syncer integration behavior. The canonical helper is `openTestDB` in `backend/storage/storage_test.go` and package-specific variants in `backend/api/dashboard_test.go` and `backend/syncer/service_test.go`.
- Keep pure frontend parsing and classification functions real; `frontend/lib/import-and-error.test.ts` imports implementations directly without `vi.mock`.
- Avoid external network dependencies. All connector/provider responses should come from local `httptest` servers.

## Fixtures and Factories

**Test Data:**
```go
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := storage.Open(storage.DBConfig{
		Driver: storage.DBDriverSQLite,
		Path:   filepath.Join(t.TempDir(), "test.db"),
	})
	if err != nil { t.Fatalf("open test db: %v", err) }
	if err := storage.AutoMigrate(db); err != nil { t.Fatalf("auto migrate: %v", err) }
	sqlDB, err := db.DB()
	if err != nil { t.Fatalf("db handle: %v", err) }
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
```

**Location:**
- Fixtures are inline Go composite literals and inline JSON bodies, local to the test that owns them. There is no shared fixture directory.
- Setup factories remain package-local, such as `newAdminServer`, `openSyncerTestDB`, and `newTestService` in `backend/syncer/service_test.go`.
- Frontend fixtures are plain objects scoped inside `describe` blocks in `frontend/lib/import-and-error.test.ts`.

## Coverage

**Requirements:** None enforced. `.github/workflows/quality.yml` runs tests but does not create a coverage profile, upload coverage, or apply a minimum threshold.

**View Coverage:**
```bash
go test ./... -count=1 -cover
```

**Measured Package Coverage:**
- High: `backend/auth` 73.2%, `backend/syncer` 71.4%, `backend/monitor` 68.2%, and `backend/connector/sub2api` 63.5%.
- Moderate: `backend/config` 58.0%, `backend/connector/newapi` 55.5%, `backend/runtimeconfig` 49.3%, `backend/storage` 39.1%, `backend/scheduler` 37.1%, and `backend/api` 36.0%.
- Low: `backend/channel` 20.5%, `backend/notify` 18.3%, and `backend/captcha` 9.4%.
- Zero: `backend/connector`, `backend/crypto`, `backend/logger`, `backend/progress`, `cmd/server`, and `web`. `backend/global` contains no test file.
- Frontend coverage is not configured; `frontend/package.json` has no Vitest coverage provider or coverage script.

## Test Types

**Unit Tests:**
- Pure configuration, auth, parsing, validation, formatting, version comparison, and error classification use direct unit tests: `backend/config/proxy_test.go`, `backend/auth/auth_test.go`, `backend/api/version_test.go`, and `frontend/lib/import-and-error.test.ts`.
- Table-driven tests are appropriate for bounded transformations; named scenario tests are preferred for workflows with state transitions.

**Integration Tests:**
- Repository/service tests exercise SQLite migrations and real persistence via temporary database files in `backend/storage/storage_test.go`, `backend/channel/service_test.go`, `backend/monitor/service_test.go`, `backend/scheduler/scheduler_test.go`, and `backend/syncer/service_test.go`.
- HTTP integration tests run Gin routers with `httptest.NewRecorder` or local upstream servers with `httptest.NewServer`; representative files are `backend/api/dashboard_test.go`, `backend/api/channels_recharge_test.go`, and both connector test suites.
- These tests remain process-local and deterministic; no Docker service or internet connection is required for `go test ./...`.

**E2E Tests:**
- Not used. No Playwright, Cypress, browser DOM environment, or full-stack UI automation configuration is present.
- Compose configuration is validated as an operational gate by `.github/workflows/quality.yml` and `scripts/verify.ps1` / `scripts/verify.sh`, but this is configuration validation rather than an application E2E test.

## Common Patterns

**Async Testing:**
```typescript
it("formats a notification test error", async () => {
  const { formatNotifyTestError } = await import("./notify-test-error")
  const message = formatNotifyTestError("qqbot", "connection refused")
  expect(message).toMatch(/host\.docker\.internal/)
})
```
Pattern source: `frontend/lib/import-and-error.test.ts`.

Go asynchronous and concurrent behavior is tested with local HTTP servers, synchronized state (`sync.Mutex`, `sync/atomic`), and bounded waits or direct service calls in `backend/monitor/service_test.go`, `backend/storage/storage_test.go`, and `backend/syncer/service_test.go`. Keep timeouts explicit and avoid sleeps where a state signal can be observed.

**Error Testing:**
```go
if _, err := cfg.URL(); err == nil {
	t.Fatalf("URL(%#v) error is nil", cfg)
}
```
Pattern source: `backend/config/proxy_test.go`. For transport failures, assert status plus response body; for business errors, assert a stable semantic substring rather than the complete wrapped chain, as in `backend/notify/qqbot_test.go`.

## CI Quality Gates

- `.github/workflows/quality.yml` runs on non-main pushes, pull requests, manual dispatch, and reusable workflow calls. It grants read-only repository contents permission and cancels superseded runs.
- The backend job runs `go test ./... -count=1` with the Go version from `go.mod`.
- The frontend job installs with pnpm 10.4.0 and Node 20 using `pnpm install --frozen-lockfile`, then runs `pnpm lint`, `pnpm test`, and `pnpm build`.
- The Compose job runs `docker compose config --quiet` with a non-production placeholder required for interpolation.
- `.github/workflows/publish.yml` invokes the reusable quality workflow and makes `build-and-push` depend on it, so release image publication requires the quality jobs to pass.
- `scripts/verify.ps1` and `scripts/verify.sh` mirror the gates locally and add `git diff --check`; both permit skipping dependency installation while retaining lint, test, build, backend test, and Compose validation.
- CI does not run `go vet`, `go test -race`, coverage thresholds, `tsc --noEmit`, browser tests, or dependency/security scanning.

## Coverage Strengths and Gaps

- Backend persistence and orchestration receive broad behavioral coverage through real SQLite and local HTTP fakes. `backend/syncer/service_test.go` is especially comprehensive for account reconciliation and failure transitions.
- Connector tests verify request methods, headers, authentication material, payloads, decoding, recharge flows, subscriptions, API keys, and error responses in `backend/connector/newapi/newapi_test.go` and `backend/connector/sub2api/sub2api_test.go`.
- Authentication has direct token tamper and middleware-route coverage in `backend/auth/auth_test.go`.
- Frontend coverage is narrow: 23 tests cover pure import/error utilities in `frontend/lib/import-and-error.test.ts`, while all React pages, components, contexts, hooks, navigation, forms, and user interactions under `frontend/app/`, `frontend/components/`, and `frontend/hooks/` have no automated tests.
- Critical backend gaps include encryption round trips and malformed ciphertext in `backend/crypto/cipher.go`, connector registry/status helpers in `backend/connector/`, logging configuration in `backend/logger/logger.go`, event progress behavior in `backend/progress/progress.go`, server composition and shutdown in `cmd/server/main.go`, and embedded frontend behavior in `web/web.go`.
- Lower-coverage provider and notification areas (`backend/captcha/`, `backend/notify/`) need negative-path tests for each provider/channel implementation, retry behavior, proxy handling, malformed remote responses, and cancellation.
- No race gate protects shared maps, mutable service configuration, scheduler work, or concurrent storage paths. Run `go test -race ./...` for changes to `backend/monitor/`, `backend/scheduler/`, `backend/storage/`, or `backend/syncer/`.

---

*Testing analysis: 2026-07-18*
