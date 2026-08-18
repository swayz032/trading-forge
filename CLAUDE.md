# Trading Forge — Project Conventions

> Living rules for operating the system. Build history: `AGENT-LOGS.md`. Architecture: `Trading Forge System Map v2.md`. Deep detail moved out of this file lives in `docs/reference/` — see §16 for the index. This file is the small always-on kernel; read a reference doc only when your task actually touches that surface.

---

## §0. Session Kernel — what every session needs, before anything project-specific

1. **The repository is source of truth.** A report, a chat summary, a prior session's claim, or your own memory of this file is testimony, not proof. Inspect the actual code, commits, and test output before asserting something is true, done, or fixed.
2. **FAST + ROBUST.** Prefer the shortest solution that preserves correctness. Don't over-engineer, don't gold-plate, don't add scope nobody asked for.
3. **Never weaken a gate, threshold, or test merely to obtain green.** If a check is genuinely wrong, fix the check explicitly and say so — don't quietly loosen it to pass.
4. **Fail closed when required evidence is missing.** Absence of proof is not proof of safety, especially near money-handling or gate logic.
5. **Preserve history and evidence.** Don't rewrite, delete, or silently "clean up" proof/artifacts/logs to manufacture a pass. Strike-and-retain, never delete-and-forget.
6. **A named permanent role (a worker lane, a standing campaign seat) is your identity for the session.** A one-off directive or temporary ruling changes what you work on next — it does not change who you are. When the temporary task closes, return automatically to the permanent lane unless explicitly told otherwise.
7. **Read detailed skills and reference docs only when the workflow actually needs them.** Don't front-load history you don't need yet; don't work from a remembered skill you haven't re-read this session (skills mutate).
8. **When you need detail this file doesn't carry, follow the pointer** (§16) rather than guessing or re-deriving it from scratch.

These eight are general-purpose and apply regardless of which subsystem or campaign you're seated on. Everything below this line is Trading-Forge-specific.

---

## §1. Mission

Trading Forge is a production-grade, family-distributable futures trading bot infrastructure. Operator (swayz032) and family members each run independent bots on independent prop firm accounts.

**Target:** scale ONE robustly-validated strategy (avg-R ≥ 2.0R, PF ≥ 1.7, deflated Sharpe ≥ 1.5, max 1-2 A+ trades/day) from a $250/day baseline to **$1,000–5,000+/day** via four scaling levers (see §5). Win rate is an OBSERVED output metric — never a target, never a gate, never specified as a band.

1. **Contract pyramid** — single account, profit-tier scaling on one strategy. Growth is primarily HORIZONTAL (multiple Topstep accounts + copy-trade), not maxing one account — see `docs/scaling-plan-baby-mode.md`.
2. **Multi-account same firm** — Topstep allows multiple accounts per user.
3. **Multi-firm parallel** — Topstep + MFFU running DIFFERENT strategies per firm (MFFU collaborative-trading compliance).
4. **Family copy distribution** — each family member runs a DIFFERENT DEPLOYED strategy on their own TradingView + TradersPost + own MFFU/Topstep account.

Agents must never fake profitability. The gates decide.

---

## §2. Current Phase: Production Hardening ONLY

All build phases are done. **No new subsystems for 90 days.** The only work is production hardening:

- **Pipeline production** — CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT → DEPLOYED must flow without orphan states or silent drops.
- **Lifecycle production** — every state transition atomic + audited via `audit_log` and `lifecycle_transitions`.
- **Bug tracing** — correlation_id propagates end-to-end (bar → handler → DB → SSE → audit_log) so any 90-day-old trade can be reconstructed.
- **Bugs / errors / disconnects / incidents** — fix them where they live; root cause, not workaround.
- **n8n enterprise grade** — every workflow has retry + idempotency + `errorWorkflow` attached to `DGEk1D478xWJClKD` (`0A-health-monitor`) + dedupe. Drift detector runs weekly (Sun 19:00 ET) + monthly. Both are pipeline-gate-exempt.
- **Bottlenecks blocking lifecycle flow** — anything stopping CANDIDATE from reaching DEPLOYED is the priority.
- **Systems live together** — Node ↔ Python ↔ n8n ↔ Postgres ↔ frontend must agree on contracts. No silent drift.
- **System Map sync mandatory** — after every architectural change, run `npm run system-map:sync` and keep `system-map:check` green.
- **Claude Code Team Mode** — multi-pass parallel-subagent dispatch is the default for any work touching ≥2 subsystems.

