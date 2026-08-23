# ALGO-051 — OPERATOR TEACHING PINNED: the late-arrival mechanic. Price ran toward his TP before he could enter → he WAITS for the reaction at that level inside the liquidity reaction zone → enters only on a momentum-candle breakout → target re-anchors to the NEXT key zone.

**Advisor:** Claude (Fable 5), ALGO seat. **Channel head at drafting:** `058a06f1` (ALGO-050 —
same volunteered-evidence class; its scoping precedent applies). **PR #38: DRAFT / DO NOT
MERGE — unchanged.** **DECISION: RECORD.** Queue unchanged from ALGO-049.

## 1. The artifacts [MEASURED HERE — this desk read all three images]

Operator volunteered (2026-08-23): three FX Replay captures of ONE session — MNQ (Micro
E-mini Nasdaq-100), replay date **Fri 27 Jun 2025**, captured 2026-08-22 00:14–00:18 local.
Identity = sha256, not path (his Pictures folder):

| file | sha256 | bytes | shows |
|---|---|---|---|
| `Screenshot 2026-08-22 001458.png` | `b69a1b9dfbf64c7a39206dbdbd9389f4cad7a5871610a8c40b8d15f1a19ccd14` | 137,513 | 5m, replay 09:38 — BEFORE entry (unrealized $0); sell-off from ~22,780 top into the ~22,704–22,708 lower zone |
| `Screenshot 2026-08-22 001825.png` | `5ac1a02346b7ce007b860964a1ac0b12b78565010718ce62cea0e8fd00cebc6e` | 139,960 | 1m, replay 09:44 — the reaction basing 09:15–09:40 between the lower zone and the 22,735/22,738.50 level, then momentum candles breaking up through it; position on |
| `Screenshot 2026-08-22 001807.png` | `f48f460e251f862d0ba39d2cbb91571ab85bc21eac394b8bc4d157505060f969` | 143,960 | 5m, same state — full-session context of the same levels |

**Position geometry, derived from the chart's own projection labels — three independent
joins, all consistent [MEASURED HERE]:**
- Stop label `768->-517.50 USD, 15` at **22,735.00**: 517.50 / (15 × $2/pt) = **17.25 points**
  ⇒ entry **22,752.25**. **The frozen 17.25-pt stop, appearing in the wild, untouched.**
- Unrealized `+$420.00` with last price 22,766.25: 420 / 30 = 14 pts ⇒ entry **22,752.25**. ✓
- Target label `768->960.00 USD, 15` at **22,784.25**: 32 pts × $30 = $960 ✓ — the target is
  the NEXT key zone (the ~22,780–22,788 band), not the level he entered at.

(The captures' UI chrome shows account PnL figures; none of them is used for anything here.
The two dollar figures above were read ONLY as projection geometry to recover entry price —
no realized outcome, no winner/loser judgment, participates in any decision.)

## 2. The taught mechanic (his words, then the structure)

Verbatim: *"how price got to close to my take profit before i could jump in you see how i let
price react to the first take p[rofit llevel between the liqudity reaction zone then i seen a
momentum/ momenteum candle breakout and i jumped in and targeted the next key zone"*

Structure: **on a LATE ARRIVAL — the move already ran toward the level he would have targeted
— the strategy does not chase.** It (1) WAITS while price reacts at that first level inside
the liquidity reaction zone (here: the basing between ~22,704–22,708 and 22,735/22,738.50,
09:15–09:40); (2) the entry trigger is a **momentum candle breakout** out of that reaction
(the ~09:41–09:44 1m thrust); (3) the target **re-anchors to the NEXT key zone** (22,784.25
band) because the first one is spent. WAIT-by-default until a story completes — exactly the
lane's four-route grammar; the breakout trigger sits in the Route B (momentum break) FAMILY.
**No fifth route is taught here and none is created.**

Prior art [cited]: the target-re-anchor idea already exists as a coded semantic —
`current_mnq_strategy_v2_1_fidelity.py:371` lists *"strong BRK5 may skip standard shelf for
next major destination"* [ARTIFACT-SOURCED: a string in the fidelity notes; its executable
reach is NOT re-verified here]. This teaching corroborates that semantic and adds the
late-arrival WAIT-for-reaction precondition as taught context.

## 3. RULING — scope of use

1. **TEACHES, not SCORES.** Replay date 27 Jun 2025 ⇒ 2025 era under the ALGO-020 two-era
   fork. Teaching corpus only: citable in derivation-layer taught stories and the exam
   pre-registration RATIONALE. It does NOT join any exam population, creates no label,
   touches nothing frozen. (Operator closed replay collection 2026-08-21; these were
   VOLUNTEERED — nothing was requested.)
2. **No code is ordered from a screenshot.** If the wired brain's taught stories cannot
   produce WAIT-then-momentum-entry-with-re-anchored-target where the teaching says so, that
   surfaces in the EXAM as a fidelity gap — the exam convicts, then repairs are ruled. The
   worker does not add branches from this ruling.
3. The 17.25-pt geometry sighting is corroboration of the frozen stop semantics, nothing
   more — the stop stays untouched by standing rail.

## 4. Authorized next action

Unchanged from ALGO-049: wire the brain → 09:30 arm as run-configuration → `acceptance_bars`
rerun → dual-window exam → FREEZE on a pass. Worker: add the three hashes beside ALGO-050's
in the pre-registration rationale citations when you reach the exam instrument.

LESSON: the operator teaches in artifacts — each one gets pinned, geometry-verified by joins
the chart itself provides, era-classified, and scoped before it can bend a frozen population.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
