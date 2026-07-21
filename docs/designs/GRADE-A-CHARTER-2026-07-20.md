# GRADE A — GRADER CHARTER (ops-experience liveness wave, first grade gate)

**Issued by:** ops-experience advisor (OR-021 §4). **Status:** READY — fires when the pytest floor lands and the working agent requests Grade A.
**Dispatch:** the working agent dispatches a FRESH-CONTEXT independent grader (accuracy-validator type; doer≠grader — the builder must not grade its own wave). This file is the grader's complete brief; the grader reads it plus the two relay ledgers and grades FROM ZERO.

## Scope — "the rails now report honestly" (and NOTHING else)

Branch `ops/office-rails-20260719`, base `404a3396`. In scope, by commit:
1. **Unit 1b — canonical-tree restoration** (receipts in OA-006/OA-019; no commit — a state repair with receipts).
2. **Unit 1c — crash-visibility class fix** `dec84fd4` (`scripts/lib/rail-crash-handler.cjs` + three entrypoints).
3. **Unit 2(i) — test-runner split** `4eabf4bf` (`ci/vitest.config.mjs`, `package.json` `test:scripts`, `fast.yml`, `test-lane-coverage.test.mjs`).
4. **Skip-streak alert** `d433b543` (`scripts/lib/skip-streak.cjs`).
5. **Vuln receipt + CL-003 classification** (OA-007 §1; receipt `docs/ops-receipts/2026-07-19-canonical-npm-audit.json` in the worktree).
6. **pytest collectionFloor fix** (lands before this grade fires — verify its `--collect-only` derivation receipt + versioned-threshold discipline; the floor must be real, derived, and margined, replacing the vacuous `1`).

**OUT of scope — do not grade, do not wander into:** the Tier-2 member-office work (`8d7f9e43`, `322bc2b0`, `0bf5f161`, `21128e04`, `d2dc5fc9` — separate unit, separate grade, where the OR-018 known-vector requirement lives), the watchdog build (Grade-B rider), rail-3 (design only), anything money-path.

## Non-negotiable method (grading-integrity law)

- **Re-measure from zero.** The doer's receipts are CLAIMS. Recompute: hash the lockfile yourself; run the per-item 34/34 dependency inventory yourself (a count is not an inventory); read the actual ledger rows.
- **RED-proofs are RE-EXECUTED, never re-read:** (a) induce a `MODULE_NOT_FOUND` against the crash handler → a crash row MUST appear (then clean up); (b) inject an orphan test file → `test-lane-coverage` must go RED naming it via both assertions (then remove); (c) drive `evaluateRailLiveness` across its thresholds incl. the crash-suspect half; (d) induce a pytest collection crash → the new floor must breach.
- **Execution over reading:** run `npm run test:scripts` (node:test lane — NOT vitest) and the `ci/vitest.config.mjs` lane; both must be green at the branch tip. Run gate-chain-integration (89 expected) to prove CORE_DDL sync.
- **Live-state claims verified live:** `Get-ScheduledTask` for task state; `data/rails/` + `data/soak/` for ledger rows (cert files live in `data/rails/`, NOT `data/certificates/`); by grade time the 03:20 soak row and possibly the 22:00 full-lane row exist — READ them; OA-019 §2's "1 of 3 proven" caveat must be resolved to 3-of-3 or honestly carried.
- **Band per grading-integrity:** 10 unreachable; 7–8 is the pre-live ceiling; no bare numbers — every band point cites evidence; findings carry `file:line` + failure scenario. State doer≠grader explicitly.

## Traps that will waste your time if you don't know them (all pinned/on-disk)

- Bare `npx tsc` OOMs — use `NODE_OPTIONS=--max-old-space-size=8192`.
- The scripts test estate is SPLIT by design: node:test files run under `test:scripts`; only `divergence-check`/`worktree-ttl` + the coverage guard run under the vitest ci lane. "No test suite found" means YOU ran the wrong runner, not that the suite is broken.
- Never `npm ci`, never touch the canonical tree's `node_modules`; the grader works read-only against the worktree (it has its own real `node_modules`).
- NEVER import engine/vectorbt-adjacent modules in any probe — pytest collection hangs on the tower (pinned).
- Timestamps: clock-read only; header times in ledgers before OA-016 were estimates (documented).
- The tower may be running the money path's battery — do NOT run heavy suites while python workers are active beyond what the checks above require; nothing in this grade needs the engine.

## Deliverable

One report, newest-top style: banded verdict + per-scope-item findings (CONFIRMED/refuted, with your own receipts) + RED-proof execution evidence + any out-of-scope findings LOGGED-NOT-ADOPTED. The working agent files it (or its summary + path) as an OA; the advisor rules on the grade; landing (FF-only onto current origin tip, which includes the unit-4 upstream drift confirm) happens only after that ruling.
