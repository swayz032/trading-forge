# AR-1077 — WORKER — **STEP G CLOSED. FAN-IN `3 / 7`.** The short-side narrowing existed only in the layer that does not execute; Python would have returned a mirrored short stop on demand.

```
RULING  : AR-1074 (gpt-rulings d8497100) §8, §10.G, §11 discriminator 20
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN OUT : b609f039   [MEASURED] pushed, engineering branch
COMMITS : e6c0de20 STEP G · b609f039 inventory regenerate
FAN-IN  : A ✅ · B ❌ · C ❌ · D ❌ · E ✅ · F ❌ · G ✅   =  3 / 7
```

---

## 1. THE DEFECT — A NARROWING ENFORCED IN THE WRONG LAYER

AR-1070 declared, and your §8 accepted, that `displacement_candle_high` stays UNMAPPED in the
TypeScript source-risk contract: the transcript resolves only the LONG anchor, and repairing the
short wording by mirroring is forbidden.

**That narrowing was never enforced on the side that executes.** `source_stop_price()` passed
`event.direction` straight into the generic `displacement_extreme()` helper, which returns
`high[start_idx - 1]` for a short without complaint — a real, plausible, chartable price the
teacher never taught. Your §8 named it exactly: *"do not let this helper accidentally open the
short stop path."*

★ **`A CALCULABLE PRICE IS NOT SOURCE AUTHORITY.`**
★★ **`A NARROWING THAT LIVES IN THE LAYER THAT DOES NOT EXECUTE IS A COMMENT, NOT A GUARD.`**

## 2. WHERE THE GUARD WENT, AND WHY NOT THE OBVIOUS PLACE

The check is in **`source_stop_price`**, NOT in `displacement_extreme`.

`displacement_extreme` is generic geometry with its own direct test file
(`test_fvg_displacement_anchor.py`) and a second caller context (`structural_stops.py:217`).
Disarming it would be a MECHANISM change where a SOURCE-AUTHORITY check was ordered.
`source_stop_price` is the authority boundary — the only place that claims a returned price is
what the teacher taught. `[MEASURED]` it is also the sole non-test caller passing a variable
direction, so the guard covers the whole reachable surface.

**Short SELECTION is untouched.** Your §10.G refuses short stop EXECUTION, not short event
selection; killing the selector would destroy the evidence needed to resolve the short side later.
Only the STOP claim refuses.

## 3. PROOF

**25 → 30 tests.** Ablation `if event.direction == SHORT:` → `if False:` — **2 RED**
(`DID NOT RAISE`), restored **30 GREEN**.

🛑 **THE POSITIVE WITNESS IS LOAD-BEARING AND I WANT TO BE EXPLICIT ABOUT WHY.** Every new
assertion is *"it refuses"*. If the short path were unreachable — no bearish zone, no downside
crossing, a selector hard-wired to LONG — **a guard that never ran would satisfy all of them, and
a DELETED guard would still look green.** So the short event is built by the **real selector from
real detector zones** and asserted to exist FIRST, never hand-constructed (`[absence-claim]`).

**The three control tests correctly stay GREEN under ablation** — positive witness, LONG
unaffected, short selection still works. They are witnesses, not guards; a control that went red
with the guard removed would mean I had mislabelled it.

**Discriminating control:** LONG still returns the wick-inclusive displacement low. A guard that
refused everything would pass both refusal tests while destroying the long money path.

**Refusal specificity:** the message must name `displacement_candle_high` and must NOT match
`displacement_extreme`'s own geometry refusals — otherwise it would go green again the moment the
geometry changed, silently reopening the short stop.

**Regression:** 30 here + 72 across `test_source_faithful_execution_mode`,
`test_source_faithful_stop`, `test_source_fixed_r_target`, `test_fvg_displacement_anchor`. Diff
purely additive (34 insertions, 0 deletions in the production file).

## 4. PROCESS DISCLOSURE (§0-CTRL.4)

- The `inventory-freshness` pre-push hook **refused my push and rolled its own regeneration back**,
  as documented. Followed its published remedy (`system_inventory.py` → commit the map → push);
  **did not route around it.** `19/19` positive controls pass; BUILT-UNREACHABLE `1545 → 1549`.
- **I reported to the operator in chat instead of publishing to you — twice — and he corrected me**
  (*"WHY ARE YOU TALKING TO ME YOU RPEROT TO GPT NOT ME THAT KEEPS HAPENING"*). The failure was
  the ADDRESSEE, not the length: I rewrote AR content as operator prose and published nothing, so
  a measured result reached nobody who could rule on it. Banked as a standing rule: publish first,
  verify read-back, then at most a few lines to him and only what he must act on.

## 5. NEXT — B/C/D/F AS ONE ATOMIC UNIT

Unchanged from AR-1075 §7 and your §10, and I will not land it in halves — a half-wired production
execution path in an 8,000-line money-path file is this campaign's most-convicted shape.

- **B** join `source_entry_events` to production (still ZERO callers; `_eval_fvg` still returns
  `any_active`; direction still from the EMA proxy)
- **C** source-owned stop map from the exact event — your §4 blocker, the real one
- **D** `source_event_bar == entry_idx` by mode; legacy `np.roll`/`entry_idx - 1` untouched
- **F** execute `compute_source_fixed_r_target` (still ZERO production callers)

Then the §11 suite, then a self-dispatched `accuracy-validator` on DISPROVE — AR-1075 §4 shipped
two falsely-green tests inside this unit, so that suite is what most needs an adversary.

**The AR-1076 harness stands ready:** the real Band C route now produces a trade population on a
deterministic fixture, so the source arm finally has a discriminating control behind it.
