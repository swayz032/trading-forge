# GPT EXTERNAL ADVISOR RULING — AR-1327A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Governing chain:** AR-1325A → AR-1326A → Worker AR-1327  
**Primary Worker report inspected:** `docs/replay-results/svkm-extraction-certified/grade/opus-v2/AR-1327-WORKER-REPORT-golden-runtime-witness-and-short-stop-source-check-2026-08-18.md`  
**Primary new permanent proof inspected:** `src/engine/tests/test_svkm_v2_1_golden_runtime_witness.py`  
**Archived visual evidence inspected:** `visual-stopA/VISUAL-MICRO-PROOF.md` and `visual-stopA/paired-hires/PAIRED-GEOMETRY-PROOF.md`  
**GitHub CI:** no green CI claim is made by this ruling; local focused/regression evidence is the evidence under review.

## DISPOSITION

**PASS — STAGE 2 COMPILER VERTICAL IS CERTIFIED. AR-1138 IS CLOSED. WORKER 2 ACTIVATION IS UNLOCKED.**

This certification is intentionally precise. It does **not** claim the educator strategy is executable on both sides. It certifies that the compiler now represents the available source truth faithfully and deterministically:

- the certified source graph reaches the existing production compiler;
- the resulting committed artifact reaches the real SOURCE_FAITHFUL runtime;
- the source-owned long-side mechanics execute correctly end to end;
- the short-side setup/direction is recognized, but execution remains **fail-closed** because the exact short stop anchor is genuinely non-unique in the available source evidence;
- no compiler rule is invented to manufacture a symmetric bearish stop.

A faithful compiler is allowed — and required — to refuse an executable branch when the source does not uniquely determine that branch. **Source ambiguity is not an engineering defect.** Keeping a milestone open forever after the bounded source investigation returns a genuine non-resolution would reward fabrication over fidelity.

This ruling therefore closes the Stage-2/AR-1138 compiler-proof milestone with the short-side source limitation preserved as an explicit safety boundary.

---

## 1. F61 IS CLOSED — THE EXACT COMPILED ARTIFACT NOW EXECUTES THROUGH THE REAL SOURCE-FAITHFUL PATH

AR-1326A rejected the prior packet because `BINDS` was not enough. The missing proof was an execution-semantics witness using the **actual compiled sVkm artifact**, not a synthetic stand-in.

Worker AR-1327 closes that gap with `test_svkm_v2_1_golden_runtime_witness.py`.

The permanent witness drives the real compiled artifact through the existing production consumers:

```text
compile_svkm_v2_1_vertical()
→ committed sVkmZklJDHI__s0.spec.json semantics
→ SpecConditionStrategy.compute()
→ SOURCE_FAITHFUL _build_source_entry_events()
→ real source stop map
→ real fixed-R target consumer
```

The proof covers the exact ten items ordered by AR-1326A:

1. **5m opening range** is formed from the 5m source frame rather than the 1m execution frame.
2. **Breakout is by 1m close**, not wick-only breach.
3. **Breakout side owns direction**, not the legacy EMA proxy.
4. A **pre-breakout FVG** does not qualify.
5. An **opposite-direction FVG** does not qualify.
6. An FVG that **straddles the opening range** does not qualify.
7. No executable entry exists before the FVG's **third candle** completes.
8. The long entry occurs on the **third candle close**.
9. The long stop resolves to the source-authorized **displacement-candle wick low** and moves with that wick rather than with the gap boundary.
10. The **2R** target reaches the existing source-risk/target consumer from the actual compiled artifact.

The EMA-disagreement arm is load-bearing: the source-faithful artifact keeps the breakout-owned long side on a frame deliberately made bearish for the legacy EMA route, while the legacy arm diverges. That closes AR-1326A F63's concern that the artifact's reported generic binding approximation rate could be mistaken for the actual SOURCE_FAITHFUL entry semantics.

Worker reports:

```text
10 passed — exact-artifact golden runtime witness
60 passed — golden runtime + Stage-2 compile + source vertical join
Stage-1 certifier: GREEN_ALL_ITEMS_DONE
```

**Ruling:** F61 CLOSED. F63 CLOSED for this golden source-faithful vertical. F64 CLOSED: third-candle validity is permitted to be fused into the entry/event implementation because the runtime witness proves no event becomes executable before candle three and the event becomes executable on candle three.

---

## 2. THE 75% GENERIC BINDING-APPROXIMATION METRIC IS NOT A STAGE-2 BLOCKER

The compiled artifact still honestly reports a generic binding approximation rate. Do **not** edit, hide, tune, or cosmetically improve that number.

For this artifact, SOURCE_FAITHFUL execution replaces the legacy proxy-derived entry population with the dedicated source-event population after the required state carriers are populated. AR-1327 now proves that replacement causally with the actual artifact and adversarial controls.

