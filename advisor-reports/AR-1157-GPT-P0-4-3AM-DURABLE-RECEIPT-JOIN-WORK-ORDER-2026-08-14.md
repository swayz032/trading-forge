# GPT EXTERNAL ADVISOR RULING — AR-1157

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Audit target commit:** `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Audit target tree:** `46ff2b8778045f15af273a076a60d18210eb6b3e`  
**Parent GPT ruling:** AR-1156 @ `4ba07d598b37b3da30ff1030bdc9894c6b2a563e`  
**Status:** STATIC AUDIT / READY-TO-CODE WORK ORDER / NO CLAIM OF IMPLEMENTATION COMPLETION  
**Scope:** GPT-P0-4 from AR-1153 only. Preserve all prior frozen compiler/PAPER/feed contracts.

---

# 1. DECISION

P0-4 is now frozen as a **ready-to-code work order**, not as completed implementation.

The exact measured finding is:

> **TRADING FORGE ALREADY HAS THE CORRECT CANONICAL 3AM NIGHTLY CENTERLINE. DO NOT BUILD ANOTHER NIGHTLY SYSTEM. THE FASTEST ROBUST PATCH IS TO JOIN THE EXISTING 14A WORKFLOW TO A PROVEN DURABLE RECEIPT, MAKE ITS RUN/REPORT LINEAGE EXPLICIT, COVER MES + MNQ + MCL, AND PROVE THAT ITS AUTONOMOUS OPTIMIZER BRANCH CANNOT MUTATE A FROZEN PAPER QUALIFICATION CANDIDATE.**

The existing architecture already supplies most of the control flow:

```text
03:00 America/New_York schedule
    ↓
14A Initialize Run
    ↓
correlation_id
    ↓
regime + leak + decay + ranking
    ↓
nightly report assembly
    ↓
GPT author path OR deterministic fallback path
    ↓
report delivery
    ↓
autonomous critique/optimizer branch when enabled
```

P0-4 therefore is a **receipt/provenance/immutability join**, not a greenfield scheduler or reporting project.

The acceleration score remains:

```text
P0-1  DONE / frozen
P0-2  DONE / frozen
P0-3  DONE / frozen
P0-4  READY-TO-CODE / NOT YET IMPLEMENTED
P0-5  not yet frozen
P0-6  not yet frozen
P0-7  not yet frozen

