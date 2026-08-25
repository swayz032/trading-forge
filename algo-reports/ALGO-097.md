# ALGO-097 — PROVENANCE (ALGO-096 §7.3). The displacement gate MEASURED: at every one of his clocks the Route C refusal is `MOMENTUM_WRONG_DIRECTION` — `range_ratio` and `body_frac` are NEVER CONSULTED. ALGO-095's second wrong site, same defect as `force.py:123`. Route D's `UNMAPPED` provenance RECOVERED from the trace's own table: 100% rest on `reject_wick 0.35`. And the trace's counts are LOCATION-MULTIPLIED — 63 / 34 / 4 are ONE distinct evaluation each.

**Strategy head:** `6d22524c6a88ab93c3de268a7bae5777efbb15a9` (pushed; `ls-remote` verified with a
negative control; local == remote MATCH).
**PR #38:** DRAFT / DO NOT MERGE. **Semantic files modified: NONE** — three new diagnostic
files only (`run_*` + artifact), which ALGO-096 §5 lists as allowed. Gate state unchanged.
**Authority:** ALGO-094 order 3, second half; accepted as provenance by ALGO-096 §7.3, which
also states it does not gate the §5 lane. **It does not.** The §5 lane is in flight separately;
this packet lands nothing semantic and proposes no repair.
**Numbering:** re-fetched before picking. `096` was the highest on the ladder, so this takes
`097`; the advisor's ruling on the §5 batch therefore becomes `098` (ALGO-096 §7.1 planned `097`
for it — the ladder is last-wins and this is the renumber, flagged rather than silently taken).

---

## 1. What ALGO-094 order 3 still owed

Order 3: *"if B/C/D refusals on 03-24/04-06 rest on an untaught magnitude, name it with citation
status."* ALGO-095 discharged this for the FORCE site and left the break family as a
**mapping-table** claim — `run_refusal_trace_five_clocks.py:96-99` grades
`ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT` as `TAUGHT_SHAPE_UNTAUGHT_GATE` with the detail
*"ALGO-009 7.8 is taught, but the test calls range_ratio and body_frac"*.

That sentence is a **reading of the function source**. It says which magnitudes the code
*mentions*, not which one *refused*. `is_true_displacement` (`breakout_derivation.py:131-144`) is
a conjunction of three independent requirements that all raise the SAME literal:

| # | requirement | magnitude | status |
|---|---|---|---|
| (a) | `_momentum(row, direction, body_frac, close_loc)` | `body_frac 0.62`, `close_loc 0.78` | untaught |
| (b) | `reference_range and reference_range > 0` | — | structural |
| (c) | `_geom(row).range >= reference_range * range_ratio` | `range_ratio 1.25` | untaught |

**The literal under-determines its cause.** This is precisely ALGO-096 §6's minted law arriving
from the other side: *a gate label is not a sub-reason.* ALGO-096 caught it at
`FORCE_NOT_CONFIRMED` (one label, five `ForceSnapshot` reasons). It is also true here, in the
same trace, in the same table — and nobody had measured it.

**Frozen magnitudes, resolved at runtime** (`Params`, `v2_2_engine.py`, reached via
`v2_3_engine` as the v2.4 `prod` import): `body_frac 0.62` · `close_loc 0.78` ·
`range_ratio 1.25` · `reject_wick 0.35` · `min_wick 0.20`.

## 2. Method — instrument the real path, never re-implement it

`prebreak_displacement` is wrapped in-process. The wrapper calls the **unmodified** function for
the verdict and decomposes the same inputs beside it; the patch is restored in a `finally`. No
production file is touched. The decomposition lives in its own function (`_decompose_flags`) so
it can be attacked as a layer.

**Per-flag pinning.** The published claim is a per-flag attribution, so an aggregate check would
not pin it. Each flag is pinned by **neutralising one threshold at a time and re-asking the real
predicate** — `_momentum(row, d, 0.0, 0.0)` isolates direction; `(bf, 0.0)` adds body fraction;
`(0.0, cl)` adds close location; `is_true_displacement(..., ref, 0.0)` neutralises range
expansion; `(..., 0.0, 0.0, ref, 0.0)` reduces the predicate to `direction ∧ ref > 0`.

**The invariant is measured, not argued.** Some checks are vacuous in some states (the range term
cannot be pinned on a row whose momentum already failed). That is only safe if a vacuous check
never guards a flag the row actually **publishes**. Every row therefore carries
`published_attribution_pinned`, and the artifact **withholds all numbers** unless it is true for
every row. Measured: `total_failures: 0`, `unpinned_published_attributions: 0`, verdict `SOUND`.

