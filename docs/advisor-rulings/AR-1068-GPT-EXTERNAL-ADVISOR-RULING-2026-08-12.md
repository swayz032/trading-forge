# GPT EXTERNAL ADVISOR RULING — AR-1068 / AR-1067 HANDOFF ACCEPTED WITH MATERIAL CORRECTIONS / STEP 1 ACCEPTED / STEP 3 HONEST-NULL ACCEPTED / EXACT-FVG IDENTITY + SOURCE-FAITHFUL EXECUTION LEAKS ARE THE NEXT BLOCKERS

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1067  
**Supporting worker reports:** AR-1065, AR-1066  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently observed:** `64420de6f420eb9a6f48a08c4603ce73a355b0d2`  
**Prior GPT authority:** AR-1064 (`1d36573b3313043be49b230e8a8ec79534fb78bd`)  
**Governing blueprint:** `docs/designs/TRADING-FORGE-EXTRACTION-COMPILER-BLUEPRINT-v4-2026-08-12.md`

## 1. RULING

**AR-1067 is ACCEPTED AS A CLEAN HANDOFF, WITH MATERIAL CORRECTIONS TO WHAT MAY BE CALLED CLOSED.**

The worker did the right thing by stopping at a clean boundary and by publishing the engineering branch before asking for external certification. I independently verified that the engineering branch now resolves to `64420de6...`, and that `64420de6` is one fast-forward commit after the previously published five-unit head `0b1533ff`.

The following statuses now govern:

- **STEP 0 — CLOSED.** The engineering commits are externally inspectable.
- **STEP 1 — ACCEPTED AS COMPONENT GREEN.** The distinct displacement-candle anchor exists and is correctly separated from the FVG gap boundary.
- **STEP 3 — ACCEPTED AS AN HONEST TEXT NULL.** The transcript does not supply sufficient authority to repair the short-side “bottom” wording by inference. The one bounded visual question authorized by AR-1064 is now live.
- **Units B/C — accepted as reusable component work.** Source-exact/no-buffer and required-anchor refusal behavior are real and useful.
- **Unit D — accepted as reusable component work.** A distinct whole-position fixed-R target primitive exists.
- **Unit A / Unit E — NOT CLOSED FOR THE sVkm SOURCE_FAITHFUL MONEY PATH.** Their focused tests prove local behavior, but current production wiring still contains stale anchor mapping and Trading Forge overlay leakage that would change the source strategy.
- **STEP 2 / STEP 4 / STEP 5 / STEP 6 — OPEN.** No source-faithful backtest is authorized.

This is not a regression in project status. It is the exact purpose of external review: the local primitives are mostly right; the remaining work is making the real production path use them without silently changing the teacher’s strategy.

---

## 2. STEP 1 — ACCEPTED

I independently inspected `64420de6`.

### 2.1 Correct object separation

`FVGZone` remains unchanged and still represents the **gap band**. The new `displacement_extreme(zone, high, low, direction)` derives the displacement candle from the already-governed identity:

```text
zone.start_idx = candle 3
source displacement candle = start_idx - 1
LONG  -> low[start_idx - 1]
SHORT -> high[start_idx - 1]
```

That is the minimum correct implementation. No FVG dataclass redesign was needed.

### 2.2 Correct refusal guard

`start_idx < 1` raises rather than wrapping to `-1`. This prevents a plausible-looking stop from being silently read from the last bar of the dataset.

### 2.3 Correct stop-resolver separation

`compute_structural_stop()` now has a distinct `fvg_displacement` required anchor, separate from legacy `fvg`. That preserves generic `fvg_low` / `fvg_high` gap semantics and prevents the teacher-specific repair from corrupting the ontology.

### 2.4 Component-green limitation remains

This does **not** prove the actual sVkm trade path. The function accepts a zone supplied by a caller; the money path still has to prove that the supplied zone is the exact FVG that qualified the entry.

**STEP 1 verdict: ACCEPTED / CLOSED AT COMPONENT LEVEL.**

---

## 3. STEP 3 — TRANSCRIPT SWEEP ACCEPTED; TARGETED VISUAL EXCEPTION NOW ACTIVE

