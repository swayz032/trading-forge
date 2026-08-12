# Trading Forge — Extraction Compiler Blueprint v4

**Living update:** 2026-08-12  
**Authority:** External-advisor architecture update derived from the original June 30 v4 briefing, the sealed Opening Range/compiler work, MP1/MP2 ingress, OR-state handoff, direct transcript review, and AR-1055 producer-repair proof.  
**Mission:** finish the compiler breakthrough, produce one source-faithful deterministic strategy, backtest it honestly, qualify edge, then scale the same machinery across the strategy library and ultimately Slumdawg/TopstepX.

> This file supersedes the stale assumptions in the original June 30 v4 briefing where (a) the transcript was treated as the complete source channel and (b) stop/take-profit were always framework-owned. The validated compiler discipline remains: preserve evidence, push ambiguity upstream, keep later stages deterministic, fail closed, and never manufacture trading semantics.

---

## 0. The mission — corrected

Trading Forge is a compiler for trading strategies hidden inside multimodal teaching material.

The target is not merely to extract an educator's entry idea. The target is to preserve **100% of the source-owned executable strategy that can be grounded in the source**:

- setup / context;
- session and timing;
- symbol / market metadata;
- higher and lower timeframes;
- direction or direction-selection rule;
- ordered entry sequence;
- confluences and filters;
- invalidation;
- stop placement when the educator teaches it;
- profit target / exit rule when the educator teaches it;
- re-entry / management rules when explicitly taught;
- variants and alternatives without choosing a favorite for the teacher.

The source may teach through **speech/text, chart visuals, cursor actions, drawings, candle examples, annotations, or a combination of those channels**. A transcript-only ambiguity is therefore not automatically a source ambiguity.

### Correct ownership rule

1. **Source-owned strategy logic is preserved first.**
2. **Trading Forge framework logic is a separate overlay, never a replacement inside the fidelity-certified source artifact.**
3. If the teacher genuinely teaches no stop/target, a framework fallback may be used, but the fallback must be explicitly provenance-stamped as framework-owned.
4. If the teacher teaches stop/target, the source-faithful mode must execute the taught rule. A framework variant may also be tested separately, but it must be labeled as a different experiment.

The system therefore supports two honest research modes:

- `SOURCE_FAITHFUL`: source entry + source risk/exit when taught; explicit framework fallback only for genuinely untaught fields.
- `TF_OVERLAY_VARIANT`: same source edge hypothesis under Trading Forge risk/sizing/exit rules, clearly labeled as an overlay/ablation rather than the pure source strategy.

Never report the overlay result as the educator's exact strategy.

---

## 1. The compiler architecture — current target shape

```text
SOURCE VIDEO / SOURCE PAGE
        |
        +--> AUDIO / TRANSCRIPT ------------------------------+
        |                                                     |
        +--> CHART / VISUAL EVIDENCE (targeted when needed) --+
                                                              |
                                                              v
                                                   SOURCE EVIDENCE LAYER
                                                   - raw transcript hash
                                                   - exact quote/span
                                                   - video timestamp window
                                                   - frame/clip hashes
                                                   - visual observations
                                                   - endorsement/polarity
                                                              |
                                                              v
                                                   EXTRACTION / ENUMERATION
                                                   - strategies[]
                                                   - ordered entry_sequence
                                                   - stop
                                                   - targets
                                                   - confluences
                                                   - direction / TFs
                                                              |
                                                              v
                                                   CERTIFIED/STAGING RECORD
                                                              |
                                                              v
                                                   SPEC PRODUCER
                                                   - typed conditions
                                                   - invalidations
                                                   - source-risk contract
                                                   - exact provenance
                                                              |
                                                              v
                                                   SPEC ARTIFACT
                                                   - deterministic spec_hash
                                                   - no invented defaults
                                                              |
                                                              v
                                                   EXECUTION CANDIDATE
                                                   - candidate identity
                                                   - OR definition/variant
                                                   - parent spec anchor
                                                              |
                                                              v
                                                   SPEC ONBOARDING
                                                   - exact persisted compiled_spec
                                                   - no request-side replacement
                                                              |
                                                              v
                                                   PYTHON EXECUTION
                                                   - candidate authority first
                                                   - compiled_spec dispatch
                                                   - OR state / structural state
                                                   - source trigger / risk / exit
                                                              |
                                                              v
                                                   DETERMINISTIC TRADE
                                                              |
                                                              v
                                                   BACKTEST / OOS / WF / MC
                                                              |
                                                              v
                                                   PAPER QUALIFICATION
                                                              |
                                                              v
                                                   SLUMDAWG / TOPSTEPX
```