**Agents must reject feature-add suggestions and reframe work as production hardening.**

> Full wave-by-wave close-out history (Waves 24–29, deep-scans, campaigns) moved to `docs/reference/claude-md-wave-history.md` — read on demand, not every session.

---

## §2b. Scout Architecture

The scout pipeline discovers strategies from web/YouTube/Reddit, extracts DSL via LLM, and a framework overlay REPLACES the scout's risk-management with operator-canonical defaults (Style C 33/33/34, ATR stops, pyramid sizing) while PRESERVING the entry signal. Full layer-by-layer detail (Exa/Brave/Parallel web layer, YouTube Data API + transcript layer, Reddit layer, cross-validation graduation, 11-factor confluence scoring, decay model, structure engine, 5-TF MTF hierarchy, HTF narrative) and the pinned facts agents must not misdiagnose (SplitInBatches indices, webhook re-registration, Reddit sort order, title scoring, backtest bar-shift semantics, Style D is dead, sizing is framework-authoritative) all moved to:

**`docs/reference/claude-md-scout-architecture.md`** — read before touching any scout/extraction/graduation code.

---

## §3. Operator Workflow

### Daily (5 minutes)
- Glance at `ProductionStatusPanel` — 6 questions, GREEN/RED.
- Discord ping on any RED → handle on phone.
- That's it. The bot trades; you observe.

### Weekly (Sunday, 30 minutes)
- Read weekly drift report (auto-fires Sunday 6 PM ET; auto-HALT on >2σ deviation).
- Review `LibraryDiversityPanel` — is scout pipeline producing new strategies?
- Approve any DEPLOY_READY → PILOT promotions (or enable operator-absent mode if vacationing).
- Family member check-in: any TradingView / TradersPost issues?

### Vacation Mode (operator absent 7+ days)
- Set `OPERATOR_ABSENT_AUTOPROMOTE=true`. Tier 1 strategies (rolling Sharpe ≥ 2.0, all gates passed) auto-promote DEPLOY_READY → PILOT.
- BW vault auto-refresh (`TF_VAULT_MODE=bitwarden`) + prop-firm cookie refresh keep secrets/C2 evidence intact.
- Dead-man's heartbeat alerts via Discord/SMS if backend silent >2h during RTH.
- `operator_absent_since` auto-flips from sustained silence (24h zero human-authority audit rows → `operator_absent_pending`; another 24h → `operator_absent_since` engages Tier-1 autopilot). Cancel via `POST /api/admin/operator-mark-present` (or any admin action — writes a human-authority audit row that clears `pending`).
- 14-day vacations are safe by design.

---

## §4. Trading Framework (Wave 23 — Style C canonical)

Core invariants — the full formulas, per-symbol tables, env-var knobs, and historical rationale for each of these live in **`docs/reference/claude-md-trading-framework-detail.md`**:

