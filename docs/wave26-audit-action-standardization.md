# Wave 26 → Wave 27 Carry-Forward: Audit Action Name Standardization

> **Status:** GAP IDENTIFIED in Wave 26. **DEFERRED to Wave 27** (single-commit fix, scope discipline).
> **Owner:** next architect close pass.
> **Severity:** Observability gap, not a correctness gap. The cohort audit report's "hard invariant" column shows `--` instead of `OK` because the queries do not match the actual emitted audit action names. Adaptive exits + invariants still execute correctly in `paper-execution-service.ts`; only the *evidence visibility* is impaired.

---

## Background

Wave 26 Group C shipped `cohort-audit-report-service.ts` and `scripts/wave26-cohort-audit-report.ts`. The report queries `audit_log` for the canonical adaptive-exit hard-invariant signals so the operator can verify each invariant is firing in production before expanding the cohort.

The cohort report queries the following audit action names:
- `paper.time_stop_flatten` — proof the 15:55 ET hard flatten ran
- `paper.tp1_fill`            — proof BE+1 on TP1 fill ran
- `paper.dll_95_force_close`  — proof the 95% DLL force-close path engaged

**None of these action names are actually emitted by `paper-execution-service.ts`.** The hard-invariant column in the daily report therefore renders `--` instead of `OK` even when the invariants run every day.

---

## Current divergent state

### What the cohort report expects (`cohort-audit-report-service.ts:379-382`)
```ts
_fetchCount("paper.time_stop_flatten",   since),
_fetchCount("paper.tp1_fill",            since),
_fetchCount("paper.dll_95_force_close",  since),
```

### What `paper-execution-service.ts` actually emits

| Invariant | Emitted action name(s) | Source line |
|---|---|---|
| 15:55 ET hard flatten | `paper.exit_decision.<decision_lower>` (dynamic) plus `paper.force_flatten_all` for emergency force-close | `paper-execution-service.ts:2507`, `:3448` |
| TP1 fill | `paper.trade_close` (per-trade close row) + `paper.exit_decision.tp1` (where applicable) | `paper-execution-service.ts:1928`, `:2507` |
| 95% DLL force-close | `paper.force_flatten_all` with reason="dll_95_force_close" passed into payload, NOT as the action name | `paper-execution-service.ts:1071`, `:3448` |

Result: the cohort audit report's hard-invariant proof block produces `--` for all three rows even when every invariant ran every trading day this week.

---

## Two valid Wave 27 fix paths (pick one — do NOT mix)

### Option A — rename the emissions to match the cohort report queries

Pros: stable contract for the audit report; canonical, self-documenting action names.
Cons: every consumer of `paper.exit_decision.*` / `paper.force_flatten_all` (audit replays, downstream dashboards, Wave 25.5 audit chain) must also adapt. Higher blast radius.

Concrete edits:
- `paper-execution-service.ts:2507` — when `decision === "time_stop_1555_et"`, emit `paper.time_stop_flatten` (in addition to or instead of the dynamic `paper.exit_decision.time_stop_1555_et`)
- `paper-execution-service.ts:2507` — when `decision === "tp1"`, also emit `paper.tp1_fill` so the cohort report has a stable contract
- `paper-execution-service.ts:3448` — when `forceCloseAllPositions(reason)` is called with `reason="dll_95_force_close"`, emit `paper.dll_95_force_close` in addition to `paper.force_flatten_all`

### Option B — update the cohort report queries to match current emissions (RECOMMENDED — lower blast radius)

Pros: zero impact on other consumers; cohort report is the newest module so it should adapt to existing canonical emissions; smaller diff, faster to land.
Cons: queries become slightly more nuanced (need to filter on `decision` field inside the payload for tp1 / time_stop subkinds).

Concrete edits:
- `cohort-audit-report-service.ts:379` — change `_fetchCount("paper.time_stop_flatten", since)` to `_fetchCount("paper.exit_decision.time_stop_1555_et", since)` (the actual subkind emitted by `applyExitDecision`)
- `cohort-audit-report-service.ts:380` — change `_fetchCount("paper.tp1_fill", since)` to `_fetchCount("paper.exit_decision.tp1", since)` OR count `paper.trade_close` rows filtered by `result->>'exit_reason' = 'tp1'`
- `cohort-audit-report-service.ts:382` — change `_fetchCount("paper.dll_95_force_close", since)` to a filtered count: `paper.force_flatten_all` rows WHERE `result->>'reason' = 'dll_95_force_close'`

---

## Recommendation

**Option B.** The cohort audit report is the Wave-26 new arrival; the emission contract is stable, canonical, and referenced from `CLAUDE.md §4 (Take Profit — Adaptive)` and `Trading Forge System Map v2.md`. Adapt the consumer, not the producer.

---

## Acceptance criteria for the Wave 27 fix

1. Cohort audit report's "hard invariants" block shows `OK` for all three rows on a normal trading day with executed positions
2. No new audit action names introduced (if Option B chosen)
3. Wave 26 cohort report test (`src/server/__tests__/wave26-cohort-audit-report.test.ts`) updated with a regression fixture proving the count > 0 for each invariant when fed a realistic `audit_log` seed
4. `npm run system-map:check` GREEN
5. `npm run check:production-isolation` GREEN
6. `npm run check:2026-compliance` GREEN

---

## Why this was deferred (NOT fixed in Wave 26)

- Scope discipline per the Wave 26 dispatch: Group D = architect close-out + verification + system-map sync + commit. Renaming or re-querying audit actions is a behavioral change outside Group D's charter.
- Mixing this fix into the Wave 26 close-out commit would conflate "stabilization shipped" with "observability regression repaired" — two distinct messages.
- The actual hard invariants ARE running. The operator's risk during the deferral window is purely an observability gap (the daily Discord summary shows `--` instead of `OK`), not a safety regression. Manual verification possible via the SQL snippets above.
