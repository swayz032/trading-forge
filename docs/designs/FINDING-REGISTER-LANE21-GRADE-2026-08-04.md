# FINDING REGISTER — Lane 21 independent grade @ `dd2371af`

**Opened 2026-08-04 by the ADVISOR seat (`claude.exe 22684`), ruling `R-697 §5.6`.**
**Source of findings:** `docs/designs/GRADE-LANE21-PARAMETER-TRANSMISSION-2026-08-04.md`
(disposition `PASS_WITH_BOUNDED_FINDINGS`, **VERIFIED band 7**, commits `eee02504` + `e8d90c48`).
**Tree:** campaign worktree `wt-h1-wave4-20260712` on `h1-wave4-sealed12-driver`.
🛑 **`runtime-production` is `[UNENUMERATED]` for every row below.**

> **WHY THIS FILE EXISTS.** The six findings were carried only inside a `32,189`-byte grade
> receipt and one ruling. **This campaign's most-repeated structural failure is a finding whose
> sole carrier is a document nobody re-reads.** Each row below is the disposition of record;
> the receipt remains the evidence of record.

★★★★★ **`A SERIOUS FINDING MAY BE CLASSIFIED AS BOUNDED ONLY WITH CODE-PATH EVIDENCE. A LABEL
ALONE IS INSUFFICIENT.`** Adopted from the external read of 2026-08-04, `R-697 §5.6`.

---

## THE CERTIFIED CLAIM THESE ROWS ARE MEASURED AGAINST (verbatim)

> One enforced Python evaluator path now consumes parameters supplied through
> `ConditionBinding`, and distinct off-default values produce distinct production
> calculations and decisions without cache collision.

★★★ **WHY NONE OF THE SIX RETRACTS IT, STATED ONCE SO NO ROW HAS TO REPEAT IT
`[MEASURED BY GRADED INSTRUMENT — the receipt's coverage section]`: the certifying measurement
was taken SPY-FREE on the PROXY-FALLBACK path, with `F-1`'s wired branch NOT TAKEN and
canonical parameter keys supplied, and it observed `entry_long` differing on `4/200` bars.
`F-1` and `F-2` are defects in NEIGHBOURING BRANCHES OF THE SAME FUNCTION, not in the branch
that was measured.** 🛑 **That is why both are `BLOCKS_NEXT_HANDOFF` and neither is
`BLOCKS_CURRENT_SLICE`.**

---

## REGISTER

| ID | Sev | File · construct | Existing test detects? | Can create a FALSE GREEN? | Affects certified claim? | Disposition |
|---|---|---|---|---|---|---|
| **FINDING-1** | **HIGH** | `spec_condition_compiler.py` · `_eval_wait_bias` wired-HTF branch, `:800-801` return vs `:815-816` | 🛑 **NO** | 🛑🛑 **YES — measured** | ❌ No (branch not taken) | **`BLOCKS_NEXT_HANDOFF`** → Lane 26 |
| **FINDING-2** | **HIGH** | `spec_condition_compiler.py` · `_resolve_bias_periods:582-585` | 🛑 **NO** | 🛑🛑 **YES** | ❌ No (canonical keys used) | **`BLOCKS_NEXT_HANDOFF`** → Lane 25 |
| **FINDING-2D** | **HIGH** | `spec_condition_compiler.py` · `_resolve_bias_periods` · **PARTIAL** recognition | 🛑🛑 **NO — and it defeats the OBVIOUS repair** | 🛑🛑🛑 **YES — the WORST kind: the output MOVES** | ❌ No (canonical keys used) | **`BLOCKS_NEXT_HANDOFF`** → **CLOSED by Lane 25** |
| **FINDING-3** | MEDIUM | `spec_condition_compiler.py` · warm-up floor `:818` vs its own `:811-814` | 🛑 NO | ⚠️ YES — indirectly | ❌ No | **REPAIR** — both lanes owe it |
| **FINDING-4** | MEDIUM | `spec_condition_compiler.py` · `direction="both"` legacy cache `:1388-1392` | 🛑 NO | ⚠️ YES | ❌ No (`both` not exercised) | **REPAIR** in typed-object step |
| **FINDING-5** | MEDIUM | the composite cache key · its **direction** component | 🛑 **NO — it IS the defect** | 🛑 **YES by definition** | ❌ No (correct today) | **REPAIR** — owes a RED mutation |
| **FINDING-6** | LOW | identical-period reuse · tuple ordering, unenforced | 🛑 NO — the harness masked it | ⚠️ YES | ❌ No | **BOUNDED** + canonicalize in `§4` of the object design |

