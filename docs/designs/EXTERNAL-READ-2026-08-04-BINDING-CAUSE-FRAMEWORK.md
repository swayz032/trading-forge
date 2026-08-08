# EXTERNAL READ — 2026-08-04 — ACCEPT THE REFRAME / BINDING FAILURE / CAUSAL ISOLATION FRAMEWORK

> **PROVENANCE:** Arrived as **OPERATOR-RELAYED CHAT**, not on
> `origin/external-advisor/gpt-rulings` (stale at `953a907c`, 2026-08-02).
> **COMMITTED VERBATIM AND CONSUMED BY `R-722` (2026-08-08).** Body unaltered.
> **A CHANNEL IS NOT AN AUTHOR** — audited on merit in `R-722 §2–§5`: what is corroborated, the one
> word of `R-721` it overturns, and the three amendments the desk attaches.
>
> 🛑⚠️ **THIS BANNER PREVIOUSLY READ `Committed here VERBATIM under R-700 §1. Consumed by R-721.`
> BOTH CLAUSES WERE FALSE WHEN WRITTEN.** The file was never committed under `R-700 §1` — it sat
> **UNTRACKED** for four days — and `R-721` never opened it. A prior seat wrote the banner in advance,
> promised "the three amendments the desk attaches," and died before attaching any.
> ★★★★★ **`A PRE-WRITTEN PROVENANCE CLAIM IS A FORWARD-DATED LIE THAT BECOMES TRUE ONLY IF SOMEONE
> ELSE DOES THE WORK.` Corrected here rather than quietly overwritten, per the ledger preamble's rule 4.
> BINDING (`R-722 §1`): a provenance banner is written BY the consuming ruling, IN its commit, never in
> advance.**

---

GPT EXTERNAL ADVISOR RULING — ACCEPT THE REFRAME; THE SELECTED GOLDEN SLICE EXISTS, BUT ITS BINDING CHAIN IS ZERO AND CAUSE REMAINS UNPROVEN

The corrected campaign position is accepted.

RATIFIED FACTS

- The golden slice was already selected:
  `st5e-YJRfKc__s0`
  `opening_range_breakout`

- Re-selection is forbidden because it would replace the measured failure with a new candidate rather than repair the compiler.

- All 11 measured candidates fail the same practical threshold:
  - `0/99` conditions bind concretely;
  - `0/11` strategies name a supported traded market;
  - no candidate reaches executable strategy compilation.

- The blocker was not failure to select a strategy.

Approved statement:

> The selected strategy does not bind, and changing strategies cannot solve a binding system that currently produces zero executable conditions across the entire candidate set.

The previous repeated `[UNSELECTED]` framing is withdrawn.

STOP-LOSS COMPARISON REPAIR

The comparison-tool repair is accepted provisionally pending its independent grade.

The former tool behavior:

- reported a fabricated `1.8` stop;
- reported take-profit as `0`;
- ignored the values represented by the strategy.

The repaired tool must continue to fail permanently if either fabricated-value shape is restored.

This repair improves comparison fidelity. It does not repair compilation and must not be presented as evidence that any strategy binds.

GATE-3 RETIREMENT

Retiring the former "Gate 3" label is approved.

A deferred name with no written contract, entry condition, exit condition, failure witness, or measured blocking event is not an engineering gate.

Do not restore "Gate 3" merely as a familiar label.

A future gate may be created only after evidence specifies:

- the exact artifact entering it;
- the exact transformation performed;
- the exact pass/fail property;
- the permanent witness;
- what downstream work it blocks.

CURRENT BLOCKER

The operative blocker is now:

`GOLDEN-SLICE BINDING FAILURE — CAUSE UNRESOLVED`

The reported `52/43/4` blocker taxonomy remains:

`RELAYED / UNVERIFIED`

It must not be used to allocate repair work until the independent review verifies how those numbers were produced and whether the categories are mutually exclusive and exhaustive.

CAUSAL QUESTION

Three principal causes remain possible:

1. EXTRACTION FAILURE

The source lesson may contain concrete rules, but the extracted artifact may omit or flatten required information such as:

- market;
- timeframe role;
- opening-range duration;
- breakout definition;
- candle-close versus wick rule;
- direction;
- session;
- retest requirement;
- entry timing;
- invalidation;
- stop and target references;
- ordered state transitions.

In this case, the engine may be capable, but the compiler receives insufficient structured evidence.

2. CANONICALIZATION OR BINDING FAILURE

The artifact may contain the necessary meaning, but the family-term, alias, approximation, or binding layer may fail to translate it into the canonical vocabulary expected by the engine.

Examples:

- `opening range high` versus `OR high`;
- `break and close above` versus a generic breakout;
- teacher-specific terminology not mapped to a canonical primitive;
- valid concepts demoted to prose or confluence;
- required ordered conditions flattened into one instantaneous conjunction.

In this case, the extraction is usable and the engine capability may exist, but the handoff between them is broken.

3. ENGINE CAPABILITY FAILURE

The artifact and canonical meaning may both be correct, while the engine lacks the required detector or temporal model.

Examples:

- no opening-range constructor for the taught session and duration;
- no close-confirmed breakout primitive;
- no retest state;
- no stored reference to the broken range boundary;
- no state machine preserving:
  range formation → breakout → optional retest → entry;
- existing detector computes a neighboring concept instead of the taught one.

In this case, improving extraction or aliases cannot make the strategy executable.

NO CAUSAL RULING YET

The present evidence establishes the failure outcome, not its cause.

Do not conclude that the extractor is bad merely because nothing binds.

Do not conclude that the engine is missing concepts merely because the binder returns zero.

Do not conclude that aliases will solve the problem merely because terms differ.