The breakthrough is complete only when a real source strategy travels this chain without semantic substitution.

---

## 2. Evidence authority — what is allowed to become trading logic

Trading Forge must distinguish **source authority** from **model interpretation**.

### Tier A — direct source authority

- literal transcript quote tied to raw transcript hash;
- exact transcript character span;
- exact video timestamp window;
- frozen frame/clip hashes;
- directly observable chart facts;
- explicit teacher endorsement/rejection language;
- visible teacher drawings, entry/stop/target marks, cursor references, timeframe labels, and chart examples when deterministically attributable.

### Tier B — deterministic derived structure

Allowed only when it follows mechanically from Tier-A facts:

- ordered dependency edges;
- canonical family/type assignment when the evidence uniquely supports it;
- opening-range high/low from a certified opening-range definition;
- R target computed from a taught stop and taught R multiple;
- long/short mirror when the source explicitly teaches or demonstrates the mirror.

### Tier C — model paraphrase / rationale

Diagnostic only unless separately grounded. A model-authored rationale is **not source evidence** merely because it is plausible.

AR-1055 exposed this exact rule: the producer currently emits an `INVALIDATE` whose object/evidence is an LLM rationale with `span={0,0}`, while the real verbatim stop quote remains available upstream. That must not become the final source-risk authority.

### Forbidden

- selecting one value from a teacher-given range without a range contract;
- turning a wick break into a close break without source evidence;
- choosing direction from EMA slope when the source says breakout side selects direction;
- replacing a teacher-owned stop/target with ATR/Style-C and still calling the strategy source-faithful;
- treating a rejected/bad example as an endorsed rule;
- letting visual intelligence invent a trade rule from market-looking imagery.

---

## 3. Current certified state — 2026-08-12

### Closed / proven lanes

- Opening Range definition concept: sealed and certified.
- Candidate identity / candidate receipt: closed.
- Candidate-aware onboarding persistence: closed.
- MP1 candidate ingress to Python: closed.
- MP2 `compiled_spec` ingress: closed.
- OR-state handoff: closed; Python can preserve and pass the proven OpeningRangeExecutionCandidate into Band C.
- Original golden `st5e-YJRfKc__s0`: faithfully refused because transcript evidence does not settle breakout-confirmation semantics.
- New primary source selected by independent raw-transcript review: `sVkmZklJDHI`.
- Current extractor replay for `sVkmZklJDHI`: two independent full runs produced byte-identical records.
- Producer compatibility defects found and repaired in AR-1055:
  - producer now recognizes declared staging vocabulary (`stop.anchor`, `targets[].r_multiple`) instead of requiring nonexistent `level` fields;
  - OR lowering no longer crashes when `instrument_classification` is the string emitted by the current extractor;
  - deterministic forward artifact now mints without the false `house-default (trader taught none)` stamp.

### Current engineering head

`5958385de1029a20274d3b56c669f551ca3c2589`

### Current open blocker

`SOURCE-RISK-HANDOFF-1`

The extractor correctly carries:

```text
stop.anchor = fvg_low / matching direction-relative FVG extreme
stop transcript quote = teacher's exact stop + wick language
target.type = r_multiple
target.r_multiple = 2
```

But the current spec/onboarding path still does not faithfully transport that contract:

- producer's `INVALIDATE` is currently built from an LLM rationale rather than the exact source quote;
- the taught `2R` target is not serialized into the `spec_body`;
- `SpecArtifactBody` has no taught-target/source-risk contract;
- onboarding still constructs `stop_loss: {type:"atr", multiplier:1.5}` and then applies the framework overlay;
- the framework overlay was historically designed to replace educator risk/exit rules.

Therefore no `sVkm` backtest is authorized yet.

---

## 4. Immediate money-path plan — fastest robust order

### STEP 1 — Close `SOURCE-RISK-HANDOFF-1` [NOW]

Goal:

```text
exact extracted stop/wick/2R
-> SpecArtifact source-risk contract
-> onboarding
-> compiled_spec
-> Python
-> exact executable source stop + fixed 2R
```

Engineering discipline:

1. Search existing production stop/target/exit contracts first.
2. Reuse existing engine primitives where semantics match.
3. Add only the minimum additive contract needed for semantics that do not already exist.
4. Do not redesign the whole risk engine.
5. RED before mutation; GREEN after; one sharp negative or mutation control per load-bearing field.
6. Preserve exact source quote/span authority. Do not promote the model rationale into source provenance.
7. Source-taught risk must bypass replacement by house risk in `SOURCE_FAITHFUL` mode.
8. Keep framework fallback for genuinely untaught risk and keep `TF_OVERLAY_VARIANT` as a separately labeled experiment.