3 / 7 implemented/frozen
```

Do not count this work order as implementation completion. P0-4 becomes GREEN only after the worker implementation and repository evidence pass the acceptance gates in this ruling.

---

# 2. CANONICAL NIGHTLY CENTERLINE EXISTS — MEASURED

Primary workflow:

`workflows/n8n/14A-master-nightly-intelligence_Nk4pmHP6c0VOEOaT.json`

The audited workflow is active and already contains the expected nightly control plane.

## 2.1 Exact schedule

The n8n Schedule Trigger is configured as:

```text
cron: 0 3 * * *
timezone: America/New_York
```

This is the canonical 3AM scheduler for P0-4.

### Ruling

Do **not** add a second `node-cron`, shell cron, Railway cron, or duplicate n8n 3AM workflow for this lane.

If the implementation requires a test harness, test the existing 14A contract directly or extract the smallest deterministic helper needed for testability. Do not create a parallel production schedule.

---

# 3. RUN IDENTITY ALREADY EXISTS, BUT THE DURABLE RECEIPT MUST CARRY IT

14A `Initialize Run` already creates a `correlation_id` and a `started_at` timestamp.

Downstream organ calls propagate the correlation ID and use idempotency keys.

That is good architecture and must be retained.

P0-4 must make the run identity durable and queryable after n8n execution history is gone.

Freeze the minimum receipt identity as:

```text
correlation_id
n8n_execution_id
scheduled_for / started_at
completed_at
workflow_name = 14A-master-nightly-intelligence
workflow_version or immutable workflow identifier
receipt_schema_version
```

`n8n_execution_id` should be captured from the actual n8n execution context (`$execution.id` or the equivalent supported expression), not synthesized.

### Law

```text
n8n execution history != durable Trading Forge receipt
```

n8n execution retention is useful operational evidence. It is not the only durable business/audit record for P0-4.

---

# 4. ORGAN CHAIN EXISTS — MEASURED

14A currently calls the following production surfaces with correlation/idempotency plumbing:

```text
regime  -> POST http://localhost:3000/api/regime/detect
leak    -> GET  http://localhost:3003/api/leak/status
decay   -> GET  http://localhost:3000/api/decay/status
ranking -> GET  http://localhost:3000/api/edge/paper-ranking
```

P0-4's required durable receipt must preserve the exact status/outcome of the intelligence organs that matter to the nightly decision.

At minimum persist:

```text
regime_status
leak_status
decay_status
ranking_status
composite_status
```

Each status must be machine-readable and distinguish at least:

```text
PASS / OK
WARN / DEGRADED
FAIL / REFUSED / ERROR
NOT_RUN
```

The implementation may align spelling with existing repository enums. The semantics may not collapse a failed/refused organ into success merely because the workflow reached the reporting node.

## 4.1 Composite status

The current workflow merges results, but P0-4 requires a durable composite outcome rather than relying on node completion as the meaning of success.

Freeze a deterministic reducer.

Recommended minimum semantics:

```text
any required organ FAIL/REFUSED/ERROR -> composite FAIL
no FAIL but one or more WARN/DEGRADED -> composite WARN
all required organs OK/PASS          -> composite PASS
required organ absent/not-run        -> composite FAIL
```

If production already has a stricter canonical reducer, reuse it. Do not invent conflicting status semantics.

---

# 5. CRITICAL SYMBOL DEFECT — MES IS HARD-CODED IN THE REGIME CALL

The audited 14A Regime Detection node currently sends:

```json
{
  "symbol": "MES",
  "timeframe": "5m"
}
```

That is not sufficient for the frozen Slumdawg qualification universe.

The strategy/backtest/trading roots are:

```text
MES
MNQ
MCL
```

All three are first-class Trading Forge identities.

Provider listed-contract identities such as:

```text
MESU6
MNQU6
MCLU6
```

remain provider-bound feed identities under AR-1156 and must not replace the logical strategy roots in the nightly receipt.

## 5.1 Required repair

The nightly receipt must explicitly prove coverage for:

```text
MES
MNQ
MCL
```

The worker may satisfy that by either:

1. invoking regime detection per logical root and persisting three results; or
2. proving that the regime service intentionally produces one market-wide result and explicitly linking that result to all three qualifying roots.

Option 2 is acceptable only if repository semantics prove it. A hard-coded MES request with silent reuse for MNQ/MCL is not acceptable.

### Stop condition

Any remaining hidden MES-only assumption in the official qualification receipt is a P0-4 BLOCK.

---

# 6. GPT / FALLBACK LINEAGE EXISTS — BUT MUST BE PERSISTED EXPLICITLY

14A contains two report-authoring paths:

```text
GPT Author Report
Fallback without GPT
```

Both converge on the nightly report posting path.

This is good fail-soft reporting behavior, but the durable receipt must state **which path actually authored the report**.

Persist:

```text
reporter_path = gpt | fallback
report_provider / model identifier when GPT path is used
report_generated_at
report_content_hash
```

Do not persist credentials, API keys, authorization headers, or secrets.

## 6.1 Fallback is not failure

If GPT configuration is absent or the GPT path fails and the workflow intentionally uses the deterministic fallback, record:

```text
reporter_path = fallback
```

Do not falsely label the report as GPT-authored.

If GPT fails unexpectedly and fallback handles it, the receipt should retain the model-path failure as a warning/error detail while allowing report delivery to continue if that is current system policy.

---

# 7. DELIVERY EXISTS; DURABLE RECEIPT PERSISTENCE IS NOT YET PROVEN

14A currently posts the nightly report to:

```text
http://localhost:3000/__oc/alert/alerts
```

That proves a delivery attempt in the workflow.

It does **not**, from the audited repository evidence, prove that the report is stored in Trading Forge's canonical database-backed alert sink.

The audited server exposes a proven DB-backed alert CRUD surface:

```text
POST /api/alerts
```

implemented in:

`src/server/routes/alerts.ts`

and registered under the `/api` prefix in:

`src/server/index.ts`

The `/api/alerts` route inserts into the `alerts` database table and returns the inserted alert row/ID.

No audited repository evidence was found proving that:

```text
/__oc/alert/alerts
```

is an alias for, proxy to, or persistence-equivalent of:

```text
/api/alerts
```

### Ruling

Do not equate **delivery** with **durability**.

The worker must choose the smallest of these paths:

### Path A — prove existing durability

If `__oc/alert/alerts` is backed by a deployed component outside the checked source path and genuinely persists a receipt, produce repository/deployment proof and a retrieval test keyed by correlation/execution ID.

### Path B — minimal durable join

If that proof cannot be produced, join 14A to an existing Trading Forge durable DB surface.

Prefer reuse over a new subsystem.

If the current `alerts` schema cannot losslessly hold structured receipt fields, do **not** bury the entire audit record in an unqueryable prose message. Add the smallest purpose-built structured receipt table/service necessary, using repository migration conventions.

The durable write must happen independently of the external/report delivery attempt.

### Law

```text
persist receipt
    ↓
