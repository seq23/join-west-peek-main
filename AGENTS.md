# Repo Agent Bootstrap

This repository is governed by the user's local Repo Operator system.

## Source of authority
Read repo-local authority first. Global Repo Work OS and active tools: `~/repo-tools/reference-authorities/repo-work-os` and `~/repo-tools/manifests/ACTIVE_SCRIPTS.md`. Hallmark: `~/repo-tools/reference-authorities/hallmark`.

## Terminal entry points
```bash
~/repo-tools/agent/repo-work <repo>
~/repo-tools/agent/repo-work --help
~/repo-tools/agent/repo-status
```
Unattended lifecycle: `~/repo-tools/agent/repo-supervisor`; parallel bake-off: `~/repo-tools/agent/repo-bakeoff`.

## Operating law
Lock exact repo/worktree/branch/SHA/remote; unattended work only on isolated `work/*` worktrees; never substitute another repo; validation and exact-SHA GitHub checks precede merge eligibility; RED/UNPROVEN stays blocked; main/default merge is allowed only when every required check is green, never with `--admin` and never force-pushed; use Claude Design routing for material UI/UX work when useful and existing Hallmark rather than duplicating it.
