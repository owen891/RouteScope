<!-- GSD:project-start source:PROJECT.md -->

## Project

**UpstreamOps Local Ops Edition**

UpstreamOps Local Ops Edition 是基于官方 `bejix/upstream-ops` v0.0.6 的自托管上游运维控制台，面向需要日常管理 NewAPI 与 Sub2API 渠道的单一运维者。它把渠道导入、故障定位与修复、同步、通知、鉴权和数据保护集中到一个可审计、可恢复的工作界面中。

当前里程碑是发布 `v0.0.6-ops.1`：不再扩展 P0 功能范围，优先把已实现的二改能力验证、加固并形成可重复发布流程。

**Core Value:** 运维者能够安全、快速地发现上游渠道故障，批量修复或同步，并在变更前后可靠地验证与恢复数据。

### Constraints

- **Compatibility**: 必须保留官方 v0.0.6 的现有渠道、监控、同步和通知行为，二改不能破坏既有数据库。
- **Deployment**: 主发布形态是 Docker Compose 单体容器，数据继续挂载在 `./data`。
- **Security**: `APP_SECRET` 必须长期固定；生产发布必须启用管理员鉴权，任何日志、文档、测试和导出不得包含真实密钥。
- **Recovery**: 任何升级或批量导入前必须有可验证备份，恢复流程必须能在当前 Compose 环境完成。
- **Upstreamability**: 二改应保持边界清晰，便于以后合并官方新版本；避免无关的大规模重构。
- **Quality**: 发布前必须通过 Go 全量测试、前端 lint/test/build、Compose 校验和关键人工 UAT。

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Go 1.23 - Backend HTTP server, upstream connectors, scheduling, notifications, persistence, and the production entry point in `cmd/server/main.go`; the module version is declared in `go.mod`.
- TypeScript 5.7.3 - Browser application, API client, state providers, and UI components under `frontend/`; strict checking and no emitted compiler output are configured in `frontend/tsconfig.json`.
- CSS - Tailwind CSS 4 imports, CSS custom properties, themes, and application-specific styles in `frontend/app/globals.css`.
- Shell and PowerShell - Cross-platform build, verification, backup, authentication, and production checks in `scripts/*.sh` and `scripts/*.ps1`.
- YAML - Runtime configuration serialization in `backend/config/config.go`, Docker Compose deployment in `docker-compose.yml` and `docker-compose.mysql.yml`, and GitHub Actions in `.github/workflows/`.
- HTML - Vite browser entry document in `frontend/index.html`.

## Runtime

- Go 1.23; production compiles a statically linked Linux binary with `CGO_ENABLED=0` from `./cmd/server` in `Dockerfile`.
- Node.js 20 Alpine is the frontend build environment in `Dockerfile`; Node.js 20 is also pinned in `.github/workflows/quality.yml`.
- Alpine Linux 3.20 is the production container base in `Dockerfile`, with CA certificates, timezone data, and `wget` for health checks.
- Browser target is ES2020 with DOM and ESNext libraries configured in `frontend/tsconfig.json`.
- Go modules - Backend dependency management through `go.mod` and `go.sum`.
- pnpm 10.4.0 - Authoritative frontend package manager, pinned in `frontend/package.json`, `Dockerfile`, and `.github/workflows/quality.yml`.
- Lockfile: `go.sum` and `frontend/pnpm-lock.yaml` are present; `frontend/package-lock.json` is also present, but Docker and CI use pnpm.
- Workspace/build approvals: `frontend/pnpm-workspace.yaml` defines the root package and permits the `esbuild` install script.

## Frameworks

