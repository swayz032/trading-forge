# E8Wg6tFPYjo — read-only compiler-readiness preflight (AR-1381A Lane A)

Ruling: AR-1381A (`e2b66ca9d176d29f3e8294739afda31fec40ad0f`), section 5. Read-only — no compile,
certify, backtest, compiler-code edit, or default substitution performed in this lane.

Candidate under review: `reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/fresh_source_candidate.json`
(SHA `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`, currently REJECTED by
AR-1380A/AR-1389/AR-1381A — this matrix does not change that disposition; it maps what would still
need resolving for *any* successor candidate on this source).

## Method and one load-bearing judgment call, surfaced up front

`grep`/search of `src/` found no compiler, certifier, or bridge that consumes this candidate schema
(`entry_sequence`/`setup`/`targets`/`priority`/`role`) — confirms AR-1380A's "NO CERTIFIER / COMPILER
/ BACKTEST AUTHORITY EXISTS YET" for this exact schema. The only compiler-adjacent code found
(`spec_condition_compiler.py`, `pine_compiler.py`, `spec_family_bindings.py`) operates on a
DIFFERENT, already-DSL-compiled spec shape (the sVkm/H1 corpus), not on this raw Opus-reader
candidate shape — no bridge between the two exists.

In the absence of a schema-specific contract, this matrix leans on the one standing project
invariant that already governs every compiler in this repo (`advisor-ruling` skill section 6.4,
CLAUDE.md section 4): **source-owned entry logic is compiled faithfully; stops, targets, and sizing
are framework-owned and get REPLACED by canonical risk management (ATR stop geometry, Style C
33/33/34 exits, risk-derived sizing), never compiled from the source's literal numbers.** This is
architectural precedent, not proof that the not-yet-built Factory compiler will follow it — flagged
explicitly per item below as `(precedent, not proven for this pipeline)` wherever it drives a
classification. GPT/operator should confirm or override this framing before it becomes load-bearing.

## Matrix

