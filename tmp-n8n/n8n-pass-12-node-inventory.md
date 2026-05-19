# Pass 12 Phase 0 — Node-Level Inventory

Generated: 2026-05-05
Scope: All 30 ACTIVE non-archived workflows (the audit list of 27 + ZZ-global-error-handler 2-node + 0Z 4-node + 26ruSY 8-node — Pass 11 audit grouped some). Used `mcp__n8n-api-mcp__n8n_validate_workflow` (runtime profile) on every workflow + grep across saved post-fix snapshots in `tmp-n8n/wf-*.json`. Read-only; no workflows modified.

## Summary

- **Total workflows audited:** 30
- **CLEAN (valid=true, ≤5 warnings, no critical findings):** 6
- **MINOR (valid=true, warnings only — typeVersion drift, code-node `throws`, missing `onError: continueErrorOutput` advisories):** 18
- **NEEDS_FIX (errors OR critical-tier issues):** 6
  - eCr7 (1 error: cycle), Z4 (4 errors: primitive return + 3 toolDescription), sAIr (3 errors: primitive return + 2 toolDescription), 7PgUY (1 error: primitive return), 4qVyx (1 error: primitive return), MIIxmilbgZv3SUBh / 26ruSYvIjqHGOhsd / RumAJUp4iS1TYlNm (validator framework error: "Cannot read properties of undefined (reading 'match')" — likely MCP-side false positive, NOT a workflow defect).

Pass 11 closed every P0/P1 finding (port 4100 dead routes, hardcoded API keys, hardcoded JWT, broken expression syntax, ES-only prompts, webhook auth, localhost vs host.docker.internal). Phase 0 confirms zero new CRITICAL findings beyond the plan's 7 known bugs.

---

## Phase 2 cluster sizing (aggregated across all 30 workflows)

| Cluster | Issue | Affected nodes | Affected workflows |
|---|---|---:|---:|
| **A** | Outdated `typeVersion` (httpRequest 4.2→4.4 dominant; scheduleTrigger 1.2→1.3; if 2.2→2.3; merge 3→3.2; executeWorkflowTrigger 1→1.1; lmChatOpenAi 4.2→4.4) | ~95 nodes | 22 |
| **B** | IF nodes with main[1] error-output wired but missing `onError: "continueErrorOutput"` | ~24 nodes | 17 |
| **C** | Code nodes lack error handling (advisory `Code nodes can throw errors`) | ~66 nodes | 27 |
| **D** | Missing `toolDescription` on Vector Store Tools / AI Agent Tools | 5 nodes | 2 (Z4, sAIr) |
| **E** | Code node returns primitive (errors) | 4 nodes | 4 (Z4, sAIr, 7PgUY, 4qVyx) |
| **F** | `Invalid $ usage` (e.g. `$node['x']` instead of `$('x')`) in Code nodes | ~12 nodes | 7 (eCr7×2, hPX×4, 8HKX, LayX, 3A path, m6aD7, PHcD2tF×2) |
| **G** | Optional chaining `?.` warnings in expressions (cosmetic — n8n executes correctly) | ~14 nodes | 14 |
| **H** | AI Agent without `systemMessage` warning (community node) | 6 nodes | 3 (eCr7, Z4, sAIr) |
| **I** | lmChatOpenAi without `onError` | 6 nodes | 3 (eCr7, Z4, sAIr) |
| **J** | "Node not reachable from any trigger" — disconnected Vector Store / GPT-5-mini sub-graphs in mega-workflows | 27 nodes | 3 (eCr7, Z4, sAIr) |
| **K** | "Workflow contains a cycle (infinite loop)" | 1 graph | 1 (eCr7) |
| **L** | Webhook missing credentials configuration warning (Bearer auth credential not yet stored in n8n UI) | 1 | 1 (eCr7) |
| **M** | Validator internal "Cannot read properties of undefined (reading 'match')" — framework false positive on schedule cron parse | 3 | 3 (MIIxmilb, 26ruSY, RumAJUp) |
| **N** | Long linear chain (>10 nodes) — refactor advisory | 5 workflows | 5 |

