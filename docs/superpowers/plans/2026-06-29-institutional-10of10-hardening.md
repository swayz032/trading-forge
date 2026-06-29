# Institutional 10/10 Hardening — Zero Carry-Forward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding from the 2026-06-29 7-auditor institutional audit so the backtest engine, lifecycle/wiring, paper engine, observability, autonomy, n8n, and the algo blueprint all reach a *verified* 10/10 with no carry-forwards and no leftover bugs.

**Architecture:** Four prioritized waves (P0 capital-safety → P1 trust/silent-pass → P2 blueprint robustness → P3 orchestration/tooling) executed in an **isolated git worktree** off `hardening/phase-0`, each finding closed with a failing test first, real fix, green verification, and an incremental commit. A final WAVE 5 re-runs all CI gates, the full test suites, the new parity CI checks, AND re-dispatches the 7 auditors to prove zero remaining findings before merge.

**Tech Stack:** TypeScript (Node/Express + Drizzle ORM), Python 3 (vectorbt/Polars engine), Postgres (pglite for gate-chain integration tests), vitest, pytest, n8n REST (Railway), Prometheus, Discord notify.

---

## Ground Rules (read before Task 1)

1. **Isolated worktree, not the shared tree.** Two sessions + carter share `hardening/phase-0`. Create `git worktree add .worktrees/inst-10of10 -b hardening/inst-10of10-2026-06-29 hardening/phase-0` and junction `node_modules`. Never `git add -A`; commit by explicit path (`git commit -- <paths>`).
2. **Commit-and-push after every GREEN task** (HARD RULE §11a). Disk failure is not predictable; the commit is.
3. **3 CI hard gates must stay green** after every task: `npm run check:production-isolation`, `npm run check:2026-compliance`, `npm run system-map:check`.
4. **Engine tests must mock vectorbt** — bare import of any module pulling the vectorbt-JIT backtester HANGS under pytest collection on the tower.
5. **audit_log contract:** columns are `input`/`result` (no `payload`), `status` is NOT NULL, table is append-only (INSERT only).
6. **Pins that are NOT bugs** (do not "fix" these): 0-backtests/all-CANDIDATE is intentional; Topstep-only (MFFU not a blocker); Style C 33/33/34 canonical / Style D dead; CPCV `cpcv_exempt` deliberate; HTF MTF +1 shift is correct; B14 ci_high=0.20 correct; vectorbt kept.
7. **System Map sync** (`npm run system-map:sync`) + AGENT-LOGS entry after each wave.

---

## File Structure (what each touched file is responsible for)

| File | Responsibility | Waves |
|---|---|---|
| `src/server/production/kill-switch.ts` | Halt layers L1–L9; must notify Discord on every autonomous halt | P0 |
| `src/server/services/lifecycle-service.ts` | Promotion gate sequencing; collapse cron onto shared fail-closed evaluator | P0/P1 |
| `src/server/lib/paper-to-deploy-ready-gates.ts` | Single canonical PAPER→DEPLOY_READY gate evaluator (becomes sole truth) | P0 |
| `src/server/lib/testing-to-paper-gates.ts` (NEW) | Single canonical TESTING→PAPER gate evaluator (extracted from cron inline) | P0 |
| `src/server/services/paper-execution-service.ts` | Runner trail math — reconcile AVWAP/Chandelier cushion with Python | P0 |
| `src/server/services/paper-signal-service.ts` | TP2 target + BE+1 timing parity; daily-cap leg counting | P0 |
| `src/server/services/backtest-service.ts` | `WalkForwardResultsInput` type must lock every WF JSONB key | P1 |
| `scripts/check-ts-python-wf-metadata-parity.ts` (NEW) | CI gate: WF-metadata key parity Python↔TS | P1 |
| `src/server/lib/paper-risk-gate.ts`, `correlation-service.ts`, `agent-coordinator-service.ts` | Durable audit rows on every hard-gate block | P1 |
| `src/server/routes/live-order.ts`, `src/server/routes/strategies.ts` | Sunset strategy_id-omission exemption; forward correlationId | P1 |
| `src/server/__tests__/gate-chain-integration.test.ts` | Add WRC/SPA orchestrator + W24 DSR + cron-path coverage | P1 |
| `src/engine/walk_forward.py`, `src/engine/statistics/backtest_inflation_factor.py` | True per-path IS Sharpe → BIF reliable in CPCV mode | P2 |
| `src/engine/backtester.py` | Flip Style-C partials default ON after parity validation | P2 |
| `src/engine/statistics/cscv_gate.py` (NEW) | CSCV parameter-snooping audit over confluence weights + decay half-lives | P2 |
| `src/server/services/strategy-decay-monitor-service.ts` (NEW) | Rolling-Sharpe z-score within-regime decay monitor cron | P2 |
| `src/server/scheduler.ts` | AbortSignal on hung jobs; off-RTH crash auto-restart | P3 |
| `src/server/lib/killzone.ts` | Loud signal on NaN-timestamp bars | P3 |
| `workflows/n8n/*.json` + REST | DR backup for 10 complex dormant workflows; dead-model dependency guard | P3 |

