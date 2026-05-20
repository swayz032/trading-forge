# Gate Strength Audit — 2026-05-20

Agent: `critic-optimizer` (P1.A2, Wave 23H Pass 1, W23H.G)
Scope: READ-ONLY audit of §12 hard gates. No source files modified.

---

## 1. Executive Summary Table

| Gate | CLAUDE.md Strength | Code Strength | File | Status |
|---|---|---|---|---|
| C9 DSL Diversity | HARD_BLOCK | HARD_BLOCK (fail-OPEN on pipeline pause + DB error) | `services/dsl-diversity-service.ts` | ⚠️ PARTIAL — see note |
| A4 Frankenstein | HARD_BLOCK | HARD_BLOCK (fail-closed on error) | `services/lifecycle-service.ts:585` | ✅ |
| A7 Signal Correlation | HARD_BLOCK | HARD_BLOCK (fail-closed on error; ramp-up fail-open) | `services/lifecycle-service.ts:1551` | ✅ |
| B10 MRP | SOFT (advisory) | SOFT_WARN (advisory, never blocks) | `services/lifecycle-service.ts:1477` | ✅ matches spec |
| A14 Black Swan | Phase 0 advisory | ADVISORY only — fire-and-forget, never in lifecycle path | `services/backtest-service.ts:1001` | ✅ matches spec |
| B14 Survival Twin | Phase 0 advisory | ADVISORY only — challenger_only, never blocks routing | `services/prop-firm-survival-service.ts:20` | ✅ matches spec |
| C11 Macro Gates | HARD_BLOCK | HARD_BLOCK in service; **fail-OPEN on exception** in caller | `services/paper-signal-service.ts:2605` | ⚠️ PARTIAL — see note |
| C1 CME Outage | HARD_BLOCK | HARD_BLOCK via kill-switch Layer 6; **fail-OPEN on exception** | `production/kill-switch.ts:328` | ⚠️ PARTIAL — see note |
| C2 Firm Suspension | HARD_BLOCK | HARD_BLOCK in paper-execution-service; kill-switch Layer 7 **fail-OPEN** | `services/paper-execution-service.ts:726` | ⚠️ PARTIAL — see note |

---

## 2. Per-Gate Detail

### C9 DSL Diversity
**File:** `src/server/services/dsl-diversity-service.ts`

Enforcement check (line ~307):
```ts
// Fail-open on pipeline pause. Fail-open on DB error (non-blocking to main flow).
if (!(await isPipelineActive())) {
  return { passed: true, reason: "C9: diversity check skipped — pipeline paused", ... };
```

Rejection path (line ~419) returns `passed: false` — the caller in `strategy-prevalidator.ts` must honour this. Gate fires `auditDslDiversityRejection()` which writes an `audit_log` row (fire-and-forget, non-blocking).

**Bypass condition:** pipeline paused → passes automatically (fail-open). DB error at line ~457 → also fails open with `passed: false` on _similarity_ path but audit write swallowed. The gate does produce `passed: false` on similarity; it is the _audit_ that is swallowed, not the block itself.

**Silently weakened?** No — the block itself is preserved. The pipeline-pause pass-through is intentional and documented. Audit write on DB error is fire-and-forget (low risk). Block strength: HARD_BLOCK when pipeline active.

---

### A4 Frankenstein
**File:** `src/server/services/lifecycle-service.ts:585`

Enforcement check:
```ts
// This is a HARD gate — not Phase 0 shadow. A failed Frankenstein test
// blocks promotion immediately with a clear reason.
if (fromState === "TESTING" && toState === "PAPER") {
  ...
  if (!frankResult.passed) {
    return { success: false, error };  // line ~635
  }
}
// catch (frankErr) → return { success: false, error };  // line ~660 fail-closed
```

No `audit_log` row written on block — logger.warn only. No structured audit_log insert at the rejection path. This is a gap for auditability but does not weaken the block.

**Bypass condition:** none. Error path is fail-closed. `passed: false` returns `{ success: false }` — promotion halted.

**Silently weakened?** No.

---

### A7 Signal Correlation
**File:** `src/server/services/lifecycle-service.ts:1551`

