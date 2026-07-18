# Technology Stack

**Analysis Date:** 2026-07-18

## Languages

**Primary:**
- Go 1.23 - Backend HTTP server, upstream connectors, scheduling, notifications, persistence, and the production entry point in `cmd/server/main.go`; the module version is declared in `go.mod`.
- TypeScript 5.7.3 - Browser application, API client, state providers, and UI components under `frontend/`; strict checking and no emitted compiler output are configured in `frontend/tsconfig.json`.

**Secondary:**
- CSS - Tailwind CSS 4 imports, CSS custom properties, themes, and application-specific styles in `frontend/app/globals.css`.
- Shell and PowerShell - Cross-platform build, verification, backup, authentication, and production checks in `scripts/*.sh` and `scripts/*.ps1`.
- YAML - Runtime configuration serialization in `backend/config/config.go`, Docker Compose deployment in `docker-compose.yml` and `docker-compose.mysql.yml`, and GitHub Actions in `.github/workflows/`.
- HTML - Vite browser entry document in `frontend/index.html`.

## Runtime

**Environment:**
- Go 1.23; production compiles a statically linked Linux binary with `CGO_ENABLED=0` from `./cmd/server` in `Dockerfile`.
- Node.js 20 Alpine is the frontend build environment in `Dockerfile`; Node.js 20 is also pinned in `.github/workflows/quality.yml`.
- Alpine Linux 3.20 is the production container base in `Dockerfile`, with CA certificates, timezone data, and `wget` for health checks.
- Browser target is ES2020 with DOM and ESNext libraries configured in `frontend/tsconfig.json`.

**Package Manager:**
- Go modules - Backend dependency management through `go.mod` and `go.sum`.
- pnpm 10.4.0 - Authoritative frontend package manager, pinned in `frontend/package.json`, `Dockerfile`, and `.github/workflows/quality.yml`.
- Lockfile: `go.sum` and `frontend/pnpm-lock.yaml` are present; `frontend/package-lock.json` is also present, but Docker and CI use pnpm.
- Workspace/build approvals: `frontend/pnpm-workspace.yaml` defines the root package and permits the `esbuild` install script.

## Frameworks

**Core:**
- Gin 1.10.0 - HTTP routing, middleware, JSON endpoints, health checks, and SPA fallback in `backend/api/api.go` and `cmd/server/main.go`.
- React 19 - Client UI rendered from `frontend/src/main.tsx`.
- React DOM 19 - Browser root renderer in `frontend/src/main.tsx`.
- React Router DOM 7.16 - Client-side routes for dashboard, captcha, notifications, and settings in `frontend/src/main.tsx`.
- GORM 1.30.0 - Database access, migrations, models, and repositories under `backend/storage/`.
- Vite 6 - Frontend development server and production bundler configured in `frontend/vite.config.ts`.
- Tailwind CSS 4 - Utility CSS integrated through `@tailwindcss/vite` in `frontend/vite.config.ts` and imported from `frontend/app/globals.css`.
- Radix UI primitives plus shadcn-style local wrappers - Accessible UI foundation in `frontend/components/ui/`, configured by `frontend/components.json`.

**Testing:**
- Go standard `testing` package - Backend unit and integration-style tests in `backend/**/*_test.go`.
- Vitest 3.2.4 - Node-environment frontend tests matching `frontend/lib/**/*.test.ts`, configured in `frontend/vitest.config.ts`.
- `httptest` - In-process HTTP doubles for connectors, auth, API routes, notifications, monitoring, and sync behavior throughout backend test files such as `backend/monitor/service_test.go`.

**Build/Dev:**
- TypeScript compiler 5.7.3 - Strict static checking as part of the Vite build via `frontend/tsconfig.json`.
- ESLint 9.39.5 with typescript-eslint 8.63 - Frontend lint gate configured in `frontend/eslint.config.js`.
- Air - Go hot reload using `.air.toml`; watches `backend/`, `cmd/`, `web/`, module files, and runtime YAML.
- Docker Buildx - Three-stage frontend/backend/runtime image in `Dockerfile`, published as amd64 and arm64 by `.github/workflows/publish.yml`.
- GitHub Actions - Backend tests, frontend install/lint/test/build, Compose validation, and image publishing in `.github/workflows/quality.yml` and `.github/workflows/publish.yml`.

## Key Dependencies

**Critical:**
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