---

## ROWS IN FULL

### 🛑🛑 FINDING-1 · HIGH · `BLOCKS_NEXT_HANDOFF`
**CONSTRUCT.** `[MEASURED HERE, read at the executable line]` `:800-801`
`if wired_bars == min(n, len(htf_trend)) and wired_bars > 0: return out` returns **BEFORE**
`eff_fast`/`eff_slow` are computed at `:815-816`. **On a fully-wired HTF path the taught
periods are received as arguments and never read.**
**REPRODUCTION.** Supply two `WAIT_BIAS` bindings with distinct off-default periods on a
fully-wired HTF series ⇒ `[MEASURED BY GRADED INSTRUMENT]` **arms differ `0/200`, both arrays
all-True**, while the author's *"invoked-with-the-taught-periods"* assertion passes.
**LIVE?** ✅ **YES** — `[MEASURED HERE]` `attach_htf_columns` is called by the real backtester at
`backtester.py:6736` (imported `:6735`); non-test callers = that one site plus the definition.
**FALSE GREEN.** 🛑🛑 **MEASURED, NOT INFERRED — the existing witness goes GREEN on this path.**
★★★★★ **`AN INVOCATION WITNESS IS NOT A CONSUMPTION WITNESS. THE ARGUMENT THAT ARRIVED IS NOT
THE ARGUMENT THAT WAS READ. ONLY A DIFFERING OUTPUT WITNESSES CONSUMPTION.`**
**CODE-PATH EVIDENCE FOR THE BOUNDED-TO-NEXT-HANDOFF CALL.** The certifying run did not enter
this branch (proxy fallback, `htf_trend` not fully wired). **The defect is reachable only when
a caller both wires HTF fully AND supplies periods — which is what handoff 5 will do.**
**REPAIR (Lane 26).** Consume the periods on that branch **or REFUSE**; accept-and-discard is
forbidden. **Witness must be a DIFFERING OUTPUT, spy-free, on the wired path specifically.**
⚠️ **AND THE COMMENT AT `:805` — *"THE TAUGHT PERIODS ARE CONSUMED HERE"* — SITS BELOW THIS
RETURN AND DESCRIBES ONLY THE FALLBACK.** It must be corrected in the same commit.

### 🛑🛑 FINDING-2 · HIGH · `BLOCKS_NEXT_HANDOFF`
**CONSTRUCT.** `[MEASURED HERE]` `_resolve_bias_periods:582-585` iterates **only**
`("fast_period", BIAS_EMA_FAST)` and `("slow_period", BIAS_EMA_SLOW)`, and `if key not in
params` treats **UNRECOGNISED exactly like ABSENT** ⇒ engine defaults, **no refusal, no trace.**
**REPRODUCTION.** `[MEASURED BY GRADED INSTRUMENT, three independent key shapes]`
`{'period':7}` · `{'fast':7,'slow':90}` · `{'ema_fast':7,'ema_slow':90}` **all yield `(20,50)`**
and `0/200` bars differing from the engine default.
**CONTRADICTS ITS OWN DOCSTRING VERBATIM** (`:573-578`): *"REFUSES RATHER THAN SUBSTITUTES …
it is never quietly replaced by a default. That distinction is the whole subject of the
campaign's parameter-invention repair."*
**ROOT CAUSE.** ★★★★★ **A TAXONOMY WITH NO RESIDUAL.** Its categories are
`{absent → default · present-and-usable → use · present-and-unusable → raise}`; **`PRESENT
UNDER ANOTHER NAME` HAS NO CATEGORY, SO IT MIS-FILES AS `absent`.**
🛑🛑 **`R-684 §7.2` MINTED THE MISSING CODE — `unknown_parameter_key` — AND THE ENGINE NEVER
GREW THE BRANCH.** ★★★★★ **`A BLOCK CODE IN A RULING IS NOT A BRANCH IN THE ENGINE.`**
**WHY UNBOUNDED WITHOUT A REPAIR.** **The producer end is ABSENT, so the KEY VOCABULARY IS
UNFIXED.** The first producer emitting `period` instead of `fast_period` gets engine defaults
**and a green test.** 🛑 **THIS IS WHY `F-2` GATES ANY PRODUCER.**
**REPAIR (Lane 25).** Three-way distinction — genuinely absent (documented legacy default
ONLY) · present-and-valid (reaches the real consumer unchanged) · present-but-unusable **or
unrecognised** (**HARD REFUSE, naming the key and the condition**). Code:
**`supplied_parameter_cannot_fall_back_to_default`.** **The three shapes above are now a
permanent regression corpus, plus a planted restoration of the silent default that must FAIL a
permanent test.**

