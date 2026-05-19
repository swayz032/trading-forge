# Backlog Health Report — generated 2026-05-04

> Pass 2 Branch A — Scout Architecture Fix plan
> Plan: `C:\Users\tonio\.claude\plans\image-72-i-want-greedy-wigderson.md`
> Read-only diagnostic. No mutations performed.

## 1. Pipeline mode + pause history

- **Current mode: PAUSED** (`system_parameters.pipeline_mode = "0"`; `0=PAUSED, 1=ACTIVE, 2=VACATION` per `pipeline-control-service.ts:33-37`)
- **Last set:** `2026-05-05T02:15:21.677Z` (just under an hour ago) by `decision_authority="human"`
- **Last reason:** `pre-market-health-check: windows-pending-reboot — reboot required before trading (pending_reboot: Reboot pending: PendingFileRenameOperations)`
- **Cause:** the C8 Windows-update protection cron (`pre-trading-day-health-check`, `windows-health-check-service.ts`) detected a queued reboot from `PendingFileRenameOperations` and SET-MODE→PAUSED to prevent a forced reboot during cash-session trading. This is **fail-closed by design** (CLAUDE.md: "C8 / Windows Update Reboot Protection").
- **Sticky pause:** the cron has fired ~10 times in 36 hours (every ET-pinned 8:00 AM run, plus several manual operator pause/resume cycles). Each fire re-asserts PAUSED → PAUSED because the underlying reboot is still pending.

### Past 10 mode changes (action=`pipeline.mode_change`; total in audit_log = 22)

Note: original plan SQL searched `action='pipeline.set-mode'` which returned zero rows. The actual canonical action name is `pipeline.mode_change` per `pipeline-control-service.ts:186`. All 10 below are **PAUSED → PAUSED re-asserts** (no recent ACTIVE windows).

| created_at (UTC)            | authority | previousMode | newMode | reason                                                                                                                      |
|-----------------------------|-----------|--------------|---------|------------------------------------------------------------------------------------------------------------------------------|
| 2026-05-05T02:15:21.677Z    | human     | PAUSED       | PAUSED  | pre-market-health-check: windows-pending-reboot (PendingFileRenameOperations)                                               |
| 2026-05-05T02:12:46.837Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-05T02:09:51.727Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-05T00:17:26.222Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-04T18:32:09.458Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-04T16:01:09.509Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-04T15:44:26.488Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-04T15:33:38.825Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-04T15:32:36.615Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |
| 2026-05-04T15:19:06.544Z    | human     | PAUSED       | PAUSED  | (same)                                                                                                                       |

`decision_authority` is `human` (not `scheduler`) because `setMode` writes the audit row with `decisionAuthority: "human"` regardless of caller — even when invoked by the C8 cron. See `pipeline-control-service.ts:189`.

## 2. Backlog by status (last 7 days)

| status   | count | oldest                   | newest                   |
|----------|------:|--------------------------|--------------------------|
| scouted  |    16 | 2026-05-03T13:51:45Z     | 2026-05-05T02:00:01Z     |

Only `scouted` rows exist. There are no `synthesized`, `compiled`, `backtested`, or other pipeline-stage rows in `system_journal` for the 7-day window — all 16 are stuck waiting on `drainScoutedIdeas()`, which is short-circuited while the pipeline is PAUSED (per CLAUDE.md "Pause Semantics — n8n NEVER pauses" and `agent-service.ts:1134`).

Strategies created in last 7 days: **0** (`strategies` table query returned empty for `created_at > NOW()-7d`). Confirms the drain has been entirely pause-blocked across the window.

## 3. n8n still feeding during pause?

**YES — partially, but per design.**

7-day average: 8 scout rows/day (16 / 2-day active window — Mar 3 + 4). Today 8 rows. The 5-day window earlier in the week shows zero rows because the prior pause/resume cycle wiped or pre-existed the lookback. Pattern matches CLAUDE.md "n8n keeps feeding the queue; nothing is lost."

### Hourly scout writes — last 12 hours

| hour (UTC)              | count |
|-------------------------|------:|
| 2026-05-04T20:00:00Z    |     1 |
| 2026-05-05T02:00:00Z    |     1 |

Only the 2 cron-driven writes from the last 12h fall inside the window — sparse but consistent with the actual workflow schedules (5J Hourly Cron, 5K Daily 3AM ET cron). There are NO writes from 5L/5M/5N/5O — those are all currently broken (see §4).

### Today by source (since 00:00 UTC)

| source       | count |
|--------------|------:|
| openclaw     |     3 |
| brave-news   |     5 |

