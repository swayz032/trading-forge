# GPT EXTERNAL ADVISOR RULING — AR-1056 / AR-1055 GREEN ACCEPTED / PRODUCER COMPATIBILITY CLOSED / SOURCE-RISK-HANDOFF-1 AUTHORIZED

## 1. VERDICT

**AR-1055 is ACCEPTED.**

The engineering branch proof is coherent with the pushed diff at `c8154b929074a452271cc163cd51589f4d28a550`, followed only by the required `SYSTEM-INVENTORY` regeneration at `5958385de1029a20274d3b56c669f551ca3c2589`.

`PRODUCER-STAGING-VOCABULARY-1 = CLOSED`.

The current `sVkmZklJDHI` forward path now proves:

- the real current extractor preserves the taught stop anchor, wick language, and fixed `2R` target;
- two independent extractor runs over the committed transcript produced the same full record hash;
- `_untaught_exit()` now recognizes the declared current staging vocabulary rather than asking only for an undeclared `level` key;
- non-dict `instrument_classification` no longer crashes Opening Range lowering or manufactures a session anchor;
- the current producer mints a deterministic artifact and no longer stamps `house-default (trader taught none)` on this teacher.

The worker correctly did **not** overclaim the resulting risk fidelity. The emitted `INVALIDATE` still carries model-authored rationale with `span={0,0}`, while the exact source quote remains unused, and fixed `2R` is still absent from `spec_body`.

## 2. INDEPENDENT GITHUB VERIFICATION

At engineering head `5958385de1029a20274d3b56c669f551ca3c2589`:

1. `src/agents/kb/transcript-extractor-minimal-schema.json` declares `stop.anchor` and `targets[].r_multiple`; it does not declare `level` as the current stop/target value contract.
2. `c8154b92` changes `_untaught_exit()` to recognize the declared anchor/R-multiple vocabulary and guards the string `instrument_classification` case without inventing an opening time.
3. The delta from `0bbcabc8` to `5958385d` is bounded to:
   - `src/engine/extraction/spec_producer.py`;
   - `src/engine/opening_range_lowering.py`;
   - `src/engine/tests/test_producer_staging_vocabulary.py`;
   - regenerated `docs/designs/SYSTEM-INVENTORY.md`.
4. `src/server/services/spec-onboarding-service.ts` still has no taught-risk/source-target field in `SpecArtifactBody`; it constructs `stop_loss: {type:"atr", multiplier:1.5}` before applying the framework overlay.
5. `src/server/services/framework-overlay.ts` still documents and implements the historical policy that source risk/exit is replaced by Trading Forge risk/exit. That policy cannot remain authoritative inside a **source-faithful** compile whenever the teacher explicitly taught risk.

Therefore the next broken handoff is settled:

`correct extracted source risk -> source-faithful SpecArtifact/onboarding/runtime risk`.

## 3. BLUEPRINT CORRECTION — GOVERNING FROM THIS RULING FORWARD

I committed the updated architecture as:

`docs/designs/TRADING-FORGE-EXTRACTION-COMPILER-BLUEPRINT-v4-2026-08-12.md`

on the GPT branch at commit `0398b79abba54dd56fc656e5b75a08f52a0e8c2e`.

The governing ownership rule is now:

- compiler fidelity preserves **all source-owned executable logic**, including stop/target when taught;
- framework defaults apply only to genuinely untaught risk fields;
- Trading Forge's institutional risk/exit remains available as a separately labeled `TF_OVERLAY_VARIANT`, not as a silent replacement inside `SOURCE_FAITHFUL`;
- visual/chart evidence is approved as a targeted core evidence lane, but it does not interrupt the current `sVkm` money path.

The original June 30 v4 assumptions that the transcript is the complete source and that stop/TP are always framework-owned are superseded.

## 4. NEXT EXECUTION UNIT — `SOURCE-RISK-HANDOFF-1`

Proceed immediately on the engineering branch. No additional advisor round-trip is required before mutation unless a STOP condition below fires.

### A. Bounded existing-contract search first

Before editing, inspect only the load-bearing production risk/exit contracts needed to answer:

> Can the existing engine represent `direction-relative FVG extreme including wick` as the initial stop and `2R` as a fixed target without inventing a new generic risk architecture?

Relevant surfaces include the current SpecArtifact contract/producer, onboarding, framework overlay, Python config/schema, backtester, and existing exit/stop handlers.

Do **not** launch a repository-wide risk-system audit.

### B. Contract rule

If an existing production contract already expresses the exact semantics, reuse it.

If no existing contract can express one required semantic, add the **minimum additive field/shape** necessary to transport that source-owned rule from staging to runtime.

Do not redesign position sizing, DLL, prop-firm controls, paper execution, or the whole exit engine.

### C. Exact source-risk authority

The source-faithful contract for this golden source must carry, without paraphrase replacing authority:

- exact teacher stop quote/span authority;
- direction-relative FVG stop anchor;
- wick inclusion as taught;
- fixed `2R` target;
- enough identity to make the stop's referenced FVG/candle deterministic when execution reaches that step.

A model rationale may remain as diagnostics but may not become the source authority.

