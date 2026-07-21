# External Integrations

**Analysis Date:** 2026-07-18

## APIs & External Services

**Managed upstream platforms:**
- NewAPI - Monitors and operates arbitrary user-configured NewAPI sites through their REST APIs.
  - Client: Resty-based connector registered in `backend/connector/newapi/newapi.go` through the abstraction in `backend/connector/connector.go`.
  - Capabilities: public status/Turnstile discovery, login, session validation, balance and usage, group rates, announcements, redeem/top-up/payment, and API-key CRUD/reveal.
  - Representative endpoints: `/api/status`, `/api/user/login`, `/api/user/self`, `/api/user/self/groups`, `/api/log/self/stat`, `/api/notice`, `/api/user/topup`, `/api/user/pay`, and `/api/token/*` in `backend/connector/newapi/newapi.go`.
  - Auth: username/password may establish a Cookie session; token mode accepts either a saved Cookie or NewAPI system access token, and authenticated requests also carry `New-Api-User`, implemented in `backend/channel/service.go` and `backend/connector/newapi/newapi.go`.
- Sub2API - Monitors and operates arbitrary user-configured Sub2API sites through their REST APIs.
  - Client: Resty-based connector registered in `backend/connector/sub2api/sub2api.go`.
  - Capabilities: public settings/Turnstile discovery, login/refresh, account and usage data, groups/rates, announcements, redeem/payment/subscriptions, and API-key management.
  - Representative endpoints: `/api/v1/settings/public`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/me`, `/api/v1/usage/dashboard/stats`, `/api/v1/groups/*`, `/api/v1/announcements`, `/api/v1/payment/*`, `/api/v1/subscriptions/progress`, and `/api/v1/keys/*` in `backend/connector/sub2api/sub2api.go`.
  - Auth: username/password yields Bearer access and optional refresh tokens; token mode accepts saved access/refresh tokens, implemented in `backend/channel/service.go` and `backend/connector/sub2api/sub2api.go`.
- Sub2API Admin API - Writes managed accounts and groups to configured downstream synchronization targets.
  - Client: `AdminClient` in `backend/connector/sub2api/admin.go`, orchestrated by `backend/syncer/service.go`.
  - Auth: per-target Admin API key sent as `x-api-key`; the stored key is encrypted through `backend/crypto/cipher.go`.
  - Capabilities: target health checks, group/proxy/account listing, managed account create/update/delete, schedulable state, upstream model sync, model listing, account tests, and managed group cleanup under `/api/v1/admin/*`.

**Gateway model discovery:**
- OpenAI-compatible gateways - Model inventory is read from `/v1/models` with Bearer authentication in `backend/syncer/service.go`.
- Gemini-compatible gateways - Model inventory is read from `/v1beta/models` with `x-goog-api-key` in `backend/syncer/service.go`.
- Anthropic/Antigravity-compatible gateways - Model inventory uses `x-api-key` plus Anthropic protocol headers in `backend/syncer/service.go`.
- Base URLs and API keys are derived from configured source channels and managed synchronization accounts rather than fixed environment variables, in `backend/syncer/service.go`.

**Captcha solving services:**
- CapSolver - Turnstile task creation/result polling and account balance queries against `api.capsolver.com` in `backend/captcha/capsolver.go` and `backend/captcha/balance.go`.
- 2Captcha - JSON `createTask`, `getTaskResult`, and balance operations against `api.2captcha.com` in `backend/captcha/twocaptcha.go` and `backend/captcha/balance.go`.
- Anti-Captcha - Turnstile task creation/result polling and balance operations against `api.anti-captcha.com` in `backend/captcha/anticaptcha.go` and `backend/captcha/balance.go`.
- YesCaptcha - Turnstile task creation/result polling and points balance operations against `api.yescaptcha.com` in `backend/captcha/yescaptcha.go` and `backend/captcha/balance.go`.
- SDK/Client: Resty through the provider registry in `backend/captcha/provider.go`.
- Auth: provider API keys are stored per database record in `captcha_configs`, encrypted by `backend/crypto/cipher.go`; there are no provider-specific process environment variables.

**Release metadata:**
- GitHub Releases API - `GET https://api.github.com/repos/bejix/upstream-ops/releases/latest` drives update availability in `backend/api/version.go`.
  - SDK/Client: Go standard `net/http` with a two-second timeout and optional configured proxy.
  - Auth: unauthenticated public GitHub API request; no token is configured in application source.

## Notification Channels

**Push and webhook transports:**
- Telegram Bot API - Sends Markdown messages through `api.telegram.org/.../sendMessage`; configuration requires a bot token and chat ID in `backend/notify/telegram.go`.
- Generic webhook - Sends event, subject, body, and extra fields as JSON to a user-provided URL using a configurable HTTP method and headers in `backend/notify/webhook.go`.
- WeCom robot - Sends Markdown payloads to a user-provided WeCom webhook URL in `backend/notify/wecom.go`.
- DingTalk robot - Sends Markdown to a configured webhook and optionally signs requests with HMAC-SHA256 in `backend/notify/dingtalk.go`.
- Feishu robot - Sends text to a configured webhook and optionally signs requests with HMAC-SHA256 in `backend/notify/feishu.go`.
- ServerChan3 - Sends form-encoded messages to a UID-specific `push.ft07.com` endpoint using a send key in `backend/notify/serverchan3.go`.
- QQ Bot / OneBot v11 - Sends group or private messages to a configured OneBot HTTP endpoint, with optional Bearer/query token authentication, in `backend/notify/qqbot.go`.
- SMTP email - Sends plain-text mail with SMTP PLAIN auth over standard SMTP or implicit TLS in `backend/notify/email.go`.

**Dispatch behavior:**
- Notification factories register by database channel type in `backend/notify/notifier.go`; creation, filtering, retries, cooldowns, and delivery logging are coordinated by `backend/notify/dispatcher.go` and `backend/notify/policy.go`.
- Notification configuration JSON is encrypted as a unit before persistence in the `notification_channels` table; decryption occurs immediately before notifier construction through `backend/api/notifications.go` and `backend/crypto/cipher.go`.
- Global proxy use is opt-in per upstream channel, notification channel, and captcha provider. HTTP-capable transports implement `SetProxy` in `backend/notify/`, while SMTP uses its direct connection path in `backend/notify/email.go`.

## Data Storage

**Databases:**
- SQLite - Default embedded database via `github.com/glebarez/sqlite` in `backend/storage/storage.go`.
  - Connection: filesystem path from `DATABASE_PATH` or runtime YAML; default selection is defined in `backend/config/config.go`.
  - Client: GORM repositories under `backend/storage/`.
  - Runtime behavior: WAL mode, a five-second busy timeout, and a single open/idle connection are set in `backend/storage/storage.go`.
- MySQL - Optional server database via `gorm.io/driver/mysql` in `backend/storage/storage.go`.
  - Connection: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME`, bound in `backend/config/config.go`.
  - Client: GORM with configurable open/idle pool sizes in `backend/storage/storage.go`.
  - Deployment: MySQL 8.4 service and application override in `docker-compose.mysql.yml`.
- Schema management - GORM `AutoMigrate` runs at startup for channels, auth sessions, captcha settings, snapshots, announcements, notifications, monitor logs, and synchronization records in `backend/storage/storage.go`.

**File Storage:**
- Local filesystem only - SQLite data and generated runtime `config.yaml` live in the mounted data directory for Compose deployments defined by `docker-compose.yml`.
- Embedded static assets - `frontend/dist/` is copied to `web/dist/` during image construction and compiled into the binary by `web/web.go`; it is not mutable runtime storage.
- No external object-storage service or SDK is detected in `go.mod`, `frontend/package.json`, or source imports.

**Caching:**
- No Redis, Memcached, CDN cache, or external caching service is detected.
- Request-time/session state is stored in the database, while small runtime state such as registered factories and current configuration is process-local in `backend/connector/connector.go`, `backend/notify/notifier.go`, `backend/captcha/provider.go`, and `backend/runtimeconfig/runtime.go`.

## Authentication & Identity

**Auth Provider:**
- Custom single-administrator authentication; no OAuth, OIDC, SAML, or third-party identity provider is used.
  - Implementation: configured username/password comparison followed by a stateless HMAC-SHA256 signed token in `backend/auth/auth.go`.
  - Token delivery: `Authorization: Bearer` is the primary mechanism; query parameter and `uh_token` cookie fallback are accepted by `backend/auth/auth.go`.
  - Frontend storage: the token is held in browser `localStorage` and attached by `frontend/lib/api.ts`; authenticated SSE uses `fetch` so it can attach the same header in `frontend/lib/sync-stream.ts`.
  - Public paths: health and login access are handled around the middleware registration in `backend/api/api.go` and `backend/auth/auth.go`.
  - Configuration: `AUTH_ENABLED`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `AUTH_TOKEN_SECRET`; the signing secret falls back to `APP_SECRET` in `cmd/server/main.go`.
  - Deployment posture: authentication defaults to disabled in `backend/config/config.go`, so public exposure requires explicitly enabling it.

**Credential protection:**
- `APP_SECRET` is required to initialize AES-GCM encryption in `backend/crypto/cipher.go`.
- Upstream passwords/tokens/cookies, persisted upstream sessions, notification configuration, captcha API keys, and Sub2API target Admin API keys are encrypted before database storage by flows under `backend/channel/`, `backend/api/`, `backend/storage/`, and `backend/syncer/`.
- The encryption key is derived with SHA-256 and ciphertext uses a random GCM nonce in `backend/crypto/cipher.go`.

## Monitoring & Observability

**Error Tracking:**
- No hosted error-tracking service or telemetry SDK is detected in `go.mod` or `frontend/package.json`.

**Logs:**
- Application logs use Go `log/slog`, with text or JSON output and configurable level in `backend/logger/logger.go`.
- Database warnings use GORM logging configured in `backend/storage/storage.go`; expected record-not-found events are suppressed and slow queries have a threshold.
- Domain monitor results and notification delivery attempts are persisted in database tables through `backend/storage/monitor_logs.go` and `backend/storage/notifications.go`.
- `GET /healthz` checks database connectivity and is used by the Compose health check in `backend/api/api.go` and `docker-compose.yml`.
- No external metrics backend, distributed tracing, or APM integration is detected.

## CI/CD & Deployment

**Hosting:**
- Self-hosted Docker/Compose is the documented runtime in `docker-compose.yml`; there is no managed application host integration in the repository.
- GitHub Container Registry (`ghcr.io`) stores published application images, configured in `.github/workflows/publish.yml` and consumed by `docker-compose.yml`.
- The production container is a single Alpine-based server process with embedded frontend assets, built by `Dockerfile`.
- Optional MySQL is deployed alongside the application by `docker-compose.mysql.yml`; SQLite needs only the application container and data volume.

**CI Pipeline:**
- GitHub Actions quality workflow in `.github/workflows/quality.yml` runs Go tests, pnpm install/lint/test/build, and Docker Compose configuration validation.
- GitHub Actions publish workflow in `.github/workflows/publish.yml` gates image publishing on quality, logs into GHCR with the workflow-provided GitHub token, and publishes linux/amd64 and linux/arm64 tags.
- Build tooling uses `actions/checkout`, `actions/setup-go`, `actions/setup-node`, `pnpm/action-setup`, Docker QEMU/Buildx actions, metadata generation, and GitHub Actions cache in `.github/workflows/`.

## Environment Configuration

**Required env vars:**
- `APP_SECRET` - Required application encryption root, bound in `backend/config/config.go` and consumed in `cmd/server/main.go`.
- `AUTH_ENABLED`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AUTH_TOKEN_SECRET` - Optional built-in admin authentication in `backend/config/config.go` and `backend/auth/auth.go`.
- `DATABASE_DRIVER`, `DATABASE_PATH` - SQLite selection and path in `backend/config/config.go` and `backend/storage/storage.go`.
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` - MySQL connection in `backend/config/config.go` and `backend/storage/storage.go`.
- `SERVER_PORT`, `SERVER_MODE`, `LOG_LEVEL` - Server and logging behavior in `backend/config/config.go`.
- `HTTP_PORT`, `IMAGE_TAG`, and `MYSQL_*` - Compose-only host/image/MySQL inputs referenced by `docker-compose.yml` and `docker-compose.mysql.yml`.
- `VITE_BACKEND_URL` - Optional frontend development proxy target in `frontend/vite.config.ts`.

**Secrets location:**
- `.env` is present and ignored by `.gitignore`; its contents are intentionally not included here. `.env.example` is present as a name-only configuration template reference.
- Generated `config.yaml` may contain runtime configuration and is ignored by `.gitignore`; the active path is resolved and written by `backend/config/config.go`.
- Integration credentials are stored encrypted in SQLite/MySQL records rather than exposed as provider-specific environment variables, using `backend/crypto/cipher.go`.
- GitHub Actions uses the platform-provided GitHub token reference for GHCR publishing in `.github/workflows/publish.yml`; no repository-specific deployment secret is defined in source.

## Webhooks & Callbacks

**Incoming:**
- None detected. The server exposes REST, health, SPA, and SSE response routes from `backend/api/`; no route verifies or consumes an external webhook callback.
- Recharge/subscription operations may return redirect, form, or QR launch data from upstream APIs, but UpstreamOps does not host payment-provider callback handlers; the behavior is implemented in `backend/connector/newapi/newapi.go` and `backend/connector/sub2api/sub2api.go`.

**Outgoing:**
- Generic configurable JSON webhook requests from `backend/notify/webhook.go`.
- Vendor robot webhook requests for WeCom, DingTalk, and Feishu from `backend/notify/wecom.go`, `backend/notify/dingtalk.go`, and `backend/notify/feishu.go`.
- Telegram Bot API, ServerChan3, OneBot/QQ Bot, and SMTP deliveries from the corresponding files in `backend/notify/`.
- Notification tests use the same dispatcher and transport path through `backend/api/notifications.go`; delivery outcomes are logged to the database by `backend/notify/dispatcher.go`.

---

*Integration audit: 2026-07-18*