---

# WAVE P0 — Capital-Safety & Silent-Failure (do first)

### Task 1: Kill-switch Layers 3–9 must fire Discord on halt (C-1)

**Files:**
- Modify: `src/server/production/kill-switch.ts` (`_emitLayerHaltedSignals`, ~876-916)
- Test: `src/server/__tests__/kill-switch-layer-halt-notify.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const notifyCritical = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/notification-service.js", () => ({ notifyCritical }));
vi.mock("../db/index.js", () => ({ db: { insert: () => ({ values: () => ({ catch: () => {} }) }) } }));

import { _emitLayerHaltedSignals } from "../production/kill-switch.js";

describe("kill-switch autonomous layer halt notification", () => {
  beforeEach(() => notifyCritical.mockClear());

  it.each([3, 4, 5, 6, 7, 8, 9])("Layer %i halt fires a CRITICAL Discord with a family-grade postscript", async (layer) => {
    await _emitLayerHaltedSignals(layer, { reason: "test_reason", correlationId: "cid-1" });
    expect(notifyCritical).toHaveBeenCalledTimes(1);
    const [, body] = notifyCritical.mock.calls[0];
    expect(String(body)).toMatch(/layer/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/__tests__/kill-switch-layer-halt-notify.test.ts`
Expected: FAIL — `notifyCritical` called 0 times (only audit + SSE today).

- [ ] **Step 3: Read the current emitter, then add the notify call**

Read `kill-switch.ts:876-916`. After the existing audit-row write and SSE broadcast inside `_emitLayerHaltedSignals`, add (mirror the Layer-1 `setMode("HALT")` notify at ~1056):

```typescript
// C-1 (2026-06-29): autonomous halt layers L3–L9 were SSE+audit only — no phone alert.
// A mid-vacation CME outage (L6) or Topstep suspension (L7) halted silently. Wire CRITICAL.
const LAYER_LABELS: Record<number, { name: string; action: string }> = {
  3: { name: "Trailing drawdown breach", action: "Check account equity vs trailing limit." },
  4: { name: "Broker/exchange connectivity lost", action: "Connectivity issue — usually self-heals; verify broker login." },
  5: { name: "Policy drift", action: "A live rule drifted from the 2026 firm doc — review compliance." },
  6: { name: "CME exchange outage", action: "Exchange is halted — bot resumes automatically when CME is back." },
  7: { name: "Topstep firm suspension", action: "Topstep flagged the account — log in to Topstep and check status." },
  8: { name: "Macro crisis regime", action: "Crisis regime detected — entries paused until conditions normalize." },
  9: { name: "Windows reboot pending", action: "A reboot is pending — bot paused pre-market for safety." },
};
const meta = LAYER_LABELS[layer];
if (meta) {
  await notifyCritical("kill_switch_layer_halt", {
    title: `Bot HALTED — ${meta.name} (Layer ${layer})`,
    body: appendFamilyGradePostscript(
      `New entries are stopped. Reason: ${reason ?? meta.name}. Plain-English: ${meta.action}`,
    ),
    correlationId,
  }).catch((e) => logger.error({ err: e, layer }, "kill_switch layer-halt notifyCritical failed"));
}
```

