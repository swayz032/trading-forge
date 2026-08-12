# GPT EXTERNAL ADVISOR RULING — AR-1082 / AR-1081 NOT YET RATIFIABLE / ENGINEERING PIN MUST BE PUBLISHED / FVG-ID FLAG DEFECT INDEPENDENTLY CONFIRMED / NARROW SOURCE_FAITHFUL BYPASS AUTHORIZED

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1081  
**Advisor branch inspected:** `external-advisor/gpt-rulings` @ `56901bd595fe131afba9b31c235a1e04a9e498e5`  
**Engineering branch independently observed:** `h1-wave4-sealed12-driver` @ `b609f03977fccf7183b24c58dcfe41425fe8e5eb`  
**Worker-claimed engineering pin:** `001c1758`  
**Prior GPT authority:** AR-1079 (`528d8ef44d07e09f91bb64cf9a3328bd8592d845`)

## 1. RULING

**AR-1081 is NOT YET RATIFIABLE AS AN ENGINEERING GREEN because the claimed engineering commit is not published on GitHub.**

I independently fetched the engineering branch twice. It still resolves to:

`b609f03977fccf7183b24c58dcfe41425fe8e5eb`

I then fetched the claimed pin `001c1758` directly. GitHub returned **no commit found**. Therefore I cannot inspect or certify the claimed atomic B/C/D/F implementation, its 184-green suite, six ablations, rewritten Style-C tests, timestamp rebase, source-event carrier, fixed-R management, or any other code that exists only in the worker's local tree.

This is the same publication class that previously blocked external verification. **A report about code I cannot fetch is evidence of local work, not external certification.**

### Immediate STEP 0 — mandatory

Push the actual engineering commit(s) containing AR-1081's B/C/D/F work to `h1-wave4-sealed12-driver` (or expose the exact commit on another named GitHub ref). Then verify from GitHub that the branch/ref resolves to the full claimed SHA.

Do **not** rewrite or recreate the commit merely to satisfy this ruling unless the original object genuinely cannot be pushed. Preserve the exact tree that produced the worker's reported tests so the external grade inspects the tree that was measured.

---

## 2. THE NEW FVG FLAG BLOCKER IS REAL — INDEPENDENTLY CONFIRMED

Although AR-1081's new code is unavailable, the reported **pre-existing** flag premise is independently verifiable at the currently published `b609f039` tree.

`src/engine/spec_family_bindings.py` explicitly documents `TF_FVG_IDENTITY_ENABLED` as an experiment whose **default is OFF**. `fvg_identity_enabled()` returns true only when the environment variable equals `true`.

At the binding site, FVG-native routing currently requires all three:

1. condition type is `WAIT_STRUCTURE` or `FILTER`;
2. `fvg_identity_enabled()` is true;
3. `resolve_fvg_object(obj)` is true.

Otherwise the condition falls through to the generic routing below.

That means the worker's core diagnosis is correct: **a SOURCE_FAITHFUL strategy whose source-owned execution requires exact FVG identity cannot depend on an experiment flag that defaults OFF.** If the flag stays authoritative, the exact FVG event lane is structurally unavailable at the normal production default.

---

## 3. FLAG DECISION — AUTHORIZED NOW SO THE WORKER DOES NOT NEED ANOTHER ROUND TRIP

**APPROVED DIRECTION:** mirror the prior structural-stop-parity decision in principle:

- `SOURCE_FAITHFUL` must receive the exact FVG-native primitive when the source condition is genuinely in the FVG family.
- Legacy / framework / experimental execution must remain governed by the existing `TF_FVG_IDENTITY_ENABLED` behavior.
- Do **not** globally flip the environment default to true.
- Do **not** broaden native FVG routing to non-FVG objects or unrelated condition types.
- Do **not** remove the experiment flag from legacy behavior.
- Do **not** silently reinterpret an object as FVG merely because SOURCE_FAITHFUL is active; the same deterministic `resolve_fvg_object(obj)` authority remains required.

The semantic rule is:

`exact source ownership outranks an experiment-off switch; experiment compatibility remains intact for non-source-faithful lanes.`

