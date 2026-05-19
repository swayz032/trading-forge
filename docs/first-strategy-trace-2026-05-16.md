# First-Strategy Lifecycle Trace — Wave 5

**Session:** 2026-05-16 (Production Hardening Wave 5)
**Operator:** swayz032
**Mission:** Validate Wave 1-4 hardening fixes against a single real strategy walked through as much of the lifecycle as one session permits.

---

## 1. Strategy chosen

| Field | Value |
|---|---|
| **id** | `3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431` |
| **name** | `trend_mes_ema921_pullback` |
| **symbol** | `MES` |
| **timeframe** | `5m` |
| **source** | `graduated_bucket` |
| **lifecycle_state at session start** | `CANDIDATE` |
| **created_at** | `2026-05-11T21:47:18.538Z` |
| **preferred_regime** | `TRENDING_UP` |
| **tags** | `cross-validated`, `dsl-compiled`, `3-source-consensus` |
| **framework overlay** | Style D applied — ATR(1.5x) floor stop, Chandelier(14,2) trail, BE+1tick on TP1, 15:55 ET time stop, RTH_ONLY, profit_tier_pyramid (base 4 MES, +2/$3K, max 6 in this config) |

The originally suggested ID prefix `c34d62fc` no longer exists; this `3e6e94d6` strategy has the exact name from the Pass 21 verification record and the canonical framework overlay, so it is the correct successor.

## 2. Correlation IDs traced

| Run | correlation_id (X-Request-ID) | backtest_id |
|---|---|---|
| #1 (pipeline paused — no DB writes) | `45c67d49-4600-4e62-9410-a1aa05f5d268` | `34a6b3f1-ffa7-48c5-b210-1ad5adb9b265` (never persisted) |
| #2 (pipeline active) | `447a8d23-dbf3-4b9b-93cb-bd5ac888c394` | `1160688d-5242-4a7d-beca-f16d621b3bee` |

## 3. Pre-flight environment findings (Wave 5 baseline observations)

These were captured before the backtest fired:

- **`lifecycle_transitions` is EMPTY across the entire database** (not just for this strategy). No strategy has ever transitioned. This is a direct consequence of the pipeline having been paused — every cron-driven lifecycle promotion path is gated by `isPipelineActive()` and there has been no manual promotion API traffic against the surviving graduated strategies.
- **Global `audit_log.correlation_id` population over last 7 days: 21.2% (1617/7641 rows).** Wave 1's "5 missing call sites" fix only patched the specific HTTP-entry sites it named; many cron-driven, scheduler-driven, and dedupe-sweep code paths still write `correlation_id: null`. The recently-discovered `strategy.archived_rule_identity_duplicate` sweep is one of these.
- **Zero rows globally for the Wave 2 audit actions** `gate.frankenstein.evaluated`, `pilot.auto_promotion.evaluated`, `lifecycle.promotion_allowed_signal_correlation`. Those code paths are wired correctly, but no strategy has reached them yet because the lifecycle has not flowed.
- **Pipeline mode at session start: `PAUSED`.** Resumed via `POST /api/admin/pipeline/start` at session start.

These are NOT Wave 1-4 regressions; they are the inevitable consequence of a paused pipeline that has never carried a strategy through promotion. They become actionable in Phase B when a real strategy walks the loop.

## 4. Backtest run #2 — verified surfaces

### 4.1 HTTP entry → DB row
- Request returned `202 Accepted` with `X-Request-ID: 447a8d23-dbf3-4b9b-93cb-bd5ac888c394` (correlation_id surfaced in header per `correlationMiddleware`).
- `backtests` row inserted within <2s as `status='running'` — confirms `runBacktest()` reached `db.insert(backtests).values({ status: "running" }).returning()` at `backtest-service.ts:315-327`.
- No early-return on pipeline gate this time (pipeline ACTIVE).

### 4.2 Wave 1 commission lock — VERIFIED in code
`src/engine/backtester.py:1655-1684` — the only point of per-trade dollar P&L computation:
```python
comm_cost = commission * size * 2   # roundtrip
net_pnl   = gross - slip_cost - comm_cost
```
Commission constants (`firm_config.py:19-26`): Topstep_50k MES = $0.37/side ($0.74 RT); MFFU_50k MES = $0.62/side ($1.24 RT). Per CLAUDE.md §13 "Don't pass slippage/fees to vectorbt" — verified: vectorbt is never given a `fees` kwarg, P&L is computed manually here.

