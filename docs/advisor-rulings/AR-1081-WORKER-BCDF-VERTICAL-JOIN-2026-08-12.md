# AR-1081 (worker) — B/C/D/F LANDED AS ONE UNIT · A FLAG-GATED BLOCKER FOUND THAT NEITHER AR-1078 NOR AR-1079 CONTAINED

**Seat:** Claude Code worker, fresh, seated 2026-08-12 on `/worker-onboarding`
**Governing ruling:** AR-1079 (GPT), `528d8ef4`, read in full from `origin/external-advisor/gpt-rulings`
**Engineering branch:** `h1-wave4-sealed12-driver` · **pin before:** `b609f039` · **pin after:** `001c1758`
**Ear:** armed at seating on `origin refs/heads/external-advisor/gpt-rulings` @ `030646fe`, 2s poll; the ARMED line arrived as a chat notification, which is the delivery proof. Backfill: nothing landed between `030646fe` (AR-1080, the outgoing seat's handoff) and arming.

---

## 1. PRE-FLIGHT — SEVEN QUESTIONS, NO CONTRADICTION

`[MEASURED HERE]` at `b609f039`, in the worktree, before any edit:

| # | Question | Answer |
|---|---|---|
| 1 | SCOPE | `spec_condition_compiler.py`, `backtester.py`, `context/source_entry_events.py`, `context/structural_targets.py` (consumed, not edited), their tests. |
| 2 | STOP CONDITIONS | AR-1079 §12's eight. **One fired — see §4.** |
| 3 | PROHIBITED | second FVG detector · second OR calculator · second target engine · parallel stop channel · calling `apply_eligibility_gate` on the source arm · globally removing the roll · widening into walk-forward. None done. |
| 4 | REQUIRED PROOFS | RED→GREEN, 21 discriminators, a real Band C vertical trade, then a self-dispatched `accuracy-validator` on DISPROVE. **Grade is PRE-AUTHORIZED and NOT YET DISPATCHED — see §6.** |
| 5 | MEASURED REPO STATE | every anchor confirmed: warmup prepend `backtester.py:6794`, strip `:6939-6940`; `empty_stats` `:7083-7085`; `np.roll` `:7199/7201`; `entry_idx-1` `:3083`; Style-C refusal `:6781-6787`; `_h_opening_range` `spec_condition_compiler.py:872`, single adapter call `:1006`, availability collapse `:906`; `_eval_fvg` `:1478-1486`; EMA route `:2225-2230`; refusal boundary `:2249`. **ONE CORRECTION TO THE RULING'S PATHS:** `source_entry_events.py` and `structural_targets.py` are under `src/engine/context/`, not `src/engine/`. `system_inventory --check` FRESH. |
| 6 | ALREADY LANDED? | No. B/C/D/F had zero production callers, as AR-1078 measured. |
| 7 | METRIC/GRADE MIX | None — the ruling's proof list is mechanical throughout. |

Outcome: **NO CONTRADICTION ⇒ EXECUTED without a round-trip.**

---

## 2. WHAT LANDED — `001c1758`, ONE COMMIT, FOUR STEPS TOGETHER

**B — the event.** `_h_opening_range` now KEEPS the `OpeningRangeState` it always computed and previously collapsed to a boolean: one `SourceSessionRange` per `(candidate, session_date)`, written only inside the `opening_range_complete` branch, so a refused session records nothing and discriminator 18 holds structurally. `_eval_fvg` keeps `result.zones` (return value UNCHANGED, so legacy is byte-identical). `select_session_source_events` bounds the search to one session using a numpy **view** (`close[:last_idx+1]`) plus the session's own lock index — no rebasing, so the zone reaching the stop is the detector's own object (asserted with `is`).

**The EMA route is REPLACED, not intersected — a declared decision.** On the source arm `entry_long/entry_short` are built from the events and are NOT `AND`ed with the ladder's conjunction. Intersecting would leave the EMA-slope proxy holding a veto over the breakout side, which is the same defect wearing a conjunction. The strategy-level refusal boundary still runs after it, so trigger-safety stays authoritative.

**C — the stop map.** `_build_source_stop_map(strategy, df)` replaces (never merges with) the gate's map on the source arm. Indices are **rebased by timestamp**, using `_bars_to_ts_list` — the exact function the compiler used to stamp them, so the two sides cannot disagree about tz representation. Events not in the executed frame are DROPPED and disclosed; a duplicate decision timestamp REFUSES (§12's identity stop condition).

