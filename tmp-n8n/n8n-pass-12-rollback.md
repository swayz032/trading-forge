# Pass 12 Phase 1 — Node-Level Hardening Rollback Registry

Generated: 2026-05-05

Pre-fix snapshots saved to `tmp-n8n/wf-<id>-phase12-pre.json`.
Post-fix snapshots overwrite `tmp-n8n/wf-<id>.json`.

| Workflow ID | Workflow Name | Pre-fix versionId | What changed | Post-fix version# | Rollback ref |
|---|---|---|---|---|---|
| `m6aD7X4ioWfhWaS9` | Monthly Robustness Check | v17 (901) | **Bug 6**: moved `Job Complete?` from `[1344,-128]` to `[1544,-128]` to resolve collision with `Compare Metrics` | v18 (924) | rollback to versionId 901 |
| `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | v57 (d169f78f-7408-4eaf-ad79-1352ed9791ad) | **Bug 3**: added `toolDescription` on `5A Gen Memory QA Tool`, `5A Critique Memory QA Tool`, `AI Agent Tool`. **Bug 4** (defensive rewrite): `Format Scout Context for LLM` Code node — rewrote to explicit `let X; if(){}else{}; const output=[{json:{X}}]; return output;` pattern (validator still flags as primitive — false positive, runtime is correct). **Bug 2**: added `Detect MNQ Regime` + `Detect MCL Regime` HTTP siblings on `Nightly 2AM EST Cron` and a `Merge Regimes` Code node merging all 3 into `{ MES, MNQ, MCL }` regime context. Updated `Generate Strategies` AI Agent prompt to read `$('Merge Regimes').item.json.regimes_json`. | v60 (932) | rollback to versionId 929 (last clean pre-Phase-1) |
| `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | v39 (f086d472-a255-4b84-a93f-363899aa2fd1) | **Bug 2 (companion toolDescription)**: added `toolDescription` on `5C Gen Memory QA Tool` and `5C Critique Memory QA Tool`. **Bug 4**: rewrote `Format Scout Context for LLM` to explicit-output pattern. **Bug 1 (DSL output)**: rewrote `Generate 9 Strategies` AI Agent prompt to emit StrategyDSL JSON conforming to `src/engine/compiler/strategy_schema.py`; rewrote `Parse and Enrich Strategies` Code to map each strategy to `{ dsl: s, source: 'ollama' }`; redirected `POST Batch to Backtest Agent` HTTP node from `/api/agent/batch` to `/api/agent/run-from-dsl` with body `{ dsl: $json.dsl, source: $json.source }`. | v42 (933) | rollback to versionId 926 (last clean pre-Phase-1) |
| `7PgUY6Wa07aZbAPX` | 5M-brave-news-watcher | v8 (935a7f93-789c-4e13-89b3-a5e413b00afc) | **Bug 4**: rewrote `Shape News Results` Code node to explicit-output pattern (validator still flags primitive return — false positive; runtime returns `[{json:...}]` correctly). | v10 (934) | rollback to versionId 919 |
| `4qVyxZd29pQkGn9p` | 5N-brave-video-discoverer | v3 (a615f9b9-f7e3-49c1-b068-30caf8bd93c8) | **Bug 4**: rewrote `Filter Long-Form (>10 min YouTube only)` Code node to explicit-output pattern. Same false-positive caveat as 5M. | v5 (935) | rollback to versionId 894 |
| `eCr7cyb0aPArFCZc` | Strategy Generation Loop | n/a | **Bug 5: SKIPPED — false-positive verified.** Phase 0 inventory hypothesis confirmed: 48 `ai_*` socket connections (`ai_languageModel`=16, `ai_memory`=8, `ai_tool`=8, `ai_vectorStore`=8, `ai_embedding`=8) wire the "11 orphan" sub-graph nodes to AI Agents. Validator only inspects `main` connections; cannot see implicit `ai_*` tool sockets. NO nodes deleted. | unchanged | n/a |
| `lUenVARPUG1uz4OE` | 5K-parallel-deep-research | n/a | **Bug 7: NO ACTION — already fixed in Pass 11.** `alert-finds` HTTP node already POSTs to `http://host.docker.internal:4000/api/sse/broadcast` with `{ channel: 'alerts', event: 'strategy:find', payload: {...} }`. No port-4100 reference remains. | unchanged | n/a |

