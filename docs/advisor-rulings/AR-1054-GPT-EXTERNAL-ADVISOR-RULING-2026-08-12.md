# GPT EXTERNAL ADVISOR RULING — AR-1054 / AR-1052 CORRECTION ACCEPTED / EXTRACTION LINK GREEN / PRODUCER BOUNDARY RED / AUTHORIZE TWO BOUNDED PRODUCER REPAIRS

## 1. VERDICT

**AR-1051 is accepted with its receipt correction.** There is no historical pre-repair certified/staging `sVkmZklJDHI` record available to hash, so AR-1050 §3.A anchors 3 and 6 could not truthfully exist before a fresh forward run. Do not fabricate historical continuity.

**AR-1052 is accepted and supersedes AR-1047/AR-1050 on the location of the current forward-path break.** For the CURRENT engineering extraction path, the source risk model is NOT lost at extraction. The measured forward record carries:

- stop anchor `fvg_low`;
- wick inclusion language;
- fixed target `type=r_multiple`, `r_multiple=2`;
- transcript quotes for both stop and target.

Therefore **do not mutate the extractor for this unit.** The first current-path break is the producer handoff.

**AR-1053 is accepted as bounded determinism evidence for this one transcript on this host/session:** two independent full two-phase extraction runs produced byte-identical record SHA256 `199d740b70b65f83ef3c4badb11af12cf405f741ef6e482701641f3ae11d1167`. Do not generalize that into a library-wide or cross-host determinism claim.

**AUTHORIZE the two measured producer-side repairs below.** Engineering branch remains the authority; the evidence copy of `spec_producer.py` on the GPT branch is not an engineering mutation.

## 2. INDEPENDENT GITHUB VERIFICATION

At engineering pin `0bbcabc81ae2ed6350bcda4d8494cff1e618dd81`:

### A. Exit-vocabulary mismatch is real

`src/engine/extraction/spec_producer.py::_untaught_exit()` currently decides that a stop/target is concrete by reading only `level` plus `gestural`.

The measured current extractor record instead speaks a stop locator as `anchor` and the fixed target as `type="r_multiple"` plus `r_multiple=2`.

Thus the producer can falsely return `_untaught_exit(...) == True` for a teacher who explicitly taught both stop and target, causing the false provenance stamp:

`framework_overlay.exit = "house-default (trader taught none)"`.

This is a source-fidelity defect, not a tuning issue.

### B. Record-level OR lowering type mismatch is real

`src/engine/opening_range_lowering.py` currently does:

`classification = record.get("instrument_classification") or {}`

followed by:

`classification.get("market_open_anchor")`.

The measured current extraction returned `instrument_classification = "futures_primary"` (string), so the producer crashes before it can mint a spec artifact.

### C. Do not overclaim stop provenance yet

The producer's generic `_condition_text()` does NOT read `transcript_quote`; it chooses `action`, `description`, `rationale`, or `stop_management`. `_entry_condition()` then stores that chosen text as `object/evidence` and only attaches a certificate span if the chosen text grounds against the certificate.

Therefore this unit may prove that the producer recognizes a taught exit and emits an `INVALIDATE`, but **do not claim the spec already transports the teacher's full structured stop/wick/2R contract or exact quote authority.** That remains the already-banked source-risk handoff immediately after this unit.

## 3. EXACT REPAIR A — `_untaught_exit` MUST SPEAK THE REAL STAGING VOCABULARY

### RED first

Using the byte-stable `sVkm` forward record:

1. assert current `_untaught_exit(strategy) == True`;
2. assert this is wrong because the same strategy carries the concrete stop anchor and concrete `2R` target;
3. preserve a fixture showing genuinely untaught/gestural exits still return True.

### GREEN implementation

Repair `_untaught_exit` through the smallest schema-aware predicate. Do NOT special-case the video id, ORB, FVG, or `2R`.

Rules:

- preserve explicit `gestural_exit` behavior;
- a stop counts as taught only when a CURRENTLY DECLARED concrete stop field is present and non-gestural;
- a target counts as taught only when a CURRENTLY DECLARED concrete target field/value is present and non-gestural;
- retain compatibility with any already-supported concrete `level` representation if tests prove it is still a valid staging form;
- for the measured current form, non-empty `anchor` is a concrete stop locator and a valid numeric `r_multiple` under the matching target type is a concrete target;
- **do not treat `type` alone, rationale text alone, or any arbitrary non-empty dict as concrete**;
- `_untaught_exit` is True iff the teacher supplied NO concrete exit under those declared forms.

Before editing, locate the current production extraction/staging schema/type definition and cite it in the worker report. If the declared schema disagrees with the measured record, STOP rather than inventing compatibility rules.

### Required controls

At minimum:

1. `sVkm` stop anchor + `2R` => `_untaught_exit == False`;
2. same fixture with concrete stop/target values removed => True;
3. explicit gestural form => True;
4. taught stop only => False;
5. taught target only => False;
6. any legitimate prior `level` representation remains behaviorally unchanged;
7. one mutation/control proves the test would fail if `anchor` or `r_multiple` support were removed.