attempt delivery
    ↓
record delivery result
```

A delivery outage must not destroy the nightly audit receipt.

---

# 8. AUTONOMOUS OPTIMIZER BRANCH IS A REAL MUTATION RISK — MEASURED

14A does not end after report delivery.

When autonomous mode is enabled, it can enter a branch that reads recent backtests, runs critique, evaluates gates, and can call the critic optimizer.

The production critic optimizer service explicitly documents a closed-loop flow that can:

```text
collect evidence
→ generate ranked candidates
→ replay candidates
→ select survivor
→ CREATE A NEW STRATEGY VERSION if survivor beats parent
→ audit/broadcast
```

Therefore this branch cannot be treated as a harmless read-only report step.

Creating a new version for research is not itself forbidden.

What is forbidden during an official 3–5 day PAPER qualification is silent mutation/replacement of the **candidate being qualified**.

## 8.1 Frozen candidate firewall

Before the autonomous branch can execute, the 3AM run must capture the currently qualifying candidate identity for each logical root in scope:

```text
MES candidate_id + frozen hash/version
MNQ candidate_id + frozen hash/version
MCL candidate_id + frozen hash/version
```

Use the canonical frozen candidate identity/hash from AR-1154/AR-1155/PAPER lifecycle work. Do not create a second conflicting hash definition.

After autonomous critique/optimization completes or is skipped, re-read the same qualification identities.

Required invariant:

```text
before_candidate_identity == after_candidate_identity
before_candidate_hash     == after_candidate_hash
```

for every active official PAPER qualification candidate.

If an optimizer creates a child/challenger/new strategy version, that new version must remain a separate unqualified research candidate unless it independently starts a new qualification run.

It may not silently replace the parent inside an already-counting PAPER qualification chain.

## 8.2 Hard failure behavior

If the before/after invariant changes unexpectedly:

```text
composite_status = FAIL
candidate_immutability = FAIL
qualification continuity = INVALIDATED / BLOCKED
```

The current run must not keep counting as though the same candidate was tested.

Do not auto-heal the evidence by overwriting the before hash with the after hash.

---

# 9. DURABLE RECEIPT V1 — MINIMUM CONTRACT

Field names may match repository style, but the following semantics are frozen.

```ts
interface NightlyIntelligenceReceiptV1 {
  schema_version: "nightly-intelligence-receipt-v1";

  correlation_id: string;
  n8n_execution_id: string;
  workflow_name: "14A-master-nightly-intelligence";
  scheduled_for: string;
  started_at: string;
  completed_at: string | null;

  logical_symbols: ["MES", "MNQ", "MCL"] | Array<"MES" | "MNQ" | "MCL">;

  candidate_before: Array<{
    logical_symbol: "MES" | "MNQ" | "MCL";
    candidate_id: string | null;
    candidate_hash: string | null;
    qualification_run_id: string | null;
  }>;

  organs: {
    regime: unknown;
    leak: unknown;
    decay: unknown;
    ranking: unknown;
  };

  composite_status: "PASS" | "WARN" | "FAIL";

  reporter: {
    path: "gpt" | "fallback";
    provider?: string;
    model?: string;
    report_content_hash: string;
  };

  autonomous: {
    enabled: boolean;
    critic_ran: boolean;
    optimizer_ran: boolean;
    created_strategy_ids?: string[];
  };