Ensure `notifyCritical` and `appendFamilyGradePostscript` are imported at the top of the file (check existing imports first; add only if missing).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/__tests__/kill-switch-layer-halt-notify.test.ts`
Expected: PASS (7/7 parametrized cases).

- [ ] **Step 5: Make the kill-switch audit writes durable (MED-4, same file)**

Within `_emitLayerHaltedSignals` and the mode-change paths, the `audit_log` inserts use `.catch(err => logger.error(...))` fire-and-forget. Change each halt-event audit insert to `await` so a transient DB failure during a halt does not produce a `system_state` row with no audit spine. Keep the SSE broadcast non-blocking.

- [ ] **Step 6: Commit**

```bash
git add src/server/production/kill-switch.ts src/server/__tests__/kill-switch-layer-halt-notify.test.ts
git commit -- src/server/production/kill-switch.ts src/server/__tests__/kill-switch-layer-halt-notify.test.ts \
  -m "fix(kill-switch): CRITICAL Discord + durable audit on autonomous halt layers L3-L9 (C-1, MED-4)"
git push origin hardening/inst-10of10-2026-06-29
```

---

### Task 2: Collapse the cron promotion path onto the shared fail-closed evaluator (H-1 + architect F1)

This single refactor kills BOTH the dual-path drift (highest-recurrence defect site) AND the cron fail-open asymmetry — because the shared evaluator already fails CLOSED on infrastructure error (`lifecycle-service.ts:666`).

**Files:**
- Create: `src/server/lib/testing-to-paper-gates.ts` (extract the TESTING→PAPER gate stack as a pure evaluator)
- Modify: `src/server/services/lifecycle-service.ts` (`checkAutoPromotions` — replace inline gate blocks with evaluator calls; remove `skipPaperToDeployReadyEvaluator:true`)
- Modify: `src/server/lib/paper-to-deploy-ready-gates.ts` (confirm it is the sole PAPER→DEPLOY_READY truth)
- Test: `src/server/__tests__/cron-gate-fail-closed.test.ts` (Create) + extend `gate-chain-integration.test.ts`

- [ ] **Step 1: Write the failing test (fail-closed on exception, both paths identical)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { evaluateTestingToPaperGates } from "../lib/testing-to-paper-gates.js";

describe("TESTING→PAPER evaluator fails CLOSED on gate exception (parity with manual path)", () => {
  it("WFE/param-drift/DSR/BIF evaluation throw → promotion BLOCKED, not continued", async () => {
    const throwing = { /* shaped input that makes the WFE reader throw */ } as any;
    const result = await evaluateTestingToPaperGates(throwing, { simulateGateThrow: "wfe" });
    expect(result.passed).toBe(false);
    expect(result.blockedBy).toBe("wfe_infrastructure_error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/__tests__/cron-gate-fail-closed.test.ts`
Expected: FAIL — `evaluateTestingToPaperGates` does not exist yet.

- [ ] **Step 3: Extract the TESTING→PAPER gates into the pure evaluator**

Read `lifecycle-service.ts` cron `checkAutoPromotions` Gate-2 block (~2334-3060). Move the gate sequence (backtest-stale, MC survival, compliance, survival-score, Pine exportability, **B14 CI**, **WFE**, **param-drift**, **DSR**) into `testing-to-paper-gates.ts::evaluateTestingToPaperGates(input)`, mirroring the structure of `paper-to-deploy-ready-gates.ts`. **Every gate exception path returns `{ passed:false, blockedBy:"<gate>_infrastructure_error" }`** — fail CLOSED, matching the manual path's outer catch at `:666`. Keep the exact threshold semantics (B14=0.20, WFE=0.70, PBO=0.15, etc.).

- [ ] **Step 4: Rewire `checkAutoPromotions` to call the evaluators**

In `checkAutoPromotions`: replace the inline TESTING→PAPER blocks with `const r = await evaluateTestingToPaperGates(input); if (!r.passed) { /* audit + counter + continue */ }`. Remove `skipPaperToDeployReadyEvaluator:true` from the cron's `promoteStrategy` call so PAPER→DEPLOY_READY runs the SAME `evaluatePaperToDeployReadyGates` the manual path uses (which fails closed at `:666`). Delete the now-dead inline PAPER→DEPLOY_READY blocks (DSR `:4140`, BIF `:4232`) — the evaluator owns them.

- [ ] **Step 5: Run tests + the gate-chain integration suite**

