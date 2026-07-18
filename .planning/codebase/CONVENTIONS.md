# Coding Conventions

**Analysis Date:** 2026-07-18

## Naming Patterns

**Files:**
- Use lowercase Go package directories and short domain-oriented filenames: `backend/auth/auth.go`, `backend/channel/service.go`, and `backend/storage/notifications.go`.
- Use `_test.go` for package-local Go tests: `backend/auth/auth_test.go` and `backend/storage/storage_test.go`. Tests use the same package name as the implementation, which permits testing unexported helpers.
- Use kebab-case for TypeScript modules and React component files: `frontend/lib/all-api-hub-import.ts`, `frontend/components/monitor/channel-form-dialog.tsx`, and `frontend/app/settings-page.tsx`.
- Keep reusable primitives under `frontend/components/ui/` and domain components under a named feature directory such as `frontend/components/monitor/` or `frontend/components/settings/`.

**Functions:**
- Use PascalCase for exported Go functions and constructors (`Register`, `Open`, `AutoMigrate`, `NewService`) and camelCase for package-private helpers (`registerChannels`, `parsePageQuery`, `openTestDB`) as shown in `backend/api/api.go`, `backend/storage/storage.go`, and `backend/api/dashboard_test.go`.
- Use receiver methods for behavior owned by a service or repository (`Service.Create`, `Channels.FindByID`), and accept `context.Context` as the first argument for operations that perform network or long-running work; see `backend/channel/service.go` and `backend/connector/connector.go`.
- Name React components in PascalCase (`AuthProvider`, `ChannelCards`, `Button`) and hooks with the `use` prefix (`useAuth`, `useChannels`, `useRefreshTick`) in `frontend/lib/auth-context.tsx`, `frontend/components/monitor/channel-cards.tsx`, and `frontend/lib/queries.ts`.
- Name local TypeScript helpers in camelCase and make them narrow (`cacheKey`, `fetchShared`, `statusOf`) rather than introducing utility classes; see `frontend/lib/queries.ts` and `frontend/components/monitor/channel-cards.tsx`.

**Variables:**
- Use short conventional Go locals (`cfg`, `db`, `err`, `ctx`, `svc`) within small scopes and descriptive field names on structs; `cmd/server/main.go` is the composition-root example.
- Use camelCase for TypeScript state and locals (`authDisabled`, `refreshTick`, `hasDataRef`) and uppercase snake case for module constants (`TOKEN_KEY`, `CACHE_TTL_MS`, `BACKEND_TARGET`) in `frontend/lib/api.ts`, `frontend/lib/queries.ts`, and `frontend/vite.config.ts`.
- Preserve snake_case only at API and persisted-data boundaries (`expires_at`, `site_url`, `last_error`); map frontend control variables and component props to camelCase. Wire types live in `frontend/lib/api-types.ts`, while Go JSON/GORM tags live in `backend/storage/model.go`.

**Types:**
- Use PascalCase for exported Go structs, enums, and interfaces (`DBConfig`, `ChannelType`, `Provider`) and lowercase names for consumer-owned internal interfaces (`monitorService`, `channelService`) in `backend/storage/storage.go`, `backend/captcha/provider.go`, and `backend/api/api.go`.
- Prefer typed string constants for domain enums (`DBDriver`, `ChannelType`, `CredentialMode`) instead of raw strings in business logic; see `backend/storage/storage.go` and `backend/storage/model.go`.
- Use PascalCase for TypeScript interfaces and union aliases (`ApiError`, `AuthContextValue`, `Status`, `ChannelPageSize`), with discriminated string unions for bounded UI states in `frontend/lib/api.ts`, `frontend/lib/auth-context.tsx`, and `frontend/components/monitor/channel-cards.tsx`.

## Code Style

**Formatting:**
- Format Go with `gofmt`: tabs, grouped imports, and standard composite-literal alignment are the repository pattern across `backend/`, `cmd/`, and `web/`. No separate Go formatter configuration exists.
- TypeScript uses two-space indentation, omitted semicolons, trailing commas in multiline constructs, and multiline JSX props. No Prettier or Biome configuration is present.
- Quote style is not enforced. Hand-authored feature modules commonly use double quotes (`frontend/lib/api.ts`, `frontend/lib/queries.ts`), while Vite/bootstrap and UI primitive files commonly use single quotes (`frontend/src/main.tsx`, `frontend/components/ui/button.tsx`). Match the containing file and avoid quote-only churn.
- Keep Tailwind classes inline in JSX for component styling and merge conditional classes with `cn` from `frontend/lib/utils.ts`; variant-heavy primitives use `class-variance-authority`, as in `frontend/components/ui/button.tsx`.

**Linting:**
- Run `pnpm lint` from `frontend/`. `frontend/eslint.config.js` applies `typescript-eslint` recommended rules to the frontend and ignores `.vite`, `dist`, and `node_modules`.
- Explicit `any` is permitted because `@typescript-eslint/no-explicit-any` is disabled in `frontend/eslint.config.js`; prefer `unknown` and boundary narrowing when practical, following `frontend/lib/api.ts`.
- TypeScript compiler options are strict and no-emit in `frontend/tsconfig.json`, but the repository quality workflow does not run `tsc --noEmit`. Run `pnpm exec tsc --noEmit --incremental false` when changing shared types or complex component props.
- The backend has no repository-specific `golangci-lint`, `staticcheck`, or `go vet` configuration. Use compiler diagnostics, `go test ./...`, `gofmt`, and optionally `go vet ./...`.

## Import Organization

