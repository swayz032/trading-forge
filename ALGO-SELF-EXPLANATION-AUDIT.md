# Self-Explanation Audit — every status word the MNQ v2.4 family can show the operator

> **Standing state corrected on commit (2026-08-26).** Drafted at ladder head ALGO-100C
> `602318c5`; committed at ladder head **ALGO-100E `a553b59f`** (ALGO-100D landed the
> operator's volunteered target teaching and RE-OPENED the target layer; ALGO-100E published
> this handover to the channel). Strategy branch head at commit: **`abce4155`**
> (`6888112d` is the revert commit, no longer the head). The T3 batch referenced below
> closed **HONEST-PARTIAL** on its own pre-registration - it refused the operator's own
> 03-24 entry - and **nothing from it is landed**.


**ALGO-026 §1(b) deliverable, refreshed at the revert head `6888112d` (2026-08-26).**
This audit TRANSLATES; it changes no code, no threshold, no gate. Where a literal already has a
committed translation, this file says where it lives instead of duplicating it.

## How this census was produced (reproducible)

Every UPPER_SNAKE string literal of 6+ characters in the v2.4 decision modules, swept at the
pinned commit — run from the repo root:

```
git grep -ohE "['\"][A-Z][A-Z0-9_]{6,}['\"]" 6888112d -- "research/current_mnq_strategy_v2_4_*.py" | sort -u
```

The table below covers the sweep of the 23 decision/runtime/diagnostic modules (kernel,
entry_authority, derivation, force, independent_force, signal, entries, session_budget, engine,
execution, shadow, shadow_runtime, automation_runtime, broker, candidate_xray, gate, exam_window,
levels, zone_lifecycle, targets, target_policy, premarket, policy) **plus** the breakout-family
literals observed in the verified refusal-trace output. A wider sweep (every `v2_4_*.py`) is the
one-line command above with the narrower pathspec removed — left to the worker: **NEEDS-WORKER
(wider sweep)**.

**Statuses used:**
- **OK** — translated below, one line, trader register.
- **TRANSLATED-IN-CODE** — already translated in `research/current_mnq_strategy_v2_4_refusal_legibility.py`
  (`PLAIN_ENGLISH`, 28 codes, with a what-to-do column; a test goes red if a new runtime refusal
  has no entry). Print the live table:
  `PYTHONPATH=. python -c "from research.current_mnq_strategy_v2_4_refusal_legibility import PLAIN_ENGLISH as P; [print(k, '=>', P[k][0], '| DO:', P[k][1]) for k in sorted(P)]"`
  (verified 2026-08-25, prints all 28).
- **INTERNAL** — a bookkeeping name that never reaches the operator as a message. Translated
  anyway so nothing in the census is unexplained.
- **NEEDS-WORKER** — I could not translate it with confidence; do not guess.

The one distinction the operator must hold: **a refusal is the system working.** The bot's
default is WAIT; every line below that reads like a "no" is the machine explaining why it kept
waiting, not an error.

---

## 1. The entry chain — why it waited (entry_authority)

The state machine grants an entry only when every link holds: authorized key zone → real
interaction → candle story → causal force. Each WAIT names the first missing link.

| literal | plain English |
|---|---|
| `WAIT_NO_LOCATION` | No key zone anywhere near price — nothing to trade against. |
| `WAIT_NO_AUTHORIZED_LOCATION` | There is a level, but not one that existed before the session started, so it does not count. |
| `WAIT_NO_INTERACTION` | Price has not actually gone to the zone yet. |
| `WAIT_NO_STORY` | Price touched the zone but the candles have not told a recognisable story yet. |
| `WAIT_STORY_INCOMPLETE` | A story started (e.g. a rejection is forming) but has not completed. |
| `WAIT_NO_FORCE` | The story completed but there is no directional push behind it yet. |
| `WAIT_FORCE_NOT_PROVEN` | There is a push, but the 1-minute candles have not proven it is sustained. |
| `WAIT_PRICE_HAS_NOT_EARNED_THE_LEVEL` | The umbrella line: some link in the chain is missing; price has not earned permission at the level. |
| `GRANTED` | Every link held — the entry has permission. |
| `ROUTE_A_REJECTION` / `A_NORMAL_REJECTION` | Entry family A: price rejected off a key zone. |
| `ROUTE_B_BREAKOUT` / `B_NORMAL_BREAKOUT` | Entry family B: price broke through a key zone with proof. |
| `ROUTE_C_PREBREAK_DISPLACEMENT` / `C_PREBREAK_DISPLACEMENT` | Entry family C: a strong displacement move before the break. |
| `ROUTE_D_PREBREAK_RETEST` / `D_PREBREAK_RETEST_BREAKOUT` | Entry family D: a retest before/around the break. |
| `NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED` | Route D was asked both of its two taught forms; neither qualified. |
| `NEITHER_D_FORM` | Short form of the same: neither Route-D form fit. |
| `VARIANT_BRK15` | The 15-minute variant of the breakout family (not a separate route). |
| `NOT_DERIVED_HERE` | INTERNAL — this module was handed the value, it did not compute it. |
| `STATE_ORDER` / `VARIANTS` | INTERNAL — ordering/grouping constants of the state machine. |

