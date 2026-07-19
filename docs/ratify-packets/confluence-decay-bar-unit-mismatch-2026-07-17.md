# Ratify-Packet — Confluence Decay Bar-Unit Mismatch (`market_structure_aligned`, 0.20 weight)

**STATUS: LANDED IN-WORKTREE, NOT YET INDEPENDENTLY GRADED. Packet landing is NOT authorization,
and implementer-side self-checks are NOT the independent grade this skill requires.** §3a and §3b
are both implemented in this worktree (option (b): day-scale recalibration + recency-first per-type
age wiring, per §2b's investigation) — confirmed by reading the live code, not asserted from the
plan. §6 below is an **implementer-side verification receipt** (real command output, doer == the
agent that also wrote this status) — it is evidence for a grader to check, not itself a "VERIFIED"
determination; per the `ratify-packet` + `grading-integrity` skills, "VERIFIED" is reserved for a
fresh-context independent grader, doer != grader, always. Autonomous class per the operator-amended
`ratify-packet` skill (2026-07-11) — **NOT** the irreversible/live-capital class: nothing is
live-trading yet, and §2 below establishes this defect has **zero backtest/certification blast
radius** (every frozen band, golden fixture, WFE/PBO/B14 number, and frozen-policy hash was computed
with `structure_state=None` throughout — see §2, empirically confirmed in §6 item 3). This packet
records the pre-work staged plan verbatim (§1-§5) as the receipt anchor the independent grader rules
on; §6 is the post-implementation closure a fresh-context independent grader must re-verify (not
merely re-read) before this packet lands to `hardening/phase-0`.

Base: `hardening/phase-0` @ `56f0fd04`. Worktree: `wt-deepscan-b-fixwave`. Subsystem:
confluence-scoring-decay (`market_structure_aligned`, the largest single weight at 0.20 of 1.00,
CLAUDE.md §2b 11-factor table).

---

## 1. What & why now (defect + receipts)

Two related, independently-confirmed defects in the same code path — the `market_structure_aligned`
factor's decay math (largest-weighted confluence factor, 0.20).

### 1a. HIGH — the age-unit mismatch

`bias-state-service.ts:645-657` invokes `compute_bias()` with `exec_bars=daily_df` unconditionally:

```python
state = compute_bias(
    htf=htf, session=session, current_price=current_price, vwap=current_price,
    event_active=False, event_minutes=999, deepar_forecast=None,
    bars=None,
    vp_levels=vp_levels_obj,
    exec_bars=daily_df,  # W25.2: daily bars serve as exec_bars for structure engine
    htf_bars=None,
)
```

`daily_df` (`bias-state-service.ts:582`) is `pl.read_parquet(f"{symbol}_daily.parquet")` — **one row
per CME trading day.** `compute_bias()` (`bias_engine.py:1236-1240`) forwards `exec_bars` verbatim
into `compute_structure_state(exec_bars=exec_bars, ...)` (`bias_engine.py:1229`), which forwards it
into `structure_engine.py`'s BOS/CHoCH/MSS/swing pipeline unmodified — no resampling, no unit
conversion anywhere in the chain.

`structure_engine.py::_find_last_break()` (lines 152-190) computes `last_break_age_bars = up_to_bar -
last_break_idx` — an integer count of **rows in `exec_bars`**, i.e. **trading days** given the input
above.

`confluence-decay.ts`'s `chochDecay()`/`mssDecay()` (lines 216-252) consume that same integer as
`ageBars` against half-life constants the file's own header comments (lines 82-88) state are
calibrated for **5-minute bars**:

```ts
/** CHoCH: 100-bar half-life (~8.3h on 5m bars). No touch concept. */
const CHOCH_AGE_HALF_LIFE_BARS = 100;
const CHOCH_AGE_MAX_PENALTY = 0.7;
/** MSS: 80-bar half-life (~6.7h). More aggressive — institutional pros invalidate MSS quickly. */
const MSS_AGE_HALF_LIFE_BARS = 80;
const MSS_AGE_MAX_PENALTY = 0.7;
```

**Real 5-minute intraday bars ARE fetched** at the 10:00 ET refresh
(`bias-state-service.ts:449-486`, gated `isRefresh`) — but they only populate `SessionContext`
scalars (`opening_range_high`/`opening_range_low`/`overnight_bias_str`/`or_broken_val`/
`ny_kz_active`). They are never assigned to `exec_bars`; the `compute_bias()` call at line 645 uses
`exec_bars=daily_df` identically on both the 9:30 session-start call and the 10:00 refresh call
(`isRefresh` only changes the inlined `refreshContext` Python fragment, not the `exec_bars` argument).

**Numeric consequence (formula: `agePenalty = min(MAX_PENALTY, ageBars / HALF_LIFE)`,
`confidence = 1 - agePenalty`):** a structural break 15 trading days old (~3 weeks) —
`agePenalty = min(0.7, 15/100) = 0.15` → **confidence = 0.85** (read as "nearly fresh"). The 0.3
confidence floor (`agePenalty` saturates at `MAX_PENALTY=0.7`) isn't reached until `ageBars ≥ 70`
trading days (~3.5 months) — instead of the intended ~70 *five-minute* bars (~5.8h) the header
comment describes.

### 1b. MED — `choch_age_bars`/`mss_age_bars`/`bos_age_bars` are permanently-dead fields

`confluence-decay.ts::deriveFactorDecay()`'s `market_structure_aligned` branch (lines 420-464) has a
4-way priority chain:

```ts
if (ss.choch_recent && ss.choch_age_bars != null && Number.isFinite(ss.choch_age_bars)) {
  ageBars = ss.choch_age_bars; breakType = "choch";
} else if (ss.mss_recent && ss.mss_age_bars != null && Number.isFinite(ss.mss_age_bars)) {
  ageBars = ss.mss_age_bars; breakType = "mss";
} else if (ss.bos_recent && ss.bos_age_bars != null && Number.isFinite(ss.bos_age_bars)) {
  ageBars = ss.bos_age_bars; breakType = "bos";
} else if (ss.last_break_age_bars != null && Number.isFinite(ss.last_break_age_bars)) {
  ageBars = ss.last_break_age_bars; breakType = "last_break";
}
```

`choch_age_bars`/`mss_age_bars`/`bos_age_bars` are declared on `DecayStructureState`
(`confluence-decay.ts:377-389`, marked "Pass 1: … Preferred over `last_break_age_bars`") but **the
real `StructureState` produced anywhere in production never has them:**

- `structure_engine.py`'s `StructureState` dataclass (lines 93-116) has exactly ONE age field —
  `last_break_age_bars: Optional[int]`. No per-type ages exist anywhere in the Python engine.
- The TS mirror in `bias-state-service.ts` (lines 56-74) and the second TS mirror in
  `confluence-score.ts` (lines 145-163) both faithfully mirror that — one `last_break_age_bars`
  field, nothing else.
- `confluence-score.ts:1175-1178` passes `signalContext.structureState` (the real, fully-typed
  object) straight into `deriveFactorDecay()` — there is no adapter or enrichment step that could
  inject the three phantom fields.

So in production this branch's first 3 conditions are **always false**; every live call falls
through to `breakType = "last_break"`, which (line 456) delegates to `chochDecay()` regardless of
whether the actual break was a CHoCH, an MSS, or a BOS — **`mssDecay()`'s dedicated 80-bar
half-life is unreachable code.** The header docstring's own design intent ("MSS decays faster —
institutional pros invalidate MSS quickly") is currently a dead letter.

**Evidence this is masked, not merely undiscovered:** `wave25-confluence-decay.test.ts:433-456` has
two tests that hand-construct a `structureState` object literal with `choch_age_bars: 100` /
`mss_age_bars: 80` directly in the test body — legal because `DecayStructureState` declares those
fields optional, but **no code path anywhere in the repo ever produces an object with those keys
populated.** The tests pass and exercise real branch logic, but on a shape production never emits —
green tests, false liveness signal.

**Doc-truth correction needed in the same wave (§11c: doc-drift is not exempt):** CLAUDE.md §2b's
decay footnote currently reads *"LIVE-FED = `market_structure_aligned` (age from
`structureState.last_break_age_bars` / choch/mss/bos_age_bars)"* — phrasing that implies the
per-type fields are part of the live-fed picture today. They are not; only `last_break_age_bars` is
real. Correct this line when the implementation lands (§3, in-scope for the implementer, not a
separate carry-forward).

