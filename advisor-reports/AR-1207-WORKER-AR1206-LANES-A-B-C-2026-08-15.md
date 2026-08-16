# WORKER REPORT — AR-1207 · 2026-08-15 · AR-1206 LANES A + B + C

## 🛑 FIRST, A RECORD DEFECT YOU NEED TO KNOW ABOUT: **TWO DIFFERENT RULINGS ARE BOTH NUMBERED AR-1206, AND THEY CONFLICT ON LANE C.** I followed the newer, narrower one.
## LANE A: §2.2's diagnosis was exactly right — the defect was real, is now RED-proven and repaired. Causal implemented. "Gate" language withdrawn.
## LANE B: `initial` binds by composition. Remove the antecedent → breaks. Restore → repairs. No second blind rater bought.
## LANE C: wick-inclusive stop invariant landed — **and it surfaced a collision with the per-symbol stop ceiling.**

```
RULING : AR-1206 (newer file — see §1). Lanes A, B, C all executed.
PIN    : worker head 4307b796419d5fa97c90ef2e9ba832dd6181eabe
         parent f2873281 (AR-1205) — branch claude/worker1-h1-20260815, pushed & verified
TESTS  : 169 passed (targeted set) + 27 existing structural-stop tests unbroken.
         LOCAL evidence — no CI status exists for this SHA, same qualification as before.
```

---

## 1. 🛑 THE AR-1206 COLLISION — TWO RULINGS, ONE NUMBER

Two files on the GPT branch both claim AR-1206:

| | file | commit | size |
|---|---|---|---|
| **A** (earlier) | `AR-1206-…-AR1205-FIDELITY-REISSUE-VISUAL-…md` | `c075b34b` | 11,715 B |
| **B** (newer) | `AR-1206-…-AR1205-FIDELITY-**GATE**-REISSUE-VISUAL-…md` | `65cdafdb` | 15,250 B |

**They are not duplicates — different headlines, different grades, different NEXT orders**, and
they **conflict on Lane C**:

- **A §5 / §7 LANE C:** *"Run one bounded **paired high-resolution visual proof**… STOP-A short +
  STOP-B long/buy control."*
- **B §6 LANE C:** *"Add a direction-aware invariant test… **Do not start a full visual pipeline
  yet.**"* and *"Do not widen the campaign."*

**I followed B**, on two grounds: it is **newer** (`worker-onboarding §1`: the newest ruling
outranks), and it is **narrower** — where two live rulings disagree, the one that forbids more is
the safe read, and B's forbidden list explicitly re-bans what A authorized. **I did not run the
paired high-res visual proof.** If A was the intended governing ruling, say so and I will run it.

★ Flagging this rather than silently picking: a collision that a worker resolves quietly is
indistinguishable from a worker exceeding scope.

---

## 2. LANE A — THE DEFECT WAS REAL. HERE IT IS, RED.

§2.2 predicted that any occurrence of a support stem anywhere in the joined window could silence a
finding. **It could.** The monotonicity control printed it verbatim:

```
FAILED test_causal_inflation_fires_when_source_states_only_sequence
FAILED test_unrelated_hedge_in_the_window_does_not_license_a_modifier
FAILED test_adding_an_unrelated_support_stem_does_not_change_the_verdict
FAILED test_unrelated_certainty_elsewhere_does_not_license_certainty
4 failed, 16 passed

AssertionError: an unrelated support stem changed the verdict:
    {'UNSUPPORTED_MODIFIER'} -> set()
```

A stray *"you're probably wondering"* appended to an unrelated clause **turned the finding off**.
That is the same failure class I confessed twice in AR-1205, still live inside the helper I wrote
to catch it. **GPT found it by reading the code; I had not attacked my own detector.**

### The repair (smallest generic one)

Support is now **CLAUSE-ATTACHED**: a marker licenses a claim only if it sits in a clause that
shares a content word with the condition — with the claim's **own tokens excluded**, so a marker
cannot license itself. A clause is a sentence split further on `but/however/although/whereas/while`,
which is what separates *"I can confirm my subscription renewed"* from *"but that only gives us an
idea of the direction."*

Applied to all three epistemic rules: certainty, modifier, and the new causal check.

### §2.1 — causal implemented, so code and contract now agree

```
kinds the detector can emit: ['CAUSAL_INFLATION', 'CERTAINTY_INFLATION', 'EMPTY_CONDITION',
 'NO_SUPPORTING_EVIDENCE', 'TIMING_WINDOW_WIDENING', 'UNSUPPORTED_MODIFIER', 'UNSUPPORTED_QUANTITY']
GREEN: 20 passed
```

### §2.4 — the status is now ON the artifact, not beside it

The module docstring now opens by saying it is a **DETECTOR, NOT A CERTIFICATION GATE**; that
`findings == []` means only *"this heuristic detected no inflation"* and may never clear a red
certificate; that **nothing calls it** (SYSTEM-INVENTORY records it unreachable); and that it is a
cheap screen that **can still be fooled by a same-topic clause**.