## 2. The candle story — what it saw at the zone (derivation)

His doctrine, as ruled: zones are BANDS; a rejection is a wick that does NOT break the level
(ALGO-071/073). Positive story forms first, then the refusals.

| literal | plain English |
|---|---|
| `TOUCH_AND_REJECT` | Price touched the zone and got pushed straight back out — a real rejection. |
| `SWEEP_AND_RECLAIM` | Price swept through the level (grabbed the stops) and came back — a taught form. |
| `PENETRATE_AND_RECLAIM` | Price got inside the band and was reclaimed — a taught form. |
| `FAILED_BREAKOUT_BACK_INSIDE` | A breakout attempt failed and price fell back inside — a taught form. |
| `PRIOR_MOMENTUM_AFTER_REJECTION` | Momentum arriving right after a rejection — a taught form. |
| `APPROACH_STORY` | INTERNAL — the record of how price approached the zone (not a verdict). |
| `MERE_APPROACH_WITHOUT_TOUCH` | Price came near the zone but never actually touched it, so no story can start. |
| `NO_TOUCH` | Same family: no touch of the band. |
| `TOUCHED_BUT_NO_RECOGNISED_INTERACTION` / `NO_RECOGNISED_INTERACTION` | It touched, but what happened next matches none of the taught shapes. |
| `TOUCH_WITHOUT_DIRECTIONAL_CONTROL` | It touched, but neither buyers nor sellers took charge afterward. |
| `INDECISION_AT_ZONE_WITHOUT_DIRECTIONAL_TAKEOVER` | Candles at the zone are two-sided/indecisive; nobody took over. |
| `SWEEP_RECLAIM_WITHOUT_HOLD_OR_DIRECTIONAL_DEFENSE` | It swept and came back, but the reclaim was never held or defended — not valid. |
| `COUNTER_BIAS_REVERSAL_WITHOUT_COMPLETED_CONTROL_TRANSFER` | A reversal against the session bias was attempted before the other side had finished taking control. |
| `MIXED_OVERLAP_AND_TWO_SIDED_WICKS` | Overlapping candles with wicks both ways — a tug of war, no clean story. |
| `TWO_SIDED_CONFLICT` | The candle fought both directions and settled nothing (e.g. closed inside the band). |
| `NO_CONTROL` / `NO_CONTROL_TRANSFER` / `NO_TAKEOVER` | The side that must win at this level never took control. |
| `NO_DEFENSE` | The level was not defended when it was tested again. |
| `INSUFFICIENT_PRIOR_BARS` / `NOT_ENOUGH_BARS` | Not enough completed candles yet to judge the shape — wait. |
| `INTERACTIONS` / `DIAGNOSTIC_ONLY` | INTERNAL — module bookkeeping, not messages. |

## 3. Causal force — was the push real (force / independent_force)

Force is proven on the 1-minute candles inside the forming 5-minute candle: a sustained push,
not one hopeful print.

| literal | plain English |
|---|---|
| `SUSTAINED_DIRECTIONAL_FORCE` | The proof PASSED: a sustained one-direction push on the 1-minute candles. |
| `TUG_OF_WAR_PATH_TOO_INEFFICIENT` | On the way there, price fought back and forth too much — that is a tug of war, not a drive. |
| `LATEST_CLOSE_HAS_NOT_REGAINED_DIRECTIONAL_EXTREME` | The newest 1-minute close has not pushed back past the move's high/low — the push is not proven yet. |
| `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` | The momentum candle's shape did not prove the push. (ALGO-100A F-1: after the F1 revert this token can label a clause that cannot refuse — the S3 re-land must fix the reason chain. Translation stands; wiring is the worker's.) |
| `INSUFFICIENT_1M_OBSERVATIONS` / `NO_COMPLETED_1M` | Not enough completed 1-minute candles yet to judge force — wait. |
| `PARENT_CANDLE_ALREADY_CLOSED` | The 5-minute candle finished before force could be proven inside it — that chance is gone. |
| `V24_FORCE_TIMESTAMPS_MUST_BE_TZ_AWARE` | Internal programming safeguard (timezones). If ever seen live: report it, it is an engineer's error, not a market message. |
| `COMPARED_KEYS` / `MIN_COMPLETED_1M` | INTERNAL — bookkeeping constants. |

