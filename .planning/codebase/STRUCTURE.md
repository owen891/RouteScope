# Codebase Structure

**Analysis Date:** 2026-07-18

## Directory Layout

```text
upstream-ops/
|-- .github/
|   `-- workflows/                  # CI quality and image publication
|-- .planning/
|   `-- codebase/                   # Generated GSD codebase reference
|-- backend/
|   |-- api/                        # Gin routes and HTTP/SSE handlers
|   |-- auth/                       # Single-admin HMAC token service
|   |-- captcha/                    # Captcha port, adapters, balance refresh
|   |-- channel/                    # Channel/session application service
|   |-- config/                     # File/env config and proxy helpers
|   |-- connector/
|   |   |-- newapi/                 # NewAPI upstream adapter
|   |   `-- sub2api/                # Sub2API user/admin adapters
|   |-- crypto/                     # AES-GCM encryption helper
|   |-- global/                     # Build/version state
|   |-- logger/                     # slog construction
|   |-- monitor/                    # Balance/rate/announcement collection
|   |-- notify/                     # Notification port, adapters, dispatcher
|   |-- progress/                   # Context-carried progress events
|   |-- runtimeconfig/              # Hot-reload manager
|   |-- scheduler/                  # Cron jobs and retention
|   |-- storage/                    # GORM models, migrations, repositories
|   `-- syncer/                     # Source-to-Sub2API reconciliation
|-- cmd/
|   `-- server/                     # Go process entry point
|-- data/                           # Local runtime database/config/backups
|-- docs/                           # Fork notes and screenshots
|-- frontend/
|   |-- app/                        # Route-level page composition and CSS
|   |-- components/
|   |   |-- auth/                   # Login/auth gate
|   |   |-- monitor/                # Dashboard/channel operational features
|   |   |-- settings/               # Upstream-sync settings feature
|   |   `-- ui/                     # shadcn/Radix primitives
|   |-- hooks/                      # Generic UI hooks
|   |-- lib/                        # API, state, DTOs, parsers, formatting
|   `-- src/                        # Browser bootstrap
|-- scripts/                        # Build, verify, backup, auth, smoke checks
|-- web/
|   `-- dist/                       # Vite output embedded by Go
|-- Dockerfile                      # Three-stage frontend/backend image build
|-- go.mod                          # Go module and backend dependencies
`-- README.md                       # Product, development, API, deployment docs
```

## Directory Purposes

**`.github/workflows/`:**
- Purpose: Run repository checks and publish container images from `.github/workflows/quality.yml` and `.github/workflows/publish.yml`.
- Contains: YAML workflow definitions in `.github/workflows/`.
- Key files: `.github/workflows/quality.yml`, `.github/workflows/publish.yml`.

**`.planning/codebase/`:**
- Purpose: Store generated architecture, stack, convention, test, integration, and concern maps under `.planning/codebase/`.
- Contains: GSD reference Markdown such as `.planning/codebase/ARCHITECTURE.md` and `.planning/codebase/STRUCTURE.md`.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

**`cmd/server/`:**
- Purpose: Own executable composition and lifecycle in `cmd/server/main.go`.
- Contains: One `package main` entry point in `cmd/server/main.go`.
- Key files: `cmd/server/main.go`.

**`backend/api/`:**
- Purpose: Expose transport-level REST, health, SSE, authentication, settings, and SPA behavior from `backend/api/`.
- Contains: Shared router/dependency wiring in `backend/api/api.go` plus resource registrars such as `backend/api/channels.go`, `backend/api/settings.go`, and `backend/api/upstream_sync.go`.
- Key files: `backend/api/api.go`, `backend/api/channels.go`, `backend/api/dashboard.go`, `backend/api/settings.go`, `backend/api/upstream_sync.go`.

**`backend/channel/`:**
- Purpose: Own channel mutations, credential encryption, login/session reuse/refresh, and connector-backed account operations in `backend/channel/service.go`.
- Contains: The application service and focused tests in `backend/channel/service.go` and `backend/channel/service_test.go`.
- Key files: `backend/channel/service.go`.

**`backend/monitor/`:**
- Purpose: Coordinate balance, cost, rate, announcement, subscription, history, and alert collection in `backend/monitor/service.go`.
- Contains: The monitoring service and behavior tests in `backend/monitor/service.go` and `backend/monitor/service_test.go`.
- Key files: `backend/monitor/service.go`.

**`backend/syncer/`:**
- Purpose: Own target/group/account reconciliation and remote managed-object lifecycle in `backend/syncer/service.go`.
- Contains: DTOs, validation, worker orchestration, diffing, remote apply/delete logic, logging, notifications, and extensive tests in `backend/syncer/service.go` and `backend/syncer/service_test.go`.
- Key files: `backend/syncer/service.go`.

**`backend/storage/`:**
- Purpose: Centralize GORM schema and database queries in `backend/storage/`.
- Contains: Models in `backend/storage/model.go`, database/migrations in `backend/storage/storage.go`, and aggregate repositories in the remaining `backend/storage/*.go` files.
- Key files: `backend/storage/model.go`, `backend/storage/storage.go`, `backend/storage/channels.go`, `backend/storage/rates.go`, `backend/storage/upstream_sync.go`.

**`backend/connector/`:**
- Purpose: Define the upstream connector contract and isolate NewAPI/Sub2API HTTP details in `backend/connector/`.
- Contains: Shared DTOs/registry in `backend/connector/connector.go`, HTTP error normalization in `backend/connector/http_error.go`, and implementations under `backend/connector/newapi/` and `backend/connector/sub2api/`.
- Key files: `backend/connector/connector.go`, `backend/connector/newapi/newapi.go`, `backend/connector/sub2api/sub2api.go`, `backend/connector/sub2api/admin.go`.

**`backend/notify/`:**
- Purpose: Define notification adapters and coordinate subscription filtering, proxying, retries, cooldowns, and logging in `backend/notify/`.
- Contains: Registry/contract in `backend/notify/notifier.go`, orchestration in `backend/notify/dispatcher.go` and `backend/notify/policy.go`, and one adapter file per provider such as `backend/notify/telegram.go` and `backend/notify/qqbot.go`.
- Key files: `backend/notify/notifier.go`, `backend/notify/dispatcher.go`, `backend/notify/policy.go`, `backend/notify/subscription.go`.

**`backend/captcha/`:**
- Purpose: Define captcha-provider behavior and refresh provider balances in `backend/captcha/`.
- Contains: Registry/contract in `backend/captcha/provider.go`, shared refresh logic in `backend/captcha/balance.go`, and one implementation per provider in `backend/captcha/*.go`.
- Key files: `backend/captcha/provider.go`, `backend/captcha/balance.go`, `backend/captcha/capsolver.go`.

**`backend/config/`:**
- Purpose: Own configuration shape, defaults, file/env loading, persistence, and proxy URL derivation in `backend/config/`.
- Contains: Main configuration in `backend/config/config.go` and proxy helper behavior in `backend/config/proxy.go`.
- Key files: `backend/config/config.go`, `backend/config/proxy.go`.

**`backend/runtimeconfig/`:**
- Purpose: Apply supported configuration sections without restarting the process in `backend/runtimeconfig/runtime.go`.
- Contains: A mutex-guarded manager and scheduler factory in `backend/runtimeconfig/runtime.go` plus tests in `backend/runtimeconfig/runtime_test.go`.
- Key files: `backend/runtimeconfig/runtime.go`.

**`backend/scheduler/`:**
- Purpose: Register cron callbacks for monitoring, captcha refresh, upstream sync, and retention in `backend/scheduler/scheduler.go`.
- Contains: The cron wrapper and tests in `backend/scheduler/scheduler.go` and `backend/scheduler/scheduler_test.go`.
- Key files: `backend/scheduler/scheduler.go`.

**`backend/auth/`, `backend/crypto/`, `backend/logger/`, `backend/progress/`, `backend/global/`:**
- Purpose: Provide narrow cross-cutting facilities for tokens, encryption, structured logging, progress observation, and version state across `backend/`.
- Contains: One focused implementation per directory: `backend/auth/auth.go`, `backend/crypto/cipher.go`, `backend/logger/logger.go`, `backend/progress/progress.go`, and `backend/global/version.go`.
- Key files: `backend/auth/auth.go`, `backend/crypto/cipher.go`, `backend/progress/progress.go`.

**`frontend/src/`:**
- Purpose: Mount the React application and declare browser routes in `frontend/src/main.tsx`.
- Contains: The single browser bootstrap `frontend/src/main.tsx`.
- Key files: `frontend/src/main.tsx`.

**`frontend/app/`:**
- Purpose: Define route-level page composition and global styling in `frontend/app/`.
- Contains: Dashboard, captcha, notification, and settings pages plus Tailwind/CSS theme tokens in `frontend/app/globals.css`.
- Key files: `frontend/app/page.tsx`, `frontend/app/captcha-page.tsx`, `frontend/app/notifications-page.tsx`, `frontend/app/settings-page.tsx`, `frontend/app/globals.css`.

**`frontend/components/monitor/`:**
- Purpose: Own operational dashboard and channel workflows in `frontend/components/monitor/`.
- Contains: Dashboard panels, channel cards/forms/import, API key, recharge/redeem/subscription dialogs, header, and optional dock components.
- Key files: `frontend/components/monitor/channel-cards.tsx`, `frontend/components/monitor/channel-import-dialog.tsx`, `frontend/components/monitor/bottom-panels.tsx`, `frontend/components/monitor/monitor-header.tsx`.

**`frontend/components/settings/`:**
- Purpose: Own complex settings subfeatures that are too large for route composition in `frontend/app/settings-page.tsx`.
- Contains: Sub2API target and synchronization management in `frontend/components/settings/upstream-sync-settings.tsx`.
- Key files: `frontend/components/settings/upstream-sync-settings.tsx`.

**`frontend/components/auth/`:**
- Purpose: Gate application rendering and present login UI in `frontend/components/auth/`.
- Contains: `frontend/components/auth/auth-gate.tsx` and `frontend/components/auth/login-page.tsx`.
- Key files: `frontend/components/auth/auth-gate.tsx`, `frontend/components/auth/login-page.tsx`.

**`frontend/components/ui/`:**
- Purpose: Provide local shadcn/Radix primitives for feature composition in `frontend/components/ui/`.
- Contains: Buttons, dialogs, inputs, tables, navigation, overlays, forms, charts, and feedback primitives configured by `frontend/components.json`.
- Key files: `frontend/components/ui/button.tsx`, `frontend/components/ui/dialog.tsx`, `frontend/components/ui/form.tsx`, `frontend/components/ui/table.tsx`.

**`frontend/lib/`:**
- Purpose: Hold non-visual browser infrastructure, shared state, DTOs, pure transformation logic, and format/error helpers in `frontend/lib/`.
- Contains: HTTP/auth in `frontend/lib/api.ts`, DTOs in `frontend/lib/api-types.ts`, read hooks in `frontend/lib/queries.ts`, SSE in `frontend/lib/sync-stream.ts`, contexts, import conversion, and helpers.
- Key files: `frontend/lib/api.ts`, `frontend/lib/api-types.ts`, `frontend/lib/queries.ts`, `frontend/lib/sync-stream.ts`, `frontend/lib/auth-context.tsx`, `frontend/lib/all-api-hub-import.ts`.

**`frontend/hooks/`:**
- Purpose: Hold generic reusable UI hooks that do not own domain API behavior in `frontend/hooks/`.
- Contains: Mobile breakpoint and toast hooks in `frontend/hooks/use-mobile.ts` and `frontend/hooks/use-toast.ts`.
- Key files: `frontend/hooks/use-mobile.ts`, `frontend/hooks/use-toast.ts`.

**`web/`:**
- Purpose: Bridge Vite production output into the Go binary in `web/web.go`.
- Contains: Embed helper `web/web.go` and build output/placeholder under `web/dist/`.
- Key files: `web/web.go`, `web/dist/.gitkeep`.

**`scripts/`:**
- Purpose: Provide operator/developer entry points for verification, builds, backup/restore, auth configuration output, and production smoke checks in `scripts/`.
- Contains: Paired shell/PowerShell scripts where platform parity is needed, plus the shell backup script in `scripts/backup-data.sh`.
- Key files: `scripts/verify.sh`, `scripts/verify.ps1`, `scripts/build-local.sh`, `scripts/build-local.ps1`, `scripts/check-production.sh`, `scripts/check-production.ps1`.

**`docs/`:**
- Purpose: Document the local operations fork and provide README screenshots under `docs/`.
- Contains: `docs/FORK_NOTES.md` and image assets in `docs/images/`.
- Key files: `docs/FORK_NOTES.md`, `docs/images/demo1.png`.

**`data/`:**
- Purpose: Hold local runtime state mounted by deployment tooling; expected contents include database/config/backups described by `README.md` and `scripts/backup-data.sh`.
- Contains: Runtime-generated local data under `data/`; source code must not depend on checked-in data files.
- Key files: Runtime database/config paths are resolved by `backend/config/config.go` and `backend/storage/storage.go`.

## Key File Locations

**Entry Points:**
- `cmd/server/main.go`: Backend process composition, HTTP server, scheduler, and shutdown.
- `frontend/src/main.tsx`: Browser provider tree and route table.
- `frontend/index.html`: Vite HTML entry that loads `frontend/src/main.tsx`.
- `Dockerfile`: Production build and runtime image entrypoint.
- `.air.toml`: Backend live-reload entrypoint for local Go development.

**Configuration:**
- `backend/config/config.go`: Runtime configuration schema, defaults, environment binding, load, and save.
- `backend/config/proxy.go`: Proxy URL validation and construction.
- `frontend/vite.config.ts`: Vite plugins, `@` alias, development port, and backend proxy.
- `frontend/tsconfig.json`: TypeScript strict mode, compilation scope, and `@/*` path mapping.
- `frontend/components.json`: shadcn component-generation aliases and UI style.
- `go.mod`: Go module path, language version, and backend dependencies.
- `frontend/package.json`: Frontend scripts and dependencies.

**Core Logic:**
- `backend/channel/service.go`: Upstream channel, credentials, sessions, and account operations.
- `backend/monitor/service.go`: Monitoring and alert orchestration.
- `backend/syncer/service.go`: Upstream target synchronization and managed-object lifecycle.
- `backend/notify/dispatcher.go`: Notification policy and delivery orchestration.
- `backend/storage/model.go`: Persisted domain model definitions.
- `frontend/lib/queries.ts`: Shared browser read behavior.
- `frontend/components/monitor/channel-cards.tsx`: Main channel operations surface.
- `frontend/app/settings-page.tsx`: System settings route and configuration workflow.

**Testing:**
- `backend/**/*_test.go`: Co-located Go package tests, especially `backend/storage/storage_test.go`, `backend/monitor/service_test.go`, and `backend/syncer/service_test.go`.
- `frontend/lib/import-and-error.test.ts`: Frontend Vitest coverage for import/error helpers, including current working-tree import conflict cases.
- `frontend/vitest.config.ts`: Vitest test configuration.
- `scripts/verify.sh`, `scripts/verify.ps1`: Repository-level verification entry points.
- `.github/workflows/quality.yml`: CI quality gate in the current working tree.

**Documentation and Operations:**
- `README.md`, `README.zh.md`: Product behavior, APIs, development, and deployment.
- `docs/FORK_NOTES.md`: Local operations-fork behavior and scripts.
- `scripts/backup-data.sh`: Runtime data backup/list/restore flow.
- `scripts/check-production.sh`, `scripts/check-production.ps1`: Health and anonymous-auth production checks.

## Naming Conventions

**Files:**
- Use lowercase Go package/file names, with underscores for multiword roles: `backend/api/upstream_sync.go`, `backend/storage/auth_sessions.go`.
- Use `_test.go` beside the Go code under test: `backend/channel/service_test.go`, `backend/connector/sub2api/admin_test.go`.
- Use kebab-case for frontend TS/TSX files: `frontend/components/monitor/channel-import-dialog.tsx`, `frontend/lib/refresh-context.tsx`.
- Use `*-page.tsx` for named frontend route pages except the index route at `frontend/app/page.tsx`: `frontend/app/settings-page.tsx`, `frontend/app/captcha-page.tsx`.
- Use `use-*.ts` for generic React hooks: `frontend/hooks/use-mobile.ts`, `frontend/hooks/use-toast.ts`.
- Use provider-specific Go filenames for registry adapters: `backend/notify/telegram.go`, `backend/captcha/anticaptcha.go`.
- Use paired `.sh` and `.ps1` names for cross-platform operational commands: `scripts/verify.sh`, `scripts/verify.ps1`.

**Directories:**
- Match Go directory and package names as singular lowercase domains: `backend/channel/`, `backend/monitor/`, `backend/scheduler/`.
- Put concrete connector implementations beneath the connector port: `backend/connector/newapi/`, `backend/connector/sub2api/`.
- Group frontend files by architectural role first (`frontend/app/`, `frontend/components/`, `frontend/lib/`) and feature second (`frontend/components/monitor/`, `frontend/components/settings/`).
- Keep generated/build/runtime content in dedicated roots: `web/dist/`, `frontend/dist/`, and `data/`.

## Where to Add New Code

**New Backend API Feature:**
- Primary code: Add a resource registrar/handlers under `backend/api/<resource>.go`, call it from `backend/api/api.go`, and add any new dependency to `api.Deps` only when the handler needs it.
- Application code: Put reusable multi-step work in an owning package under `backend/<domain>/`; follow constructors in `backend/channel/service.go` or `backend/monitor/service.go`.
- Persistence: Add durable types to `backend/storage/model.go`, migration registration to `backend/storage/storage.go`, and queries to `backend/storage/<aggregate>.go`.
- Tests: Co-locate handler tests under `backend/api/<resource>_test.go` and service/repository tests beside their packages under `backend/<domain>/*_test.go`.

**New Upstream Connector:**
- Contract changes: Extend shared DTOs/capabilities only when both implementations need them in `backend/connector/connector.go`.
- Implementation: Create `backend/connector/<type>/` with an `init` registration following `backend/connector/newapi/newapi.go`.
- Composition: Add the implementation blank import to `cmd/server/main.go` so the registry is populated.
- Tests: Add adapter HTTP-contract tests in `backend/connector/<type>/*_test.go` following `backend/connector/newapi/newapi_test.go`.

**New Notification Provider:**
- Contract/dispatch code: Reuse `backend/notify/notifier.go` and `backend/notify/dispatcher.go`; change them only for a true shared capability.
- Implementation: Add `backend/notify/<provider>.go` with package-level registration following `backend/notify/telegram.go` or `backend/notify/qqbot.go`.
- Persistence/type support: Add the type constant to `backend/storage/model.go` and expose its form fields through `frontend/components/monitor/notification-form-dialog.tsx`.
- Tests: Add `backend/notify/<provider>_test.go` for provider behavior and dispatcher tests where policy behavior changes.

**New Captcha Provider:**
- Implementation: Add `backend/captcha/<provider>.go` and register it through `backend/captcha/provider.go`.
- Persistence/type support: Add the persisted provider type to `backend/storage/model.go` and frontend form support to `frontend/components/monitor/captcha-form-dialog.tsx`.
- Tests: Add focused tests beside `backend/captcha/balance_test.go` or in a new `backend/captcha/<provider>_test.go`.

**New Frontend Route:**
- Primary code: Add route composition under `frontend/app/<name>-page.tsx` and declare the path under the `AppShell` route in `frontend/src/main.tsx`.
- Feature components: Put operational components in `frontend/components/monitor/`, settings components in `frontend/components/settings/`, or auth components in `frontend/components/auth/`.
- Data contract: Add DTOs in `frontend/lib/api-types.ts`, read hooks in `frontend/lib/queries.ts`, and mutations through `frontend/lib/api.ts`.
- UI primitives: Reuse or add shadcn/Radix wrappers only in `frontend/components/ui/`, consistent with `frontend/components.json`.

**New Frontend Workflow Without a Route:**
- Primary code: Add the feature dialog/panel to the closest domain directory such as `frontend/components/monitor/`.
- Pure transformations: Put parsers/mappers in `frontend/lib/`, following `frontend/lib/all-api-hub-import.ts`.
- Shared state: Add a context under `frontend/lib/` only for state shared across distant routes/components, following `frontend/lib/auth-context.tsx` and `frontend/lib/refresh-context.tsx`.
- Tests: Put pure browser-logic tests beside related `frontend/lib/*.ts` files, following `frontend/lib/import-and-error.test.ts`.

**New Scheduled Job:**
- Primary code: Keep domain behavior in its owning service under `backend/`; register only timing/context/error coordination in `backend/scheduler/scheduler.go`.
- Configuration: Add schedule/retention fields and defaults in `backend/config/config.go`, then expose editable fields through `backend/api/settings.go` and `frontend/app/settings-page.tsx` when user-configurable.
- Tests: Add scheduling behavior to `backend/scheduler/scheduler_test.go` and domain behavior to the owning package tests.

**New Operational Script:**
- Shared scripts: Add commands under `scripts/`; provide matching `.sh` and `.ps1` variants when the workflow supports both environments, following `scripts/verify.*` and `scripts/check-production.*`.
- CI wiring: Call stable repository checks from `.github/workflows/quality.yml`; keep image publication in `.github/workflows/publish.yml`.
- Documentation: Document operator-visible commands in `docs/FORK_NOTES.md` or `README.md`.

**Utilities:**
- Backend shared helpers: Add a small, cohesive package under `backend/<utility>/` only when multiple domain packages consume it; current examples are `backend/crypto/`, `backend/logger/`, and `backend/progress/`.
- Frontend shared helpers: Add non-visual utilities to `frontend/lib/` and generic hooks to `frontend/hooks/`; keep domain-specific rendering in `frontend/components/`.

## Special Directories

**`web/dist/`:**
- Purpose: Hold the exact frontend assets embedded by `web/web.go` during the Go build.
- Generated: Yes, except the tracked placeholder `web/dist/.gitkeep`.
- Committed: The placeholder is committed; production assets are produced by `Dockerfile` or `scripts/build-local.*`.

**`frontend/dist/`:**
- Purpose: Receive local Vite build output configured by `frontend/vite.config.ts` before build tooling copies it to `web/dist/`.
- Generated: Yes.
- Committed: No; it is excluded by `frontend/.gitignore`.

**`data/`:**
- Purpose: Hold local database/config/backup runtime state referenced by `backend/config/config.go`, `backend/storage/storage.go`, and `scripts/backup-data.sh`.
- Generated: Yes.
- Committed: No runtime contents should be committed; operational guidance lives in `README.md` and `docs/FORK_NOTES.md`.

**`frontend/components/ui/`:**
- Purpose: Store generated/adapted shadcn UI primitives configured through `frontend/components.json`.
- Generated: Partially; files are source-controlled local components that may originate from the shadcn generator.
- Committed: Yes, under `frontend/components/ui/`.

**`.planning/codebase/`:**
- Purpose: Store generated GSD codebase maps consumed by planning/execution workflows.
- Generated: Yes.
- Committed: Managed by the parent GSD workflow; mapper agents only write their owned files under `.planning/codebase/`.

**`docs/images/`:**
- Purpose: Store product screenshots referenced by project documentation in `README.md` and `README.zh.md`.
- Generated: No; they are documentation assets.
- Committed: Yes, under `docs/images/`.

---

*Structure analysis: 2026-07-18*
