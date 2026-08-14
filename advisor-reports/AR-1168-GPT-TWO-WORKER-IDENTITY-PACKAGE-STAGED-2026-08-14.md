# GPT EXTERNAL ADVISOR RULING — AR-1168

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Status:** TWO-WORKER IDENTITY PACKAGE STAGED / NOT YET INSTALLED

## Ruling

The GPT lane has now converted AR-1166/AR-1167 from architecture prose into a concrete repo-staged candidate package for Claude Code Agent Teams activation.

Prepared source lives under:

`advisor-prepared/two-worker-claude/`

Package contents:

- `README.md`
- `worker-1-onboarding/SKILL.md`
- `worker-2-onboarding/SKILL.md`
- `worker-1-role-overlay/SKILL.md`
- `worker-2-role-overlay/SKILL.md`
- `worker-1-lane-manifest.md`
- `worker-2-lane-manifest.md`
- `INSTALL-AND-VERIFY.md`

## Identity split

Worker 1:

`Team Lead / Graph Engineering -> Compiler -> Strategy Factory`

Worker 2:

`Runtime & Execution Engineer / PAPER -> Qualification Ops -> Autonomous Runtime -> Execution Safety`

The workers may share canonical `worker-execution` engineering law, but they do not share onboarding identity, default inbox, active order, ownership, or worktree/branch.

## Intake split

Neither worker may blindly enumerate all advisor reports during onboarding.

Each worker loads only:
- explicit global doctrine;
- its own lane manifest;
- its own active order;
- history explicitly referenced by that order/manifest;
- direct cross-lane dependency messages.

This prevents both workers from seeing the same ruling/report stream and initializing as the same worker.

## Installation boundary

This package is PREPARED SOURCE, not proof of installation into Claude's local skill environment.

Claude must directly inspect the canonical installed onboarding/worker-execution sources after AR-1138 closes, preserve the existing shared execution law, wire the distinct identities using the local Claude Code skill/command convention, and run the identity/inbox negative controls in `INSTALL-AND-VERIFY.md`.

## Hard activation gate

Do not interrupt or restart AR-1138.

Sequence remains:

1. resume exact AR-1138;
2. finish/tests/evidence;
3. commit/push/report;
4. GPT independent grade;
5. only if approved, install/verify the staged two-worker identity package;
6. GPT reviews identity proof;
7. activate two-worker Agent Teams;
8. assign one bounded packet per worker.

## Next GPT flashlight task

With the identity package staged, GPT may proceed to the next independent pre-solve lane while Claude remains paused. The staged identity package should not be redesigned by Claude absent a measured incompatibility with the canonical local skill implementation.