Top-5 most-affected workflows (highest finding count):
1. **eCr7cyb0aPArFCZc** Strategy Generation Loop — 1 error + 42 warnings (40 nodes, cycle, 11 orphan sub-nodes, missing webhook cred, AI Agent w/o systemMessage)
2. **Z4NcOCDbet8KzjDd** Nightly Strategy Research Loop — 4 errors + 28 warnings (30 nodes, primitive Code return, 3 missing toolDescription, 12 orphans)
3. **sAIrnCVB4iOsodsy** Weekly Strategy Hunt — 3 errors + 24 warnings (30 nodes, primitive return, 2 missing toolDescription, 11 orphans)
4. **66HEjQavpvirY6g5** 0A-health-monitor — 16 warnings (10 typeVersion drifts including 3 merge nodes)
5. **hPXhUaSC3ScznZE9** Strategy Tournament — 0 errors + 17 warnings (mostly Code-node advisories + `$node['x']` syntax)

---

## Per-workflow inventory

### eCr7cyb0aPArFCZc Strategy Generation Loop
- **System Map §19 subsystem:** Strategy Generation
- **Node count:** 40
- **Schedule:** webhook + scheduleTrigger
- **Active:** yes
- **Verdict:** NEEDS_FIX
- **Findings:**
  - workflow (graph): cycle detected — HIGH (this is the iteration loop; semantically intentional but flagged)
  - Webhook Trigger: missing credential config for httpHeaderAuth — MEDIUM (operator must create n8n credential `trading_forge_strategy_gen_token`)
  - Cross-Validate Concept / GPT-5-mini Depth Critique / Quantum Pre-Flight Check (httpRequest@4.2): typeVersion drift — LOW
  - Concept Validated? / Pre-Flight Pass? (if@2): typeVersion drift — LOW
  - Check Strategy Tier / Can Retry? / Compilation Passed? / Concept Validated? / Pre-Flight Pass?: error-output wired but missing `onError: continueErrorOutput` — MEDIUM
  - AI Strategy Generator / AI Strategy Critique: AI Agent with no systemMessage — MEDIUM (deterministic prompt is in user msg; system msg recommended for guardrails)
  - 11 orphan sub-graph nodes (5B Gen/Critique Chat Memory + Embeddings + Vector Store + QA Tool + QA LLM + GPT-5-mini Generator + GPT-5-mini Critic) — HIGH (these are wired as sub-tools to AI Agent nodes but validator can't see the implicit `ai_*` tool connections; check if it's a runtime-only wiring or genuinely dead RAG)
  - Extract Refinement Notes / Log Compilation Failed: Invalid $ usage in Code — LOW (eslint-style; runtime works)
  - Long linear chain (19 nodes) — refactor advisory
  - Webhook auth: `headerAuth` set ✓ (Pass 11 Phase 3)
  - retryOnFail/maxTries on submit-backtest: confirmed present ✓
  - `promptType: "define"` on all 4 AI Agent invocations ✓
  - No port 4100, no localhost, no inline credentials ✓ (Pass 11 fixes verified in `wf-eCr7cyb0aPArFCZc.json`)

### Z4NcOCDbet8KzjDd Nightly Strategy Research Loop
- **System Map §19 subsystem:** Strategy Generation (nightly)
- **Node count:** 30
- **Schedule:** scheduleTrigger (nightly)
- **Active:** yes
- **Verdict:** NEEDS_FIX
- **Findings:**
  - Format Scout Context for LLM (code): returns primitive — HIGH (carried-over from Pass 11 known bug; PLANNED for Phase 1 fix)
  - 5A Gen Memory QA Tool / 5A Critique Memory QA Tool / AI Agent Tool: missing toolDescription — HIGH (carried-over; PLANNED for Phase 1 fix)
  - Quantum Pre-Flight Check / Pre-Flight Pass?: typeVersion drift — LOW
  - 12 orphan sub-graph nodes (5A vector store stack + GPT-5-mini Gen/Critic + AI Agent Tool) — HIGH (same RAG-tool false-positive pattern as eCr7)
  - Generate Strategies / Critique Backtest Results: AI Agent w/o systemMessage — MEDIUM
  - Long linear chain (14 nodes)
  - `promptType: "define"` confirmed ✓ (Pass 11 Phase 2)
  - Multi-symbol prompt MES/MNQ/MCL ✓
  - No port 4100, all error-alerts redirected to /api/sse/broadcast ✓