Success condition:

- moving the source FVG stop anchor changes the executable stop;
- changing source `2R` changes the executable target;
- removing taught stop/target activates the explicit framework fallback rather than silently inheriting source risk;
- exact teacher quote/span survives to the persisted compiled artifact/receipt;
- no ATR/Style-C substitution occurs in source-faithful mode.

### STEP 2 — Complete the `sVkm` entry causal chain

Reuse the sealed OR machinery. Do not build a second opening-range calculator.

```text
5m 9:30 opening range locks
-> 1m candle CLOSES above ORH or below ORL
-> matching directional 3-candle FVG exists OUTSIDE that same side
-> third candle has completed
-> enter at the taught third-candle close
-> taught FVG-candle wick stop
-> fixed 2R target
```

Required discriminators:

1. Move ORH/ORL -> breakout threshold moves.
2. Wick-only breach vs close outside -> only close-outside qualifies for this source.
3. Bullish vs bearish breakout -> matching directional FVG required.
4. FVG inside OR -> no qualification.
5. Two candles only -> no entry.
6. Move third-candle close -> entry timing/price moves.
7. Move taught FVG-candle wick extreme -> stop moves.
8. Change 2R -> target moves.
9. Both long and short execute without EMA-slope choosing the side.

Success condition: one real source-faithful deterministic trade path through production evaluators.

### STEP 3 — Backtest the source-faithful strategy

Only after Step 2.

Run source-faithful backtest first. Then, if useful, run a separate Trading Forge overlay ablation. Never mix the labels.

Then proceed to:

- development backtest;
- execution/slippage assumptions;
- OOS;
- walk-forward;
- Monte Carlo / path stress;
- sensitivity;
- regime breakdown;
- prop-firm execution/risk simulation;
- concurrent paper qualification.

The compiler proves fidelity. The backtest proves or rejects edge.

---

## 5. Visual Intelligence — core source-evidence lane

### Architecture decision

Visual intelligence is **approved as a core extraction capability**, but it is not allowed to derail the current `sVkm` money path.

It is implemented as a **targeted evidence resolver**, not a whole-video autonomous strategy generator.

The transcript remains the cheap scout. Vision activates only when a load-bearing semantic cannot be settled from text alone or when chart evidence is explicitly part of the teaching.

### Why

Trading educators routinely teach with phrases such as:

- "right here";
- "this candle";
- "look at this wick";
- "break this high";
- "put the stop under this";
- "this is the fair value gap";
- "this is where I enter."

Those phrases are incomplete without the chart. A transcript-only refusal may therefore be honest about the text but premature about the source.

### New resolution states

Use explicit statuses rather than collapsing everything to `SOURCE_AMBIGUOUS`:

- `TEXT_SUFFICIENT`
- `TEXT_AMBIGUOUS_VISUAL_UNCHECKED`
- `VISUAL_EVIDENCE_REQUIRED`
- `MULTIMODAL_RESOLVED`
- `VISUAL_UNRESOLVED`
- `SOURCE_CONFLICT`
- `SOURCE_AMBIGUOUS`

`SOURCE_AMBIGUOUS` is final only after the relevant available source channels have been checked or the missing channel is unavailable.

---

## 6. Visual Intelligence V0 — fast robust implementation

Build V0 only after the first `sVkm` source-faithful trade path is green. Do not split the active worker before then.

### V0 goal

Use one previously transcript-ambiguous ORB source as the birth fixture and answer one load-bearing question:

> Does the video/chart itself deterministically resolve the breakout mechanic that the transcript leaves unclear?

### V0 components

#### 6.1 Source video acquisition

Use mature tooling, not a custom downloader:

```text
yt-dlp -> source video/audio retrieval
FFmpeg/ffprobe -> media inspection, clip cutting, frame extraction
```

Do not store full MP4 blobs in Postgres.

Initial storage:

```text
local content-addressed video cache
```

Later production storage:

```text
object storage (S3/R2/B2-class) + DB metadata pointer
```

Only retrieve/use source media where rights/permissions and platform terms allow the intended use.

#### 6.2 Source asset identity

Every cached media asset gets:

```text
video_id
source_url
source_media_sha256
duration_ms
storage_uri
retrieved_at
transcript_sha256
```

A changed source hash is a new source artifact; never silently reuse old visual conclusions.

#### 6.3 Transcript-to-video synchronization