---

## 2. Blast radius

### 2a. Zero backtest / certification exposure (either finding, either fix direction)

`backtester.py:430` — the **only** `compute_bias()` call site in the entire backtest path:

```python
bias_state = compute_bias(htf, session, current_price=entry_price, vwap=vwap_val)
```

No `exec_bars`, no `htf_bars` — both default to `None`. `bias_engine.py:1227` gates structure-state
computation on `if exec_bars is not None:`, so **`structure_state` is `None` in every backtest, every
walk-forward window, every CPCV path, every Monte Carlo run, ever.** (Separately confirmed:
`backtester.py` has zero references to `confluence-score.ts`/`evaluateWeightedConfluence` at all —
the Python backtest path has no call graph into the TS weighted-confluence module in the first
place.) So no backtest-path evaluation ever engages this decay math, by construction. Consequence:
**no frozen-policy hash, no certified band, no golden fixture (`test:metrics`), no WFE/PBO/B14/DSR
number was ever computed with this decay math engaged.** This is a **live/paper-only** defect —
confirms the autonomous (non-irreversible) classification in the STATUS line above.

### 2b. Why option (a) — threading real 5-minute bars into `exec_bars` — is NOT the smaller-blast-radius
   choice, investigated per the task's own decision rule

Three other production surfaces read `StructureState` fields and **structurally assume daily-bar
granularity today** — switching `exec_bars` to 5-minute bars would silently perturb all three,
un-reviewed, with no A/B evidence:

1. **`liquidity-map-service.ts::refreshSessionLevels()` tags `structureState.swing_high`/
   `swing_low` as `htf_significance=3` (daily)**, explicitly commented `"EQH/EQL detection (daily —
   htf_significance=3)"` (line 560) and inserted alongside `PDH`/`PDL` (also `htf_significance=3`,
   line 532) — i.e. the code's own author encoded "these swings are daily-timeframe swings" as a
   hardcoded assumption. `htf_significance` feeds directly into the sweep-probability formula
   (`base = 0.5 + 0.1 × htf_significance`, line 21) and the composite rank score
   (`htf_significance × 0.4 + sweep_probability × 0.4 + proximity × 0.2`, line 177) for the
   `liquidity_target_clear` factor (weight 0.13). Feeding 5-minute swing points into a slot tagged
   "daily significance" with a 1-tick EQH/EQL tolerance (`EQH_EQL_TICK_TOLERANCE_MES = 0.25`, line
   194) would misclassify intraday noise as daily-grade liquidity levels — a silent semantic
   corruption of a DIFFERENT confluence factor than the one this packet is fixing.
2. **`narrative-state-service.ts::computeNarrativeState()` uses `structureState.mss_recent` to drive
   the MANIPULATION → DISTRIBUTION transition** of the Asian/London/NY AMD narrative-phase state
   machine (line 19, 207-214) — a multi-hour/multi-session narrative concept. Feeding it MSS events
   detected on 5-minute swings instead of daily swings would make this transition fire on
   session-scale noise instead of tracking genuine institutional distribution.
3. **`confluence-score.ts::evalMarketStructureAligned()` (lines 469-519) derives the factor's
   `satisfied`/`unsatisfied` boolean directly from `choch_recent`/`mss_recent`/`bos_recent`** — the
   SAME booleans structure-engine computes from whatever `exec_bars` grain it's given. Daily bars
   make BOS/CHoCH/MSS rare, meaningful events; 5-minute bars make them frequent, noisy ones. This is
   the single LARGEST confluence weight (0.20) — its satisfied-rate shifting because of a bar-grain
   change, with zero paper-trading evidence of the new rate, is a materially bigger and less
   contained change than fixing the decay math alone.

By contrast, `spec_condition_compiler.py::_eval_wait_structure()` (lines 335-361) is a **separate,
independent call site** that already calls `compute_structure_state(window, window)` on the DSL
strategy's own real exec-timeframe bars during backtesting — proving the engine function itself is
bar-grain-agnostic and correctly designed for either use. It only reads the three `_recent` booleans
(never the age fields), so it is untouched by, and irrelevant to, either fix direction here.

**Conclusion:** per the task's own rule ("pick the smaller, more contained blast radius unless the
investigation shows (a) is safe") — investigation shows (a) is **not** safe. Three live production
consumers (§2b.1-3) encode a daily-bar assumption that (a) would silently break, none of it
reviewed or A/B'd. **Choosing (b): keep `exec_bars=daily_df` unchanged; make the decay math
day-scale-aware for this factor only.**