Therefore:

- do **not** start a new WAIT_STRUCTURE de-approximation campaign;
- do **not** tune classifier confidence;
- do **not** lower or reinterpret the metric;
- preserve it as honest diagnostic metadata about the generic binding layer.

The metric may matter for other Strategy Factory rows later. It does not invalidate this exact source-faithful runtime proof.

---

## 3. F62 REACHED ITS AUTHORIZED STOP CONDITION — THE SHORT-SIDE SOURCE QUESTION IS EXHAUSTED, NOT DEFERRED

AR-1326A authorized exactly one bounded short-stop source question and gave an explicit STOP branch if the evidence remained unreadable, conflicting, or non-unique.

Worker AR-1327 correctly searched prior art first and found the already-frozen visual campaign rather than spending another visual/extraction cycle.

The archived 360p and 1080p evidence establishes the following:

### Resolved

- the example is unquestionably a **SHORT**;
- the TradingView position tool places the **stop above entry** and target below entry;
- the paired long example independently corroborates **Risk/Reward Ratio: 2**;
- there is no legitimate interpretation in which the short is intended to carry a low-side protective stop below entry.

### Still non-unique

The visual evidence cannot uniquely separate:

```text
displacement_candle_high
vs
fvg_high / upper gap boundary
```

At the available high-resolution frame, the stop line and FVG rectangle edge are too close to call safely. The archived proof explicitly declined to promote either reading. The teacher's spoken short-example wording also conflicts with the visible protective-side geometry.

Therefore the evidence question has an answer:

**`UNRESOLVED_SOURCE_AMBIGUITY` — confirmed after bounded visual review.**

That is the exact STOP branch AR-1326A authorized.

### Governing consequence

The existing frozen risk authority remains correct:

- long side executable from source authority;
- short side exact stop anchor unresolved;
- `displacement_candle_high` must not be invented by symmetry or trading convention;
- short execution remains fail-closed.

**Do not run visual intelligence again. Do not reshoot the same frames. Do not reopen extraction. Do not ask a model to guess the geometry.** A future new source artifact could reopen this only if it contains genuinely new discriminating evidence.

---

## 4. CLARIFICATION OF “COMPLETE STRATEGY” VS “COMPLETE COMPILER PROOF”

Earlier risk authority correctly stated that a long-only executable fixture is not the complete educator strategy. That statement remains true.

This ruling does **not** relabel the strategy as fully bidirectionally executable.

Instead, the certified machine representation of the educator strategy is now:

```text
SOURCE STRATEGY
  opening-range rule                     CERTIFIED
  close-breakout rule                    CERTIFIED
  breakout-side direction                CERTIFIED
  matching FVG outside range             CERTIFIED
  third-candle validity / entry close    CERTIFIED
  fixed 2R target                        CERTIFIED

LONG BRANCH
  stop anchor                            SOURCE-CERTIFIED
  execution                              EXECUTABLE

SHORT BRANCH
  direction/setup                        SOURCE-CERTIFIED
  stop protective side                   VISUALLY RESOLVED: ABOVE ENTRY
  exact stop anchor                      SOURCE-NON-UNIQUE
  execution                              REFUSED / FAIL-CLOSED
```

That is a **complete representation of the source truth presently available**, even though it is not a fully executable two-sided trading strategy.

The compiler milestone tests whether the system preserves and executes what is known **and refuses what is not known**. It does not require engineering to manufacture missing source authority.

Any earlier operational reading of AR-1138 that would keep the compiler milestone open until an ambiguous source is guessed into a symmetric executable rule is superseded by this ruling. That interpretation conflicts with the project's own fail-closed and source-fidelity laws.

---

## 5. AR-1138 — CLOSED

AR-1138's golden compiler-proof objective is satisfied by the current evidence chain:

```text
certified source truth
→ deterministic production compiler path
→ deterministic executable artifact
→ real runtime semantics
→ long source-owned path executes
→ unresolved short source mechanic is explicitly refused
→ no invented source rule
```

**AR-1138 STATUS: CLOSED ✅**

This closure does not erase the short-side limitation. The limitation remains a durable machine/source fact and must travel with the strategy wherever its capability is reported.

Do not create a green summary that says “both sides executable.” The correct summary is:

**“Compiler vertical certified; long source-faithful arm executable; short arm source-ambiguous at exact stop anchor and therefore fail-closed.”**

---

## 6. STAGE 2 — CERTIFIED

Stage-2 certification now includes:

- certified 9+1+2 source graph input;
- smallest adapter into the existing SPINE-A production compiler;
- deterministic artifact identity;
- alias excluded from executable duplication;
- preserved metadata inert;
- source risk and source-timeframe roles carried into artifact identity;
- fail-closed canonical-node guard;
- exact-artifact SOURCE_FAITHFUL runtime witness;
- breakout-side direction causal witness;
- third-candle entry causal witness;
- long wick-stop causal witness;
- real 2R consumer witness;
- explicit short-side fail-closed source boundary;
- Stage-1 certificate remains `GREEN_ALL_ITEMS_DONE`.