## 3. Red-proof — `research/run_displacement_gate_subcause_redproof_2026_08_24.py`, exit 0

Positive witness first, in three different states of the world; then the **class** named — *any
single decomposition flag mis-set* — and **every member** attacked, not only the one demonstrated.

| witness | published flag | flip of the published flag | restore |
|---|---|---|---|
| momentum-binding L (weak body) | `body_frac_ok` | **RED** | GREEN, capture identical |
| range-binding L (strong body, small range) | `range_expansion_ok` | **RED** | GREEN, capture identical |
| wrong-direction S | `dir_ok` | **RED** | GREEN, capture identical |

Route D composite parse: positive parse correct; **four** negative controls (a non-composite
literal, a malformed body, and two key renames) all correctly refuse. A parser that never refuses
is not a parser.

**Two limits stated, not hidden.**

1. A flag a row does **not** publish may be unpinned in that state — visible in the table above
   as `green` flips on non-published flags. That is why the invariant is expressed over
   *published* flags and enforced per row.
2. **Both layers read `brk._geom`, so a defect inside `_geom` is out of this check's reach.**
   This was found the hard way: my **first** planted defect patched `_geom` and the check stayed
   **GREEN**, because the corruption reached both sides identically. That is the same-layer
   trap — agreement between two readings of one layer is not evidence. The defect was re-planted
   in the isolated decomposition layer, where it went RED. Recorded because the limit is real and
   survives the fix.

## 4. MEASURED — the displacement gate at his clocks

Instrument: `research/run_displacement_gate_subcause_2026_08_24.py`; artifact
`research/current_mnq_strategy_v2_4_displacement_gate_subcause_2026_08_24.json`. Same env,
params, lock and window as the ALGO-095 trace.

| session | dir | `NOT_DISPLACEMENT` at his bucket | **distinct evaluations** | first failing requirement |
|---|---|---|---|---|
| 03-23 11:21 | S | 0 | 0 | *(break family not asked)* |
| 03-24 09:32 | L | **63** | **1** | `MOMENTUM_WRONG_DIRECTION` — structural, no magnitude |
| 03-31 09:49 | L | 0 | 0 | *(refuses at `DISPLACEMENT_THIRD_CANDLE_REVERSED_CONTROL`)* |
| 04-06 10:04 | S | **34** | **1** | `MOMENTUM_WRONG_DIRECTION` — structural, no magnitude |
| 04-09 11:35 | L | 0 | 0 | *(break family not asked)* |
| **04-14 control** | L | **4** | **1** | `MOMENTUM_WRONG_DIRECTION` — structural, no magnitude |

Counts **join exactly** to the ALGO-095 artifact (63 / 34 / 4, and zero where that trace's modal
literal was something else) — the same instrument, a different attribution.

**FINDING 1 — the magnitudes are never consulted.** `_momentum` is
`g.bullish and g.body_frac >= body_frac and g.close_loc >= close_loc`. Python's `and`
short-circuits: when the candle is the wrong colour, **no comparison against `0.62` or `0.78`
ever executes**, and `range_ratio 1.25` is never reached either. At 100% of his clocks the Route C
refusal is that the displacement candle is the wrong colour.

Measured values, 03-24 at his bucket (one distinct evaluation, trigger `09:30`): `dir_ok False`,
`body_frac 0.3212`, `close_loc 0.2044`, `range 34.25` vs required `52.8125`. 04-06 (trigger
`10:00`): `dir_ok False`, `body_frac 0.5696`, `close_loc 0.6174`, `range 57.5` vs required
`132.5`. Control (trigger `09:35`): `dir_ok False`, **`body_frac_ok True` (0.6897)** and
**`range_expansion_ok True` (14.5 ≥ 13.75)** — only the direction term fails.

> **So Route C carries ZERO untaught-magnitude content at his clocks.** ALGO-095 named
> `range_ratio` and `body_frac` as the gate; measured, they are never asked. This is the
> **second** site that trace convicted without measuring — `force.py:123` (refuted by ALGO-096
> §3, 0 of 14) and now the displacement magnitudes. One defect, two instances.

**FINDING 2 — the counts are location-multiplied.** Route C's displacement test reads only
`completed`, `trigger` and `direction`; the location `lo`/`hi` enters *later* (the `seq[2]`
into-the-level test). Every candidate at the same bucket and direction therefore shares one
`completed` frame, one `rows[-3]`, and one verdict. Measured: **distinct evaluations = 1** on each
of 03-24, 04-06 and the control. **63, 34 and 4 are one market fact counted once per candidate
location.** ALGO-096 §6.2 forbids reporting the majority literal; this is the same hazard in a
second form — a tally that looks like 63 independent refusals is one. Reporting **by key**, as
§5's pre-registration does, is immune to it; reporting by count is not.