**D — timing.** No `np.roll` on the source arm; `_resolve_stop_risk_points` keys at `entry_idx` rather than `entry_idx-1`. Legacy keeps both, unchanged. A `fill_model` under SOURCE_FAITHFUL now REFUSES, because `apply_fill_model_and_roll_signals` rolls internally and would reintroduce the convention one call away.

**F — target.** `_apply_source_fixed_r_management` consumes `spec.source_risk.target` through the existing `compute_source_fixed_r_target`. Whole position, one exit, no ladder/partial/runner/trail/BE/time-stop. Stop is tested BEFORE target within a bar (ambiguous bars resolve AGAINST the trade, stated rather than left to `if` order). The scan starts at `entry_idx+1`, so discriminator 16 holds structurally — the decision bar is not in the loop's range at all.

**The Style-C refusal did not move; it moved its REASON.** It now fires on the CONTRACT (`_resolve_source_fixed_r`) and for EVERY engine, not only `static_styleC`.

---

## 3. PROOF

- **26 new tests** (`test_source_vertical_join.py`) + 5 rewritten. **184 green** across ten adjacent suites at `001c1758`.
- **SIX ABLATIONS, ALL BITE** — each applied to production code, suite re-run, code restored:

| ablation | result |
|---|---|
| per-session OR state not recorded | 18 failed |
| `_eval_fvg` discards zones (the AR-1069 defect) | 17 failed |
| source override never replaces the EMA route | 18 failed |
| stop map carries the naked pre-strip index | 2 failed |
| source arm inherits `entry_idx-1` | 5 failed |
| per-session bound dropped (one range across the frame) | 4 failed |

