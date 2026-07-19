---
phase: 04-auditable-release-candidate
verified: 2026-07-19T19:25:00+08:00
status: automatic_candidate_pass_external_onebot_pending
---

# Phase 04 UAT

## Candidate build

Command:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-candidate.ps1 all
```

Result: passed. Docker BuildKit built the current Dockerfile from the repository context using the frozen `frontend/pnpm-lock.yaml`, compiled the Go server, created a local `upstream-ops:candidate-local` image, started an isolated container with a temporary data directory, and verified `http://127.0.0.1:18418/healthz`.

The first attempt hit a transient Docker Hub EOF while resolving `alpine:3.20`; the immediate retry resolved the base image and completed. This is recorded as network noise, not a false pass or a source failure.

## Automated evidence

- `go test ./scripts -run 'Release|Candidate|Workflow' -count=1` passed.
- PowerShell parser validation passed for release and quality scripts.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall` passed, including 4 Chromium Playwright tests, full Go tests, frontend lint/Vitest/build, and Compose validation.
- `corepack pnpm --dir frontend test:e2e` passed: 4 Chromium tests.
- `go test ./backend/api -run 'QQBotNotification' -count=1` passed: 4 API-level OneBot protocol scenarios.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/onebot-compose-uat.ps1` passed: isolated candidate app plus OneBot fixture verified group Bearer, private query auth, and business `retcode=100` failure propagation over the Docker network.
- `git diff --check` passed before evidence commit.

## Secret and worktree audit

- `git ls-files data .env config.yaml frontend/test-results` returned no tracked runtime data, environment files, generated browser artifacts, or database files.
- `.gitignore` excludes `data/`, backups, SQLite database/WAL/SHM, `.env`, generated frontend output, and candidate binaries.
- Candidate scripts do not contain `docker push`, registry login, formal tag creation, or secret output.
- No release tag was created and no registry push was attempted.

## OneBot protocol evidence

The application-level OneBot v11 path is covered end to end by `go test ./backend/api -run 'QQBotNotification' -count=1`: group Bearer, private query auth, business retcode failure, and HTTP 502 all passed through the real API route and Dispatcher. This closes the implementation gap without claiming real QQ account delivery.

The Compose UAT adds the deployment-network check: the candidate container reaches a disposable OneBot fixture through the service DNS name, sends both supported target modes, and surfaces a nonzero OneBot retcode as an API test failure. It uses a tmpfs database and synthetic credentials, so it does not alter operator data or prove delivery to a real QQ account.

## Residual release blocker

Real OneBot v11 group/private delivery is still unavailable in this environment. Phase 2 UAT remains explicitly pending until a reachable endpoint is configured and both message types plus one deliberate failure are recorded. The application protocol path is complete, but this document does not claim `RELS-03` or final `v0.0.6-ops.1` sign-off.