Run: `npx vitest run src/server/__tests__/cron-gate-fail-closed.test.ts src/server/__tests__/gate-chain-integration.test.ts`
Expected: PASS. Add a gate-chain suite asserting the cron path and manual path produce identical block decisions on the same inputs (closes "no pglite coverage: cron promotion path end-to-end").

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/testing-to-paper-gates.ts src/server/services/lifecycle-service.ts src/server/lib/paper-to-deploy-ready-gates.ts src/server/__tests__/cron-gate-fail-closed.test.ts src/server/__tests__/gate-chain-integration.test.ts
git commit -- <those paths> -m "refactor(lifecycle): single fail-closed gate evaluator for both manual + cron paths (H-1, F1) — kills dual-path drift + cron fail-open"
git push origin hardening/inst-10of10-2026-06-29
```

---

### Task 3: Paper ↔ Backtest exit-mechanic parity (H-2 / F-1..F-5)

All four sub-tasks reconcile a paper exit calc with the Python backtester so the paper Sharpe that gates promotion matches what the strategy actually does.

**3a — AVWAP runner trail cushion (CRITICAL parity).**
- `paper-execution-service.ts:4150` trails at `avwap − (ATR_TRAIL_CUSHION_MULTIPLIER × atrAtEntry)`; `backtester.py:1555` trails at `avwap_price − tick`.
- [ ] Write a parity test fixture (one MES position, anchored_vwap runner) asserting paper trail == backtest trail within 0.01. Run → FAIL.
- [ ] Decide canonical: **adopt the Python `± tick` cushion in paper** (the backtest is the validation source of truth). Change `paper-execution-service.ts:4150-4151` to `const cushion = TICK_SIZES[pos.symbol]; computedTrail = pos.side === "long" ? avwap - cushion : avwap + cushion;`. Run test → PASS.

**3b — TP2 liquidity-snap divergence (HIGH).**
- `paper-signal-service.ts:2010-2039` snaps TP2 to nearest intraday liquidity in [1.4R,2.6R]; `backtester.py:931` uses flat `entry + 2.0×risk`.
- [ ] Write parity test → FAIL. Resolve by adding the SAME liquidity-snap to the Python backtester's adaptive path (so backtest reflects the live TP2), gated behind the existing adaptive-exit flag; OR, if liquidity injection is paper-only by design, disable the snap when `exit_style != "adaptive"` so static_styleC paper matches static backtest. Choose the adaptive-path alignment (preserves the institutional edge). Run → PASS + add to `check:ts-python-exit-parity`.

**3c — Chandelier ATR reference (MED).**
- paper uses `atrAtEntry` (`:4182`); backtest uses current-bar `atr_at_bar` (`:1563`).
- [ ] Parity test → FAIL. Adopt current-bar ATR in paper chandelier (thread `exitBarContext.atrCurrent[symbol]` with `atrAtEntry` fallback). Run → PASS.

**3d — BE+1 same-bar timing + daily-cap leg counting (MED).**
- [ ] Test: a large-wick bar that touches TP1 and dips to entry+1tick must NOT close the runner same-bar in paper (match backtest stop-before-TP1 ordering). Reorder `paper-trading-stream.ts:335,341` so the BE stop activates bar N+1. Run → PASS.
- [ ] Test: a single 3-contract Style C trade (3 partial rows) counts as ONE trade against `TF_MAX_TRADES_PER_DAY`. Change the cap query in `paper-signal-service.ts:3386-3393` to `count(distinct entry_correlation_id)` (or count opening legs only). Run → PASS.

- [ ] **Commit (one per sub-task, push after each):**
```bash
git commit -- <paths> -m "fix(paper-parity): AVWAP trail cushion = tick to match backtest (F-1)"
# ...3b/3c/3d similarly
git push origin hardening/inst-10of10-2026-06-29
```

---

# WAVE P1 — Trust / Silent-Pass Closure

### Task 4: Lock the Python→TS WF-metadata contract + parity CI (H-3, F-3, F-8)

**Files:**
- Modify: `src/server/services/backtest-service.ts` (`WalkForwardResultsInput` — add every WF JSONB key)
- Create: `scripts/check-ts-python-wf-metadata-parity.ts` + wire into `package.json` as `check:wf-metadata-parity`
- Modify: `.github`/CI runner config (add the new check to the hard-gate set if CI config is in-repo)
- Test: `src/server/__tests__/wf-metadata-parity.test.ts`

- [ ] **Step 1: Failing test** — assert `WalkForwardResultsInput` contains `wfe_overall`, `pbo_overall`, `dsr_pass`, `b15_battery.passed`, `bif`, `k_eff`, `wf_metadata.*` keys, and that a Python-side key list (parsed from `walk_forward.py` output dict literals) is a subset of the TS keys. Run → FAIL.
- [ ] **Step 2: Add the missing keys** to `WalkForwardResultsInput` (notably `pbo_overall?: number | null`, the F-8 gap) so a Python rename breaks the TS build at the lifecycle reader (`:1232`).
- [ ] **Step 3: Write `check-ts-python-wf-metadata-parity.ts`** — greps `walk_forward.py` for the keys it writes into the results dict + `wf_metadata`, greps `backtest-service.ts` `WalkForwardResultsInput` + `WfResultsShape`, fails non-zero on any key present in Python but absent in TS (the six grandfather-pass patterns: `wfe_*`, `pbo_*`, `dsr_*`, `b15 battery_*`). Run → PASS.
- [ ] **Step 4: Add `"check:wf-metadata-parity": "tsx scripts/check-ts-python-wf-metadata-parity.ts"`** to `package.json` and add it to the CI hard-gate list. Run all gates → green.
- [ ] **Step 5: Commit + push.**

### Task 5: Durable audit rows on every hard-gate block (observability HIGH cluster + MED-2/MED-3)

**Files:** `paper-risk-gate.ts:146-328`, `correlation-service.ts:85-91`, `agent-coordinator-service.ts:145-153`, `agent-service.ts:1092`, `routes/strategies.ts:767`, `mcl-pre-eia-stop-tighten-service.ts:248/269/287`, `cohort-audit-report-service.ts:381-382`.

- [ ] For each: write a test asserting an `audit_log` row is written (awaited, not fire-and-forget) on the block/event. Run → FAIL.
- [ ] Add `await insertAuditRowSafe({...})` to each block path (6 paper-risk-gate reasons, A7 breach, agent-domain-down, C9 feature-vector write, post-deploy block, MCL pre-EIA). Replace bare `.catch(()=>{})` on safety-relevant audit writes with `.catch(err => logger.error)` + a `tf_audit_write_failures_total` counter.
- [ ] Fix MED-3: change `cohort-audit-report-service.ts:381-382` action names to `"sizing.dll_force_close"` / `"sizing.dll_force_close_completed"` (match what kill-switch actually writes). Test asserts the count is non-zero when those rows exist.
- [ ] Run → PASS. Commit + push.

### Task 6: Sunset the live-order strategy_id exemption + forward correlationId (MED, F-1/F-2 accuracy)

**Files:** `routes/live-order.ts:549`, `routes/strategies.ts:630/697`.

- [ ] Test: a routed order WITHOUT `strategy_id` is rejected unless an explicit `raw_order_capability:true` (operator-signed) field is present. Run → FAIL.
- [ ] Replace the silent `if (strategy_id)` exemption with: require `strategy_id` OR an explicit operator-capability flag; reject (409 `missing_lifecycle_context`) otherwise. Run → PASS.
- [ ] Test: PATCH `/lifecycle` + POST `/deploy` forward `req.id` as `correlationId` into `promoteStrategy`. Thread `correlationId` through `_promoteStrategyInner`. Run → PASS. Commit + push.

### Task 7: Close the pglite coverage gaps (F-4, F-5, F-6)

**File:** `src/server/__tests__/gate-chain-integration.test.ts`.

- [ ] Add a suite that actually CALLS `evaluateWrcGate` / `evaluateSpaGate` from `promotion-gate-orchestrator.ts` against pglite rows (assert fail-CLOSED on null, pass on valid) — closes F-4 (round-trip-only today).
- [ ] Add a W24-DSR suite reading `resultExtras.invariants.dsr_honest.dsr_passed` (the second DSR implementation, `lifecycle-service.ts:1383`) — closes F-5.
- [ ] Add a `bif` numeric-coercion suite: insert a `numeric` bif that Drizzle returns as a JS string, assert the gate `Number()`-coerces before compare — closes F-6; add a one-line `// numeric() returns string — always Number() before compare` doc-comment at every bif consumer.
- [ ] Run → PASS. Commit + push.