### 2c. (b) is a fresh calibration, not a restoration — say so explicitly

Because `exec_bars` stays daily, `last_break_age_bars` (and the per-type ages once wired, §3b) are
genuinely, permanently measured in **trading days**, not a proxy for 5-minute bars. Neither the
current behavior (~70-trading-day floor) nor the originally-intended 5-minute-bar calibration
(~70-bar floor, ~5.8h) is "correct" for a daily-chart structural break — the intraday half-life
constants were never designed for this signal at all. §3a's proposed day-scale constants are a
**fresh, reasoned judgment call**, explicitly flagged for post-ship validation (mirroring CLAUDE.md
§2b's own convention: "adjust [confluence] weights only after 30+ days audit_log instrumentation").
Do not present the specific numbers below as a precise, authoritative derivation — they are a
defensible starting point, not a backtested optimum (this factor is `None` in every backtest, §2a).

### 2d. Bundling both findings — sizing the risk difference

Per §11c (zero carry-forwards; doc-drift and dead-code are not exempt), both findings close in this
one packet. But they carry different risk:

- **§3a (day-scale decay fix)** is a pure recalibration of already-live code (`chochDecay`/
  `mssDecay` already run in production via the `last_break_age_bars` fallback) — same call graph,
  corrected constants and unit-tagging. Low structural risk.
- **§3b (per-type age wiring)** activates a previously-dead branch in production for the first time
  (`feedback_additive_fix_activates_dead_path`) and surfaces a real precedence bug the dead branch
  was masking (below). **Higher risk — the implementation/grading wave should sequence and grade
  §3b as its own unit within this packet**, not ride in on §3a's momentum.

**Precedence bug §3b will activate:** `deriveFactorDecay()`'s current priority chain is
**type-first** — it always checks `choch_age_bars` before `mss_age_bars` before `bos_age_bars`,
regardless of which is actually more recent. `structure_engine.py::_find_last_break()`
(lines 174-186) is **recency-first**, not type-first: the loop advances `last_break_idx` to the
largest bar index carrying ANY break, across all bars; `MSS > CHoCH > BOS` there is only the
**same-bar tiebreak** (when multiple types are detected on the identical bar — expected, since
`detect_mss_with_context()` is built directly on `choch_df`, `structure_engine.py:307`, so an MSS
bar is definitionally also a CHoCH bar). Across *different* bars, the engine always prefers
whichever break is more recent, irrespective of type — a plain CHoCH (no qualifying displacement)
occurring after an earlier MSS correctly wins in `_find_last_break()`.

A naive type-first reorder to `MSS > CHoCH > BOS` (fixing today's bug by simply flipping which type
wins) would **not** match the engine — it would report the OLDER break (whichever type ranks
higher) instead of the newer one. Concrete failure case: CHoCH 2 bars ago, MSS 5 bars ago — a
type-first `MSS > CHoCH` order incorrectly picks the 5-bar-old MSS (wrong age AND wrong decay
function) when the engine's own `_find_last_break()` would report the 2-bar-old CHoCH as the actual
last break. §3b's fix must be **recency-first**: among whichever of `choch_age_bars`/`mss_age_bars`/
`bos_age_bars` are non-null, select the smallest age (the most recent break) and dispatch to that
type's decay function; break ties (identical age = same bar, the only case the two types can
genuinely coincide) `MSS > CHoCH > BOS`, matching `_find_last_break()`'s own same-bar tiebreak
exactly. This is the only ordering that is actually equivalent to the engine's semantics, not just
directionally similar to them.

---

## 3. Exact change, scope-locked

### 3a. Day-scale-aware decay for `market_structure_aligned` (closes 1a)

**File:** `src/server/lib/confluence-decay.ts`

- Add `ageTradingDays?: number` to `DecayInput` (new field, alongside the existing `ageBars`/
  `ageHours` alternate-unit pattern already used by `genericDecay()` — same idiom, no new
  discriminator flag needed).