A shared predicate changing correctly-classified current records is acceptable. A silent broad reclassification without these controls is not.

## 4. EXACT REPAIR B — OR LOWERING MUST ACCEPT NON-DICT CLASSIFICATION WITHOUT INVENTING AN ANCHOR

### RED first

Use the real forward record shape where `instrument_classification` is a string and prove the current boundary raises `AttributeError`.

### GREEN implementation

At the `opening_range_lowering` boundary:

- if `instrument_classification` is a dict, preserve the existing `market_open_anchor` read exactly;
- if it is string/None/another non-dict shape, treat it as **no structured classification anchor**;
- continue deriving any opening-range facts only from the existing strategy/variant/source spans;
- do NOT parse `"futures_primary"` into a fake clock/session anchor;
- if required OR fields remain missing, return the existing honest incomplete/refusal state rather than raising or guessing.

### Required controls

1. current string classification no longer crashes;
2. a dict classification with a real `market_open_anchor` still contributes that anchor exactly as before;
3. changing one arbitrary classification string to another does not manufacture a different market-open anchor;
4. missing source facts still produce the existing incomplete/refusal result rather than a fabricated definition.

## 5. REGENERATE ONE FORWARD `sVkm` ARTIFACT AFTER BOTH REPAIRS

After A+B are green, run the exact byte-stable extraction record through `produce_spec_artifact_from_record(...)`.

Required receipt:

1. transcript SHA256 `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`;
2. extraction record SHA256 `199d740b70b65f83ef3c4badb11af12cf405f741ef6e482701641f3ae11d1167`;
3. new engineering commit SHA;
4. producer blob after repair;
5. generated `spec_hash`;
6. second identical producer run => byte-identical artifact/spec hash;
7. `_untaught_exit` is False for this strategy;
8. artifact does NOT carry `house-default (trader taught none)` for this source;
9. taught stop still emits an `INVALIDATE` condition;
10. report the exact resulting `INVALIDATE.object/evidence/span` without overstating it as full source-risk fidelity.

Because no truthful pre-repair `spec_hash` could exist while the producer crashed, **do not fabricate a before/after hash delta requirement.** The RED evidence is the pre-fix exception plus the false `_untaught_exit` classification.

## 6. SCOPE LOCK

For this unit:

- NO extractor mutation unless a newly discovered schema contradiction forces STOP;
- NO hand-authored final spec;
- NO DB row patch;
- NO broad 40-video regeneration;
- NO FVG-direction fix yet;
- NO source-risk execution/schema redesign yet beyond what is strictly required by A+B;
- NO ATR/framework stop substitution;
- NO backtest of `sVkm` yet;
- NO edge/ranking claims;
- NO August OOS use;
- NO `main` transplant;
- NO producer-history archaeology.

## 7. BANKED NEXT UNIT — SOURCE RISK HANDOFF REMAINS IMMEDIATELY NEXT

A+B only make the forward producer consume the real extraction record and correctly recognize that the trader taught risk.

They do **not** solve the already-proven downstream risk contract gap:

`extracted stop/wick/2R -> SpecArtifact taught-risk contract -> onboarding/compiled_spec -> Python execution -> exact source stop + fixed 2R`.

That next unit must search existing production risk/exit contracts first and reuse one if compatible. No new generic risk architecture unless the current contracts cannot represent the source, in which case STOP with the minimum required schema/consumer delta.

Only after source risk is transported and executable should the causal path continue:

`OR side -> close outside -> directional FVG outside same side -> candle-3 close entry`.

## 8. STOP CONDITIONS

STOP and report if:

1. the current declared staging schema does not recognize the measured `anchor` / `r_multiple` forms;
2. making `_untaught_exit` correct requires source-specific/video-specific rules;
3. the OR lowering repair requires inventing a market-open/session anchor;
4. post-fix producer still cannot consume the byte-stable record because of another independent schema mismatch;
5. the `INVALIDATE` condition silently claims a source span/quote it cannot actually ground;
6. A+B unexpectedly require DB migration, onboarding changes, Python trading behavior changes, or broad architecture work.

If another producer mismatch appears after A+B, report the exact first new break; do not widen scope automatically.

## 9. REPORT BACK

Return one worker report after either:

**GREEN:** both bounded producer defects are RED->GREEN with sharp controls, one deterministic `sVkm` forward spec artifact is minted without the false house-default exit provenance stamp, and no new independent producer blocker appears;

or

**STOP:** one §8 condition fires with exact code/evidence.

If GREEN, GPT will close this producer-compatibility unit and move immediately into the already-banked **source risk handoff** rather than opening another audit campaign.

**MISSION ORDER:**

`deterministic sVkm extraction [GREEN] -> producer compatibility [CURRENT] -> source risk handoff -> OR/FVG/entry -> one faithful trade -> OR V1.0 -> backtest -> edge qualification -> paper -> Slumdawg/TopstepX.`
