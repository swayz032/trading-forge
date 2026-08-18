# GPT EXTERNAL ADVISOR RULING — AR-1326A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Governing authority:** `AR-1325A` — Stage 1 certified; Stage 2 Compiler Vertical unlocked  
**Worker Stage-2 implementation commit inspected:** `d26dd40a8d751e15cde6af83cb0c564c1d6e96a2`  
**Worker head / generated-inventory follow-up inspected:** `5fc50a05d634314b0a40f76e0edb5ef19cf2a69b`  
**GitHub CI:** **NONE** — combined statuses empty; no workflow runs attached to inspected Worker head.

**Disposition:** **PARTIAL PASS — THE CERTIFIED-V2.1 -> EXISTING SPINE-A COMPILER ADAPTER IS REAL AND SHOULD BE KEPT. THE COMMITTED ARTIFACT IS DETERMINISTIC, CONSERVES THE CERTIFIED GRAPH IDENTITY, EXCLUDES THE F37 ALIAS FROM EXECUTABLE DUPLICATION, KEEPS THE TWO PRESERVED-METADATA REFS INERT, CARRIES THE FROZEN SOURCE-RISK / SOURCE-TIMEFRAME CONTRACTS, AND FAILS CLOSED IF A CANONICAL NODE IS NO LONGER ACCEPTED. HOWEVER, AR-1325A DID NOT ASK ONLY FOR AN ARTIFACT THAT BINDS; IT REQUIRED AN EXECUTION-SEMANTICS WITNESS FOR THE GOLDEN COMPILED ARTIFACT. THE CURRENT PACKET EXECUTES ONLY THE OPENING-RANGE HANDLER WITH THAT ARTIFACT AND EXPLICITLY DOES NOT RUN THE ACTUAL ARTIFACT THROUGH THE EXISTING SOURCE_FAITHFUL BREAKOUT -> MATCHING FVG -> THIRD-CANDLE -> SOURCE-RISK PATH. THE PACKET ALSO SURFACES A GOVERNING SOURCE-TRUTH BLOCKER THAT CANNOT BE PAPERED OVER: THE FROZEN AR-1068 RISK CONTRACT STILL MARKS THE SHORT-SIDE STOP `UNRESOLVED_SOURCE_AMBIGUITY` AND FORBIDS INVENTING `displacement_candle_high`. STAGE 2 REMAINS ACTIVE. STAGE 3 REMAINS LOCKED. ONE BOUNDED COMPLETION PACKET IS AUTHORIZED; DO NOT REDESIGN THE COMPILER OR REOPEN STAGE 1.**

## 1. WHAT PASSES

The implementation makes material Stage-2 progress and is not a throwaway experiment.

1. `src/engine/extraction/svkm_v2_1_compile.py` is the smallest missing adapter between the certified V2.1 graph and the already-existing production compiler entry path. It calls `compile_certified_record.py::compile_record_to_artifact()` / `spec_producer.py` rather than creating a parallel compiler.
2. The adapter reruns the stable certified projection, verifies all nine canonical refs are `ACCEPTED`, reconstructs the raw-shaped record from certified projected text, and refuses if any canonical ref is missing/unaccepted.
3. `confluences[1].description` is excluded from the reconstructed record, so the F37 alias cannot become a second executable breakout condition.
4. `entry_sequence[0].rationale` and `entry_sequence[2].rationale` remain provenance-only rationale fields; permanent mutation proof shows changing them does not change compiled `entry_conditions` or `spec_hash`.
5. The final artifact carries the certified graph hash `fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f` and `ledger_d = CONSERVED`.
6. The artifact carries the previously ruled `SOURCE_FAITHFUL` risk contract and the 5m-opening-range / 1m-breakout-FVG-entry timeframe-role contract.
7. The adapter recomputes `spec_hash` after the source-risk / timeframe-role enrichment, so those fields are covered by artifact identity rather than appended outside the hash.
8. The packet contains deterministic repeat-compile proof and permanent fail-closed mutation tests.
9. The Worker reports 22 new Stage-2 tests and 457 passing tests across the selected Stage-2 + neighboring suite. The Stage-1 certifier was rerun and remained `GREEN_ALL_ITEMS_DONE`.
10. The final development correction moving the compiled fixture out of `docs/` is legitimate: it avoids contaminating a pre-existing corpus census rather than changing the census to accommodate the new artifact.

Keep all of this.

## 2. F61 — `BINDS` IS NOT THE REQUIRED GOLDEN RUNTIME WITNESS

AR-1325A required:

> certified V2.1 source graph -> existing production compiler entry path -> one deterministic executable strategy/spec artifact -> compiler contract/lint checks -> **execution-semantics witness for every source-owned node** -> deterministic repeat compile.

The new test module itself explicitly says it does **not** execute the full compiled sVkm artifact through breakout -> FVG -> third-candle entry -> stop -> 2R. Its production-seam test calls only `SpecConditionStrategy._h_opening_range()` with the compiled artifact.

That proves the 5-minute source frame reaches the real opening-range handler. It does **not** prove the exact artifact's remaining source-owned mechanics execute together.

This distinction matters because `SpecConditionStrategy.compute()` contains a special SOURCE_FAITHFUL replacement path. The ordinary `direction="both"` path uses an EMA-slope proxy; the SOURCE_FAITHFUL branch later replaces that population with `_build_source_entry_events()`, whose real semantics are:

```text
locked per-session range
-> close breakout side owns direction
-> matching-direction FVG after breakout and outside same range
-> third candle is decision bar
-> entry at third-candle close
-> source stop resolver
-> executable event only if source stop is valid
```

The existing synthetic `test_source_vertical_join.py` proves that engine path in isolation. Stage 2 now needs to prove **this newly compiled golden artifact reaches that same path correctly**. Re-citing the synthetic component proof is useful dependency evidence but is not the missing vertical join.

Classification: **STAGE-2 GOLDEN EXECUTION WITNESS OPEN.**

### Required repair

Add one bounded permanent integration witness using the committed `sVkmZklJDHI__s0.spec.json` artifact itself and the existing `SpecConditionStrategy.compute()` / source-entry-event machinery. This is **not** a historical backtest and does not unlock broad backtests.

Use a small deterministic synthetic price frame constructed solely to exercise the certified mechanics, plus the real 5m opening-range source frame required by the artifact's typed roles. Reuse existing engine consumers; do not implement another breakout/FVG/stop/target calculator in the test.

The positive arm must prove, from the actual compiled artifact:

1. the 5m opening range is formed from the 5m source frame;
2. the 1m breakout is by **close**, not wick;
3. breakout side determines the event direction, not EMA slope;
4. an FVG before the breakout does not qualify;
5. an opposite-direction FVG does not qualify;
6. an FVG not wholly outside the same certified range does not qualify;
7. no event becomes executable before the FVG's third candle completes;
8. the executable long event occurs on the third candle close;
9. the long stop resolves to the source-authorized displacement-candle low including wick;
10. the fixed `2R` contract reaches the existing source-risk/target consumer from the compiled artifact, not a test-local arithmetic replacement.

Include a strong EMA-disagreement control: hold the taught breakout/FVG sequence fixed while making the legacy EMA lean disagree. The SOURCE_FAITHFUL artifact must keep the breakout-owned side.

## 3. F62 — THE SHORT-SIDE STOP IS STILL A REAL SOURCE-TRUTH BLOCKER

The Worker correctly did **not** invent a bearish stop anchor.

The frozen artifact `src/engine/extraction/fixtures/svkm_source_risk_canonical.json` says:

- long side: `TEXT_SUFFICIENT`;
- source stop: `displacement_candle_low`, include wick;
- fixed target: `2R`;
- short side: `UNRESOLVED_SOURCE_AMBIGUITY`;
- governing law: keep short fail-closed until the one bounded visual question resolves it or remains unresolved/conflict;
- explicit prohibition: do **not** add `displacement_candle_high` by trading convention/inference.

The same artifact also states that a long-only fixture is **not the complete educator strategy**.

Therefore AR-1325A's phrase `direction-relative FVG candle extreme` must not be read as authority to manufacture the missing short rule. Earlier source authority wins over engineering intuition.

Classification: **SOURCE AUTHORITY OPEN / COMPLETE-BIDIRECTIONAL VERTICAL BLOCKER.**

### Required repair — one bounded source question only

Do not reopen extraction, G2, relevance, F36, or graph architecture.

Resolve exactly one question:

> In the teacher's SHORT worked example around the stop instruction (`click the short tool here` near transcript char ~13320; stop rule span ~13912-14135), what exact price feature does the visible stop line/short-position tool place the stop on?

Preferred evidence order:

1. already-archived deterministic frame/screenshot/video evidence in the repository, if any;
2. if absent, retrieve the smallest source-video frame window necessary to answer this one question and freeze the frame/time/hash as evidence;
3. if the visual is unavailable, unreadable, conflicting, or does not uniquely identify the stop anchor, keep `UNRESOLVED_SOURCE_AMBIGUITY` and STOP. Do not infer.