## 4. The break family (gate)

| literal | plain English |
|---|---|
| `NO_ZONE_NO_TRADE` | No key zone — no trade. The first law of the method. |
| `ZONE_REACHED_REVERSAL_NOT_CONFIRMED` | Price reached the zone but the turn was never confirmed. |
| `WEAK_BREAKOUT_ATTEMPT_DID_NOT_BREAK_ZONE` | It tried to break the level and did not actually get through. |
| `WEAK_BREAK_CONFIRMED_BY_15M_THREE_BAR_CONTINUATION` | A weak first break was later confirmed by three 15-minute bars continuing through. |
| `WAIT_FOR_COMPLETED_15M_THREE_BAR_CONTINUATION` | Waiting for that three-bar confirmation to complete. |
| `WAIT_FOR_POST_BREAK_MOMENTUM` | The break printed; waiting for momentum behind it before trusting it. |
| `BRK15_REQUIRES_WEAK_FIRST_BREAK` | The 15-minute break variant only applies after a WEAK first break — a strong one is a different setup. |
| `FIRST_BREAK_PRINT_THEN_MOMENTUM_CONFIRMATION` | The taught order: first the break prints, then momentum must confirm it. |

## 5. Why an entry was ALLOWED — the grant-path names (kernel / target_policy)

These appear next to an approved entry; they name which taught path granted it.

| literal | plain English |
|---|---|
| `ZONE_REJECTION_STORY_THEN_INTRA5_FORCE` | Allowed because: rejection story at a key zone, then proven force inside the 5-minute candle. |
| `FIRST_BREAK_PRINT_THEN_INTRA5_FORCE` | Allowed because: first break printed, then proven force. |
| `PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE` | Allowed because: displacement before the break, third candle, proven force. |
| `PREBREAK_REPEAT_TEST` / `PREBREAK_REPEAT_TEST_INTRA5_FORCE` | Allowed because: the level was tested repeatedly before the break, then force. |
| `ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE` | Allowed because: a completed break was retested and accepted, then force. |
| `WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE` | Allowed because: weak break, pullback, third 15-minute bar with force. |

## 6. Exam & measuring-tool verdicts (candidate_xray and the run_* printouts)

The operator sees these when GPT asks him to run the measuring tools. They describe candidates
in a REPLAY, never live orders.