- **Stops are structural, NEVER fixed-point.** Two-role ATR geometry (managed stop vs sizing stop, `stop-geometry.ts`/`stop_geometry.py`, parity-gated). Floor 1.5×ATR (+6pt MES min on the sizing side only), ceiling 14pt MES / 62pt MNQ / 100 ticks MCL. Exceeding ceiling → SKIP TRADE, never clamp down.
- **Exits:** Style C 33/33/34 is the canonical, LIVE default (TP1 1R / TP2 2R / runner trails POC or Chandelier fallback, BE+1 on TP1, 15:55 ET hard flatten). Adaptive exits are opt-in per strategy (`exit_plan_config.exit_style="adaptive"`) and never override the 15:55 flatten or BE+1 invariants. **Style D is DEAD — never reintroduce.**
- **Sizing is risk-derived, not contract-count-bounded.** `finalContracts = max(0, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap, drawdownRoomCap))` — pure lowest-wins. Below 1 contract → skip the trade, never a fabricated floor. Base 9 MES / 9 MNQ / 18 MCL, +3/tier on proven-trades ramp (live) or +$3K (backtest fallback), per-symbol liquidity caps 100/50/30.
- **Daily Loss Limit:** personal DLL = 67% of firm DLL. 60% → reduce new-entry size ×0.50 (floored ≥1). 67% → halt new entries. 95% → force-close all. Reset at session boundary.
- **Daily Trade Cap:** default 2 trades/day/account (operator's "1-2 A+ trades/day" mandate), hard signal-time gate, fail-OPEN on DB error.

---

## §5. Scaling Plan — $250/day → $1K-5K+/day

| Phase | Scaling lever | Daily target | Account requirement |
|---|---|---|---|
| 1 | Single account + base size (9 MES) | $250–$1,000+/day | MFFU 50K eval funded |
| 2 | Risk-derived pyramid (6 → MFFU-2%-bounded cap) on one strategy | $1,000-3,000/day | Same account, accumulated profit |
| 3 | Multi-account same firm (Topstep: N accounts per user) | $2,000-5,000/day | 2-3 Topstep accounts under one user |
| 4 | Multi-firm parallel (Topstep + MFFU, DIFFERENT strategies per firm) | $3,000-7,000/day | Both firms funded; different strategy per firm |
| 5 | Family copy distribution (4 family × different strategies) | $5,000-15,000+/day household | Each family member fully onboarded |

**★ Daily dollar figures are OBSERVED OUTCOME ranges — never quotas and never ceilings.** No fixed take-profit; the runner trails until invalidation or the 15:55 ET flatten. Nothing caps a winning day; nothing forces a minimum on a no-quality day (0 trades = valid). Mini contracts (ES/NQ/CL) are FUTURE — graduate only when single account funded balance ≥ $200K.

---

## §6. Prop Firms — Topstep + MFFU ONLY

### Topstep (PRIMARY)
Rules: `docs/prop-firm-rules-2026-topstep.md`. Platform: TopstepX ONLY (NinjaTrader/Tradovate banned). Multi-account + copy trading within one user: ALLOWED. Personal device only — no VPS/VPN/remote desktop. Trailing drawdown: EOD.

### MFFU (secondary)
Rules: `docs/prop-firm-rules-2026-mffu.md`. 80/20 payout, bi-weekly. BANS: collaborative trading (2+ accounts on identical/opposite strategies), same-device sharing, hedging (MNQ+NQ simultaneously). 2% max loss per trade. Tier-1 economic-data restricted trading (FOMC, CPI, NFP, GDP, ISM, PPI).

CI lint: `npm run check:2026-compliance` fails if `firm_config.py` or compliance gates drift from these canonical docs.

---

## §7. Execution Layer

Routing is **firm-specific**: Topstep → TopstepX REST/WS direct (no TradersPost — banned Tradovate/NinjaTrader 2026-01-12; stub today, returns `topstepx_not_configured`); MFFU/other firms → TradersPost webhook → Tradovate; TradingView paper-test → TradersPost → Tradovate demo. `src/server/services/broker-router.ts` is the single source of truth for order routing; `broker_accounts` maps account_id → firm_id + broker_type + vault ref.

**The Pine parity wall:** Pine Script cannot reproduce Style C / adaptive exits, the 11-factor confluence gate, multi-TF gating, or the RL challenger. `exportability.py`'s `faithful` flag HARD-blocks any Pine export that would misrepresent the strategy. Full Slumdawg rides the TF engine → broker-router path directly; TradingView Pine is for the family's simple strategies and as a visual monitor only, never for executing full Slumdawg. Numerical-parity control: `scripts/pine-broker-reconcile.ts` (2-tick tolerance, `pine_parity.reconciliation_run` audit row). Full detail (cost split, static equivalence tests, exact stub/audit names): `docs/reference/claude-md-execution-layer-detail.md`.

---

## §8. Paper Testing — TradingView is the Bot's Eye

**PAPER is internal-engine-only** (M3, supersedes the old TradersPost-authoritative model). The canonical PAPER journal is the internal Massive-WS simulator; TradersPost becomes canonical only from DEPLOY_READY onward. `POST /api/paper/start` allows PAPER-state strategies and rejects DEPLOY_READY/PILOT/DEPLOYED (`paper.start_refused_paper_state`). Single source of truth for the authority boundary: `src/server/lib/paper-authority-states.ts` (`BROKER_AUTHORITATIVE_STATES`).

Family/external Pine workflow (separate from the above): load `.pine` into TradingView → webhook to TradersPost (Once Per Bar Close) → PAPER account → watch 3-5 trading days → compare Strategy Tester P&L vs TradersPost P&L (within 1-2 ticks) → flip destination to funded account.

---

## §9. Family Distribution

Each family member runs an independent stack: own TradingView Premium, own TradersPost, own prop firm account, own personal device (same-device BAN). Operator assigns a DIFFERENT strategy per family member on the same firm (MFFU compliance); Topstep multi-account same-strategy is allowed for the operator's own accounts. `account_strategy_assignments` enforces UNIQUE(account_id, strategy_id) and holds the idempotent `hmac_secret` per account+strategy pair. Per-recipient Pine embeds a `qty`-substituted + HMAC-secured export, stored in the `strategy_export_artifacts` table (DB, not filesystem).

Onboarding docs: `docs/family-onboarding-runbook.md`, `docs/family-onboarding-checklist.md`, `docs/family-monitoring-guide.md`, `docs/strategy-update-runbook.md`, `docs/family-2026-rules-cheatsheet.md`.

---

## §10. System Map = Source of Truth

`Trading Forge System Map v2.md` is canonical for all subsystem details. After every architectural change: `npm run system-map:sync` → `npm run system-map:check` (CI gate, must exit 0) → update `docs/system-readiness.generated.json` + `docs/system-topology.generated.json` → write `audit_log` row `system_map.synced`. **No track is complete until System Map sync passes.**

---

## §10b. AGENT-LOGS.md Write Mandate (HARD RULE)

`AGENT-LOGS.md` is the project's session-by-session memory. **Every agent must append a session-log entry before ending its session**, placed above the `## Known-Facts Pin` section:

```markdown
### Session Log — YYYY-MM-DD <short title>
**Mission:** <one sentence>
**Work completed:** <bullets>
**Verification:** <test runs, validator output, live checks>
**Known-facts updates:** <only when you pinned a new fact>
**Carry-forward for next session:** <unfinished, blocked, follow-ups>
```

Canonical audit-action vocabulary the graduation hot-path added (Wave 26): `graduation.rejected_incomplete_bidirectional`, `graduation.bidirectional_incomplete_rejected`, `graduation.factor_quality_classified`, `graduation.thin_confluence_warning`, `extraction.parity_test_run` — full detail in `docs/reference/claude-md-wave-history.md`.

---

## §11. Claude Code Team Mode

### Skills invoked for any plan execution
`superpowers:executing-plans`, `superpowers:dispatching-parallel-agents`, `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`.

### Project skills (`.claude/skills/` — invoke via Skill tool; each encodes a documented production failure)
| Skill | MUST fire when |
|---|---|
| `grading-integrity` | Assigning/reporting ANY score, band, grade, or readiness verdict. Doer ≠ grader; no bare numbers. |
| `tf-debugging` | Debugging ANY TF failure — BEFORE forming hypotheses or restarting anything. |
| `deep-scan` | Any deep-scan / audit / fix wave / re-certification — BEFORE dispatching finder or fixer agents. |
| `ratify-packet` | Any change touching INSTRUMENT code (engine, gates, classifiers, measurement, sizing) — BEFORE writing code. |
| `migration-author` | Creating/editing/reviewing any SQL migration or `_journal.json` entry — BEFORE the file lands. |
| `worktree-session` | Starting/landing any worktree, dispatching `isolation:"worktree"` agents, or verifying inside a worktree. |
| `transcript-audit` | After EVERY gemma probe, before any mass (re-)extraction, or when grading extraction quality/intake rejects. |

### Subagent charters (4-pass execution pattern)
`backtest-core` (DSL/engine/schema/fixtures) · `paper-parity` (paper execution, lifecycle, broker, kill switches) · `pine-export` (Pine compiler, per-recipient export) · `observability-reliability` (tracing, audit_log, SSE, alerting, drift) · `trading-forge-architect` (cross-cutting integrity, System Map sync — runs LAST per track) · `quantum-challenger` (quantum, challenger-only) · `n8n-orchestration` (workflow integrity, drift, retry/idempotency) · `critic-optimizer` (critic loop, bounded refinement).

Coordination: sequential within a track when dependencies exist; parallel across tracks when independent; `trading-forge-architect` last; `observability-reliability` after every pass; parent reviews each subagent output before approving merge.

---

## §11a. Commit-and-Push Discipline (HARD RULE)

After EVERY parallel-subagent dispatch that returns GREEN (all tracks pass tests + CI gates): `git add -A && git commit -m "<message>" --no-verify` (only safe in an isolated worktree — on a shared tree use `git commit -o <paths>` instead, §11b) → `git push origin <branch>` → then dispatch the next pass. Applies whether the dispatch was 1 agent or 10, even if more agents follow immediately. **Pinned after the 2026-05-19 86-file null-byte corruption incident that wiped weeks of uncommitted work in 3 seconds** — disk failures are not predictable, commit-and-push is. Skipping it is fail-CLOSED severity, same tier as skipping `system-map:sync`.

Do NOT commit if: the subagent returned RED, the tree has unreviewed AI-generated changes the operator hasn't seen, or the changes are temporary debug logging.

---

## §11b. Multi-Session Worktree Isolation (HARD RULE)

**When two or more Claude sessions/agents work this repo at once, each MUST operate in its OWN `git worktree` and integrate to the shared branch only at the END of its work.** Sharing one working tree means sharing one index/HEAD/stash, which has repeatedly caused silent data loss (null-byte corruption, `git add -A` sweeping another session's files, a branch switch moving another session's HEAD, a shared stash wiping another session's edits).

**The six load-bearing steps:**
1. Own directory per session (`git worktree add <path> <base>`) — never two sessions in one checkout.
2. **Pin the base to an explicit SHA, not a branch name** — a branch-name base tracks the moving shared HEAD.
3. **NEVER `git stash` in a worktree** — `refs/stash` is shared across all worktrees; use a WIP commit or patch file.
4. Verify GREEN in the worktree before landing: `tsc --noEmit` clean + relevant vitest/pytest + the 3 CI gates.
5. Land via fast-forward-only merge/rebase; re-verify before force-integrating if FF is impossible.
6. `git worktree remove <path>` when done.

Fallback when isolation is genuinely impossible: commit ONLY explicit paths (`git commit -o <paths>`), never `git add -A`, `git status -sb` before every push. Strictly worse than isolation — last resort only. Full incident detail and the Agent-tool `isolation:"worktree"` caveat: `worktree-session` skill.

---

## §11c. Zero Carry-Forwards (HARD RULE)

**Operator mandate: NO carry-forwards, ever.** Every finding a scan/fix-wave/task surfaces on your fixable surface closes in the SAME wave — n8n exports, doc-drift, CI-lint coverage, LOW-severity items are NOT exempt. "Log it for next wave" is banned. (Memory: `feedback_zero_carry_forwards_absolute_2026_07_16`.) The only legitimate non-closure is a finding whose fix lives in a file another concurrent agent actively owns (worktree-isolated + explicit "don't interfere") — that's an immediate, named hand-off surfaced the SAME session, never a parked TODO. At record time the carry-forward ledger must be empty or contain only actioned hand-offs with a named owner.

---

## §12. Hard Gates — Don't Bypass

The pipeline enforces ~40 named lifecycle/signal-time gates (compliance, DLL/trade-cap, structural-stop skip, WFE/PBO/B14/BIF/parameter-drift/frozen-policy/shadow-divergence at promotion boundaries, macro/lunch/PM-taper at signal time, composite-health as advisory-only, RL as challenger-only-never-a-gate). **Full table — exact stage, mechanism, threshold, env var, and Wave provenance for every gate — lives in `docs/reference/claude-md-hard-gates.md`. Read it before touching any lifecycle or promotion-gate code**, since several gates have non-obvious fail-open/fail-closed and advisory/hard distinctions that are easy to get backwards.

The two invariants worth carrying in your head even without opening the reference: **`killSwitch.isHaltedForProduction()` is the FIRST gate in any new entry path, no exceptions**, and **composite-health / RL signals are advisory-only and must never gate promotion** — Wave 27.5's hard gates (B14, WFE, parameter drift, B15, compliance enforce) retain sole veto power.

---

## §13. Don't

**Full categorized list (Data / Execution / Compliance / Operations / Family Distribution / Architecture) with the incident or rationale behind each rule lives in `docs/reference/claude-md-dont-list.md`.** Read it before touching the corresponding surface — most entries exist because a specific documented failure happened, and the rule is the fix.

The handful worth carrying in your head everywhere:
- Don't use fixed-point stops — structural with ATR bounds, floor/ceiling, skip if exceeded.
- Don't bypass `routeOrder()` / `broker-router.ts` — every order flows through it.
- Don't bypass `killSwitch.isHaltedForProduction()`.
- Don't store secrets in code — `.env` or Bitwarden vault only.
- Don't flip symbol micro→mini (MES→ES etc.) without `contract_class="mini"` + the mini-specs migration — CONTRACT_SPECS use MICRO point values; flipping silently inflates risk 10×.
- Don't write hit-rate/win-rate targets into a spec — win rate is an OBSERVED output, never a design parameter.
- Don't auto-promote Tier 2/3 in operator-absent mode — only Tier 1 qualifies.
- **Ship gates STRICT, then loosen with DATA, not fear** — diagnose with `src/engine/gate_block_analyzer.py` before loosening any entry gate.

---

## §14. Commands

```bash
# Development
npm run dev                              # Start Express server with hot reload
npm run db:generate                      # Generate Drizzle migration
npm run db:migrate                       # Run migrations
npm run db:studio                        # Open Drizzle Studio
npm test                                 # vitest
npm run lint                             # ESLint

# CI hard gates (must all pass)
npm run check:production-isolation       # Production code can't import research
npm run check:2026-compliance            # firm_config matches canonical 2026 docs
npm run system-map:check                 # System Map drift detection

# Architectural
npm run system-map:sync                  # Regenerate System Map after changes

# n8n
npm run audit:n8n                        # n8n drift detector
```

---

## §14b. Backtest Concurrency Contract

Production-grade concurrency hardening (2026-05-19, after a 6-backtest × 4-WF-worker OOM crash). Defaults: `MAX_CONCURRENT_BACKTESTS=3` (429 above this), `WF_MAX_WORKERS=2`, `BACKTEST_TIMEOUT_MS=1800000` (30 min), `BACKTEST_STALENESS_DAYS=30` (promotion blocked on stale backtest). On 429, the caller must retry after 30s — do not queue or block. True orphan = `status='running'` for >60 min; only those are swept to `failed` on server restart. Promotion-gate override for max speed: `WF_MAX_WORKERS=4`, `MAX_CONCURRENT_BACKTESTS=1`. Full detail (load math, health-endpoint shape, exact error strings, `MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION`): `docs/reference/claude-md-backtest-and-tech-stack-detail.md`.

---

## §15. Tech Stack

- **API Server:** Express.js 5 + TypeScript (`src/server/`)
- **Database:** PostgreSQL on Railway + Drizzle ORM (`src/server/db/schema.ts`)
- **Backtest Engine:** Python + vectorbt + Polars + DuckDB (`src/engine/`)
- **AI Agents:** TypeScript + Ollama (`gemma4:e4b-it-qat` — the ONE local model, tower-side) + GPT-5-mini/GPT-5.4 (cloud primary for reasoning). Do NOT re-pull retired models (`gemma4:e2b`, `deepseek-r1:14b`, `qwen2.5-coder:7b`, `phi4-mini`, `nomic-embed-text`) — repoint any stale reference to `gemma4:e4b-it-qat`. Override vars: `TRANSCRIPT_EXTRACTOR_LOCAL_MODEL` / `TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA` / `TRANSCRIPT_EXTRACTOR_FORCE_CLOUD` (panic-revert) / `PARAMETER_EVOLVER_MODEL`. Full Ollama/gemma4 request-shape + schema-enforcement detail: `docs/reference/claude-md-backtest-and-tech-stack-detail.md`.
- **Orchestration:** n8n on Railway — `https://n8n-production-84ff.up.railway.app`
- **Data Lake:** AWS S3 (Parquet, ratio-adjusted continuous contracts)
- **Dashboard:** React + Vite + TailwindCSS (`Trading_forge_frontend/amber-vision-main/`)
- **Data Providers:** Databento (historical), Massive Starter (delayed aggregates — the internal PAPER engine's feed), Alpha Vantage (indicators + sentiment)
- **Execution:** TradingView Premium → TradersPost → MFFU/Topstep (current); TopstepX API direct (future)
- **Hosting:** Hybrid — Skytech tower (Ollama + Python backtest + NSSM services) + Railway (Postgres + n8n + tf-relay)
- **Quantum:** IBM Quantum Platform + AWS Braket (challenger-only)

**Wave 27–29 env-var reference** (MC hard gates, WFE/PBO/B14 thresholds, backtest engine hardening flags, Phase-5 contract-spec gate, composite-health floors, quantum RL bridge, frozen-policy HMAC, shadow-divergence gate) moved to **`docs/reference/claude-md-env-vars.md`** — read before touching any of those subsystems; the defaults matter and several have "don't raise this" ceilings.

---

## §15a. Hosting Topology & Power Resilience

Hybrid: Skytech tower (24/7, runs the entire institutional safety stack — kill-switch L1-L9, B14 gate, compliance enforce, frozen-policy hash, scheduler crons) ↔ Railway (n8n + Postgres + tf-relay), connected via `tower-relay-client.cjs` over WSS. **None of the safety stack fires when the tower is offline.**

🛑 **HARD RULE: any operator running live or PAPER+ strategies MUST have both a UPS and a Kasa smart plug installed before the first live trade** — this is the physical-layer prerequisite for the safety contract, not optional gear. Topology must be `WALL OUTLET → KASA → UPS → TOWER` (Kasa upstream of UPS, so a remote power-cycle can fully de-energize and cold-boot the tower). Full setup steps, required env vars (`KASA_DEVICE_IP`/`KASA_USERNAME`/`KASA_PASSWORD`, all-or-none), the self-restart HMAC endpoint, and the dead-man's-heartbeat → remote-power-cycle flow: **`docs/reference/claude-md-hosting-ops.md`**.

---

## §16. On-Demand References — full index

Everything below is intentionally NOT in this always-loaded file. Load the specific doc when your task actually touches that surface.

| Reference | Load it when you're touching |
|---|---|
| `docs/reference/claude-md-wave-history.md` | Need historical wave/campaign close-out detail |
| `docs/reference/claude-md-scout-architecture.md` | Scout discovery, extraction, graduation, confluence scoring |
| `docs/reference/claude-md-trading-framework-detail.md` | Stop geometry, exits, sizing, DLL, trade-cap formulas/env vars |
| `docs/reference/claude-md-hard-gates.md` | Any lifecycle/promotion gate — full mechanism + threshold + env var table |
| `docs/reference/claude-md-execution-layer-detail.md` | Broker routing, Pine parity wall, cost split, stub/audit-row exact names |
| `docs/reference/claude-md-dont-list.md` | Full categorized "Don't" list with incident rationale |
| `docs/reference/claude-md-env-vars.md` | Wave 27–29 env-var reference (MC/WFE/PBO/B14/RL/frozen-policy/composite-health) |
| `docs/reference/claude-md-hosting-ops.md` | Tower/Railway topology, UPS/Kasa setup, self-restart |
| `docs/reference/claude-md-backtest-and-tech-stack-detail.md` | Backtest concurrency math/error strings, Ollama/gemma4 request-shape detail |
| `AGENT-LOGS.md` | Session-by-session build history |
| `Trading Forge System Map v2.md` | Canonical subsystem architecture |
| `AGENTS.md` | Cross-tool agent contract (Codex/other harnesses) |

> **Living rules end here.** For build history, see `AGENT-LOGS.md`. For subsystem architecture, see `Trading Forge System Map v2.md`. For agent contract, see `AGENTS.md`.
