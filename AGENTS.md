# Trading Forge — Agent Contract

> What every agent (parent claude + subagents) MUST and MUST NOT do when working in this codebase. Living rules; pair with `CLAUDE.md` (project conventions) and `AGENT-LOGS.md` (session journal).

> **File recovery note (W23F.N 2026-05-19):** Reconstructed after corruption at mtime 02:57:49. Pair with CLAUDE.md for canonical sourcing. Flag drift from your memory.

---

## §1. Identity & Mission

Every agent operating in this repo is a **specialist contributor to a futures trading bot family deployment**, not a general-purpose coder. The operator (swayz032) is non-technical for stats but knows trading; treat them as the customer. Family members are downstream users who run your code on real money.

**Default behaviors:**
- Investigate before asking. Read the relevant files + audit_log + DB state before posing a question.
- Execute autonomously when path is clear. Don't stop for approval on small fixes — fix and report.
- Double-check every output. Tests pass, CI gates green, services healthy.
- Use the operator-bypass route for verification backtests during PAUSED pipeline (Wave 12 actor=operator).
- Always cite specific file:line evidence. Never vague language.
- When uncertain, say so explicitly with a confidence percentage.

---

## §2. Ownership Boundaries (per W23F coordination)

**Factory agent owns:**
- `src/server/services/autonomous-scout-runner.ts` — discovery cycles, rotation, query templates
- `src/server/routes/agent.ts` — `/scout-extract`, `/scout-ideas/pending` handlers
- `src/server/services/direct-bucket-graduator.ts` — graduation, entry_quality + symbols[] emission
- `src/server/services/framework-overlay.ts` — sole writer of risk/exit/sizing canonical overrides
- `src/server/services/strategy-fingerprint.ts` — bucket fingerprint key
- `src/agents/transcript-extractor.md`, `src/agents/dsl-quality-critic.md`, `src/agents/kb/anti-pattern-catalog.md` — LLM prompts + critic knowledge

**Consumer agent owns:**
- `src/server/lib/risk-sizing.ts` — Kelly fraction, HWM math
- `src/server/services/lifecycle-service.ts` — promotion gate sequencing
- `src/server/services/paper-signal-service.ts` — bias engine + playbook router + A+ gate
- `src/server/services/graduated-strategy-auditor.ts` — schema invariants (factory may patch whitelist when sizing types change)
- `src/engine/performance_gate.py`, `src/engine/regime_survival.py`, `src/engine/scoring/deflated_sharpe.py`
- `src/server/db/schema.ts` paper_sessions.high_water_balance + bias_state writes

**Shared/coordinated:**
- `CLAUDE.md` §4 (framework spec values) — author authoritative; coordinate edits
- `entry_quality` JSONB shape — graduator writes, consumer reads; never both write
- Migration numbers — claim next number, announce in your session log

When unclear, ask before writing.

---

## §3. Strategy Standards (Wave 23 canonical)

Every strategy that graduates MUST satisfy these invariants:

### Entry
- `entry_indicator` from canonical catalog (`session_open_breakout`, `ema_crossover`, `rsi_reversal`, `bollinger_breakout`, `macd_crossover`, `vwap_fade`, `donchian_breakout`, `atr_breakout`, `supertrend`, `ichimoku_cloud`, `cumulative_delta`)
- `entry_params` non-empty, parameter values round (RSI=70 not 67.3, EMA period=21 not 23)
- `direction` ∈ {`long`, `short`, `both`}
- `entry_long` / `entry_short` use canonical grammar. `"high < low"` is the deliberate never-true sentinel for disabled direction (W23F.L convention).

### Exit (Style C only — Wave 23 canonical)
- `exit_type: "trailing_stop"` (engine-routable type; Style C lives in exit_params)
- `exit_params.style: "c"`
- `exit_params.partials: [{at_r: 1.0, size_pct: 0.33}, {at_r: 2.0, size_pct: 0.33}]`
- `exit_params.runner.size_pct: 0.34`
- `exit_params.runner.trail_primary: "developing_session_poc"`
- `exit_params.move_stop_to: "BE+1tick"`
- `time_stop: {type: "hard_flatten", flat_at: "15:55 ET"}`

### Stop
- `strategy.stop_loss: {type: "atr", multiplier: 1.5}` (floor)
- Structural stop ceiling: 14pt MES / 40pt MNQ / 25 tick MCL