---

# WAVE P2 — Blueprint Robustness (the 8 → 10 path)

### Task 8: True per-path IS Sharpe → BIF reliable in CPCV mode (H-4, kills the "Wave-30 carry-forward")

**Files:** `src/engine/walk_forward.py` (CPCV path), `src/engine/statistics/backtest_inflation_factor.py`.

- [ ] pytest (vectorbt MOCKED): a CPCV run with a deliberately inflated IS edge produces `bif > 4.0` and `bif_reliable=true`. Run → FAIL (today BIF≈1.0, `bif_reliable=false`).
- [ ] In the CPCV path, for each of the `C(6,2)=15` path splits, run a separate IS backtest on the complement folds to obtain a TRUE per-path IS Sharpe; pass `is_sharpe = mean(true_is_path_sharpes)` to `compute_bif()`; set `bif_reliable=true`, drop the `bif_proxy_basis="oos_mean_not_is"` sentinel. Reuse the existing seed plumbing; cache fold backtests to bound the 2× compute. Run → PASS.
- [ ] Remove the BIF `cpcv_unmeasured` advisory branch in `lifecycle-service.ts` (now that BIF blocks for real in CPCV mode). Run the gate-chain BIF suite → PASS. Commit + push.

### Task 9: Parity-validate then default Style-C partials ON (H-5)

