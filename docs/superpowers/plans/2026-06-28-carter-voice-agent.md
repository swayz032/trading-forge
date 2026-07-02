# Carter Voice Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Carter" — an ElevenLabs voice agent in the Slumhouse Office that is the operator's professional, plain-spoken nerve-center for ALL of Trading Forge: he sees and reports every subsystem, runs safe work himself, proposes risky work for voice confirmation, and can never bypass a gate or risk capital.

**Architecture:** A pre-existing ElevenLabs agent (`agent_8201kw8asnenf938f3nxkdx9m2r5`, voice "Eric") is configured server-side (brain = Claude Sonnet 4.5, RAG knowledge base, persona). The browser connects via the `@elevenlabs/client` SDK using a short-lived WebRTC token minted by our tower (mirroring the existing `anam-session.ts` pattern — the API key never reaches the browser). Carter's brain reaches Trading Forge through a single **registry-driven** `carter-tools` backend router (`/api/carter/*`), HMAC-secured, which reuses existing service libs and writes an `audit_log` row (`decision_authority='voice_agent'`) for every call. A canonical tool registry + a contract test guarantee every tool is wired on BOTH ends (agent ↔ backend). Tools are tiered GREEN (auto) / YELLOW (voice-confirm) / RED (no tool path — gate/UI/HMAC only).

**Tech Stack:** TypeScript (Express 5, Drizzle ORM, vitest), Python engine (unchanged this plan), ElevenLabs Agents Platform (REST + `@elevenlabs/client` SDK, Flash v2.5 voice, Sonnet 4.5 brain), three.js (immersive blob), static HTML (`public/slumhouse/office.html`).

---

## Global Conventions & Guardrails (READ FIRST — apply to every task)

These are non-negotiable; violating any one is a wave failure.