`brave-news` writes are coming from a **different** workflow than 5M (5M is broken on auth). Likely from `5J-unified-search-router-scout` (the sole successful execution today, ID 20946) where `source_provider="brave-news"` is one of the merged fan-out paths.

## 4. Per-workflow execution health (last 5 executions)

| Workflow ID            | Name                                | Last 5 statuses (newest→oldest) | Latest error                                                                                                                                           | Verdict           |
|------------------------|-------------------------------------|----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------|
| `Ep2Zsu33tMOsaJbE`     | 5J-unified-search-router-scout      | S, E, E, E, E                    | `confidence_score: 1.15` rejected by strict scout schema (max 1.0). Strict endpoint returns 400 — `Number must be less than or equal to 1`             | **BROKEN**        |
| `lUenVARPUG1uz4OE`     | 5K-parallel-deep-research           | S, E, E, E, E                    | Parallel.ai 422: `Object 'properties' empty at path: strategies.items.entry_params` and `…exit_params`. JSON schema rejects empty `properties:{}`        | **BROKEN**        |
| `F6i4JoTdxgiyjHhM`     | 5L-quant-blog-harvester             | S, E, E (only 3 runs)            | Tavily 401 Unauthorized: `missing or invalid API key`. `$env.TAVILY_API_KEY` not loaded                                                                | **BROKEN (auth)** |
| `7PgUY6Wa07aZbAPX`     | 5M-brave-news-watcher               | S, E, E, E, E                    | Brave 422: `x-subscription-token: Field required`. `$env.BRAVE_API_KEY` not loaded                                                                     | **BROKEN (auth)** |
| `4qVyxZd29pQkGn9p`     | 5N-brave-video-discoverer           | S, E, E, E (only 4 runs)         | Same as 5M — Brave 422 missing `x-subscription-token`                                                                                                  | **BROKEN (auth)** |
| `J8K0PfErL2v4W9Zw`     | 5O-supadata-transcript-pipeline     | (no executions)                  | n/a — workflow has zero execution history; per plan note "might not exist yet". `n8n_executions list` returned empty.                                  | **NOT DEPLOYED**  |
| `vlCaiWM7F0AH1RRY`     | 8A-idea-to-strategy                 | S, S, S, S, S                    | none — last 5 all SUCCESS                                                                                                                              | **HEALTHY**       |
| `eCr7cyb0aPArFCZc`     | Strategy Generation Loop            | E, E, C, S, E                    | `AI Strategy Generator: No prompt specified` — agent expects `chatInput` from chat trigger; `Init Iteration Counter` doesn't emit it                    | **BROKEN**        |

S = success, E = error, C = canceled. Manual test runs (`mode="manual"`) and cron retries are mixed in this column — the success entries are mostly operator manual re-tests after a fix attempt.

### Drilled-down errors (latest cron failure per broken workflow)

- **5J (exec 20945, retry of 20924):** `Shape to Strict Scout Schema` Code node emits `confidence_score: 1.15` for a Robert Carver "Advanced Futures Trading Strategies" hit — the source-provider scoring formula scaled past 1.0. The `/api/agent/scout-ideas/strict` endpoint enforces `Number must be less than or equal to 1`. Fix: clamp `confidence_score = Math.min(1, raw)` in the Shape Code node, or relax server cap.
- **5K (exec 20931):** Parallel.ai's task-spec validator rejects JSON schema with `properties: {}`. `entry_params` and `exit_params` are typed as `{type: object, additionalProperties: true}` with no `properties` key — Parallel requires at least one named property. Fix: add a placeholder property (e.g., `{"params": {"type": "object"}}`) or remove `properties` entirely.
- **5L (exec 20880):** Tavily 401 — `$env.TAVILY_API_KEY` is not visible to the n8n container. Verify env injection in `docker-compose.local-ai.yml` or move credential to n8n credential store (per the bulk-hardening playbook in `tmp-n8n/`).
- **5M (exec 20782) + 5N (exec 20795):** Brave Search 422 — `$env.BRAVE_API_KEY` not visible. Same root cause as 5L; both Brave workflows share the env reference. Per `feedback_api_keys.md` reference, the keys exist; this is a delivery problem, not a billing/quota problem.
- **Strategy Generation Loop (exec 20908):** AI Agent V3 node has `text: "={{ $json.chatInput }}"` but the upstream `Init Iteration Counter` Code node emits `{symbol, strategy_type, constraints, iteration, ...}` — no `chatInput` key. The langchain agent throws `No prompt specified` because `chatInput` is undefined. Fix: rename the field upstream OR change `text` to point at the actual concatenation of `symbol + strategy_type + constraints + stage_prompt`.

## 5. Diagnosis summary