Create a deterministic timeline mapping:

```text
transcript char span
<-> transcript words
<-> start_ms/end_ms
<-> source media hash
```

Prefer existing timed captions when available and trustworthy. If the stored transcript has no timing, align the transcript to the retrieved audio through a deterministic forced-alignment/transcription lane and preserve the alignment receipt.

Never estimate video time from character count or average speaking speed.

#### 6.4 Targeted visual window extraction

When a compiler/source-review unit emits `VISUAL_EVIDENCE_REQUIRED`, it must include:

```text
video_id
condition_id
transcript span
semantic question
```

Resolve the span to a small video window, then use FFmpeg to extract:

- a short evidence clip;
- scene/annotation-change frames;
- frames around the cited teaching moment;
- frame timestamps and SHA-256 hashes.

Do not make the vision model watch a 20-40 minute video if a 10-30 second window answers the question.

#### 6.5 Vision asks observations, not strategy decisions

Bad prompt:

> "What strategy is this and where should I enter?"

Good bounded questions:

- Did only the wick cross ORH, or did the candle close above it?
- Was an entry marker/drawing introduced before or after the close?
- Which candle did the teacher point to when saying "this candle"?
- Is the highlighted FVG entirely outside the opening range?
- Is the visible timeframe 1m, 5m, or another explicitly readable value?
- Did the teacher mark this example as wrong/rejected or as the actual setup?

Vision reports observable facts. The deterministic resolver maps those facts to a rule only if the source evidence uniquely supports it.

#### 6.6 `VisualEvidenceReceipt`

Minimum receipt:

```json
{
  "schema": "VISUAL_EVIDENCE_RECEIPT/1",
  "video_id": "...",
  "source_media_sha256": "...",
  "condition_id": "...",
  "transcript_sha256": "...",
  "transcript_span": {"start": 0, "end": 0},
  "video_window_ms": {"start": 0, "end": 0},
  "frame_hashes": ["..."],
  "question": "...",
  "observations": ["..."],
  "resolution_status": "MULTIMODAL_RESOLVED|VISUAL_UNRESOLVED|SOURCE_CONFLICT",
  "resolved_semantic": null
}
```

The receipt must be immutable/content-addressed once used to certify a strategy.

#### 6.7 Conflict rule

If transcript and visual evidence disagree, do not vote, average, or let the model choose.

Emit:

```text
SOURCE_CONFLICT
```

and preserve both authorities for review.

---

## 7. Visual Intelligence birth test

Use the original transcript-ambiguous ORB source, not `sVkm`, because `sVkm` does not need vision to finish the current breakthrough.

### RED

Transcript evidence alone cannot prove whether the taught breakout is:

- wick breach;
- body/close breach;
- threshold breach;
- retest-conditioned breach.

Status:

```text
TEXT_AMBIGUOUS_VISUAL_UNCHECKED
```

### Visual pass

Retrieve the exact teaching window and ask only the unresolved breakout question.

### GREEN only if discriminatory

A successful fixture must show a source-visible contrast such as:

```text
wick breaches ORH -> teacher does not identify entry
later candle closes above ORH -> teacher identifies/marks the valid trigger
```

Then the semantic may graduate to a source-backed close rule.

If the video does not discriminate, stay refused. Visual intelligence must increase evidence, not optimism.

---

## 8. Visual Intelligence V1/V2 ceiling — later, not current blocker

After V0 proves value:

### V1 — selective library rescue

Run the visual resolver only on strategies currently blocked by load-bearing text gaps:

- deictic references ("this candle", "right here");
- unclear breakout mechanic;
- stop-candle identity;
- entry-marker timing;
- bad-example vs endorsed-example polarity;
- chart-only timeframe/level references.

Measure:

```text
# text-refused
# visual-required
# multimodal-resolved
# visual-unresolved
# source-conflict
```

Do not judge success by how many strategies are rescued. Judge it by whether each rescue has hard evidence.

### V2 — richer chart intelligence

Only after V1 proves ROI:

- chart-region detection;
- cursor tracking;
- drawing/line/box change detection;
- candle/time-axis alignment;
- visible timeframe/symbol recognition;
- entry/SL/TP annotation association;
- multi-example consistency checks across the video.

Do not attempt full pixel-to-OHLC reconstruction unless a measured compiler blocker genuinely requires it.

---

## 9. Storage and persistence policy

### Full video

- local/object storage, not relational DB blobs;
- content-addressed by source hash;
- cache may be temporary for non-certification cases;
- preserve enough source/evidence for any rule that becomes certification authority, subject to rights/retention policy.