- Gin 1.10.0 - HTTP routing, middleware, JSON endpoints, health checks, and SPA fallback in `backend/api/api.go` and `cmd/server/main.go`.
- React 19 - Client UI rendered from `frontend/src/main.tsx`.
- React DOM 19 - Browser root renderer in `frontend/src/main.tsx`.
- React Router DOM 7.16 - Client-side routes for dashboard, captcha, notifications, and settings in `frontend/src/main.tsx`.
- GORM 1.30.0 - Database access, migrations, models, and repositories under `backend/storage/`.
- Vite 6 - Frontend development server and production bundler configured in `frontend/vite.config.ts`.
- Tailwind CSS 4 - Utility CSS integrated through `@tailwindcss/vite` in `frontend/vite.config.ts` and imported from `frontend/app/globals.css`.
- Radix UI primitives plus shadcn-style local wrappers - Accessible UI foundation in `frontend/components/ui/`, configured by `frontend/components.json`.
- Go standard `testing` package - Backend unit and integration-style tests in `backend/**/*_test.go`.
- Vitest 3.2.4 - Node-environment frontend tests matching `frontend/lib/**/*.test.ts`, configured in `frontend/vitest.config.ts`.
- `httptest` - In-process HTTP doubles for connectors, auth, API routes, notifications, monitoring, and sync behavior throughout backend test files such as `backend/monitor/service_test.go`.
- TypeScript compiler 5.7.3 - Strict static checking as part of the Vite build via `frontend/tsconfig.json`.
- ESLint 9.39.5 with typescript-eslint 8.63 - Frontend lint gate configured in `frontend/eslint.config.js`.
- Air - Go hot reload using `.air.toml`; watches `backend/`, `cmd/`, `web/`, module files, and runtime YAML.
- Docker Buildx - Three-stage frontend/backend/runtime image in `Dockerfile`, published as amd64 and arm64 by `.github/workflows/publish.yml`.
- GitHub Actions - Backend tests, frontend install/lint/test/build, Compose validation, and image publishing in `.github/workflows/quality.yml` and `.github/workflows/publish.yml`.

## Key Dependencies

- `github.com/gin-gonic/gin` 1.10.0 - Backend API and embedded frontend delivery from `backend/api/api.go`.
- `gorm.io/gorm` 1.30.0 - Persistence abstraction and startup migration in `backend/storage/storage.go`.
- `github.com/glebarez/sqlite` 1.11.0 - Pure-Go SQLite driver, allowing the static CGO-free production build in `Dockerfile`.
- `gorm.io/driver/mysql` 1.6.0 - Optional MySQL storage selected by runtime configuration in `backend/storage/storage.go`.
- `github.com/go-resty/resty/v2` 2.16.2 - HTTP client for upstream connectors, notification transports, and captcha providers under `backend/connector/`, `backend/notify/`, and `backend/captcha/`.
- `github.com/spf13/viper` 1.19.0 - YAML defaults, config-file loading, and environment overrides in `backend/config/config.go`.
- `github.com/robfig/cron/v3` 3.0.1 - Scheduled balance, rate, sync, retention, and captcha jobs in `backend/scheduler/scheduler.go`.
- `gopkg.in/yaml.v3` 3.0.1 - Persisting runtime configuration from `backend/config/config.go`.
- `react` and `react-dom` 19 - Frontend application runtime declared in `frontend/package.json`.
- `react-router-dom` 7.16.0 - Browser navigation in `frontend/src/main.tsx`.
- `@radix-ui/react-*` - Component primitives wrapped in `frontend/components/ui/`.
- `lucide-react` 0.564 - Icon system used across `frontend/components/` and `frontend/app/`.
- `recharts` 2.15.0 - Balance and rate charts such as `frontend/components/monitor/balance-overview.tsx`.
- `react-hook-form` 7.54.1, `@hookform/resolvers` 3.9.1, and `zod` 3.24.1 - Form and validation dependencies declared in `frontend/package.json`.
- `sonner` 1.7.1 - Toast notifications mounted from `frontend/src/main.tsx`.
- `next-themes` 0.4.6 - Theme state in `frontend/components/theme-provider.tsx`.
- `qrcode` 1.5.4 - Rendering recharge and subscription QR data in `frontend/components/monitor/channel-recharge-dialog.tsx`.
- `date-fns` 4.1.0 - Date manipulation and display support declared in `frontend/package.json`.
- Go `embed` - Vite output is embedded into the server binary by `web/web.go`; `backend/api/api.go` serves assets and SPA fallback routes.
- Go `log/slog` - Structured text or JSON application logs configured by `backend/logger/logger.go`.
- Browser `fetch` and Streams APIs - Same-origin REST calls in `frontend/lib/api.ts` and authenticated SSE consumption in `frontend/lib/sync-stream.ts`; no Axios dependency is used.
- AES-GCM from the Go standard library - Encryption at rest for integration credentials in `backend/crypto/cipher.go`.