### 4.3 Wave 1 audit row — to be verified post-completion
On successful completion the transactional write at `backtest-service.ts:573-587` will insert:
```
action: "backtest.run"
entityType: "backtest"
entityId: <backtest_id>
correlationId: 447a8d23-dbf3-4b9b-93cb-bd5ac888c394
status: "success"
```
If completed at end of session, the trace post-script will populate the metrics here. If running past time-box, the row should be visible by SELECT on `audit_log WHERE correlation_id = '447a8d23-...'` in the next operator check.

### 4.4 Mini-guard (Wave 1) — N/A but verified safe
Strategy symbol is `MES` (micro), not `ES` (mini). The two-layer guard (Python Pydantic Literal + TS pre-check in agent-service.ts) is not exercised by this run — and that is correct: it was never supposed to trip on framework-overlaid graduated strategies. If it had tripped, that would be a bug.

## 5. Lifecycle promotion — not exercised this session

The promotion path (`PATCH /api/strategies/:id/lifecycle`) was NOT exercised in this session because:
1. The backtest is still running at session time-box.
2. Promotion CANDIDATE → TESTING is automatic via `auto-check` cron (which only fires when the backtest completes AND tier thresholds are met).
3. Promotion TESTING → PAPER requires Frankenstein to have run and passed.

The Wave 2 audit rows therefore cannot be observed under this correlation_id in this session. They become observable when the strategy crosses TESTING → PAPER (Frankenstein audit row) and PAPER → DEPLOY_READY (A7 ramp_up_mode audit row), which Phase B covers.

## 6. SSE / frontend wiring — code-verified, not runtime-verified

`useSSE.ts:555-588` correctly handles `lifecycle:gate_evaluated`. Cannot intercept SSE in a script-only session; would require browser-side observation in Phase B.

## 7. HMAC retry — not exercised, no false-positive

Pine export to family was NOT invoked in this session. Wave 4 HMAC retry policy (3 attempts at [250, 1000, 4000] ms) is therefore not exercised. The path is fail-OPEN safe (secret always returned in-memory) so absence of exercise is fine.

## 8. Audit chain reconstruction test

For correlation_id `447a8d23-dbf3-4b9b-93cb-bd5ac888c394` the chain WILL be (once the backtest completes):
- HTTP entry: implicit (X-Request-ID set by `correlationMiddleware`)
- `backtests.id=1160688d-…` row, status `running` → `completed`
- `audit_log` row: `action='backtest.run'`, `status='success'`, `correlationId='447a8d23-…'`

That single correlation_id will let a future operator reconstruct: which strategy ran, when, with what config, what tier, and what gates fired — satisfying the §2 "90-day reconstruction" requirement for this slice of the lifecycle.

## 9. Findings (carry-forward to next session)

1. **`lifecycle_transitions` schema lacks `correlation_id` column.** Every other audited table (`audit_log`) has it; this table does not. Adding it is a small migration but architecturally important — the §2 reconstruction promise breaks at lifecycle transitions.
2. **Global audit `correlation_id` population is 21.2%.** Wave 1 patched 5 specific call sites; the remaining ~79% of audit writes (cron, sweepers, scheduler-driven jobs) still write null. Mass migration to `insertAuditRow()` (the Wave 4 helper) was a known Wave 5 carry-forward and remains carry-forward.
3. **`strategy.archived_rule_identity_duplicate` writes 6+ rows with null correlation_id on a single sweep.** Drift identified during this session; should adopt the helper.
4. **The 2026-05-11 historical backtest for this strategy failed with sentinel string** `"backtest-engine failed: All 7 context layers imported and callable."` That string is the SUCCESS banner at `backtester.py:3579`. The Python process exited non-zero AFTER printing the banner, and the Node runner reports the last stderr line. Not blocking Wave 5 but worth a future investigation; if the engine consistently exits non-zero with that banner as the last line, the actual stack trace is being swallowed.

## 10. Wave 5 result

- Backtest fired with propagated correlation_id ✓
- `running` row landed in DB ✓
- Wave 1 commission lock visible at backtester.py:1655-1684 ✓
- Mini-guard not tripped (correctly — MES) ✓
- All 3 CI hard gates GREEN (`production-isolation`, `2026-compliance`, `system-map:check` exit 0) ✓
- Lifecycle promotion path NOT walked this session — Phase B carry-forward
- Frankenstein audit + A7 ramp_up_mode audit NOT yet observable in DB — Phase B carry-forward