The cause must be isolated by holding two layers constant while testing the third.

REQUIRED CAUSAL ISOLATION

Use only the ratified golden slice first.

Freeze:

- the source video and transcript;
- the current extracted artifact;
- the current sealed/candidate specification;
- the current compiler commit;
- the current concept registry and engine implementation.

For every condition in the selected strategy, produce one trace row:

1. Source evidence
   - exact timestamp;
   - teacher wording;
   - chart evidence where available.

2. Extracted representation
   - extracted condition;
   - parameters;
   - timeframe;
   - direction;
   - ordering;
   - provenance;
   - ambiguity status.

3. Canonical interpretation
   - intended canonical concept;
   - exact variant;
   - required typed fields.

4. Binding result
   - attempted primitive;
   - success or refusal;
   - exact refusal reason;
   - whether approximation was attempted.

5. Engine capability
   - matching detector exists or not;
   - detector identity;
   - required inputs;
   - whether it computes the exact taught concept;
   - whether a state machine is required.

6. Final causal classification
   - `EXTRACTION_MISSING_REQUIRED_INFORMATION`
   - `EXTRACTION_AMBIGUOUS`
   - `CANONICAL_TERM_UNRESOLVED`
   - `PARAMETER_SCHEMA_MISMATCH`
   - `TEMPORAL_MODEL_COLLAPSED`
   - `ENGINE_PRIMITIVE_MISSING`
   - `ENGINE_PRIMITIVE_WRONG_IDENTITY`
   - `MARKET_OR_TIMEFRAME_UNRESOLVED`
   - `SOURCE_ITSELF_INCOMPLETE`
   - `OTHER_MEASURED_CAUSE`

Each row must have one primary blocker and may list secondary blockers separately.

THREE DISCRIMINATING PROBES

PROBE A — EXTRACTION

Manually compare the frozen source lesson with the current extracted artifact.

Question:

> Did the extractor preserve every concrete rule needed to express the strategy?

If the source contains a required fact and the artifact does not, extraction is a confirmed blocker.

PROBE B — BINDER

Construct a test-only canonical condition object from facts demonstrably present in the source.

Feed that object directly into the real production binding layer.

Question:

> When given the correct canonical meaning, can the binder produce a real engine binding?

- If yes, the failure is upstream of binding.
- If no despite an existing matching detector, the binding/canonicalization layer is defective.

This probe may bypass extraction for diagnosis only. It must not become the production solution.

PROBE C — ENGINE

Construct the exact intended binding directly and run its production detector or state machine on deterministic candles.

Question:

> Can the engine compute the concept the lesson actually teaches?

- If yes, the engine exists and the failure lies upstream.
- If no detector exists, engine capability is missing.
- If a neighboring detector responds but computes different semantics, classify it as identity failure, not support.

CAUSE DECISION TABLE

Source artifact incomplete + canonical manual object binds + engine computes
→ extraction is the primary blocker.

Source artifact sufficient + canonical manual object binds + normal artifact does not
→ family-term/canonicalization is the primary blocker.

Canonical object cannot bind although exact engine primitive exists
→ binding-schema or registry defect.

Canonical object binds but engine cannot compute the taught sequence
→ engine primitive/state-machine defect.

Source itself does not choose a variant or omits required rules
→ source ambiguity/incompleteness; compiler must refuse.

Multiple rows may have different causes. Do not force all 99 conditions into one repository-wide explanation if the measured causes differ.

OPENING-RANGE-BREAKOUT REQUIREMENTS

The selected strategy should not compile until the source establishes, or explicitly leaves unresolved:

- market or portable market scope;
- timezone;
- session;
- opening-range start;
- opening-range duration or end;
- high/low construction;
- breakout by wick, touch, or close;
- direction;
- immediate entry or retest entry;
- entry expiration;
- invalidation;
- stop reference;
- target reference;
- whether long and short rules are symmetric;
- ordered temporal sequence.

The compiler must not select values for missing fields merely because opening-range breakout templates commonly use them.

MARKET FIELD

The fact that none of the 11 candidates names MES, MNQ, or MCL does not automatically mean the source strategies are invalid.

The review must determine whether each source is:

- explicitly market-specific;
- explicitly market-agnostic;
- implicitly demonstrated on one market;
- missing market scope entirely.

Framework market assignment may later be allowed only as a separately declared qualification overlay. It must not be represented as teacher-supplied evidence.

NEXT DECISION AFTER THE GRADE

When the independent review lands, issue one causal disposition for the selected strategy:

- `PRIMARY_BLOCKER_EXTRACTION`
- `PRIMARY_BLOCKER_BINDING`
- `PRIMARY_BLOCKER_ENGINE`
- `PRIMARY_BLOCKER_SOURCE_AMBIGUITY`
- `MULTIPLE_BLOCKERS_BY_CONDITION`
- `UNVERIFIABLE`

Then authorize the smallest repair against the measured primary blocker.

Do not begin:

- broad ICT/SMC vocabulary expansion;
- re-selection;
- corpus-wide rewriting;
- approximation loosening;
- invented default parameters;
- a new gate framework;

until the selected strategy's first failed condition has been traced across the complete chain.

CURRENT POSITION

- Stop-loss comparison defect: repaired; independent grade pending.
- Golden strategy: selected and frozen.
- Candidate compilation: `0/11`.
- Concrete condition binding: `0/99`.
- Previous Gate 3: retired as undefined.
- Causal diagnosis: independent review running.
- Worker: HOLD.
- Re-selection: forbidden.
- Next implementation: not authorized until the causal result lands.

The correct campaign question is no longer "Which strategy should we choose?"

It is:

> At which exact handoff does the already selected strategy lose executable meaning?
