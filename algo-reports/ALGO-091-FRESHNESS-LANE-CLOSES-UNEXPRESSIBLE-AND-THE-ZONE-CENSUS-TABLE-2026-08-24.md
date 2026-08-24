# ALGO-091 — the freshness lane **CLOSES as unexpressible**; the entry-zone census table

**Strategy head:** `78380b216102b33fb350356308b57efdc2c4c5d7` (pushed, `ls-remote` verified)
**PR #38:** DRAFT / DO NOT MERGE · **Nothing landed**, no number moved, no target-layer change,
R2 untouched.
**Suite:** enumerated → **1662 passed, 7 failed.** Membership vs baseline: **zero added, zero
removed.**
**Numbering:** you said next is ALGO-091; this report takes it, so your ruling is **ALGO-092**.

---

## 1. The entry-zone census — a table, nothing proposed

| session | type | age | **drawable under his rule** | tests/birth | tests/definer | width | source / story |
|---|---|---|---|---|---|---|---|
| 03-23 | convicted | 14 | **True** | 129 | 97 | 9.48 | WICK_ZONE / repeat-test |
| 03-24 | convicted | 1 | **False** | 18 | — | 19.24 | WICK_ZONE / repeat-test |
| 03-31 | convicted | 0 | **False** | 10 | — | 11.42 | WICK_ZONE / accepted-break retest |
| 04-02 | *other decided day* | 2 | True | 22 | 8 | 8.65 | WICK_ZONE / (REV path, decline day) |
| 04-06 | convicted | 0 | **False** | 10 | — | 3.83 | STRONG_SWING / first-break print |
| 04-09 | convicted | 18 | **True** | 142 | 15 | 6.06 | STRONG_SWING / accepted-break retest |
| **04-14** | **CONTROL** | 0 | **False** | **1** | — | 3.16 | STRONG_SWING / first-break print |

Plus his 16 labelled zones, day-grain context only. **No predicate proposed, no row scored** — as
ordered.

`drawable_under_his_rule` asks whether any completed 5m/15m candle would draw *that exact band*
under his ratified `[wick extreme, close]` construction (tolerance 1.5 pts). **Four of seven
machine zones are not drawable by his rule at all — including the control.** The machine builds
narrow bands from swing-displacement and wick-zone geometry his construction does not produce.

## 2. R-C re-spec — **`LANE_VERDICT: CLOSED_AS_UNEXPRESSIBLE`**

approved **40 → 36**, removed 4. Dispositions: **34 exempt-taught · 4 refused-not-fresh ·
2 `UNDEFINED_NO_DEFINING_REJECTION`** — **and the control is one of the undefined.**

The corrected predicate needs a defining rejection to anchor on. Where the machine's band is not
reproducible by his rule, the predicate is neither strict nor lenient — **it is undefined**.

> **A rule that cannot be evaluated on the one day the machine agrees cannot be the rule that
> separates the days it does not.**

Per your pre-registration, that closes the lane. Taught exceptions were **not** narrowed; the
honest ceiling stays 1 of 5.

## 3. Three errors of mine, each caught by an artifact contradicting itself

1. The census tagged every non-control decided day "convicted" — sweeping **04-02, a NO_TRADE
   decline day**, into a table about early entries.
2. `defining_rejection` searched **all history** and returned candles *older than the zone they
   supposedly draw*, producing the impossible row "7 tests since definer, 1 since birth" on the
   control. **This one mattered:** anchored to birth, `drawable_under_his_rule` flips on four rows
   **including the control**, and that flip is what closes the lane. Unanchored, the search would
   have invented a definer for the control and **kept the lane open on a fiction**.
3. `completed_tests_since_BIRTH` emitted `0` instead of `null` for zones with no parseable birth,
   letting the definer count exceed it. My own ordering invariant caught that one.

All three are now pinned by guards.

## 4. What I'd flag in the table, without proposing anything

The control's `tests since birth` is **1**, against 10–142 for every convicted zone. I am **not**
offering that as a cut — you hold the reading, and a one-observation gap on a column I could have
chosen after seeing it is exactly the base-rate trap L1 already caught me in. It is stated because
it is the most visible asymmetry in the table, and your second outside-research pass on *which
levels a day trader keeps on the chart* is the right instrument to judge whether it means
anything.

Artifacts at `78380b21`: `..._entry_zone_census_2026_08_24.json`,
`..._rc_respec_report_2026_08_24.json`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
