# Codebase Concerns

**Analysis Date:** 2026-07-18

## Tech Debt

**Scheduler concurrency setting is inert (Medium, confirmed):**
- Issue: `SchedulerConfig.Concurrency` is defaulted and shown in the UI, but the scheduler only logs it; `ScanAllBalances` and `ScanAllRates` iterate channels serially.
- Files: `backend/config/config.go`, `backend/scheduler/scheduler.go`, `backend/monitor/service.go`, `frontend/app/settings-page.tsx`
- Impact: Operators cannot tune the advertised concurrency, and scan duration grows linearly with channel count.
- Fix approach: Apply a bounded worker pool keyed by `SchedulerConfig.Concurrency`, preserve per-channel isolation, and add concurrency/cancellation tests.

**Large mixed-responsibility modules (Medium, confirmed):**
- Issue: Core workflows and screens are concentrated in very large files: sync service (~2,416 lines), sync settings (~2,320), settings page (~1,861), channel cards (~1,520), and connectors over 1,200 lines.
- Files: `backend/syncer/service.go`, `frontend/components/settings/upstream-sync-settings.tsx`, `frontend/app/settings-page.tsx`, `frontend/components/monitor/channel-cards.tsx`, `backend/connector/sub2api/sub2api.go`, `backend/connector/newapi/newapi.go`
- Impact: Changes have broad regression surfaces and make ownership, review, and targeted testing difficult.
- Fix approach: Split by use case and state boundary while retaining the existing service and API contracts.

**Non-atomic rate refresh bookkeeping (Medium, risk):**
- Issue: Rate upsert is a read-then-save/create sequence, while refresh, history insertion, deletion, and notification dispatch are separate operations.
- Files: `backend/storage/rates.go`, `backend/monitor/service.go`, `backend/api/channels.go`, `backend/scheduler/scheduler.go`
- Impact: Overlapping manual and scheduled refreshes can duplicate observations, hit unique constraints, or notify without a matching durable history row.
- Fix approach: Serialize refreshes per channel and transactionally persist the snapshot/change set before dispatching notifications.

## Known Bugs

**Environment precedence is lost during runtime apply (High, confirmed):**
- Symptoms: Startup loads environment overrides, but Settings read/save and `ApplyFromFile` use file-only loading.
- Files: `cmd/server/main.go`, `backend/config/config.go`, `backend/api/settings.go`, `backend/runtimeconfig/runtime.go`
- Trigger: Start with environment-provided auth/proxy values and an existing lower-precedence config file, then save/apply Settings.
- Workaround: Avoid runtime apply when security-relevant values are managed through environment variables; restart instead.

**SQLite backup can lose WAL-resident data (High, confirmed):**
- Symptoms: Backup copies the live database before separately copying WAL/SHM, while restore copies only the main database and deletes WAL/SHM.
- Files: `scripts/backup-data.sh`, `backend/storage/storage.go`
- Trigger: Run `backup` while WAL mode has uncheckpointed or concurrent writes, then restore that timestamp.
- Workaround: Stop the application before backup; replace the helper with SQLite online backup or `VACUUM INTO` and verify restoration.

**Successful operations can omit audit/history records (Medium, confirmed):**
- Symptoms: Monitor log, balance/cost snapshot, rate-change, and notification errors are explicitly discarded in several successful paths.
- Files: `backend/monitor/service.go`, `backend/channel/service.go`, `backend/notify/dispatcher.go`
- Trigger: Cause a database write failure after the upstream request succeeds.
- Workaround: Monitor database warnings; there is no API-level indication that secondary persistence failed.

## Security Considerations

**Plaintext secret persistence and disclosure (High, confirmed):**
- Risk: Effective application, admin, database, and proxy secrets can be serialized to a `0644` YAML file; Settings returns auth and proxy structs including password/token-secret fields.
- Files: `cmd/server/main.go`, `backend/config/config.go`, `backend/api/settings.go`, `frontend/app/settings-page.tsx`, `frontend/lib/api-types.ts`
- Current mitigation: Channel, session, captcha, sync-target, and notification credentials are AES-GCM encrypted in the database by `backend/crypto/cipher.go`.
- Recommendations: Never persist environment-derived secrets, write sensitive config as `0600`, return redacted settings views, and use write-only replacement fields.

