# GPT EXTERNAL ADVISOR RULING — AR-1063 SOURCE-RISK ANCHOR CORRECTION, DIRECTION AUTHORITY, AND MONEY-PATH FORK

**DATE:** 2026-08-12  
**REPO:** `swayz032/trading-forge`  
**REPORT REVIEWED:** `AR-1063-WORKER-FVG-LOW-IS-THE-WRONG-PRICE-2026-08-12.md`  
**GOVERNING ARCHITECTURE:** `docs/designs/TRADING-FORGE-EXTRACTION-COMPILER-BLUEPRINT-v4-2026-08-12.md`  
**VERDICT:** **AR-1063 DIAGNOSIS ACCEPTED. UNIT A SEMANTIC CORRECTION REQUIRED. AR-1060 FORK RESOLVED. SOURCE-FAITHFUL BACKTEST REMAINS BLOCKED.**

---

## 1. EXTERNAL VERIFICATION

I independently checked the current connected GitHub state before ruling.

### 1.1 AR-1063 is genuinely on the GPT branch

The GPT branch head at review is:

`af3369041985aa87661e0eec755055f7fc28af0c`

Its commit message records the worker correction that `fvg_low` is the wrong price and that the relevant source wording is wick-inclusive candle language.

### 1.2 The committed production FVG detector supports the worker's central diagnosis

`src/engine/indicators/fvg_native.py` defines:

- bullish gap = `high[i-2] < low[i]`
- bearish gap = `high[i] < low[i-2]`
- `FVGZone.lower/upper` = the **gap band boundaries**
- the middle candle `i-1` = the **displacement candle**
- `FVGZone.start_idx = i` = candle 3, where the FVG is confirmed

Therefore a source instruction meaning **"the displacement/fair-value candle's wick-inclusive extreme"** is NOT the same semantic object as the existing gap boundary.

**That part of AR-1063 is correct.**

### 1.3 Transcript evidence matters and is authoritative here

The worker report preserves the source passages that say, in substance:

- stop at the bottom of the fair-value candle;
- include the wick, not merely the body;
- the fair-value candle is the second big candle;
- entry occurs on closure of candle 3;
- the long worked example again says low / including the wick.

That is enough to reject silent execution at the existing gap-band price.

The correct semantic distinction is:

`FVG GAP BAND != DISPLACEMENT CANDLE EXTREME`

### 1.4 The implementation GREEN claims are NOT yet externally ratified

The named engineering branch `h1-wave4-sealed12-driver` still resolves on connected GitHub to:

`5958385de1029a20274d3b56c669f551ca3c2589`

The worker reports name later engineering commits such as `d894f2e3`, `d5b9f029`, `93dfa18e`, and `0b1533ff`, but those changes are not exposed through that branch ref during this review; at least `93dfa18e` was not fetchable directly through the connected GitHub commit API.

Therefore:

**I accept the semantic findings reported by AR-1060 through AR-1063 only where independently corroborated, but I do NOT externally certify Units A-E as code-complete until the actual engineering commits are pushed/reachable and inspectable. A report is not a substitute for the code.**

---

## 2. RULING ON `fvg_low`

### DECISION: DO NOT REDEFINE `fvg_low`

`fvg_low` already has a legitimate generic meaning: the lower boundary of an imbalance/FVG band.

Changing that global vocabulary to mean "middle candle wick" would repair one teacher by corrupting the generic ontology.

**Forbidden:** silently changing `fvg_low` semantics globally.

### REQUIRED MINIMUM ADDITIVE SEMANTIC

Mint a distinct source-risk anchor meaning the **displacement candle extreme belonging to the qualifying FVG**.

Preferred conceptual form:

`fvg_displacement_extreme`

with direction resolved at execution:

- LONG -> `low[qualifying_fvg.start_idx - 1]`
- SHORT -> `high[qualifying_fvg.start_idx - 1]` **only when source authority permits the mirrored short semantic**

The exact public field name is implementation-owned; the semantic contract is not.

### IMPORTANT SPEED/ROBUSTNESS CORRECTION

AR-1063 suggests adding candle indices to the frozen `FVGZone` dataclass. That is **not required merely to reach candle 2**.

The committed detector already guarantees:

`start_idx = candle 3`

Therefore:

`displacement_idx = start_idx - 1`

is deterministic Tier-B derived structure from the existing FVG identity.

**Do not redesign or widen the FVG dataclass unless another measured need appears.** Reuse the existing `start_idx` and raw OHLC arrays. This is the faster and lower-risk path.

---

## 3. SAME-SETUP IDENTITY IS NON-NEGOTIABLE

The source-faithful stop must come from the displacement candle of the **same FVG that qualified the entry**, not:

- nearest FVG below/above;
- newest FVG;
- closest structural level;
- sweep/OB/swing substitute;
- generic `fvg_low` lookup.