  candidate_after: Array<{
    logical_symbol: "MES" | "MNQ" | "MCL";
    candidate_id: string | null;
    candidate_hash: string | null;
    qualification_run_id: string | null;
  }>;

  candidate_immutability: "PASS" | "FAIL";

  delivery: {
    attempted: boolean;
    succeeded: boolean;
    status_code?: number;
    destination: string;
    returned_receipt_id?: string;
    error_class?: string;
  };
}
```

This is a semantic contract, not a demand for this exact TypeScript interface location.

Do not store `unknown` blindly in production; normalize each organ into the repo's real status payload and retain bounded diagnostic details.

---

# 10. IDEMPOTENCY / RESTART CONTRACT

The existing organ calls already use idempotency keys derived from the nightly run.

P0-4 must extend that discipline to the durable receipt itself.

Required behavior:

```text
same correlation_id / same n8n execution retry
-> update/resume same durable receipt
-> do not create a second official nightly receipt
```

If n8n restarts and a new execution is intentionally created for the same scheduled nightly slot, the implementation must have one deterministic policy:

```text
same scheduled slot + same qualification identities
-> one authoritative receipt chain with attempt lineage
```

Do not silently double-count two 3AM runs as two qualification days.

Persist attempt lineage if necessary; keep one authoritative daily result.

---

# 11. REQUIRED FAILURE VISIBILITY

The receipt must not use a single broad `success=true` as a substitute for organ truth.

Prove these cases independently:

```text
regime failed
leak failed
 decay failed