**Authentication is deployment-optional and weak against credential attacks (High, confirmed):**
- Risk: Authentication defaults off; login has no throttling/lockout, tokens are stateless for seven days by default, logout cannot revoke them, and tokens are accepted from query strings.
- Files: `backend/config/config.go`, `cmd/server/main.go`, `backend/auth/auth.go`, `backend/api/auth.go`, `scripts/check-production.sh`, `scripts/check-production.ps1`
- Current mitigation: HMAC verification and constant-time credential comparisons are implemented; uncommitted production-check scripts assert anonymous `/api/channels` returns 401.
- Recommendations: Fail closed outside explicit local mode, rate-limit login, stop accepting URL tokens, shorten sessions, and add server-side revocation/rotation.

**Browser token and settings exposure amplify XSS impact (Medium, confirmed):**
- Risk: The bearer token is kept in `localStorage`, and an authenticated Settings response contains longer-lived secrets.
- Files: `frontend/lib/api.ts`, `backend/api/settings.go`, `frontend/app/settings-page.tsx`
- Current mitigation: API requests use `Authorization` headers and the UI does not intentionally render secret HTML.
- Recommendations: Use a Secure/HttpOnly/SameSite cookie with CSRF protection and ensure settings responses are redacted.

**Unrestricted server-side outbound URLs (High, confirmed capability; exposure depends on auth):**
- Risk: Channel sites, sync targets, captcha endpoints, webhook URLs, and OneBot base URLs are stored without scheme/private-network checks and later requested by the server.
- Files: `backend/channel/service.go`, `backend/connector/newapi/newapi.go`, `backend/connector/sub2api/sub2api.go`, `backend/syncer/service.go`, `backend/captcha/balance.go`, `backend/notify/webhook.go`, `backend/notify/qqbot.go`
- Current mitigation: Most connector/captcha calls have timeouts; access is protected only when optional authentication is enabled.
- Recommendations: Centralize URL validation, allow only HTTP(S), resolve and block loopback/link-local/private destinations unless explicitly allowlisted, and revalidate redirects.

**Server hardening is incomplete (Medium, confirmed):**
- Risk: The HTTP server sets only `ReadHeaderTimeout`; request bodies are not size-limited, raw internal/upstream errors are returned, and the container runs as root.
- Files: `cmd/server/main.go`, `backend/api/api.go`, `backend/api/dashboard.go`, `Dockerfile`
- Current mitigation: Gin recovery is installed and outbound connector calls generally have context/timeout handling.
- Recommendations: Add body limits, read/write/idle timeouts, sanitized public errors, security headers, and a non-root runtime user.

## Performance Bottlenecks

**Unbounded trend/history queries (High risk, confirmed inputs):**
- Problem: `days` is not capped and trend aggregation loads all matching snapshots into memory before emitting one row per day; monitor/history limits are also not consistently capped.
- Files: `backend/api/dashboard.go`, `backend/storage/rates.go`, `backend/api/monitor_logs.go`, `backend/api/channels.go`
- Cause: API integers flow directly into allocation, iteration, and SQL limit/window behavior.
- Improvement path: Enforce conservative maxima and perform daily aggregation in SQL.

**Outbound response and notifier bounds (Medium risk):**
- Problem: Resty connectors parse complete response bodies without a response-size ceiling, while HTTP notification clients have no explicit timeout; SMTP timeout can leave its worker goroutine blocked.
- Files: `backend/connector/newapi/newapi.go`, `backend/connector/sub2api/sub2api.go`, `backend/notify/dispatcher.go`, `backend/notify/webhook.go`, `backend/notify/qqbot.go`, `backend/notify/email.go`
- Cause: Only the gateway-model path applies `io.LimitReader`; notifier deadlines rely on the caller context.
- Improvement path: Set transport/response limits on every client and implement SMTP with connection deadlines instead of an abandoned goroutine.