Enforcement check:
```ts
// Authority: HARD GATE (fail-closed). Does NOT override classical gates.
const sigCorrelationResult = await checkSignalCorrelationGate(s.id);
if (!sigCorrelationResult.allowed) {
  await db.insert(auditLog).values({ action: "lifecycle.promotion_blocked_signal_correlation", ... });
  continue;  // line ~1595 — skips this strategy in the promotion loop
}
// catch → fail-closed: continue after audit_log insert  // line ~1631
```

`audit_log` row written on both normal block and infrastructure error. Signal vector missing → blocked (`allowed: false`). Ramp-up case: deployed strategies with no pre-A7 vectors → fail-open with warning (documented ramp-up exception).

**Silently weakened?** No. Ramp-up fail-open is documented and time-bounded.

---

### B10 MRP
**File:** `src/server/services/lifecycle-service.ts:1477`

Enforcement check:
```ts
// SOFT gate: MRP > 0.5 is advisory for now. Hard gate activates after
// 30 days of MRP data accumulates. Log at WARN if violated; never block.
...
"B10 MRP soft gate: mrp_sharpe < 0.5 — strategy has regime-conditional fragility (advisory only, promotion continues)"
```

`audit_log` row written with `status: "success"` (advisory, not a block). Promotion continues regardless.

**Matches CLAUDE.md spec** ("PAPER → DEPLOY_READY (soft)"). No discrepancy.

---

### A14 Black Swan
**File:** `src/server/services/backtest-service.ts:1001`

Enforcement check:
```ts
// Phase 0 advisory: lifecycle-service reads the latest run; promotion
// never blocks on this evaluation.
(async () => {
  runBlackSwanTest(backtestId, strategyId, ...)
    .catch((err) => logger.error({ err, backtestId }, "synth_black_swan_eval_failed"));
})();
```

Runs fire-and-forget after backtest completes. `lifecycle-service.ts` contains no reference to A14 results at PAPER→DEPLOY_READY — the advisory is not yet wired into the promotion path at all (neither as a block nor as an advisory read). The result is persisted to DB for later retrieval but not consumed during promotion.

**Matches CLAUDE.md spec** ("Phase 0 advisory"). No discrepancy. Promotion never blocks on A14.

---

### B14 Survival Twin
**File:** `src/server/services/prop-firm-survival-service.ts`

Header comment (line ~20):
```ts
// Phase 0 (Day 0–60): challenger_only, never blocks routing. UI surfaces
// the probability as advisory.
```

`prop-firm-survival-service.ts` is pure math, no DB. Results surfaced via `/api/prop-firm/survival/:firmId` route for human review. `lifecycle-service.ts` contains no B14 promotion gate.

**Matches CLAUDE.md spec** ("Phase 0 advisory"). No discrepancy.

---

### C11 Macro Gates
**File:** `src/server/services/paper-signal-service.ts:2605`

Enforcement check when gate fires:
```ts
if (!macroGate.allowed) {
  macroGateBlocked = true;
  ...
}
...
} catch (macroGateErr) {
  logger.warn(..., "C11 macro gate check error — fail-open, proceeding");  // line 2656
}
if (macroGateBlocked) {
  riskGatePassed = false;  // line 2661 — hard block when gate fires correctly
}
```

When `evaluateMacroGates` returns `allowed: false`, the entry is blocked (sets `riskGatePassed = false`). `paper_signal_logs` row written (fire-and-forget). `macro-gate-service.ts` writes `audit_log` row with `action: "macro_gate.blocked"` inside the service itself.

**Bypass condition:** exception in `evaluateMacroGates` → fail-OPEN. Trading continues unblocked. This is intentional ("same fail-open pattern as calendar_filter") but is a discrepancy versus the CLAUDE.md description of C11 as a hard gate.

**Silently weakened?** YES for the exception path. The nominal path is a hard block; the exception path is fail-open. This creates a window where a buggy/unavailable macro service means C11 never fires.

---

### C1 CME Outage
**File:** `src/server/production/kill-switch.ts:328`

Enforcement check:
```ts
// Layer 6: CME outage
try {
  l6Halted = isExchangeHalted("CME");
} catch {
  l6Halted = false;  // fail-open on exception
}
```

`isExchangeHalted("CME")` reads from an in-process `activeOutageIds` Map set by the exchange-status-service poller. When the map has the key, `overall_halted` becomes true and all new entries are blocked via the kill-switch check.

