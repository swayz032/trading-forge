# GPT EXTERNAL ADVISOR RULING — AR-1033 / MP1-CANDIDATE-INGRESS-1 CLOSED / NEXT: MP2-COMPILED-SPEC-INGRESS-1

## 1. VERDICT

**AR-1033 ACCEPTED.**

**`MP1-CANDIDATE-INGRESS-1 = CLOSED` at remote engineering pin `d2f222531ef973e9e9d651cbfdad948cbbb1772b`.**

The worker has satisfied the bounded MP1 contract: persisted candidate identity now survives `/api/backtests` into the existing Node→Python config transport, Python reuses the existing candidate-authority resolver at the earliest trustworthy boundary, mismatches/incomplete authority produce a named refusal, legacy rows remain legacy, request-body strategy overrides are rejected for candidate-aware rows, and a strategy-authority DB read failure now fails closed instead of silently downgrading to legacy.

No live-Postgres campaign and no independent grader are required to close MP1. The real route handler is exercised in the committed tests, the real config-file Python transport is exercised, the decisive production commits are now durable on origin, and MP1 intentionally changes authority continuity rather than trading semantics.

## 2. EXTERNAL VERIFICATION

I independently resolved and inspected the pushed code on origin.

### 2.1 Original MP1 repair is durable

`4f5a581582c35407d95bf3143340941d2973cc81` resolves on GitHub and contains the claimed bounded repair. Its production changes are the candidate sidecar transport in `src/server/routes/backtests.ts` and an additive Python candidate-authority adapter/gate in `src/engine/backtester.py`; the Python change is an addition rather than the broad Ruff rewrite the worker disclosed and reverted.

### 2.2 Final branch shape is bounded

Comparing pre-MP1 `3be07ddc043faa82c5a6291345b669aece57e968` to final `d2f222531ef973e9e9d651cbfdad948cbbb1772b` shows the expected MP1 production files, the two MP1 test files, and generated `SYSTEM-INVENTORY.md` updates. No unrelated trading/compiler implementation surface appears in that final compare.

### 2.3 Route authority is now DB-owned and fail-closed

At the final pin, `backtests.ts` reads the candidate id, cache identity, receipt, and `compiled_spec.spec_hash` parent anchor from persisted `strategies.config`; any partial authority returns `409 candidate_authority_incomplete`. A candidate-aware persisted row plus request-body `strategy` returns `409 candidate_authority_conflict` before a Python spawn. The sidecar is spread into `fullConfig` only from the persisted row.

The follow-up commit `2f9c8afac6d638b419427bfb22b4295fdb9cb2df` closes the real pre-existing fail-open: if the persisted strategy-authority read throws, the route now returns `503 strategy_authority_unavailable` before slot acquisition and before `runBacktest`. A successful read that returns no row remains a different state from an unreadable authority.

### 2.4 Python validates before execution

`backtester.py` now calls `validate_candidate_authority(config)` immediately after config JSON parsing and before market-data or strategy execution. The adapter reconstructs `CandidatePersistenceRow` and delegates identity proof to the existing `resolve_row_for_execution`; it does not introduce a second canonicalizer or receipt hash implementation. A mismatch returns the existing `EXECUTION_STATUS_REFUSED` family of envelope rather than zeroed performance metrics.

### 2.5 Committed controls are appropriately discriminating

The route test drives the real registered POST handler and checks the actual config handed to the real `runBacktest` call site. It covers DB-owned sidecar transport, request override rejection, partial authority rejection, missing-parent rejection, legacy preservation, DB-outage refusal, and the distinction between an outage and a successful no-row read.

The Python test mints real candidate receipts from the frozen provenance record, proves the happy path proceeds, proves missing/swapped identity anchors refuse, and drives the real on-disk config-file path into `main()`. Its market-data sentinel distinguishes “candidate gate passed” from “candidate gate refused,” avoiding a false-green gate that rejects everything.

The worker reports `13/13` route, `11/11` Python ingress, `25/25` existing candidate receipt/persistence obligations, `59/59` adjacent TS suites and whole-repo `tsc --noEmit` with zero errors. I did not independently execute those commands from this connector seat; the code, test subjects and pushed commits themselves are independently verified on GitHub.

## 3. MP1 BOUNDARY — WHAT IS CLOSED AND WHAT IS NOT

MP1 proves **identity continuity**, not Opening Range execution semantics.

The worker correctly preserved that boundary: Python proves the `OpeningRangeExecutionCandidate` and then currently discards the returned object. MP1 therefore establishes:

`persisted candidate row → DB-authoritative candidate sidecar → /api/backtests → runBacktest → Node→Python JSON transport → Python candidate proof / named refusal`.

It does **not** yet establish that the proven 5m/15m/30m candidate changes the bars the strategy trades. Do not reopen MP1 to make that happen.

## 4. NEXT LOAD-BEARING GAP — `MP2-COMPILED-SPEC-INGRESS-1`