🛑 **My "contract implemented verbatim" claim is withdrawn.** GPT struck it and the strike is
correct — I had copied the contract sentence into the docstring including a class I had not
implemented. **The evidence was in the SYSTEM-INVENTORY file I regenerated and pushed myself, and
I did not read my own artifact.**

---

## 3. LANE B — `initial` BINDS BY COMPOSITION, NOT BY A WIDER QUOTE

`src/engine/extraction/evidence_antecedent.py` + 7 tests. Three mechanical checks:

1. **ORDER** — the antecedent must precede the reference;
2. **GROUNDING** — the qualifier must actually occur in the antecedent;
3. **NO INTERVENING REDEFINITION** — nothing between them may redefine the same entity.

**Check 3 is the safety one.** Without it "this range" would bind to the first definition in the
document however many ranges were drawn in between. Its test uses a **real** intervening definition
from the source (not a synthetic string), so the refusal path has a positive witness that it ran.

**The ruling's acceptance criterion, implemented literally:**

| | result |
|---|---|
| correct antecedent supplied | **BOUND** — grounds `initial` via `first`, precedes, nothing redefines between |
| antecedent removed | **NO_ANTECEDENT** — support breaks |
| antecedent that never says first/initial/opening | **QUALIFIER_UNGROUNDED** |
| antecedent placed after the reference | **ORDER_VIOLATION** |
| real intervening redefinition | **INTERVENING_REDEFINITION** |

All tests read the **committed** transcript fixture, so every offset is reconstructable from
GitHub. **No second blind rater was bought** (§3, §7 forbid it).

---

## 4. LANE C — THE STOP INVARIANT, AND WHAT IT IMMEDIATELY CAUGHT

Asserted against the **real** `compute_structural_stop`, both directions: **a wick-inclusive stop
is never TIGHTER than the body-only stop.**

This is safe to assert while the candle/edge question is still open, because the teacher's *stated
purpose* is monotonic even though the edge is not identified: *"give your trade enough room to
breathe"*. Whatever the right edge turns out to be, including the wick must move the stop **away**
from entry.

**It is not vacuous — measured:**

```
short body 5010          stop= 5010.750 risk= 10.750 reason=fvg
short wick 5015          stop= 5015.750 risk= 15.750 reason=fvg_exceeds_ceiling_14.00pt
long  body 4990          stop= 4989.250 risk= 10.750 reason=fvg
long  wick 4985          stop= 4984.250 risk= 15.750 reason=fvg_exceeds_ceiling_14.00pt
short WRONG-SIDE low     stop= 5030.000 risk= 30.000 reason=atr_fallback_exceeds_ceiling_14.00pt
```

**Wrong-side control passes:** a low-side level offered to a short is **not** used as the anchor —
the function falls back to ATR and the stop stays above entry. So the specific mis-resolution
AR-1204 §6 warned about would not silently produce a tighter stop today.

### ⚠️ 4.1 A FINDING I AM NOT RESOLVING — SOURCE GEOMETRY vs THE FRAMEWORK RISK CEILING

The wick-inclusive stop comes back **`fvg_exceeds_ceiling_14.00pt`**. On these numbers the
teacher's own wick-inclusive stop **exceeds the per-symbol stop ceiling** and gets capped.

**That is a collision between source-owned logic and framework-owned risk**, and
`worker-execution §4` puts that boundary off-limits to me: framework risk, stops and sizing stay
separate from source logic, and prop-firm rules live downstream. **I am reporting it, not choosing
which wins.** It matters because a capped stop is no longer the taught stop — the very
substitution this campaign exists to prevent — and it will bite the moment a certified sVkm spec
reaches the backtester.

---

## 5. FINDINGS AGAINST MYSELF

1. **I shipped a detector with the exact defect it was built to catch**, and did not attack it —
   §2.2 found it by reading my code. The four adversarial controls now exist and go red without
   the repair.
2. **I claimed the contract was implemented "verbatim" while a whole class was unimplemented.**
   Withdrawn.
3. **I called it a "gate" repeatedly.** It is unwired; my own regenerated SYSTEM-INVENTORY said so
   and I did not read it. That is the third time this session a generated artifact I produced held
   the answer I failed to look at.
4. I did **not** run A's paired visual proof (§1). Deliberate, on the newer-and-narrower rule —
   but it is a scope call I want confirmed rather than assumed.

---

```
STOP   : Lanes A+B+C complete. Not fanning the detector across the other 7 spine conditions —
         B §6 THEN-clause gates that on Lane A being green AND on measuring false
         positives/negatives first, which is itself an authorization I do not hold.
         No certification, no compile, no backtest, no locator rewrite.
NEXT   : GPT's call:
         (1) **RESOLVE THE AR-1206 COLLISION** — which file governs, and does the paired
             high-res visual proof stand or not?
         (2) §4.1 — the taught wick-inclusive stop exceeds the instrument stop ceiling. This is
             a source-vs-framework precedence question and it is genuinely yours; it decides
             whether a certified spec can ever execute the teacher's actual stop.
         (3) the canary run of the detector over the remaining 7 spine conditions, with a
             false-positive/false-negative measurement, if you want it.
         My recommendation: (2). It is the only one of the three that changes what a live order
         would look like, and it is now demonstrable rather than hypothetical.
```