## Configuration

- Configuration loads from `config.yaml` through Viper, applies defaults, and then accepts environment overrides in `backend/config/config.go`.
- The server accepts `-config <path>` in `cmd/server/main.go`; without an explicit file it searches the working directory and creates `config.yaml` when absent.
- Runtime settings can be saved and hot-applied through `backend/api/settings.go` and `backend/runtimeconfig/runtime.go`.
- Core environment names are `APP_SECRET`, `AUTH_ENABLED`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AUTH_TOKEN_SECRET`, `SERVER_PORT`, `SERVER_MODE`, and `LOG_LEVEL`, bound in `backend/config/config.go`.
- Database environment names are `DATABASE_DRIVER`, `DATABASE_PATH`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME`, bound in `backend/config/config.go`.
- Compose/deployment-only names include `HTTP_PORT`, `IMAGE_TAG`, and the `MYSQL_*` family referenced by `docker-compose.yml` and `docker-compose.mysql.yml`.
- Frontend development may override the Vite proxy with `VITE_BACKEND_URL` in `frontend/vite.config.ts`.
- `.env` and `.env.example` are present for deployment configuration; secret-bearing contents are intentionally not part of this map. `.env` and generated `config.yaml` are excluded by `.gitignore`.
- `go.mod` and `go.sum` define the backend build graph.
- `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/pnpm-workspace.yaml`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, and `frontend/eslint.config.js` define the frontend toolchain.
- `Dockerfile` builds the frontend, copies `frontend/dist/` to `web/dist/`, and compiles the embedded production server.
- `.dockerignore` controls the Docker build context; `.air.toml` configures local backend reload.
- `frontend/components.json` records shadcn-style component aliases, Tailwind CSS location, and the Lucide icon library.

## Platform Requirements