- Add two new named constants, explicitly marked as a judgment call in their comment:
  `CHOCH_AGE_HALF_LIFE_TRADING_DAYS = 10` (two trading weeks) and
  `MSS_AGE_HALF_LIFE_TRADING_DAYS = 6` (just over one trading week) — MSS kept more aggressive than
  CHoCH (matching the existing 80/100 ratio's intent), reusing the existing
  `CHOCH_AGE_MAX_PENALTY`/`MSS_AGE_MAX_PENALTY` (0.7) floor for both so the 0.3-confidence floor
  behavior stays consistent in shape, only the half-life shifts. Resulting floor: CHoCH confidence
  reaches 0.3 at 7 trading days (~1.5 weeks); MSS at ~4-5 trading days (~1 week). **Mark these two
  numbers in the code comment as PROPOSED / needs-post-ship-validation, not backtested** (§2c — this
  factor is `None` in every backtest, so there is no historical data to tune against; validate via
  `signal.confluence_factor_decayed` audit-row satisfied-rate over the first 30+ days live, same
  discipline CLAUDE.md already applies to the 11-factor weights).
- `chochDecay()`/`mssDecay()`: when `input.ageTradingDays` is defined and finite, use the new
  day-scale constant; else fall back to the existing `input.ageBars` / bar-scale constant path
  UNCHANGED (preserves the function's general-purpose bar-based contract for any future 5-minute-bar
  caller — nothing about the bar-scale behavior changes).
- `deriveFactorDecay()`'s `market_structure_aligned` case: pass `{ ageTradingDays: ageBars }` (not
  `{ ageBars }`) on every one of the 4 age sources (`choch_age_bars`/`mss_age_bars`/`bos_age_bars`/
  `last_break_age_bars`) — all 4 originate from the same daily-`exec_bars`-computed `StructureState`
  (§1a, §2a), so all 4 are trading-day-denominated today. Also replace the type-first priority chain
  with the recency-first selection from §2d (smallest non-null age among `choch_age_bars`/
  `mss_age_bars`/`bos_age_bars` wins; same-age ties broken `MSS > CHoCH > BOS`; fall back to
  `last_break_age_bars` only when none of the 3 per-type fields are populated).
- Correct the misleading `"~8.3h on 5m bars"` / `"~6.7h"` header comments on
  `CHOCH_AGE_HALF_LIFE_BARS`/`MSS_AGE_HALF_LIFE_BARS` to note they apply only to a genuine
  bar-granularity caller — today, no production caller of `chochDecay()`/`mssDecay()` uses the
  bar-scale path (verified: `deriveFactorDecay()` is chochDecay/mssDecay's only caller anywhere in
  `src/`).

**Out of scope for 3a:** `fvgDecay`/`obDecay`/`smtDecay`/`vpLevelDecay`/`genericDecay` — untouched,
no bar-unit issue exists for their inputs (VWAP-anchor age, SMT age, VP session age, and volume age
are all genuinely bar/hour/session-denominated at their real sources, unaffected by this fix).

### 3b. Wire real per-type break ages (closes 1b) — sequence/grade as its own unit per §2d

**Files:** `src/engine/context/structure_engine.py`, `src/server/services/bias-state-service.ts`,
`src/server/services/confluence-score.ts`, plus the audit-emit block at
`bias-state-service.ts:1117-1146`.

- `structure_engine.py`: extend the break-age computation so each type's own most-recent occurrence
  is tracked **independently** (not just the single cross-type winner `_find_last_break()` returns
  today) — a per-type backward scan over `bos_series`/`choch_df`/`mss_df` mirroring the existing
  `_find_last_break()` loop shape, one pass per type (or a single pass tracking 3 independent
  "last seen index" pointers). Add `choch_age_bars: Optional[int]`, `mss_age_bars: Optional[int]`,
  `bos_age_bars: Optional[int]` to the `StructureState` dataclass (each `None` if that type never
  occurred in the `exec_bars` window) — additive fields, `last_break_direction`/
  `last_break_age_bars` unchanged in meaning and computation.