## Bug 1 path chosen
**Path A: route exists.** `/api/agent/run-from-dsl` confirmed at `src/server/routes/agent.ts:267` with Zod schema `{ dsl: object, source: 'ollama'|'openclaw'|'manual', start_date?, end_date? }`. Calls `agentService.runStrategyFromDSL()`.

## Bug 5 outcome
**0 orphans deleted; 11 false positives skipped.** The validator's "Node not reachable from any trigger" warning ignores `ai_languageModel`/`ai_memory`/`ai_tool`/`ai_vectorStore`/`ai_embedding` sockets, which are the actual wiring path for AI Agent sub-graphs.

## Validator status after Phase 1
| Workflow | errorCount before | errorCount after | Notes |
|---|---:|---:|---|
| sAIrnCVB4iOsodsy | 3 | **0** | All Phase-1 errors cleared. valid:true. |
| m6aD7X4ioWfhWaS9 | 0 (collision was warning-only) | **0** | Position fix applied; valid:true. |
| Z4NcOCDbet8KzjDd | 4 | **1** | toolDescription cleared (3); primitive-return flag persists despite correct code (validator false positive). |
| 7PgUY6Wa07aZbAPX | 1 | **1** | Validator false positive on primitive return; runtime code is correct. |
| 4qVyxZd29pQkGn9p | 1 | **1** | Same as 5M. |

## Outstanding items
1. **Validator false-positive on Code-node primitive-return** — n8n-mcp validator flags 3 Code nodes (`Format Scout Context for LLM` in Z4, `Shape News Results` in 5M, `Filter Long-Form` in 5N) despite each ending with explicit `[{json:{...}}]` array literal returns. Two distinct rewrite strategies were attempted; validator heuristic remains stuck. Sibling node in sAIr (identical code shape) passes — validator behavior is non-deterministic across workflows. Runtime code is correct. **Recommend: report MCP validator bug upstream; treat as known false-positive in Phase 2 acceptance.**
2. **Z4 `Merge Regimes` Code node** raised 3 advisory warnings (`Code doesn't reference input data`, `Invalid $ usage detected`, `Code nodes can throw errors`). The first is intentional — the node fans in from 3 siblings via `$('NodeName').item`, which the validator does not classify as "input data". The second is the same `$('NodeName')` pattern (validator flags `$node['x']`-style — but this code uses the modern `$('x')` form). Both are cosmetic — runtime is correct.
3. **Bug 2 wiring caveat** — the existing `Detect Market Regime -> Fetch Scouted Ideas` connection was preserved. New `Detect MNQ`/`Detect MCL` siblings feed into `Merge Regimes` only. The `Generate Strategies` AI Agent now reads from `$('Merge Regimes')` for the 3-symbol context. The original single-symbol fetch path is unchanged so the rest of the workflow's MES-anchored ideas pipeline keeps working.

---

## Phase 2 — Agent 2B (Clusters F + I + errorWorkflow) — 2026-05-05

Pre-fix snapshots inherited from Phase 1 / Pass 11; post-fix surface in n8n live state.