- Use Go 1.23 or a compatible newer Go toolchain for `go test ./...` and `go run ./cmd/server`, as declared by `go.mod`.
- Use Node.js 20 and pnpm 10.4.0 for `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm dev`, and `pnpm build`, matching `Dockerfile` and `.github/workflows/quality.yml`.
- The Vite development server listens on port 3010 and proxies `/api` and `/healthz` to the Go server, which defaults to port 8418, as configured in `frontend/vite.config.ts` and `backend/config/config.go`.
- A writable data directory is required for SQLite and generated runtime configuration; defaults are implemented in `backend/storage/storage.go` and `backend/config/config.go`.
- Docker/Compose is required for parity with the integrated production image and for the optional MySQL service in `docker-compose.mysql.yml`.
- Primary deployment target is a self-hosted Docker/Compose environment using the GHCR image described by `docker-compose.yml`.
- The container exposes port 8418, serves the embedded SPA and API from one process, and persists database/configuration data through a host-mounted data volume defined by `Dockerfile`, `web/web.go`, and `docker-compose.yml`.
- SQLite is the default single-container store; MySQL 8.4 is the optional multi-container deployment in `docker-compose.mysql.yml`.
- Multi-architecture images for `linux/amd64` and `linux/arm64` are produced by `.github/workflows/publish.yml`.
- The project license is MIT, declared in `README.md`.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Use lowercase Go package directories and short domain-oriented filenames: `backend/auth/auth.go`, `backend/channel/service.go`, and `backend/storage/notifications.go`.
- Use `_test.go` for package-local Go tests: `backend/auth/auth_test.go` and `backend/storage/storage_test.go`. Tests use the same package name as the implementation, which permits testing unexported helpers.
- Use kebab-case for TypeScript modules and React component files: `frontend/lib/all-api-hub-import.ts`, `frontend/components/monitor/channel-form-dialog.tsx`, and `frontend/app/settings-page.tsx`.
- Keep reusable primitives under `frontend/components/ui/` and domain components under a named feature directory such as `frontend/components/monitor/` or `frontend/components/settings/`.
- Use PascalCase for exported Go functions and constructors (`Register`, `Open`, `AutoMigrate`, `NewService`) and camelCase for package-private helpers (`registerChannels`, `parsePageQuery`, `openTestDB`) as shown in `backend/api/api.go`, `backend/storage/storage.go`, and `backend/api/dashboard_test.go`.
- Use receiver methods for behavior owned by a service or repository (`Service.Create`, `Channels.FindByID`), and accept `context.Context` as the first argument for operations that perform network or long-running work; see `backend/channel/service.go` and `backend/connector/connector.go`.
- Name React components in PascalCase (`AuthProvider`, `ChannelCards`, `Button`) and hooks with the `use` prefix (`useAuth`, `useChannels`, `useRefreshTick`) in `frontend/lib/auth-context.tsx`, `frontend/components/monitor/channel-cards.tsx`, and `frontend/lib/queries.ts`.
- Name local TypeScript helpers in camelCase and make them narrow (`cacheKey`, `fetchShared`, `statusOf`) rather than introducing utility classes; see `frontend/lib/queries.ts` and `frontend/components/monitor/channel-cards.tsx`.
- Use short conventional Go locals (`cfg`, `db`, `err`, `ctx`, `svc`) within small scopes and descriptive field names on structs; `cmd/server/main.go` is the composition-root example.
- Use camelCase for TypeScript state and locals (`authDisabled`, `refreshTick`, `hasDataRef`) and uppercase snake case for module constants (`TOKEN_KEY`, `CACHE_TTL_MS`, `BACKEND_TARGET`) in `frontend/lib/api.ts`, `frontend/lib/queries.ts`, and `frontend/vite.config.ts`.
- Preserve snake_case only at API and persisted-data boundaries (`expires_at`, `site_url`, `last_error`); map frontend control variables and component props to camelCase. Wire types live in `frontend/lib/api-types.ts`, while Go JSON/GORM tags live in `backend/storage/model.go`.
- Use PascalCase for exported Go structs, enums, and interfaces (`DBConfig`, `ChannelType`, `Provider`) and lowercase names for consumer-owned internal interfaces (`monitorService`, `channelService`) in `backend/storage/storage.go`, `backend/captcha/provider.go`, and `backend/api/api.go`.
- Prefer typed string constants for domain enums (`DBDriver`, `ChannelType`, `CredentialMode`) instead of raw strings in business logic; see `backend/storage/storage.go` and `backend/storage/model.go`.
- Use PascalCase for TypeScript interfaces and union aliases (`ApiError`, `AuthContextValue`, `Status`, `ChannelPageSize`), with discriminated string unions for bounded UI states in `frontend/lib/api.ts`, `frontend/lib/auth-context.tsx`, and `frontend/components/monitor/channel-cards.tsx`.

## Code Style

- Format Go with `gofmt`: tabs, grouped imports, and standard composite-literal alignment are the repository pattern across `backend/`, `cmd/`, and `web/`. No separate Go formatter configuration exists.
- TypeScript uses two-space indentation, omitted semicolons, trailing commas in multiline constructs, and multiline JSX props. No Prettier or Biome configuration is present.
- Quote style is not enforced. Hand-authored feature modules commonly use double quotes (`frontend/lib/api.ts`, `frontend/lib/queries.ts`), while Vite/bootstrap and UI primitive files commonly use single quotes (`frontend/src/main.tsx`, `frontend/components/ui/button.tsx`). Match the containing file and avoid quote-only churn.
- Keep Tailwind classes inline in JSX for component styling and merge conditional classes with `cn` from `frontend/lib/utils.ts`; variant-heavy primitives use `class-variance-authority`, as in `frontend/components/ui/button.tsx`.
- Run `pnpm lint` from `frontend/`. `frontend/eslint.config.js` applies `typescript-eslint` recommended rules to the frontend and ignores `.vite`, `dist`, and `node_modules`.
- Explicit `any` is permitted because `@typescript-eslint/no-explicit-any` is disabled in `frontend/eslint.config.js`; prefer `unknown` and boundary narrowing when practical, following `frontend/lib/api.ts`.
- TypeScript compiler options are strict and no-emit in `frontend/tsconfig.json`, but the repository quality workflow does not run `tsc --noEmit`. Run `pnpm exec tsc --noEmit --incremental false` when changing shared types or complex component props.
- The backend has no repository-specific `golangci-lint`, `staticcheck`, or `go vet` configuration. Use compiler diagnostics, `go test ./...`, `gofmt`, and optionally `go vet ./...`.

