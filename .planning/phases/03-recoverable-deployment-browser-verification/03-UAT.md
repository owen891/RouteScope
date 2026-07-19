---
phase: 03-recoverable-deployment-browser-verification
verified: 2026-07-19T19:00:00+08:00
status: automatic_recovery_and_browser_pass_external_onebot_pending
---

# Phase 03 UAT

## Isolated recovery drill

The drill uses `scripts/backup_data_test.go` temporary directories and an in-process HTTP health endpoint. It never reads the repository `data/` directory, `.env`, real database, or real credentials.

Evidence:

- SQLite fixture creates a real WAL-mode database with a `channels` table and a known `fixture-channel` row.
- `backup` creates `fixture-v1/manifest.json` with database/config names, byte sizes, SHA-256 hashes, mode, and UTC creation timestamp.
- The test verifies the manifest before mutation, changes the live database/config and creates a stale WAL, then runs `restore fixture-v1`.
- Restore verifies the manifest first, stages replacements, restores the selected snapshot, restores captured sidecars, and removes stale sidecars that were not in the selected snapshot.
- The test verifies the original database/config bytes and `/healthz = 200` after restore.
- A tampered database checksum and an unsafe `../fixture-v1` tag are rejected before live files change.

Commands:

```text
go test ./scripts -run 'Backup|Restore' -count=1 -v
go test ./scripts -count=1
```

Both passed on 2026-07-19. The native PowerShell helper was also run against a temporary root and produced `backup verified: x1`; PowerShell parser validation passed.

## Browser verification

The deterministic Playwright fixture runs the actual Vite SPA and intercepts API responses in the browser:

```text
corepack pnpm --dir frontend test:e2e
```

Result: 4 Chromium tests passed.

- AuthGate shows anonymous login, accepts fixture credentials, and renders the authenticated shell.
- all-api-hub import preview renders conflict policy and malformed-row feedback without uploading raw backup content.
- Notification form switches QQ OneBot group/private targets and Bearer/query-auth controls.
- Settings production checklist reports the protected anonymous API (`401`) state.

The full PowerShell quality entrypoint also passed with this browser gate enabled:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall
```

## External prerequisites

This phase does not claim real OneBot delivery. Phase 2 remains `partial_external_uat`: no reachable OneBot endpoint was available at `127.0.0.1:5700` or `host.docker.internal:5700`, so real group/private message IDs and an intentional delivery failure remain pending. A reachable OneBot v11 endpoint must be configured before release sign-off.

## Remaining release work

Phase 4 still needs a clean-checkout image build/health drill, release documentation and rollback review, and a final decision on the pending real OneBot UAT. No release tag or publication was created in this phase.
