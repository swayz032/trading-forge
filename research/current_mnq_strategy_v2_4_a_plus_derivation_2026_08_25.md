# S1 — FIRST_A_PLUS derived from the teachings. M1 method, teachings only.

**Result: the lane is NOT a selector. "A+" has no taught ranking — the taught selection rule is
literally FIRST, which the kernel already implements faithfully. What the teachings DO contain is
an A+ GATE that the code lost: `touch with mixed/doji control -> WAIT_OR_NO_TRADE`.** R2/R2b
retired the untaught *magnitudes* that were the only implementation of that TAUGHT *refusal*, and
put nothing in their place. That is the 103 additions.

Report only. No predicate is built here. No label, no PnL, no EDGE artifact was read.

---

## 1. Provenance discipline first

`teaching_source_policy.json` (TRADER_CONFIRMED, 2026-08-19) ranks evidence:
**rank 1 TRADER_IMPLEMENTATION_GOLD** (his trades, screenshots, videos, direct corrections) ·
**rank 2 TRADER_LEARNING_SOURCE_REFERENCE** (the teaching videos he confirms he learned from) ·
**rank 3 MECHANICAL_TRANSLATION** (equations, features).

**Cited below: rank 1–2 only.** One tempting source is deliberately EXCLUDED:
`current_mnq_strategy_v2_2_robustness_charter.md` §F22 contains a ready-made A+ decomposition
(*"mandatory A+ gate = valid location + valid premarket scenario + valid control story + valid
path/room + valid destination + no unresolved conflict"*) and an acceptance line that would have
settled this lane in one quote. **It is a desk document** — header: *"Status: PRE-PNL REPAIR
SPECIFICATION"* — i.e. rank 3, our own prior translation. Under M1 it cannot be the citation for
a taught clause, however convenient. It is recorded here as corroboration only, and the
conclusions below stand without it.

## 2. What the teachings actually say about "A+"

| # | clause | source (rank 1–2) |
|---|---|---|
| T1 | *"first A+ only, and one trade maximum"* — described as **the user's currently confirmed map** | `video_evidence.md:100` |
| T2 | the engine order ends `… -> ROOM TO NEXT MEANINGFUL DESTINATION -> **FIRST A+ ONLY**` | `video_evidence.md:108` |
| T3 | **`touch with mixed/doji control -> WAIT_OR_NO_TRADE`** (taught EXPLICIT REFUSAL) | `video_evidence.md:113` |
| T4 | **`sweep/reclaim without directional defense -> WAIT_OR_NO_TRADE`** | `video_evidence.md:114` |
| T5 | `RECLAIM_REQUIRES_HOLD` — *"Directional control/defense/hold must confirm; **a doji reclaim alone is not an A+ trade**"* | `video_evidence.md:82`, restated `engineer_onboarding.md:61` |
| T6 | `candlestick pattern away from a zone -> NO_TRADE`; `price near but not interacting -> NO_TRADE` | `video_evidence.md:112-113` |
| T7 | `trade directly into a strong nearby opposing blocker -> REFUSE`; targets are the next meaningful destination, **not fixed R** | `video_evidence.md:115`, `:81` |
| T8 | A+ **identity is judged on the 5-minute execution candle/sequence**, not on the 1m decomposition | `timeframe_pattern_fidelity_2026_08_20.json:23,29`; `spec.json:165` |
| T9 | *"planned TP1 reward >= $400 … **if every other A+ gate passes**"* — A+ is spoken of as a SET OF GATES | `fvg_semantics.json:37` |

## 3. THE FIRST FINDING — there is no taught ranking, and "first" is faithful

T1 and T2 are the only teachings that say how the one bullet is chosen, and both say the same
word: **FIRST**. T9 shows "A+" is used as a **qualifier over gates**, not as a grade — a setup
either passes every A+ gate or it does not. **Nothing in any rank-1 or rank-2 source contains a
ranking, a score, a comparison between two qualifying setups, or a "best of the day" concept.**

Therefore `FIRST_A_PLUS` decomposes as **`FIRST(t)` ∧ `A_PLUS(candidate)`**, and:

- **`FIRST` IS ALREADY IMPLEMENTED AND IS FAITHFUL.** `kernel.py:201-208` takes the earliest
  qualifying candidate in clock order. ALGO-099 §6c reported this as the defect; **S1 finds it is
  the teaching.** Building a comparative selector would *invent* a concept the teachings do not
  contain — the exact failure mode this campaign keeps convicting.
- **`A_PLUS` is the conjunction of the taught gates** — which is why the grep for a predicate
  named `FIRST_A_PLUS` correctly returns nothing. It was never supposed to be one function.

**ALGO-100 §4's premise needs amending, and this is the honest report of it:** the conjunct is
not *unbuilt*. It is the conjunction of the other gates, and it is built. The over-grant is not a
selection defect — **it is a gate that got weaker while "first" kept doing exactly what it was
taught to do.**

## 4. THE SECOND FINDING — the A+ gate the code lost

Map each taught gate to the money path at the reverted head `6888112d`:

| clause | implemented at | status |
|---|---|---|
| T2 PREMARKET | `build_premarket_plan_v24` / `plan_allows_v24` (`kernel.py:228,334,371,385`) | **PRESENT** |
| T2 key-level map | `build_entry_locations_v24`, zone lifecycle | **PRESENT** |
| T6 reaches/interacts | `derive_approach` → `MERE_APPROACH_WITHOUT_TOUCH` | **PRESENT** |
| T2 classify | `classify_interaction` + routes A/B/C/D | **PRESENT** |
| T4/T5 reclaim hold | `_defended` → `SWEEP_RECLAIM_WITHOUT_HOLD_OR_DIRECTIONAL_DEFENSE` | **PRESENT** |
| T7 room / destination | `build_and_classify`, target policy, the $400 floor | **PRESENT** |
| T8 5m identity | story read on completed 5m; 1m only reconstructs force | **PRESENT** |
| T1/T2 FIRST + one bullet | `kernel.py:201-208` + daily bullet | **PRESENT, and faithful (§3)** |
| **T3 touch with MIXED/DOJI control → WAIT_OR_NO_TRADE** | `_control` (`body_frac 0.62` / `close_loc 0.78`) and `two_sided_wick_conflict` (`0.30`/`0.40`) | **PRESENT ONLY THROUGH UNTAUGHT MAGNITUDES** |

**T3 is the whole story of this campaign's last three rounds.** ALGO-071 §3 correctly ruled that
`0.62`, `0.78`, `0.30` and `0.40` are untaught constructions and retired them — but **the CLAUSE
they implemented is TAUGHT**, verbatim, as an explicit refusal. R2 and R2b removed the only
implementation of T3 and supplied no replacement, so after the batch a *mixed/doji-control touch*
became an admissible A+ story. That is consistent with ALGO-099 §2c rather than contradicting it:
every addition carried one of the spec's six FORMS, and a `touch_and_reject` form can perfectly
well be a mixed/doji-control touch. **The form was right; the control quality was never re-tested.**

*The magnitudes were untaught. The requirement is not.* Retiring the first without re-expressing
the second is what the guard measured as 40 → 143.

## 5. Magnitude-free candidate expressions for T3 — NAMED, NOT CHOSEN

ALGO-071 §3 set the standard: *"OHLC against the band, no fraction."* T3 is about the candle
rather than the band, so the equivalent standard is **OHLC against OHLC, no fraction**. Candidates
that meet it:

- **C1 — body smaller than both wicks.** `body < upper_wick AND body < lower_wick`. This is
  literally "mixed": neither side won, and both rejected. Pure OHLC comparison, no constant.
- **C2 — body smaller than the larger wick.** `body < max(upper_wick, lower_wick)` — the wick
  dominates the body, the taught picture of a doji/pin without a chosen fraction.
- **C3 — close on the wrong side of the candle's own midpoint** for the traded direction.
  `close <= (high+low)/2` for a long. Directional, no constant.

C1 is the closest literal reading of *"mixed"* and C2 of *"doji"*; they are not equivalent and
**must not be blended into a scored composite** — T9's grammar is gate-shaped, and a weighted
total is precisely what a mandatory gate is not. **S1 does not choose.** Choosing is S3's job
under a pre-registration, with the two hit-keys as the survival test.

## 6. Honest limits

- **T3's cited clause says "mixed/doji" without a geometric definition.** Any expression of it,
  including C1–C3, is this desk's reading. It is magnitude-free, which is strictly better than
  `0.62`, but it is still a translation and must be labelled rank-3 wherever it lands.
- I did **not** find a taught statement that distinguishes two *simultaneously qualifying* setups.
  If S2's census shows his entry losing to another candidate that **also** passes every gate
  including a restored T3, then **the lane closes honest-partial** and the answer is not in the
  teachings we hold.
- Sources searched and named: `video_evidence.md`, `supporting_visual_examples.md`,
  `trader_fidelity_addendum_2026_08_20.json`, `engineer_onboarding.md`, `spec.json`,
  `fvg_semantics.json`, `timeframe_pattern_fidelity_2026_08_20.json`,
  `teaching_source_policy.json`, plus the v2.2 charter (excluded by rank, §1). Stated as *"no
  ranking concept found in the surfaces named"*, not as proof of absence.

## 7. What S3 inherits

1. **Do not build a selector.** "First" is taught; a ranking is not.
2. **Restore T3 magnitude-free** at `_control` / `two_sided_wick_conflict` — the taught refusal
   R2/R2b removed, expressed as OHLC against OHLC.
3. The pre-registration is unchanged and the two hit-keys stay the survival test: a T3 that kills
   `03-24 09:32 @ …96923` or `04-09 11:37 @ …100322` is refuted, because on both days his own
   entry is the thing that must survive.
4. Expected direction, stated in advance so it can be wrong: T3 should cut the additions hard
   (`touch_and_reject` 67 + `prior_momentum_after_rejection` 28 are exactly the population a
   control-quality gate bites) **without** the 04-09 kill R2c caused, because T3 tests the
   completed rejection candle, not the forming trigger's follow-through.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this derivation.