## Import Organization

- `@/*` maps to the `frontend/` root through `frontend/tsconfig.json`, `frontend/vite.config.ts`, and `frontend/vitest.config.ts`.
- Go imports use the full module prefix `github.com/bejix/upstream-ops/...` declared in `go.mod`.

## Error Handling

- Return errors as the final Go return value and stop at the point of failure. Add operation context with `fmt.Errorf("operation: %w", err)` so callers can unwrap causes; `backend/storage/storage.go` and `backend/connector/sub2api/sub2api.go` are representative.
- Use `errors.New` for invariant and validation failures that do not wrap an underlying cause. User-facing domain validation may be localized, while lower-level connector errors include the provider and operation name; see `backend/channel/service.go` and `backend/captcha/yescaptcha.go`.
- Translate handler failures to JSON through `fail(c, status, err)` in `backend/api/api.go`, choosing status codes at the handler boundary after `ShouldBindJSON` and explicit input validation in files such as `backend/api/channels.go`.
- In the frontend, make `apiFetch` the HTTP error boundary: it throws an `ApiError` with `status` and parsed `body`, unwraps `{ data }`, and triggers the global unauthorized handler on 401 in `frontend/lib/api.ts`.
- Hooks convert caught errors to user-displayable state, while commands generally show `sonner` toasts. Preserve cancellation guards in effects to avoid state updates after unmount; see `frontend/lib/queries.ts` and `frontend/lib/auth-context.tsx`.

## Logging

- Inject `*slog.Logger` into long-lived backend services and emit structured key/value context (`"err", err`, `"path", path`) rather than interpolated log strings; `cmd/server/main.go` is the composition example.
- Log startup, shutdown, configuration milestones, and recoverable background failures. Return request-path errors to handlers rather than logging the same error at every layer.
- Use discarded `slog` handlers in tests that do not assert logs, following `backend/monitor/service_test.go`, `backend/scheduler/scheduler_test.go`, and `backend/syncer/service_test.go`.
- Use toasts for actionable frontend outcomes and keep `console.*` out of ordinary feature code unless diagnosing a development-only path.

## Comments

- Add package and exported-type comments where domain rules, security constraints, or side effects are not obvious. `backend/api/api.go`, `backend/storage/model.go`, and `frontend/lib/api.ts` explain routing, credential storage, and API-client contracts.
- Comment non-obvious lifecycle and concurrency decisions, such as effect cancellation, request deduplication, SPA fallback protection, and credential-mode semantics. Do not narrate straightforward assignments.
- Keep operational comments close to the constraint they protect; examples include the `StrictMode` request deduplication rationale in `frontend/lib/queries.ts` and connector registration comments in `cmd/server/main.go`.
- Use short `/** ... */` blocks for exported frontend helpers and context fields whose behavior is not evident from the type. Most component props and simple helpers remain self-documenting; see `frontend/lib/api.ts` and `frontend/lib/queries.ts`.
- Go documentation follows standard `// Name ...` comments for packages and exported declarations when the contract needs explanation; not every exported repository/model method is documented.

## Function Design

- Group backend dependencies into constructors and the `api.Deps` composition struct rather than using global service singletons; see `backend/api/api.go` and `cmd/server/main.go`.
- Use input structs for multi-field domain operations (`channel.CreateInput`, `connector.RechargeRequest`) and typed props objects for React components. Keep context first for I/O-capable Go methods.
- Define narrow interfaces in the consuming Go package to support test stubs, as `channelService` in `backend/api/api.go` does.
- Return `(value, error)` or `error` from Go domain and storage operations; use pointers when absence or mutation matters and slices for collections.
- Return typed promises from frontend network helpers and explicit state objects from hooks (`QueryState<T>` in `frontend/lib/queries.ts`). Use `null` for absent UI state and reserve `undefined` for optional wire fields.

## Module Design

