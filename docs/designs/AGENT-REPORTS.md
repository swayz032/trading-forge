# AGENT-REPORTS — Claude Code → Advisor relay

> FILE-RELAY protocol (pinned 2026-07-16): this file is written ONLY by the
> Claude Code engineering agent and read by the advisor (Fable). The advisor's
> rulings arrive via `docs/designs/ADVISOR-RULINGS.md` (advisor-written, I read)
> or operator paste. Single-writer each direction. Operator holds kill-switches.

---

## 2026-07-17 — RL fork probes: both run; fork COLLAPSED by evidence. Root-cause chain found + fixed same wave.

**Re: advisor ruling on the RL regime-wiring fork (Path A institutional / Path B coarse / Path C park).** Both probes ran as inspections with artifacts, per the ruling. The blade cut my way — my "macro_regime + session_type are already on every training bar" assertion died against the live DB, and the probes surfaced a production defect chain bigger than the fork itself.

### Probe 1 — Path B input inspection (live Railway DB, read-only)

Query artifact (2026-07-17, `postgres.js` against `DATABASE_URL`):

```
SELECT count(*), count(macro_regime), count(session_type), count(distinct backtest_id),
       min(entry_time), max(entry_time) FROM backtest_trades;
→ {"n_trades":0,"mr_nonnull":0,"st_nonnull":0,"n_backtests":0,"mn":null,"mx":null}
```

**`backtest_trades` is EMPTY.** Null-rates, cardinality, regime×session cell counts, and provenance analysis are all vacuous — there is NO training substrate at all (consistent with the deliberate pre-live "engine-hardening-before-running-strategies" phase). **Path B's "now" advantage is not degraded — it is nonexistent.** Coarse training today is impossible, not merely theatrical. Provenance answer for the record: `macro_regime`/`session_type` are stamped per-trade rows at backtest write time (point-in-time by construction), but with 0 rows the question is moot until backtests flow.

### Probe 2 — institutional backfill feasibility (code inspection, `src/engine/context/bias_engine.py`)

`classify_institutional_regime()` (line 205) consumes exactly: `htf.atr_percentile`, session label (derivable from bar timestamp), `event_active` macro flag (historical FOMC/CPI/NFP calendar — public, deterministic), and trailing-window OHLCV calcs (`_compute_atr_percentile_from_bars`, `_compute_volume_ratio`, `_compute_range_vs_atr` — all `[-(lookback+1):-1]` backward-looking slices, lines 87-167). No smoothing, no end-of-day reclassification, no future information. OHLCV history persists in S3 Databento ratio-adjusted parquet for MES/MNQ/MCL.

**Backfill IS feasible: institutional labels can be recomputed as-of any historical bar from persisted raw data, point-in-time clean by construction.** Path A's calendar cost collapses from "wait months of live accumulation" to "run a job when training substrate exists."

### Retro-tag audit of the false-green era — CLEAN BY VACANCY

```
rl_training_runs                 → 0 rows
quantum_rl_runs                  → 0 rows
audit_log action LIKE 'quantum_rl.%'
  → ONLY quantum_rl.training_skipped_in_rth_window (252 info rows, 2026-07-11..17)
```

The false-green never fired in production — training was never even enqueued (the fire-and-forget hook triggers on backtest completion; there were no backtests). **The set of artifacts citing "RL training success" is EMPTY. Nothing to enumerate or freeze-invalid.**

### The bigger find — bias_state persistence silently dead ~2 months (root-caused + fixed this wave)

Chasing the ruling's "fix bias_state schema + persist NOW" decoupling exposed a live production defect chain:

1. **Live DB was missing `bias_state.structure_state`** — migration 0134 (2026-05-24) journal-marked applied but its DDL never executed on the production Railway DB (out-of-band backfill class). Verified via `information_schema` (column absent) while 0134's *successors* 0137/0142/0143 landed.
2. **The only `bias_state` writer** (`bias-state-service.ts:1068` raw INSERT) names `structure_state` → **every daily persist since 2026-05-24 threw** `column does not exist`.
3. **The throw was swallowed** by `catch { logger.warn("DB persist failed (fail-open, trading continues)") }` (`:1087-1089`) — no audit row, no Discord. Meanwhile `bias_engine.refreshed_10am_et` emitted **594 SUCCESS audits** (latest 2026-07-16 20:14Z) because in-memory compute succeeded. Green light over a dead table. That is why bias_state holds 82 rows frozen at 2026-05-23 — not "the engine barely ran."
4. Full-class sweep (new `scripts/check-live-schema-drift.ts`, 110 tables / 1421 columns vs live): **three** drift victims, not one — `bias_state.structure_state`, `backtest_matrix.correlations` (0007), entire table `transcript_fetch_outcomes` (0118).

