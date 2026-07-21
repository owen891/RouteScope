---
phase: 04-auditable-release-candidate
plan: "01"
subsystem: release-build
tags: [docker, buildkit, healthz, candidate]
requires: []
provides:
  - Local candidate build and isolated runtime health helper for Bash/PowerShell.
  - Contract tests that prevent accidental publication or secret output.
affects: [release, deployment]
metrics:
  tasks_completed: 2
  files_modified: 3
completed: 2026-07-19
status: complete
---

# Phase 04 Plan 01 Summary

`release-candidate.sh` and `release-candidate.ps1` build the pinned Dockerfile, validate Compose, start an isolated candidate container, and require `/healthz = 200`. They never push, log in to a registry, create a formal tag, or print secret values. `release_candidate_test.go` covers the shared contract.

Verification: candidate BuildKit image build and runtime health passed with `upstream-ops:candidate-local`; release contract tests and PowerShell syntax parsing passed.