### Database / durable metadata

The DB should store small structured identity/provenance fields, for example:

```text
video_id
source_url
source_media_sha256
storage_uri
duration_ms
transcript_sha256
alignment_receipt_id
visual_analysis_status
```

Visual evidence receipts can be stored as structured JSON/document artifacts with immutable hashes and referenced by the source condition.

### Condition-level join

The critical key is not merely `video_id`. The visual receipt must join to the **same `source_condition_id` / source evidence claim** that the compiler uses.

```text
source strategy
-> source condition
-> transcript span
-> video time window
-> visual evidence receipt
-> canonical semantic
-> compiled condition
```

No orphan visual interpretation may affect execution.

---

## 10. Fast/robust engineering doctrine

### Fast means

- repair the first measured broken handoff;
- reuse existing primitives/contracts;
- activate expensive vision only on unresolved load-bearing conditions;
- keep one golden strategy moving end-to-end;
- test one real discriminating fixture instead of building generalized frameworks prematurely;
- defer library-wide cleanup until it gates V1.1 scale.

### Robust means

- RED -> GREEN;
- sharp negative/mutation controls;
- immutable hashes/receipts;
- no guessed trading semantics;
- no house defaults masquerading as source rules;
- no model paraphrase masquerading as source evidence;
- no request-side replacement of DB/candidate authority;
- deterministic refusal is a correct compiler output;
- source conflict stays visible.

### Reject as too slow

- whole-library re-extraction before one faithful strategy trades;
- full-video computer vision over every source;
- broad speaker-attribution architecture for one source;
- generic ontology/platform rewrites without a measured blocker;
- historical-producer archaeology that does not move the golden path;
- new graders/checkers that only inspect other graders/checkers.

### Reject as too reckless

- hand-editing persisted strategy JSON to force a green;
- choosing one value from source ranges without range semantics;
- accepting `any_active` FVG when source direction matters;
- EMA-slope proxy for source breakout direction;
- framework stop/target replacing a taught source rule;
- visually inferred rule with no timestamp/frame evidence;
- source/visual disagreement silently resolved by confidence score.

---

## 11. Compiler v1.0 and v1.1 definitions

### Compiler v1.0 breakthrough

One real source strategy must travel:

```text
raw source
-> grounded extraction
-> deterministic produced spec
-> exact candidate/compiled_spec ingress
-> faithful runtime semantics
-> at least one deterministic trade
-> reproducible backtest
```

For a source that teaches stop/target, v1.0 fidelity includes those rules.

### Compiler v1.1 scale

The full library must deterministically produce one of:

```text
FAITHFUL_COMPILE
TEXT_AMBIGUOUS_VISUAL_REQUIRED
MULTIMODAL_RESOLVED_COMPILE
SOURCE_CONFLICT_REFUSAL
SOURCE_AMBIGUOUS_REFUSAL
UNSUPPORTED_CAPABILITY_REFUSAL
```

before library-wide edge ranking is trusted.

V1.1 also includes cleanup of known batch-scale defects such as evidence serialization corruption, population/census reconciliation where denominator-sensitive reporting requires it, and reusable polarity handling.

---

## 12. Current execution order — operator map

```text
[GREEN] raw sVkm transcript
[GREEN] deterministic current extraction
[GREEN] producer staging-vocabulary compatibility
[NOW]   source stop/wick/2R handoff
[NEXT]  OR side -> close outside -> directional FVG -> candle-3 entry
[NEXT]  one source-faithful deterministic trade
[NEXT]  source-faithful backtest
[NEXT]  OOS / WF / MC / execution / prop simulation
[NEXT]  paper qualification

THEN PARALLEL EXTRACTION CEILING:
        VisualEvidenceResolver V0
        -> one transcript-ambiguous ORB birth fixture
        -> selective visual rescue across blocked library rows

THEN SCALE:
        compiler v1.1 across library
        -> rank strategies by real evidence-backed performance
        -> candidate trial identity / HTF authority
        -> paper survivors
        -> Slumdawg / TopstepX
```

Do not reorder the visual project ahead of the first faithful `sVkm` trade unless a new source-fidelity STOP proves vision is required for `sVkm` itself.

---

## 13. North-star invariant

> **Trading Forge may add intelligence around a teacher's strategy, but it may never silently rewrite what the teacher taught and then call the result faithful.**

Text, chart, cursor, and annotation are all possible evidence channels. The compiler's job is to conserve grounded meaning across those channels into deterministic execution. The backtest's job is to determine whether that conserved strategy has edge.
