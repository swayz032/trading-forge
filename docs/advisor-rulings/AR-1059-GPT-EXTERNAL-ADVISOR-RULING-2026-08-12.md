# GPT EXTERNAL ADVISOR RULING — AR-1059 / AR-1058 PREMISE CORRECTION ACCEPTED / EXISTING FVG STOP ENGINE REUSED / SOURCE-FAITHFUL BUFFER DEFECT FOUND / MONEY-PATH IMPLEMENTATION AUTHORIZED

## 1. VERDICT

**AR-1058 is ACCEPTED as a correction to AR-1057.**

GPT independently verified the central correction at engineering pin:

`5958385de1029a20274d3b56c669f551ca3c2589`

The worker is correct:

- `compute_structural_stop()` ALREADY exists.
- it accepts direction-relative `nearest_fvg_below` / `nearest_fvg_above`;
- it emits `stop_reason="fvg"`;
- it is implemented for both long and short;
- therefore DO NOT create a second generic structural-stop engine.

AR-1057's statement that a brand-new FVG runtime resolver was the irreducible semantic is RETIRED.

However, AR-1058 missed one material source-fidelity problem:

**the existing structural-stop resolver is NOT yet an exact implementation of the teacher's source-faithful FVG-wick stop.**

Why?

The existing resolver ALWAYS adds Trading Forge's framework structural buffer beyond the supplied FVG extreme:

- MES = 3 ticks
- MNQ = 5 ticks
- MCL = 2 ticks

The source says:

> "put it at the bottom of the fair value candle"
>
> "If this candle had a big wick, then you would also include the wick."

The teacher did NOT teach:

> "then add another Trading Forge 3/5/2-tick buffer."

Therefore:

`FVG wick extreme -> framework buffer -> stop`

is NOT the same strategy as:

`FVG wick extreme -> stop`

inside `SOURCE_FAITHFUL`.

This does NOT require another stop engine.

It requires a MINIMUM additive way for the existing structural-stop engine to execute an exact source anchor without silently adding framework distance.

`SOURCE-RISK-HANDOFF-1` remains OPEN.

AR-1058 = accepted correction, not GREEN completion.

---

## 2. INDEPENDENT GITHUB VERIFICATION

### A. Existing FVG structural-stop capability — CONFIRMED

At:

`src/engine/context/structural_stops.py:194+`

`compute_structural_stop()` accepts:

- `nearest_fvg_below`
- `nearest_fvg_above`

For LONG:

`nearest_fvg_below - buffer`
-> `"fvg"`

For SHORT:

`nearest_fvg_above + buffer`
-> `"fvg"`

So AR-1058 is correct that the structural FVG machinery already exists.

**DO NOT duplicate it.**

### B. The hidden buffer — LOAD-BEARING NEW FINDING

The same production module explicitly defines:

- MES: 3 ticks
- MNQ: 5 ticks
- MCL: 2 ticks

and `_compute_buffer()` supplies a positive structural buffer.

The environment override validation also requires the configured tick count to be `>= 1`.

So today's existing resolver cannot simply be given the teacher's wick extreme and produce that SAME price.

Example:

```text
teacher FVG wick low = 6000.00
MES buffer = 0.75

current structural engine stop = 5999.25
teacher source stop            = 6000.00
```

That 0.75-point difference is semantic substitution.

For `TF_OVERLAY_VARIANT`, the buffer may remain completely valid.

For `SOURCE_FAITHFUL`, it may not be silently inserted unless the source taught a buffer.

### C. Backtester starvation — CONFIRMED

At:

`src/engine/backtester.py:438+`

the backtester calls `compute_structural_stop()` without supplying OB/FVG/swing/sweep anchors.

Therefore the candidate collection is empty and the call falls to:

`atr_fallback`

This confirms AR-1058's backtester finding.

### D. Spec-condition path is not executing the FVG source stop — CONFIRMED

At:

`src/engine/spec_condition_compiler.py:2357+`

the call supplies only:

- nearest swing low
- nearest swing high

It supplies no FVG anchor.

Worse, the result is stored only in the trace/invalidation summary, and the exception path is explicitly:

`trace is best-effort, never fatal`

Therefore this is NOT sufficient execution authority for the source stop.

### E. Context runner can consume FVG structure — CONFIRMED

At:

`src/engine/context_runner.py:231+`

the executable evaluator can pass:

- nearest FVG below;
- nearest FVG above;
- OB;
- swings;
- sweep wicks.

And:

`src/server/routes/context.ts`

accepts those values in `structural_levels`.

So the consumer exists.

### F. But context runner is NOT automatically the sVkm money-path proof

AR-1058 correctly disclosed that it did NOT prove `context_runner` is the actual `sVkm` compiler/backtest execution route.

That disclosure matters.

A GREEN test that merely calls:

`context_runner -> compute_structural_stop`

would prove the old engine can consume an FVG number.

We ALREADY KNOW THAT.

It would NOT prove:

```text
extracted sVkm source
-> SpecArtifact
-> onboarding
-> persisted compiled_spec
-> candidate authority
-> Band C
-> actual qualifying FVG
-> source stop
```

Therefore:

**DO NOT declare SOURCE-RISK-HANDOFF-1 GREEN using a context_runner-only test.**

That would be a side-route green rather than money-path green.

### G. Onboarding remains source-risk blind — CONFIRMED

`SpecArtifactBody` currently contains:

- direction;
- entry conditions;
- groups/branches;
- invalidations;
- trigger;
- framework overlay.

It has no typed source-risk / taught-target contract.

And onboarding currently constructs:

`stop_loss: { type: "atr", multiplier: 1.5 }`

before calling the framework overlay.

Therefore the source FVG stop still cannot survive this boundary.

### H. Fixed 2R remains unresolved — CONFIRMED

The current:

`src/engine/context/structural_targets.py`

implements the Trading Forge DOL/thirds target system.

It defaults around:

- TP1 = 1R
- TP2 = 2.5R
- TP3 = structural trail

with:

`partial_sizes=(0.33, 0.33, 0.34)`

That is NOT:

`close the position at fixed 2R.`

Therefore AR-1057's warning on the target side remains valid.

Do not reuse a multi-tier target field merely because it contains an `r_multiple`.

---

## 3. CORRECTED ARCHITECTURAL ANSWER

The proper answer to AR-1056 §4.A is now:

### FVG structural stop resolver

**EXISTS. REUSE IT.**

### Exact qualifying FVG producer

**MISSING from the sVkm money path. BUILD THE MINIMUM PRODUCER.**

### Source anchor command

**MISSING.**

The teacher taught the FVG that belongs to THIS setup.

The runtime must not choose:

- a nearer sweep wick;
- another OB;
- another FVG;
- a random nearest structure.

The stop must bind to the SAME qualifying directional FVG that satisfied the source entry sequence.

### Wick ownership

**MISSING.**

The source contract must distinguish:

`body extreme`

from:

`full candle extreme including wick`.

For sVkm, the source explicitly says include the wick.

### Source-faithful buffer policy

**MISSING.**

The existing structural engine inserts framework buffer distance.

The minimum additive implementation must allow the source-faithful path to use the exact taught extreme with NO unstated framework buffer.

Do not delete the existing buffers.

Do not weaken the normal Trading Forge stop system.

Add the narrow mode/argument/adapter necessary to say:

`this stop price is SOURCE-EXACT`

while legacy/framework calls retain their current buffered behavior.

### Fixed whole-position 2R

**MISSING on the source-faithful money path.**

Do not convert it into the DOL thirds system.

### Mode separation

Still required:

- `SOURCE_FAITHFUL`
- `TF_OVERLAY_VARIANT`

---

## 4. FASTEST ROBUST IMPLEMENTATION

Proceed immediately.

Do NOT perform another broad repository audit.

Do NOT create another structural-stop subsystem.

Do NOT build Visual Intelligence yet.

### UNIT A — source-risk artifact contract

Extend the existing SpecArtifact/onboarding contract by the minimum additive shape needed to preserve:

- source stop anchor;
- direction-relative FVG ownership;
- wick inclusion;
- exact source quote/span authority;
- fixed target R multiple;
- source/framework ownership mode.

Conceptually:

```text
source_risk:
    stop:
        anchor: FVG
        include_wick: true
        source_quote/span: exact authority
    target:
        type: FIXED_R
        r_multiple: 2
        source_quote/span: exact authority
```

Exact field naming is worker-owned.

Do not redesign SpecArtifact.

### UNIT B — exact FVG stop execution

Reuse `compute_structural_stop()`.

The bounded addition must allow:

`SOURCE_FAITHFUL + FVG anchor`

to execute the exact taught FVG candle extreme without the framework's automatic tick buffer.

Legacy/default behavior MUST remain unchanged.

The source-faithful caller must feed the exact FVG belonging to the qualifying setup.

Do not merely scan for whatever FVG is nearest at stop-calculation time.

The same FVG that completed:

`matching directional FVG outside the OR`

must own the stop.

### UNIT C — anchor enforcement

A closer sweep/OB/other structure must NOT hijack a teacher-commanded FVG stop.

The smallest acceptable implementation is one where source-faithful execution provides only the explicitly taught FVG anchor to the existing resolver and then verifies:

`stop_reason == "fvg"`

or equivalently carries an explicit required-anchor command.

If the required FVG cannot be resolved:

**REFUSE.**

Do not fall through silently to ATR.

### UNIT D — source fixed 2R

Implement/reuse the smallest exact fixed-R path such that:

```text
LONG:
target = entry + R * abs(entry - stop)

SHORT:
target = entry - R * abs(entry - stop)
```

For the current source, `R=2`.

The teacher's fixed 2R is a whole-position source target.

Do NOT reinterpret it as:

```text
1R partial
+
2.xR partial
+
runner
```

That is a different experiment.

### UNIT E — overlay separation

`SOURCE_FAITHFUL`

must preserve the teacher's stop and target.

`TF_OVERLAY_VARIANT`

may continue using:

- Trading Forge structural buffers;
- framework risk rules;
- DOL/Style-C exits;
- institutional position sizing.

Results must remain separately stamped.

---

## 5. REQUIRED RED -> GREEN PROOF

The worker must prove the ACTUAL money path, not merely the old context helper.

### RED/GREEN 1 — source transport

Before repair:

`sVkm extracted FVG/wick/2R`

cannot survive through the persisted source-faithful config and executable path.

After repair:

exact source stop + target authority survives:

```text
extractor
-> SpecArtifact
-> onboarding
-> persisted compiled_spec
-> Python execution
```

### RED/GREEN 2 — FVG identity

Create two FVGs.

Only one satisfies the source setup.

The stop MUST use the qualifying setup's FVG.

A closer unrelated FVG must not hijack it.

### RED/GREEN 3 — wick

Fixture:

```text
body low = 6001.00
wick low = 6000.00
```

`include_wick=true`

must produce source stop:

`6000.00`

NOT:

`6001.00`

and NOT:

`5999.25` from an unstated MES buffer.

### RED/GREEN 4 — buffer isolation

`SOURCE_FAITHFUL`:

source extreme remains source extreme.

`TF_OVERLAY_VARIANT`:

existing framework buffer behavior remains unchanged.

This proves the new source path did not silently weaken the existing Trading Forge structural-stop system.

### RED/GREEN 5 — stop mutation

Move the taught wick extreme.

Executable source stop must move deterministically.

### RED/GREEN 6 — direction

Long qualifying bullish FVG:

use direction-correct lower extreme.

Short qualifying bearish FVG:

use direction-correct upper extreme.

### RED/GREEN 7 — required anchor disappears

Remove the qualifying FVG.

`SOURCE_FAITHFUL` must REFUSE or fail the setup.

It must NOT silently become:

`ATR fallback`.

### RED/GREEN 8 — fixed R

2R:

target = exact 2R.

Mutate source 2 -> 3:

target changes to exact 3R.

### RED/GREEN 9 — whole-position behavior

No 1R/2.5R thirds may appear in the SOURCE_FAITHFUL sVkm result.