| literal | plain English |
|---|---|
| `SURVIVED_TO_RANKING` | This candidate passed every gate and reached the final pick. |
| `REJECTED` | This candidate was refused at some gate (the line names which). |
| `FORCE_NOT_CONFIRMED` | Refused at the force gate. It is a family label — the trace prints the exact sub-reason next to it (see §3). |
| `INTRA_15M_FORCE_NOT_CONFIRMED` | Same, for the 15-minute variant. |
| `REJECTION_STORY_INCOMPLETE` | The rejection story never completed for this candidate. |
| `LOST_RANKING_TO_ANOTHER_CANDIDATE` | It was valid, but another candidate was picked instead (the one-bullet rule allows only one). |
| `NO_AUTHORIZED_LOCATION_ON_THIS_SIDE` | No valid key zone on that side of price. |
| `NO_LEGAL_ROUTE_MATCHED` | Nothing about this candidate fits any of the four taught entry families. |
| `NO_BUCKET_STARTS` | No 5-minute candle starts inside the window to evaluate. |
| `INSUFFICIENT_WARMUP` | Not enough data before the session to build the zones. |
| `DECISION_CLOCK_PAST_LAST_ENTRY` | His recorded decision time is after the last legal entry time — cannot be scored. |
| `BOTH_DIRECTIONS_PERMITTED_KERNEL_YIELDS_NOTHING` | Both directions were allowed and the engine still found no candidate. |
| `STRUCTURAL_PRIOR_VETO` | The premarket bias map vetoed this side before any candle was read. |
| `WEAK_BREAK_PENDING_WINDOW_EXPIRED` | The weak break was waiting for confirmation and the waiting window ran out. |
| `BRK15_WEAK_BREAK_CONTINUATION` | The BRK15 continuation form (a candidate label, not an error). |
| `NEUTRAL` | The premarket read leans neither way. |
| `STRUCTURE_ONLY_NO_NAMED_REFERENCE` | The premarket plan has structure but names no specific level. |
| `B_C_D_BREAKOUT_FAMILY` | INTERNAL — grouping label for routes B/C/D in reports. |
| `NO_COMPLETED_PRINT_BEYOND_THE_ZONE` | (breakout derivation, seen in the trace) No candle has actually CLOSED beyond the zone — the break never really printed. |
| `DISPLACEMENT_THIRD_CANDLE_REVERSED_CONTROL` | (trace) The third candle after the displacement reversed control — the move died. |
| `ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT` | (trace) The move was ordinary momentum, not the taught displacement. |
| `REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST` | (trace) A "repeat test" needs a real first test; there was none. |
| `MOMENTUM_WRONG_DIRECTION` | (trace, ALGO-097) The momentum is pointing the wrong way for this candidate. |
| `TAUGHT` / `UNTAUGHT MAGNITUDE` / `TAUGHT_SHAPE_UNTAUGHT_GATE` / `UNMAPPED` | Trace provenance labels: the refusal rests on his teaching / on a number somebody chose / on a taught shape guarded by an untaught number / not yet mapped to either. |

## 7. The daily bullet and the runtimes (session_budget / shadow / automation / broker)

| literal | plain English |
|---|---|
| `DAILY_BULLET_ALREADY_CONSUMED` | The one trade of the day is already used. No more today. |
| `DAILY_BULLET_ALREADY_RESOLVED` | The day's one decision is already settled (traded or finally passed). |
| `NO_A_PLUS_YET` | No qualifying setup yet today — still waiting. Waiting is normal. |
| `MISSED_FIRST_A_PLUS_SIGNAL` | The first qualifying setup was missed (e.g. the program started late). |
| `MISSED_FIRST_A_PLUS_SIGNAL_DAY_DISABLED` | Because it was missed, the day is disabled rather than chasing a second-best. |
| `OUTSIDE_EXECUTION_WINDOW` | Outside trading hours — it will not act. |
| `WOULD_TRADE` / `WOULD_SUBMIT_ONE_TRADE` | Shadow mode saying what it WOULD have done. No order was sent. |
| `ORDER_SUBMITTED` | An order was actually sent to the broker. |
| `ORDER_API_OUTCOME_UNCERTAIN` | The broker's answer was unclear — the order may or may not exist. Check the app with your own eyes. |
| `BROKER_STATE_NOT_FLAT` | The broker shows a position or working orders when the bot expected none. Check by hand. |
| `SHADOW_TOPSTEP_NON_SIMULATED_ACCOUNT_REFUSE` | Shadow mode refuses to attach to anything but a simulated account — by design. |
| `SHADOW_SEMANTICS_HASH_MISMATCH` / `REPLAY_PARITY` / `MISMATCH` | The running code or its replay does not match the frozen version — report, do not run mixed versions. |
| `HEARTBEAT` / `DECISION` | Journal entry types: a still-alive pulse; a recorded decision. |
| `MNQ_V24_SHADOW_JOURNAL` / `MNQ_V24_SHADOW_RUNTIME` / `MNQ_V24_AUTOMATION_RUNTIME` / `PROJECTX_V24_ORDER_SUBMISSION` | INTERNAL — component name tags on journal/log lines. |
| `EXPLICIT_JOURNAL_GUARD` / `FIRST_ACTIONABLE_ONLY` / `RETURN_INSIDE_CANDIDATE_LOOP` | INTERNAL — invariant names inside the one-bullet budget code. |
| 28 runtime refusal codes (`REALTIME_HEALTH_REFUSE`, `ACCOUNT_CANNOT_TRADE`, `TOPSTEP_SIZE_REFUSE`, `BROKER_STATE_EXISTS_WITHOUT_LOCAL_BULLET`, `V24_EXECUTION_QUOTE_DRIFT`, …) | TRANSLATED-IN-CODE — see the header for the one-liner that prints all 28 with what-to-do. |

