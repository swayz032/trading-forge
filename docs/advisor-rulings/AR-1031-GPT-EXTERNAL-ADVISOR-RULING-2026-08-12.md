# GPT EXTERNAL ADVISOR RULING — AR-1031 / MP1 TRACE ACCEPTED / CANDIDATE AUTHORITY IS PERSISTED BUT DROPPED AT `/api/backtests` / FRESH WORKER EXECUTE THE SINGLE INGRESS SEAM

## 1. VERDICT

**AR-1031 TRACE ACCEPTED.**

**Phase 5 remains CLOSED. Do not reopen referee engineering.**

The active unit is **`MP1-CANDIDATE-INGRESS-1`**.

The operator is swapping to a **fresh worker now**. That fresh worker should begin immediately from this ruling and AR-1031. Do not hand off again merely because MP1 implementation is unstarted.

## 2. EXTERNAL VERIFICATION — THE GAP IS NOW PRECISE

I independently verified the load-bearing path at engineering pin `3be07ddc043faa82c5a6291345b669aece57e968`.

### A. Candidate authority is already persisted

`spec-onboarding-service.ts` writes these three sibling fields into `strategies.config` for candidate-aware rows:

- `execution_candidate_id`
- `execution_candidate_cache_identity`
- `execution_candidate_receipt`

The same persisted config also contains `compiled_spec.spec_hash`, which is the outer parent-spec anchor. The candidate fields are deliberately siblings of `compiled_spec`; do not move them inside the certified artifact.

### B. `/api/backtests` drops that authority

`backtests.ts` requires `strategyId`, optionally accepts a request-body `strategy`, and then builds:

`const config = { ...rest }`

where `rest` is request-body backtest configuration, not the persisted strategy row's full config.

The DB row is read, but its `config` is used only to recover selected strategy DSL fields / `strategyClass`. The route then builds:

`const fullConfig = { ...config, strategy: resolvedStrategy }`

Therefore the persisted `execution_candidate_*` siblings and `compiled_spec` parent anchor do **not** enter `fullConfig`.

This is not an implicit pass-through. The sidecar is actually dropped.

### C. TS→Python bridge is already capable of carrying the fields

`backtest-service.ts::runBacktest()` persists its received `config` and passes that same config to `runPythonModule()`.

`python-runner.ts` serializes the provided config to a temporary JSON file and invokes the Python backtester with `--config <file>`.

So **do not redesign the Node↔Python transport**. If the route supplies the candidate sidecar, the existing bridge can carry it.

### D. Python ingress does not yet own candidate identity

`BacktestRequest` in `src/engine/config.py` has no candidate identity / receipt fields today.

The authoritative Python validator already exists elsewhere: `opening_range_candidate_persistence.resolve_row_for_execution()` verifies:

1. receipt exists;
2. outer candidate ID exists;
3. outer cache identity exists;
4. receipt parent matches the row's parent spec hash;
5. receipt ID/cache identity agree with the outer fields;
6. receipt payload recomputes to the claimed candidate.

**Reuse that authority. Do not write a second Python candidate validator.**

## 3. IMPORTANT BOUNDARY — MP1 IS IDENTITY/PROVENANCE INGRESS, NOT FULL OR EXECUTION YET

Do **not** expand this repair into full Opening Range V1.0 or start implementing breakout/stop/target semantics here.

The current purpose is to make one persisted candidate/config identity survive faithfully to the Python execution boundary and be refused if it cannot be proven.

Full candidate trading semantics remain later work (`OR-STATE-HANDOFF-1` / full OR V1.0).

However, one rule is mandatory now:

**A request must not be able to run a different strategy payload while borrowing a persisted candidate identity.**

For a candidate-aware DB row, request-side `strategy` replacement is not authoritative. The smallest safe behavior is to **REFUSE a candidate-aware request that supplies a strategy override**, rather than silently ignoring it or executing it under the DB candidate label.

Legacy / receiptless rows retain their existing request-override behavior unless the repair proves that behavior itself is unsafe for an already-governed contract.

## 4. MINIMAL REPAIR CONTRACT

Execute the smallest end-to-end seam that proves all of the following.

### RED 1 — sidecar is currently lost

A candidate-aware persisted strategy row submitted through `POST /api/backtests` must demonstrate pre-repair that the config handed to `runBacktest()` lacks the candidate sidecar / parent anchor.

Use the real route construction boundary. Do not test a copy of the object-building logic.

### REPAIR A — DB-authoritative sidecar

For a candidate-aware row, source these values **only from persisted `strategies.config`**:

- `compiled_spec.spec_hash` as parent-spec hash;
- `execution_candidate_id`;
- `execution_candidate_cache_identity`;
- `execution_candidate_receipt`.

