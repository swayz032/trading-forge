# AR-1145 — GPT STATIC AUDIT: 3AM PAPER EVIDENCE CONTRACT

**Date:** 2026-08-13  
**Engineering branch inspected:** `h1-wave4-sealed12-driver` at pushed head `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Scope:** nightly advisory intelligence evidence during official PAPER. No autonomous strategy mutation instructions.  
**Worker collision rule:** Claude remains mid-order on AR-1138; this audit does not redirect that work.

## 1. Current 14A static design is reusable

Current repo export `workflows/n8n/14A-master-nightly-intelligence_Nk4pmHP6c0VOEOaT.json` is a substantial existing foundation, not something to rebuild.

Static properties inspected:

- workflow name `14A-master-nightly-intelligence`;
- repo export marks it active and not archived;
- `Nightly 3AM Trigger` uses cron `0 3 * * *`;
- workflow settings explicitly set timezone `America/New_York`, so the schedule is 03:00 ET;
- every run mints a correlation ID;
- kill-switch read resolves separate `advisory_on` and `autonomous_on` semantics;
- missing `autonomous_on` fails closed to false;
- advisory path collects regime, leak detection, decay and composite-ranking inputs;
- date-scoped idempotency keys exist for the major calls and GPT report generation;
- GPT is instructed to summarize only supplied JSON and not invent facts;
- if GPT output is unavailable, a deterministic fallback report is built;
- report-post HTTP node retries;
- mutation-capable branch is behind the separate `Autonomous On?` gate.

**Decision:** PAPER should use this existing 14A design in OBSERVE/advisory mode. Do not build another nightly brain.

## 2. Fresh live evidence mechanism already exists

Current backend `n8n-execution-scraper-service.ts` polls Railway's n8n execution API and stores execution history in `n8n_execution_log` using execution-ID deduplication.

Current scheduler runs that scraper every five minutes and does not pipeline-gate it, so observability can continue even while trading work is paused.

Current `GET /api/n8n/execution-log` and `/health` routes expose recent execution evidence.

This gives PAPER a usable source for fresh Railway execution IDs/status instead of relying on repo snapshots or old reports.

## 3. Critical distinction — n8n `success` does NOT prove the full 14A chain succeeded

Several important 14A HTTP nodes are configured with retry plus `continueOnFail` / `onError: continueRegularOutput`, including data organs and the final nightly-report post.

Therefore this state is possible:

```text
14A scheduled execution starts
-> one or more HTTP organs fail
-> workflow continues
-> GPT may receive incomplete/error-shaped inputs or fallback may be used
-> final report post can also fail and continue
-> n8n execution itself may still finish without a workflow-level hard failure
```

So a row saying only:

```text
workflow = 14A-master-nightly-intelligence
status = success
```

is **necessary evidence but not sufficient evidence** that the required PAPER learning-loop night completed correctly.

### Consequence

Do not certify a PAPER night from the generic n8n execution status alone.

## 4. Exact PAPER-night evidence contract

For each official PAPER day, the preceding/associated 3AM run should have a reconstructable receipt proving at least:

```text
A. scheduled 14A execution occurred at the expected ET nightly cycle
B. execution ID is fresh for that date
C. correlation ID exists
D. advisory mode was ON
E. autonomous mutation mode stayed OFF for the frozen PAPER candidate
F. regime input produced an explicit result or explicit degraded/error state
G. leak-detection input produced an explicit result or explicit degraded/error state
H. decay input produced an explicit result or explicit degraded/error state
I. composite-ranking input produced an explicit result or explicit degraded/error state
J. report body was generated, with GPT-vs-fallback status recorded
K. report delivery/persistence is positively evidenced, not inferred from workflow completion
L. no unauthorized candidate mutation occurred overnight
```

The point is not that every external dependency must always be healthy. The point is that degraded/failed organs must be **visible and attributable**, never silently converted into a green PAPER-learning-loop night.

## 5. Do not use the generic two-hour stale threshold as the sole 14A verdict

Current `/api/n8n/execution-log/health` applies a generic default stale threshold of two hours to workflows that have data.

That threshold is reasonable for frequent workflows but a once-daily 03:00 workflow will naturally become older than two hours for most of the day.

Therefore `status="stale"` from that generic endpoint is not, by itself, a valid 14A failure verdict.

For 14A PAPER qualification, use **schedule-aware evidence**: did the expected run for the relevant date happen and did its required receipt complete?

## 6. PAPER-night verdicts

### GREEN — countable learning-loop night

- expected 14A run exists;
- required receipt is reconstructable;
- advisory analyses/report are visible;
- fallback use, if any, is explicit;
- report delivery/persistence is proven;
- autonomous mutation remained off for the frozen candidate.

### YELLOW — investigate before counting

- run exists but one or more advisory organs are degraded;
- evidence is still reconstructable and no mutation occurred;
- operator/advisor can determine whether the night remains usable for PAPER learning evidence.

### RED — PAPER learning-loop requirement not satisfied

Examples:

- expected 14A run missing;
- execution evidence cannot be tied to the correct date/run;
- report delivery is not proven;
- failure was hidden behind continue-on-fail with no durable receipt;
- autonomous mutation changed the frozen candidate;
- evidence cannot reconstruct what the nightly agent actually saw/did.

Because the official plan requires the 3AM learning loop to be working during the PAPER window, a RED night must not be silently represented as a healthy completed qualification night.

## 7. Current static security/telemetry note

The legacy `/api/n8n/execution-log` callback route still defaults its HMAC transition setting to `warn` unless `N8N_HMAC_ENFORCE_MODE=enforce`. The newer Railway scraper does not depend on that callback for its own evidence because it pulls Railway directly using the n8n API key.

This is not the primary PAPER blocker in this audit, but do not mistake callback acceptance in warn mode for authenticated proof. Prefer the Railway-scraped execution ID plus the correlated report receipt for qualification evidence.

## 8. Fastest next action

Do not edit 14A blindly.

First inspect whether an existing durable report/audit sink already records the correlation ID + organ statuses + fallback + report-delivery result. If it exists, wire PAPER qualification to that evidence. If it does not exist, record the missing receipt as the smallest bounded readiness gap.

The next live readiness drill, once the environment is available, should prove one complete 14A scheduled-style run in advisory mode and then query the backend evidence exactly as PAPER will.

## 9. Verdict

- 3AM ET schedule: **STATICALLY PROVEN**.
- Timezone: **STATICALLY PROVEN America/New_York**.
- Advisory/autonomous separation: **STATICALLY PROVEN**.
- Idempotency/retry/fallback foundation: **FOUND**.
- Fresh Railway execution scraper: **FOUND; 5-minute cadence**.
- Generic n8n success as complete 14A proof: **REJECTED — insufficient because continue-on-fail exists**.
- Generic 2h stale flag as daily-14A proof: **REJECTED — not schedule-aware**.
- Fresh end-to-end 14A report receipt for official PAPER: **NOT YET CERTIFIED FROM GITHUB STATIC EVIDENCE**.

**Advisor directive:** preserve AR-1138; carry the 14A receipt/live-smoke proof as a bounded P0 PAPER-readiness item, not as a redesign.