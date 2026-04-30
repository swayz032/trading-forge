# Trading Forge — Production Hardening

> **Status:** Active. This is the only forward-looking roadmap doc.
> RESEARCH-OS.md, EDGE-MECHANISMS.md, and UPDATE.md are historical specs (build phases done).
>
> **Mission:** make Trading Forge bulletproof for prop-firm production.
> No new features. No Phase 4.16. Every change is hardening, integration, organization, or deletion.

## Scope

Trading Forge has all subsystems built (Phases 4.6–4.15 + enterprise upgrade + autonomy upgrade). The remaining work is making the autonomous loop production-grade so one strategy can reliably reach $10K/month net on a single 50K prop-firm account.

Production-grade means:
- Pipeline + lifecycle bulletproof — no orphan states, no silent drops, atomic transitions, full audit
- n8n production-ready — retry, idempotency, errorWorkflow, dedupe, healthy execution history
- Every built subsystem wired into the live pipeline or deleted
- Zero bugs, errors, or disconnects Node ↔ Python ↔ n8n ↔ Postgres ↔ frontend
- Organized — no duplicates, no shelfware, no half-finished refactors
- No overkill — small fixes stay small; prefer deletion over abstraction

## Wave 1 — Stop The Bleeding (pipeline-broken)

| # | Issue | File | Fix |
|---|---|---|---|
| 1 | Scout→backtest dead-end. `scoutIdeas()` writes `status='scouted'`; nothing consumes them. | `src/server/services/agent-service.ts:553` | Add scheduler job: pull `status='scouted'`, post to `/api/agent/run-strategy` |
| 2 | Duplicate migration 0038 — two files share number. | `src/server/db/migrations/0038_*.sql` (×2) | Rename one to `0038a_…` |
| 3 | Lifecycle bypassed. PATCH writes `lifecycleState` directly; backtest auto-promote writes `PAPER` directly. | `src/server/routes/strategies.ts:188-224`, `src/server/services/backtest-service.ts:859-863` | Reject `lifecycleState` in PATCH; auto-promote must call `promoteStrategy()` |
| 4 | Pine deploy reads firmKey from wrong path; defaults to `topstep_50k` for every deploy. | `src/server/routes/strategies.ts:345-350` | Read `strategy.config.firmKey` |
| 5 | Decay monitor noop on PAPER/TESTING. Half-life skips them. | `src/server/scheduler.ts:1502-1507` | Map PAPER→DECLINING |
| 6 | Stuck `running` rows on crash (SQA/QUBO/tensor/RL/quantum-MC orphans). | `backtest-service.ts:489,572,619,687` | One sweeper: mark `running` >1h as `failed` |
| 7 | n8n API auth fails. Live workflow health unverifiable. | n8n Settings → API | Rotate `N8N_API_KEY`, restart MCP |

## Wave 2 — Wire Or Delete (subsystem decisions, no overkill)

For each subsystem: **wire it for real, or delete it.** Half-shelfware is the worst option.

| Subsystem | Status | Decision |
|---|---|---|
| `src/engine/compliance/compliance_gate.py` | Never invoked from Node | Wire into promotion path **or** delete |
| `src/engine/governor/` (state_machine, trade_filter) | Manual API only, never gates trades | Wire into `paper-signal-service.ts` **or** delete |
| `src/engine/skip_engine/` (classifier, premarket, historical_skip_stats, weight_trainer) | Only `calendar_filter` is live | Wire `classify_session` into paper-signal **or** delete |
| `src/engine/survival/` (scorer, drawdown_simulator, comparator) | Manual API only, NOT in forge_score | Add `survival_score` to promotion gate **or** delete |
| `src/engine/decay/decay_gate.py, quarantine.py, sub_signals.py` | Test-only | Delete |
| `src/engine/archetypes/` | Manual classify only; `day_archetypes` table empty | Add daily classify cron **or** delete |
| `src/data/macro/regime_graph.py, event_calendar.py` | Manual GET only | Add macro sync cron **or** delete |

## Wave 3 — n8n Pipeline Wiring

Requires Wave 1 #7 (API access) first.