**Files:** `src/engine/backtester.py:866`.

- [ ] pytest: backtester static-C path with `BACKTEST_STATIC_C_PARTIALS_ENABLED` unset produces the SAME tp1/tp2/runner economics as the paper engine's 33/33/34 on a shared fixture. Run → FAIL (default single-TP today).
- [ ] Run the existing A/B parity harness (`scripts/wave25_exit_engine_ab_report.py`) to confirm the 33/33/34 path matches paper within the 3-rule non-regression gate; fix any divergence surfaced. Flip the default to ON. Run → PASS.
- [ ] Re-run a representative backtest set; confirm Sharpe/WFE/PF now reflect 33/33/34. Commit + push.

### Task 10: CSCV parameter-snooping audit on the 11-factor weights + decay half-lives (blueprint #1 gap)

**Files:** Create `src/engine/statistics/cscv_gate.py`; wire an advisory gate at confluence-weight promotion in `lifecycle-service.ts`; add `scripts/run-cscv-confluence-audit.ts`.

- [ ] pytest (pure-functional, no vectorbt): `compute_cscv_pbo(performance_matrix)` implements Bailey/López de Prado CSCV (combinatorially symmetric splits of the IS/OOS configuration grid) and returns `pbo` ∈ [0,1] for a synthetic overfit grid (asserts high pbo) and a robust grid (asserts low pbo). Run → FAIL → implement → PASS.
- [ ] Build the performance matrix from the 11-factor weight grid + the decay half-lives (200/150/100/80/60/5) + the 0.72 threshold across CPCV paths; `cscv_pbo > 0.5` → emit `cscv.confluence_overfit_risk` audit + block weight-set promotion (advisory at first, HARD after a 14-day evidence window — flag `CSCV_CONFLUENCE_HARD=false` default).
- [ ] `scripts/run-cscv-confluence-audit.ts` runs the audit on the current production weights and writes a markdown verdict to `docs/cscv-results/`. Run it; if pbo>0.5, the weights ARE curve-fit and must be re-derived (theory-anchored half-lives, not grid-searched). Commit + push.

### Task 11: Within-regime strategy-decay monitor (blueprint gap #2)

**Files:** Create `src/server/services/strategy-decay-monitor-service.ts`; register a daily cron in `scheduler.ts` (DST-safe double-fire, `_PIPELINE_GATE_EXEMPT`, `_tryAcquireJobLock`).

- [ ] vitest: for a DEPLOYED strategy whose rolling-63-day OOS Sharpe drops > 1σ below its historical mean *within a stable regime*, the monitor emits `strategy.edge_decay_warn`; > 2σ → `strategy.edge_decay_demotion_review` + Discord WARN (family-grade). Distinct from the regime-drift cron (which fires on regime change). Run → FAIL → implement → PASS.
- [ ] Register `strategy-decay-monitor` cron; system-map:sync. Commit + push.

### Task 12 (DECISION REQUIRED): L2 Order-Flow-Imbalance (blueprint gap #3)

This is the one item that needs an external data feed (Tradovate is L1 only; L2 OFI needs Rithmic or CQG). It is **not a code-only fix** — it is an operator decision, recorded here so it is NOT a silent carry-forward.