### D. Mode separation

The implementation must distinguish:

1. `SOURCE_FAITHFUL`
   - teacher-taught stop/target execute when present;
   - framework fallback only for truly untaught fields, provenance-stamped.

2. `TF_OVERLAY_VARIANT`
   - Trading Forge risk/sizing/exit may replace source risk for a separately labeled ablation/research run;
   - results may not be described as the exact source strategy.

Do not silently make all existing strategies source-risk-driven. Preserve legacy behavior unless an explicit source-faithful contract is present.

## 5. REQUIRED RED -> GREEN PROOF

The unit is not closed by schema presence alone. Required evidence:

1. **Quote authority RED/GREEN**
   - pre-repair produced/persisted risk uses rationale or loses quote/span;
   - post-repair exact source quote/span (or exact raw-transcript authority receipt) survives into the source-risk contract.

2. **Stop transport RED/GREEN**
   - pre-repair source FVG stop cannot reach executable runtime;
   - post-repair it does.

3. **Target transport RED/GREEN**
   - pre-repair fixed `2R` is absent from `spec_body`/runtime;
   - post-repair it reaches the executable target calculation.

4. **Stop discriminator**
   - move/change the taught FVG extreme -> executable stop moves accordingly.

5. **Wick discriminator**
   - alter/remove wick inclusion in the bounded source fixture -> stop semantics change or refuse accordingly; no silent body-only assumption.

6. **R discriminator**
   - mutate explicit `2R` to another valid R multiple -> executable target changes deterministically.

7. **Fallback discriminator**
   - remove taught stop/target -> source-faithful path uses explicit framework fallback with provenance, not stale source values.

8. **Overlay separation**
   - same source fixture under `SOURCE_FAITHFUL` and `TF_OVERLAY_VARIANT` yields separately stamped risk ownership; no label collision.

9. **No regression of MP1/MP2/OR authority**
   - candidate receipt validation still precedes Band-C execution;
   - persisted `compiled_spec` remains DB authority;
   - OR candidate/state transport remains intact.

## 6. CERTIFICATION CALL

**Do not run the expensive full canonical certification campaign for this unit unless the change unexpectedly touches canonical referee authority or a blocking CI gate makes it necessary.**

Reason: AR-1055 already measured the identical focused regression selection before/after the narrow producer repair, and the known canonical-population drift is separately banked. The highest-value proof now is a sharp causal source-risk RED->GREEN through the real path.

Run focused suites plus the smallest adjacent regression set required by the actual files touched. If scope expands materially, report that expansion and I will decide whether full certification becomes mandatory.

## 7. VISUAL INTELLIGENCE — APPROVED, ORDERED, NOT ACTIVE YET

The updated Blueprint v4 approves `VisualEvidenceResolver V0` as a core source-evidence lane because a YouTube trading source may teach load-bearing semantics visually that are absent from the transcript.

Architecture:

`yt-dlp source acquisition -> local/object media cache -> FFmpeg/ffprobe targeted clips/frames -> transcript/time alignment -> immutable VisualEvidenceReceipt -> same source_condition_id -> multimodal resolver`.

But **do not start this build before the first source-faithful `sVkm` trade path is green** unless a new `sVkm` STOP proves visual evidence is itself required.

V0 birth fixture after `sVkm`:

- one previously transcript-ambiguous ORB;
- one unresolved breakout semantic;
- targeted video window only;
- vision reports observations, not trade decisions;
- GREEN only if video evidence discriminates the missing rule;
- transcript/visual disagreement -> `SOURCE_CONFLICT`, never confidence-voting.

## 8. STOP CONDITIONS

STOP/report instead of broadening scope if:

1. the engine has no way to identify the exact FVG/candle whose extremity owns the source stop without a broad new state architecture;
2. exact wick inclusion cannot be represented without changing unrelated structural-stop/live-risk systems;
3. fixed R targets require a broad P&L/exit-engine rewrite rather than a bounded contract/consumer addition;
4. the source quote/span cannot be carried without relying on corrupted evidence text rather than raw transcript authority;
5. preserving source risk requires changing candidate identity, MP1/MP2 authority, DB schema across the entire strategy library, paper/live order execution, or prop-firm risk enforcement;
6. source-faithful and overlay modes cannot be separated without silent behavior changes to existing strategies;
7. a new source ambiguity appears that requires chart/video evidence for `sVkm` itself.

A normal RED or a small additive contract is not a STOP.

## 9. REPORT BACK

Return after either:

**A. GREEN:** exact `sVkm` stop/wick/2R travels from the deterministic extracted record into a source-faithful executable runtime contract with required discriminators and explicit overlay separation; or

**B. STOP:** one §8 condition fires with exact code/evidence.

If GREEN, proceed next to:

`OR side -> 1m close outside -> matching directional FVG outside same side -> completed candle 3 -> entry -> source stop -> 2R -> first deterministic source-faithful trade`.

**MISSION ORDER:**

`source risk handoff -> complete sVkm trade -> source-faithful backtest -> edge qualification -> VisualEvidenceResolver V0 -> compiler v1.1 library scale -> paper -> Slumdawg/TopstepX.`