**Order:**
1. In Go, list standard-library imports first, a blank line, then project and third-party imports; let `gofmt` sort each group. Blank imports are reserved for registration side effects, as in `cmd/server/main.go`.
2. In TypeScript, list framework and third-party packages before internal modules. Group long imports vertically, especially icons, UI primitives, and types; see `frontend/components/monitor/channel-cards.tsx`.
3. Prefer `@/` imports across frontend directories and relative `./` imports within the same small library area. Use `import type` for type-only dependencies, as in `frontend/lib/queries.ts` and `frontend/components/monitor/channel-cards.tsx`.

**Path Aliases:**
- `@/*` maps to the `frontend/` root through `frontend/tsconfig.json`, `frontend/vite.config.ts`, and `frontend/vitest.config.ts`.
- Go imports use the full module prefix `github.com/bejix/upstream-ops/...` declared in `go.mod`.

## Error Handling

**Patterns:**
- Return errors as the final Go return value and stop at the point of failure. Add operation context with `fmt.Errorf("operation: %w", err)` so callers can unwrap causes; `backend/storage/storage.go` and `backend/connector/sub2api/sub2api.go` are representative.
- Use `errors.New` for invariant and validation failures that do not wrap an underlying cause. User-facing domain validation may be localized, while lower-level connector errors include the provider and operation name; see `backend/channel/service.go` and `backend/captcha/yescaptcha.go`.
- Translate handler failures to JSON through `fail(c, status, err)` in `backend/api/api.go`, choosing status codes at the handler boundary after `ShouldBindJSON` and explicit input validation in files such as `backend/api/channels.go`.
- In the frontend, make `apiFetch` the HTTP error boundary: it throws an `ApiError` with `status` and parsed `body`, unwraps `{ data }`, and triggers the global unauthorized handler on 401 in `frontend/lib/api.ts`.
- Hooks convert caught errors to user-displayable state, while commands generally show `sonner` toasts. Preserve cancellation guards in effects to avoid state updates after unmount; see `frontend/lib/queries.ts` and `frontend/lib/auth-context.tsx`.

## Logging

**Framework:** Go standard-library `log/slog` through `backend/logger/logger.go`; frontend user feedback uses `sonner` and has no general logging framework.

**Patterns:**
- Inject `*slog.Logger` into long-lived backend services and emit structured key/value context (`"err", err`, `"path", path`) rather than interpolated log strings; `cmd/server/main.go` is the composition example.
- Log startup, shutdown, configuration milestones, and recoverable background failures. Return request-path errors to handlers rather than logging the same error at every layer.
- Use discarded `slog` handlers in tests that do not assert logs, following `backend/monitor/service_test.go`, `backend/scheduler/scheduler_test.go`, and `backend/syncer/service_test.go`.
- Use toasts for actionable frontend outcomes and keep `console.*` out of ordinary feature code unless diagnosing a development-only path.

## Comments

**When to Comment:**
- Add package and exported-type comments where domain rules, security constraints, or side effects are not obvious. `backend/api/api.go`, `backend/storage/model.go`, and `frontend/lib/api.ts` explain routing, credential storage, and API-client contracts.
- Comment non-obvious lifecycle and concurrency decisions, such as effect cancellation, request deduplication, SPA fallback protection, and credential-mode semantics. Do not narrate straightforward assignments.
- Keep operational comments close to the constraint they protect; examples include the `StrictMode` request deduplication rationale in `frontend/lib/queries.ts` and connector registration comments in `cmd/server/main.go`.

**JSDoc/TSDoc:**
- Use short `/** ... */` blocks for exported frontend helpers and context fields whose behavior is not evident from the type. Most component props and simple helpers remain self-documenting; see `frontend/lib/api.ts` and `frontend/lib/queries.ts`.
- Go documentation follows standard `// Name ...` comments for packages and exported declarations when the contract needs explanation; not every exported repository/model method is documented.

## Function Design

**Size:** Keep helpers focused, but service and feature modules can be large when they coordinate a cohesive workflow. Extract validation, conversion, and transport helpers before duplicating logic; `backend/api/channels.go`, `backend/channel/service.go`, and `frontend/lib/queries.ts` show this split.

**Parameters:**
- Group backend dependencies into constructors and the `api.Deps` composition struct rather than using global service singletons; see `backend/api/api.go` and `cmd/server/main.go`.
- Use input structs for multi-field domain operations (`channel.CreateInput`, `connector.RechargeRequest`) and typed props objects for React components. Keep context first for I/O-capable Go methods.
- Define narrow interfaces in the consuming Go package to support test stubs, as `channelService` in `backend/api/api.go` does.

**Return Values:**
- Return `(value, error)` or `error` from Go domain and storage operations; use pointers when absence or mutation matters and slices for collections.
- Return typed promises from frontend network helpers and explicit state objects from hooks (`QueryState<T>` in `frontend/lib/queries.ts`). Use `null` for absent UI state and reserve `undefined` for optional wire fields.

## Module Design

**Exports:**
- Keep Go implementation details package-private and export constructors, domain types, and service operations needed across packages. Provider implementations register through `init` and blank imports in `cmd/server/main.go`.
- Prefer named TypeScript exports for libraries, hooks, contexts, and UI primitives. Page modules use default component exports to match the route imports in `frontend/src/main.tsx`.
- Keep API wire schemas centralized in `frontend/lib/api-types.ts`, transport behavior in `frontend/lib/api.ts`, reusable data hooks in `frontend/lib/queries.ts`, and presentation in `frontend/components/` or `frontend/app/`.

**Barrel Files:**
- Barrel exports are not used. Import directly from the owning file, such as `@/components/ui/button` or `@/lib/api`.
- Add backend code to the narrowest domain package under `backend/`; add frontend domain components under `frontend/components/<feature>/`, primitives under `frontend/components/ui/`, and pure shared logic under `frontend/lib/`.

---

*Convention analysis: 2026-07-18*
