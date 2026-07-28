# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read for a fresh advisor:
> this file, then the last 3–5 rulings, then the newest 1–2 ARs. Do not read the
> ledger from the top. Invoke `advisor-ruling` before any ruling.
> Last rewritten: 2026-07-28.

## SEAT
Ledger at **R-359** (commit `ffc5ea02`). Newest AR: **AR-327**, RULED (R-358).
Worker: **ACTIVE**, on the R-359 probe-gate contract.

## AUTHORIZED NOW
Gate the ungated boot probe (`broker-router.ts:305`, `setImmediate` at module
load) behind the same stack as every other broker contact, or an explicit
opt-in defaulting off. New branch cut from the EXECUTING branch
(`hardening/slumhouse-shared-office-parity-20260723`) → commit → push → PR.
Red-proof at birth both directions. Then, without waiting: (2) paper accounts
get a `broker_type` with no live egress; (3) remove the derived
`${firmId}_API_KEY` credential fallback; (4) single broker-egress chokepoint +
a CI test failing on any other module's broker `fetch`.

## NOT AUTHORIZED
A merge · a worktree update · any production write · a service restart or
deploy · credential decryption · spend · edits inside `runtime-production`.

## STATE, WITH EVIDENCE GRADES
**[MEASURED HERE]** All 8 broker routes established shut — code, tower config,
and production DB (2 enabled TradersPost accounts, 0 live-state strategies, 0
assignment secrets, 0 credentials, vault table present and empty).
`TF_PHASE_5_ENABLED` and `STYLE_C_EXIT_TS_NATIVE` fail-safe by construction in
both runtimes. Running SHA `969ba025` passed CI + Fast Lane + Metric Snapshot
(verified by each run's own `headSha`); executing tree clean and == origin.
`test_synthetic_market_simulator.py` 43/43; `test_stochastic_regime_generator.py`
53/53 with Gaussian-rejection negative controls ⇒ the live generator clears the
3.0 excess-kurtosis bar. Migration 0159's "paper rows are NEVER routed to funded
brokers" is **UNENFORCED in code** — `'paper'` VALIDATES as a live TradersPost
account, and the credential fallback derives the baited name `PAPER_API_KEY`.
**[ARTIFACT-SOURCED]** corpus = 16 (`corpus_A.n_specs`), freshness unchecked.
**[CORROBORATED]** 0 eligible today (R-303 EXACT-NOW = 0), not re-run.
**[GRADED RUN, NOT RE-MEASURED]** T1 COMPLETE; Tooth-1's *application* of
`STATUS_CALIBRATED` (its definition is verified in code).
**[UNENUMERATED — OPEN]** the legacy Conv-VAE generate path (declared dead,
unmeasured); the running dependency set (`npm install` at boot ≠ `npm ci`); no
deploy record mapping SHA → when → who.

## QUEUE (next 4)
1. Probe gate (in flight). 2. Paper accounts → no-egress `broker_type`.
3. Remove derived credential fallback. 4. Egress chokepoint + bypass test.
Then: server-derived `strategy_id`; `npm ci` at boot; string-literal precondition
sweep; consequence-ranked flag enumeration; the floors; 3-ii/3-iii; the builds
(SMC → ORB+RANGE_EVENT as a pair → BAR_TIMING → SESSION_CLOCK).

## KNOWN-BENIGN (do not investigate)
`M src/engine/tests/fixtures/session_windows_parity.json` — phantom; content
hash-identical to HEAD (`0e7d4176b6fbcfe2`), verified twice. Do not touch the
index to clear it; it self-clears on the next legitimate write (UNTESTED).

## OPERATOR-FACING
**Do not set `PAPER_API_KEY` or any `<FIRM>_API_KEY` on the tower** — it reads
as the safe option and would arm the ungated probe. **Do not buy the $29 Massive
plan** until the paper engine is staged. `.claude/skills/` is **not under version
control** (that container's `.git` is not a valid repo) — all skills there are
disk-only, no backup.