- [ ] **Operator decision gate (AskUserQuestion at execution time):**
  - **Option A (provision L2):** add Rithmic/CQG L2 feed; build multi-level OFI as a confluence input replacing the L1 delta/CVD proxy on MNQ first (thinnest instrument, highest L1 noise per Princeton Chen May-2026).
  - **Option B (accept L1, validated):** keep L1 delta/CVD but require Task 10's CSCV to have CLEARED the delta/volume factor weight — i.e., prove the L1 proxy is not curve-fit. Document the deliberate L1 choice in `EDGE-MECHANISMS.md`.
- [ ] Whichever is chosen, implement + test to green so there is no open "missing institutional feature." Commit + push.

---

# WAVE P3 — Orchestration & Remaining MED/LOW (zero leftover)

### Task 13: n8n DR + dead-model dependency guard

- [ ] **DR:** export the 10 complex dormant workflows (Strategy Generation Loop, Tournament, Weekly Hunt, Nightly Research, Deep Analysis, 8A, 5G/5H, 8B, Self-Correction) via REST `GET /api/v1/workflows/{id}` (read-only, `TF_N8N_API_KEY` + Railway base URL from `.env`) and commit their JSON to `workflows/n8n/` keyed by live ID (reconcile by ID, not filename). Verify `3A-workflow-backup` DB sink covers all 32.
- [ ] **Dead-model guard:** add a pre-flight node (or a route the generative workflows call first) that `GET <relay>/__ollama/api/tags` and FAILS LOUD (Discord WARN) if `deepseek-r1:14b` / `nomic-embed-text` are absent — so toggling the generative loop active can't silently partial-fail. Test the guard against the current degraded tower (only `gemma4:e2b`) → expect loud fail. Commit + push.

### Task 14: Remaining reliability MED/LOW (no leftovers)

- [ ] **Scheduler AbortSignal (MED-1):** wrap each cron job body in `Promise.race` with an AbortController; on the 30-min watchdog, `abort()` the hung coroutine BEFORE releasing the lock so the next tick can't double-instance. Test: a hung job is aborted, not duplicated. Run → PASS.
- [ ] **Off-RTH crash auto-restart (MED-5):** `runOffRthHeartbeatCheck` (`dead-mans-heartbeat-service.ts:489-544`) calls `attemptAutoRestart()` on stale (not WARNING-only). Test asserts the restart path fires. Run → PASS.
- [ ] **killzone NaN loud (MED-6):** `killzone.ts:159/186/205` — on `isNaN(etMin)`, increment a `tf_killzone_nan_timestamp_total` counter + `logger.warn` before returning false. Test → PASS.
- [ ] **n8n LOW:** Daily Portfolio dead snake read + Monthly Robustness empty `out0` completion node — add a completion-summary node so "done clean" ≠ "died mid-loop". Commit + push.

### Task 15: system-map:check contract-aware extension (architect F2)

- [ ] Extend `scripts/system-map.ts` (or add `check:contracts`) so the map gate also runs `check:wf-metadata-parity` + the 4 existing `check:ts-python-*` parity scripts as one composite — green map-check now means contracts verified, not just topology. Wire into CI. Commit + push.

---

# WAVE 5 — Prove 10/10 (no carry-forwards, no leftover bugs)

### Task 16: Full verification gate

- [ ] **All CI hard gates green:** `npm run check:production-isolation && npm run check:2026-compliance && npm run system-map:check && npm run check:ts-python-exit-parity && npm run check:wf-metadata-parity && npm run check:ts-python-tier1-parity`.
- [ ] **Full suites green:** `npx vitest run` (baseline ~2902 pass; assert 0 NEW failures and that the previously-flaky collection-crash files now run — fix any that this wave touched) + `pytest` (engine tests mock vectorbt; assert baseline preserved + new BIF/CSCV/parity tests green).
- [ ] **tsc clean:** `npx tsc --noEmit` → 0 errors.
- [ ] **Re-dispatch the 7 auditors** (architect, backtest-core, paper-parity, accuracy-validator, observability+autonomy, n8n, institutional-edge-researcher) over the worktree branch. Acceptance = each returns its domain ≥ 9.5/10 with **zero open CRITICAL/HIGH** and the specific findings F1..F8 / C-1 / H-1..H-5 each marked CLOSED with file:line evidence. Any residual finding becomes a new task in this plan — the wave does not close with an open finding (zero carry-forward rule).
- [ ] **Blueprint re-rate:** institutional-edge-researcher confirms CSCV closes the #1 gap and the L2/L1 decision (Task 12) is resolved, lifting blueprint to ≥ 9.5.