## 8. Targets — where the trade was aiming (targets / target_policy)

| literal | plain English |
|---|---|
| `NO_DESTINATION` / `NO_MEANINGFUL_DESTINATION` | No worthwhile place for the trade to travel to — without room to a first reaction, no trade. |
| `FVG_15M` / `FVG_15M_NATIVE` / `FVG_15M_NATIVE_UNMITIGATED` | Target kind: a 15-minute fair-value gap (an unfilled imbalance price tends to revisit); "unmitigated" = not yet revisited. |
| `KEY_ZONE_15M` | Target kind: the next 15-minute key zone. |
| `KEY_ZONE_15M_REFINED_FVG_15M_NATIVE` / `KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M` | Target kind: that key zone, refined to the gap / cluster inside it. |
| `LIQUIDITY_CLUSTER` / `LIQUIDITY_CLUSTER_5M` | Target kind: a cluster of prior highs/lows where resting stops sit. |
| `V24_INTERNAL_CLUSTER_CONTACT_PRECEDES_PRIMARY` / `V24_INTERNAL_FVG_CONTACT_PRECEDES_PRIMARY` | Internal consistency checks on target choice (a nearer target would be hit first). If ever seen: report. |
| `V24_REFINED_LONG_TARGET_ESCAPED_PRIMARY` / `V24_REFINED_SHORT_TARGET_ESCAPED_PRIMARY` | Internal check: a refined target left its parent zone. Report. |
| `TP_GAP_REFERENCE_USD` | INTERNAL — a constant's name in the target rules. |

## 9. Levels and premarket (levels / premarket / signal / engine / exam_window)

| literal | plain English |
|---|---|
| `STRONG_SWING_DISPLACEMENT` | How a swing level qualifies: the move away from it was a strong displacement. |
| `V24_LEGACY_PRIOR_DAY_WEEK_REFERENCE_FORBIDDEN` | His "I don't use PDH" rule enforced in code: prior-day/week levels are banned inputs. If ever seen: an engineer wired one in — report. |
| `SIGNAL_ASOF_MUST_BE_TZ_AWARE` / `DECISION_ACTIONABLE_TIME_NAIVE` | Internal timezone safeguards. Report if seen. |
| `SIGNAL_INSUFFICIENT_COMPLETED_DATA` | Not enough completed candles to build a signal — wait. |
| `SIGNAL_SESSION_PROVENANCE_MISSING` | The data's session origin cannot be proven — refuse rather than guess. |
| `HISTORICAL_NEXT_1M` / `LIVE_ASK` / `LIVE_BID` | INTERNAL — names of the price source used (replay next-minute / live ask / live bid). |
| `V24_ANALYSIS_EXECUTABLE_PRICE_OFF_TICK` | A computed price is not a real tradeable tick — internal check, report. |
| `BASELINE_ARM_START` / `DEPLOYMENT_WINDOW` / `TRADE_START` / `LAST_ENTRY` / `WINDOW_NAMES` | INTERNAL — the exam's window configuration names (the 09:30 baseline arm vs the 08:00 deployment window, ALGO-049). |

## 10. The promotion ladder's refusals (policy)

These are the named reasons the PROMOTION gate refuses to advance the bot up the ladder
(RESEARCH → SHADOW → FIDELITY → … ). The operator will meet them as lines in a gate report, each
meaning "this rung is not proven yet".