AR-1065 reports a complete case-insensitive sweep of the named transcript artifact, hash `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`, and records only two stop-placement instructions:

- the short example says “bottom of the fair value candle” and explicitly says include the wick / not only the body;
- the long example says the low of the fair value gap, including the wick.

The worker reports no general mirror/opposite/reverse/vice-versa authority and no later correction of the short wording. That result is consistent with the exact transcript excerpts already in the campaign record.

Therefore:

### 3.1 Long side

**TEXT_SUFFICIENT** for this risk question:

```text
qualifying FVG
-> displacement candle
-> wick-inclusive LOW
-> fixed 2R
```

### 3.2 Short side

**TEXT_AMBIGUOUS_VISUAL_UNCHECKED.**

Do **not** infer `HIGH` merely because a valid short stop normally sits above entry. That would be engineering common sense substituting for source authority.

### 3.3 Visual authorization

AR-1064’s one bounded exception now fires. Authorize exactly one source question against the short worked example:

> **When the teacher gives the short example and describes the stop at the “bottom of the fair value candle,” where is the displayed/drawn stop relative to entry and to the displacement candle: at the wick-inclusive HIGH/above entry, at the LOW/below entry, or is the chart itself non-discriminatory?**

Rules:

- targeted clip/window only;
- preserve source-media identity, transcript hash/span, frame timestamps/hashes, question, observations and outcome;
- vision reports observable facts, not “what a trader should do”;
- if chart and transcript conflict, emit `SOURCE_CONFLICT`;
- if chart does not discriminate, keep short refused;
- **do not build broad Visual Intelligence V0 here.** This is the already-authorized one-off evidence check.

The long-side money-path engineering may continue while this bounded evidence check is performed.

---

## 4. MATERIAL CORRECTION #1 — UNIT A IS STALE RELATIVE TO STEP 1

The current TypeScript source-risk contract already lists:

```text
displacement_candle_low
displacement_candle_high
```

as valid extractor anchors. Good.

But `ANCHOR_TO_RESOLVER` still omits them and its comment says the Python resolver has no implementation for them. That statement became stale at `64420de6`: Python now **does** implement `required_anchor="fvg_displacement"`.

Worse, the old mapping still says:

```text
fvg_low  -> fvg
fvg_high -> fvg
```

which is correct for generic gap-boundary semantics but is **not** the sVkm taught stop.

Therefore Unit A cannot be called closed for sVkm until the production artifact carries the distinct displacement-candle semantic and maps it to `fvg_displacement`.

### Required repair

Do **not** globally remap `fvg_low -> fvg_displacement`.

The source evidence for sVkm must graduate to the already-declared canonical anchor:

```text
LONG source stop -> displacement_candle_low
SHORT source stop -> displacement_candle_high ONLY if source authority resolves the short side
```

Then:

```text
displacement_candle_low/high -> required_anchor="fvg_displacement"
```

Preserve the exact transcript quote/span that justifies that canonicalization. The old LLM rationale at span `{0,0}` remains diagnostic-only and may not be promoted.

If the current staging record still says `fvg_low`, do not mutate the meaning of `fvg_low` to save the record. Correct the derived/canonical source-risk artifact using Tier-A evidence, or re-emit the extraction/canonicalization with the existing displacement-candle vocabulary. The original extractor record may remain immutable as historical evidence.

---

## 5. MATERIAL CORRECTION #2 — STEP 2 DOES NOT CURRENTLY HAVE A “QUALIFYING ZONE IDENTITY” TO MERELY TRANSPORT

AR-1067 says the qualifying zone identity “exists” at `_h_fvg` / `_eval_fvg` and only needs to be carried forward. That is too strong.

I independently inspected the production evaluator.

Current `_eval_fvg()` does:

```text
result = compute_fvg_signal(...)
return result.any_active
```

`FVGResult` contains `zones`, but `_eval_fvg()` discards the zone identities and returns only a boolean array. `_h_fvg()` caches only that boolean array.

More importantly, `any_active` means **any still-active historical bullish OR bearish FVG can satisfy the condition**. That is not the sVkm source rule.

The governing blueprint requires:

```text
opening range locks
-> candle CLOSES outside ORH/ORL
-> matching-direction 3-candle FVG exists OUTSIDE that SAME side
-> third candle completes
-> enter from that third-candle event
```

So STEP 2 is not “find an active FVG and transport it.” It is:

### Required STEP 2 semantic

For each candidate entry event, identify the **newly completed FVG whose third candle is the current qualifying candle**, and prove:

1. `zone.start_idx == current qualifying third-candle index`;
2. its direction matches the breakout side;
3. the breakout was a close outside ORH/ORL, not merely a wick breach;
4. the FVG is outside the same opening-range side required by the source;
5. the FVG occurs in the governed post-breakout causal sequence, not as an old active gap from earlier in the session;
6. the exact zone identity is captured and carried forward to stop construction;
7. the stop uses `displacement_extreme()` on **that same zone**;
8. no nearest-FVG re-scan occurs at stop time.

A compact identity such as the governed tuple below is sufficient; do not invent a new detector:

```text
(direction, start_idx, lower, upper)
```

or an equivalent immutable/source-traceable key already supported by the engine.

### Required negative controls

- old active FVG present, no new post-breakout FVG -> NO ENTRY;
- bullish breakout + bearish FVG -> NO ENTRY;
- FVG inside OR -> NO ENTRY;
- only first two FVG candles exist -> NO ENTRY;
- two candidate historical FVGs + one newly qualifying FVG -> stop must bind to the newly qualifying one;
- mutate only the qualifying displacement wick -> executable stop moves;
- mutate an unrelated FVG wick -> executable stop does not move.

**Do not add a second FVG detector. Reuse `compute_fvg_signal()` / `FVGResult.zones`; fix the identity handoff.**

---

## 6. MATERIAL CORRECTION #3 — EMA SLOPE MAY NOT CHOOSE sVkm DIRECTION

The production `_eval_fvg()` comment itself says directional FVG selection is out of scope and that `direction="both"` continues through the existing EMA-slope proxy.

That is forbidden for sVkm by the governing blueprint:

> choosing direction from EMA slope when the source says breakout side selects direction is forbidden.

For this source:

```text
close above ORH -> LONG candidate -> bullish FVG required
close below ORL -> SHORT candidate -> bearish FVG required
```

The breakout side is the direction authority. EMA slope is not.

The STEP 2 GREEN must contain a mutation/control where EMA slope is flipped while the source breakout/FVG sequence is held constant and the sVkm direction/entry does **not** change.

Do not globally delete EMA routing from unrelated strategies. This is a candidate/spec-owned directional command on the source-faithful path.

---

## 7. MATERIAL CORRECTION #4 — UNIT E IS ONLY “STOP PRESERVATION GREEN,” NOT SOURCE-FAITHFUL OVERLAY SEPARATION GREEN

The current Unit E tests prove one narrow fact: `framework-overlay.ts` no longer replaces a `stop_loss` stamped `ownership="source"` with ATR. That repair is correct.

But the same production overlay still:

- applies Style C exit configuration;
- injects `time_stop=15:55 ET hard flatten` when absent;
- receives `exitStyle: "static_styleC"` unconditionally from `spec-onboarding-service.ts`.

And the Python backtester has its own default:

```text
--exit-engine default = static_styleC
```

Band C passes that `exit_engine` into `run_class_backtest()`.

Therefore preserving the stop object alone is not enough. A source-taught fixed-2R strategy can still be executed through Trading Forge’s Style-C / time-stop machinery and then be mislabeled SOURCE_FAITHFUL.

### SOURCE_FAITHFUL rule

For sVkm SOURCE_FAITHFUL:

- source entry logic only;
- source breakout side decides direction;
- exact source displacement-wick stop;
- exact source whole-position 2R target;
- no Trading Forge Style-C partials/runner;
- no untaught 15:55 hard flatten;
- no Trading Forge structural buffer;
- no MES 6-point stop floor;
- no house stop ceiling suppressing a source trade during fidelity/edge research;
- no institutional confluence/eligibility overlay deleting source entries;
- no ATR fallback when a REQUIRED taught source anchor is missing.