**STAGE 2 STATUS: CERTIFIED ✅**

No additional compiler repair is authorized for this golden vertical absent new contradictory evidence.

---

## 7. WORKER 2 — ACTIVATION UNLOCKED NOW

The AR-1138 blocker on Worker-2 activation is removed.

**WORKER 2 ACTIVATION: AUTHORIZED ✅**

Activation rules:

1. Worker 2 must receive its own isolated branch/worktree.
2. Worker 2 must read its durable onboarding/permanent-role record; do not guess or clone Worker 1's assignment.
3. Worker 2 must use the compressed instruction system now present in the repository rather than restoring historical giant prompt context.
4. Worker 2 must not share mutable working state with Worker 1.
5. Historical AR/F36/G2 material is reference-on-demand, not startup context.
6. Worker 2 must not reinterpret this ruling as permission for broad backtests, paper trading, or live execution unless its next governed lane specifically authorizes those operations.

A fresh Worker-2 session may now be started.

---

## 8. WORKER 1 — RETURN TO PERMANENT LANE, WITH FRESH TOKEN-EFFICIENT SESSION

Worker 1's permanent lane remains:

`compiler-factory`

The temporary Stage-2 golden vertical is now closed. Per routing law, Worker 1 returns automatically to its permanent lane.

The compressed `CLAUDE.md` / advisor-skill changes have reached the Worker-1 branch. At the next safe session boundary:

1. ensure current Worker-1 work is committed/pushed and clean;
2. end the old Claude session that already loaded the oversized startup context;
3. start a **fresh Worker-1 Claude session** so the shortened instruction kernel is loaded;
4. resume `compiler-factory` work from repository truth, not from old conversational history.

Do not create another temporary assignment merely to tell Worker 1 to return to the permanent lane; that return is automatic by rule.

---

## 9. STAGE 3 — STRATEGY FACTORY UNLOCKED, BUT PERFORMANCE QUALIFICATION REMAINS SEPARATE

With Stage 2 certified, the next architecture stage may begin:

**STAGE 3 — STRATEGY FACTORY: UNLOCKED ✅**

The Strategy Factory may now focus on reproducibly applying the certified compiler discipline across additional library strategies.

Hard rule for the factory:

> A row with unresolved source mechanics is not “fixed” by inference. It is compiled as far as source authority allows and then explicitly refused/quarantined at the unresolved branch.

Do not confuse Strategy Factory compilation with performance qualification.

This ruling does **not** by itself authorize:

- broad historical performance claims;
- paper-trading promotion;
- Topstep/live deployment;
- qualification-gate bypasses.

Those remain governed by their own downstream stages.

---

## 10. CLOSED / DO-NOT-REOPEN LIST FOR THIS CHAIN

Absent genuinely new contradictory evidence, do not reopen:

- F36;
- G2 model calls;
- relevance floor/synonym tuning;
- source-graph V2.1 architecture;
- the 9+1+2 conservation proof;
- the same short-stop visual investigation;
- generic WAIT_STRUCTURE approximation merely to improve a metric;
- a second compiler or second source-event calculator.

No new Opus/Agent/Task campaign is authorized by this ruling.

---

## 11. FINAL STAGE MAP

```text
STAGE 1 — SOURCE GRAPH / CERTIFICATION PROJECTION       CERTIFIED ✅
STAGE 2 — GOLDEN COMPILER VERTICAL                      CERTIFIED ✅
AR-1138                                                   CLOSED ✅
WORKER 2                                                  UNLOCKED ✅
STAGE 3 — STRATEGY FACTORY                              UNLOCKED ✅

sVkm LONG execution                                      EXECUTABLE ✅
sVkm SHORT setup/direction                               CERTIFIED ✅
sVkm SHORT exact stop anchor                             SOURCE AMBIGUOUS ⚠️
sVkm SHORT execution                                     FAIL-CLOSED BY DESIGN ✅

BROAD PERFORMANCE QUALIFICATION / PAPER / LIVE           NOT UNLOCKED BY THIS RULING
```

## FINAL ORDER

**Accept Worker AR-1327. Preserve the exact-artifact runtime witness. Preserve the short-side source ambiguity and fail-closed execution boundary. Do not spend another cycle trying to force a symmetric stop from non-unique evidence. Mark Stage 2 certified and AR-1138 closed. Activate Worker 2 on an isolated worktree using its permanent onboarding role. Return Worker 1 to `compiler-factory` in a fresh token-efficient session. Proceed to Strategy Factory without reopening the closed source/compiler chain.**