| literal | plain English |
|---|---|
| `RESEARCH_VERIFIED` / `SHADOW_VERIFIED` / `FIDELITY` | Stage names on the ladder, not errors. |
| `INSUFFICIENT_SHADOW_SESSIONS` / `INSUFFICIENT_SHADOW_TRADES` | Not enough shadow-mode sessions/trades recorded yet. |
| `INSUFFICIENT_SEALED_SESSIONS` / `INSUFFICIENT_SEALED_TRADES` | Not enough sealed (tamper-evident) sessions/trades yet. |
| `INSUFFICIENT_POSITIVE_FOLDS` / `INSUFFICIENT_POSITIVE_GOLD` / `WRONG_FOLD_COUNT` | The out-of-sample evidence is too thin or mis-shaped. |
| `MISSING_REAL_USER_NO_TRADE_GOLD` | It needs real examples of days YOU chose not to trade — those are evidence too. |
| `INSUFFICIENT_NEGATIVE_SEMANTIC_FIXTURES` | Not enough taught "this is NOT a setup" examples in the test set. |
| `SEALED_RESULT_INVALIDATED_BY_RULE_CHANGE` / `SHADOW_RULE_CHANGED` | A rule changed after a result was recorded, so that result no longer counts. |
| `SEMANTICS_HASH_MISMATCH` | The running code is not the frozen version. |
| `SHADOW_DUPLICATE_ORDER_EVENT` / `SHADOW_UNRECONCILED_STATE` / `SHADOW_SIGNAL_PARITY_MISMATCH` / `SHADOW_MISSED_FIRST_A_PLUS_SIGNAL` | Shadow-phase integrity problems: a duplicated order event, books that do not reconcile, live signal disagreeing with replay, or a missed first setup. |
| `BROKER_RECONCILIATION_NOT_VERIFIED` | The bot's books have not been proven to match the broker's. |
| `CONTRACT_PROVENANCE_NOT_PROVEN` | Which exact contract the data came from is not proven. |
| `DATA_QUALITY_NOT_PROVEN` / `CLEAN_HISTORICAL_SCOPE_INCOMPLETE` | The dataset has not passed its quality checks / does not cover the required span. |
| `GOLD_MANIFEST_INTEGRITY_NOT_PROVEN` | The reference answer files' integrity is not proven. |
| `EMERGENCY_FLATTEN_DRILL_NOT_PROVEN` | The emergency close-everything drill has not been executed and proven. |
| `MARKET_HUB_NOT_VERIFIED` / `USER_HUB_NOT_VERIFIED` | The live data/user connections have not been verified. |
| `PERSONAL_DEVICE_NOT_VERIFIED` | The runtime insists on running on your own machine, and that is not verified here. |
| `TOPSTEP_SIMULATED_ACCOUNT_NOT_VERIFIED` / `TOPSTEPX_API_AUTOMATION_ELIGIBLE` | The simulated-account check / the account's automation-eligibility flag. |
| `EXPECTANCY_LOWER_95_NOT_POSITIVE` | Even at the cautious end of the statistics, the edge is not positive. |
| `ROBUST_EDGE_EXPECTANCY_NOT_POSITIVE` / `EDGE_BREAK_EVEN_MARGIN_NOT_POSITIVE` | The edge does not survive conservative re-measurement / has no margin over break-even. |
| `EDGE_LEAVE_BEST_MONTH_OUT_NOT_POSITIVE` / `EDGE_TOP5_WINNER_REMOVAL_NOT_POSITIVE` | Robustness: remove the best month / the five best winners — the edge must still be positive. |
| `EDGE_DATA_NOT_CLEAN_OOS` | The edge was measured on data that is not clean out-of-sample. |
| `ARCHITECTURE_TEST_FAILURE` / `NO_ARCHITECTURE_TEST_EVIDENCE` | The code-structure tests failed / were never run. |
| `V24_BUILD_CONTRACT_EMPTY_OR_DUPLICATE_PATH` | The build-contract file is malformed. Report. |

**Note on the EDGE_* rows:** these gates READ REALIZED OUTCOMES. They belong to the CLEAN-EDGE
rung, which comes AFTER freeze — the standing rail that no PnL may pick a rule is why they are
gated there and are not runnable today (see the validation-arsenal printout).

## 11. NEEDS-WORKER

1. **Wider sweep** — re-run the census command over ALL `research/current_mnq_strategy_v2_4_*.py`
   (and `v2_2 projectx` + `v2_3` runtime modules the family imports) and diff against this file;
   translate anything new. This file's sweep is the 23 decision modules + trace-observed extras.
2. **`PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` reason chain** — ALGO-100A F-1: at the revert head
   the token can label a clause that cannot refuse; the S3 re-land must repair the chain so the
   printed reason is always the clause that actually refused. Presentation-only translation above
   is correct either way.
3. **Deciding surface placement** — ALGO-026 §1(b) says illegible RUNTIME strings should be
   FIXED at the surface (presentation only). The runtime surface is already covered by
   `refusal_legibility.py`; whether any §6 exam literals should ALSO get an in-code table (so
   GPT-prescribed tool output is self-translating) is a worker call. No code was changed by this
   audit.
4. **`TAUGHT_SHAPE_UNTAUGHT_GATE` inventory** — the trace marks refusals resting on untaught
   magnitudes; as of the 08-24 verified run, 2 remained. Whether each survives the S3 re-land is
   campaign work (ALGO-092 §"his rule universe"), not translation work.