- Keep Go implementation details package-private and export constructors, domain types, and service operations needed across packages. Provider implementations register through `init` and blank imports in `cmd/server/main.go`.
- Prefer named TypeScript exports for libraries, hooks, contexts, and UI primitives. Page modules use default component exports to match the route imports in `frontend/src/main.tsx`.
- Keep API wire schemas centralized in `frontend/lib/api-types.ts`, transport behavior in `frontend/lib/api.ts`, reusable data hooks in `frontend/lib/queries.ts`, and presentation in `frontend/components/` or `frontend/app/`.
- Barrel exports are not used. Import directly from the owning file, such as `@/components/ui/button` or `@/lib/api`.
- Add backend code to the narrowest domain package under `backend/`; add frontend domain components under `frontend/components/<feature>/`, primitives under `frontend/components/ui/`, and pure shared logic under `frontend/lib/`.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text
| Browser SPA: React routes, feature components, contexts, API hooks     |
| `frontend/src/main.tsx`, `frontend/app/`, `frontend/components/`       |
| HTTP delivery: Gin router, auth middleware, route-specific handlers    |
| `backend/api/`, composed by `cmd/server/main.go`                       |
| Application orchestration       |  | Runtime/background orchestration |
| `backend/channel/`, `monitor/`,  |  | `backend/scheduler/`,            |
| `syncer/`, `notify/`, `captcha/` |  | `backend/runtimeconfig/`         |
| Ports/adapters: connector, notifier, captcha registries                |
| `backend/connector/`, `backend/notify/`, `backend/captcha/`            |
| Persistence: GORM repositories and models; SQLite or MySQL             |
| `backend/storage/`                                                     |
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

- Use explicit constructor injection from `cmd/server/main.go`; handlers receive the assembled graph through `api.Deps` in `backend/api/api.go`.
- Use package-local consumer interfaces at boundaries: `monitorService` and `channelService` live in `backend/api/api.go`, while `upstreamSyncService` lives in `backend/scheduler/scheduler.go`.
- Use repository structs over a shared `*gorm.DB`; construct them in `cmd/server/main.go` and keep model/query ownership in `backend/storage/`.
- Use registry-backed adapters for variable external systems; connector implementations register from `backend/connector/newapi/` and `backend/connector/sub2api/`, notifier implementations from `backend/notify/`, and captcha implementations from `backend/captcha/`.
- Use a query-side exception for read aggregation: dashboard handlers combine repository reads directly in `backend/api/dashboard.go`, while mutation and upstream workflows pass through application services.
- Use browser contexts for coarse global state and local hooks/component state for feature data in `frontend/lib/auth-context.tsx`, `frontend/lib/refresh-context.tsx`, and `frontend/lib/queries.ts`.

## Layers