### Task 17: Merge + close

- [ ] `npm run system-map:sync`; append the AGENT-LOGS session entry (Mission/Work/Verification/Known-facts/Carry-forward=NONE) above the Known-Facts Pin.
- [ ] Merge `hardening/inst-10of10-2026-06-29` → `hardening/phase-0` (reconcile with carter by explicit path; the engine/lifecycle/kill-switch/paper files are disjoint from carter's slumhouse UI). Fast-forward verify, push.
- [ ] Confirm the two headline numbers: **Blueprint 10/10, Wiring 10/10**, every sub-domain ≥ 9.5, zero open findings.

---

## Self-Review — Spec Coverage Map (every audit finding → task)

| Audit finding | Severity (adjusted) | Task |
|---|---|---|
| C-1 kill-switch L3-9 no Discord | CRITICAL | 1 |
| MED-4 kill-switch fire-and-forget audit | MED | 1 |
| H-1 cron gate fail-open asymmetry | HIGH | 2 |
| Architect F1 dual PAPER→DEPLOY_READY stack | HIGH | 2 |
| Architect F2 system-map structural-only | MED | 4 + 15 |
| Architect F3 WF seam no parity script | MED | 4 |
| F-1 AVWAP trail 1×ATR vs tick | CRITICAL(parity) | 3a |
| F-2 paper TP2 liquidity-snap divergence | HIGH | 3b |
| F-4 Chandelier ATR ref | MED | 3c |
| F-3(paper) BE+1 same-bar timing | MED | 3d |
| F-5(paper) daily-cap leg overcount | MED | 3d |
| F-6(paper) BE+1 stop price not persisted | LOW | 3d (persist price in tp1BeStopMap row) |
| Accuracy F-3/H-3 six key-drift grandfather-pass | HIGH | 4 |
| Accuracy F-8 pbo_overall missing from input type | MED | 4 |
| Accuracy F-1 correlationId not forwarded | MED | 6 |
| Accuracy F-2 strategy_id exemption | MED | 6 |
| Accuracy F-4 WRC/SPA orchestrator not pglite-locked | HIGH | 7 |
| Accuracy F-5 W24 DSR no pglite | MED | 7 |
| Accuracy F-6 bif numeric coercion | MED | 7 |
| Obs HIGH-1 paper-risk-gate no audit | HIGH | 5 |
| Obs HIGH-2 agent-domain-down SSE-only | HIGH | 5 |
| Obs HIGH-3 A7 breach SSE-only | HIGH | 5 |
| Obs HIGH-4 C9 feature-vector dropped | HIGH | 5 |
| Obs HIGH-5 post-deploy swallows | HIGH | 5 |
| Obs MED-2 MCL pre-EIA audit lost | MED | 5 |
| Obs MED-3 cohort wrong action names | MED | 5 |
| Obs MED-1 scheduler watchdog no abort | MED | 14 |
| Obs MED-5 off-RTH crash WARNING-only | MED | 14 |
| Obs MED-6 killzone NaN silent | MED | 14 |
| Backtest H-4 BIF blind in CPCV | HIGH | 8 |
| Backtest H-5 Style-C partials default OFF | HIGH | 9 |
| Backtest F-3 dual PBO impl | MED | 8 (remove the dead `risk_metrics.compute_pbo`) |
| Backtest F-4 dollar-P&L Sharpe | MED | 9 (document as internally-consistent; add return-Sharpe alongside for cross-strategy + DSR external benchmark) |
| Backtest F-5 DSR n_trials window-count in invariant | LOW | 8 (propagate `trial_n_total` to invariant DSR) |
| Blueprint gap CSCV | HIGH | 10 |
| Blueprint gap decay monitor | MED-HIGH | 11 |
| Blueprint gap L2 OFI | MED | 12 |
| Quantum | keep challenger-only | (no change — evidence-confirmed) |
| n8n DR + dead-model | MED | 13 |
| n8n LOW completion node | LOW | 14 |

**Coverage: every finding has a task. Zero carry-forward by construction — Wave 5 will not close with an open finding.**