### 🛑🛑🛑 FINDING-2D · HIGH · `BLOCKS_NEXT_HANDOFF` — **ADDED POST-GRADE `2026-08-04` BY `R-699 §2.2`**
🛑 **PROVENANCE, STATED BECAUSE THIS ROW WAS NOT PART OF THE LANE-21 GRADE:** discovered by the
WORKER's own red-proof while repairing `FINDING-2` (`AR-776 §2`, re-measured `AR-777 §2`), named
as a distinct shape by the external read, **entered here by `R-699 §2.2`.** ★ **It is NOT
`[MEASURED BY GRADED INSTRUMENT]` — the Lane-21 grader never saw it.**
**CONSTRUCT.** A parameter set in which **SOME** keys are recognised and some are not. The
pre-repair resolver filed each unrecognised key under ABSENT **independently, per field**, so a
partially-recognised set was honoured in part and defaulted in part.
**REPRODUCTION.** `[MEASURED, `AR-777 §2`]` `{'fast_period': 7, 'slow': 90}` →
`array_equal(produced, EMA(7, 50)) == True`. **Not `EMA(7,90)` (the taught set), not `EMA(20,50)`
(the engine set): the taught FAST honoured, the taught SLOW silently replaced by the default.**
**FALSE GREEN.** 🛑🛑🛑 **THE MOST DANGEROUS IN THIS REGISTER, AND THE REASON IS ITS DIRECTION:
the output DOES move away from the engine default, so a *"did the parameters affect the
result?"* test goes GREEN on a set that lost half its taught numbers.**
★★★★★ **`A HALF-HONOURED PARAMETER SET IS THE ONE SHAPE THAT PASSES A "DID IT MOVE?" TEST AND
STILL LOST A TAUGHT NUMBER.`**
🛑 **IT DEFEATS THE OBVIOUS REPAIR.** A key-COUNT check (`len(params) != 2 → refuse`) passes the
grader's three shapes and lets this one through. ★★★★★ **`NO KEY-COUNT TEST IS SUFFICIENT;
VALIDATION MUST IDENTIFY RECOGNISED AND UNRECOGNISED KEYS INDIVIDUALLY.`**
✅★★★★★ **THE LAW THIS MINTS, ADOPTED VERBATIM AT `R-699 §2.2`:** **`A PARAMETER SET IS NOT
FAITHFULLY TRANSMITTED MERELY BECAUSE AT LEAST ONE SUPPLIED VALUE CHANGES THE RESULT. EVERY
REQUIRED TAUGHT KEY MUST BE RECOGNISED AND CONSUMED, OR THE COMPLETE INSTRUCTION MUST REFUSE.`**
✅ **DISPOSITION: CLOSED BY LANE 25** (`AR-777`, commit `44b8fc4f`). Permanent fixture
`test_f2_partial_recognition_still_refuses` asserts the refusal names **`['slow']` only**, not
the whole set. `[MEASURED HERE, `R-699 §1`]` desk re-ran the file: **`36 passed`, exit `0`.**

### FINDING-3 · MEDIUM · REPAIR (both lanes owe it)
`[MEASURED BY GRADED INSTRUMENT]` `slow_period >= n-1` **silently returns all-False**
(reproduced at `500` and at `199` with `n=200`) — **the exact outcome `:811-814` states it
exists to avoid.** `A MOVING FLOOR REFUSES NOTHING.`
🛑 **WHY IT IS WORSE THAN IT LOOKS: all-False is INDISTINGUISHABLE FROM *"the parameter did not
transmit"*, so it FAILS IN THE DIRECTION THAT LOOKS LIKE THE HYPOTHESIS** (`R-692 §4`).
**REPAIR.** The floor must **REFUSE**, naming the condition — never return a silent all-False.

### FINDING-4 · MEDIUM · REPAIR in the typed-object step
`[MEASURED BY GRADED INSTRUMENT]` `direction="both"` gates the long/short split with
**hardcoded `EMA(20/50)`** via the legacy cache at `:1388-1392` **that the enforced path never
populates.** Not exercised by the certifying run. **Repair when the typed object's `direction`
field lands — it is the same construct.**

### FINDING-5 · MEDIUM · REPAIR — owes a RED mutation
`[MEASURED BY GRADED INSTRUMENT]` **the DIRECTION half of the composite cache key has NO PATH
TO RED:** the grader's `M11` mutation **stayed green across `26` tests and all `11` `WAIT_BIAS`
closure files (`275` tests).** **Correct today, unguarded.**
★★★★★ **`A GREEN CHECK WITH NO PATH TO RED` IS THIS CAMPAIGN'S OWN NAMED DEFECT, AND THE
GRADER FOUND ONE INSIDE OUR NEWEST GUARD.** **The repair is not to the key — it is a mutation
that makes that half go RED.**

### FINDING-6 · LOW · BOUNDED + canonicalize
`[MEASURED BY GRADED INSTRUMENT]` identical-period reuse depends on **tuple ordering nothing
enforces**, and **the harness's own `tuple(sorted(...))` supplied the canonical form production
does not.**
★★★★ **`A FIXTURE THAT SUPPLIES A CANONICAL FORM PRODUCTION DOES NOT IS TESTING A SHAPE THE
ENGINE NEVER SEES.`** **BOUNDED** — closed by `canonical(arguments)` in
`TYPED-MA-PRIMITIVE-OBJECT-2026-08-04.md §4`, which the typed object owes anyway.

---

## SCOPE LIMITS THAT TRAVEL WITH THIS REGISTER

1. 🛑🛑 **THE GRADE IS NOT A PASS ON THE TYPESCRIPT CONTRACT.** `[MEASURED BY GRADED
   INSTRUMENT — its coverage section]` **no `vitest`, no `tsc`**; the grader correctly refused
   to install into a shared tree with a live sibling. **TS numbers are static-only or
   `[RELAYED]`. `TS PARITY IS [UNENUMERATED]`** — and the only executable cross-language
   instrument was **DE-QUALIFIED** at `R-696 §3`.
2. ✅ **DEFAULT-CONFIG BLAST RADIUS IS ZERO** — `TF_FAMILY_META_ENFORCED` is default `OFF`, so
   *"enforced"* in the claim is accurate and load-bearing. 🛑 **NOT "harmless": `AN
   UNREACHABLE DEFECT IS A LOADED TRAP, NOT AN ABSENT ONE`, and that flag is what activation
   turns on.**
3. 🛑 **ACTIVATION IS PROHIBITED** until both `HIGH` repairs land, both survive mutation
   controls, the replacement in-repo parity witness detects the known mismatch, a targeted
   independent grade returns `PASS`/`PASS_WITH_BOUNDED_FINDINGS`, and the flag-ON path
   **refuses rather than defaults** (`R-697 §5.10`). **No persistence, paper, or live execution
   may consume the new path before then.**