- Purpose: Assemble all concrete dependencies and own startup/shutdown sequencing in `cmd/server/main.go`.
- Location: `cmd/server/main.go`.
- Contains: Configuration loading, logger/cipher/database initialization, repository and service construction, cron startup, Gin setup, HTTP server lifecycle, and signal handling in `cmd/server/main.go`.
- Depends on: All backend packages plus embedded assets from `web/web.go`.
- Used by: The built `upstream-ops` process produced from `./cmd/server` by `Dockerfile`.
- Purpose: Convert HTTP requests into application-service or repository calls and encode JSON/SSE responses in `backend/api/`.
- Location: `backend/api/`.
- Contains: One route registrar per resource area, shared dependency bundle and error response helper in `backend/api/api.go`, and SSE transport in `backend/api/channels.go`.
- Depends on: Consumer interfaces and concrete repositories/services exposed through `api.Deps` in `backend/api/api.go`.
- Used by: The Gin engine constructed in `cmd/server/main.go` and the browser client in `frontend/lib/api.ts`.
- Purpose: Coordinate multi-step use cases, encryption, upstream calls, persistence, and notifications in `backend/channel/`, `backend/monitor/`, `backend/syncer/`, `backend/notify/`, and `backend/captcha/`.
- Location: `backend/channel/service.go`, `backend/monitor/service.go`, `backend/syncer/service.go`, `backend/notify/dispatcher.go`, `backend/captcha/balance.go`.
- Contains: Channel/session lifecycle, scans, rate comparison, notification policy, captcha balance collection, and target synchronization.
- Depends on: Repository types from `backend/storage/`, ports from `backend/connector/`, and cross-cutting helpers from `backend/crypto/`, `backend/progress/`, and `backend/config/`.
- Used by: Handlers in `backend/api/` and jobs in `backend/scheduler/scheduler.go`.
- Purpose: Isolate upstream-specific HTTP contracts behind stable interfaces in `backend/connector/`, `backend/notify/`, and `backend/captcha/`.
- Location: `backend/connector/connector.go`, `backend/notify/notifier.go`, `backend/captcha/provider.go`.
- Contains: Interface DTOs, factories, synchronized registries, and optional capability interfaces such as `SessionRefresher`, `ProxySetter`, and `HTTPConfigSetter` in `backend/connector/connector.go`.
- Depends on: Standard HTTP clients, `backend/storage/model.go` types where persisted adapter configuration is required, and concrete implementations in child files/packages.
- Used by: `backend/channel/service.go`, `backend/monitor/service.go`, `backend/notify/dispatcher.go`, and `backend/captcha/balance.go`.
- Purpose: Define persisted records, database lifecycle, migrations, and focused query repositories in `backend/storage/`.
- Location: `backend/storage/`.
- Contains: GORM models in `backend/storage/model.go`, open/migration logic in `backend/storage/storage.go`, and repositories such as `backend/storage/channels.go`, `backend/storage/rates.go`, and `backend/storage/upstream_sync.go`.
- Depends on: GORM plus SQLite/MySQL drivers configured in `backend/storage/storage.go`.
- Used by: The composition root, API query handlers, application services, scheduler retention, and notification dispatcher in `cmd/server/main.go` and `backend/`.
- Purpose: Run cron-triggered work and safely replace runtime-configurable collaborators in `backend/scheduler/` and `backend/runtimeconfig/`.
- Location: `backend/scheduler/scheduler.go`, `backend/runtimeconfig/runtime.go`.
- Contains: Second-aware cron registration, bounded job contexts, retention, `sync.RWMutex`-guarded runtime pointers, and scheduler replacement.
- Depends on: Application services and repositories assembled in `cmd/server/main.go`.
- Used by: Process startup and settings apply endpoints in `cmd/server/main.go` and `backend/api/settings.go`.
- Purpose: Render operational workflows, maintain browser auth/refresh state, and consume JSON/SSE APIs in `frontend/`.
- Location: `frontend/src/main.tsx`, `frontend/app/`, `frontend/components/`, `frontend/lib/`.
- Contains: Route composition, feature components, context providers, typed API DTOs, query hooks, import mapping, and UI primitives.
- Depends on: React/React Router and the `/api` contract exposed by `backend/api/`; development proxy rules live in `frontend/vite.config.ts`.
- Used by: Browsers through Vite in development or the embedded filesystem served from `backend/api/api.go` in production.

## Data Flow

### Primary Request Path

### Manual Synchronization with Progress

### Scheduled Monitoring

### Upstream Account Reconciliation

### Runtime Configuration Apply

- Persist durable operational state in GORM records from `backend/storage/model.go`; encrypt secret-bearing fields before repository writes through `backend/crypto/cipher.go` and owning services.
- Keep mutable backend runtime state behind `sync.RWMutex` in `backend/channel/service.go`, `backend/notify/dispatcher.go`, and `backend/runtimeconfig/runtime.go`.
- Keep browser authentication in `localStorage` plus `AuthContext` via `frontend/lib/api.ts` and `frontend/lib/auth-context.tsx`.
- Drive shared browser refreshes with a 30-second context tick in `frontend/lib/refresh-context.tsx`; deduplicate same-tick requests with module-level maps in `frontend/lib/queries.ts`.
- Keep dialog/form/workflow state local to feature components such as `frontend/components/monitor/channel-cards.tsx` and `frontend/components/settings/upstream-sync-settings.tsx`.

## Key Abstractions