The producer/runtime handoff must preserve enough identity to recover the exact qualifying FVG's `start_idx`.

### REQUIRED DISCRIMINATORS

The corrected RED -> GREEN must prove all of these:

1. Move the qualifying displacement candle wick while holding the gap boundary fixed -> executable stop moves.
2. Move the gap boundary while holding the displacement wick fixed -> executable stop does **not** move.
3. Introduce a nearer unrelated FVG -> it cannot hijack the commanded stop.
4. Change the qualifying FVG identity -> stop follows that FVG's displacement candle.
5. Wick-inclusive means full candle `low`/`high`, not body edge.
6. Wrong-side stop candidate -> fail closed, never invert or silently replace.
7. Change source R from 2R -> target changes exactly.
8. Remove taught source risk -> explicit framework fallback activates and is provenance-stamped framework-owned.

---

## 4. RULING ON THE SHORT-DIRECTION CONTRADICTION

The transcript evidence currently presented contains a real contradiction:

- the worked setup is SHORT / downside;
- the teacher says stop at the "bottom" / low of the candle;
- a valid protective stop for a short normally sits above entry.

### DECISION: DO NOT SILENTLY MIRROR FROM TRADING COMMON SENSE

Blueprint V4 forbids inventing a source rule merely because the intended trading logic seems obvious.

The compiler may mechanically mirror only when the source itself authorizes/demonstrates the mirror strongly enough to make it deterministic.

### REQUIRED NEXT EVIDENCE STEP — TRANSCRIPT FIRST

Before any visual work, perform a deterministic full-transcript search over the complete `sVkmZklJDHI` source for every relevant stop/direction phrase, including at minimum:

`stop`, `stop loss`, `short`, `sell`, `downside`, `high`, `top`, `above`, `low`, `bottom`, `below`, `wick`, `fair value candle`, `fair value gap`, `risk`, `2R`.

Publish:

- transcript artifact/hash identity;
- all matching source spans, not only the two worked excerpts;
- whether any general rule explicitly authorizes long/short mirroring;
- whether the short wording is contradicted or corrected elsewhere.

### IF TRANSCRIPT RESOLVES IT

Use the direct source rule and keep Visual Intelligence parked.

### IF TRANSCRIPT DOES NOT RESOLVE IT

Then this is exactly the Blueprint V4 exception that permits a **targeted visual evidence question on the active sVkm golden source**.

Do NOT launch broad Visual Intelligence V0.

Ask one bounded question only, tied to the same source condition:

> In the teacher's SHORT worked example, is the displayed stop placed above entry at the displacement candle's wick-inclusive HIGH, or below entry at the LOW?

Return an immutable targeted evidence receipt. If the chart cannot settle it, status is `SOURCE_AMBIGUOUS` / `VISUAL_UNRESOLVED` and the short path must refuse.

### NO PARTIAL FIDELITY CLAIM

An isolated long-side fixture may be used for engineering tests, but **do not run or report a source-faithful strategy backtest as the educator's complete strategy while the taught short semantics remain unresolved.**

---

## 5. AR-1060 §3 FORK — RESOLVED NOW

The worker asked whether `SOURCE_FAITHFUL` may bypass:

1. `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` defaulting FALSE; and
2. the MES 6-point minimum stop floor.

### RULING: YES — FOR SOURCE-FAITHFUL RESEARCH EXECUTION ONLY

Blueprint V4 is explicit: when the teacher teaches the stop, `SOURCE_FAITHFUL` executes the teacher's stop. Trading Forge may test a separate house-risk variant, but it may not silently widen or replace the source stop and still call the result source-faithful.

Therefore:

**`SOURCE_FAITHFUL` must not have its taught stop replaced by the structural parity feature flag or by the MES house stop floor.**

This authorization is deliberately narrow.

### REQUIRED MODE SEPARATION

- `SOURCE_FAITHFUL`: execute exact taught structural stop and taught fixed-R target.
- `TF_OVERLAY_VARIANT`: preserve the current Trading Forge overlay/floor/house behavior.
- legacy/non-source-owned paths: unchanged unless separately authorized.

### IMPORTANT SAFETY SEPARATION

Bypassing the house stop floor for **fidelity backtesting** does NOT authorize unsafe live deployment.

If a later paper/live/prop-firm safety policy rejects a source stop as operationally unacceptable, the system must:

`REFUSE / REJECT DEPLOYMENT`

not:

`WIDEN THE STOP AND CALL IT SOURCE_FAITHFUL`.

Compiler fidelity and deployment risk approval are separate gates.

### REQUIRED FORK TESTS

1. Same SOURCE_FAITHFUL candidate produces the exact same taught stop with parity flag ON vs OFF.
2. Same SOURCE_FAITHFUL candidate is not widened by MES floor.
3. TF_OVERLAY_VARIANT retains legacy flag/floor behavior.
4. A downstream deployment-risk test may reject the source-faithful candidate without changing its historical source-faithful backtest semantics.

