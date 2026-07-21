# RATIFY PACKET — Population-A flip step (`approximation=False` for two kinds)

**STATUS: STAGED.** Engine-instrument class. Authorization: **R-143 §3** (main sequence, item 1).
Pre-live; the sealed 77 untouched. Independent grade is the gate.

**★ THIS IS THE FIRST `approximation=False` OF THE ENTIRE CAMPAIGN.** Every prior delivery
deliberately withheld it. The flip is the fidelity claim itself — not a routing change.

---

## 1. What & why now — the earned preconditions

Flip `approximation` from `True` to `False` for **two** Population-A kinds only:

- **`named_sr_level` (4 conditions)** — preconditions **both met**: upstream
  `detect_buyside/sellside_liquidity` fixed and **graded Band 8** (`7e3247ca`), and its
  **per-kind causal-safety test passed** (0/160 value, 0/28 activation, plants fired on both
  axes, non-NaN-verified). Block discharged at **R-136**.
- **`order_block_edge` (2 conditions)** — its detectors probed **CLEAN** under fired
  plant-catches (`detect_bullish_ob` 0/42, `detect_bearish_ob` 0/47, two production
  alignments; AR-117), and `order_flow.py` carried no defect in the 19/19 sweep.

**`swing` is EXCLUDED and stays `approximation=True`, disposition UNVERIFIED-BY-SAMPLE**
(R-102 §2): **n=1**, so the two-different-levels discrimination check is **unrunnable inside
the kind.** It routes; it does not claim. **De-approximation floor is n≥2.**

## 2. Blast radius

**This changes a FIDELITY NUMBER.** Flipping 6 of 78 structure-family bindings from
approximated to exact moves the corpus binding-approximation rate — **the metric the whole
campaign is measured on.**

- **DUAL DENOMINATORS ride** (124 with-narration / **111 primary**), per R-093 §3. **Both
  numbers travel; the with-narration figure is never deleted.**
- **The honest floor artifact** (`wire1-dod-HONEST-FLOOR.json`, 0.9938 → 0.9793) is
  **append-only** — a new measure is ADDED, the old is never overwritten.
- **The ceiling travels:** at most **6 of 16** level/zone rows de-approximate; **9 remain
  UNRESOLVABLE-AS-BUILT** (bare anaphora) and **1 is `swing`, routed-but-approximate.**

**NOT touched:** `swing`'s flag · the other five concepts · the anaphora rows · `detect_sweep` ·
the six archetypes · promotion gates · fill/P&L/sizing · tier-a.

## 3. The exact change, scope-locked

**IN:** `approximation=False` for `named_sr_level` and `order_block_edge` bindings only, plus
the re-measure that follows from it.

**PROHIBITED:** flipping `swing` · flipping any kind whose per-kind evidence is not cited in
§1 · re-baselining any existing certified artifact in place · reporting a single denominator.

## 4. Verification plan — RETURN CHECKLIST (blocking)

Receipt or explicit "could not, because…" per item. A silent omission halts the lane.

1. **★ Per-kind evidence CITED at the flip site** — each flipped kind names the grade/probe
   that earned it (`named_sr_level` → R-136 + `7e3247ca`; `order_block_edge` → AR-117). **A
   flip without its citation is an unearned claim.**
2. **★ `swing` PROVEN still `True`** — by test, not by inspection.
3. **Dual denominators emitted** — both figures, primary labelled, neither dropped.
4. **Re-measure ships with the flip**, and the delta is **attributed per kind** — how much of
   the movement is `named_sr_level`, how much `order_block_edge`.
5. **Append-only:** the prior floor artifact is untouched; the new measure is a new file.
6. **Any rate carries its null and its n** (R-100 §2, R-129 §1).
7. Existing tests pass; **if a test encoded `approximation=True` for these kinds, say so
   explicitly** rather than editing it silently.

## 5. Rollback

Single-commit revert restores `approximation=True` for both kinds. **No flag** — this is a
claim, not a feature toggle. **The claim stands only once graded**; a landed-but-ungraded flip
must not be cited as a fidelity result.