No Agent/Task/Opus campaign is authorized. This is one bounded evidence question, not another extraction round.

If the visual explicitly resolves the short stop, update the risk contract through a versioned successor/authority record and add a short execution arm through the same existing source-risk resolver. If it does not resolve, report that fact cleanly; do not change the frozen AR-1068 artifact in place.

## 4. F63 — THE 75% APPROXIMATION METRIC MUST NOT BE MISREAD

The committed artifact honestly reports:

```text
n_executed_bindable = 4
n_binding_approximation = 3
binding_approximation_rate = 0.75
bias_direction = OPTIMISTIC_LOOSER_THAN_TAUGHT
```

This is alarming if read as the actual SOURCE_FAITHFUL entry semantics, but the existing runtime has an important special case: in SOURCE_FAITHFUL mode, `SpecConditionStrategy.compute()` replaces the legacy EMA/proxy entry population with `_build_source_entry_events()` after the per-condition state carriers have run.

Therefore **do not launch a new generic binding-classifier campaign merely to make 0.75 smaller**. That would be another detour.

Instead, the exact-artifact runtime witness in §2 must prove the SOURCE_FAITHFUL population is determined by the source event machinery and not by those optimistic proxy arrays. The EMA-disagreement and breakout/FVG negative controls are the load-bearing proof.

If the actual artifact fails to reach `_build_source_entry_events()` because one of the required carriers was not populated, then and only then repair the smallest missing production binding/adapter seam. Do not tune classifier confidence or globally de-approximate WAIT_STRUCTURE.

## 5. F64 — THIRD-CANDLE VALIDITY MAY BE FUSED, BUT FUSION NEEDS EXECUTION PROOF

The packet maps `entry_sequence[3].rationale` to `structural:fvg_validity_fused_into_entry_action` because the compiler's raw-record lowering chooses each step's `action` text over its `rationale` text.

That can be a valid non-duplicating representation: the entry action itself says to enter on the closure of the FVG sequence's third candle, while the rationale says the FVG becomes valid once that third candle prints.

But current proof is textual: it asserts the rationale text is absent and the action contains `third candle`.

The §2 runtime witness must turn that into semantics by showing bars 1/2 of the candidate FVG cannot emit the taught event and the third candle can. No separate rationale predicate is required if the fused entry/event implementation proves the same constraint.

## 6. TEST / CI DISPOSITION

Accepted as useful local evidence:

- Worker reports the new Stage-2 suite green;
- selected neighboring suites total 457 pass;
- Stage-1 certification remains green;
- current GitHub combined statuses are empty;
- current GitHub workflow-run query is empty.

So GitHub CI remains **NONE**, not green and not red.

The disclosed `test_source_band_c_vertical.py` failures are not ordered into this packet merely because they exist. The Worker states they reproduce before its change. Do not repair them unless the bounded exact-artifact witness demonstrates they are actually on this vertical's causal path.

## 7. FASTEST ROBUST NEXT PACKET

Worker-1 remains in `compiler-factory`.

Proceed immediately with **one bounded Stage-2 completion packet**:

```text
A. keep d26dd40a adapter/artifact unchanged as baseline
B. add exact compiled-artifact SOURCE_FAITHFUL compute() witness
C. prove long breakout/FVG/third-candle/stop/2R semantics + negative controls
D. perform the one bounded short-stop visual/source check
E. if short resolves: version source-risk authority + prove short arm
F. if short does not resolve: preserve fail-closed state and STOP with exact evidence result
G. deterministic repeat + relevant focused regressions
H. return to GPT
```

No broad backtests. No Strategy Factory. No Worker-2 activation yet if AR-1138 requires the complete bidirectional educator strategy. No PAPER/Topstep/live. No F36. No comparator loop. No new graph design. No floor/synonym tuning. No new model/subagent campaign.

## 8. STAGE MAP

```text
STAGE 1 — SOURCE GRAPH / CERTIFICATION PROJECTION: CERTIFIED ✅
STAGE 2 — COMPILER VERTICAL: PARTIAL PASS / ACTIVE
  adapter + deterministic artifact: PASS ✅
  exact golden runtime witness: OPEN
  long source-risk contract: PASS ✅
  short source-risk authority: OPEN / FAIL-CLOSED
STAGE 3 — STRATEGY FACTORY: LOCKED
STAGES 4-6: LOCKED
```

**Final ruling: preserve the Stage-2 adapter. Do not call the full compiler vertical complete yet. Prove the actual artifact through the existing SOURCE_FAITHFUL runtime and resolve-or-honestly-refuse the single remaining short-stop source question.**