I am intentionally naming the next bounded money-path unit **`MP2-COMPILED-SPEC-INGRESS-1`**.

The next break is now directly measured:

- spec onboarding already persists top-level `compiled_spec` in `strategies.config`;
- `/api/backtests` reconstructs the strategy with an explicit strategy-field whitelist and currently does **not** copy persisted `compiled_spec` into `fullConfig`;
- Python already has a production `elif isinstance(config, dict) and config.get("compiled_spec"):` dispatch that calls `from_compiled_spec(...)` and enters the condition-family execution path.

So the compiler artifact already has a storage home and an engine consumer. The missing hop is the route transport between them.

### Exact MP2 objective

Carry the **exact persisted `compiled_spec` object** from the DB strategy row into the config handed to `runBacktest`, as DB-authoritative data, so the existing Python compiled-spec dispatch is actually reachable through `/api/backtests`.

Do not rebuild, translate, sanitize, recompile, or summarize `compiled_spec` in the route. It is already the persisted compiler artifact.

## 5. MP2 REQUIRED PROOF — SMALLEST ROBUST SET

Execute straight through without a GPT round-trip unless a STOP fires.

1. **RED at the real route boundary.** Use a persisted spec-onboarded row that contains `compiled_spec`. Before repair, prove the config actually handed to `runBacktest` lacks it. Positive-control the harness by proving a known strategy field and the MP1 candidate sidecar do reach the call.
2. **GREEN exact transport.** After the smallest repair, the object handed to `runBacktest` must contain `compiled_spec` exactly from `stratConfig`. Deep equality or a stable serialization/hash witness is acceptable; do not hand-build a second “equivalent” artifact.
3. **Request cannot color authority.** Request-body fields may not supply or replace persisted `compiled_spec`. The request schema currently does not name it; retain that property and test it explicitly.
4. **Candidate authority still runs first.** A tampered/incomplete candidate sidecar must still REFUSE before the compiled-spec execution branch can run. MP2 may not weaken MP1.
5. **Python dispatch witness.** Through the real config-file transport / real `main()` boundary, prove a valid persisted `compiled_spec` reaches the existing `from_compiled_spec(...)` branch rather than the legacy DSL `BacktestRequest` branch. Stub the first downstream expensive dependency if needed; do not run a full market-data backtest merely to prove dispatch.
6. **Legacy negative control.** A legacy row with no persisted `compiled_spec` must retain its existing path and must not grow a fabricated compiler artifact.
7. **No trading-semantic mutation in MP2.** Do not change `from_compiled_spec`, condition meanings, opening-range duration selection, stop/target logic, entry logic, or compiler rules in this unit.
8. **Run the existing MP1 suites plus the smallest MP2 route/Python tests and `tsc --noEmit`.** Reuse existing harnesses; no new checker framework.

## 6. MP2 STOP CONDITIONS

STOP and report before mutation if:

1. carrying persisted `compiled_spec` requires rewriting or normalizing the certified compiler artifact;
2. the route must guess which compiler artifact belongs to the row;
3. MP2 reveals a persisted `compiled_spec.spec_hash` contradiction with the candidate parent/receipt rather than a simple transport omission;
4. the existing Python `from_compiled_spec` branch cannot consume the stored artifact without a compiler/trading semantic change;
5. a request-side override must be retained for a candidate/spec-onboarded row to keep existing production behavior;
6. the repair expands into DB schema work, a new compiler, or a new runner/checker framework.

Otherwise continue straight through.

## 7. AFTER MP2 — DO NOT CONFUSE TRANSPORT WITH EXECUTION

If MP2 goes GREEN, the next semantic unit is **`OR-STATE-HANDOFF-1`**.

That is where the already-proven `OpeningRangeExecutionCandidate` stops being discarded and is handed into the existing typed Opening Range execution state before breakout/target/stop evaluation. That unit must prove the selected taught candidate controls the actual Opening Range duration without recomputing or guessing it.

Expected shortest path:

`MP1 CLOSED → MP2 compiled_spec ingress → OR-STATE-HANDOFF-1 → full Opening Range V1.0 → real backtests → EDGE-HTF authority before ranking → OOS/WF/MC/prop sim/paper`.

`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` remains banked and HIGH before strategy ranking; do not derail MP2 to solve it early.

## 8. NO EXTRA CERTIFICATION CAMPAIGN

No live-DB campaign, independent grader, ACCEPT-5 rerun, RATIFY rerun, or broad regression campaign is authorized for MP2 unless a STOP condition exposes a materially larger authority or trading-semantic defect.

This is now a narrow money-path transport repair. Move fast and measure the real seam.

## 9. NEXT REPORT

Report after either:

- `MP2-COMPILED-SPEC-INGRESS-1` is RED→GREEN and pushed to origin with its final SHA; or
- one of §6's STOP conditions fires.

Do not hand off merely because MP2 is a new unit if the current fresh worker still has adequate context.