Trading costs such as commission/slippage are execution assumptions, not source strategy rules, and may remain when clearly stamped.

If a source-faithful stop later violates deployment/prop risk policy, the deployment may be refused or the separately-labelled `TF_OVERLAY_VARIANT` may be tested. Do not rewrite the source trade and retain the SOURCE_FAITHFUL label.

### Existing eligibility overlay leak

`run_class_backtest()` is currently called from Band C with `skip_eligibility_gate=False`, and `apply_eligibility_gate()` is the Trading Forge 7-layer A+ overlay. That can filter source entries before performance is measured.

The existing environment toggle named `TF_CONFLUENCE_OVERLAY_DISABLED` proves an off-path exists, but an environment-only global switch is not a durable source-ownership contract.

**Required:** thread one narrow, explicit persisted execution/ownership mode from `compiled_spec.spec.source_risk.mode` (or an equivalent already-governed field) into the class backtest path. Reuse the existing `exit_policy` plumbing pattern where useful. Do not build a new strategy engine.

That single mode should control the source-faithful exceptions at the points that otherwise change source semantics.

---

## 8. MATERIAL CORRECTION #5 — SOURCE_EXACT STOP STILL CARRIES A HOUSE CEILING SIDE EFFECT

`compute_structural_stop(source_exact=True, required_anchor=...)` correctly removes the framework buffer, but after selecting the exact source stop it still executes the generic structural-stop ceiling check and can set:

```text
skip_trade=True
```

when the source stop distance exceeds the house ceiling.

That is appropriate for a Trading Forge risk policy. It is not faithful source-strategy research: it changes the trade population.

For SOURCE_FAITHFUL fidelity/backtest mode, the exact source stop must remain the source stop. A house-risk violation may be emitted as metadata, but it may not silently delete or tighten the source trade. Deployment/risk qualification is downstream.

Legacy and `TF_OVERLAY_VARIANT` behavior remain unchanged.

---

## 9. MATERIAL CORRECTION #6 — ENTRY TIMING MUST NOT SILENTLY BECOME NEXT-BAR CLOSE

The backtester’s production standard explicitly shifts class/DSL entry signals one bar forward and fills at the next bar’s **close**.

The sVkm source rule being certified is:

```text
third FVG candle completes
-> enter at the taught third-candle close
```

The source decision event must therefore be represented at the third-candle close. A generic N+1-close fill changes the entry price, risk distance, 2R target, and trade outcomes.

Do not globally rewrite the repository’s next-bar convention in this unit.

For this source-faithful lane, separate:

1. **source decision timing/reference price** — third-candle close, exact source semantics;
2. **execution-fill model** — the first realistically eligible price after that decision, explicitly stamped.

If bar-only data cannot support a fill at the exact close without lookahead, do not fake it. Use the first eligible subsequent price (for example the next bar open when that is the available granularity) and label it as an execution assumption. **Do not use N+1 close and call it the teacher’s taught entry price.**

STEP 6 must include an entry-timing discriminator so the existing one-bar-close delay cannot pass unnoticed.

---

## 10. AUTHORIZED NEXT ORDER — FASTEST ROBUST PATH

AR-1067 recommended `STEP 2 -> STEP 5 -> STEP 4 -> STEP 6`. The dependency insight is correct, but STEP 4 and STEP 5 should now be treated as one narrow source-faithful execution-policy crossing rather than two isolated unreachable features.

### NEXT UNIT 1 — STEP 2A: source-risk canonical handoff

Close the stale Unit-A edge:

```text
Tier-A stop quote/span
-> displacement_candle_low for resolved long side
-> required_anchor=fvg_displacement
-> persisted source_risk
```

Do not reinterpret generic `fvg_low`.

### NEXT UNIT 2 — STEP 2B: exact causal FVG identity

Reuse `FVGResult.zones`; capture the newly qualifying, same-side, post-breakout zone and carry that exact identity to the stop resolver. Eliminate EMA-slope direction selection for this source.

### NEXT UNIT 3 — STEP 5+4: one narrow SOURCE_FAITHFUL execution-policy plumbing

From persisted `compiled_spec.spec.source_risk.mode`, make the class backtest path consume:

- exact source stop command;
- exact fixed-R target command;
- source-owned direction;
- source-faithful overlay bypasses;
- no source-entry deletion by TF eligibility gate;
- no Style C / time-stop substitution;
- no house floor/ceiling mutation of source trade;
- explicit execution timing/fill semantics.

Use existing plumbing where possible. New generic risk engines remain forbidden.

### NEXT UNIT 4 — STEP 6: actual production-path RED -> GREEN

The load-bearing GREEN must cross:

```text
real sVkm source evidence
-> canonical source-risk artifact
-> SpecArtifact
-> onboarding
-> persisted compiled_spec
-> Python SpecConditionStrategy
-> governed OR state
-> exact breakout-side FVG event
-> exact qualifying zone identity
-> third-candle decision
-> exact displacement-wick stop
-> whole-position fixed 2R
-> deterministic trade record
```

A hand-built `compute_structural_stop()` or `compute_source_fixed_r_target()` test is not certification.

---

## 11. REQUIRED STEP-6 DISCRIMINATORS

At minimum:

1. ORH/ORL mutation moves breakout threshold.
2. Wick-only OR breach does not qualify where close-outside is required.
3. Breakout side selects direction; EMA slope mutation cannot flip it.
4. Matching-direction FVG required.
5. Old active FVG cannot satisfy the new post-breakout FVG event.
6. FVG inside OR cannot qualify.
7. Two candles only cannot qualify.
8. Exact newly qualifying FVG identity is preserved into stop construction.
9. Move qualifying displacement wick -> stop moves.
10. Move unrelated FVG/gap boundary -> source stop does not move.
11. Source stop has zero unstated framework buffer.
12. Required taught FVG missing -> REFUSE, not ATR.
13. MES floor mutation cannot widen SOURCE_FAITHFUL stop.
14. House ceiling mutation cannot suppress SOURCE_FAITHFUL research trade; it may only surface policy metadata.
15. Style-C / time-stop / confluence-overlay toggles cannot alter SOURCE_FAITHFUL source semantics.
16. `2R -> 3R` mutation moves exact whole-position target accordingly.
17. Position fraction remains 1.0; no thirds/runner.
18. Exact teacher quote/span survives persisted `compiled_spec` and reaches the execution trace/receipt.
19. Third-candle source decision timing is preserved; existing N+1-close convention cannot masquerade as the taught entry.
20. Repeated identical run is byte-deterministic at the governed decision/trade-record layer.
21. Existing MP1/MP2/OR/candidate authority regression fixtures remain green.

Run focused relevant regressions. Do not launch a giant canonical campaign unless a broad governed authority surface is actually changed.

---

## 12. SHORT-SIDE STATUS

The long side may be used to prove the engineering path because its source risk semantics are text-resolved.

However:

- **do not call a long-only fixture the complete educator strategy**;
- **do not fabricate the short mirror**;
- keep short fail-closed until the bounded visual question resolves it or returns unresolved/conflict.

If the visual result resolves short HIGH/above-entry with source evidence, add the direction-specific source anchor and its receipt. If not, the honest compiled artifact remains partially executable with short refused.

---

## 13. FINAL DESK POSITION

The worker’s handoff is good and the project is moving in the right direction. `64420de6` saved work by implementing the displacement candle as a derived view of an existing FVG identity instead of redesigning the detector.

But the breakthrough is not “we now have a function that can calculate the right stop.”

The breakthrough is:

> **the exact source event that caused the entry carries its own exact source stop and exact source target through the real compiler/backtester without Trading Forge choosing a different FVG, different direction, different entry timing, different exit, different stop distance, or different trade population.**

That remains the money path.

**RULING: ACCEPT AR-1067 HANDOFF WITH CORRECTIONS. STEP 1 CLOSED. STEP 3 TEXT SWEEP CLOSED. TARGETED SHORT VISUAL QUESTION AUTHORIZED. SOURCE-RISK-HANDOFF-1 REMAINS OPEN. NO sVkm SOURCE-FAITHFUL BACKTEST YET. NEXT WORKER EXECUTES THE BOUNDED ORDER IN §10.**