Thread them into the config handed to `runBacktest()` using explicit names. Do not use request-body values and do not infer anything from timeframe, strategy name, array position, or duration.

If the persisted row has a partial candidate sidecar — one/two fields without the complete authority set — **REFUSE**. No defaults.

### REPAIR B — candidate-aware request strategy override refuses

If the DB row is candidate-aware and the request includes `strategy`, return a deterministic named refusal before spawning Python.

The reason must make clear that persisted candidate/config authority cannot be overridden by request strategy content.

Do not silently prefer one side.

### REPAIR C — Python ingress owns and validates the sidecar

Extend the Python request/ingress shape only as much as necessary to carry:

- parent spec hash;
- candidate ID;
- cache identity;
- receipt.

At the earliest trustworthy Python execution boundary, reuse `CandidatePersistenceRow` + `resolve_row_for_execution()` (or an equivalently direct reuse of the same authoritative functions) to prove the candidate before market data/backtest execution proceeds.

A mismatch must produce the system's existing **named REFUSED execution envelope**, not an uncaught traceback, zero-trade fake success, or fallback candidate.

Do not duplicate candidate canonicalization or receipt hashing.

### REPAIR D — legacy stays legacy

A strategy row with **no candidate fields at all** must follow the pre-existing legacy backtest behavior. No candidate should be minted, inferred, selected, or defaulted.

## 5. REQUIRED CONTROLS

The fresh worker should produce a small discriminating matrix, not a broad campaign:

1. **candidate-aware happy path** — exact persisted candidate ID/cache/receipt/parent reaches Python and validates;
2. **request override negative** — same candidate-aware row + request `strategy` override => named REFUSED, Python not launched;
3. **partial sidecar negative** — candidate ID with missing receipt/cache/parent (choose at least one representative partial state) => named REFUSED;
4. **swapped receipt / identity mismatch** — durable candidate A row with candidate B receipt or cache identity => Python named REFUSED before backtest execution;
5. **legacy control** — no candidate fields => existing behavior unchanged;
6. **transport witness** — mutate one candidate sidecar field at the DB/route seam and prove the exact mutation is visible at Python validation. This excludes a fake test that validates a locally reconstructed copy instead of the real transport.

Use existing tests/helpers wherever possible. No new checker framework.

## 6. WHAT NOT TO DO

Do not:

- reopen R3 / ACCEPT-5 / RATIFY;
- change compiler strategy meaning;
- change Opening Range breakout/stop/target logic;
- move candidate fields inside `compiled_spec`;
- use request body as candidate authority;
- default to the first candidate;
- infer candidate from timeframe/duration/name;
- key identity on `cache_identity` instead of `candidate_id`;
- create a new DB schema if the existing config JSONB is sufficient;
- redesign `runPythonModule` — it already transports arbitrary JSON config;
- broaden this into HTF-overlay repair in the same patch.

## 7. HIGH BANK THAT REMAINS AFTER MP1

`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` remains **HIGH before strategy ranking/edge qualification**.

The same route reconstruction currently selects a narrow subset of strategy fields, so HTF/context authority must be explicitly verified later before ranking metrics are trusted.

Do not solve that by stealth inside MP1 unless the MP1 patch cannot be correct without touching it. If it becomes load-bearing, STOP and report.

## 8. STOP CONDITIONS

STOP and report before mutation beyond the bounded seam if:

1. candidate validation requires changing certified compiler/source meaning;
2. candidate ingress cannot be implemented without changing trading semantics;
3. the persisted candidate sidecar does not contain enough information to bind to its parent without guessing;
4. supporting candidate-aware execution requires a DB migration rather than the existing `strategies.config` authority;
5. request-side strategy override is currently required by a production candidate-aware caller and removing it would change a relied-on production contract;
6. Python cannot consume the sidecar without a broad backtester redesign;
7. a real HTF/context authority defect becomes inseparable from the candidate seam.

Otherwise execute RED→GREEN straight through without another permission round-trip.

## 9. EXIT CONDITION

`MP1-CANDIDATE-INGRESS-1` closes when one persisted candidate/config authority is proven end-to-end:

**persisted candidate row → `/api/backtests` DB-authoritative sidecar → `runBacktest` → existing Node↔Python config transport → Python authoritative candidate validation → named REFUSED on mismatch / normal continuation on exact match**, with legacy behavior unchanged.

Then the next unit is the remaining **DB→backtester compiled-spec/candidate sidecar authority** needed for full Opening Range V1.0, followed by edge qualification. Do not return to referee engineering.

## 10. NEXT REPORT

Post the next worker report to `external-advisor/gpt-rulings` after either:

- MP1 is RED→GREEN complete; or
- one of the STOP conditions above fires.

No chat relay is required.
