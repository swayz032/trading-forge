# Pass 11 Phase 1 — Rollback Tracking

Generated: 2026-05-05
Validation pass rate: 12/12 (100%)
All workflows pass `n8n_validate_workflow` with `valid: true` (only pre-existing warnings: outdated typeVersions, optional-chaining `?.` notices, and code-node static-analysis advisories — no errors introduced).

To roll back any workflow, use `mcp__n8n-api-mcp__n8n_workflow_versions` to list versions and `n8n_update_full_workflow` with the pre-fix snapshot.

| # | Workflow ID | Name | Pre-fix versionId | Change |
|---|---|---|---|---|
| 1 | `lUenVARPUG1uz4OE` | 5K-parallel-deep-research | `72a7e8ab-bdf6-4aec-870e-6d882fd851c0` | A: Parallel.ai key → `$env.PARALLEL_API_KEY`; B: added `signal_type: "strategy_candidate"`; C: error-alert 4100 → `/api/sse/broadcast` |
| 2 | `F6i4JoTdxgiyjHhM` | 5L-quant-blog-harvester | `357c6b95-e80d-47c8-b17c-06fb7517b1a1` | A: Tavily key → `$env.TAVILY_API_KEY`; B: added `signal_type: "research_find"`; C: error-alert 4100 → `/api/sse/broadcast` |
| 3 | `4qVyxZd29pQkGn9p` | 5N-brave-video-discoverer | `3d7f4113-a923-43c4-bade-c1e4d10b11ee` | A: Brave key → `$env.BRAVE_API_KEY`; C: error-alert 4100 → `/api/sse/broadcast` |
| 4 | `J0p8oYkONmN7pYn6` | 3A-workflow-backup | `b8855153-cf6e-4937-ab74-b03b1d08fb89` | A: 2× n8n JWT → `$env.N8N_API_KEY`; fix `.workflowCount`/`.timestamp` → `$json.*`; fix `{{ .id }}` → `{{ $json.id }}`; add empty `parameters: {}` to On Error trigger |
| 5 | `8HKXzNmo9KF59SBu` | 10A-master-orchestration | `77dc4113-1ef5-4753-a2d6-430e8a8924b3` | C: Alert on Error 4100 → `/api/sse/broadcast` (channel=alerts, event=workflow:error) |
| 6 | `WT9sVMzG83rg1L29` | Daily Compliance Check | `570086cc-0766-407c-843f-b7bf4f9eeb99` | C: Send Error Alert 4100 → `/api/sse/broadcast` |
| 7 | `gFwNlA3eCHbSb7en` | Pre-Session Compliance Gate | `52a76b48-8fbf-41a9-8024-afa7c5e10ebd` | C: Send Error Alert 4100 → `/api/sse/broadcast` |
| 8 | `eaq72MwKwCjv7g7F` | Pre-Session Skip Check | `013a77cd-42bc-442c-a948-a928457efb01` | C: POST Error Alert 4100 → `/api/sse/broadcast` |
| 9 | `m6aD7X4ioWfhWaS9` | Monthly Robustness Check | `309371e5-9025-4871-bd4b-51b9e08864f1` | C: Alert on Error 4100 → `/api/sse/broadcast` |
| 10 | `66HEjQavpvirY6g5` | 0A-health-monitor | `029ba885-a1e8-4b98-b473-751b969c81c3` | C: Create Workflow Error Alert 4100 → `/api/sse/broadcast` (Discord Bot health PROBE on port 4100 left intact — intentional) |
| 11 | `v4eSeAoaEErYp472` | 0Z-openclaw-daily-report | `0851b426-50c6-440e-a76c-04fdd16b766e` | C: POST Error to workflow-errors 4100 → `/api/sse/broadcast` |
| 12 | `BbCvlV1ARyyvY3NI` | ZZ-global-error-handler ⚠ CRITICAL | `29be7f6b-81e6-4024-9d60-a2b980f6d1ac` | C: Post to Discord workflow-errors 4100 → `/api/sse/broadcast` — closes the system-wide silent-error-drop hole |
| 13 | `X2IjKuYseGukxKDj` | Macro Data Sync | `880be064-33a2-4654-9eac-b76bb72da4ba` | D: localhost:4000 → `host.docker.internal:4000` (sync + current routes); dropped deprecated `body` param on 3 SSE-broadcast nodes; kept `jsonBody` only |

**Post-fix versionIds:** retrieve live via `mcp__n8n-api-mcp__n8n_get_workflow id=<id>` (versionId field). All 13 workflows updated 2026-05-05 ~04:27-04:28 UTC.

---

## Pass 11 Phase 2 — Symbol-aware prompt rewrites (2026-05-05)

Pre-fix JSON snapshots saved at `tmp-n8n/wf-<id>-phase2-pre.json`.