- Mirror the 3 new optional fields onto both TS `StructureState` interfaces (`bias-state-service.ts`
  lines 56-74, `confluence-score.ts` lines 145-163) — the "3 places" rule both files' docstrings
  already assert. No DB migration: `bias_state.structure_state` is JSONB (migration 0134); additive
  keys need no DDL change (confirmed: no `jsonb-shapes.ts` entry constrains this column's shape).
- Extend the `bias_engine.structure_state_published` audit-row result payload
  (`bias-state-service.ts:1117-1146`) with the 3 new fields, for observability parity with the other
  published fields in that block.
- Apply the recency-first selection logic from §2d (not a type-first reorder) in the same commit as
  this wiring — the two changes are inseparable — populating the fields without fixing the
  precedence reintroduces the bug §2d describes, and a type-first fix would introduce a *different*
  bug (picking a stale break over a genuinely more recent one of a different type).
- Update CLAUDE.md §2b's decay footnote (the line quoted in §1b) to accurately state
  `choch_age_bars`/`mss_age_bars`/`bos_age_bars` are now genuinely live-fed, once true.

**Test disposition (§1b's masked-liveness evidence):**
- **Retain** `wave25-confluence-decay.test.ts:433-456`'s two hand-constructed-object tests, but
  re-scope their `it()` descriptions to state explicitly they test `deriveFactorDecay()`'s pure
  dispatch logic in isolation (a legitimate unit test of the TS function), NOT proof the shape is
  ever produced by the real engine.
- **Add** new integration-level tests that run the REAL `compute_structure_state()` (Python) on
  synthetic bar series, dump `dataclasses.asdict(state)` to fixtures, and feed those REAL fixtures
  through `deriveFactorDecay()` on the TS side — the two cases specified in §4 item 3 (MSS more
  recent than CHoCH, and the reverse), proving genuine recency-first selection end-to-end and
  closing the exact "hand-fabricated ≠ live" gap this finding identified.
- **Add** a Python-side test in `test_structure_engine.py` directly asserting the 3 new fields are
  populated correctly, including a case where CHoCH is older than MSS (both present) to prove
  independent tracking. (`test_structure_state_field_contract` at line ~488 uses `required - fields`
  subset-check, so it does not need modification for the new OPTIONAL fields to keep passing — but
  extend `required` to include them anyway for completeness, since they're now real contract fields.)

**Out of scope for 3b:** `spec_condition_compiler.py::_eval_wait_structure()` (§2b — untouched,
reads only booleans); any change to `_find_last_break()`'s own return contract or callers other than
the new per-type helper; any change to `bos_recent`/`choch_recent`/`mss_recent`/`*_direction` compute
logic (those are correct today and out of this packet's defect class).

---

## 4. Verification plan (to be run by the implementer/grader — not yet executed)

1. **RED-proof for 3a:** a test constructing `structureState.choch_age_bars = 15` (trading days,
   matching the finding's own worked example) through `deriveFactorDecay()` — before the fix,
   confidence ≈ 0.85 (bar-scale constant misapplied); after the fix, confidence reflects the new
   day-scale constant. Ship both numbers in the receipt.
2. **Backward-compat flip-enumeration for 3a:** `chochDecay({ ageBars: 100 })` /
   `mssDecay({ ageBars: 80 })` (no `ageTradingDays`) must be byte-identical to current output —
   proves the bar-scale path is untouched for any future genuine bar-granularity caller.
3. **Cross-language fixture test for 3b (the closing receipt for the dead-code finding):** at least
   TWO Python-dumped real `StructureState` fixtures run through the TS `deriveFactorDecay()`, proving
   genuine recency-first selection (not a fixed type preference): (a) a fixture where MSS is
   objectively the more recent break (smaller age than CHoCH) — must select `mssDecay()`; (b) a
   fixture where CHoCH is objectively more recent than an earlier MSS (the §2d counter-example: CHoCH
   2 bars ago, MSS 5 bars ago) — must select `chochDecay()`, NOT `mssDecay()`. Case (b) is the one
   that actually distinguishes "recency-first" from "type-first" — a type-first implementation would
   incorrectly pass case (a) alone. Both fixtures must also show `choch_age_bars ≠ mss_age_bars`
   (proving independent per-type tracking, not a shared pointer).
4. **`test_structure_state_field_contract` (`test_structure_engine.py:~488`)** extended to require
   the 3 new fields — must still pass (additive dataclass fields, `dataclasses.asdict()` output
   still JSON-serialisable per the adjacent `test_dataclasses_asdict_serialisable`).
5. **Zero fixture drift:** `npm run test:metrics` (golden backtest fixtures) must be byte-identical —
   §2a establishes `structure_state=None` in every backtest, so this change cannot move a single
   golden number. Confirm by running it and diffing, not by inspection alone.
6. **Full-project type-check:** `NODE_OPTIONS=--max-old-space-size=8192 node
   node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → expect exit 0.
7. **Targeted vitest:** `node node_modules/vitest/vitest.mjs run
   src/server/__tests__/wave25-confluence-decay.test.ts
   src/server/__tests__/wave25-confluence-decay-stage2-wiring.test.ts
   src/server/__tests__/liquidity-map-structure-state-wiring.test.ts
   src/server/__tests__/wave25-structure-stage2-wiring.test.ts` — all green, including the retained
   (re-scoped) hand-fabricated tests and the new fixture-based test.
8. **Python engine tests:** `python -m pytest src/engine/tests/test_structure_engine.py -v` — all
   green including the new per-type-age test.
9. **CI hard gates:** `check:production-isolation`, `check:2026-compliance`, `system-map:check` — no
   new subsystem/table/route, so `system-map:sync` is expected to be a no-op diff; confirm rather
   than assume.
10. **Independent grade (doer≠grader):** confirm the implemented selection is genuinely
    recency-first (item 3, case (b) specifically — the grader should independently construct a
    "CHoCH more recent than MSS" case, not just trust the implementer's own fixtures), confirm
    the day-scale constants in §3a are commented as a judgment call (not presented as derived), and
    confirm CLAUDE.md §2b's footnote correction (§3b) actually landed.

---

## 5. Rollback

Single-commit revert on the fix branch for either sub-change independently (3a and 3b touch
disjoint constant/field additions and can be reverted separately if the grader sequences them as
recommended in §2d). No schema/migration, no env flag (this factor has no existing feature-gate to
reuse and introducing one for a decay-constant fix would be scope creep — the previous behavior
was simply wrong, not a documented tradeoff worth toggling). No live-capital or certified-ref
dependency to restore (§2a) — reverting returns exactly to the pre-fix state with zero side effects
on any other subsystem.

---

## 6. Verification receipt (post-implementation — actual output, this worktree)

Confirmed in-code before writing this receipt (not asserted from the plan): `exec_bars=daily_df`
at `bias-state-service.ts:667` is UNCHANGED (option (b) — daily bars stay daily; §2b's blast-radius
finding held). `confluence-decay.ts` has `ageTradingDays`, `CHOCH_AGE_HALF_LIFE_TRADING_DAYS=10`,
`MSS_AGE_HALF_LIFE_TRADING_DAYS=6`, and a recency-first `candidates`/`tiebreakRank` selection in
`deriveFactorDecay()` exactly as designed in §3a. `structure_engine.py` has `choch_age_bars` /
`mss_age_bars` / `bos_age_bars` on `StructureState`, populated via `_find_per_type_ages()`, exactly
as designed in §3b. CLAUDE.md §2b's decay footnote was corrected in the same wave (verified via
`git diff` against the pinned base — the footnote now reads "now genuinely live-fed and
independently tracked per-type, RECENCY-FIRST selection ... matching `_find_last_break()`'s own
same-bar tiebreak").

Commands run in this worktree (`wt-deepscan-b-fixwave`, base `56f0fd04`) and their real output:

1. **Vitest — confluence-decay + structure-state wiring suites:**
   ```
   node node_modules/vitest/vitest.mjs run \
     src/server/__tests__/wave25-confluence-decay.test.ts \
     src/server/__tests__/wave25-confluence-decay-stage2-wiring.test.ts \
     src/server/__tests__/wave25-confluence-decay-recency-first.test.ts \
     src/server/__tests__/liquidity-map-structure-state-wiring.test.ts \
     src/server/__tests__/wave25-structure-stage2-wiring.test.ts
   ```
   Result: **5 files, 147 tests, all PASSED** (87 + 35 + 3 + 4 + 18). The new
   `wave25-confluence-decay-recency-first.test.ts` is the §4 item-3 cross-language closing receipt
   for the dead-code finding (1b) — a genuine "CHoCH more recent than an earlier MSS" case selecting
   `chochDecay()`, not a type-first `mssDecay()` pick.

2. **Python — structure engine per-type age tracking:**
   ```
   python -m pytest src/engine/tests/test_structure_engine.py -v
   ```
   Result: **34 passed**, including the new `TestPerTypeBreakAges` class (5 tests):
   `test_full_pipeline_populates_per_type_ages_on_real_displacement`,
   `test_no_break_of_a_type_yields_none_age_for_that_type`,
   `test_find_per_type_ages_independent_tracking_choch_older_than_mss`,
   `test_find_per_type_ages_independent_tracking_mss_older_than_choch`,
   `test_find_per_type_ages_all_none_when_nothing_detected` — the independent-tracking pair is the
   §4 item-4 non-shared-pointer proof.

3. **Golden-fixture / zero-drift proof (§4 item 5):**
   ```
   python -m pytest src/engine/tests/test_metric_snapshot.py src/engine/tests/test_golden_fixtures.py \
     src/engine/tests/test_frankenstein.py src/engine/tests/test_cross_engine_parity.py -q
   ```
   Result: **150 passed**, 0 failed — confirms §2a's claim empirically (byte-identical backtest
   output; `structure_state=None` in every backtest path means this change cannot and did not move a
   single golden number).

4. **Full-project type-check (§4 item 6):**
   ```
   NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
   ```
   Result: **exit 0, zero errors.**

5. **CI hard gates (§4 item 9):**
   `npm run check:2026-compliance` → `OK — MFFU + Topstep aligned with canonical 2026 docs`.
   `npm run check:production-isolation` → `CLEAN — 5 file(s) checked, 0 violations.`
   `npm run system-map:check` → **exits 1 (drift detected)**, but the reported drift is unrelated to
   this packet: stale n8n workflow `lastSuccessAt` staleness-ceiling warnings (192h+ old executions
   on unrelated cron workflows) and a pre-existing "SSE events in inventory but never emitted" doc-gap
   (`compliance:collaborative_trading_warning`, `strategy:analysis-error`, `strategy:analyzed`) — none
   of the drift items reference `structure_engine.py`, `confluence-decay.ts`, `bias-state-service.ts`,
   or `confluence-score.ts`. This worktree hosts several other concurrent ratify-packets
   (`docs/ratify-packets/{backtest-compliance-sizing-gaps,fill-time-gate-reverify-gaps,
   gate-contract-restoration,pine-faithful-flag-confluence-detection,
   stop-geometry-mini-ceiling-parity}-2026-07-17.md`) touching unrelated subsystems in the same
   working tree; the drift is not attributable to this packet's diff and is flagged here rather than
   silently claimed clean (§11c does not require this packet to fix drift outside its own scope, but
   does require not mis-reporting a gate as green when it isn't) — **NOT re-run/fixed as part of this
   packet; a subsequent independent-grade or landing pass should re-check `system-map:check` after
   all concurrent packets in this worktree are accounted for, since a single shared-tree diff makes
   per-packet attribution imprecise.**

**Independent grade (§4 item 10) — NOT yet run by a fresh-context grader.** This receipt was
produced by the same agent that is authoring/verifying this packet in a single pass; per the
`ratify-packet` skill's own rule ("doer != grader, always"), this is **implementer-side verification
only**, not the independent grade the skill requires before this packet can be considered fully
closed. A fresh-context grader should independently: (a) construct its own "CHoCH more recent than
MSS" case distinct from the implementer's fixtures (§4 item 3's own instruction), (b) confirm the
§3a day-scale constants are commented as a judgment call and not presented as a backtested
derivation, and (c) confirm the CLAUDE.md footnote correction is accurate to the shipped code (spot
checks above suggest yes, but a fresh read should re-derive rather than trust this summary).

---

## Plain-English summary for the operator (standing veto; NOT a code decision)

One of your confluence-scoring factors — "does market structure agree with the trade" (the single
biggest-weighted factor in the 11-factor scoring system) — has a units bug. It measures how long ago
a structural break happened, then fades its confidence the older that break gets. The fade math was
built assuming "how long ago" is counted in 5-minute chunks, but the number it's actually fed counts
in whole TRADING DAYS instead. Net effect: a 3-week-old structural signal is currently treated as
"basically brand new" (85% confidence) when it should be treated as much staler. This never touched
any backtest or certified result — it's a live/paper-trading-only issue, confirmed by checking that
backtests never even turn this decay math on. The fix recalibrates the fade math for the actual time
unit it's really working with (trading days) and also finishes wiring a piece that was declared but
never actually connected (a separate "how stale is THIS SPECIFIC type of break" tracker that's been
sitting unused since May). Nothing here is live-capital-affecting. Status: the fix is built and this
worktree's own tests pass (147 relevant checks + the 150-test golden-fixture suite that proves it
touched zero backtest numbers), but it still needs a second, independent pass to check the work
before it's trusted — same as every instrument change, no exception for this one. Not a go/no-go
decision for you; you'll get a summary once that second check clears.
