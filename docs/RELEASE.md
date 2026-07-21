# UpstreamOps Local Ops Release Runbook

This runbook describes the local fork release shape for `v0.0.6-ops.1`. It is intentionally limited to the repository, Docker Compose, and the operator's own fork. It does not publish images or create tags automatically.

## Release Inputs

- Fork remote: configure the operator-owned `origin`; keep the official project as an optional `upstream` remote for comparison and rollback.
- Branch: `feat/ops-p0-import-notify` for this candidate; use a reviewed release branch before merging to the fork's `main`.
- Candidate tag: `v0.0.6-ops.1` only after all gates and required external UAT pass.
- Runtime image: `ghcr.io/<owner>/upstream-ops:v0.0.6-ops.1`, pinned through `IMAGE_TAG` in `.env`.
- Data: host `./data` mounted into `/app/data`; never commit or upload this directory.

## Before Upgrade or Import

1. Set a fixed, operator-owned `APP_SECRET` and keep it unchanged across upgrades. Enable `AUTH_ENABLED=true`, a strong `ADMIN_PASSWORD`, and `AUTH_TOKEN_SECRET` in the deployment environment.
2. Run a verified snapshot with `./scripts/backup-data.sh backup` or `powershell -File ./scripts/backup-data.ps1 -Command backup`. Confirm it with `verify <tag>` and record the tag privately.
3. Run the quality entrypoint: `scripts/verify.sh` on Unix/Git Bash or `scripts/verify.ps1` on Windows. The gate includes Go tests, frontend lint/Vitest/build, Playwright Chromium tests, and Compose validation.
4. Run the candidate build and health drill without publishing: `scripts/release-candidate.sh all` or `powershell -File ./scripts/release-candidate.ps1 all`.
5. Run the isolated deployment-network OneBot check: `./scripts/onebot-compose-uat.sh` or `powershell -File ./scripts/onebot-compose-uat.ps1`. This starts a disposable OneBot v11 fixture and validates the candidate's group/private protocol paths and business-error handling without touching `./data`.

## Deploy

```bash
IMAGE_TAG=v0.0.6-ops.1 docker compose pull app
docker compose up -d app
./scripts/check-production.sh http://localhost:8080
```

The production check must receive `/healthz = 200` and anonymous `/api/channels = 401`. Confirm the browser login, import preview, failure recovery controls, notification form, and settings production checklist after the container is healthy.

For real OneBot v11 UAT, set the endpoint and target IDs in the operator environment and run the explicit sender only after confirming the targets:

```bash
ONEBOT_BASE_URL=http://127.0.0.1:5700 \
ONEBOT_ACCESS_TOKEN='operator-secret' \
ONEBOT_GROUP_ID=123456 \
ONEBOT_USER_ID=10001 \
ONEBOT_FAILURE_GROUP_ID=999999 \
ONEBOT_REAL_ENDPOINT=1 \
ONEBOT_CONFIRM=1 \
./scripts/onebot-uat.sh
```

PowerShell equivalent: `powershell -File scripts/onebot-uat.ps1 -BaseUrl http://127.0.0.1:5700 -GroupId 123456 -UserId 10001 -FailureGroupId 999999 -RealEndpoint -Confirm -EvidencePath .uat/onebot-evidence.json`. Save the output and JSON as UAT evidence: the evidence path requires explicit real-endpoint confirmation, records HTTP/status/retcode and returned `message_id`, and never stores the access token or message body.

## Rollback

1. Stop the app: `docker compose stop app`.
2. Restore the selected verified snapshot: `./scripts/backup-data.sh restore <tag>` (or the PowerShell equivalent). The helper validates hashes before replacing files, handles SQLite WAL/SHM, restarts only a previously running app, and checks `/healthz`.
3. Pin the official image: `IMAGE_TAG=v0.0.6 docker compose up -d app`.
4. Re-run the production check and browser smoke paths. Keep `APP_SECRET` unchanged; changing it makes encrypted records unreadable.

Do not delete the data volume during rollback. If the snapshot is unavailable or fails verification, stop and investigate rather than copying live SQLite files by hand.

## Sign-off

Automatic evidence must include the clean candidate build, health check, full local quality gate, and Playwright result. Real OneBot group/private delivery remains a separate external prerequisite: configure a reachable OneBot v11 endpoint, send one group and one private test message, and record one deliberate failure diagnosis before marking the release candidate complete.

## No Secrets in Git

Do not commit `.env`, `config.yaml`, `data/`, database/WAL/SHM files, exported backups, browser traces, or generated candidate artifacts. Logs and UAT records may contain statuses, timestamps, and redacted error categories only.