| # | Workflow ID | Name | Pre versionId | Post versionId | Change |
|---|---|---|---|---|---|
| 14 | `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | `4cc8464f-f45f-4f92-b0ac-9b14bcc243f6` | `76010f35-68cc-4296-a25f-071937dd0a4c` | Rewrote `Generate Strategies` agent: system message → multi-symbol Trading Forge identity (MES/MNQ/MCL micros only); user prompt → 15 strategies (5 MES + 5 MNQ + 5 MCL) conforming to StrategyDSL schema with explicit symbol enum, max 5 entry_params, regime distribution. `promptType` already `"define"`. Detect Market Regime kept on MES (equity proxy) — multi-symbol regime fetch punted to follow-up. |
| 15 | `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | `612445c9-bfcc-4885-aaff-cf7a8c7299e1` | `98e7d8fb-b631-4971-a5a9-634bcbaf266d` | `Generate 9 Strategies`: ES/NQ/CL → MES/MNQ/MCL micros (3 each); added systemMessage; switched to `promptType:"define"` with explicit symbol enum + StrategyDSL constraints. `AI Critique Passing Strategies`: added MES/MNQ/MCL-only context, `promptType:"define"`. Output shape kept as `python_code` (NOT switched to StrategyDSL JSON) — see follow-up below. |
| 16 | `hPXhUaSC3ScznZE9` | Strategy Tournament | `76bb9fd4-1c17-43dd-ae43-52a1d235d006` | `c7cb7ed4-a7e0-4c34-b8d4-8eeef2418ad3` | `Proposer (qwen3)`: tightened system prompt to enumerate `symbol ∈ {MES, MNQ, MCL}` EXACTLY (never ES/NQ/CL big contracts); added round-number-param guidance; user prompt now instructs proposer to pick best-fit symbol from the three approved micros. |

### Validation results (Phase 2)
- `hPXhUaSC3ScznZE9` — `valid: true`, 0 errors, 17 pre-existing warnings.
- `Z4NcOCDbet8KzjDd` — `valid: false`, 4 errors — ALL pre-existing in nodes I did NOT touch (`Format Scout Context for LLM` primitive return, missing `toolDescription` on 3 vector-store/agent-tool nodes). My edits introduced ZERO new errors.
- `sAIrnCVB4iOsodsy` — `valid: false`, 1 error — pre-existing in `Format Scout Context for LLM` (primitive return). My edits introduced ZERO new errors.

### Follow-ups flagged
1. **sAIr output-shape change (StrategyDSL JSON):** Phase 2 instructions specified converting sAIr's output from `python_code` to StrategyDSL JSON. INVESTIGATED — downstream consumer is `POST /api/agent/batch` (`agent.ts:239`), which validates against `runStrategySchema` requiring `python_code: z.string().min(1)`. Switching sAIr to DSL would break the batch endpoint contract. Recommended follow-up: either (a) migrate sAIr to call `POST /api/agent/run-from-dsl` per strategy (replaces `POST Batch to Backtest Agent` HTTP node), or (b) extend batch endpoint to accept either `python_code` OR `dsl`. Symbol conversion (ES→MES, NQ→MNQ, CL→MCL) was completed since it does NOT alter the output shape.
2. **Z4 multi-symbol regime fetch:** Plan suggested fetching regimes for ES, NQ, CL underlyings and injecting all 3 into the prompt as JSON. Punted to follow-up because it requires structural rewiring (replacing the single `Detect Market Regime` HTTP node with either a 3-call loop or a Code node using `$helpers.httpRequest`). Current state: regime is fetched once for MES (equity proxy) and the prompt explicitly instructs the model to treat it as a directional hint rather than a constraint — safe behavior, no false-regime risk, but lower fidelity than full multi-symbol.
3. **Pre-existing validation errors (Z4 + sAIr):** `Format Scout Context for LLM` returns primitive values; vector-store tools missing `toolDescription`. Out of Phase 2 scope. Should be addressed in a future hardening pass.

---

## Pass 11 Phase 3 — Webhook Bearer-token authentication (2026-05-05)

Pre-fix JSON snapshot saved at `tmp-n8n/wf-eCr7cyb0aPArFCZc-phase3-pre.json`.

| # | Workflow ID | Name | Pre versionId | Post versionId | Change |
|---|---|---|---|---|---|
| 17 | `eCr7cyb0aPArFCZc` | Strategy Generation Loop | `b5edde50-78ed-4a03-99ea-a598884c6f65` | live (versionNumber 70, id 911 — fetch via `n8n_get_workflow id=eCr7cyb0aPArFCZc` for current versionId) | `Webhook Trigger` (path `trading-forge/generate`, POST): `parameters.authentication: "headerAuth"`; `credentials.httpHeaderAuth.name: "trading_forge_strategy_gen_token"`. Operator must create the matching credential in n8n UI with header name `Authorization` and header value `Bearer <token>`. |

### Validation results (Phase 3)
- `valid: false`, 3 errors — ALL pre-existing (workflow cycle, Discord template-literal syntax). Phase 3 introduced ZERO new errors. The single new warning (`Webhook Trigger: Missing credentials configuration for httpHeaderAuth`) clears once operator creates the credential in n8n UI.