### sAIrnCVB4iOsodsy Weekly Strategy Hunt
- **System Map §19 subsystem:** Strategy Generation (weekly)
- **Node count:** 30
- **Schedule:** scheduleTrigger (weekly)
- **Active:** yes
- **Verdict:** NEEDS_FIX
- **Findings:**
  - Format Scout Context for LLM (code): returns primitive — HIGH (carried-over from Pass 11)
  - 5C Gen/Critique Memory QA Tool: missing toolDescription — HIGH (carried-over)
  - GPT-5-mini Depth Critique: typeVersion 4.2→4.4 — LOW
  - 11 orphan sub-graph nodes — HIGH (same RAG-tool pattern as Z4)
  - Generate 9 Strategies / AI Critique Passing Strategies: AI Agent w/o systemMessage — MEDIUM
  - Output shape still `python_code` (not StrategyDSL JSON) — DOCUMENTED follow-up; intentional (keeps batch endpoint contract intact per Pass 11 follow-up #1)
  - `promptType: "define"` confirmed ✓ (Pass 11 Phase 2)
  - Symbols MES/MNQ/MCL ✓ (Pass 11 Phase 2)

### hPXhUaSC3ScznZE9 Strategy Tournament
- **System Map §19 subsystem:** Strategy Tournament (Proposer/Critic/Prosecutor/Promoter)
- **Node count:** 27
- **Schedule:** scheduleTrigger
- **Active:** yes
- **Verdict:** MINOR
- **Findings:**
  - Parse Critic Output / Parse Prosecutor Output / Parse Promoter Verdict / Log KILL Compilation Failed / Log KILL Graveyard Match: `$node['x']` instead of `$('x')` — LOW (4 nodes; cosmetic, runs correctly but n8n is deprecating bracket syntax)
  - Proposal Parsed OK? / Compiler Passed? / Graveyard Passed? / Verdict is PROMOTE? (4 IF nodes): missing `onError: "continueErrorOutput"` — MEDIUM
  - Long linear chain (18 nodes) — advisory
  - Symbols MES/MNQ/MCL on Proposer ✓ (Pass 11 Phase 2)

### Ep2Zsu33tMOsaJbE 5J-unified-search-router-scout
- **§19:** A4 Strategy Scout (research-find)
- **Node count:** 8 — **Schedule:** scheduleTrigger — **Verdict:** MINOR
- **Findings:** 3× httpRequest@4.2; Code throws-advisory on Shape; Split Results IF missing `continueErrorOutput`; expression `?.` warning on jsonBody.

### lUenVARPUG1uz4OE 5K-parallel-deep-research
- **§19:** A4 Strategy Scout (Parallel.ai) — **Node count:** 7 — **Verdict:** MINOR
- **Findings:** 4× httpRequest@4.2; Split Strategy Array Code throws-advisory; `?.` expression warning. NO inline keys (Pass 11 fix verified) ✓

### F6i4JoTdxgiyjHhM 5L-quant-blog-harvester
- **§19:** A4 Scout (Tavily) — **Node count:** 7 — **Verdict:** MINOR
- **Findings:** 3× httpRequest@4.2; Quant Blogs to Crawl Code "doesn't reference input data" (intentional — static seed list); Code throws-advisory; `?.` warning. Tavily key envelope ✓

### 7PgUY6Wa07aZbAPX 5M-brave-news-watcher
- **§19:** A4 Scout (Brave news) — **Node count:** 6 — **Verdict:** NEEDS_FIX
- **Findings:** Shape News Results returns primitive — HIGH (newly surfaced; same class of bug as Z4/sAIr); 3× httpRequest@4.2; `?.` warning. Brave key env ✓

### 4qVyxZd29pQkGn9p 5N-brave-video-discoverer
- **§19:** A4 Scout (Brave video → 5O) — **Node count:** 6 — **Verdict:** NEEDS_FIX
- **Findings:** Filter Long-Form returns primitive — HIGH; 2× httpRequest@4.2; Trigger 5O executeWorkflow@1.2→1.3; `?.` warning. Brave key env ✓

### J8K0PfErL2v4W9Zw 5O-supadata-transcript-pipeline
- **§19:** A4 Scout (Supadata) — **Node count:** 7 — **Verdict:** MINOR
- **Findings:** Execute Workflow Trigger@1→1.1; 4× httpRequest@4.2; Split Strategies Code throws-advisory; `?.` warning.

### vlCaiWM7F0AH1RRY 8A-idea-to-strategy
- **§19:** Idea Synthesis — **Node count:** 11 — **Verdict:** MINOR
- **Findings:** Schedule Trigger@1.2→1.3; 6× httpRequest@4.2; IF Valid@2.2→2.3; Parse GPT-5-mini Response Invalid $ usage; Code throws-advisories; `?.` warning. M6 fix + GPT-5-mini path intact ✓

### LQtqeWAcNOlkqROH 8B-source-quality-review
- **§19:** Source Quality Review — **Node count:** 7 — **Verdict:** MINOR
- **Findings:** Execute Workflow Trigger@1→1.1; Cron Trigger@1.2→1.3; 3× httpRequest@4.2; expression `?.` and missing `$` prefix warning on Create Workflow Error Alert (cosmetic).

### 26ruSYvIjqHGOhsd 9A-nightly-self-critique
- **§19:** Nightly Self-Critique — **Node count:** 8 — **Verdict:** NEEDS_FIX (validator framework error only)
- **Findings:** Validator returned "Cannot read properties of undefined (reading 'match')" workflow-level error — appears to be MCP framework bug (likely cron-parse). All node-level findings are MINOR: Cron@1.2→1.3, 3× httpRequest@4.2, Code throws-advisories, `?.` warning. **Operator should re-run validate after Pass 12 to confirm framework error is not workflow content.**

### pVT6svNTljjBoQbW 11A-critic-optimization
- **§19:** Critic Optimizer — **Node count:** 7 — **Verdict:** MINOR
- **Findings:** Daily 3AM Trigger@1.2→1.3; 3× httpRequest@4.2; Code throws-advisories.

### MIIxmilbgZv3SUBh 7A-auto-evolution
- **§19:** Auto-Evolution (DECLINING regen) — **Node count:** 10 — **Verdict:** NEEDS_FIX (validator framework error only)
- **Findings:** Same framework "match" error. Node-level: Cron@1.2→1.3; 4× httpRequest@4.2; Any Declining? IF@2.2→2.3 + missing `continueErrorOutput`; No Declining Code "doesn't reference input data" (intentional — empty-state response); Code throws-advisories; `?.` warning.

### 8HKXzNmo9KF59SBu 10A-master-orchestration
- **§19:** Master Orchestration — **Node count:** 8 — **Verdict:** MINOR
- **Findings:** Cron@1.2→1.3; 5× httpRequest@4.2; Format Daily Summary Code "doesn't reference input data" + Invalid $ usage — LOW. Pass 11 4100→sse fix verified ✓

### BbCvlV1ARyyvY3NI ZZ-global-error-handler
- **§19:** Global Error Handler — **Node count:** 2 — **Verdict:** MINOR
- **Findings:** Post to Discord workflow-errors httpRequest@4.2. Pass 11 4100→/api/sse/broadcast fix verified ✓ (this was the system-wide observability hole closure).

### 66HEjQavpvirY6g5 0A-health-monitor
- **§19:** Safety Probe (service-health) — **Node count:** 14 — **Verdict:** MINOR
- **Findings:** Heaviest typeVersion drift in inventory — Execute Workflow Trigger@1→1.1; Every 5 Minutes scheduleTrigger@1.2→1.3; 6× httpRequest@4.2; 3× merge@3→3.2; Any Failures? if@2→2.3; Evaluate Health Code "doesn't reference input data" (advisory only — uses $items implicit); `$` prefix warning on Create Workflow Error Alert. Port 4100 health-CHECK probe is INTENTIONAL.

### v4eSeAoaEErYp472 0Z-openclaw-daily-report
- **§19:** Daily OpenClaw Report — **Node count:** 4 — **Verdict:** MINOR
- **Findings:** 2× httpRequest@4.2; `?.` warning. Pass 11 4100→sse verified ✓

### J0p8oYkONmN7pYn6 3A-workflow-backup
- **§19:** Workflow Backup — **Node count:** 8 — **Verdict:** MINOR
- **Findings:** Daily 3 AM ET scheduleTrigger@1.2→1.3; 4× httpRequest@4.2; Format Backup Payload + Store Backup Code throws-advisories; missing `$` prefix + `?.` warnings on Alert on Error. Pass 11 fixes verified: JWT→env, `.workflowCount`→`$json.workflowCount`, `.id`→`$json.id` ✓ Was CRITICAL, now MINOR.

### RumAJUp4iS1TYlNm 6D-compliance-gate
- **§19:** Compliance Gate — **Node count:** 10 — **Verdict:** NEEDS_FIX (validator framework error only)
- **Findings:** Same "match" framework error. Node-level: Cron@1.2→1.3; 4× httpRequest@4.2; Any Paper? IF@2.2→2.3 + missing `continueErrorOutput`; Code throws-advisories; `?.` warning.

### WT9sVMzG83rg1L29 Daily Compliance Check
- **§19:** Compliance (daily) — **Node count:** 9 — **Verdict:** MINOR
- **Findings:** 3 Code throws-advisories; Any Stale Firms? missing `continueErrorOutput`. Pass 11 sse-broadcast fix verified ✓

### gFwNlA3eCHbSb7en Pre-Session Compliance Gate
- **§19:** Compliance pre-session (C2 safety) — **Node count:** 9 — **Verdict:** MINOR
- **Findings:** 3 Code throws-advisories; Any Blocked Strategies? missing `continueErrorOutput`. Pass 11 sse fix verified ✓

### eaq72MwKwCjv7g7F Pre-Session Skip Check
- **§19:** Skip Engine pre-session — **Node count:** 13 — **Verdict:** MINOR
- **Findings:** 4 Code throws-advisories; Any REDUCE Decisions? missing `continueErrorOutput`. Pass 11 sse fix verified ✓

### LayXj1mbHh4aGSM9 Post-Session Skip Review
- **§19:** Skip Engine post-session — **Node count:** 8 — **Verdict:** MINOR
- **Findings:** Format Review Report Invalid $ usage; 2 Code throws-advisories.

### YuDGQkuej7qybPAB Weekly Compliance Re-Parse
- **§19:** Compliance weekly — **Node count:** 10 — **Verdict:** MINOR
- **Findings:** 3 Code throws-advisories; Process Each Firm SplitInBatches has main[1] error wiring without `continueErrorOutput`; advisory note about loop-output index 0 vs 1 wiring (verify intent — Aggregate Weekly Report on `done` output is correct for end-of-loop aggregation).

### X2IjKuYseGukxKDj Macro Data Sync
- **§19:** Macro Ingest C11 — **Node count:** 12 — **Verdict:** MINOR
- **Findings:** 3 Code throws-advisories; Any Source Failed? missing `continueErrorOutput`. Pass 11 host.docker.internal + dropped `body` param fixes verified ✓

### PHcD2tFZpzr7kQGF Anti-Setup Refresh
- **§19:** Anti-Setup Mining — **Node count:** 12 — **Verdict:** MINOR
- **Findings:** Parse Mining Results + Aggregate Final Report Invalid $ usage (2 nodes); 3 Code throws-advisories; Has Strategies? + Loop Over Strategies missing `continueErrorOutput`; Loop Over Strategies aggregation-output advisory.

### m6aD7X4ioWfhWaS9 Monthly Robustness Check
- **§19:** Monthly Robustness (C8 safety) — **Node count:** 14 — **Verdict:** MINOR
- **Findings:** Compare Metrics Invalid $ usage + throws-advisory; Alert on Error httpRequest@4.2; 3 IF nodes (Degraded?, Loop Over Strategies, Job Complete?) missing `continueErrorOutput`; Long linear chain (11). Pass 11 sse fix verified ✓ Note: Pass 11 audit flagged a duplicate node-id (`compare-metrics`/`check-job-complete` at same position) — validator did not surface it; either resolved or non-fatal.

### u0RcmfuClgRinXAX Daily Portfolio Monitor
- **§19:** Portfolio Monitor — **Node count:** 14 — **Verdict:** MINOR
- **Findings:** 2 Code throws-advisories; 3 IF nodes (Any DEPLOYED, Detect Drift, Loop Over Strategies) missing `continueErrorOutput`.

---

## Verification of Pass 11 fixes (Phase 0 spot-check)

Grep over post-fix snapshots in `tmp-n8n/wf-*.json` (excluding `-phase2-pre.json` and `-phase3-pre.json`):
- Port 4100 references in current snapshots: **0** (was 102 in pre-fix snapshots)
- Hardcoded API keys (Brave/Tavily/Parallel.ai/n8n JWT): **0**
- `localhost:4000` in HTTP nodes: **0** (Macro Data Sync converted)
- `host.docker.internal:4000` references: **101** (correct dev posture)
- `.workflowCount` / `.id` legacy expressions: **0** (3A backup fixed)
- `promptType: "auto"`: **0** (all AI Agents on `"define"`)
- All deprecated `body` param + `jsonBody` co-existence: **0**
- Webhook `authentication: "headerAuth"`: 1 (eCr7 Bearer-auth in place)

All Pass 11 fixes verified intact. Plan's 7 known bugs all confirmed present in current state for Phase 1 to address; no new CRITICAL findings beyond them.

---

## Recommended Phase 2 work clusters (sized for planning)

- **Cluster A (typeVersion bumps):** ~95 nodes across 22 workflows. Bulk-bump httpRequest@4.2→4.4, scheduleTrigger@1.2→1.3, if@2/2.2→2.3, merge@3→3.2, executeWorkflowTrigger@1→1.1, lmChatOpenAi@4.2→4.4. Pure additive — no behavior change. Single mass migration.
- **Cluster B (IF onError continueErrorOutput):** ~24 nodes across 17 workflows. All existing main[1] error wiring already correct semantically; n8n now requires explicit `onError: "continueErrorOutput"` on the IF/SplitInBatches node so error route fires. Mechanical edit per node.
- **Cluster C (Code-node onError):** advisory-only; ~66 nodes. Defer unless paired with B.
- **Cluster D (toolDescription):** 5 vector-store / agent-tool nodes (Z4 ×3, sAIr ×2). Required for proper LLM tool routing — ~15 min total.
- **Cluster E (primitive-return Code nodes):** 4 nodes — Z4 `Format Scout Context`, sAIr `Format Scout Context`, 7PgUY `Shape News Results`, 4qVyx `Filter Long-Form`. Wrap return in `[{json:...}]` shape.
- **Cluster F (`$node['x']` → `$('x')`):** ~12 nodes. Mechanical syntax migration; runtime works today but n8n deprecating.
- **Cluster G (`?.` cosmetic warnings):** ~14 nodes. Replace with `&&`-guarded reads. Cosmetic-only — runtime correct.
- **Cluster H (AI Agent systemMessage):** 6 nodes (eCr7 ×2, Z4 ×2, sAIr ×2). Add explicit Trading Forge identity + guardrails. Pass 11 Phase 2 already added systemMessage to Generate-Strategies-style nodes; remaining gap is the *Critic*-side AI Agents which still rely on user-prompt-only.
- **Cluster I (lmChatOpenAi onError):** 6 nodes. Pair with H.
- **Cluster J (orphan sub-graph false positives):** 27 nodes. Validator can't see implicit `ai_*` tool connections — verify by manually following AI Agent's tool sockets. If genuinely orphaned, delete; if RAG sockets are wired, leave alone (validator limitation).
- **Cluster K (eCr7 cycle):** 1 graph. Iteration loop is intentional (Check Iteration Limit short-circuits); validator flags graph-level cycle. Document as intentional or refactor to flat-then-execute-workflow loop.
- **Cluster L (eCr7 webhook credential):** 1. Operator action — create n8n credential `trading_forge_strategy_gen_token` with header value `Bearer a8caa8dae7d2b3c1fe40971b9d2bb5aeed42184e03c57e03c361dbe2715e81f5` (token from Pass 11 Phase 3).
- **Cluster M (validator framework "match" error):** 3 workflows (7A, 9A, 6D). Likely an n8n-mcp validator bug parsing certain cron expressions; not a workflow defect. Re-test after MCP server upgrade or report upstream.
- **Cluster N (long-chain refactor advisories):** 5 workflows. Defer indefinitely — refactor cost > benefit for stable cron jobs.

Path: `C:\Users\tonio\Projects\trading-forge\trading-forge\tmp-n8n\n8n-pass-12-node-inventory.md`