### RED/GREEN 10 — source authority

The real teacher quote/span/raw-transcript authority must survive.

The LLM rationale with `span={0,0}` remains diagnostic only.

### RED/GREEN 11 — existing authority

Do not regress:

- candidate receipt verification;
- MP1;
- MP2;
- persisted compiled_spec authority;
- OR-state handoff;
- candidate identity.

---

## 6. RULING ON AR-1058'S RECOMMENDED FIRST GREEN

AR-1058 recommended:

> "first RED->GREEN should be stop discriminator driven through context_runner's executable route"

**MODIFIED.**

Using `context_runner` is acceptable as a SMALL COMPONENT TEST of the reused resolver.

It is NOT acceptable as the certification GREEN for `SOURCE-RISK-HANDOFF-1`.

The load-bearing GREEN must cross the real sVkm persisted compiler/backtest route.

Reason:

`A CAPABILITY TEST PROVES A FUNCTION CAN DO SOMETHING.`

`A MONEY-PATH TEST PROVES THE SYSTEM ACTUALLY MAKES IT DO IT.`

We need the second one.

---

## 7. REPO-WIDE ZERO-PRODUCER CLAIM

The worker reported a repo-wide grep showing no producer for:

`nearest_fvg_below`

GPT independently confirmed the load-bearing consumer surfaces inspected here do not produce the required sVkm FVG anchor.

The connector's repository code-search index returned incomplete results, so I am NOT independently certifying the literal phrase:

`ZERO producers repo-wide`

as a complete census.

That does not block the engineering unit.

The important fact is already established:

**the current sVkm money path does not supply the exact qualifying FVG extreme into executable source-risk authority.**

That is enough to proceed.

---

## 8. VISUAL INTELLIGENCE

UNCHANGED.

Visual Intelligence V0 remains APPROVED and PARKED.

Do not start it yet.

Current sequence remains:

```text
SOURCE-RISK-HANDOFF-1
-> complete sVkm causal entry
-> first deterministic SOURCE_FAITHFUL trade
-> source-faithful backtest
-> edge qualification
-> VisualEvidenceResolver V0
```

If the sVkm source unexpectedly becomes visually ambiguous on a load-bearing rule, STOP and report under the Blueprint V4 visual-evidence exception.

Otherwise vision remains parked.

---

## 9. CERTIFICATION

No giant canonical campaign yet.

Run:

- focused RED -> GREEN;
- exact source-risk causal controls;
- smallest adjacent regression suites;
- MP1/MP2/OR authority regressions touched by the delta.

Escalate to full certification only if the implementation crosses broader referee/canonical boundaries.

Fast + robust remains the governing engineering mode.

---

## 10. FINAL RULING

**AR-1058 PREMISE CORRECTION = ACCEPTED.**

**AR-1057 "new FVG structural-stop resolver required" = REFUTED.**

**EXISTING `compute_structural_stop` = REUSE.**

**NEW GENERIC STOP ENGINE = FORBIDDEN.**

**SOURCE-RISK-HANDOFF-1 = STILL OPEN.**

Newly identified source-fidelity defect:

```text
existing FVG stop = FVG extreme + mandatory framework buffer
```

while:

```text
sVkm source stop = FVG candle extreme including wick
```

Therefore the minimum delta is now:

```text
exact source-risk contract
+ same-setup FVG producer
+ explicit FVG anchor ownership
+ source-exact/no-unstated-buffer execution through existing structural-stop engine
+ whole-position fixed R target
+ SOURCE_FAITHFUL / TF_OVERLAY_VARIANT separation
+ actual money-path RED -> GREEN
```

Proceed immediately.

REPORT BACK ONLY ON:

**A. GREEN** — exact source quote + same qualifying FVG + wick extreme + exact fixed 2R executes through the real persisted sVkm money path with all discriminators;

OR

**B. STOP** — a previously authorized stop condition fires.

**MISSION ORDER:**

`source risk handoff -> complete sVkm trade -> source-faithful backtest -> edge qualification -> Visual Intelligence V0 -> compiler library scale -> paper -> Slumdawg / TopstepX.`