**Frontend bundle is monolithic (Medium, confirmed):**
- Problem: The production build emits a ~1.19 MB minified JavaScript chunk (~346 KB gzip) and Vite reports the 500 KB chunk warning.
- Files: `frontend/src/main.tsx`, `frontend/app/page.tsx`, `frontend/app/settings-page.tsx`, `frontend/components/settings/upstream-sync-settings.tsx`, `frontend/vite.config.ts`
- Cause: Large screens and dependencies are eagerly imported without route/component splitting.
- Improvement path: Lazy-load settings/dialog-heavy areas and define stable manual chunks for large libraries.

## Fragile Areas

**SQLite write serialization and overlapping workflows:**
- Files: `backend/storage/storage.go`, `backend/scheduler/scheduler.go`, `backend/api/channels.go`, `backend/monitor/service.go`
- Why fragile: SQLite is intentionally limited to one connection while scheduled and manual sync paths can overlap and perform many small writes.
- Safe modification: Add per-channel job exclusion, batch transactions, and load tests before increasing concurrency.
- Test coverage: Storage concurrency has tests, but scheduler/manual overlap is not exercised end to end.

**Release and build reproducibility:**
- Files: `Dockerfile`, `frontend/pnpm-lock.yaml`, `frontend/package-lock.json`, `.github/workflows/quality.yml`, `.github/workflows/publish.yml`
- Why fragile: Docker explicitly installs with `--no-frozen-lockfile`, two package-manager lockfiles are tracked, and base images/actions use mutable tags rather than digests/commit SHAs.
- Safe modification: Standardize on pnpm, require the frozen lockfile in Docker, and pin production supply-chain inputs.
- Test coverage: Current uncommitted quality/publish workflow changes gate tests/build/Compose, but do not run dependency or image vulnerability scanning.

## Test Coverage Gaps

**Security and operational boundaries (High):**
- What's not tested: Secret redaction/file permissions, environment precedence across runtime apply, SSRF policy, login throttling, body/query limits, backup consistency, and non-root image behavior.
- Files: `backend/api/settings_test.go`, `backend/runtimeconfig/runtime_test.go`, `backend/config/config_test.go`, `backend/auth/auth_test.go`, `scripts/backup-data.sh`, `Dockerfile`
- Risk: The highest-impact failures can pass the current unit/build gates.
- Priority: High

**Frontend behavior and browser workflows (High):**
- What's not tested: Components, auth gate, settings, imports through UI, SSE cancellation, notifications, responsive layout, and end-to-end API behavior; Vitest includes only `lib/**/*.test.ts` in a Node environment.
- Files: `frontend/vitest.config.ts`, `frontend/lib/import-and-error.test.ts`, `frontend/components/`, `frontend/app/`
- Risk: Large interactive screens can regress while the sole frontend test file passes.
- Priority: High

**Observed coverage baseline (Medium):**
- What's not tested: Coverage measured 0% for `backend/connector`, `backend/crypto`, `backend/logger`, `backend/progress`, `cmd/server`, and `web`; low areas include captcha 9.4%, notify 18.3%, channel 20.5%, and API 36.0%.
- Files: `backend/connector/connector.go`, `backend/crypto/cipher.go`, `backend/notify/`, `backend/channel/service.go`, `backend/api/`, `cmd/server/main.go`, `web/web.go`
- Risk: Shared boundaries and startup behavior can break unnoticed.
- Priority: Medium

## Verification Snapshot

- Passed on 2026-07-18: `go test ./... -count=1`, `go vet ./...`, `pnpm.cmd test`, `pnpm.cmd lint`, `pnpm.cmd build`, `pnpm.cmd exec tsc --noEmit`, and `git diff --check`.
- Frontend build warning: the main JavaScript chunk exceeds Vite's 500 KB warning threshold (`frontend/vite.config.ts`).
- Worktree note: quality workflow, auth tests, production checks, and related fixes are currently uncommitted and are part of this analysis (`.github/workflows/quality.yml`, `backend/auth/auth_test.go`, `scripts/check-production.sh`, `scripts/check-production.ps1`).

---

*Concerns audit: 2026-07-18*
