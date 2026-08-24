# ALGO-079 — FOUR LANES: THE H-A TALLY IS A BASE-RATE ARTEFACT, THE SPENT PREDICATE SEPARATES

**Strategy head:** `e7537e982da72a576aa95f403c431f6150b4a418` (pushed, `ls-remote` verified)
**Chain:** `cf53acb3` → `e7537e98`
**PR #38:** DRAFT / DO NOT MERGE
**Semantic production files modified:** NONE. Four new diagnostic modules, four artifacts, guards.
**Stops honoured:** no repair landed · no number moved · nothing from the 2026 labels became a
parameter · the video untouched · R2 still in the worktree.
**Suite:** enumerated, `pytest tests/` → **1638 passed, 7 failed.** Membership vs baseline:
**zero added, zero removed.**
**Numbering:** you reserved ALGO-079 for the repair-design ruling; this report took the next
sequential slot, so that ruling is **ALGO-080**.
**One note on form:** this seat cannot spawn subagents, so the four lanes ran sequentially. The
fake-edge independence holds — four distinct artifacts, no lane consumes another's output.

---

## L1 — timing: **the answer your rule returns is not the answer the evidence supports**

All five early trades classify **H-A** (they fire at levels overlapping **none** of the zones he
marked that day), and the control classifies the other way. Under the pre-registered rule, 5/5
names the repair lane.

**It should not be read that way.** The machine builds **53–69 entry locations** per session and
he marks **two**. Only **1.49–4.41%** of its locations overlap one of his zones on any day.

> **P(all five early trades miss his zones by chance) = 89.2%.**

The tally is very nearly guaranteed by construction and carries almost no information. It is
recorded in the artifact as `tally_is_evidence: false`.

**The informative observation is the other side of the control.** The single **agreeing** day is
the day the bot fired **at** a zone he marked — a ~3% event per trade. H-A's repair lane is
plausibly right, but *that* is the argument for it, not the 5/5.

| session | fired at | overlaps a marked zone | early by |
|---|---|---|---|
| 03-23 | `[24443.76, 24453.24]` WICK_ZONE | no | 187 min |
| 03-24 | `[24308.25, 24327.50]` WICK_ZONE | no | 75 min |
| 03-31 | `[23392.69, 23404.11]` WICK_ZONE | no | 46 min |
| 04-06 | `[24289.33, 24293.17]` STRONG_SWING | no | 57 min |
| 04-09 | `[25029.72, 25035.78]` STRONG_SWING | no | 118 min |
| **04-14 control** | `[25714.67, 25717.83]` STRONG_SWING | **yes** (his `[25716.5, 25716.75]`) | **−2 min** |

## L2 — selection: **the spent predicate separates, 3 of 3 testable, control pointing the right way**

Predicate, fixed before the search, **structural only — no distance, no reward, no outcome**:

> `SPENT := a COMPLETED bar strictly before his entry has already traded INTO the band.`

| session | machine winner | spent? | his TP band | spent? | separates |
|---|---|---|---|---|---|
| 03-24 | `[24343.95, 24372.10]` KEY_ZONE_15M | **yes** (7 bars) | `[24627.85, 24660.35]` | no | **yes** |
| 03-30 | `[23372.73, 23374.77]` LIQUIDITY_CLUSTER | **yes** (1) | one-tick window | no | **yes** |
| 03-31 | `[23521.58, 23529.92]` refined | **yes** (1) | one-tick window | no | **yes** |
| **04-14 control** | `[25811.5, 25926.75]` FVG_15M | **no** (0 bars) | *(none marked)* | — | n/a |

**On the one agreeing day the chosen destination is FRESH.** That is the direction that makes the
separation credible rather than coincidental. Nearest-first is untouched — this only asks whether
a spent zone leaves the **universe**.

**Caveat I am not softening:** on 03-30 and 03-31 his TP is inside no considered destination, so
"fresh" there rests on a synthetic one-tick window, not a real band. Weaker than 03-24, and
labelled as such in the artifact.

## L3 — coverage provenance: **the two split**

Tolerances fixed before the search (1 tick exact, 2.0 pts band). **03-24 carried as positive
control and found**, so the search is capable and its silence elsewhere means something.

- **03-30 → `TP_INSIDE_AN_HTF_REJECTION_BAND`.** 23355.25 sits inside three **30m
  upper-wick-to-close** bands, tightest `[23345.5, 23357.75]` (12.25 pts) — *his own zone rule at
  a higher timeframe*, not a new invention. **The coverage repair has a source here.**
- **03-31 → `TP_PROVENANCE_UNKNOWN_FROM_HELD`.** Nearest candidate is `session_high_to_entry`
  23531.5 at **9.25 pts** — outside tolerance. **No source. The coverage repair cannot reach it
  from held data.**
- 03-24 control → found inside a 60m band `[24612, 24689]`.

## L4 — uniform band re-derivation under the §5 law

Law applied: `marked_time` untrusted · join on **line price** · latest **completed** penetrating
bar at or before his entry · band = `[wick extreme, close]`.

| session | OLD (marked_time) | NEW (§5 law) | source |
|---|---|---|---|
| 03-30 | `[23424.5, 23467.75]` | **same** | 5m 09:35 → closes 09:40 |
| **03-31** *(control)* | `[23402.75, 23444.5]` | **`[23418.0, 23470.0]`** | 5m 09:40 → closes 09:45 |
| **04-14** *(control)* | `[25655.75, 25718.25]` | **same** | 5m 09:30 → closes 09:35 |
| 03-24 | `[24173.75, 24317.0]` (FORMING) | **none** | no completed penetration before 09:32 |
| 04-06 | ERROR | **none** | no completed penetration before 10:04 |

**Both controls re-derive.** Your note is confirmed: 03-24's old source candle (15m 09:30) closes
**09:45 — thirteen minutes after he entered.** 04-06's penetrating candles are at 10:00 and close
10:05, after his 10:04.

**Two of five sessions become UNDERIVABLE under the law** — at his entry, no completed bar had yet
penetrated his line. I am reporting that rather than resolving it: it may mean he marks levels
**prospectively**, or that those two lines are wrong, or that he reads a finer timeframe than 5m.
That is a question about his intent, and it is yours or his to settle, not mine to assume.

## What I would put to ALGO-080

1. **L1's tally is not a finding** — please do not let 5/5 into a ruling as evidence. The control
   is the evidence, and it is one observation.
2. **L2 is the strongest result in the packet** and is structural, control-supported, and
   nearest-first-preserving. It looks like the lawful selection repair.
3. **L3 splits the coverage repair**: 03-30 has a source (30m rejection bands under his own rule);
   **03-31 has none** — a coverage repair that "fixes" it would be inventing a level.
4. **L4's two underivable sessions** raise the prospective-marking question above.

Artifacts at `e7537e98`: `..._l1_timing_classification_2026_08_24.json`,
`..._l2_spent_zone_separation_2026_08_24.json`, `..._l3_tp_provenance_2026_08_24.json`,
`..._l4_uniform_band_rederivation_2026_08_24.json`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
