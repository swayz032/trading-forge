# Scout Pipeline v2 — Operator Handoff

Plan: `C:\Users\tonio\.claude\plans\image-72-i-want-greedy-wigderson.md`
Pass 8 verification completed 2026-05-04. Status: APPROVED WITH FOLLOW-UPS.

## Pass-by-pass summary

| Pass | Shipped | Key paths |
|---|---|---|
| 1 — Foundation | Pause-semantics docs in CLAUDE.md / AGENTS.md / System Map v2; 3 new GPT-5-mini role configs; 4 KB cards (1101 lines total) + few-shot per role; `loadSystemPrompt(role, taskContext?)` KB injection; schema-snapshot generator | `src/server/services/model-router.ts`, `src/agents/kb/`, `scripts/generate-strategy-schema-snapshot.mjs` |
| 2 — Diagnostic + bug fixes | 5J confidence_score clamp, 5K Parallel.ai schema, Strategy Generation Loop chatInput. C8-driven pause confirmed (Windows pending reboot) | `tmp-n8n/pause-history.md`, n8n workflows |
| 3 — Prompt refactor | All 6 prompts in 4-block structure (verified `grep -c` = 5 markers each); PROMPT_VERSION bumped on the 3 refactored | `src/agents/*.md`, `scripts/prompt-ab-test.mjs` |
| 4 — Backend defenses | Tier-1 regex pre-filter + Tier-2 GPT-5-mini auditor (200/day fail-OPEN cap); cleaned_title/cleaned_lead pre-format on insert; signal_type filter; synthesizer through `selectModel("strategy_proposer")` with refusal handling | `src/server/services/agent-service.ts`, `src/server/routes/agent.ts` |
| 5 — n8n architectural rewrites | 5J research-find shape; 5M `signal_type='market_news_intel'`; 8A switched to OpenAI proxy; 5O wired through `/api/agent/transcript-extract` | n8n workflows; `src/server/routes/agent.ts` |
| 6 — Frontend + cleanup | /scout 3-tab split (strategy/news/all); `GET /api/scout/health` route NOT pause-gated; ScoutHealthCard tile; cleanup script backfilled 16 legacy rows | `src/server/routes/scout-health.ts`, `Trading_forge_frontend/amber-vision-main/src/pages/Scout.tsx`, `Trading_forge_frontend/amber-vision-main/src/components/dashboard/ScoutHealthCard.tsx`, `scripts/cleanup-scout-journal.mjs` |
| 7 — Quality gates + production-assertion cron | DSL compile round-trip via runPythonModule; `dsl_quality_critic` post-compile (100/day fail-OPEN cap); `b14-strategy-production-check` cron at 18:00 ET (BYPASSES pause) | `src/server/services/agent-service.ts`, `src/server/services/strategy-production-check-service.ts`, `src/server/scheduler.ts:2407` |

Test counts (verified):
- `kb-loader.test.ts`: 24 pass
- `scout-substance-validator.test.ts`: 44 pass
- `scout-quality-gates.test.ts`: 18 pass
- `strategy-production-check.test.ts`: 9 pass
- Full repo regression: 1604 pass / 2 fail (both pre-existing in `audit-log-append-only.test.ts` per plan; allowed)
- Frontend `tsc --noEmit` + `vite build`: clean (warnings only on chunk size)
- `npm run system-map:check`: exit 0, drift cleared

## Operator actions still needed

1. **Reboot Windows** to clear PendingFileRenameOperations (per Pass 2 diagnostic). The C8 pre-trading-day health check pauses the pipeline until this clears. After reboot, manually resume the pipeline via `POST /api/admin/pipeline/start` or the /command-room button.
2. **Restart n8n container** (`docker compose -f docker-compose.local-ai.yml restart n8n`) to pick up the new env vars in `myapp/backend/infrastructure/docker/.env`. Hardcoded keys in 5L (Tavily) and 5M (Brave News auth header) work even without restart, but env-var consumers (other workflows) need the restart.
3. **Confirm SUPADATA_API_KEY** is set if 5O Saturday cron is to fire. Without it, the new transcript-extractor pipeline silently no-ops.
4. **Re-verify `/api/scout/health`** returns sane data after resume. The route is not pause-gated, so the dashboard tile will render real data immediately.

## Expected backlog drain on resume

- 16 backlog rows currently queued (per Pass 6 cleanup script result, signal_type-tagged + cleaned_title/cleaned_lead populated).
- `drainScoutedIdeas()` selects with `OR signal_type IS NULL` so legacy rows from before Pass 4 still drain.
- Drain-cron runs every 30s; expect drain to complete within 10 minutes after pipeline resume.

## Monitoring URLs

- `/scout` — 3-tab journal split (strategy candidates / news / all)
- `/` — Dashboard with `<ScoutHealthCard />` tile (gray when paused, red on zero-strategy + ACTIVE day)
- `/api/scout/health` — JSON health blob (synthesizerHealth, auditorRejectsLast24h, sourcesBy7d)
- `audit_log` action filters: `scout.audited`, `scout.rejected_auditor`, `scout.rejected_compile`, `scout.rejected_critic`, `scout.synthesizer_refused`, `scout.rejected_regex`, `llm.gpt5mini_call`, `llm.ollama_fallback`

## Rollback per pass

- **Pass 1:** `git revert` doc commits, `git rm -r src/agents/kb/`, `git revert` model-router.ts. KB injection gracefully degrades when files missing (kb-loader has fallback path tested in `kb-loader.test.ts`).
- **Pass 2:** No snapshot — fixes are deeply embedded in n8n workflow nodes. Manual re-edit required if rollback needed (low risk; fixes are bug fixes).
- **Pass 3:** Revert via `git checkout HEAD~N src/agents/*.md` (PROMPT_VERSION bumps preserve old text in git history).
- **Pass 4:** `git revert` agent-service.ts + agent.ts. signal_type schema is additive; rollback graceful.
- **Pass 5:** Use `mcp__n8n-api-mcp__n8n_update_full_workflow` with these versionIds: 5J `add4c6c2-...`, 5M `23e41700-...`, 8A `0559de6d-...`, 5O `596152f4-...`.
- **Pass 6:** Revert frontend + remove scout-health route mount in `src/server/index.ts:429`. Cleanup script's `cleaned_title` backfill is one-way; legacy rows had no cleaned_title anyway, so leaving them is safe.
- **Pass 7:** Revert agent-service.ts + remove `b14-strategy-production-check` registration in `scheduler.ts:2407` + delete `strategy-production-check-service.ts`.

## Pass 9 follow-up — Responses API migration

Task #56, blocked on this Pass 8 approval. Procedure:

1. Start canary with `scout_auditor` role (smallest blast radius, 200/day cap, fail-OPEN).
2. Stagger 24h between role flips to detect regressions.
3. Order: `scout_auditor` → `dsl_quality_critic` → `transcript_extractor` → `nightly_review` → `critic_evaluator` → `strategy_proposer` (lowest stakes to highest).
4. Each role flip writes an `audit_log` row with `action='llm.responses_api_migration'` for rollback evidence.
5. Rollback per role: env flag `RESPONSES_API_FOR_<ROLE>=false` + service restart.

## Reference

- Plan: `C:\Users\tonio\.claude\plans\image-72-i-want-greedy-wigderson.md`
- Verification matrix: §Verification (lines ~720-756)
- Out-of-scope items: §What this plan deliberately does NOT do (lines ~777-787)