- Purpose: Supply handlers with repositories and application services without package-level service singletons.
- Examples: `backend/api/api.go`, `cmd/server/main.go`.
- Pattern: Constructor-built dependency object plus consumer-owned interfaces in `backend/api/api.go`.
- Purpose: Present NewAPI and Sub2API through one upstream operations contract.
- Examples: `backend/connector/connector.go`, `backend/connector/newapi/newapi.go`, `backend/connector/sub2api/sub2api.go`.
- Pattern: Registry/factory with blank-import registration from `cmd/server/main.go`; use optional narrow capability interfaces from `backend/connector/connector.go`.
- Purpose: Group database operations by persisted aggregate while sharing one GORM connection.
- Examples: `backend/storage/channels.go`, `backend/storage/rates.go`, `backend/storage/notifications.go`, `backend/storage/upstream_sync.go`.
- Pattern: Thin struct wrapping `*gorm.DB`, constructed by `New...` functions in `backend/storage/`.
- Purpose: Let domain work report progress without depending on HTTP/SSE transport.
- Examples: `backend/progress/progress.go`, `backend/api/channels.go`.
- Pattern: Observer stored in `context.Context`, with a no-op default for cron and an SSE implementation for HTTP.
- Purpose: Select heterogeneous outbound services by persisted type.
- Examples: `backend/notify/notifier.go`, `backend/captcha/provider.go`.
- Pattern: Synchronized registry plus package `init` registration in concrete files such as `backend/notify/telegram.go` and `backend/captcha/capsolver.go`.
- Purpose: Standardize auth, error parsing, polling, stale-data retention, and request deduplication.
- Examples: `frontend/lib/api.ts`, `frontend/lib/queries.ts`, `frontend/lib/refresh-context.tsx`.
- Pattern: Typed `fetch` wrapper plus custom React hooks and a shared refresh context, without an external server-state library.
- Purpose: Convert all-api-hub backups into validated create/update previews before API submission.
- Examples: `frontend/lib/all-api-hub-import.ts`, `frontend/components/monitor/channel-import-dialog.tsx`.
- Pattern: Pure parsing/mapping functions separated from dialog side effects; current working-tree rules include bounded conflict renaming in `frontend/lib/all-api-hub-import.ts`.

## Entry Points

- Location: `cmd/server/main.go`.
- Triggers: `go run ./cmd/server`, the binary entrypoint in `Dockerfile`, or the Air watcher configured by `.air.toml`.
- Responsibilities: Build the dependency graph, run migrations/scheduler/server, and handle termination in `cmd/server/main.go`.
- Location: `frontend/src/main.tsx`.
- Triggers: Vite loads it from `frontend/index.html` in development/build output.
- Responsibilities: Mount providers, auth gate, routes, shell, pages, and global toaster in `frontend/src/main.tsx`.
- Location: `backend/api/api.go`.
- Triggers: `api.Register` from `cmd/server/main.go`.
- Responsibilities: Expose health/API routes, install dynamic auth, and register the optional embedded SPA filesystem in `backend/api/api.go`.
- Location: `backend/scheduler/scheduler.go`.
- Triggers: Cron expressions loaded from `backend/config/config.go` and started in `cmd/server/main.go`.
- Responsibilities: Invoke balance/rate/retention jobs with bounded contexts in `backend/scheduler/scheduler.go`.
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

### Handler-Owned Business Workflows

### Cross-Package Model Duplication

### Bypassing the Frontend API Layer

## Error Handling

- Wrap or log startup errors and exit before serving when config, cipher, database, migration, auth, or scheduler setup fails in `cmd/server/main.go`.
- Return `{"error": ...}` with an explicit HTTP status through `fail` in `backend/api/api.go`; use `ShouldBindJSON` and typed path/query parsers in `backend/api/`.
- Return ordinary Go errors from application/repository methods and let callers add operation context or choose HTTP/log/notification behavior in `backend/channel/service.go`, `backend/monitor/service.go`, and `backend/syncer/service.go`.
- Continue scanning other channels after a per-channel error and persist/log outcomes in `backend/monitor/service.go` and `backend/storage/monitor_logs.go`.
- Continue independent retention tables after failures and log each outcome in `backend/scheduler/scheduler.go`.
- Convert non-2xx bodies into `ApiError` objects and invoke a global unauthorized callback on 401 in `frontend/lib/api.ts`; feature components render or toast the resulting messages.
- Emit a terminal failure event for streaming workflows through `backend/progress/progress.go` and parse it in `frontend/lib/sync-stream.ts`.

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