This closes the AR-1060 architectural fork.

---

## 6. STATUS OF UNITS A-E

### UNIT A — CORRECTION REQUIRED

The transport shape may be useful, but mapping source `fvg_low` to generic FVG structure is semantically wrong for sVkm. Replace only the wrong anchor semantic with the displacement-candle-extreme concept and preserve exact source quote/span/hash authority.

### UNIT B — CONCEPT ACCEPTED, CODE NOT YET EXTERNALLY RATIFIED

Exact source stop with no invented buffer remains the right design.

### UNIT C — CONCEPT ACCEPTED, CODE NOT YET EXTERNALLY RATIFIED

The wrong-side fail-closed guard is exactly the correct safety behavior. It is a guard, not semantic authority.

### UNIT D — CONCEPT ACCEPTED, CODE NOT YET EXTERNALLY RATIFIED

Whole-position fixed-R must remain distinct from the Style-C partial ladder.

### UNIT E — CONCEPT ACCEPTED, CODE NOT YET EXTERNALLY RATIFIED

Source-owned risk must bypass silent overlay replacement in SOURCE_FAITHFUL; shape alone must not claim source ownership.

---

## 7. NEXT AUTHORIZED FAST/ROBUST ENGINEERING ORDER

### STEP 0 — MAKE THE ENGINEERING COMMITS EXTERNALLY INSPECTABLE

Push/update the engineering branch so the claimed Units A-E commits are reachable from connected GitHub. Do not ask the external advisor to certify code that exists only in a worker report/local worktree.

### STEP 1 — REPAIR THE ANCHOR SEMANTIC ONLY

Use the existing qualifying FVG identity and:

`displacement_idx = start_idx - 1`

Do not redesign the detector or generic risk engine.

### STEP 2 — BUILD THE MINIMUM SAME-FVG PRODUCER

Preserve exact FVG identity from the qualifying setup into the source-risk resolver. No nearest-structure substitution.

### STEP 3 — COMPLETE THE TRANSCRIPT DIRECTION SWEEP

Resolve short-side semantics from Tier-A source text if possible.

If unresolved, activate only the one targeted sVkm visual question described above.

### STEP 4 — IMPLEMENT THE NARROW SOURCE-FAITHFUL FLAG/FLOOR BYPASS

Do not change TF_OVERLAY_VARIANT or legacy behavior.

### STEP 5 — CROSS THE ACTUAL MONEY PATH

`source transcript/evidence -> extracted source risk -> SpecArtifact -> onboarding -> persisted compiled_spec -> Python -> exact qualifying FVG displacement wick -> exact taught stop -> fixed 2R`

### STEP 6 — RUN THE REQUIRED END-TO-END RED/GREEN + MUTATION SET

The previously missing gates remain mandatory:

- end-to-end risk transport;
- same-setup FVG identity;
- quote/span/hash authority end-to-end;
- MP1/MP2/OR non-regression;
- anchor/wick/R/fallback/mode discriminators;
- short-direction refusal/resolution proof.

Only after that may `SOURCE-RISK-HANDOFF-1` close.

---

## 8. BACKTEST AUTHORIZATION

**NO sVkm source-faithful backtest yet.**

The blocker is no longer "can the engine represent structural risk?" The blocker is now precise:

1. wrong FVG semantic anchor must be corrected;
2. exact qualifying FVG identity must reach runtime;
3. short-direction source contradiction must be resolved or fail closed;
4. source-faithful parity-flag/MES-floor substitution must be bypassed;
5. actual engineering commits must be externally inspectable;
6. end-to-end source quote/span/hash and executable price must be proven.

After those are green, authorize the first deterministic source-faithful sVkm trade, then source-faithful backtest, then separate TF overlay ablation.

---

## 9. FINAL DESK RULING

**AR-1063 is a GOOD STOP and is ACCEPTED as a semantic correction.** The worker caught the wrong price before the money path executed it.

The fastest robust repair is **not** a new FVG architecture. The existing detector already gives the identity needed to derive candle 2 as `start_idx - 1`.

**Do not redefine `fvg_low`. Mint/preserve a displacement-candle-extreme source anchor.**

**Do not invent the short mirror. Search the full transcript first; if it still conflicts, use one targeted visual evidence query or refuse the short path.**

**AR-1060 fork is CLOSED: SOURCE_FAITHFUL bypasses house stop replacement/floor during fidelity research; deployment safety may reject later but may not rewrite the strategy.**

**Visual Intelligence remains globally PARKED except for the single targeted sVkm direction question if Tier-A transcript evidence cannot settle it.**

**NEXT UNIT: expose engineering commits -> anchor semantic repair + same-FVG producer -> full transcript direction sweep -> narrow SOURCE_FAITHFUL flag/floor bypass -> end-to-end money-path RED/GREEN.**
