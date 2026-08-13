# GPT EXTERNAL ADVISOR RULING — AR-1110 / AR-1109 TIMEFRAME DIAGNOSIS ACCEPTED WITH SOURCE-IDENTITY CORRECTION / CORRECT 1M VALUE IS NOT SEMANTIC FIDELITY / MINIMAL ROLE-PRESERVATION REPAIR AUTHORIZED / PERFORMANCE REMAINS BLOCKED

**Desk:** GPT External Advisor  
**Date:** 2026-08-13  
**Governing worker report:** AR-1109  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head re-fetched before ruling:** `1c8f554fce09b01bc1ad7e293bee73a5d505ce98`  
**GPT/report branch head re-fetched before ruling:** `c9f625a45ad5e20af31ff3496206913a37cac31c`  
**Prior GPT authority:** AR-1108

## 1. RULING

**AR-1109 is ACCEPTED as the read-only diagnosis for the sVkm timeframe-authority problem, with one material external-advisor correction and one evidence-grade limitation.**

The report correctly identifies the architectural defect: the sVkm source resolves distinct timeframe semantics, while the persisted strategy surface carries one scalar `1m` and records that value as a low-confidence backfill selected by a lowest-execution-timeframe heuristic. A numerically correct `1m` reached by a generic minimum-timeframe rule is **not** source-faithful compilation.

The next unit is therefore **NOT** a generic multi-timeframe engine. It is a small source-semantics preservation repair: preserve named timeframe roles from evidence through persistence and consume them explicitly on the SOURCE_FAITHFUL money path.

**Performance remains BLOCKED.**

---

## 2. WHAT I INDEPENDENTLY VERIFIED BEHIND THE WORKER

I did not grade AR-1109 from its prose alone.

### 2.1 No hidden engineering landed

The engineering branch still resolves to:

`1c8f554fce09b01bc1ad7e293bee73a5d505ce98`

That is the same pin AR-1109 says it inspected. The report is genuinely read-only; there is no unreported production patch to certify in this unit.

### 2.2 Existing opening-range architecture must be preserved

I independently re-inspected the current opening-range types and candidate factory. They already enforce an important rule for the *other* opening-range lesson represented by R-736/R-743:

- every taught variant is preserved;
- there is no default duration;
- `selected_duration_minutes` refuses rather than silently choosing;
- execution candidates expand one-per-taught-variant.

The sVkm fix must **not** collapse or rewrite that settled architecture.

### 2.3 Major correction: the old vertical fixture is actively mislabeled as sVkm

AR-1109 correctly says the 15m-range / 5m-execution vertical fixture belongs to a different lesson. But the repository contains a stronger defect than that wording suggests.

`src/engine/tests/test_source_vertical_join.py` currently says:

```python
SPEC_ID = "svkm-source-vertical__s0"
```

while the same fixture constructs:

```python
OpeningRangeVariant(
    variant_label="15m",
    duration_minutes=15,
    source_quote="the first 15 minute range",
)
```

and drives the strategy with:

```python
timeframe="5m"
```

Its bars are also generated in five-minute increments.

Therefore this is not merely an old test that should stop being cited for sVkm. It is **cross-source provenance contamination**: a different source lesson is stamped with an sVkm identity.

**That is a blocking defect and must be corrected before any sVkm source-faithful performance claim.**

Do not guess the other source's identity. Either:

1. prove the fixture's true source and re-home/rename/re-ID it to that source, preserving its useful component/vertical coverage; or
2. if ownership cannot be proven, convert it into an explicitly synthetic conformance fixture with no SOURCE_FAITHFUL/source-video identity claim.

It may not remain `svkm-*` while carrying the 15m/5m lesson.

---

## 3. SOURCE TIMEFRAME AUTHORITY — ACCEPTED WITH HONEST GRADES

AR-1109's source-evidence result is coherent and its transcript instrument includes positive and negative controls. The resulting authority is:

- **opening-range window:** first 09:30 five-minute candle, wick high/low included — explicit;
- **breakout confirmation:** one-minute candle closes outside that five-minute range — explicit;
- **FVG detection:** one-minute by unbroken chart/source continuity, corroborated across worked examples — source-resolved by continuity, **not** a verbatim timeframe sentence;
- **third-candle entry close:** one-minute by the same continuity, likewise not verbatim.

Hold that evidence grading. Do not upgrade Q2/Q3 to `EXPLICIT` just because they equal `1m`.

The report's live-DB reads are not directly exposed through the GitHub connector used by this desk, so I am not pretending I independently queried those three database rows. What *is* load-bearing for the next engineering unit is the report's own persisted provenance record:

```text
source = backfill_recovered_from_spec
confidence = 0.4
all stated TFs [1m, 5m]
exec = lowest execution-grade TF across roles -> 1m
```

That provenance is itself an admission that the persisted scalar is a **recovery heuristic**, not semantic role preservation. The next build must eliminate that failure mode on SOURCE_FAITHFUL artifacts and prove the role fields end to end.

---

## 4. ARCHITECTURAL RULING — RIGHT VALUE, WRONG MECHANISM

For source-faithful compilation, this is forbidden:

```text
source mentions {5m, 1m}
→ sort / choose smallest / choose "execution-grade"
→ timeframe = 1m
→ call it faithful
```

It is forbidden even when the selected number happens to be correct.

The compiler must preserve **why** each timeframe exists.

### Minimum semantic carrier

Use a narrow, versioned source-owned timeframe-role carrier. Do not build a generic multi-timeframe scheduler or framework in this unit.

At minimum, sVkm must be able to persist and recover these semantic roles independently:

```text
OPENING_RANGE_WINDOW      -> 5m
BREAKOUT_CONFIRMATION     -> 1m
FVG_DETECTION             -> 1m
ENTRY_COMPLETION          -> 1m
```

Each role must carry its own source provenance/evidence grade. For this source:

```text
OPENING_RANGE_WINDOW      = EXPLICIT
BREAKOUT_CONFIRMATION     = EXPLICIT
FVG_DETECTION             = SOURCE_RESOLVED_BY_CONTINUITY
ENTRY_COMPLETION          = SOURCE_RESOLVED_BY_CONTINUITY
```

The exact persisted field names are an implementation choice, but the semantic contract is not. A single scalar `timeframe` cannot stand in for these four facts.

A legacy convenience scalar may remain for backward compatibility **only if it is not used as source authority** and cannot overwrite or synthesize SOURCE_FAITHFUL role semantics.

---

## 5. FAIL-CLOSED RULE

On `SOURCE_FAITHFUL`:

- if a required timeframe role is absent, refuse;
- if two source facts conflict, refuse;
- if a role is ambiguous beyond its accepted evidence grade, refuse or keep that role uncertified;
- do not call the scalar-minimum/backfill heuristic;
- do not silently borrow another role's timeframe;
- do not infer all roles from `strategy.timeframe` or `trigger_tf`.

`TF_OVERLAY_VARIANT` remains a separate experimental mode and may use framework-owned behavior only under its own provenance. It may never retroactively make a source-faithful claim true.

---

## 6. REQUIRED SOURCE-IDENTITY REPAIR

Before the role-carrier proof is allowed to green, close the discovered provenance contamination.

Add a test/guard that makes this class of defect impossible to hide:

```text
fixture/spec source identity
== source evidence identity
== source condition provenance identity
```

A test carrying a source quote or typed source object from lesson A must not be allowed to stamp itself with lesson B's `SPEC_ID` and pass as lesson B's vertical proof.

Required discriminator:

1. create two distinct source identities with different timeframe facts;
2. intentionally attach source A's evidence/object to source B's spec identity;
3. the certification/source-faithful path must refuse or fail the test;
4. restoring the current permissive/mislabeled behavior must make the mutation control red.

This is not cosmetic naming work. Source identity is part of the compiler's fidelity boundary.

---

## 7. REQUIRED END-TO-END PROOF

The worker must prove the role facts survive the whole relevant chain, not merely exist in one Python object.

For the smallest money-path slice, show:

```text
Tier-A / certified source evidence
→ extraction / condition representation
→ produced spec
→ persisted strategy/artifact
→ Band C load
→ SOURCE_FAITHFUL runtime
→ deterministic event
```

At every boundary, prove the semantic role and provenance survive.

### Mandatory discriminators

**A. sVkm positive witness**

- 5m opening-range window;
- 1m breakout close;
- 1m FVG;
- 1m third-candle close entry;
- source stop/2R logic unchanged;
- no house rule substitutes for source semantics.

**B. Role-divergence discriminator**

Use an explicitly synthetic or correctly sourced fixture where timeframe roles intentionally differ. The point is to make the old scalar-minimum heuristic visibly wrong. Do **not** disguise this synthetic discriminator as sVkm evidence.

**C. Mutation 1 — restore scalar/minimum fallback**

Replacing explicit role consumption with the old scalar/minimum-timeframe path must turn the proof red.

**D. Mutation 2 — drop one role during persistence**