| item | exact source gap / field | downstream consumer | hard compile blocker? | source text already sufficient? | visual evidence could resolve? | safe unresolved representation exists? | expected disposition |
|---|---|---|---|---|---|---|---|
| 1 | `stop.anchor (buy-side)` — "that wick" not tied to a Fibonacci/structural level | Framework ATR stop geometry (precedent, not proven for this pipeline) | No, if precedent holds — literal stop price is replaced downstream regardless | No | Yes (VI-E8-2, already authorized) | Yes — `source_gaps` disclosure is the safe representation either way | `SAFE_TO_REMAIN_UNRESOLVED` (precedent) / `UNKNOWN_DOWNSTREAM_CONTRACT` if precedent does not hold for this pipeline |
| 2 | `fibonacci_range.anchor_points (sell-side)` — draw direction never narrated | Entry trigger price (source-owned — this sets WHERE the 71% entry sits) | **Yes** — this is the HIGH A defect; without it the sell-side entry price cannot be deterministically derived | No | Yes (VI-E8-1, already authorized) | No — this is the one gap that blocks a deterministic entry price for the sell-side branch | `COMPILE_BLOCKER_SOURCE_MISSING`, VI-E8-1 already targets it |
| 3 | `higher_timeframe.trading_range_definition` — which high/low bound the 4h range whose 50% divides premium/discount | Entry trigger gate (source-owned — HTF alignment is checklist item 1) | Yes — without a defined range, premium/discount is not computable | No | Unclear — likely requires a specific worked-example frame; not yet requested | Partial — a "source_unresolved" HTF-gate representation is safe but leaves the checklist's first gate non-deterministic | `COMPILE_BLOCKER_SOURCE_MISSING`, candidate for a Lane B question if Lane A confirms priority |
| 4 | `break_of_structure.definition` — identified only via the educator's custom indicator label, no measurable rule stated | Entry trigger gate (source-owned — checklist item 3) | Yes, in principle — but the transcript explicitly defers to "Trading View fractals or Williams fractals" as a free, named, standard equivalent | Partially — the educator names a public substitute mechanism | No — this is a definitional/mechanism question, not a visual framing question | Yes — compiling against the named standard indicator (fractals/Williams) is source-grounded, not invented | `COMPILE_BLOCKER_REPRESENTATION_DEFECT` (fixable without new evidence — bind to the named standard mechanism) rather than `SOURCE_MISSING` |
| 5 | `imbalance.qualification` — no minimum size/threshold/timeframe for the FVG | Entry trigger gate (source-owned — checklist item 3) | Yes, in principle — but the transcript gives a complete structural definition ("three candlestick pattern... gap between the low of the first candle and the high of the third") | **Yes** — the definition is fully stated in-transcript, just not previously bound as its own atomic claim | No — not a visual question | Yes — this is directly compilable from the existing quote | `COMPILE_BLOCKER_REPRESENTATION_DEFECT`, not `SOURCE_MISSING` — a future candidate should bind this quote as its own claim, no new evidence needed |
| 6 | `liquidity_sweep.recency_and_proximity` — no rule for how recent/close the sweep must be to the BOS/entry | Entry trigger gate (source-owned) | Yes, if a compiler requires a numeric threshold; No, if "most recent major high/low" (as narrated) is accepted as the qualifying rule | Partially — "most recent major high/low" is stated, a numeric window is not | No | Yes — "most recent unswept major high/low" is a legitimate, source-grounded qualitative rule; a numeric window would be invented | `SAFE_TO_REMAIN_UNRESOLVED` if the compiler can accept a qualitative "most recent" rule; `UNKNOWN_DOWNSTREAM_CONTRACT` otherwise |
| 7 | `structure_timeframe_of_bos_and_imbalance` — not stated explicitly, both worked examples visually on 15m | Entry trigger gate (source-owned) | Low — both examples are on the stated execution timeframe (15m); a source-grounded default (execution timeframe = structure timeframe) is directly supported | Yes, at "both examples" strength (already the exact fact PARTIAL-flagged `instrument_classification`/`setup[0]` under-bind) | No | Yes — bind execution_timeframe as the structure timeframe, cite both worked-example frames explicitly rather than leaving as a bare gap | `COMPILE_BLOCKER_REPRESENTATION_DEFECT`, closeable without new evidence |
| 8 | `fibonacci.75_percent_level_role` — level enabled, referenced descriptively, no executable role | Entry trigger / drawdown-tolerance display (source-owned, but decorative per source's own framing) | No — transcript explicitly frames it as visualization only ("just for visualization purposes"), not an executable rule | Yes | No | Yes — `NON_EXECUTABLE` is the source-faithful disposition, not a gap | `NON_EXECUTABLE_NOT_REQUIRED` |
| 9 | `max_tolerated_drawdown_before_invalidation` — no threshold before abandoning the trade | Framework risk management (precedent, not proven for this pipeline) | No, if precedent holds — DLL/kill-switch machinery (CLAUDE.md section 4) already governs this at the account level, independent of any one strategy's source text | No | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` (precedent) / `UNKNOWN_DOWNSTREAM_CONTRACT` if this pipeline compiles per-strategy invalidation independently of the account-level DLL machinery |
| 10 | `action_on_level_violation` — what to do if a level breaks before the pending order fills | Entry trigger validity (source-owned — governs whether the pending order should still be live) | Yes, in principle — but the transcript's `management[]` rows already answer it exactly: the trade stays valid "until one of those levels are violated," implying cancel/invalidate on violation | **Yes** — already captured in `management[0]`/`management[1]`, just not cross-referenced as the answer to this named gap | No | Yes — this source_gap may be over-stated; the candidate's own `management[]` rows appear to resolve it | `COMPILE_BLOCKER_REPRESENTATION_DEFECT` or arguably not a gap at all — re-derive from existing `management[]` rows before treating as missing |
| 11 | `position_sizing_and_risk_per_trade` — none specified | Framework risk-derived sizing (CLAUDE.md section 4/5 — explicitly NOT source-taught, project-wide) | **No** — CLAUDE.md section 4 states sizing is risk-derived, never source-specified; this is not a gap, it is the correct architecture | N/A | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` — high confidence, this is a hard project invariant, not precedent-by-analogy |
| 12 | `session_time_and_news_filters` — none specified | Framework macro/lunch/PM-taper hard gates (CLAUDE.md section 12, already exist project-wide) | **No** — these gates already exist independent of any one strategy's source text | N/A | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` — high confidence |
| 13 | `trade_frequency_and_concurrency` — none specified | Framework daily trade cap (CLAUDE.md section 4, 2 trades/day/account default, already exists project-wide) | **No** | N/A | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` — high confidence |
| 14 | `targets.sequencing_and_partials` — one TP per worked example, no multi-target/partial rule stated | Framework Style C 33/33/34 exits (precedent, not proven for this pipeline) | No, if precedent holds — the framework overlay replaces the source's single-target exit with its own partials/runner logic regardless of what the source teaches | N/A | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` (precedent) / `UNKNOWN_DOWNSTREAM_CONTRACT` if this pipeline compiles source-literal targets |
| 15 | `pending_order_expiry` — no expiry stated for the pending limit order | Framework order-management (precedent — likely a session-boundary or time-stop default, not source-specific) | No, if precedent holds | No | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` (precedent) / `UNKNOWN_DOWNSTREAM_CONTRACT` otherwise |
| 16 | `top_level_source_gaps.instrument_scope` — validated only on 2 forex pairs despite broader applicability claim | Instrument mapping (CLAUDE.md section 4 — MES/MNQ/MCL evaluated independently per instrument) | No — the compiler only ever needs the entry-trigger LOGIC to be instrument-agnostic; per-instrument tick/point mapping happens at a separate, already-governed layer | Yes, at the strength stated (broad applicability claimed, not validated) | No | Yes | `NON_EXECUTABLE_NOT_REQUIRED` |
| 17 | HIGH A — `entry_sequence` cross-splices buy-side Fib draw into sell-side entry (representation defect, not a missing source fact) | Entry trigger price (source-owned) | **Yes** — this corrupts the deterministic entry price for one direction | N/A — this is a representation defect over EXISTING source facts, not a missing fact | N/A (see item 2 — VI-E8-1 addresses the underlying missing fact; this item is the mis-assembly of what IS known) | No | `COMPILE_BLOCKER_REPRESENTATION_DEFECT` — fix by direction-splitting the geometry, per AR-1381A section 7 |
| 18 | HIGH B — `targets[].priority` invents a directional rank (representation defect) | Framework Style C exits (precedent, not proven) | Likely **No** for compilation itself if precedent holds (targets get replaced downstream regardless), but **Yes** for candidate fidelity/audit correctness independent of what the eventual compiler does with the value | N/A | N/A | Yes — drop the ranking, represent as co-equal direction-scoped alternatives | `COMPILE_BLOCKER_REPRESENTATION_DEFECT` for audit-fidelity purposes even if downstream-inert for compilation |

## Summary

- **Genuine, unresolved compile blockers with no source-text fix available today:** item 2 (sell-side
  Fibonacci anchor direction — VI-E8-1 already targets this) and item 3 (4h trading-range
  construction — not yet targeted by a Lane B question; recommend adding if Lane A priority is
  confirmed).
- **Representation defects fixable from EXISTING source text, no new evidence needed:** items 4, 5,
  7, 10, 17. A round-4 candidate can close these by re-reading the transcript more carefully, not by
  waiting on Visual Intelligence.
- **Non-blocking by architecture, IF the framework-owned-risk precedent holds for this pipeline:**
  items 1, 9, 11, 12, 13, 14, 15, 16. Items 11-13 are high-confidence (hard, general project
  invariants, not pipeline-specific analogy). Items 1, 9, 14, 15 are precedent-based and worth one
  explicit GPT confirmation before treating as settled, since this Factory pipeline's exact compiler
  contract does not exist yet and could in principle diverge from the older scout-pipeline pattern.
- **HIGH B's downstream compile relevance is genuinely uncertain** (item 18) — it clearly matters for
  candidate/audit fidelity regardless, but whether it matters for compilation depends on whether
  targets are framework-replaced here too.

## What this preflight recommends for Lane B (unchanged from AR-1381A — not expanding it)

VI-E8-1 and VI-E8-2 remain the two highest-value visual questions; nothing in this matrix surfaces a
third visual question with matching confidence. If GPT confirms item 3 (HTF trading-range
construction) is compile-critical and cannot be resolved from source text or reasonable default, that
would be the next candidate visual question — flagged here, not added unilaterally, per the ruling's
"add another visual question only when Lane A proves it is a hard compiler blocker" instruction.