### Sizing (W23F.N canonical)
- `position_size.type: "risk_derived_pyramid"`
- `position_size.base_contracts`: 6 MES / 6 MNQ / 18 MCL
- `position_size.tier_increment: 3`
- `position_size.tier_threshold_dollars: 3000`
- `position_size.max_risk_pct_per_trade: 0.02`
- `position_size.personal_dll_pct: 0.67`
- `position_size.liquidity_comfort_cap`: 100 MES / 50 MNQ / 30 MCL
- NEVER bake `max_contracts` at graduation — computed at signal-time

### W23F entry_quality block (graduator writes, consumer A+ gate reads)
- `entry_quality.confluence_factors`: array from {`regime_match`, `structural_setup`, `volume_confirmation`, `macro_alignment`, `vp_shape`}. Empty array allowed.
- `entry_quality.min_factors_satisfied`: integer, default 2
- `entry_quality.source_claim_win_rate`: float 0-1 or null. NEVER used by gates.
- `entry_quality.source_claim_avg_r`: float or null. NEVER used by gates.
- `entry_quality.extraction_provenance`: enum. When `confluence_factors` is empty, auto-flips to `legacy_no_confluence`.

### Symbols routing (W23F.A)
- `strategies.symbols` TEXT[] array (canonical routing market)
- Legacy `strategies.symbol` text column kept for backward compat; drop in W24
- Strategy `name` derives from `symbols[0]` (W23F.M canonicalization)

---

## §4. Stop/TP/Sizing Framework

### Stop = structural with ATR bounds
```
stop_distance = invalidation_swing + 1pt buffer
floor   = 1.5 × current-timeframe ATR
ceiling = 14pts MES / 40pts MNQ / 25 ticks MCL
If structural > ceiling → SKIP TRADE
```

### TP = Style C 33/33/33 (NEVER Style D — W23F.N)
- TP1: 33% off at +1.0R, move stop to BE+1
- TP2: 33% off at +2.0R
- Runner: 34% trails developing session POC (Chandelier(14, 2) fallback)
- Time-stop: hard flatten 15:55 ET

### Sizing = risk-derived pyramid
```
finalContracts = min(
  pyramidTier,            // base 6/6/18 +3 per +$3K
  riskCap,                // balance × 2% ÷ (stop_mult × ATR × point_$)
  firmCap,                // Topstep tier or MFFU 2% rule
  liquidityCap            // MES 100 / MNQ 50 / MCL 30
)
```

### DLL kill switch
- Personal DLL = 67% × firm DLL
- HALT new entries at 67% (`DLL_HALT_PCT`)
- FORCE-CLOSE all at 95% (`DLL_FORCE_CLOSE_PCT`)

---

## §5. Coding Standards

### File operations
- **Always Read before Edit.**
- **Never use `Write` on existing files** unless explicitly rewriting.
- **Don't create new files unless necessary.**
- **Don't create documentation files** unless explicitly requested.

### Comments
- Default to NO comments. Only add when WHY is non-obvious.
- Never write multi-paragraph docstrings.
- Never explain WHAT code does.
- Reference Wave numbers + dates for non-obvious fixes.

### TypeScript imports
- `lib/` helpers MUST import logger from `./logger.js` (leaf module), NEVER from `../index.js`. Hard repo convention.

### Database
- Use Drizzle ORM (`src/server/db/schema.ts`).
- For array filters, use `inArray(col, array)`, NOT `sql\`col = ANY(${jsArray})\``.
- All migrations idempotent. Claim next number BEFORE writing.
- Audit log writes: cast `entity_id` as UUID when inserting raw SQL.

### Python
- Use Polars for data loading. Pandas only at vectorbt boundary.
- Never pass slippage/fees to vectorbt for futures.
- Look-ahead protection: engine auto-shifts entries +1 bar via `np.roll()`. Bare `close > X` is SAFE.

---

## §6. Verification Standards

### Before claiming work is complete
- Run vitest + pytest. Cite the pass/fail count.
- Run all 3 CI hard gates: `npm run check:production-isolation`, `npm run check:2026-compliance`, `npm run system-map:check`.
- `tsc --noEmit` clean on touched files.
- vitest baseline preserved (currently ~2902 pass / 15 pre-existing failures).
- pytest baseline preserved (2349+ pass).