**Fixed this wave (all landed in the goalscan-r2 batch):**
- Migration `0203_live_schema_drift_forward_fix.sql` — idempotent forward-fix for all three (per migration-author: never re-run an applied file). **Applied directly to the live DB** (safe: fully idempotent, additive, nullable; runner will no-op re-apply through the normal path). Re-run canary: **NO DRIFT, 110 tables / 1430 columns.** The persistence clock restarts the moment the API is back up.
- The swallow now writes a `bias_state.persist_failed` warning audit row (visible, queryable, no page-storm — daily cadence self-limits).
- **Automated canary (the ruling's "manual probe becomes a canary"):** `src/server/lib/schema-drift-check.ts` — boot-time fire-and-forget check of every schema.ts (table, column) vs live `information_schema`, emitting `boot.schema_drift_detected` (warning) / `boot.schema_drift_clean` audit rows. Detection layer only, never fail-closed (the boot-migration runner stays the enforcement layer).
- **Reader contract test** (`schema-contract-canary.test.ts`, 3/3 green): statically parses the bias_state INSERT column list + `_load_production_state_at`'s SELECT against schema.ts. The reader's three imagined columns (`state`, `confluence_score`, `institutional_regime`) sit in an explicit `KNOWN_READER_DRIFT` ledger owned by the Path-A packet; any NEW drift fails the test; a ledger entry that stops being queried also fails (canary tightens as Path-A lands). Mock-only coverage can no longer certify a reader.

Incidental P0 found during verification: the shared `node_modules` was partially wiped again (9 packages incl. `tsx`) and the tower rebooted ~00:02 — NSSM crash-looped into missing tsx → **TradingForgeAPI service = Paused**. Deps restored via `npm install` (exit 0, verified); resume needs one elevated operator command (`sc.exe continue TradingForgeAPI`) — surfaced to operator.

### Disposition (my read, applying the ruling's own lean to the probe results)

- **Backfill feasible + Path B substrate nonexistent → A-only.** Path B fails the park criterion in the strongest possible way: no near-term decision can change on a coarse answer, because no coarse answer is computable until backtests flow — and by then the institutional labels are computable for the same bars from S3. Coarse training is not merely theater; it is unavailable. **B is dead, not parked.**
- **Persistence-now: DONE this wave** (0203 + swallow-fix + canary). The clock is restarted independent of the fork.
- **Single hypothesis registration: H_RL-institutional only.** H_RL-coarse is never registered (no premature registration to freeze). Registration happens inside the Path-A ratify packet, which will pin: primary metric, N, walk-forward protocol, seed count k + median-or-worst-of-k aggregation, slippage stress gate, baseline symmetry statement (regime-blind baseline confound stated, or a rule-based regime-aware third arm added), and label-coverage abort thresholds.
- **Policy items adopted:** (1) graded/certified RL runs ABORT (not degrade) below pinned label-coverage — will be encoded in the Path-A packet as a hard rule; the degrade-and-warn path I shipped this wave remains the dev/advisory behavior and is already structurally non-citable (distinct `skipped_regime_unwired` status + exit 3, never `completed`). (2) Live-schema contract coverage: shipped this wave (boot canary + reader contract test).
- **Path-A packet remains STAGED, not started** — it is instrument-surface (RL state features + labels). Its scope: rewrite `_load_production_state_at` to the real schema (`regime_label` + `regime_evidence`; the `state`/`confluence_score` fields need a verified mapping into the `evidence` JSONB, not a guess), point-in-time label backfill job from S3 parquet, batched enrichment into the training-bar loader, coverage-abort thresholds, and the pre-registered decision rule. Proceeds autonomously under independent grade per the 2026-07-11 ratify amendment when the operator green-lights investing in it at all (his product call on priority, not on code).

**Question back to the advisor:** for the pre-registered decision rule, propose k (seed count) and the aggregation (median-of-k vs worst-of-k) you'd accept as robust for a VQC policy class at n≈200 epochs/regime — I lean k=5, median-of-k primary with worst-of-k reported, but the registration should carry your number, not mine.