- **Are scouts accumulating?** PARTIAL. 16 in last 7 days; 8 today. The 1 healthy scout source (5J's manual successes + the 8A workflow which is downstream consumer) has been writing intermittently. With 6 of 8 scout/scout-adjacent workflows broken, the queue is being fed at ~5–10% of designed throughput. **No backlog crisis** — but also no real backlog to drain when the operator unpauses.
- **Which workflows need fixing?** Plan flagged 3 (5J, 5K, Strategy Gen Loop). **Confirmed all 3 broken** + an additional **3 not in the original list** (5L, 5M, 5N — all auth/env-var issues). 5O does not exist yet (expected). 8A is the only fully healthy production scout workflow.
- **Is the operator's pause behaving correctly?** **YES — exactly as designed.** n8n keeps writing to `system_journal` (status=`scouted`) regardless of pause state. `drainScoutedIdeas()` short-circuits and zero strategies have been synthesized in 7 days. This matches CLAUDE.md "Pause Semantics — n8n NEVER pauses" verbatim.
- **Why is pause sticky?** C8 Windows pre-market health check fires every cron tick (8:00 AM ET pinned + frequent test runs visible in audit log) and re-asserts PAUSED because `PendingFileRenameOperations` registry key still flags a queued reboot. **The operator must reboot Windows to clear the pending-reboot flag**, then resume. Until then every operator-initiated unpause will be re-paused at the next pre-market check. See CLAUDE.md "C8 — Pause is sticky."

## 6. Operator handoff notes

### Expected backlog drain volume on unpause

Best estimate: **16 scout entries** queued, but only ~3–5 are likely to survive `drainScoutedIdeas()` synthesis given 5J's confidence-score cap bug means several entries have `confidence_score > 1.0` which the strict endpoint already pre-rejected before write (so the 16 in DB are the ones that DID pass). Realistic synthesis output on unpause: **3–8 new CANDIDATE strategies** within ~30 minutes of resume, then the queue is empty.

### Error patterns to monitor in the first hour after unpause

1. **`drainScoutedIdeas` synthesizer failures** — watch `audit_log` for `action="agent.synthesize_failed"` or `"strategy.creation_failed"`. Backlog quality has been poor (mostly `brave-news` sources, low signal-to-noise) — expect rejection rate elevated.
2. **`pipeline.mode_change` re-pauses** — if Windows reboot was NOT performed before resume, the next 8:00 AM ET tick will re-pause. The operator must reboot Windows BEFORE pressing resume.
3. **5J retries on cron** — first scheduled fire after resume will retry the failing scout flow. Expect another `confidence_score > 1` failure unless the Code node was fixed in Pass 2 Branch B/C/D.
4. **Strategy Generation Loop chatInput error** — if any workflow webhooks into `eCr7cyb0aPArFCZc`, expect the same "No prompt specified" until that AI Agent text expression is corrected.
5. **Per-workflow error notifications** — n8n is configured to send error executions back to errorWorkflow handlers; check `tmp-n8n/track-executions.py` output for new error-mode rows.

### Recommended next action (single-step)

**Reboot Windows to clear `PendingFileRenameOperations`** → resume pipeline via the Command Room red button → monitor `audit_log` for the next mode_change to confirm it stays at `previousMode=PAUSED, newMode=ACTIVE` (not another PAUSED→PAUSED re-assert). Only THEN address scout-workflow fixes (Pass 2 Branches B/C/D).

---

### Appendix: file & line references

- Pipeline control service: `src/server/services/pipeline-control-service.ts:33-42` (mode↔numeric mapping); `:185-193` (audit log shape); `:90-92` (`isActive()`)
- Drain short-circuit: `src/server/services/agent-service.ts:1134` (per CLAUDE.md note)
- Windows health check (sticky pause source): `src/server/services/windows-health-check-service.ts` + `scripts/pre-trading-day-health-check.ps1`
- Pause semantics doctrine: CLAUDE.md "Pause Semantics — n8n NEVER pauses" section
- C8 protection doctrine: CLAUDE.md "Windows Update Reboot Protection (W17 / C8)" section

### Appendix: SQL scripts run

All read-only. Scripts persisted to `tmp-n8n/` for replay:
- `tmp-n8n/backlog-queries.mjs` (Q1–Q5 + bonus inventory)
- `tmp-n8n/backlog-queries-2.mjs` (mode-change action enumeration; strategies-table cross-check)
- `tmp-n8n/backlog-queries-3.mjs` (corrected pause-history with action=`pipeline.mode_change`)
- `tmp-n8n/backlog-queries-4.mjs` (input-column extraction for from→to mode + reason)

To replay: `DATABASE_URL` is in `.env`; `node tmp-n8n/backlog-queries.mjs` from the repo root.