### Backend callers found
NONE. Grep across the entire repo (TS/JS/MJS/CJS/TSX) for `trading-forge/generate`, `webhook.*generate`, `N8N_WEBHOOK`, `n8n.*webhook` returned zero matches in `src/`. The only references live in n8n workflow JSON exports (`workflows/n8n/`, `tmp-n8n/`) and one docs plan file. Conclusion: this webhook is invoked manually or by external systems (operator tooling, Postman, curl, n8n internal triggers from other workflows that I did not find using these search patterns). No backend Bearer-header injection required.

### Generated token (32-byte hex, for operator)
`a8caa8dae7d2b3c1fe40971b9d2bb5aeed42184e03c57e03c361dbe2715e81f5`

---

## Pass 11 Phase 6 — Drift detector close-out (2026-05-05)

Closed the 9 LIVE violations the Phase 6 drift detector found that Phase 1's coverage missed. POST-FIX snapshots overwritten at `tmp-n8n/wf-<id>.json`.

| # | Workflow ID | Name | Pre versionId | Post versionId | Change |
|---|---|---|---|---|---|
| 18 | `7PgUY6Wa07aZbAPX` | 5M-brave-news-watcher | `e1116ac5-a2c1-4ac6-aa32-24b86bb71813` | `935a7f93-789c-4e13-89b3-a5e413b00afc` | A: hardcoded Brave key `BSAgu5P1nU6-AGkVyT5faLz63AphY18` → `{{ $env.BRAVE_API_KEY }}` (replaced full `headerParameters` object — array-index dot-paths failed per Pass 5 known issue); C: `POST workflow-errors` 4100 → `/api/sse/broadcast` |
| 19 | `Ep2Zsu33tMOsaJbE` | 5J-unified-search-router-scout | `f20bbe99-ef52-498b-b388-167fe7dc7ed0` | `73190e95-3835-4d77-9a79-745d9cbd8d64` | B: `POST /agent/scout-ideas (legacy)` jsonBody now explicitly emits `signal_type` literal in body (was passing through `JSON.stringify($json)` from upstream Code node — runtime-correct but detector regex couldn't see it); C: `POST workflow-errors` 4100 → `/api/sse/broadcast` |
| 20 | `lUenVARPUG1uz4OE` | 5K-parallel-deep-research | `84469a28-5384-4435-8692-dc96506c12d2` | `d7d4008f-bbeb-40aa-8d96-ec3ae8a0ca3b` | C: `POST strategy-finds (Discord)` 4100 → `/api/sse/broadcast` (channel=alerts, event=strategy:find) — Phase 1 fix missed this; the error-alert node was already redirected |
| 21 | `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | _(captured at start of phase)_ | `d169f78f-7408-4eaf-ad79-1352ed9791ad` | C: `Discord: Nightly Research Error` 4100 → `/api/sse/broadcast`; converted backtick template literals (`${}`) to string concatenation per n8n expression validator |
| 22 | `eCr7cyb0aPArFCZc` | Strategy Generation Loop | _(captured at start of phase)_ | `59f2ada8-aef6-4bb6-9a62-faef2022373c` | C: `Discord: Strategy Gen Error` 4100 → `/api/sse/broadcast`; backtick template literal → string concatenation |
| 23 | `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | _(captured at start of phase)_ | `8bdaf70d-f008-469c-8f06-f0e6086d7437` | C: `Discord: Weekly Scout Error` 4100 → `/api/sse/broadcast`; backtick template literal → string concatenation |
| 24 | `J8K0PfErL2v4W9Zw` | 5O-supadata-transcript-pipeline | `c28c5f4a-6bcb-4df2-aa94-82fee76e1803` | `c9c72520-87d7-4445-8b80-5e01363f7bec` | C: `POST workflow-errors` 4100 → `/api/sse/broadcast` |

### Drift detector re-run (final)
```
node scripts/audit-n8n-workflows.mjs
Listing active workflows from http://localhost:5678…
Auditing 30 active workflows…
Total violations: 0
EXIT=0
```
Phase 7 verification gate: PASS.

### False positives confirmed
- **5J `signal_type`**: Phase 0 reported it was set; Phase 6 detector reported missing. Both were technically correct: the upstream `Shape to Strict Scout Schema` Code node DID set `signal_type: 'strategy_candidate'` and the body shipped `JSON.stringify($json)` — runtime payload was correct. The detector regex (`/\bsignal_type\b/` over `params.jsonBody`) only inspects the literal node body string, not upstream Code-node outputs. To make the detector and runtime agree, the body now explicitly maps `signal_type` per idea. **Detector regex enhancement candidate**: trace `JSON.stringify($json)` bodies upstream through the connection graph, or accept Code-node outputs as authoritative if the upstream node's `jsCode` contains `signal_type:`.
- **Validator template-literal errors on Discord nodes**: pre-existing (the original 4100 bodies used backticks too). Closed opportunistically while rewriting the bodies for the redirect — not strictly a Phase 6 violation, but left as-is would have re-flagged.