**UI and data presentation:**
- `@radix-ui/react-*` - Component primitives wrapped in `frontend/components/ui/`.
- `lucide-react` 0.564 - Icon system used across `frontend/components/` and `frontend/app/`.
- `recharts` 2.15.0 - Balance and rate charts such as `frontend/components/monitor/balance-overview.tsx`.
- `react-hook-form` 7.54.1, `@hookform/resolvers` 3.9.1, and `zod` 3.24.1 - Form and validation dependencies declared in `frontend/package.json`.
- `sonner` 1.7.1 - Toast notifications mounted from `frontend/src/main.tsx`.
- `next-themes` 0.4.6 - Theme state in `frontend/components/theme-provider.tsx`.
- `qrcode` 1.5.4 - Rendering recharge and subscription QR data in `frontend/components/monitor/channel-recharge-dialog.tsx`.
- `date-fns` 4.1.0 - Date manipulation and display support declared in `frontend/package.json`.

**Infrastructure:**
- Go `embed` - Vite output is embedded into the server binary by `web/web.go`; `backend/api/api.go` serves assets and SPA fallback routes.
- Go `log/slog` - Structured text or JSON application logs configured by `backend/logger/logger.go`.
- Browser `fetch` and Streams APIs - Same-origin REST calls in `frontend/lib/api.ts` and authenticated SSE consumption in `frontend/lib/sync-stream.ts`; no Axios dependency is used.
- AES-GCM from the Go standard library - Encryption at rest for integration credentials in `backend/crypto/cipher.go`.

## Configuration

**Environment:**
- Configuration loads from `config.yaml` through Viper, applies defaults, and then accepts environment overrides in `backend/config/config.go`.
- The server accepts `-config <path>` in `cmd/server/main.go`; without an explicit file it searches the working directory and creates `config.yaml` when absent.
- Runtime settings can be saved and hot-applied through `backend/api/settings.go` and `backend/runtimeconfig/runtime.go`.
- Core environment names are `APP_SECRET`, `AUTH_ENABLED`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AUTH_TOKEN_SECRET`, `SERVER_PORT`, `SERVER_MODE`, and `LOG_LEVEL`, bound in `backend/config/config.go`.
- Database environment names are `DATABASE_DRIVER`, `DATABASE_PATH`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME`, bound in `backend/config/config.go`.
- Compose/deployment-only names include `HTTP_PORT`, `IMAGE_TAG`, and the `MYSQL_*` family referenced by `docker-compose.yml` and `docker-compose.mysql.yml`.
- Frontend development may override the Vite proxy with `VITE_BACKEND_URL` in `frontend/vite.config.ts`.
- `.env` and `.env.example` are present for deployment configuration; secret-bearing contents are intentionally not part of this map. `.env` and generated `config.yaml` are excluded by `.gitignore`.

**Build:**
- `go.mod` and `go.sum` define the backend build graph.
- `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/pnpm-workspace.yaml`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, and `frontend/eslint.config.js` define the frontend toolchain.
- `Dockerfile` builds the frontend, copies `frontend/dist/` to `web/dist/`, and compiles the embedded production server.
- `.dockerignore` controls the Docker build context; `.air.toml` configures local backend reload.
- `frontend/components.json` records shadcn-style component aliases, Tailwind CSS location, and the Lucide icon library.

## Platform Requirements

**Development:**
- Use Go 1.23 or a compatible newer Go toolchain for `go test ./...` and `go run ./cmd/server`, as declared by `go.mod`.
- Use Node.js 20 and pnpm 10.4.0 for `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm dev`, and `pnpm build`, matching `Dockerfile` and `.github/workflows/quality.yml`.
- The Vite development server listens on port 3010 and proxies `/api` and `/healthz` to the Go server, which defaults to port 8418, as configured in `frontend/vite.config.ts` and `backend/config/config.go`.
- A writable data directory is required for SQLite and generated runtime configuration; defaults are implemented in `backend/storage/storage.go` and `backend/config/config.go`.
- Docker/Compose is required for parity with the integrated production image and for the optional MySQL service in `docker-compose.mysql.yml`.

**Production:**
- Primary deployment target is a self-hosted Docker/Compose environment using the GHCR image described by `docker-compose.yml`.
- The container exposes port 8418, serves the embedded SPA and API from one process, and persists database/configuration data through a host-mounted data volume defined by `Dockerfile`, `web/web.go`, and `docker-compose.yml`.
- SQLite is the default single-container store; MySQL 8.4 is the optional multi-container deployment in `docker-compose.mysql.yml`.
- Multi-architecture images for `linux/amd64` and `linux/arm64` are produced by `.github/workflows/publish.yml`.
- The project license is MIT, declared in `README.md`.

---

*Stack analysis: 2026-07-18*