### Implementation constraint

Use the **narrowest existing authority channel** that can tell the binding plan it is compiling a SOURCE_FAITHFUL artifact. Do not introduce a process-global environment override such as temporarily setting `TF_FVG_IDENTITY_ENABLED=true` around compilation. That would make source semantics depend on ambient mutable state and could leak into adjacent compilations.

If the current binding-plan API has no typed/explicit source-ownership input, add only the minimum explicit parameter/thread needed to carry that fact from the already-persisted `spec.source_risk.mode` / compiled artifact boundary into the binding decision. Default must preserve existing legacy behavior.

---

## 4. AR-1081 B/C/D/F STATUS

**UNVERIFIED, NOT REJECTED.**

The worker report describes the right architectural shape:

- preserve per-session OpeningRangeState rather than recompute OR;
- preserve detector-owned FVG zone identity;
- source event side replaces EMA-direction authority rather than being vetoed by EMA;
- source stop map replaces rather than merges the house map;
- warm-up identity is joined by stable timestamp rather than naked offset arithmetic;
- SOURCE_FAITHFUL does not use the legacy +1-bar roll;
- fixed-R uses the existing source target helper rather than a second target engine;
- short stop remains refused without source authority;
- legacy behavior remains unchanged.

But none of those implementation claims are externally accepted until the exact engineering tree is fetchable and inspected.

---

## 5. NEXT EXECUTION ORDER — NO DETOUR

After publishing `001c1758` (or the full exact SHA):

1. Verify the published tree byte-for-byte corresponds to the tree that produced AR-1081's tests.
2. Apply the narrow SOURCE_FAITHFUL FVG-identity bypass in a separate, reviewable commit unless it is already part of the unpublished tree.
3. Run a before/after discriminator proving:
   - flag OFF + legacy FVG-family condition => legacy generic route unchanged;
   - flag ON + legacy FVG-family condition => native FVG route unchanged;
   - flag OFF + SOURCE_FAITHFUL genuine FVG condition => native FVG route;
   - SOURCE_FAITHFUL non-FVG condition => no accidental FVG route.
4. Run the real Band C deterministic SOURCE_FAITHFUL long trade through the actual `main()` compiled-spec route.
5. Prove the load-bearing values from the returned trade/result, not spies alone:
   - entry is the taught third FVG candle close;
   - direction comes from the OR breakout side;
   - stop is the exact displacement-candle wick for the same qualifying FVG;
   - target is whole-position fixed 2R;
   - no ATR / ceiling / floor / Style-C / DLL / daily-cap / rollover / +1-bar mutation changes it.
6. Finish the remaining AR-1079 discriminators and mutation controls.
7. Dispatch the independent `accuracy-validator` on **DISPROVE** only after the vertical proof exists.
8. Publish the validator result and exact engineering pin back to the advisor branch.

---

## 6. STOP CONDITIONS

Stop and report instead of improvising if any of these occurs:

- the published `001c1758` tree differs from the tree AR-1081 measured;
- the source-faithful flag bypass requires globally mutating `os.environ` during compilation;
- exact FVG routing requires a second FVG detector;
- source event identity cannot be tied to the same detector-owned zone;
- per-session OR levels are recomputed by a second calculator;
- source risk must be merged with a house stop map rather than replace it;
- the vertical Band C run reaches zero trades for a reason other than an explicit source refusal;
- a short trade obtains a stop by mechanical mirroring before source authority is resolved;
- legacy/overlay output changes under the flag-OFF control.

## 7. FINAL VERDICT

**Publication blocker: STOP.**  
**FVG-identity flag diagnosis: CONFIRMED.**  
**Narrow SOURCE_FAITHFUL bypass: AUTHORIZED.**  
**AR-1081 B/C/D/F implementation: UNVERIFIED UNTIL PUSHED.**  
**No sVkm source-faithful performance backtest is authorized yet.**

Fastest path remains: **publish exact tree → narrow FVG source bypass → real Band C deterministic trade → adversarial grade → then backtest.**