The SOURCE_FAITHFUL load/runtime must refuse; it may not recover the missing role from another scalar.

**E. Mutation 3 — cross-source provenance swap**

Attach another lesson's opening-range evidence to the sVkm identity; the source-identity guard must bite.

**F. Existing-source preservation**

The settled R-736/R-743 multi-variant opening-range candidate tests must remain unchanged in meaning: preserve all taught alternatives, choose none by default.

---

## 8. DO NOT BUILD THESE THINGS NOW

To preserve speed and robustness, this unit is **not** authorization for:

- a generic multi-timeframe orchestration engine;
- arbitrary resampling infrastructure unrelated to this source proof;
- a rewrite of opening-range candidate architecture;
- strategy optimization;
- walk-forward tuning;
- Monte Carlo;
- paper trading;
- Trading Forge scaling integration;
- short-side semantic guessing;
- a source-faithful performance run.

Build only enough typed role persistence + runtime consumption + provenance validation to make one real source strategy honest.

---

## 9. PERFORMANCE GATE

**NO source-faithful performance backtest yet.**

The first performance run is authorized only after:

1. the false sVkm source identity in the old fixture is removed/corrected;
2. sVkm timeframe roles survive persistence and are consumed semantically;
3. the old scalar/minimum fallback is proven unable to false-green SOURCE_FAITHFUL;
4. the cross-source provenance guard is green;
5. the changed boundary receives an independent adversarial/DISPROVE pass.

When those pass, the first honest development performance run remains:

- **sVkm long side only**;
- **fixed normalized research size** (one micro / fixed contract) so sizing cannot manufacture edge;
- report edge/fidelity metrics in normalized P&L and R;
- no Trading Forge deployment pyramid yet.

The sVkm short side remains separately refused until its stop semantics are resolved by the targeted visual-evidence question. Do not auto-mirror the long stop.

---

## 10. F-3 AND SIZING STATUS

Do not reopen already-closed work without new evidence.

- F-3 realized/open metric separation remains **CLOSED / ACCEPTED** under AR-1108.
- Band C fixed normalized sizing ingress remains **CLOSED** for research benchmarking.
- The real Trading Forge scaling doctrine remains a later capital-allocation layer, separate from edge proof.

Do not confuse the engine's default dynamic-ATR fallback with the Trading Forge scaling plan.

---

## 11. FASTEST ROBUST EXECUTION ORDER

Execute in this order:

### A. SOURCE-IDENTITY CLEANUP

Resolve `test_source_vertical_join.py`'s false `svkm-*` identity. Preserve useful tests, but stop attributing the 15m/5m lesson to sVkm. Add the cross-source provenance guard.

### B. MINIMAL TIMEFRAME-ROLE CARRIER

Add the smallest versioned carrier capable of persisting the four semantic roles and their source evidence grades. No generic MTF framework.

### C. PERSISTENCE + BAND-C CONSUMPTION

Carry those roles through the real persisted artifact and have SOURCE_FAITHFUL consume them explicitly. Remove/disable lowest-timeframe recovery as source authority on this path.

### D. DISCRIMINATORS / MUTATIONS

Run A-F from §7, including the role-divergence witness and cross-source swap.

### E. REGRESSION / ACCEPTANCE INSTRUMENT

Run the source-aware acceptance population once its versioned denominator work is in place. Do not rewrite historical denominators retroactively.

### F. INDEPENDENT DISPROVE GRADE

Attack the new boundary for role loss, scalar fallback, provenance swap, and accidental source mixing.

### G. REPORT BACK

Return the exact implementation pin, changed files, proof outputs, mutation outputs, remaining refusals, and whether the long-side performance gate can be released.

---

## 12. FINAL DISPOSITION

**AR-1109 read-only diagnosis:** ACCEPTED WITH CORRECTION.  
**Worker's source-role conclusion:** ACCEPTED at the stated grades; do not over-promote continuity evidence to explicit.  
**Worker's `1m` persisted value:** NUMERICALLY CORRECT, SEMANTICALLY UNTRUSTED while produced by lowest-timeframe recovery.  
**Cross-source fixture issue:** UPGRADED by this desk to a blocking provenance defect because the file itself stamps the other lesson as `svkm-source-vertical__s0`.  
**Generic multi-timeframe framework:** NOT AUTHORIZED.  
**Minimal role-preservation repair:** AUTHORIZED.  
**Performance backtest:** STILL BLOCKED.  
**Next worker unit:** source-identity cleanup + minimal timeframe-role preservation + E2E/mutation proof, then report for external grade.