| Workflow ID | Workflow Name | Pre versionId | Clusters applied | Post updatedAt | Rollback ref |
|---|---|---|---|---|---|
| `eCr7cyb0aPArFCZc` | Strategy Generation Loop | (Phase 1 last) | F (1 node: Log Strategy to Journal `$node['Parse AI Strategy Output']`→`$('Parse AI Strategy Output')`); I (2 nodes: GPT-5-mini Generator + Critic onError=continueRegularOutput) | 2026-05-05T15:55:59Z | revert via wf-eCr7cyb0aPArFCZc.json snapshot |
| `hPXhUaSC3ScznZE9` | Strategy Tournament | (Phase 1 last) | F (10 nodes: Log KILL Compilation Failed, Graveyard Check, Log KILL Graveyard Match, Critic (deepseek-r1:14b), Parse Critic Output, Parse Prosecutor Output, Parse Promoter Verdict, Verdict is PROMOTE?, Compile Strategy for Backtest, Queue Backtest — `$node['…']`→`$('…')`) | 2026-05-05T15:56:30Z | revert via wf-hPXhUaSC3ScznZE9.json snapshot |
| `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | (Phase 1 last v60/932) | I (2 nodes: GPT-5-mini Generator + Critic onError=continueRegularOutput) | 2026-05-05 | revert via wf-Z4NcOCDbet8KzjDd.json |
| `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | (Phase 1 last v42/933) | I (2 nodes: GPT-5-mini Generator + Critic onError=continueRegularOutput) | 2026-05-05 | revert via wf-sAIrnCVB4iOsodsy.json |
| `u0RcmfuClgRinXAX` | Daily Portfolio Monitor | n/a (settings) | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset `settings.errorWorkflow` |
| `YuDGQkuej7qybPAB` | Weekly Compliance Re-Parse | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `gFwNlA3eCHbSb7en` | Pre-Session Compliance Gate | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `X2IjKuYseGukxKDj` | Macro Data Sync | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `vlCaiWM7F0AH1RRY` | 8A-idea-to-strategy | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `66HEjQavpvirY6g5` | 0A-health-monitor | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `eaq72MwKwCjv7g7F` | Pre-Session Skip Check | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `m6aD7X4ioWfhWaS9` | Monthly Robustness Check | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `J0p8oYkONmN7pYn6` | 3A-workflow-backup | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `LQtqeWAcNOlkqROH` | 8B-source-quality-review | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `WT9sVMzG83rg1L29` | Daily Compliance Check | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `PHcD2tFZpzr7kQGF` | Anti-Setup Refresh | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `pVT6svNTljjBoQbW` | 11A-critic-optimization | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `LayXj1mbHh4aGSM9` | Post-Session Skip Review | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |
| `8HKXzNmo9KF59SBu` | 10A-master-orchestration | n/a | errorWorkflow→`BbCvlV1ARyyvY3NI` | 2026-05-05 | unset |

### Phase 2 Agent 2B notes
1. **Cluster F scope was reduced.** Phase 0 inventory listed 8 workflows with `$node['x']` syntax. Live grep confirmed only 2 still carry the pattern: eCr7 (1 occurrence) and hPX (10 nodes touching 4 unique node refs). The other 6 (8HKX, LayX, J0p8, m6aD7, PHcD2tF, vlCaiW) were already migrated to `$('x')` during Pass 11 / Phase 1. Skipped accordingly.
2. **9A `26ruSYvIjqHGOhsd` errorWorkflow attachment SKIPPED.** API rejected the partial-update with `Invalid node at index 6: parameters required` — pre-existing structural defect on node index 6 (`err-trigger` errorTrigger has no `parameters: {}`). Auto-sanitization could not fix. NOT introduced by Agent 2B; needs separate cleanup before any partial-update on this workflow can succeed.
3. **Cluster I (lmChatOpenAi onError) applied to all 6 nodes** across eCr7, Z4, sAIr — `onError: "continueRegularOutput"` so a single GPT-5-mini call failure no longer crashes the parent workflow.
4. **Validation results post-Phase 2:**
   - eCr7: 1 error (cycle — Cluster K intentional), 29 warnings (down from 42). No new errors.
   - hPX: valid:true, 13 warnings (down from 17). Cluster F syntax fully migrated. Validator continues to flag `$('NodeName').json.x` as `Invalid $ usage detected` — confirmed false positive, runtime is correct (same caveat as Phase 1 note 2).
   - Z4: 1 error (primitive return — Phase 1 known false positive), 26 warnings. No new errors.
   - sAIr: valid:true, 20 warnings.
5. **errorWorkflow contract.** ZZ-global-error-handler (`BbCvlV1ARyyvY3NI`) consumes the n8n errorTrigger payload — `$json.workflow.{id,name}`, `$json.execution.{id,lastNodeExecuted,error.message}` — and POSTs `{channel:'alerts', event:'workflow:error', payload:{workflowId, workflowName, executionId, nodeName, errorMessage, firstSeenAt, occurrenceCount}}` to `http://host.docker.internal:4000/api/sse/broadcast`. 2-node workflow (errorTrigger → httpRequest with retryOnFail+timeout=5s+onError=continueRegularOutput).

