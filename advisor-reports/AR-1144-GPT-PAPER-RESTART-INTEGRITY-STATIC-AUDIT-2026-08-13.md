# AR-1144 — GPT STATIC AUDIT: CUSTOM PAPER RESTART INTEGRITY — SECOND CORRECTION

**Date:** 2026-08-13  
**Compiler branch:** `h1-wave4-sealed12-driver` at `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Runtime lineage inspected:** `main` at `64bd430810dc73e4206f8221792c922364eeec0f`

## Correction

The prior version used the TradingView/TradersPost paper route as the authority for the operator's custom PAPER engine. That was incorrect.

Repository commit `91e1870fa148fd8ff3335050ca5870b3bb3e456d` (`M3-core: PAPER Authority Flip — internal-engine-only MVP`) changed PAPER so the internal Massive-WS/custom simulator is the PAPER-state record keeper. `main` contains that commit. The isolated compiler branch diverged before it and therefore still contains older PAPER-authority assumptions.

Use the branches for different questions:

- `h1-wave4-sealed12-driver` — AR-1138 compiler/extraction evidence.
- M3-containing runtime/main lineage — custom PAPER static-readiness evidence.

## Current custom PAPER restart behavior on main

`src/server/lib/paper-authority-states.ts` defines only `DEPLOY_READY`, `PILOT`, and `DEPLOYED` as broker-authoritative. PAPER is intentionally internal-engine-only.

`src/server/scheduler.ts::resumeActivePaperSessions()` therefore reconnects PAPER sessions to the custom internal stream after a process restart. It also rehydrates deferred pending-entry state for internal sessions.

## Identity continuity finding

`paper_sessions.strategy_id` remains nullable with `ON DELETE SET NULL`. The restart authority guard treats a missing lifecycle state as non-broker-authoritative, so an orphan session can pass that particular guard.

Downstream behavior limits the impact:

- `getSessionConfig(sessionId)` returns `null` when the session has no strategy ID, so normal strategy evaluation cannot load a config.
- PAPER trading-day counting joins `paper_trades` through `paper_sessions` and filters by the target strategy ID, so a NULL strategy ID is not credited to the deleted strategy.

Therefore this is best classified as an **identity/evidence-continuity gap**, not proof that orphan PAPER evidence is falsely credited.

## Restart qualification invariant

An official custom PAPER restart receipt should prove:

```text
session strategy ID resolves
same candidate version is still active
pending/open state belongs to that candidate
restart/backfill does not duplicate qualifying state
```

If candidate identity cannot be reconstructed, that restart interval should not be counted as clean qualification evidence until reconciled.

## Verdict

- Custom PAPER authority on current main doctrine: **internal Massive/custom engine**.
- TradingView/TradersPost as the operator's custom PAPER authority: **incorrect**.
- Compiler branch as the source for current PAPER doctrine: **incorrect; it diverged before M3**.
- Custom PAPER restart/rehydration foundation: **present**.
- Orphan-session identity handling: **needs a bounded fail-closed qualification control**.
- Exact immutable candidate-version continuity across the full PAPER window: **not yet proven by this audit**.

This file supersedes both earlier AR-1144 interpretations.