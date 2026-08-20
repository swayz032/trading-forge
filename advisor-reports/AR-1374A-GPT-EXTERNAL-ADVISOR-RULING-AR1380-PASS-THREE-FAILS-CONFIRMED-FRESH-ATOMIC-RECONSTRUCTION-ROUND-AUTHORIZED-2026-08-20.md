# GPT EXTERNAL ADVISOR RULING — AR-1374A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ ba9d1fbfe1d6934dd875039e744f75cf907cefcf`  
**Prior controlling ruling:** AR-1373A @ `c964c701a6e25e52f5082853891b714c57843501`  
**Reports graded:** AR-1379 + AR-1380  
**Accepted semantic harness:** `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

## DISPOSITION

**AR-1379 / AR-1380 = PASS, WITH AR-1380 CONTROLLING WHERE THE TWO DIFFER.**  
**THE THREE GPT-5.6 FAILS ARE INDEPENDENTLY CONFIRMED.**  
**ZERO CANDIDATES PROMOTE.**  
**THE STRICT `PARTIAL => semantic_pass:false` LAW IS CONFIRMED AS INTENTIONAL FAIL-CLOSED BEHAVIOR, NOT A HARNESS DEFECT.**  
**A BOUNDED FRESH-RECONSTRUCTION ROUND FOR THE SAME THREE CALIBRATION VIDEOS IS NOW AUTHORIZED.**  
**DO NOT MASS-RECONSTRUCT THE OLD 40. DO NOT BACKTEST YET.**

Worker 1 completed the required independent challenge and then corrected its first report when the independently dispatched accuracy-validator reports arrived. The late reports materially sharpened the semantic diagnosis rather than merely echoing the first pass. GPT independently inspected the current candidate objects, the repaired harness, and the relevant Worker evidence before issuing this ruling.

GitHub reports no status checks and no workflow runs for current Worker HEAD.

**CI: NONE; tests and model-audit evidence are local-only plus independent repository inspection.**

---

## 1. AR-1380 CORRECTIONS ARE ACCEPTED

AR-1380 correctly supersedes two parts of AR-1379:

1. the three accuracy-validator agents were slow, not failed/stuck; and
2. two GPT-5.6 findings were directionally correct but imprecisely framed.

The corrected two-path verdict remains:

- `E8Wg6tFPYjo` — FAIL confirmed;
- `7ieYBa7Z-Hg` — FAIL confirmed;
- `1HFoStW_wsc` — FAIL confirmed.

No frozen candidate was patched and no candidate entered certifier/compiler.

---

## 2. `E8Wg6tFPYjo` — FAIL CONFIRMED, BUT THIS IS MOSTLY AN EVIDENCE-AUTHORING PROBLEM

The core extracted method remains source-faithful:

`4H premium/discount -> liquidity sweep -> BOS + FVG -> 71% pending limit -> Fibonacci-range stop/target`

The strongest actual defects are:

- wrong quote attached to `setup[6]`;
- compound quote-bound rows where one quote only entails part of the row;
- non-executable presentation/platform/practice guidance placed into executable `variants[]` / `management[]` containers.

AR-1380 is right to retract the stronger word “laundering.” The candidate often self-discloses that some material is optional/presentational. The problem is **schema-slot misclassification**, not concealment.

**Money-path implication:** this is the highest-probability first clean survivor because the trading logic itself is already largely faithful. Reconstruct it with cleaner evidence atoms and roles; do not redesign the strategy.

---

## 3. `7ieYBa7Z-Hg` — FAIL CONFIRMED, AND THE GOLDEN-FVG LESSON APPLIES WITH A SOURCE-FAITHFUL LIMIT

### A. 30 / 50 / 70 is not yet authority for three discrete bots

The frozen candidate quotes the educator saying price may retrace:

`about 30, 50, or 70% somewhere within there`

That supports a **retracement region / multiple observed depths**. It does **not by itself** prove three separately taught deterministic entry bots at exactly 30%, 50%, and 70%.

Therefore the system must not manufacture `BOT-30`, `BOT-50`, `BOT-70` merely because three numbers appear.

The operator’s Golden-FVG precedent is still architecturally correct: **when the teacher actually teaches multiple executable branches, split them instead of inventing a hidden selector.** The source here does contain one much cleaner explicit fork.

### B. The explicit execution fork is real

The source says:

`I can use one of two things. I can place my entry at the 50, place my stop behind the 70% ...`

and then describes candlestick-structure entry as the other choice.

Accordingly, a fresh reconstruction may represent at least these as source-faithful execution variants:

1. **50%-zone entry / stop behind 70% variant**;
2. **candlestick-structure entry / stop behind the qualifying candle variant**.

Do not rank either as “Primary” unless the source does.

### C. Actual unsourced arbitration defects

GPT independently confirmed the sharper AR-1380 evidence:

- current `stop.anchor` begins `Primary placement:` and unilaterally ranks the 50/70 branch despite no source ranking;
- current targets are assigned numeric priorities `1,2,3,4,5`, yet the candidate’s own source gaps admit no general source law selecting among those target types.

That is real invented arbitration.

For the fresh reconstruction:

- preserve context-conditional target rules where the source supplies a condition;
- do not impose a global priority order without source evidence;
- where the source does not decide among valid alternatives, represent an explicit variant/family or preserve `source_unresolved`; do not guess.

---

## 4. `1HFoStW_wsc` — CRITICAL OVER-SEGMENTATION CONFIRMED

The six-top-level-strategy shape remains rejected.

GPT independently inspected the current candidate and confirmed the strongest AR-1380 witness:

- `s1.entry_sequence[2]` and `s2.entry_sequence[0]` both rely on the exact same quote: `Trend strategies in trending markets, mean reversion strategies in ranging markets.`

That shared sentence is umbrella regime-routing evidence, not evidence-disjoint proof of two independent top-level strategy identities.

Also:

- event-anchored VWAP is level-construction/context without its own direction/trigger/stop/target;
- higher-timeframe VWAP is primarily a regime/filter layer;
- trending/ranging applications reuse the umbrella VWAP framework.

AR-1380 also correctly observes that GPT-5.6’s exact `s2` vs `s3` and `s5` classifications were not perfectly internally consistent. That does **not** rescue the six-strategy candidate. It strengthens the conclusion that the source should be reconstructed with fewer top-level strategy identities and cleaner variants/context layers.

The fresh reader must derive the exact count from the transcript again. Do not hard-code “2” merely because the challenge currently suggests `<=2`.

---

## 5. STRICT PARTIAL LAW — CONFIRMED, DO NOT WEAKEN

GPT independently inspected `strategy_factory_gpt56_semantic_audit.py @ 8acb6b0f...`.

The harness intentionally records every non-`ENTAILED` claim as a fail-closed reason, every non-PASS cross-field check as a reason, and every HIGH/CRITICAL finding as a reason, then computes:

`semantic_pass = not reasons`

Therefore a single `PARTIAL` is sufficient to prevent semantic PASS.

**RULING: THIS IS NOT A BUG. DO NOT ADD SEVERITY WEIGHTING OR A PARTIAL TOLERANCE TO GET CANDIDATES THROUGH.**

The permanent intake is allowed to be strict because compiler/backtest authority comes later. The correct repair is better candidate/evidence authoring, not a weaker truth gate.

### Fresh-authoring law

Every quote-bearing candidate object must be written at the smallest useful semantic grain:

- one atomic source proposition per quote-bearing object where practical;
- do not combine distinct facts in one `description`, `action`, `rationale`, `name`, or `rule` unless one literal quoted span fully entails the complete compound proposition;
- do not make a rationale stronger than its quote;
- do not store tooling, visualization, platform logistics, practice advice, or generic education in executable strategy containers;
- preserve uncertainty explicitly rather than resolving it with prose such as `primary`, `preferred`, `priority`, `must`, or `only` unless the transcript earns that word.

This is a permanent authoring discipline for transcript-first intake, not a one-off patch for these videos.

---

## 6. AUTHORIZED NEXT ROUND — THREE FRESH CANDIDATES, SAME THREE VIDEOS ONLY

Worker 1 is authorized to run a new Opus transcript-first reconstruction for exactly:

1. `E8Wg6tFPYjo`;
2. `7ieYBa7Z-Hg`;
3. `1HFoStW_wsc`.

Each must receive a **new candidate identity / SHA**. The old frozen JSON files remain historical failed evidence and must not be edited in place.

### Shared reconstruction constraints

For all three:

- original transcript remains the only semantic authority;
- no legacy/Gemma semantics visible to Opus;
- the confirmed failure findings may be supplied only as **rejection constraints / authoring hazards**, not as substitute source facts;
- apply the atomic quote-binding law above;
- classify non-executable teaching/context outside executable strategy roles;
- no invented selector or priority law;
- no compiler/backtest inference may fill source gaps.

### Case-specific constraints

#### `E8Wg6tFPYjo`

- preserve one top-level strategy unless the transcript itself newly proves otherwise;
- repair quote-to-claim bindings;
- keep visualization/platform/practice guidance out of executable variant/management slots;
- preserve the taught 71% pending-limit strategy logic.

#### `7ieYBa7Z-Hg`

- preserve one top-level setup unless transcript evidence proves otherwise;
- represent the explicit 50/70 vs candlestick-structure fork without ranking one as primary;
- treat 30/50/70 as descriptive retracement-depth evidence unless the transcript explicitly upgrades those numbers into distinct executable alternatives;
- remove unsourced global target priorities;
- preserve target-specific conditions where actually taught;
- unresolved target arbitration remains unresolved rather than guessed.

#### `1HFoStW_wsc`

- re-derive strategy count from source with an independence test;
- umbrella regime-routing evidence cannot by itself create multiple top-level strategies;
- event-anchor construction and higher-timeframe regime/filter material must not be promoted to standalone strategies without complete executable identity;
- variants/context/filter layers must remain semantically distinct from independent strategies.

---

## 7. SAME-ROUND POST-RECONSTRUCTION GATES

Do not stop for ceremony after merely producing the three new JSON files.

For each new candidate in the same bounded round:

1. freeze new candidate bytes + receipt;
2. run literal verification;
3. require zero literal quote failures;
4. emit a new bound GPT-5.6 semantic task using the accepted repaired harness;
5. record transcript SHA, candidate SHA, task SHA, nonce, claim count, strategy count;
6. do **not** fabricate or substitute the GPT-5.6 response.

Return all three tasks to the controlling GPT-5.6 Sol seat for the next semantic audit.

If a genuine reconstruction/tooling blocker fires, stop only that case; do not halt non-conflicting cases.

---

## 8. MONEY-PATH STATUS

Still locked:

- deterministic certifier/compiler for the failed candidates;
- source-faithful backtest;
- broad Factory rerun;
- PAPER;
- broker/Topstep/live;
- 160-video intake.

Current shortest path:

`confirmed semantic rejects -> fresh atomic source reconstructions -> literal clean -> GPT-5.6 semantic audit -> independent Claude challenge -> first clean survivor -> certifier/compiler -> SOURCE_FAITHFUL backtest`

This is forward progress, not an architecture reset.

---

## FINAL RULING

**AR-1380 PASSES and controls over AR-1379 where they differ. The three semantic FAILs remain independently confirmed, but the refined diagnoses matter: `E8Wg6tFPYjo` is mainly an evidence-binding/schema-role cleanup around otherwise faithful trading logic; `7ieYBa7Z-Hg` contains a real source-taught execution fork and must not invent a preferred branch or target ranking—nor should 30/50/70 automatically become three bots absent explicit source authority; `1HFoStW_wsc` remains critically over-segmented. The semantic harness’s `PARTIAL => FAIL` behavior is intentional fail-closed law and must not be weakened. Worker 1 is now authorized to create fresh Opus candidate identities for exactly these three videos using atomic quote-bound authoring and the case-specific constraints above, then literal-verify and emit three new bound GPT-5.6 tasks in the same round. No broad reconstruction, compiler, backtest, PAPER, or live shortcut.**