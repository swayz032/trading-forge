# CURRENT_STATE

**NAVIGATION POINTER — NOT AUTHORITY.** If this file disagrees with the actual `external-advisor/*`
branch heads or the newest ruling on `external-advisor/gpt-rulings`, the repository wins. Resolve
the newest ruling by branch-head commit time (`git log -1 --format="%H %ad %s" --date=iso <ref>`
across every `refs/remotes/origin/external-advisor/*` branch), never by filename or AR-number sort —
see `.claude/skills/worker-onboarding/SKILL.md` section 1.

- **Path deviation, disclosed:** AR-1381A section 8B asked for this file at
  `docs/governance/CURRENT_STATE.md`. Worker-1's guard `edit_scope` (`.claude/worker1-hook-guard-manifest.json`)
  does not cover `docs/governance/`; it does cover `docs/replay-results/`. Placed here instead of
  requesting a guard widening for a navigation file, matching the AR-1380A precedent on the
  `AGENT-LOGS.md` friction (widen nothing merely for logging ceremony). GPT/operator may relocate it
  if a wider path is authorized.

## Architecture stage

3 — Strategy Factory.

## Latest controlling GPT ruling

AR-1381A, `origin/external-advisor/gpt-rulings @ e2b66ca9d176d29f3e8294739afda31fec40ad0f`
(`advisor-reports/AR-1381A-GPT-EXTERNAL-ADVISOR-RULING-AR1389-PASS-E8-FAIL-CONFIRMED-SPEED-CORRECTION-COMPILER-PREFLIGHT-TARGETED-VISION-2026-08-20.md`),
2026-08-20 20:06:51 -0400. Accepts AR-1389 (worker ingest + independent Claude challenge of the E8
round-3 V2 GPT-5.6 audit — both HIGH findings and all 9 PARTIAL claims CONFIRMED, FAIL survives).

## Worker branch + last verified head

`claude/worker1-h1-20260815`, verified at `f8b00b268c3217dd236644b21e96fbc7527f6e59` (AR-1389 commit)
at the time AR-1381A was written; advances with each subsequent commit.

## Current locks (AR-1381A)

- No hand-editing/reusing rejected E8 candidate SHA `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`.
- No blind round-4 Opus reconstruction before the Lane A preflight + Lane B evidence map.
- No invented Fibonacci anchors, wick identity, trading-range boundaries, BOS/FVG thresholds, expiry, or other source rules.
- No compiler/certifier code changes inside the Lane A preflight.
- No certifier/compiler promotion, SOURCE_FAITHFUL backtest, broad Factory rerun, 160-video intake, PAPER, or broker/Topstep/live.
- No new semantic-audit infrastructure absent a demonstrated new trust defect (V2 audit path is accepted as sufficient for this calibration).

## Exact next money-path action

Lane A (highest priority, authorized now): read-only E8 compiler-readiness preflight — one durable
matrix over every current `source_gaps` item plus every field a downstream certifier/compiler would
need, classified `COMPILE_BLOCKER_SOURCE_MISSING` / `COMPILE_BLOCKER_REPRESENTATION_DEFECT` /
`SAFE_TO_REMAIN_UNRESOLVED` / `NON_EXECUTABLE_NOT_REQUIRED` / `UNKNOWN_DOWNSTREAM_CONTRACT`. No
compile, certify, backtest, compiler-code edit, or default substitution inside this lane.

Lane B (parallel, evidence-only): targeted Visual Intelligence for exactly two named questions
(VI-E8-1 sell-side Fibonacci anchor direction, VI-E8-2 buy-side stop wick identity) — add more only
if Lane A proves them actual compile blockers.

Lane C (wait on A/B): one fresh E8 candidate identity only after the evidence map — never an edit of
the rejected SHA.

Lane D (non-blocking, in progress): this file + the branch-head-by-commit-time onboarding fix in
`worker-onboarding/SKILL.md` section 1 and the wrong-ref ear-arming warning in section 2a.
