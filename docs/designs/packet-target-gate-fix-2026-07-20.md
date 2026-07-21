# RATIFY PACKET — target-selection index gate (`eqhl_raid` + `ict_swing`)

**STATUS: STAGED.** Engine-instrument class. Authorization: **R-129 §2 / R-130 §3(a)**.
Pre-live; no live default altered; the sealed 77 untouched. Independent grade is the gate.

**★ SCOPE-LINE, travelling with every citation:** this fixes **exit-target selection in two
files**. It does **not** touch `detect_sweep` (real but **decision-level inert** — 0 entry
mismatches across 20 well-powered tests), and it does **not** claim to close the level/zone
lane.

---

## 1. What & why now — measured, not asserted

Both files pick an exit target from an **unfiltered whole-frame** BSL/SSL price list, with
**no comparison against the bar being evaluated** — so a trade can target a level that did
not exist when the trade opened.

- **`eqhl_raid.py:86-87,157-160,173-176`** — **20 of 163 real entries (12.3%)** differ under
  causal recomputation. Independently re-derived twice, on real ES data.
- **`ict_swing.py:115-116,199-203,211-215`** — **6 of 149 real entries (4.0%)**. Trace: entry
  bar **13148** uses target **2858.88**, from a 12-member cluster **not created until bar
  13521 — 373 bars after the entry.** Causally, no target existed at all.

**Why this and not `detect_sweep`:** the sweep-bit leak is real but **never changes an
entry** (0 mismatches, 5 strategies, 39–149 signals each). **These two change trades.**
Priority follows measured decision-level harm, not defect count.

**The gate already exists in-repo:** `eqhl_raid.py:108,116` applies `if idx_b >= i: continue`
on its **entry** path. **The same file leaves its exit path undefended.** The fix is to
extend a pattern the codebase already owns, not to invent one.

## 2. Blast radius

**Changes:** exit-target selection — and therefore exit timing/existence — in these two
strategies. **Historical backtest output WILL change.** That is the point (they were reading
the future), but it is **declared here, not discovered downstream.** No certified number may
be silently re-baselined.

**NOT touched:** `detect_sweep` · the BSL/SSL detectors (already fixed, graded Band 8) ·
`ict_2022`/`turtle_soup`/`quarterly_swing` (bars lifted; no BSL/SSL target path) ·
`ict_scalp` (its own test is in flight; **out of scope regardless of that result**) ·
`spec_condition_compiler` (verified gated two ways) · promotion gates · fill/P&L/sizing · tier-a.

## 3. The exact change, scope-locked

**IN:** an index gate on exit-target selection in both files — a level is eligible at bar *i*
only if its creation index is `<= i`, matching `eqhl_raid.py:108,116`'s existing entry-side
form.

**PROHIBITED:** substituting a *nearest-in-price* fallback when the gate empties the list.
**The causal truth at those bars is often "no target exists yet"** (`ict_swing` bar 13148 is
exactly this). Manufacturing a substitute target would convert a look-ahead defect into a
fabricated-signal defect — **strictly worse, because it would probe clean.**

**OUT:** everything in §2's not-touched list; any `approximation=False`; any entry-path change.

## 4. Verification plan — RETURN CHECKLIST (blocking)

Receipt or explicit "could not, because…" per item. **A silent omission halts the lane.**

1. **★ DECISION-LEVEL truncation tests on `entry_*` / `exit_*`** — the **new mandatory class**
   (R-129 §2). The existing suite watched **sweep booleans** while shipped targets
   time-travelled: **a regression suite must watch what trades, not what flips.**
2. **★ Premise audit:** gating the targets must **move the differing entries to
   truncated-truth** — the 20 `eqhl_raid` and 6 `ict_swing` mismatches must **resolve**, each
   verified individually. A fix that changes behaviour without resolving the known cases is
   not this fix.
3. **Plant-catch per file:** re-widen the gate, show the decision-level test **FIRES**, then
   show the fixed code **PASSES**. A probe that cannot fail proves nothing.
4. **No-fabrication check:** where the causal truth is "no target," the fixed code must
   produce **no target** — not a fallback.
5. **Any rate carries its null** and **its n** (R-129 §1) — a zero from an underpowered
   sample is not a pass.
6. Existing tests pass. **If a test encoded the un-gated behaviour, say so explicitly**
   rather than quietly editing it.

## 5. Rollback

Single-commit revert; pure selection-logic change, no migration, no persisted state. Revert
restores the defect — so **the two bars lift on the GRADE, not the landing.**