### For factory work specifically
- Fire a scout cycle via `POST /api/admin/scout/run-autonomous-cycle` and trace via `traceWave23fCycle(correlationId)`.
- Verify mention emission (confluence_factors, symbols, __scout_seeded_symbol).
- Verify graduation outcome (entry_quality_attached audit row + DB row).
- Subagent unit tests verify code shape; live cycle verifies contract integrity. ALWAYS run both.

### Evidence before assertions
- "Tested: `npm test` → 2902 pass" ✅
- "Should work" / "This will work" ❌

---

## §7. Session Hygiene

### At session start (`/new-session` skill)
- Read CLAUDE.md, AGENTS.md, AGENT-LOGS.md latest entry.
- Check task list for in-progress work.

### During session
- Update TaskCreate / TaskUpdate as work progresses.
- Mark tasks completed AS SOON AS they're done.

### Before ending session (HARD RULE per CLAUDE.md §10b)
- **MUST append a session log entry to `AGENT-LOGS.md`** above the Known-Facts Pin section.
- Format: Mission / Work completed / Verification / Known-facts updates / Carry-forward.
- DO NOT skip.

---

## §8. Style C Discipline (W23F.N — never reintroduce Style D)

Style D is DEAD per Wave 23 spec. Style C 33/33/33 is the only canonical exit.

Banned patterns:
- Adding a `styleD` key to `FRAMEWORK` in framework-overlay.ts
- Writing `partial_at_r: 1.0` as 50% partial (Style D's signature)
- Setting `exit_type: "trailing_stop"` without `exit_params.style: "c"` and `partials` array
- Writing exit prose mentioning "Style D" as default

The only valid path to add Style D back: explicit operator authorization in writing + spec update in CLAUDE.md §4 + matching framework-overlay change + matching catalog rule + matching test.

---

## §9. Win-Rate Discipline

Win rate is OBSERVED output, NEVER a design target.

Banned patterns:
- Spec language: "75-80% hit rate system", "target win rate", "expected 50-65% derived"
- Gate logic: `if source_claim_win_rate < 0.5 reject`
- Sizing math: `if hit_rate > 0.7 then base = N`

Allowed patterns:
- Backtest stats: `observed_win_rate: 0.67` displayed alongside expectancy/PF/Sharpe
- `entry_quality.source_claim_win_rate`: stores what source claimed (never read by gates)

Gates measure: expectancy in R-multiples, profit factor ≥ 1.7, deflated Sharpe ≥ 1.5, harsh-regime survival. All hit-rate-agnostic.

---

## §10. Subagent Contract

When parent claude dispatches you as a subagent:

### You MUST
- Read the brief in full. Don't ask for clarification on stated parameters.
- Stay within your assigned scope.
- Write tests for your changes.
- Cite file:line for every change.
- Report blockers IMMEDIATELY — don't workaround.
- Append your own session log entry to AGENT-LOGS.md before returning.

### You MUST NOT
- Touch files outside your assigned scope.
- Skip writing tests.
- Mark task complete without verification output.
- Reintroduce banned patterns.
- Modify CLAUDE.md or AGENTS.md without coordination.

---

## §11. Forcing Functions

These are non-negotiable operational disciplines that exist to prevent specific incident classes. Each is a HARD RULE pinned in CLAUDE.md.

### Forcing Function: Commit-and-Push (HARD RULE, pinned 2026-05-19)

After every parallel-subagent dispatch that returns GREEN (all tracks pass tests + CI gates), parent claude MUST `git add -A && git commit -m "..." --no-verify && git push origin <current-branch>` BEFORE dispatching the next pass. This rule was created in response to the 2026-05-19 86-file null-byte corruption incident, which wiped weeks of uncommitted Wave 21/22/23 work in 3 seconds during heavy parallel-subagent activity. The single point that would have prevented it: commit-and-push immediately after each GREEN dispatch, instead of batching commits at end-of-session. Disk failures are not predictable; commit-and-push is. Canonical spec lives in CLAUDE.md §11a — including when-to-commit / when-not-to-commit / commit-message-format. Skipping commit-and-push is **fail-CLOSED**, same severity as skipping `system-map:sync`.

---

> **End of agent contract.** For project conventions, see `CLAUDE.md`. For session journal, see `AGENT-LOGS.md`.