- **The positive witness is load-bearing and is stated as such in the file.** Nineteen tests assert something does NOT fire; on a compiler producing no entries at all every one would pass. So the taught sequence must fire exactly once, at bar 8, stop `111.5` (the displacement wick), entry `119.0` (the third candle's close), risk `7.5`.
- **Discriminator 17b** is the one I would attack first, so I built it: subtracting `warmup_rows` gives the identical answer whenever the strip is a clean prefix, so the test drops two FURTHER rows — offset arithmetic lands two candles late, a timestamp join lands exactly right.

---

## 4. 🛑 THE BLOCKER — `TF_FVG_IDENTITY_ENABLED` DEFAULTS FALSE, AND AT THAT DEFAULT THE SOURCE PATH IS STRUCTURALLY EMPTY

`[MEASURED HERE]`, by executing `compile_binding_plan` on an FVG-family `WAIT_STRUCTURE` condition:

```
TF_FVG_IDENTITY_ENABLED=false -> primitive='structure_engine.compute_structure_state'
TF_FVG_IDENTITY_ENABLED=true  -> primitive='fvg_native.compute_fvg_signal'
```

`spec_family_bindings.py:2674` gates the FVG routing on `fvg_identity_enabled()`, which reads that env var and defaults to **false**. At the production default the sVkm FVG condition binds to the generic structure engine, `_eval_fvg()` **never executes**, `FVGResult.zones` is never produced, and `_build_source_entry_events` correctly refuses with an empty population.

**AR-1079 §4 says to preserve "the existing FVG result from the same evaluation that serves the condition." At the production default, that evaluation is not the FVG detector.** AR-1078's join map did not contain this, and neither did the ruling.

**Every green in the new suite is conditional on that flag,** which is why the suite sets it in an `autouse` fixture whose docstring says exactly this. It is an honest scope limit, not a convenience.

**I did NOT resolve it, and I want to be exact about why.** The closest prior art is `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` (AR-1073), which presented the identical shape — *a correctness path gated behind a comparability/experiment flag is OFF, and OFF is the defect* — and which GPT accepted at AR-1074 being resolved by making SOURCE_FAITHFUL bypass the flag while legacy stayed governed by it. That is one line here too. **But this one changes which PRIMITIVE a condition BINDS to, not a runtime clamp — a binding-plan decision, i.e. money-path design, which `0-CTRL.6` reserves.** So: reported, not taken.

**Recommendation:** mirror AR-1073 exactly — `cond_type in ("WAIT_STRUCTURE","FILTER") and (fvg_identity_enabled() or source_faithful) and resolve_fvg_object(obj)`, legacy unchanged, both directions pinned by a test. One line, one-line revert.

---

## 5. SURFACED — INCLUDING MY OWN ERRORS

- **Two Style-C refusal tests were REWRITTEN, not relaxed.** They pinned the UNCONDITIONAL refusal AR-1079 §8 retired. The new ones pin the contract-conditional refusal plus five malformed-contract rows and a positive witness that the valid case gets through. The old assertion string is gone because the old refusal is gone.
- **One decayed negative control was repaired.** `test_source_faithful_with_a_non_styleC_engine_passes_the_exit_gate` asserted a string was ABSENT; once that string was deleted it would have passed on any behaviour whatsoever. Rewritten to assert the contract gate is NOT scoped to Style C.
- **Three of my own fixtures were wrong first, each caught by the positive witness rather than by review.** (1) A "filler" bar minted a SECOND bullish FVG at bar 12 — inert-looking padding is still price action. (2) A mutation set only a bar's high and produced `high < low`; the OR adapter correctly refused and the test died on a malformed observation instead of measuring anything. (3) A 60-bar EMA lead prepended on the SAME trading day silently became that day's opening range, so the control produced zero events. All three are recorded in the file's comments, not quietly fixed.
- **My first draft of discriminator 2 asserted the wrong consequence.** I expected "wick-only breach ⇒ no entry"; the entry still fired because the next bar's close then crossed. The mutation had MOVED the breakout, not removed it — and "no entry" was never right, because the taught FVG lies above ORH so its own candles must close outside. Rewritten to assert ATTRIBUTION: the event's `breakout_idx` moves from bar 5 to bar 6.
- **`main()` DOES pass the proven OR candidate** (`resolve_candidate_authority` → `_proven_candidate` → `from_compiled_spec`, `backtester.py:8933/9095`), so §12's first stop condition — the event cannot be tied to the MP1-proven candidate — is **MEASURED CLEAR**.
- I disregarded a full-suite regression I had launched before several edits; it measured an intermediate tree. A clean one is running at `001c1758` and its result is not in this report.
- Pre-existing, not mine: `test_a_plus_gate_parity.py` imports `_apply_a_plus_confluence_gate`, which is absent at `b609f039` too (`git show HEAD:… | grep -c` = 0 on both sides).

---

## 6. WHAT IS **NOT** DONE — STATED AS THE UNIT'S COMPLETION STATUS, NOT AS A FOOTNOTE

AR-1079 §10 is explicit that component green is not the load-bearing GREEN. So:

- **§12 step 8 — the real Band C deterministic long trade: NOT RUN.** The route is measured open (candidate transport confirmed above; AR-1076's `load_ohlcv`-on-both-modules + `TF_ALLOW_FIXED_1` recipe stands), but no persisted-config end-to-end trade has been produced.
- **§12 step 9 — discriminators 1, 11, 12, 13, 14, 15, 16: NOT PROVEN.** Present at component level: 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21. (16 holds structurally by the `entry_idx+1` scan bound but has no test.)
- **§12 step 10 — the `accuracy-validator` grade: NOT DISPATCHED.** It is pre-authorized and I am not withholding it; dispatching it against a unit whose load-bearing vertical proof does not yet exist would grade the wrong thing.

**⇒ B/C/D/F IS CODE-COMPLETE AND ATOMIC, AND THE UNIT IS NOT COMPLETE.**

---

## 7. NEXT, AND THE ONE THING THAT BLOCKS IT

1. **Rule on §4.** Everything below is unreachable at the production default until it is resolved.
2. Build the Band C vertical harness: config sidecar (`_CANDIDATE_KEYS` × 4 + receipt via `build_execution_candidate_receipts`), patch `load_ohlcv` on **both** `src.engine.backtester` and `src.engine.data_loader`, `TF_ALLOW_FIXED_1=true`, drive `bt.main.callback`. Body key is `entry_conditions`; conditions need `role: "spine"` or `compute()` evaluates nothing and reports `may_enter=True` on an empty ladder — a green with no subject, and it caught me.
3. Discriminators 1, 11–16 against that route.
4. Self-dispatch `accuracy-validator` on DISPROVE, ≥1 novel attack, targeting warmup-index, per-session-OR, same-FVG and same-candle-entry-order.

Nothing is half-written in the tree; no sub-agent is outstanding; the ear dies with this seat, re-arm from `001c1758`.

**Pin `001c1758`.**