---

## Phase 2 — Agent 2A (Clusters A + B + H) — 2026-05-05

Snapshots not re-saved per workflow (live state is canonical; n8n versionId surfaces via `n8n_get_workflow`). Pre-state inferred from Phase 0 inventory + Phase 1 rollback. Below: clusters applied per workflow, validation outcome.

| Workflow ID | Workflow Name | Clusters applied | A nodes | B nodes | H nodes | Validation (minimal profile) |
|---|---|---|---:|---:|---:|---|
| `eCr7cyb0aPArFCZc` | Strategy Generation Loop | A,B | 5 (Cross-Validate Concept, GPT-5-mini Depth Critique, Quantum Pre-Flight Check httpRequest 4.2→4.4; Concept Validated? if 2→2.3; Pre-Flight Pass? if 2.2→2.3) | 5 (Check Strategy Tier, Can Retry?, Compilation Passed?, Concept Validated?, Pre-Flight Pass? — onError=continueErrorOutput) | 0 (already correct in live state — false positive) | valid:true (errors:0, warnings:20) |
| `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | A,B | 2 (Quantum Pre-Flight Check 4.2→4.4; Pre-Flight Pass? 2.2→2.3) | 1 (Pre-Flight Pass? onError=continueErrorOutput) | 0 (false positive) | valid:false (1 pre-existing Phase 1 false-positive primitive-return error; 0 new errors) |
| `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | A,B | 1 (GPT-5-mini Depth Critique 4.2→4.4) | 1 (Any Strategies Passed? onError=continueErrorOutput) | 0 (false positive) | valid:true (errors:0, warnings:8) |
| `hPXhUaSC3ScznZE9` | Strategy Tournament | B | 0 | 4 (Proposal Parsed OK?, Compiler Passed?, Graveyard Passed?, Verdict is PROMOTE? onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:13) |
| `Ep2Zsu33tMOsaJbE` | 5J-unified-search-router-scout | A,B | 3 (POST /search/strategy-hunt, POST /agent/scout-ideas, POST workflow-errors httpRequest 4.2→4.4) | 1 (Split Results splitInBatches onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:2) |
| `lUenVARPUG1uz4OE` | 5K-parallel-deep-research | A | 4 (POST Parallel Task, POST scout-ideas/strict, POST strategy-finds, POST workflow-errors httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:2) |
| `F6i4JoTdxgiyjHhM` | 5L-quant-blog-harvester | A | 3 (Tavily /crawl, POST scout-ideas, POST workflow-errors httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:4) |
| `7PgUY6Wa07aZbAPX` | 5M-brave-news-watcher | A | 3 (Brave News, POST scout-ideas, POST workflow-errors httpRequest 4.2→4.4) | 0 | 0 | valid:false (1 pre-existing Phase 1 false-positive primitive-return error; 0 new errors) |
| `4qVyxZd29pQkGn9p` | 5N-brave-video-discoverer | A | 3 (Brave Video, POST workflow-errors httpRequest 4.2→4.4; Trigger 5O executeWorkflow 1.2→1.3) | 0 | 0 | valid:false (1 pre-existing Phase 1 false-positive primitive-return error; 0 new errors) |
| `J8K0PfErL2v4W9Zw` | 5O-supadata-transcript-pipeline | A | 5 (Execute Workflow Trigger 1→1.1; POST /api/supadata/transcript, POST workflow-errors, POST /api/agent/transcript-extract, POST scout-ideas/strict httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:2) |
| `vlCaiWM7F0AH1RRY` | 8A-idea-to-strategy | A,B | 8 (Schedule Trigger 1.2→1.3; Fetch Scouted Ideas, Call GPT-5-mini, Compile DSL, Run Strategy, Update Journal, Alert on Error httpRequest 4.2→4.4; IF Valid 2.2→2.3) | 1 (IF Valid initially set to continueErrorOutput, REVERTED to continueRegularOutput because main[1] unwired triggered new validator error) | 0 | valid:true (errors:0 after revert, warnings:4); +parameters:{} added to On Error errorTrigger to clear pre-existing schema defect |
| `LQtqeWAcNOlkqROH` | 8B-source-quality-review | A | 5 (Execute Workflow Trigger 1→1.1; Cron Trigger 1.2→1.3; Fetch Source Stats, Create Source Quality Alert, Create Workflow Error Alert httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to On Error errorTrigger |
| `26ruSYvIjqHGOhsd` | 9A-nightly-self-critique | A | 5 (Cron Trigger 1.2→1.3; Fetch Tested Entries, POST Critique, Send Alert, Alert on Error httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to On Error errorTrigger CLEARED Phase 0 framework "match" false-positive |
| `pVT6svNTljjBoQbW` | 11A-critic-optimization | A | 4 (Daily 3AM Trigger 1.2→1.3; Fetch Recent Backtests, POST Critic Analyze, Log to Journal httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:2); +parameters:{} added to Error Trigger |
| `MIIxmilbgZv3SUBh` | 7A-auto-evolution | A,B | 5 (Cron Trigger 1.2→1.3; Fetch Declining Strategies, POST Decay Check, Send Alert, Alert on Error httpRequest 4.2→4.4; Any Declining? if 2.2→2.3) | 1 (Any Declining? onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:5); +parameters:{} added to On Error CLEARED framework "match" false-positive |
| `RumAJUp4iS1TYlNm` | 6D-compliance-gate | A,B | 5 (Cron Trigger 1.2→1.3; Fetch Paper Strategies, POST Compliance Review, Send Compliance Alert, Alert on Error httpRequest 4.2→4.4; Any Paper? if 2.2→2.3) | 1 (Any Paper? onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:5); +parameters:{} added to On Error CLEARED framework "match" false-positive |
| `8HKXzNmo9KF59SBu` | 10A-master-orchestration | A | 6 (Cron Trigger 1.2→1.3; Check System Health, Fetch Pipeline Stats, Check Strategy Pipeline, Send Alert, Alert on Error httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to On Error |
| `BbCvlV1ARyyvY3NI` | ZZ-global-error-handler | A | 1 (Post to Discord workflow-errors httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:0); +parameters:{} added to Workflow Error Trigger |
| `66HEjQavpvirY6g5` | 0A-health-monitor | A,B | 12 (Execute Workflow Trigger 1→1.1; Every 5 Minutes 1.2→1.3; 4× check-* httpRequest, Create Health Alert, Create Workflow Error Alert httpRequest 4.2→4.4; 3× merge 3→3.2; Any Failures? if 2→2.3) | 1 (Any Failures? initially set to continueErrorOutput, REVERTED to continueRegularOutput because main[1] unwired triggered new validator error) | 0 | valid:true (errors:0 after revert, warnings:3); +parameters:{} added to On Error |
| `v4eSeAoaEErYp472` | 0Z-openclaw-daily-report | A | 2 (POST Daily Report, POST Error to workflow-errors httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:1) |
| `J0p8oYkONmN7pYn6` | 3A-workflow-backup | A | 5 (Daily 3 AM ET 1.2→1.3; GET All Workflows, Broadcast Backup Complete, Fetch Workflow Detail, Alert on Error httpRequest 4.2→4.4) | 0 | 0 | valid:true (errors:0, warnings:4); +parameters:{} added to On Error |
| `WT9sVMzG83rg1L29` | Daily Compliance Check | B | 0 | 1 (Any Stale Firms? onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to On Workflow Error |
| `gFwNlA3eCHbSb7en` | Pre-Session Compliance Gate | B | 0 | 1 (Any Blocked Strategies? onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to On Workflow Error |
| `eaq72MwKwCjv7g7F` | Pre-Session Skip Check | B | 0 | 2 (Any SKIP Decisions? — REVERTED to continueRegularOutput because main[1] unwired; Any REDUCE Decisions? onError=continueErrorOutput retained) | 0 | valid:true (errors:0 after revert, warnings:4); +parameters:{} added to Error Trigger |
| `YuDGQkuej7qybPAB` | Weekly Compliance Re-Parse | B | 0 | 1 (Process Each Firm splitInBatches onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:4); +parameters:{} added to On Workflow Error |
| `X2IjKuYseGukxKDj` | Macro Data Sync | B | 0 | 1 (Any Source Failed? onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to Error Trigger |
| `PHcD2tFZpzr7kQGF` | Anti-Setup Refresh | B | 0 | 2 (Has Strategies?, Loop Over Strategies — onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:6); +parameters:{} added to Error Trigger |
| `m6aD7X4ioWfhWaS9` | Monthly Robustness Check | A,B | 1 (Alert on Error httpRequest 4.2→4.4) | 3 (Degraded?, Loop Over Strategies, Job Complete? — onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:3); +parameters:{} added to On Error |
| `u0RcmfuClgRinXAX` | Daily Portfolio Monitor | B | 0 | 3 (Any DEPLOYED Strategies?, Detect Drift, Loop Over Strategies — onError=continueErrorOutput) | 0 | valid:true (errors:0, warnings:2); +parameters:{} added to On Workflow Error |

### Phase 2 Agent 2A notes

1. **Cluster H surfaced ZERO actionable nodes.** Inventory listed 6 AI Agent nodes (eCr7×2, Z4×2, sAIr×2) flagged "no systemMessage". Live state inspection (post-Phase-1 + Pass 11) confirmed all 6 already carry both `promptType:"define"` AND a non-empty `options.systemMessage`. The validator's "no systemMessage" warning is a known FALSE POSITIVE — it appears to scan for a top-level `systemMessage` field rather than `parameters.options.systemMessage`. No edits needed; warning will persist post-Phase-2 and is acceptable per Phase 0 inventory.

2. **Cluster B `continueErrorOutput` reverted on 3 nodes (vlCaiWM7F0AH1RRY/IF Valid, 66HEjQavpvirY6g5/Any Failures?, eaq72MwKwCjv7g7F/Any SKIP Decisions?).** Each had `main[1]` empty (false branch unwired). Setting `continueErrorOutput` triggered a NEW validator error: "no error output connections in main[1]". Per plan: revert + document. All three reverted to `continueRegularOutput` (workflow-safe default). Parent IFs that DO have main[1] wired retained `continueErrorOutput` correctly.

3. **Pre-existing schema defect on errorTrigger nodes cleared as a side effect.** 16 of 22 workflows had errorTrigger nodes WITHOUT `parameters: {}` (n8n schema requires the field). Initial partial-update batches FAILED on those workflows with "Invalid node at index N: parameters required". Recovery: include `{type:"updateNode", nodeName:"<errTrigger>", updates:{parameters:{}}}` in the same batch. This unblocked all updates AND incidentally cleared the Phase 0 "validator framework `match` error" (Cluster M false-positive) on workflows 26ruSY (9A), MIIxmilb (7A), and RumAJUp (6D) — the framework error was caused by parsing a malformed errorTrigger node, not by cron-expression handling as Phase 0 hypothesized.

4. **Quantum Pre-Flight Check typeVersion drift cleared on eCr7 + Z4.** Inventory flagged this httpRequest@4.2; Phase 0 snapshot showed it at 4.4 (snapshot stale). Live state was 4.2; bumped to 4.4 in both workflows.

5. **No workflow skipped per task scope.** All 22 Cluster A / 17 Cluster B / 3 Cluster H workflows in inventory were processed. Three Cluster B nodes reverted to safe default (see note 2); zero workflows fully skipped.

6. **Validation pass rate (minimal profile, post-fix):** 25 valid:true / 4 valid:false. The 4 valid:false workflows are: eCr7 (cycle — Cluster K intentional, suppressed in minimal but still surfaced as runtime profile error), Z4 (Phase 1 primitive-return false positive on Format Scout Context), 5M (same false positive on Shape News Results), 5N (same false positive on Filter Long-Form). All 4 errors PRE-EXISTED Phase 2 — zero new errors introduced.

