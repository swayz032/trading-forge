# GPT-PREPARED TWO-WORKER CLAUDE PACKAGE

Status: PREPARED SOURCE ONLY — NOT YET INSTALLED INTO CLAUDE LOCAL SKILLS
Date: 2026-08-14
Authority: AR-1166 and AR-1167

## Purpose

Prepare the exact two-worker identity layer before Claude quota resets so Claude does not spend usage rediscovering or redesigning Agent Teams onboarding.

## Activation gate

DO NOT activate this package before:

1. current AR-1138 is resumed and completed;
2. AR-1138 tests/evidence are committed and pushed;
3. worker report is published;
4. GPT independently grades the completed AR-1138 work;
5. GPT authorizes two-worker activation.

## Identity law

Worker identity must be established before reading active rulings/reports.

- Worker 1 = Team Lead / Graph Engineering -> Compiler -> Strategy Factory.
- Worker 2 = Runtime & Execution Engineer / PAPER -> Qualification Ops -> Autonomous Runtime -> Execution Safety.

Both may consume the existing canonical `worker-execution` skill. They must not share onboarding identity, default work inbox, ownership, worktree, or active order.

## Package

- `worker-1-onboarding/SKILL.md` — Worker 1 identity-bearing onboarding candidate.
- `worker-2-onboarding/SKILL.md` — Worker 2 identity-bearing onboarding candidate.
- `worker-1-role-overlay/SKILL.md` — Worker 1 additions on top of canonical worker-execution.
- `worker-2-role-overlay/SKILL.md` — Worker 2 additions on top of canonical worker-execution.
- `worker-1-lane-manifest.md` — Worker 1 intake/history rules.
- `worker-2-lane-manifest.md` — Worker 2 intake/history rules.
- `INSTALL-AND-VERIFY.md` — narrow Claude-side comparison/install/identity tests.

## Non-authority warning

These repo files do not automatically replace the canonical local Claude skills under paths such as `/root/.claude/skills/...`. Claude must compare against the actual installed skills and perform only the minimum local wiring required after the AR-1138 gate.