1. **Isolation:** All work happens in a dedicated git worktree `feature/carter-voice-agent` (Wave 0 Task 0.1). The repo working tree is SHARED with other Claude sessions — **never `git add -A`**; commit ONLY your files by explicit path: `git commit -- <path1> <path2>`. Verify with `git show <hash> --stat`.
2. **Commit-and-push after every GREEN task** (HARD RULE, AGENTS.md §11). Do not batch.
3. **Tests:** every backend unit uses vitest. `lib/` helpers import the logger from `./logger.js` (leaf), NEVER `../index.js`. Cite pass counts; never say "should pass."
4. **CI hard gates** must be GREEN at every wave exit: `npm run check:production-isolation`, `npm run check:2026-compliance`, `npm run system-map:check`. Plus `npx tsc --noEmit` clean on touched files.
5. **Migrations** (only Wave 4 needs one): idempotent (`CREATE TABLE IF NOT EXISTS`), claim the next number, AND add the `_journal.json` entry in the SAME commit (boot-runner phantom-applies orphans). Verify with a pglite dry-run applied twice.
6. **audit_log** has NO `payload` column — use `input`/`result` (JSONB) + a non-null `status`; it is APPEND-ONLY (never UPDATE/DELETE). Write via `insertAuditRowSafe`/`insertAuditRow` (`src/server/lib/audit-log-helper.ts`). Add a new `decision_authority` value `'voice_agent'`.
7. **No gate bypass, ever.** Carter tools must: never send `compliance_mode='shadow'`; never set/override any gate threshold env (B14/WFE/PBO/DSR/payout); always pass `firms=['topstep_50k','mffu_50k']` to Monte Carlo; honor HTTP 423 (pipeline paused — not an error to retry around) and 429 (backpressure — report, don't hammer). RED actions have NO tool path at all.
8. **Secrets** stay server-side (`.env`/Bitwarden): `ELEVENLABS_API_KEY` (already set), `CARTER_AGENT_ID`, `CARTER_TOOLS_HMAC_SECRET`, `CARTER_POST_CALL_WEBHOOK_SECRET`. Carter never voices a secret.
9. **Every wave ends with an Adversarial Exit Gate** (see "Exit Gate Protocol") — a fresh `accuracy-validator` subagent independently re-verifies the wave's claims against live code/tests. A wave is NOT done until that agent returns CLEAN. This is how we avoid "scanning for bugs later."
10. **Registry-driven wiring (anti-drift core):** `src/server/lib/carter/tool-registry.ts` is the single source of truth for every Carter tool. The agent config script reads it to register webhook tools on ElevenLabs; the route reads it to validate; a contract test (`carter-tool-registry.contract.test.ts`) fails if any registry tool lacks a backend handler or any handler is missing from the registry. No tool is "done" until it's in the registry, has a handler, has a unit test, AND is registered on the agent.

### Exit Gate Protocol (run at the end of EVERY wave)
- [ ] `npx tsc --noEmit` clean on touched files
- [ ] `npx vitest run <wave test files>` — cite N pass / 0 fail
- [ ] `npm run check:production-isolation && npm run check:2026-compliance && npm run system-map:check` — all exit 0
- [ ] `npm run system-map:sync` if any subsystem/route/cron/migration was added; commit the map
- [ ] **Live smoke** for the wave's headline behavior (cite the actual output)
- [ ] **Adversarial verify:** dispatch `accuracy-validator` with the wave's claims + file:line list; it must independently confirm via a second path (run the tests itself, curl the route, read the agent config back from ElevenLabs). Returns CLEAN or a defect list.
- [ ] Fix every defect the validator finds IN THIS WAVE (zero carry-forward), re-run the gate.
- [ ] Commit + push by explicit path.

### Subagent Roster (Claude Code agents per wave)
| Wave | Build agents | Verify agents |
|---|---|---|
| 0 Foundation/Session | `trading-forge-architect`, `general-purpose` | `accuracy-validator`, `autonomous-readiness` |
| 1 Brain/Persona/KB | `general-purpose` (ElevenLabs REST/CLI), `trading-forge-architect` | `accuracy-validator` |
| 2 Read tools | `observability-reliability`, `trading-forge-architect` | `accuracy-validator` |
| 3 Run tools | `backtest-core`, `paper-parity`, `critic-optimizer` | `accuracy-validator`, `backtest-core` |
| 4 Watcher/Briefing | `observability-reliability` | `accuracy-validator`, `autonomous-readiness` |
| 5 Confirm-actions | `trading-forge-architect`, `paper-parity` | `accuracy-validator` (adversarial: try to make Carter act without confirm) |
| 6 UI/Blob (LAST) | `general-purpose` (frontend), `pine-export` (n/a) | `accuracy-validator`, manual operator verify |

---

## File Structure (locked decomposition)

**New backend files**
- `src/server/routes/slumhouse/api/carter-session.ts` — mints the WebRTC conversation token (mirror of `anam-session.ts`).
- `src/server/routes/carter-tools.ts` — the `/api/carter/*` router the ElevenLabs agent calls (HMAC-gated, registry-driven dispatch).
- `src/server/routes/carter-webhook.ts` — ElevenLabs post-call webhook → `audit_log` (HMAC-verified).
- `src/server/lib/carter/tool-registry.ts` — canonical tool list + JSON schemas + tier (GREEN/YELLOW/RED) — single source of truth.
- `src/server/lib/carter/carter-auth.ts` — HMAC verify for the `/api/carter` plane + post-call webhook.
- `src/server/lib/carter/carter-reads.ts` — read tool implementations (reuse existing libs).
- `src/server/lib/carter/carter-actions.ts` — GREEN run-tools + YELLOW confirm-tools (with confirmation-token protocol).
- `src/server/lib/carter/carter-confirm.ts` — issue/verify short-lived confirmation tokens for YELLOW actions.
- `src/server/lib/carter/carter-issues-store.ts` — in-memory current-issues store (+ DB-backed snapshot table, Wave 4).
- `src/server/services/carter-issue-watcher.ts` — subscribes to SSE bus + health poll → issues store.
- `scripts/carter/configure-agent.ts` — pull + patch the ElevenLabs agent (LLM/voice/turn/prompt/tools/KB/auth) from the registry.
- `scripts/carter/build-knowledge-base.ts` — assemble docs + glossary, upload, index, attach to agent.
- `scripts/carter/carter-glossary.md` — plain-English glossary (authored content).
- `scripts/carter/smoke-conversation.ts` — text-mode conversation smoke test against the live agent.

**New frontend files (Wave 6)**
- `public/slumhouse/carter.html` — immersive black overlay page (or overlay module — see Wave 6).
- `public/slumhouse/assets/carter-blob.js` — three.js audio-reactive blob.
- Modify: `public/slumhouse/office.html` — add the "Carter" coverflow card + Connect button.

**Modified backend files**
- `src/server/routes/slumhouse/index.ts` — register `carterSessionRouter`.
- `src/server/index.ts` — mount `carter-tools` (`/api/carter`) + `carter-webhook`; start `carter-issue-watcher`.
- `src/server/routes/slumhouse/admin.ts` — extract `computeSwitchStates()` (Wave 2) so reads work without the admin cookie.
- `src/server/lib/audit-log-helper.ts` — allow `decision_authority='voice_agent'`.
- `src/server/db/schema.ts` + migration — `carter_issues` snapshot table (Wave 4).
- `docs/system-subsystem-registry.json` — register new subsystems (via `system-map:sync`).
- `.env` — new vars (Wave 0).

---

## WAVE 0 — Foundation, Isolation & Secure Session

**Objective:** A worktree, env wiring, the existing agent audited, and a working server-minted WebRTC token route. No agent behavior yet.

### Task 0.1: Create isolated worktree + branch
- [ ] **Step 1:** From `C:\Users\tonio\Projects\trading-forge\trading-forge`, run `git status -sb` to record the current branch.
- [ ] **Step 2:** `git worktree add ../tf-carter -b feature/carter-voice-agent` (isolates from the shared `hardening/phase-0` tree). All subsequent work happens in `../tf-carter`.
- [ ] **Step 3:** Confirm `git -C ../tf-carter status -sb` shows the new branch. Commit nothing yet.

### Task 0.2: Register env vars
**Files:** Modify `.env`; Modify `src/server/lib/credential-loader.ts` (cite the existing key-load list).
- [ ] **Step 1:** Append to `.env` (values: agent id known; generate two 32+ char secrets):
```
CARTER_AGENT_ID=agent_8201kw8asnenf938f3nxkdx9m2r5
CARTER_TOOLS_HMAC_SECRET=<openssl rand -hex 32>
CARTER_POST_CALL_WEBHOOK_SECRET=<set after Wave 1 webhook config>
```
- [ ] **Step 2:** Add `CARTER_AGENT_ID`, `CARTER_TOOLS_HMAC_SECRET`, `CARTER_POST_CALL_WEBHOOK_SECRET` to the credential-loader key list (Read it first; follow the existing pattern). Add a `/api/health` presence flag `carterConfigured` next to the existing `apifyConfigured` flag (`src/server/index.ts:393` precedent).
- [ ] **Step 3:** `git commit -- .env src/server/lib/credential-loader.ts src/server/index.ts -m "feat(carter): register env vars + health flag"`

### Task 0.3: Audit the existing Carter agent
- [ ] **Step 1:** Write `scripts/carter/audit-agent.ts` that GETs `https://api.elevenlabs.io/v1/convai/agents/${CARTER_AGENT_ID}` with `xi-api-key` and prints the full JSON (current prompt, first_message, LLM, voice, tools, KB, auth/allowlist).
- [ ] **Step 2:** Run it. Save output to `scripts/carter/agent-baseline.json` (gitignored — may contain config but no secrets). Expected: voice `cjVigY5qzO86Huf0OWal` (Eric); note whatever LLM/prompt/tools exist so Wave 1 patches rather than blind-overwrites.
- [ ] **Step 3:** Commit the script: `git commit -- scripts/carter/audit-agent.ts`

### Task 0.4: `carter-session` token-mint route (TDD)
**Files:** Create `src/server/routes/slumhouse/api/carter-session.ts`; Test `src/server/__tests__/slumhouse/carter-session.test.ts`; Modify `src/server/routes/slumhouse/index.ts`.
- [ ] **Step 1 — Read precedent:** Read `src/server/routes/slumhouse/api/anam-session.ts` in full. Carter's route mirrors it 1:1 with these diffs: const `CARTER_AGENT_ID = process.env.CARTER_AGENT_ID`; reads `ELEVENLABS_API_KEY`; calls `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${CARTER_AGENT_ID}` with header `{ "xi-api-key": apiKey }`; returns `{ conversationToken: data.token }`; error envelopes `503 elevenlabs_api_key_missing`, `502 elevenlabs_upstream_failed {status,detail}`, `502 elevenlabs_no_token`, `500 carter_mint_failed`; gated by `requireSlumhouseUser`.
- [ ] **Step 2 — Write failing test:** assert (a) 503 when `ELEVENLABS_API_KEY` unset, (b) returns `{conversationToken}` when upstream returns `{token:'x'}` (mock `fetch`), (c) 502 when upstream not-ok, (d) route requires session (401 without). Run: `npx vitest run src/server/__tests__/slumhouse/carter-session.test.ts` → FAIL.
- [ ] **Step 3 — Implement** the route + `export const carterSessionRouter`.
- [ ] **Step 4 — Register:** in `src/server/routes/slumhouse/index.ts`, import `carterSessionRouter` (next to `anamSessionRouter`, ~line 21) and `slumhouseRouter.use(carterSessionRouter)` (~line 113).
- [ ] **Step 5 — Run test:** PASS (cite count).
- [ ] **Step 6 — Live smoke:** with the server running, `curl` the route with a valid `slumhouse_sid` cookie → expect a real `conversationToken`. (If no agent auth yet, token still mints.)
- [ ] **Step 7 — Commit** by explicit path.

### Task 0.5: Set agent to PRIVATE + hostname allowlist
- [ ] **Step 1:** Via `scripts/carter/configure-agent.ts` (created here, extended in Wave 1) PATCH `platform_settings.auth.enable_auth=true` and `platform_settings.auth.allowlist` = the Slumhouse host(s) + `localhost:<port>`.
- [ ] **Step 2:** Re-run `audit-agent.ts`; confirm `enable_auth=true` and allowlist set.
- [ ] **Step 3:** Commit the script.

### Wave 0 Exit Gate
- [ ] Run the Exit Gate Protocol. Live smoke = a real `conversationToken` minted via the route. Adversarial verify: `accuracy-validator` independently curls the route (503 path + success path) and confirms `enable_auth=true` on the agent. `autonomous-readiness` confirms the route fails-closed when the key is missing (no silent open).

---

## WAVE 1 — Brain, Persona & Knowledge Base

**Objective:** Carter knows Trading Forge cold and speaks correctly. After this wave you can hold a real (text-mode) conversation and he answers from the KB.

### Task 1.1: Author Carter's system prompt
**Files:** Create `scripts/carter/carter-system-prompt.md`.
- [ ] **Step 1:** Write the prompt covering: identity (Carter, operator's Trading Forge nerve-center); register (professional, calm, concise, **plain-English, NO slang**, translate MC/ruin/Sharpe/WFE/PBO/DLL to simple terms); the connect-briefing behavior (lead with current issues, then converse); **tool discipline** (only state a status he actually retrieved via a tool — never fabricate gate results; cite numbers from tool output); **governance discipline** (he can run GREEN work freely; for YELLOW he must read back the action + get an explicit "confirm" before calling the confirm-tool; for RED he refuses and explains it's gate/operator-UI-only and why); how to use dynamic variables (operator name, current view).
- [ ] **Step 2:** Commit.

### Task 1.2: `configure-agent.ts` — set brain/voice/turn/prompt
**Files:** Extend `scripts/carter/configure-agent.ts`.
- [ ] **Step 1:** Script PATCHes the agent: `conversation_config.agent.prompt.prompt` = system prompt file contents; `prompt.llm` = `claude-sonnet-4-5`; enable LLM cascading (Default); `tts.model_id` = `eleven_flash_v2_5`; voice = Eric (`cjVigY5qzO86Huf0OWal`); `conversation_config.turn` = interruptions on, `turn_eagerness='normal'`, `turn_timeout≈6`, `soft_timeout≈3`; `first_message` = a short dynamic greeting that triggers the connect-briefing (final wiring in Wave 4 — for now a static professional greeting).
- [ ] **Step 2:** Run it; re-run `audit-agent.ts`; confirm LLM=`claude-sonnet-4-5`, voice=Eric, model=flash_v2_5.
- [ ] **Step 3:** Commit.

### Task 1.3: Plain-English glossary
**Files:** Create `scripts/carter/carter-glossary.md`.
- [ ] **Step 1:** Author plain-English definitions for every concept Carter must explain: lifecycle states (CANDIDATE→…→DEPLOYED, GRAVEYARD), B14/ruin-CI, WFE, PBO, BIF, DSR, WRC/SPA, B15 battery, frozen-policy, DLL bands, Style C, confluence score, conveyor, scout/graduator, shadow/RL challenger, the 4 Office switches, prop-firm rules (Topstep EOD / MFFU). Source the definitions from `CLAUDE.md` §4/§12, the System Map, prop-firm docs.
- [ ] **Step 2:** Commit.

### Task 1.4: Build + index + attach the knowledge base
**Files:** Create `scripts/carter/build-knowledge-base.ts`.
- [ ] **Step 1:** Script uploads (via ElevenLabs KB API) these docs as KB documents: `CLAUDE.md`, `AGENTS.md`, `Trading Forge System Map v2.md`, `docs/prop-firm-rules-2026-topstep.md`, `docs/prop-firm-rules-2026-mffu.md`, `EDGE-MECHANISMS.md`, `scripts/carter/carter-glossary.md`. Enable RAG (`prompt.rag.enabled=true`), attach each `knowledge_base[]` entry with `usage_mode='auto'` (glossary `usage_mode='prompt'`). (Total < 20MB Creator cap.)
- [ ] **Step 2:** Run it; poll until indexed. Re-run `audit-agent.ts`; confirm KB attached + RAG on.
- [ ] **Step 3:** Commit.

### Task 1.5: Post-call webhook → audit_log
**Files:** Create `src/server/routes/carter-webhook.ts`; Test `src/server/__tests__/carter/carter-webhook.test.ts`; Modify `src/server/index.ts` (mount); extend `audit-log-helper.ts` for `decision_authority='voice_agent'`.
- [ ] **Step 1 — Write failing test:** POST a sample `post_call_transcription` body with a valid HMAC `ElevenLabs-Signature` → 200 + an `audit_log` row `carter.conversation_logged` (status `info`, `decision_authority='voice_agent'`, transcript in `input`); invalid signature → 401; (use a mocked DB insert + a real HMAC compute). Run → FAIL.
- [ ] **Step 2 — Implement:** verify HMAC (`carter-auth.ts` `verifyElevenLabsSignature`), insert via `insertAuditRowSafe`. Mount at `/api/carter/webhook` in `index.ts` (BEFORE the Bearer authMiddleware, like `/api/health`, since ElevenLabs calls it server-to-server with its own HMAC).
- [ ] **Step 3 — Configure** the agent's post-call webhook URL + secret via `configure-agent.ts`; set `CARTER_POST_CALL_WEBHOOK_SECRET` in `.env`.
- [ ] **Step 4 — Run test:** PASS.
- [ ] **Step 5 — Commit.**

### Task 1.6: Conversation smoke test
**Files:** Create `scripts/carter/smoke-conversation.ts`.
- [ ] **Step 1:** Script opens a TEXT-mode session (`@elevenlabs/client` or REST) and asks: "What does B14 mean and why would it block a strategy?" Assert the answer references the firm-breach ruin CI / 0.20 threshold (KB grounding works).
- [ ] **Step 2:** Run it; cite the transcript. Commit.

### Wave 1 Exit Gate
- [ ] Exit Gate Protocol. Live smoke = the B14 question answered correctly from KB. Adversarial verify: `accuracy-validator` pulls the agent config back from ElevenLabs (LLM/voice/KB/RAG all set) AND runs its own KB question; confirms the post-call webhook writes an `audit_log` row with a forged-signature rejection test.

---

## WAVE 2 — Read Tools (the nerve-center sees everything)

**Objective:** Carter can truthfully report on every subsystem. This is the "better than Discord" core.

### Task 2.1: Tool registry + contract test (anti-drift foundation)
**Files:** Create `src/server/lib/carter/tool-registry.ts`; Test `src/server/__tests__/carter/carter-tool-registry.contract.test.ts`.
- [ ] **Step 1:** Define `CARTER_TOOLS: CarterTool[]` where `CarterTool = { name, tier: 'green'|'yellow'|'red', description, method, path, paramsSchema, handler: keyof CarterHandlers }`. Seed it with the Wave-2 READ tools (names below). RED tools are listed with `handler: null` + `tier:'red'` so the registry documents the refusal surface.
- [ ] **Step 2 — Write failing contract test:** for every `tier!=='red'` tool, assert a handler export exists in `carter-reads.ts`/`carter-actions.ts`; assert no exported handler is missing from the registry; assert every tool `name` is unique and matches `^[a-z][a-z0-9_]*$` (ElevenLabs tool-name rules). Run → FAIL (handlers not yet written).
- [ ] **Step 3:** (Test goes green as handlers land in 2.3.) Commit registry + test.

READ tool names (GREEN): `report_system_health`, `report_production_status`, `report_pipeline_status`, `report_strategy_status` (lifecycle state + blocking gate + why), `report_backtest_result`, `report_montecarlo_survival`, `report_paper_pnl`, `report_open_positions`, `report_ab_comparison`, `report_composite_health`, `report_scout_pipeline`, `report_pending_buckets`, `report_recent_alerts`, `query_audit_log`, `report_switch_states`.

### Task 2.2: Extract `computeSwitchStates()` (de-cookie the switch read)
**Files:** Modify `src/server/routes/slumhouse/admin.ts` (`getSwitchStates` ~195-293); Test `src/server/__tests__/slumhouse/compute-switch-states.test.ts`.
- [ ] **Step 1:** Refactor the body of `getSwitchStates` into an exported pure `computeSwitchStates()` that does NO cookie check; `getSwitchStates` calls it after `requireAdminSession`. (Behavior-preserving refactor — existing `wave-b-office-switches.test.ts` must still pass.)
- [ ] **Step 2:** Test `computeSwitchStates()` returns the 4 switches + recovery without a cookie. Run existing + new tests → PASS.
- [ ] **Step 3:** Commit.

### Task 2.3: Implement read handlers
**Files:** Create `src/server/lib/carter/carter-reads.ts`; Test `src/server/__tests__/carter/carter-reads.test.ts`.
- [ ] **Step 1 — Write failing tests** (one per handler) asserting each returns the documented shape by reusing the existing lib (mock the lib, assert pass-through + plain-English shaping). Handlers and their sources:
  - `report_system_health` → proxy `GET /api/health` (internal call) / `getBacktestConcurrencyStats` etc.
  - `report_production_status` → `buildProductionStatus()` (`production-status.ts`).
  - `report_pipeline_status` → `assembleKitchenData()` + `getMode()` (pipeline-control).
  - `report_strategy_status` → read `strategies` row + latest `backtests.gateResult`/wfe/pbo/b14 + `lifecycle_transitions`; compute "which gate is blocking + plain-English why".
  - `report_backtest_result` → `GET /api/backtests/:id` shape.
  - `report_montecarlo_survival` → latest `monte_carlo_runs.riskMetrics.probability_of_ruin_ci`.
  - `report_paper_pnl` / `report_open_positions` → `assembleCribData()`.
  - `report_ab_comparison` → `GET /api/ab-comparison/recent`.
  - `report_composite_health` → `GET /api/composite-health/summary`.
  - `report_scout_pipeline` → scout cycle audit + scout health.
  - `report_pending_buckets` → `GET /api/agent/pending-buckets`.
  - `report_recent_alerts` → recent `audit_log` (status warning/critical) + SSE ring.
  - `query_audit_log` → new Drizzle read helper (by action / correlation_id / recent-N).
  - `report_switch_states` → `computeSwitchStates()`.
- [ ] **Step 2:** Implement handlers (reuse libs; import logger from `./logger.js` if a leaf). Run tests → PASS. Contract test (2.1) now green.
- [ ] **Step 3:** Commit.

### Task 2.4: `/api/carter` router + HMAC auth + registry dispatch
**Files:** Create `src/server/lib/carter/carter-auth.ts`; Create `src/server/routes/carter-tools.ts`; Test `src/server/__tests__/carter/carter-tools-route.test.ts`; Modify `src/server/index.ts`.
- [ ] **Step 1 — Write failing tests:** (a) request without valid `CARTER_TOOLS_HMAC_SECRET` signature → 401; (b) valid signature + `tool=report_switch_states` → 200 with handler output; (c) unknown tool → 404; (d) a `tier:'red'` tool name → 403 `red_action_no_tool_path`; (e) every successful call writes an `audit_log` `carter.tool_invoked` row with `decision_authority='voice_agent'` + correlation_id. Run → FAIL.
- [ ] **Step 2 — Implement:** `carter-auth.ts` `verifyCarterHmac(req)`; `carter-tools.ts` looks the tool up in `CARTER_TOOLS`, validates params against `paramsSchema`, dispatches to the handler, audit-logs, returns JSON. Mount `app.use('/api/carter', carterToolsRouter)` in `index.ts` (BEFORE Bearer authMiddleware — it has its own HMAC plane).
- [ ] **Step 3:** Run tests → PASS.
- [ ] **Step 4:** Commit.

### Task 2.5: Register read tools on the ElevenLabs agent
**Files:** Extend `scripts/carter/configure-agent.ts`.
- [ ] **Step 1:** For each GREEN registry tool, create/update an ElevenLabs **webhook tool** (`type:'webhook'`, url=`<tower>/api/carter`, method POST, body carries `{tool, params}` + the HMAC header via a Workspace Auth Connection / secret), and set `conversation_config.agent.prompt.tool_ids` to include them. (RED tools are NOT registered — that's the point.)
- [ ] **Step 2:** Run it; re-audit; confirm tool_ids count == GREEN read-tool count. Commit.

### Task 2.6: End-to-end read smoke
- [ ] **Step 1:** Extend `smoke-conversation.ts`: ask "How's the system right now?" → assert Carter calls `report_system_health`/`report_production_status` and reads back real values. Cite transcript + the `carter.tool_invoked` audit rows.

### Wave 2 Exit Gate
- [ ] Exit Gate Protocol. `system-map:sync` (new subsystems: `carter_tools_router`, `carter_session`, `carter_reads`). Adversarial verify: `accuracy-validator` curls `/api/carter` for 3 read tools and cross-checks each against the underlying source route/lib (truth-test the pass-through), confirms the RED 403 path, confirms the contract test catches a deliberately-removed handler.

---

## WAVE 3 — Run Tools (Carter does safe work)

**Objective:** Carter can validate strategies, run risk, hunt research — all capital-safe, all audited, no gate bypass.

### Task 3.1: Run handlers (TDD, guardrails baked in)
**Files:** Create/extend `src/server/lib/carter/carter-actions.ts`; Test `src/server/__tests__/carter/carter-run-actions.test.ts`. Add these GREEN tools to the registry.
GREEN run tools + sources + guardrails:
- `run_backtest` → POST internal `runBacktest({strategyId, mode:'walkforward'})`; **strip** any `compliance_mode`/`actor`/`trial_n_total` from params (pinned defaults); on 429 return a "busy, try later" payload (no loop).
- `run_walk_forward` → same as run_backtest with `mode:'walkforward'` (no standalone route).
- `run_monte_carlo` → `runMonteCarlo({backtestId, firms:['topstep_50k','mffu_50k']})`; **always inject firms** (test asserts firms present); never touch MC threshold envs.
- `run_matrix` → `runMatrix(...)`; rate-limited.
- `fire_scout_cycle` → POST `/api/admin/scout/run-autonomous-cycle`; if pipeline paused (423) report "paused", do not force.
- `research_strategy_idea` → `strategyHunt()` (search-router fusion) — returns cited results + LLM summary.
- `scan_youtube_for_setups` → autonomous-scout YouTube discovery + gemma extract (day-trader-only).
- `competitive_intel` → Parallel + Exa deep research brief.
- `deposit_pending_mention` → POST `/api/agent/scout-ideas/pending` (NEVER `/scout-ideas/strict`).
- `evaluate_kill_signal` → POST `/api/backtests/kill-signal` (stateless advisory).
- [ ] **Step 1 — Write failing tests** per handler incl. guardrail assertions: `run_backtest` strips `compliance_mode='shadow'`; `run_monte_carlo` injects firms; `deposit_pending_mention` rejects a `/strict` target; 423/429 handled gracefully. Run → FAIL.
- [ ] **Step 2 — Implement.** Run → PASS.
- [ ] **Step 3 — Commit.**

### Task 3.2: Register run tools on the agent + contract test green
- [ ] **Step 1:** Add the run tools to `configure-agent.ts` registration; re-audit (tool count grows). Contract test stays green.
- [ ] **Step 2:** Commit.

### Task 3.3: End-to-end run smoke
- [ ] **Step 1:** Ask Carter (text mode) "Run a backtest on <a CANDIDATE strategy> and tell me when it's done." Assert: `run_backtest` invoked → poll → Carter reports the result + gate outcomes. Cite the `backtests` row + audit trail.

### Wave 3 Exit Gate
- [ ] Exit Gate Protocol. Adversarial verify: `accuracy-validator` + `backtest-core` attempt to make Carter run an MC WITHOUT firms or a backtest in shadow mode via crafted params — must be blocked by the handler; confirm a real backtest the conveyor would accept is produced; confirm no gate-threshold env is reachable from any tool.

---

## WAVE 4 — Proactive Issue Watcher & Connect Briefing

**Objective:** Carter already knows what's wrong the moment you connect. Detect-always (free), speak-on-connect.

### Task 4.1: `carter_issues` snapshot table (migration)
**Files:** Migration `src/server/db/migrations/<next>_carter_issues.sql` + `_journal.json` entry; `src/server/db/schema.ts`.
- [ ] **Step 1:** `CREATE TABLE IF NOT EXISTS carter_issues (id BIGSERIAL PK, issue_key TEXT UNIQUE, severity TEXT NOT NULL, title TEXT, detail TEXT, source_event TEXT, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ, resolved BOOLEAN DEFAULT false)`. Add Drizzle model. Add the journal entry in the SAME commit.
- [ ] **Step 2:** pglite dry-run applied twice (idempotent). Commit.

### Task 4.2: Issue watcher service
**Files:** Create `src/server/services/carter-issue-watcher.ts`; `src/server/lib/carter/carter-issues-store.ts`; Test `src/server/__tests__/carter/carter-issue-watcher.test.ts`; Modify `src/server/index.ts` (start it).
- [ ] **Step 1 — Write failing test:** feed simulated SSE events (`alert:triggered`, `lifecycle:auto_graveyard`, `quantum_rl:kill_switch_engaged`, `paper:handler_error`) + a degraded `/api/health` → assert the store upserts dedup'd issues (by `issue_key`), marks resolved when cleared, and persists to `carter_issues`. Run → FAIL.
- [ ] **Step 2 — Implement:** subscribe to the internal SSE bus (reuse the broadcast subscriber pattern) + poll `/api/health` on an interval; map events → issues; upsert store + table. Start in `index.ts` (pipeline-gate-exempt; fail-soft). Run → PASS.
- [ ] **Step 3 — Commit.**

### Task 4.3: `get_current_issues` tool + connect briefing wiring
**Files:** Extend `carter-reads.ts` + registry; extend `configure-agent.ts`.
- [ ] **Step 1:** Add GREEN tool `get_current_issues` → returns the open issues (severity-sorted, plain-English). Add to registry + handler + test.
- [ ] **Step 2:** Update the agent `first_message`/prompt so on connect Carter calls `get_current_issues` and opens with the briefing ("Two items need attention…" or "All clear.").
- [ ] **Step 3:** Optional cheap surfacing: a small endpoint `GET /api/carter/issue-badge` (count + max severity) for the Office card (consumed in Wave 6) + optional Discord ping on new critical (reuse `notify`). Test + commit.

### Task 4.4: Briefing smoke
- [ ] **Step 1:** Inject a fake critical issue → connect (text mode) → assert Carter's FIRST message names that issue. Cite transcript.

### Wave 4 Exit Gate
- [ ] Exit Gate Protocol (incl. migration verified applied via boot-runner path). Adversarial verify: `accuracy-validator` injects an SSE alert and confirms it surfaces in `get_current_issues` AND in the connect briefing; `autonomous-readiness` confirms the watcher is fail-soft (a watcher crash never takes down the API) and survives restart (table-backed).

---

## WAVE 5 — Confirm-Actions (YELLOW, voice read-back)

**Objective:** Carter can operate the machine for the risky-but-reversible actions — only after a spoken confirmation. RED stays impossible.

### Task 5.1: Confirmation-token protocol
**Files:** Create `src/server/lib/carter/carter-confirm.ts`; Test `src/server/__tests__/carter/carter-confirm.test.ts`.
- [ ] **Step 1 — Write failing test:** `issueConfirmation(action, params)` returns a short-lived (≤120s) signed token bound to `(action, paramsHash)`; `verifyConfirmation(token, action, params)` passes only for a matching, unexpired, unused token (single-use). Tampered/expired/replayed → reject. Run → FAIL.
- [ ] **Step 2 — Implement** (HMAC over `action|paramsHash|exp`, in-memory used-set). Run → PASS. Commit.

### Task 5.2: YELLOW action handlers (two-call protocol)
**Files:** Extend `carter-actions.ts` + registry; Test `src/server/__tests__/carter/carter-confirm-actions.test.ts`.
YELLOW tools (each is a PAIR: `propose_*` returns a read-back + a confirmation token; `confirm_*` requires the token then calls the underlying lib directly + audits `decision_authority='voice_agent'`):
- `toggle_bot_power` (pause/resume → `setMode`) — pausing allowed; both confirm.
- `set_learning_loop_mode` — **down to OFF/OBSERVE = GREEN (no token)**; **up to AUTOPILOT = YELLOW (token)**.
- `toggle_vacation_mode` (set/clear `operator_absent_since`).
- `self_restart` (HMAC self-restart — Unix SECONDS! reuse the documented signer).
- `trigger_n8n_workflow` (POST the workflow webhook).
- `run_quantum` (quantum-mc routes; cloud stays off).
- `request_lifecycle_check` (POST `/lifecycle/check` sweep) and `request_promotion` (PATCH `/:id/lifecycle` — gates still run; if a gate blocks, report the block, NEVER force).
- `force_graduate_bucket` (operator force-graduate — confirm + audit).
- `rearm_scheduler_job` (enable a disabled cron).
- [ ] **Step 1 — Write failing tests:** each `confirm_*` REJECTS without a valid token (`confirmation_required`); with a valid token it calls the underlying lib (mocked) + writes the audit row; `set_learning_loop_mode` down-shift needs NO token; `request_promotion` that hits a gate block returns the block reason and does NOT mutate state. Run → FAIL.
- [ ] **Step 2 — Implement.** Run → PASS. Commit.

### Task 5.3: RED refusal surface (explicit negative test)
**Files:** Test `src/server/__tests__/carter/carter-red-refusal.test.ts`.
- [ ] **Step 1:** Assert there is NO handler and NO registered agent tool for any of: enable live execution, place live order, openPosition, clear kill-switch/auto-pause/stuck-session, delete backtest/strategy, change any gate threshold, set compliance shadow, framework sizing edit, enable cloud/IBM quantum, assign rl-challenger, create/update/delete n8n workflow, KASA power-cycle, disable a safety cron. Registry lists them `tier:'red', handler:null`; route returns 403. Run → PASS (this is the guarantee).
- [ ] **Step 2:** Commit.

### Task 5.4: Register YELLOW tools + prompt the confirm protocol
- [ ] **Step 1:** Register `propose_*`/`confirm_*` pairs on the agent; update the system prompt: for any YELLOW action Carter MUST call `propose_*`, read the returned summary aloud, get an explicit "yes/confirm", then call `confirm_*`. Re-audit. Commit.

### Task 5.5: Confirm-action smoke
- [ ] **Step 1:** "Pause the bot." → Carter calls `propose_toggle_bot_power`, reads back ("This pauses all engine authority; open positions stay — confirm?"), you say "confirm" → `confirm_toggle_bot_power` → mode PAUSED + audit row. Then "resume." Cite audit rows.

### Wave 5 Exit Gate
- [ ] Exit Gate Protocol. Adversarial verify: `accuracy-validator` tries to (a) call a `confirm_*` tool with no/expired/replayed token (must fail), (b) reach ANY red action through any tool (must 403), (c) make `request_promotion` push a strategy past a failing gate (must be blocked by the gate, not Carter). All must hold.

---

## WAVE 6 — Office Card + Immersive Blob UI (LAST, per operator)

**Objective:** The visible Jarvis — a Carter card on the Office coverflow + a full-immersive black screen with the audio-reactive blob.

### Task 6.1: three.js audio-reactive blob module
**Files:** Create `public/slumhouse/assets/carter-blob.js`.
- [ ] **Step 1:** Implement `createCarterBlob(canvas)` → `{ start(getFreq), stop(), setMode(mode), dispose() }`. IcosahedronGeometry(1.4, 20) + ShaderMaterial: vertex displacement along normal via inlined GLSL snoise driven by `uAudio` (+ idle wobble via `uTime`); emerald (#10B981→#050505) fresnel fragment. rAF loop calls `getFreq()` (the SDK's `getOutputByteFrequencyData()`), reduces to bass/treble scalars, lerp-smooths into `uAudio`. WebGL feature-detect → 2D-canvas radial-waveform fallback. Cap devicePixelRatio ≤2; `dispose()` frees geometry/material/renderer.
- [ ] **Step 2:** Commit. (No vitest for WebGL; verified manually in 6.4.)

### Task 6.2: Immersive Carter screen
**Files:** Create `public/slumhouse/carter.html` (full-viewport black; canvas + mic-state pill + End button) OR an overlay module included by office.html (choose overlay to avoid re-handshaking the session cookie — see scan recommendation).
- [ ] **Step 1:** ESM `<script type=module>` + importmap mapping `@elevenlabs/client`→`https://esm.sh/@elevenlabs/client@<pinned>` and `three`→jsdelivr pinned. On open: fetch `/slumhouse/api/carter-session` → `Conversation.startSession({ conversationToken, connectionType:'webrtc', onConnect, onModeChange→setMode, onDisconnect→teardown, onError })`; start blob with `getOutputByteFrequencyData`. Mic-state pill from `onModeChange` ('Connecting…'/'Listening…'/'Carter is speaking'). End button → `endSession()` + `dispose()` + restore. HTTPS/mic-permission handled on the Connect gesture.
- [ ] **Step 2:** Commit.

### Task 6.3: Office coverflow card + Connect button
**Files:** Modify `public/slumhouse/office.html` (mirror an existing card at ~line 100-160; add a "Carter" card with a small idle blob preview + "Connect to Carter" → opens the immersive overlay; show the `GET /api/carter/issue-badge` count).
- [ ] **Step 1:** Add the card matching the emerald-glass identity; wire the button + badge.
- [ ] **Step 2:** Commit.

### Task 6.4: Manual verification (desktop + iPhone)
- [ ] **Step 1:** Operator-in-the-loop: open Office → Carter card shows issue badge → Connect → blob renders + reacts to Carter's voice → connect-briefing speaks current issues → ask a status question → End tears down cleanly. Repeat on iPhone (mobile layout, thermal OK). Cite results.

### Wave 6 Exit Gate
- [ ] Exit Gate Protocol (UI portions manual). Adversarial verify: `accuracy-validator` confirms the session route still fails-closed, the blob disposes (no WebGL context leak on repeated open/close), and the immersive screen contains ONLY the blob + pill + End (matches the brief). Final full-system smoke: connect → briefing → a read → a GREEN run → a YELLOW confirm → End.

---

## Cross-Wave Spec Coverage (self-review)

- Persona "professional, plain-English, no slang" → Wave 1 (Task 1.1) + glossary (1.3).
- "Knows all ins/outs" → Wave 1 KB/RAG (1.4).
- "Connected to whole pipeline / center of system" → Wave 2 reads (every subsystem) + Wave 3 runs + Wave 5 operate.
- "Better than Discord for statuses" → Wave 2 reads + Wave 4 proactive watcher/briefing.
- "Help grow Trading Forge" → Wave 3 research tools (strategyHunt/youtube/competitive/discover).
- "Let me know problems when I connect" → Wave 4 watcher + connect briefing (no phone calls).
- "Real connections, not a shell" → registry + contract test + adversarial exit gates (every tool wired both ends).
- "Gates decide, never bypass" → Global Guardrail 7 + tiering + Wave 5 RED refusal test (5.3).
- "3D blob on stage card + Connect → immersive black screen" → Wave 6.
- "Each wave wired, no bugs, no carry-forward" → Exit Gate Protocol (adversarial verify + fix-in-wave) on every wave.

## Open config defaults (change anytime — say the word)
- Brain = `claude-sonnet-4-5` + cascading. Voice = Eric. WebRTC transport. These are ElevenLabs-side config, reversible in `configure-agent.ts`.