ranking failed
GPT failed -> fallback used
durable DB write failed
delivery failed
autonomous optimizer failed
candidate hash changed
```

A report can still be delivered while one organ is degraded, but the durable receipt must show the actual organ/composite state.

A durable-write failure is a hard P0-4 failure because no authoritative receipt exists.

---

# 12. REQUIRED TEST / PROOF HARNESS

Do not authorize completion from a screenshot or a manually pasted n8n execution result.

The worker must add deterministic automated proof for the existing production path.

Minimum matrix:

| Case | Required proof |
|---|---|
| Normal 3AM run | exact 03:00 ET schedule + one durable receipt |
| MES | receipt contains MES qualification identity/status |
| MNQ | receipt contains MNQ qualification identity/status |
| MCL | receipt contains MCL qualification identity/status |
| GPT path | `reporter.path=gpt` persisted |
| No GPT config / intended fallback | `reporter.path=fallback` persisted |
| One organ failure | organ failure preserved; composite not PASS |
| Delivery failure | receipt survives and delivery failure is recorded |
| Retry/restart | no duplicate authoritative receipt |
| autonomous=false | candidate hashes unchanged |
| autonomous=true, no new version | candidate hashes unchanged |
| autonomous=true, optimizer creates challenger | qualifying candidate unchanged; challenger separate |
| attempted in-place candidate mutation | hard failure / qualification continuity blocked |
| durable retrieval | full receipt retrievable by correlation/execution ID |

## 12.1 Positive control

At least one test must demonstrate that the immutability guard is capable of catching a real mutation.

A test that only checks two naturally equal hashes is weak evidence.

Plant or mock a controlled candidate/config/version change and prove the guard turns RED.

## 12.2 Delivery positive control

Prove the delivery status field changes when the destination returns a controlled failure.

The receipt must remain queryable after that failure.

---

# 13. FASTEST ALLOWED IMPLEMENTATION ORDER

Do the lane in this order and stop when evidence is green:

```text
1. Reuse 14A as canonical scheduler.
2. Capture n8n execution ID beside existing correlation ID.
3. Remove/prove the MES-only regime assumption; cover MES/MNQ/MCL.
4. Normalize per-organ + composite status.
5. Persist reporter path and report hash.
6. Join to one proven durable receipt sink.
7. Separate durable persistence from delivery result.
8. Add before/after frozen PAPER candidate identities/hashes.
9. Fail closed on candidate mutation.
10. Prove idempotent retry/restart.
11. Run the focused P0-4 harness plus directly affected regression suites.
12. Report exact commands, counts, commit SHA, and changed files.
```

Do not detour into redesigning all n8n workflows, replacing n8n, rewriting the critic optimizer, or general observability cleanup.

---

# 14. FORBIDDEN SHORTCUTS

P0-4 is NOT GREEN if the implementation does any of the following:

- adds a second nightly scheduler instead of repairing/joining 14A;
- treats n8n execution history as the only durable receipt;
- assumes `__oc/alert/alerts` is durable without proof;
- treats report delivery as proof of durable storage;
- leaves the official nightly qualification receipt MES-only;
- globally rewrites logical roots into listed provider tickers;
- records `reporter=gpt` when fallback authored the report;
- collapses organ refusal/error into overall success because the report node executed;
- lets the optimizer replace a currently qualifying candidate silently;
- changes the qualifying candidate hash and keeps counting the same 3–5 day chain;
- stores API keys or model secrets in receipts;
- creates duplicate authoritative receipts on retry;
- adds PAPER to any live broker route or weakens PILOT/DEPLOYED execution gating;
- claims P0-4 complete from prose without repository/test evidence.

---

# 15. PAPER / LIVE SAFETY BOUNDARY REMAINS FROZEN

This ruling changes no live execution authority.

PAPER remains simulation-only.

The existing production safety rule remains:

```text
PAPER != live broker routing authority
```

Do not add PAPER to any live executor allowlist while implementing this lane.

Topstep/broker/venue routing remains downstream of strategy qualification and is outside P0-4.

---

# 16. WORKER REPORT CONTRACT

When Claude executes AR-1157, the report back to the external advisor must contain:

1. implementation commit SHA;
2. exact files changed;
3. exact 14A workflow file changed, if changed;
4. exact durable receipt storage path/table/service/route;
5. proof that the 3AM schedule remains `0 3 * * *` `America/New_York`;
6. proof of MES + MNQ + MCL coverage;
7. example sanitized durable receipt from automated test/fixture;
8. correlation ID + n8n execution ID linkage;
9. all required organ statuses + composite result;
10. GPT and fallback lineage test evidence;
11. durable retrieval evidence;
12. delivery-failure evidence;
13. autonomous-mode immutability evidence;
14. controlled mutation positive-control evidence;
15. idempotent retry/restart evidence;
16. exact test commands and pass/fail counts;
17. explicit statement that no PAPER-to-live execution permission changed.

The external advisor must inspect those repository artifacts and tests independently before P0-4 is marked implemented/frozen.

---

# 17. STOP CONDITIONS FOR CLAUDE

Stop and report instead of improvising if any of these are true:

```text
A. The deployed __oc alert route is outside the repository and its persistence contract cannot be proven.
B. No canonical qualification candidate hash/identity exists to reuse from P0-1/P0-2.
C. Regime semantics intentionally support only MES and no valid multi-root policy exists.
D. The critic optimizer currently mutates the same qualifying strategy row in place and cannot be isolated with a small patch.
E. A durable receipt requires a broad database redesign rather than a bounded table/route addition.
F. The 14A production workflow in the actual deployment differs materially from the audited JSON.
G. Any required patch would weaken PAPER/live routing safety.
```

On a stop condition, return measured evidence and the smallest fork. Do not silently pick a new architecture.

---

# 18. FINAL RULING

**P0-4 is architecturally straightforward because the hard part already exists.**

Trading Forge already has the real 3AM scheduler, organ fan-out, correlation/idempotency plumbing, GPT/fallback reporting, delivery step, and autonomous intelligence branch.

The remaining work is bounded:

```text
existing 14A
+ explicit MES/MNQ/MCL coverage
+ execution/correlation lineage
+ machine-readable organ/composite state
+ explicit GPT/fallback lineage
+ proven durable receipt
+ separate delivery receipt
+ frozen PAPER candidate before/after proof
+ retry/idempotency proof
```

The most important new protection is:

> **THE NIGHTLY LEARNING LOOP MAY CREATE RESEARCH CHILDREN, BUT IT MUST NEVER SILENTLY CHANGE THE IDENTITY OR POLICY OF THE MES, MNQ, OR MCL CANDIDATE CURRENTLY EARNING PAPER QUALIFICATION DAYS.**

Implementation authorization is granted for this bounded P0-4 work order.

P0-4 is **not yet claimed complete**. It becomes complete only after the worker implementation is independently verified against this ruling.
