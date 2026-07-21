<!-- refreshed: 2026-07-18 -->
# Architecture

**Analysis Date:** 2026-07-18

## System Overview

```text
+-----------------------------------------------------------------------+
| Browser SPA: React routes, feature components, contexts, API hooks     |
| `frontend/src/main.tsx`, `frontend/app/`, `frontend/components/`       |
+----------------------------------+------------------------------------+
                                   | JSON over /api; SSE for sync progress
                                   v
+-----------------------------------------------------------------------+
| HTTP delivery: Gin router, auth middleware, route-specific handlers    |
| `backend/api/`, composed by `cmd/server/main.go`                       |
+----------------------+-------------------------+----------------------+
                       |                         |
                       v                         v
+----------------------------------+  +---------------------------------+
| Application orchestration       |  | Runtime/background orchestration |
| `backend/channel/`, `monitor/`,  |  | `backend/scheduler/`,            |
| `syncer/`, `notify/`, `captcha/` |  | `backend/runtimeconfig/`         |
+------------------+---------------+  +----------------+----------------+
                   |                                   |
                   v                                   v
+-----------------------------------------------------------------------+
| Ports/adapters: connector, notifier, captcha registries                |
| `backend/connector/`, `backend/notify/`, `backend/captcha/`            |
+----------------------------------+------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
| Persistence: GORM repositories and models; SQLite or MySQL             |
| `backend/storage/`                                                     |
+-----------------------------------------------------------------------+

Production frontend assets flow from `frontend/` through Vite into
`web/dist/`, then `web/web.go` embeds them into the binary built from
`cmd/server/main.go` (`Dockerfile`).
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Composition root | Load configuration, construct the object graph, start cron and HTTP, and coordinate graceful shutdown | `cmd/server/main.go` |
| HTTP API | Register `/api` and `/healthz`, apply dynamic auth, translate HTTP input/output, and serve the embedded SPA fallback | `backend/api/api.go` |
| Channel service | Validate and encrypt channel data, resolve connector adapters, manage upstream sessions, and expose account operations | `backend/channel/service.go` |
| Monitor service | Collect balances, costs, rates, announcements, and subscription usage; persist results and dispatch alerts | `backend/monitor/service.go` |
| Upstream sync service | Reconcile source accounts and target Sub2API state, manage remote objects, and record sync logs | `backend/syncer/service.go` |
| Scheduler | Trigger monitoring, captcha refresh, upstream reconciliation, and retention work from cron expressions | `backend/scheduler/scheduler.go` |
| Runtime configuration | Atomically replace auth, proxy/upstream settings, notification policy, and the running scheduler | `backend/runtimeconfig/runtime.go` |
| Notification dispatch | Build notifier adapters, filter subscriptions, apply cooldown/policy, retry sends, and persist outcomes | `backend/notify/dispatcher.go` |
| Connector port | Define common upstream operations and select implementations through a type-to-factory registry | `backend/connector/connector.go` |
| Captcha port | Define captcha-provider behavior and select concrete providers through a registry | `backend/captcha/provider.go` |
| Persistence | Own GORM models, database opening/migration, and repository methods grouped by aggregate | `backend/storage/storage.go`, `backend/storage/model.go` |
| SPA bootstrap | Install providers, authentication gate, browser routes, shared shell, and notifications | `frontend/src/main.tsx` |
| Frontend data layer | Normalize API responses/errors, attach bearer tokens, poll/refetch, and deduplicate in-flight reads | `frontend/lib/api.ts`, `frontend/lib/queries.ts` |
| Frontend feature UI | Compose route pages from monitoring, settings, auth, and reusable UI components | `frontend/app/`, `frontend/components/` |
| Embedded assets | Expose Vite output as an `fs.FS` only when a real `index.html` is present | `web/web.go` |

## Pattern Overview

**Overall:** Modular monolith with a layered Go backend and a client-rendered React SPA (`cmd/server/main.go`, `backend/`, `frontend/`).

**Key Characteristics:**
- Use explicit constructor injection from `cmd/server/main.go`; handlers receive the assembled graph through `api.Deps` in `backend/api/api.go`.
- Use package-local consumer interfaces at boundaries: `monitorService` and `channelService` live in `backend/api/api.go`, while `upstreamSyncService` lives in `backend/scheduler/scheduler.go`.
- Use repository structs over a shared `*gorm.DB`; construct them in `cmd/server/main.go` and keep model/query ownership in `backend/storage/`.
- Use registry-backed adapters for variable external systems; connector implementations register from `backend/connector/newapi/` and `backend/connector/sub2api/`, notifier implementations from `backend/notify/`, and captcha implementations from `backend/captcha/`.
- Use a query-side exception for read aggregation: dashboard handlers combine repository reads directly in `backend/api/dashboard.go`, while mutation and upstream workflows pass through application services.
- Use browser contexts for coarse global state and local hooks/component state for feature data in `frontend/lib/auth-context.tsx`, `frontend/lib/refresh-context.tsx`, and `frontend/lib/queries.ts`.

## Layers

**Composition and Process Lifecycle:**
- Purpose: Assemble all concrete dependencies and own startup/shutdown sequencing in `cmd/server/main.go`.
- Location: `cmd/server/main.go`.
- Contains: Configuration loading, logger/cipher/database initialization, repository and service construction, cron startup, Gin setup, HTTP server lifecycle, and signal handling in `cmd/server/main.go`.
- Depends on: All backend packages plus embedded assets from `web/web.go`.
- Used by: The built `upstream-ops` process produced from `./cmd/server` by `Dockerfile`.

**HTTP Delivery:**
- Purpose: Convert HTTP requests into application-service or repository calls and encode JSON/SSE responses in `backend/api/`.
- Location: `backend/api/`.
- Contains: One route registrar per resource area, shared dependency bundle and error response helper in `backend/api/api.go`, and SSE transport in `backend/api/channels.go`.
- Depends on: Consumer interfaces and concrete repositories/services exposed through `api.Deps` in `backend/api/api.go`.
- Used by: The Gin engine constructed in `cmd/server/main.go` and the browser client in `frontend/lib/api.ts`.

**Application Services:**
- Purpose: Coordinate multi-step use cases, encryption, upstream calls, persistence, and notifications in `backend/channel/`, `backend/monitor/`, `backend/syncer/`, `backend/notify/`, and `backend/captcha/`.
- Location: `backend/channel/service.go`, `backend/monitor/service.go`, `backend/syncer/service.go`, `backend/notify/dispatcher.go`, `backend/captcha/balance.go`.
- Contains: Channel/session lifecycle, scans, rate comparison, notification policy, captcha balance collection, and target synchronization.
- Depends on: Repository types from `backend/storage/`, ports from `backend/connector/`, and cross-cutting helpers from `backend/crypto/`, `backend/progress/`, and `backend/config/`.
- Used by: Handlers in `backend/api/` and jobs in `backend/scheduler/scheduler.go`.

**External Adapter Ports:**
- Purpose: Isolate upstream-specific HTTP contracts behind stable interfaces in `backend/connector/`, `backend/notify/`, and `backend/captcha/`.
- Location: `backend/connector/connector.go`, `backend/notify/notifier.go`, `backend/captcha/provider.go`.
- Contains: Interface DTOs, factories, synchronized registries, and optional capability interfaces such as `SessionRefresher`, `ProxySetter`, and `HTTPConfigSetter` in `backend/connector/connector.go`.
- Depends on: Standard HTTP clients, `backend/storage/model.go` types where persisted adapter configuration is required, and concrete implementations in child files/packages.
- Used by: `backend/channel/service.go`, `backend/monitor/service.go`, `backend/notify/dispatcher.go`, and `backend/captcha/balance.go`.

**Persistence:**
- Purpose: Define persisted records, database lifecycle, migrations, and focused query repositories in `backend/storage/`.
- Location: `backend/storage/`.
- Contains: GORM models in `backend/storage/model.go`, open/migration logic in `backend/storage/storage.go`, and repositories such as `backend/storage/channels.go`, `backend/storage/rates.go`, and `backend/storage/upstream_sync.go`.
- Depends on: GORM plus SQLite/MySQL drivers configured in `backend/storage/storage.go`.
- Used by: The composition root, API query handlers, application services, scheduler retention, and notification dispatcher in `cmd/server/main.go` and `backend/`.

**Runtime and Background Work:**
- Purpose: Run cron-triggered work and safely replace runtime-configurable collaborators in `backend/scheduler/` and `backend/runtimeconfig/`.
- Location: `backend/scheduler/scheduler.go`, `backend/runtimeconfig/runtime.go`.
- Contains: Second-aware cron registration, bounded job contexts, retention, `sync.RWMutex`-guarded runtime pointers, and scheduler replacement.
- Depends on: Application services and repositories assembled in `cmd/server/main.go`.
- Used by: Process startup and settings apply endpoints in `cmd/server/main.go` and `backend/api/settings.go`.

**Frontend Application:**
- Purpose: Render operational workflows, maintain browser auth/refresh state, and consume JSON/SSE APIs in `frontend/`.
- Location: `frontend/src/main.tsx`, `frontend/app/`, `frontend/components/`, `frontend/lib/`.
- Contains: Route composition, feature components, context providers, typed API DTOs, query hooks, import mapping, and UI primitives.
- Depends on: React/React Router and the `/api` contract exposed by `backend/api/`; development proxy rules live in `frontend/vite.config.ts`.
- Used by: Browsers through Vite in development or the embedded filesystem served from `backend/api/api.go` in production.

## Data Flow

### Primary Request Path

1. A browser route mounts from `frontend/src/main.tsx:17`; `AuthProvider` probes `/api/auth/me` in `frontend/lib/auth-context.tsx:49` before `AuthGate` exposes the application.
2. A feature hook in `frontend/lib/queries.ts:78` calls `apiFetch`, which prefixes `/api`, attaches the bearer token, unwraps `{data: ...}`, and raises an `ApiError` in `frontend/lib/api.ts:55`.
3. Gin routes under `/api` pass through the current runtime auth middleware in `backend/api/api.go:87` and `backend/runtimeconfig/runtime.go:88`.
4. A registrar in `backend/api/` validates path/query/body input and calls a service or repository, for example channel routes in `backend/api/channels.go:20`.
5. Application services call repositories in `backend/storage/` and, when needed, adapters selected by `connector.For` in `backend/connector/connector.go:391`.
6. The handler returns a JSON body, normally under `data`; `apiFetch` accepts both wrapped and flat responses in `frontend/lib/api.ts:95`.

### Manual Synchronization with Progress

1. `ChannelCards` starts a POST stream through `frontend/lib/sync-stream.ts:108`; fetch is used so the authorization header can accompany the SSE request.
2. `syncChannel` or `syncAllChannels` configures `text/event-stream` and wraps the request context with a progress observer in `backend/api/channels.go:788` and `backend/api/channels.go:825`.
3. Channel and monitor services emit typed stages through `backend/progress/progress.go`; the SSE observer serializes each event in `backend/api/channels.go:727`.
4. The browser parser consumes `data:` frames and reports progress/completion callbacks from `frontend/lib/sync-stream.ts` to `frontend/components/monitor/channel-cards.tsx`.

### Scheduled Monitoring

1. Cron callbacks are registered from configured expressions by `backend/scheduler/scheduler.go:68` and invoked with five-minute contexts in `backend/scheduler/scheduler.go:100` and `backend/scheduler/scheduler.go:111`.
2. `ScanAllBalances` and `ScanAllRates` iterate monitor-enabled channels in `backend/monitor/service.go:50` and `backend/monitor/service.go:69`.
3. `prepare` obtains a connector and usable session through `backend/channel/service.go` and `backend/monitor/service.go:388`.
4. Results update channel projections and append snapshots/change logs through `backend/storage/channels.go` and `backend/storage/rates.go`; failures append monitor logs through `backend/storage/monitor_logs.go`.
5. Policy-qualified alerts fan out through `backend/notify/dispatcher.go:267` and persist send results through `backend/storage/notifications.go`.
6. A rate scan also invokes `SyncAllOnRateScan` through the small scheduler interface in `backend/scheduler/scheduler.go:33`.

### Upstream Account Reconciliation

1. HTTP requests enter `backend/api/upstream_sync.go`, while scheduled rate scans enter `backend/syncer/service.go` through `SyncAllOnRateScan`.
2. `backend/syncer/service.go` loads target/group/account mappings from the repositories in `backend/storage/upstream_sync.go` and decrypts remote credentials with `backend/crypto/cipher.go`.
3. Source operations use the connector contract from `backend/connector/connector.go`; target administration uses the Sub2API admin client in `backend/connector/sub2api/admin.go`.
4. `applyAccountsConcurrently` partitions account work by source channel and caps workers at five in `backend/syncer/service.go:839`.
5. Remote changes and failures are summarized into `UpstreamSyncLog` records from `backend/storage/model.go` and optional notifications through `backend/notify/dispatcher.go`.

### Runtime Configuration Apply

1. The settings UI reads and writes the configuration resource through `frontend/app/settings-page.tsx` and `backend/api/settings.go`.
2. `saveSettingsConfig` persists allowed sections using `config.Save` in `backend/api/settings.go:57` and `backend/config/config.go:246`.
3. `ApplyFromFile` constructs replacement auth/scheduler state, updates notification/channel proxy policies, starts the new scheduler, swaps guarded pointers, and stops the old scheduler in `backend/runtimeconfig/runtime.go:112`.
4. Database connection, HTTP listener, and logger remain process-start concerns in `cmd/server/main.go` and are not replaced by `backend/runtimeconfig/runtime.go`.

**State Management:**
- Persist durable operational state in GORM records from `backend/storage/model.go`; encrypt secret-bearing fields before repository writes through `backend/crypto/cipher.go` and owning services.
- Keep mutable backend runtime state behind `sync.RWMutex` in `backend/channel/service.go`, `backend/notify/dispatcher.go`, and `backend/runtimeconfig/runtime.go`.
- Keep browser authentication in `localStorage` plus `AuthContext` via `frontend/lib/api.ts` and `frontend/lib/auth-context.tsx`.
- Drive shared browser refreshes with a 30-second context tick in `frontend/lib/refresh-context.tsx`; deduplicate same-tick requests with module-level maps in `frontend/lib/queries.ts`.
- Keep dialog/form/workflow state local to feature components such as `frontend/components/monitor/channel-cards.tsx` and `frontend/components/settings/upstream-sync-settings.tsx`.

## Key Abstractions

**API Dependency Bundle:**
- Purpose: Supply handlers with repositories and application services without package-level service singletons.
- Examples: `backend/api/api.go`, `cmd/server/main.go`.
- Pattern: Constructor-built dependency object plus consumer-owned interfaces in `backend/api/api.go`.

**Connector:**
- Purpose: Present NewAPI and Sub2API through one upstream operations contract.
- Examples: `backend/connector/connector.go`, `backend/connector/newapi/newapi.go`, `backend/connector/sub2api/sub2api.go`.
- Pattern: Registry/factory with blank-import registration from `cmd/server/main.go`; use optional narrow capability interfaces from `backend/connector/connector.go`.

**Repository:**
- Purpose: Group database operations by persisted aggregate while sharing one GORM connection.
- Examples: `backend/storage/channels.go`, `backend/storage/rates.go`, `backend/storage/notifications.go`, `backend/storage/upstream_sync.go`.
- Pattern: Thin struct wrapping `*gorm.DB`, constructed by `New...` functions in `backend/storage/`.

**Progress Observer:**
- Purpose: Let domain work report progress without depending on HTTP/SSE transport.
- Examples: `backend/progress/progress.go`, `backend/api/channels.go`.
- Pattern: Observer stored in `context.Context`, with a no-op default for cron and an SSE implementation for HTTP.

**Notifier and Captcha Provider:**
- Purpose: Select heterogeneous outbound services by persisted type.
- Examples: `backend/notify/notifier.go`, `backend/captcha/provider.go`.
- Pattern: Synchronized registry plus package `init` registration in concrete files such as `backend/notify/telegram.go` and `backend/captcha/capsolver.go`.

**Frontend API Query:**
- Purpose: Standardize auth, error parsing, polling, stale-data retention, and request deduplication.
- Examples: `frontend/lib/api.ts`, `frontend/lib/queries.ts`, `frontend/lib/refresh-context.tsx`.
- Pattern: Typed `fetch` wrapper plus custom React hooks and a shared refresh context, without an external server-state library.

**Import Mapper:**
- Purpose: Convert all-api-hub backups into validated create/update previews before API submission.
- Examples: `frontend/lib/all-api-hub-import.ts`, `frontend/components/monitor/channel-import-dialog.tsx`.
- Pattern: Pure parsing/mapping functions separated from dialog side effects; current working-tree rules include bounded conflict renaming in `frontend/lib/all-api-hub-import.ts`.

## Entry Points

**Backend Process:**
- Location: `cmd/server/main.go`.
- Triggers: `go run ./cmd/server`, the binary entrypoint in `Dockerfile`, or the Air watcher configured by `.air.toml`.
- Responsibilities: Build the dependency graph, run migrations/scheduler/server, and handle termination in `cmd/server/main.go`.

**Frontend Browser Application:**
- Location: `frontend/src/main.tsx`.
- Triggers: Vite loads it from `frontend/index.html` in development/build output.
- Responsibilities: Mount providers, auth gate, routes, shell, pages, and global toaster in `frontend/src/main.tsx`.

**HTTP Route Registration:**
- Location: `backend/api/api.go`.
- Triggers: `api.Register` from `cmd/server/main.go`.
- Responsibilities: Expose health/API routes, install dynamic auth, and register the optional embedded SPA filesystem in `backend/api/api.go`.

**Scheduled Work:**
- Location: `backend/scheduler/scheduler.go`.
- Triggers: Cron expressions loaded from `backend/config/config.go` and started in `cmd/server/main.go`.
- Responsibilities: Invoke balance/rate/retention jobs with bounded contexts in `backend/scheduler/scheduler.go`.

**Production Asset Assembly:**
- Location: `Dockerfile` and `web/web.go`.
- Triggers: Docker image build from the repository root.
- Responsibilities: Build `frontend/`, copy its output to `web/dist/`, embed it during Go compilation, and ship one runtime binary.

## Architectural Constraints

- **Threading:** Gin serves requests concurrently and `cmd/server/main.go` runs `ListenAndServe` in a goroutine; cron jobs use `robfig/cron` in `backend/scheduler/scheduler.go`, monitor channel scans are sequential in `backend/monitor/service.go`, and upstream account apply uses a five-worker cap in `backend/syncer/service.go`.
- **Database concurrency:** SQLite forces one open and one idle connection with WAL and a five-second busy timeout in `backend/storage/storage.go`; MySQL uses configured pool sizes from `backend/config/config.go`.
- **Global state:** Adapter registries are package-level mutex-protected maps in `backend/connector/connector.go`, `backend/notify/notifier.go`, and `backend/captcha/provider.go`; frontend token callbacks and query caches are module-level state in `frontend/lib/api.ts` and `frontend/lib/queries.ts`.
- **Configuration boundary:** Environment/file loading and defaults belong in `backend/config/config.go`; only app/auth/scheduler/notification/retention/proxy/upstream sections are hot-applied by `backend/runtimeconfig/runtime.go`.
- **Circular imports:** `go list ./...` resolves all packages; maintain the direction `api/scheduler -> services -> storage/adapters`, with composition only in `cmd/server/main.go`.
- **Frontend/backend boundary:** Development requests proxy through `frontend/vite.config.ts`; production must route API before the SPA `NoRoute` fallback in `backend/api/api.go`.
- **Frontend build boundary:** `web/dist/.gitkeep` is only a placeholder; `web.HasFrontend` in `web/web.go` prevents an empty development embed from registering the SPA handler.
- **Persistence schema:** Add GORM records to `backend/storage/model.go` and explicitly include them in `storage.AutoMigrate` in `backend/storage/storage.go`.

## Anti-Patterns

### Direct Adapter Construction

**What happens:** Calling `newapi.New`, `sub2api.New`, or a concrete notifier/provider directly outside registration bypasses the polymorphic selection path in `backend/connector/connector.go`, `backend/notify/notifier.go`, or `backend/captcha/provider.go`.
**Why it's wrong:** It duplicates proxy/HTTP configuration and makes channel/provider type selection inconsistent with persisted types in `backend/storage/model.go`.
**Do this instead:** Add/register the implementation at its adapter boundary and resolve it with `connector.For`, `notify.Build`, or `captcha.BuildWithProxy` in `backend/connector/connector.go`, `backend/notify/notifier.go`, or `backend/captcha/provider.go`.

### Handler-Owned Business Workflows

**What happens:** Putting encryption, session refresh, upstream sequencing, or multi-record mutations directly in a Gin closure expands delivery logic beyond the pattern in `backend/api/channels.go` and `backend/api/upstream_sync.go`.
**Why it's wrong:** HTTP-only workflows cannot be reused by `backend/scheduler/scheduler.go`, and secret/session rules in `backend/channel/service.go` can be bypassed.
**Do this instead:** Keep binding/status translation in `backend/api/`; put reusable orchestration in the owning service package and expose a small consumer interface through `backend/api/api.go` when tests need substitution.

### Cross-Package Model Duplication

**What happens:** Defining alternate persisted records outside `backend/storage/model.go` creates drift from migrations and repository queries in `backend/storage/`.
**Why it's wrong:** `storage.AutoMigrate` in `backend/storage/storage.go` is the schema authority and service code assumes the shared storage types.
**Do this instead:** Add durable models to `backend/storage/model.go`, migrate them from `backend/storage/storage.go`, and expose focused repository methods in a matching `backend/storage/*.go` file.

### Bypassing the Frontend API Layer

**What happens:** Feature components that call raw `fetch` for ordinary JSON requests bypass token injection, 401 handling, response unwrapping, polling, and deduplication from `frontend/lib/api.ts` and `frontend/lib/queries.ts`.
**Why it's wrong:** Authentication and error behavior diverge across pages; duplicate dashboard reads are more likely under React Strict Mode in `frontend/src/main.tsx`.
**Do this instead:** Add typed DTOs to `frontend/lib/api-types.ts`, reads to `frontend/lib/queries.ts`, and mutations through `apiFetch`; reserve raw streaming fetch for the SSE parser in `frontend/lib/sync-stream.ts`.

## Error Handling

**Strategy:** Fail fast for process initialization, translate request failures at the HTTP edge, isolate per-item background failures, and surface typed browser errors (`cmd/server/main.go`, `backend/api/api.go`, `backend/scheduler/scheduler.go`, `frontend/lib/api.ts`).

**Patterns:**
- Wrap or log startup errors and exit before serving when config, cipher, database, migration, auth, or scheduler setup fails in `cmd/server/main.go`.
- Return `{"error": ...}` with an explicit HTTP status through `fail` in `backend/api/api.go`; use `ShouldBindJSON` and typed path/query parsers in `backend/api/`.
- Return ordinary Go errors from application/repository methods and let callers add operation context or choose HTTP/log/notification behavior in `backend/channel/service.go`, `backend/monitor/service.go`, and `backend/syncer/service.go`.
- Continue scanning other channels after a per-channel error and persist/log outcomes in `backend/monitor/service.go` and `backend/storage/monitor_logs.go`.
- Continue independent retention tables after failures and log each outcome in `backend/scheduler/scheduler.go`.
- Convert non-2xx bodies into `ApiError` objects and invoke a global unauthorized callback on 401 in `frontend/lib/api.ts`; feature components render or toast the resulting messages.
- Emit a terminal failure event for streaming workflows through `backend/progress/progress.go` and parse it in `frontend/lib/sync-stream.ts`.

## Cross-Cutting Concerns

**Logging:** Use structured `log/slog` created by `backend/logger/logger.go`; inject the logger into services from `cmd/server/main.go`, while GORM uses its configured warning/slow-query logger in `backend/storage/storage.go`.
**Validation:** Use Gin binding and explicit route/query validation in `backend/api/`, service-level invariant checks in `backend/channel/service.go` and `backend/syncer/service.go`, and pure import validation in `frontend/lib/all-api-hub-import.ts`.
**Authentication:** Use optional single-admin HMAC tokens from `backend/auth/auth.go`; resolve the live service through `backend/runtimeconfig/runtime.go`, enforce it on the `/api` group in `backend/api/api.go`, and coordinate browser token state through `frontend/lib/auth-context.tsx` and `frontend/lib/api.ts`.
**Secrets:** Encrypt persisted upstream credentials, sessions, notification configs, captcha keys, and sync target keys through `backend/crypto/cipher.go` before repository writes owned by `backend/channel/`, `backend/notify/`, `backend/captcha/`, and `backend/syncer/`.
**Proxying:** Derive global/per-record proxy behavior in `backend/config/proxy.go` and apply it at connector, notifier, captcha, and version-check boundaries in `backend/channel/service.go`, `backend/notify/dispatcher.go`, `backend/captcha/balance.go`, and `backend/api/version.go`.

---

*Architecture analysis: 2026-07-18*