**Bypass condition:** exception → `l6Halted = false` (fail-open). Also: if the exchange-status-service poller has not yet received the outage signal (polling lag), the map is empty and the gate passes silently. No `audit_log` row written when Layer 6 fires in kill-switch (the kill-switch status endpoint is used for observability instead).

**Silently weakened?** The exception fail-open is consistent with other layers' pattern. Real-world risk is poller lag, not silent weakening of code logic. Block strength: HARD_BLOCK when outage is in map.

---

### C2 Firm Suspension
**File:** `src/server/services/paper-execution-service.ts:726`

Enforcement check:
```ts
if (firmIdForCheck && isFirmSuspended(firmIdForCheck)) {
  logger.warn(..., "C2 prop firm suspension gate: blocking new entry — firm is suspended");
  broadcastSSE("paper:order-blocked-suspension", ...);
  return { position: null, ... };  // hard block at openPosition level
}
```

Also present in kill-switch Layer 7 (`kill-switch.ts:349`) but that layer is **fail-open on exception**.

**Bypass condition:** at `openPosition` level — `firmIdForCheck` can be null if the DB read for `paperSessions.firmId` returns no row, in which case `isFirmSuspended` is never called and the gate is skipped silently. The kill-switch Layer 7 only checks `PRIMARY_PROP_FIRM_ID` (defaults to `"mffu"`) — does not check all active firms.

**Silently weakened?** YES for the `firmIdForCheck` null path. If `paperSessions` lookup returns no row (session not found), the gate is bypassed for that position. Additionally kill-switch Layer 7 only checks a single env-var-configured firm, not all active firms.

---

## 3. Silently-Weakened Gates

Two gates have implementation gaps that deviate from the "hard block" expectation:

### C11 Macro Gates — exception path is fail-open
**Location:** `src/server/services/paper-signal-service.ts:2655-2658`

```ts
} catch (macroGateErr) {
  logger.warn({ err: macroGateErr, sessionId, symbol }, "C11 macro gate check error — fail-open, proceeding");
}
```

Any exception in `evaluateMacroGates` (DB unavailable, import error, parse failure) means C11 never fires and entries proceed. CLAUDE.md lists C11 as a hard gate at the paper signal stage.

**1-line fix:** change `l6Halted = false` → `macroGateBlocked = true` in the catch block, or at minimum escalate from `logger.warn` to `logger.error` and emit an SSE alert so the operator is notified when the gate is silently bypassed.

---

### C2 Firm Suspension — null firmId path bypasses gate
**Location:** `src/server/services/paper-execution-service.ts:721-726`

```ts
const firmIdForCheck = sessionForFirmCheck?.firmId;
if (firmIdForCheck && isFirmSuspended(firmIdForCheck)) {
```

When `firmIdForCheck` is null (session row not found), the entire gate is skipped with no log message.

**1-line fix:** add an explicit null guard that logs at `WARN` and blocks the entry:
```ts
if (!firmIdForCheck) { logger.warn(..., "C2: no firmId for session — blocking entry (fail-closed)"); return { position: null, ... }; }
```

---

## 4. Missing Gates

None of the 9 gates in CLAUDE.md §12 are entirely absent from the codebase. All have implementation files located and confirmed.

---

## 5. Recommendations for Fix Tickets

| Priority | Gate | Issue | Fix |
|---|---|---|---|
| P1 | C2 Firm Suspension | null `firmIdForCheck` silently skips gate | Add fail-closed null guard in `paper-execution-service.ts:721` before the `isFirmSuspended` call |
| P2 | C11 Macro Gates | exception path is fail-open (silent bypass) | In catch block at `paper-signal-service.ts:2655`, set `macroGateBlocked = true` + emit SSE alert |
| P3 | A4 Frankenstein | no `audit_log` row on block (logger.warn only) | Add `db.insert(auditLog)` in the `return { success: false }` paths at lines ~613 and ~635 |

---

## Completion Checklist

- [x] Evidence packet integrity verified — all 9 gates located with file:line citations
- [x] Replay contract verified — no replay contract changes; audit is read-only
- [x] Persistence verified — audit_log coverage confirmed per gate
- [x] Rejection/acceptance paths verified — block vs. warn vs. advisory documented per gate
- [x] Parent/child lineage preserved — no code changes made
- [x] Downstream promotion compatibility preserved — no code changes made
- [x] Observability hooks remain intact — no code changes made
- [x] No new disconnect introduced — read-only audit
