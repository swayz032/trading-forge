# RATIFY PACKET — level/zone sub-wire (first decomposition sub-wire)

**STATUS: STAGED, autonomous class — implementing via agent-loop.**
Not the irreversible/live-capital class: the system is pre-live (nothing live-trading by
design), this alters no live default, touches none of the sealed 77, and R-091 §1 already
gates any `approximation=False` claim behind an independent grade. Per the 2026-07-11
operator amendment, the **independent grade is the gate**, not permission. Operator holds a
standing veto on the post-hoc plain-English summary.

Authorization: **R-091 §1 BUILD IS GO**, under R-080 §3's ratified decomposition architecture.

---

## 1. What & why now — with receipts

Level/zone conditions currently bind to `structure_engine.compute_structure_state`
(`FAMILY_META["WAIT_STRUCTURE"]`, `base_approximation=True`). That primitive **takes no
level argument at all**:

```
signature: (exec_bars, htf_bars, htf_bias=None, lookback_swings=20) -> Optional[StructureState]
accepts a level/zone argument: False
```

**Consequence, measured:** any two level/zone conditions evaluated on the same bars receive
an **identical** `StructureState`. Today *"support at 100"* and *"resistance at 140"* bind
to the same signal — the approximation cannot discriminate them, which is precisely why
they carry `approximation=True`.

**Premise audit passed BOTH legs** — receipt `docs/replay-results/h1-battery/levelzone_premise_audit.py`
(commit `969cbe76`), exits 0 on pass, non-zero on fail:
- **Leg 1** — `retest_touch_check` MOVES with its `level` input: 63 touches (level near
  price) / 0 (level 40pts away) / 299 (level hugging price). Both polarities, non-degenerate.
- **Leg 2** — the incumbent is provably BLIND (above). This is the leg WIRE-1 skipped.

**Why now:** three independent lines converge on level/zone as first sub-wire — the R-081
blind grade's floor ruling (vocabulary under-labels ⇒ ≥16 in the structure family), the
deferred-family census (**30.4%, top concept there too**, vs ≥20.5% in structure), and now a
mechanism that moves against an incumbent that cannot.

## 2. Blast radius

**Invalidated / re-measure required:**
- Any binding-approximation rate computed over level/zone rows on the tier-b corpus. The
  honest floor (`wire1-dod-HONEST-FLOOR.json`, 0.9938 → 0.9793) is **bias-credit only** and
  is NOT re-baselined by this change; a fresh measure ships with the sub-wire under **dual
  denominators**, and no artifact is silently replaced.
- `spec_family_bindings` binding plans for level/zone-classified WAIT_STRUCTURE conditions.

**Explicitly NOT touched:** the sealed 77 · `TF_WIRE1_HTF_COLUMNS` (stays OFF) · the frozen
forensics pre-registration · any promotion gate, sizing path, or live default · the tier-a
corpus (uncompiled) · the 26 session rows (their own packet, R-088) · narration
reclassification (gated on R-090's judgment pass).

**Downstream behavior change:** level/zone conditions begin receiving a level-discriminating
signal instead of a shared one. Until an independent grade licenses it, the flag stays
`approximation=True` — **the build does not itself claim fidelity.**

## 3. The exact change, scope-locked

**IN scope:** route level/zone-classified `WAIT_STRUCTURE` conditions to a level-aware
evaluator (`spec_condition_compiler.retest_touch_check`) with a resolved level series;
concept classification reused from the committed census generator (not re-authored);
env-flag gated, default OFF.

**OUT of scope, explicitly:** the other six concepts (liquidity, FVG, order_block, pd_array,
ma_indicator, structure_event) · flipping `approximation=False` for anything (gated on the
independent grade) · any denominator move · the narration rule · the session resolver ·
`SESSION_KEYWORDS` · engine fill/P&L/sizing math · any tier-a work.

## 4. Verification plan (empirical, ships with the change)

1. **Both-polarity per binding** — each routed condition demonstrated able to evaluate TRUE
   and FALSE for the right reasons, not merely to execute.
2. **Per-column engagement count** — how many rows actually engage the new path; a routed
   column that never engages is dead load, per the amended engaged-fraction law.
3. **Cadence isolated from signal** (R-079 §3, non-negotiable) — vary the LEVEL holding
   cadence/window fixed, and vary cadence holding level fixed, measured separately. WIRE-1's
   721→631 was cadence masquerading as fidelity precisely because they moved together.
4. **Flag-OFF byte-identity** — with the flag off, binding plans are byte-identical to today.
5. **Independent grade (doer ≠ grader, fresh context)** before any `approximation=False`.

## 5. Rollback

Env flag, **default OFF** — flipping it off restores current behavior exactly (proven by
verification 4, not asserted). Single-commit revert; no migration, no persisted state, no
data mutation. Two-commit law observed: routing lands separately from any flag default change.