## 5. MEASURED — Route D's `UNMAPPED` provenance, recovered

ALGO-095 graded the whole Route D family `UNMAPPED` / *"refusal literal not in the table"* on all
four break sessions — including the largest refusal population at two of his clocks. But the
composite literal decomposes into two sub-literals **both already present in that trace's own
`PROVENANCE` table**. Parsed with a round-trip check (the parse must rebuild the original
byte-for-byte) and four negative controls. **Unparsed: 0 of 4 sessions.**

| session | n | `accepted_break` | `repeat_test` |
|---|---|---|---|
| 03-24 | 63 | 63 `NO_COMPLETED_PRINT_BEYOND_THE_ZONE` [TAUGHT] | **63 `REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST` [TAUGHT_SHAPE_UNTAUGHT_GATE]** |
| 03-31 | 243 | 240 TAUGHT · **3 `BREAK_NOT_ACCEPTED_BEFORE_RETEST` [UNTAUGHT_MAGNITUDE]** | **243 TAUGHT_SHAPE_UNTAUGHT_GATE** |
| 04-06 | 34 | 33 TAUGHT · **1 UNTAUGHT_MAGNITUDE** | **34 TAUGHT_SHAPE_UNTAUGHT_GATE** |
| 04-14 control | 4 | 3 TAUGHT · **1 UNTAUGHT_MAGNITUDE** | **4 TAUGHT_SHAPE_UNTAUGHT_GATE** |

**100% of Route D refusals at his clocks carry an untaught gate on the repeat-test arm** —
`reject_wick 0.35` (`derivation.py:168-171`, a `Params` default). A minority also clear through
`acceptance_bars 3`. The answer to ALGO-094 order 3 for Route D is therefore **yes, they rest on
an untaught magnitude**, and it was recoverable from the artifact the whole time.

**Recorded only.** ALGO-096 §5 forbids break-family gates this round and §7.2 owns them.
Nothing here is proposed, scoped, or touched.

## 6. The headline count ALGO-095 published was an anchored-classifier artifact

`run_refusal_trace_five_clocks.py:170` selects untaught rows with
`d["provenance"].startswith("UNTAUGHT")`. Re-derived from the artifact's own rows:

| provenance class | route-rows | inside ALGO-095's headline? |
|---|---|---|
| `UNTAUGHT_MAGNITUDE` | 3 | yes |
| `TAUGHT_SHAPE_UNTAUGHT_GATE` | 3 | **no** — contains an untaught gate, sorts outside the anchor |
| `UNMAPPED` | 4 | **no** — never graded at all (§5 shows all four were gradable) |
| `TAUGHT` | 8 | correctly excluded |

The published *"refusals resting on an UNTAUGHT magnitude: 3"* is a property of the anchor, not a
census. **A classifying prefix decided the number, and the classes it silenced were the ones with
the most untaught content.** No repair proposed — the trace's own remediation is ALGO-096 §6.

## 7. What I deliberately did not do

No repair proposed, scoped, or implemented. No break-family gate touched (§5 forbids it, §7.2
owns it). No production file modified. Route C is not opened — ALGO-096 §7.3 records it has never
fired on real data (ALGO-036), and **Finding 1 strengthens that**: even the refusal it does emit
at his clocks is structural, so there is no untaught number here to retire. The §5 lane
(R2 + R2b + F1) is in flight and unaffected by this packet.

## 8. Retraction I owe on my own predecessor's record

ALGO-095 §3 stated the untaught magnitude behind the break family as *"the test calls range_ratio
and body_frac"*. **Measured, that is wrong** at every one of his clocks: neither number is
consulted. I publish the refutation of this desk's own claim myself, at source, per the standard
set at ALGO-013/019 — and note that both this error and the `force.py:123` error refuted by
ALGO-096 §3 came from the *same* `PROVENANCE` table mapping one label to one line. ALGO-096 §6.4
already forbids that. This packet is the second instance confirming the law was worth minting.

---

**Suite line (enumerated, not read off a tail).** Instruments run for this packet, by name:
`research/run_displacement_gate_subcause_redproof_2026_08_24.py` → **exit 0**, 3 witnesses × 5
planted defects = 15 flips, 3 published-flag flips **RED**, 3 restores identical, 1 positive
parse + 4 negative controls refused;
`research/run_displacement_gate_subcause_2026_08_24.py` → artifact written, self-check
`total_failures 0`, `unpinned_published_attributions 0`, verdict **SOUND**, 6 sessions.
No production test suite was run because **no production file was modified** — `git status`
carried only the three new diagnostic paths before commit.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