| # | Issue | Workflow | Fix |
|---|---|---|---|
| 8 | Two `Macro_Data_Sync` workflows live (different IDs). | live n8n | Pick one, archive the other |
| 9 | No workflow promotes PAPER→DEPLOY_READY. | scheduler.ts | Confirm scheduler owns it OR add n8n step + document |
| 10 | No workflow calls `/api/walk-forward` or `/api/montecarlo`. | scheduler | Document scheduler ownership in CLAUDE.md OR wire through n8n |
| 11 | Critic loop not chained to backtest completion. | `Strategy_Generation_Loop` | Add critic call after backtest writes complete |
| 12 | Nightly_Strategy_Research_Loop does not call canonical `/api/agent/scout-ideas`. | workflow drift | Align with canonical or remove drift |
| 13 | No `errorWorkflow` set on Strategy_Generation_Loop, Nightly_Research, 8A, 11A. | live n8n | Assign `0A-health-monitor` as errorWorkflow |
| 14 | No idempotency keys on any trading workflow HTTP node. | all trading workflows | Add `x-idempotency-key` on POSTs to journal/backtest/critic |
| 15 | Stray `localhost:4000` breaks Docker callers. | `Strategy_Generation_Loop:710` | Use `host.docker.internal:4000` |
| 16 | Filename duplicates in `workflows/n8n/` (em-dash vs underscore). | export dir | Delete underscore variants, standardize naming |

## Wave 4 — Data Integrity & Contract Drift

| # | Issue | File | Fix |
|---|---|---|---|
| 17 | 20+ FKs to `strategies.id`/`backtests.id` lack `onDelete: cascade`. | `src/server/db/schema.ts` | Add `onDelete: "cascade"` (or `set null` for audit_log); remove manual cascade in route |
| 18 | Lifecycle promote not transactional. | `lifecycle-service.ts:99-153` | Wrap in `db.transaction` |
| 19 | `broadcastSSE` outside transaction — fires when audit insert failed. | `lifecycle-service.ts:309,412,462` | Move SSE inside transaction or pre-validate |
| 20 | Decay status string drift: Python returns `accelerating_decline`, Node normalizer translates. | `backtest-service.ts:32` | Pick one canonical string everywhere |
| 21 | Fire-and-forget `runStrategy`/`batch` lack pending row — silent loss on crash. | `routes/agent.ts:182,217` | Insert `audit_log` pending BEFORE async call |
| 22 | `find-strategies` always marks audit as failure (success criterion bug). | `routes/agent.ts:431-435` | Fix success criterion |

## Wave 5 — Strategy/Indicator Organization

Indicators/strategies are 95% clean. Three small items:

- Add 3 missing SMT wrappers to `src/engine/indicators/smt.py`: `gc_dxy_smt`, `ym_es_smt`, `indices_bonds_smt` (custom_smt covers them but named wrappers expected by docs)
- Decide on `__init__.py` policy for `indicators/` and `strategies/` (currently empty — leave or populate, but consistent)
- All 19 ICT strategies wired with tests. No dead code. ✅

## Risks

- Wave 1 #5 (decay map fix): verify zero PAPER strategies are mid-decay before deploying, to avoid mass demotion.
- Wave 2 deletions are irreversible — confirm subsystem-by-subsystem before removing files.
- Wave 3 needs live n8n API access (#7 must complete first).
- Wave 4 #17 (FK cascade migration) requires backup before applying — test in dev first.

## Execution Order

1. **Wave 1** (~1 day) — items 1–6 are pure code; #7 requires user in n8n UI
2. **Wave 4** (~2–3 days) — data integrity, transactional lifecycle, FK cascade
3. **Wave 2** (~3–5 days) — wire-or-delete decisions, one subsystem at a time
4. **Wave 3** (~1–2 days) — n8n cleanup once API access restored
5. **Wave 5** (~half day) — SMT wrappers + organization

Total: ~10 working days to fully production-grade.

## Done Criteria

The system is production-ready when:

- [ ] A scouted idea flows end-to-end (scout → compile → backtest → WF → MC → compliance → paper → DEPLOY_READY) without manual nudge
- [ ] No `running`/orphan rows older than 1h exist in any table
- [ ] All lifecycle transitions go through `promoteStrategy()` and write `audit_log`
- [ ] All trading n8n workflows have `errorWorkflow` set and idempotency keys on POSTs
- [ ] Every built subsystem either appears in a live code path OR has been deleted
- [ ] `npm run system-map:check` passes with zero drift
- [ ] DELETE strategy cascades cleanly with no dangling FK rows
- [ ] One strategy reaches DEPLOY_READY autonomously and meets TIER 1/2/3 gates per CLAUDE.md
