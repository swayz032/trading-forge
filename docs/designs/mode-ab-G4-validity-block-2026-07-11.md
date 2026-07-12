# Mode A/B (G4) Validity Block — 2026-07-11

**STATUS: NON-DIRECTIONAL scaffolding. Read-ready pending 2 stragglers. The directional read (validity → direction → classifiability) is GATED to a single full-78 evening sitting — read ONCE (Law 3). No directional/verdict number is taken in this document.**

**Scope line (Law 7):** corpus = specbridge-120 → Mode A/B 78-spec subset · battery = Mode A/B overlay-OFF(A)/ON(B), full WF+CPCV+PBO+DSR · engine = G4 (`backtester.py` 8501 lines, sha256 `79570c4f..`, mtime 2026-07-09T17:53:08, HEAD `00c26184`) · snapshot = data_cache ratio_adj parquets stamped below · effective-N = §C8.

---

## §0 — Pre-commitment (Law 4, registered PRE-NUMBER, 2026-07-11 ~13:15 EDT)

Registered before any directional number exists, so the evening read cannot relitigate it:

> If spec 2 (`589ec512`) — or a restarted spec 1 (`ca5564d8`) — **cannot complete at solo (the safest possible config, MAX_CONCURRENT=1) on this tower**, it is excluded as **resource-infeasible**, documented with its runtime evidence (elapsed, OOM/freeze signature), effective-N adjusts, and the read proceeds on what completed. This is a **forced scope with a stated cause, decided before any number exists** — categorically distinct from choosing to read early. Solo has held all day, so this branch is not expected to fire.

---

## §R — Fork-resolution criteria + locked read order (Law 4, pre-committed 2026-07-11 ~14:30 EDT, PRE-NUMBER)

Ratified as the criteria for the evening read, applied mechanically, BEFORE the two readings' arms are seen.

**Record discipline on the prior "7".** The earlier classification ("7 pairs, OR-fix, terminal") was ratified on the then-current instrument and is NOT silently overwritten. The record carries the sequence: **7-classified → this block exposed the degenerate G0 `trade_count` counter → population revised to ~12 candidates → re-classification at the read under the same standards.** The mechanism ratified (OR-fix unconditional direction-correctness components; trigger-field evidence) **STANDS as a verified cause**; the population it covers is **REOPENED**. No classification extends by momentum — every candidate flip earns its label under the same per-pair standard (trigger fields wait_bias/confirm/direction present in its OWN config), or it is unexplained. Per the frozen 0.5 pre-reg: **any flip that does not classify = FULL STOP, not a scope note.**

**Fork-resolution criteria** (instrument choice: G0 daily_pnls activity vs G0 trade_count):
1. **Result-independence** — instrument chosen on instrument-quality grounds alone, before anyone sees which reading flatters which pair.
2. **Economic grounding beats derived counters** — a reading anchored in real events (nonzero-P&L days, actual fills) outranks the `trade_count` field now known to produce exactly-8 artifacts across 44 specs.
3. **Uniform application** — one instrument for all pairs; no per-pair instrument shopping.
4. **Tie-breaker: fail toward suspicion** — if quality grounds don't decide, take the reading generating MORE candidate flips to classify, never fewer (same failure-direction as the F-2 matcher).

**Pre-number resolution (result-independent, recorded before the verdict):** criteria 1+2 select the **economic daily_pnls activity instrument** over the degenerate trade_count counter. Selection made now, on instrument-quality grounds, blind to the arms. Per-pair *classification* waits for the full population.

**Instrument distinction (preserve exactly):** daily_pnls is the *activity* instrument — it answers "did G0 trade?" honestly **even when the trades themselves were bug-fires**; *why* it traded and *why* it stopped belong to the classification step. The instrument does not need the trades to be legitimate, only the record of them to be real.

**Locked evening read order** (one sitting, one read, when both straggler rows have appended):
1. Resolve the fork by the criteria above (instrument = activity). *Done pre-number.*
2. **Symmetric flip sweep — BOTH directions** (anomaly criterion is symmetric): down-flips (§C1) AND gain-flips (§C2b). *Earlier "0 upward anomalies" was on the degenerate counter → VOID; activity sweep replaces it.*
3. **Door-1 scoping (RULED, §C2c):** hard run-failures ONLY for the flip taxonomy; degenerate-fingerprint = cross-generation SCOPE MARKER, not exclusion; arm-identity re-check DONE (44/44 arms differ → 'overlay-invariant' dropped from the fingerprint).
4. Classify every candidate flip (both signs) per-pair under the CLOSED taxonomy. Neither-trigger-yet-flipped → **FULL STOP** (mesh intact).
5. Verify 331fe15a (§V) — now covers 2/3 valid baselines (331fe15a + MES sibling 5e5803d1).
6. THEN and only then: direction + classifiability on the full 78 — once (Law 3), with EVERY cross-generation magnitude/agreement claim SCOPED to the valid-baseline pairs (§C2c: `b2deddcb` clean pair + final-population additions).

**Closed classification taxonomy — exactly ONE label per candidate; no fourth label, no blend, no "probably":**
1. **OR-fix class** — per-pair trigger-field evidence (an unconditional component: wait_bias forced-direction OR confirm direction-discard) PLUS the direction-sensitivity that makes the mechanism bite. Same mechanism, either sign.
2. **Fidelity-artifact class** — verified per a §V-style spec (331fe15a's unsatisfiable-AND = type specimen); each proven from the compiled conditions, never asserted.
3. **Unexplained** — FULL STOP per the frozen 0.5 pre-reg. Does not soften near a verdict.

**Component-sign predictions (pre-registered before compiled evidence is read).** The OR-fix has TWO unconditional components with DIFFERENT sign predictions:
- **Component (i)** `_eval_wait_bias` forced-bullish — can only OVER-fire longs in G0 and suppress direction-constrained shorts. **Structurally CANNOT explain a long spec going G0-dead→G4-alive.**
- **Component (ii)** confirmation direction-discarding blend — suppresses EITHER direction (a long whose entry needed a confirmation the blend could never produce is unsatisfiable in G0, freed by the fix: 0→1200+ trades is exactly that shape).
- **Falsifiable prediction:** an OR-fix-class GAIN-flip config should carry **confirm:True** (with or without wait_bias). confirm:True → component-(ii) OR-fix class (two components, two signs, one fix). NEITHER trigger → prediction FALSIFIES → routes to fidelity-artifact-or-FULL-STOP on its compiled conditions. The sitting reads a prediction, not a rationalization.

Relay the fork resolution and each flip classification as they are made.

## §V — 331fe15a verification spec (mechanical; hypothesis, NOT concluded)

**Runs TWICE, per-pair** — 331fe15a(→0) AND its byte-identical sibling 5e5803d1(→2); each answer lands on its own (§C2c). (1) Parse the compiled structure; show the long-cross + short-cross conflation in ONE AND-group (`and_group0`: `[5-SMA-cross-above-50 → long]` AND `[5-SMA-cross-below-50 → short]`). **Type-specimen REVISED (pre-number, from the 0-vs-2 evidence): rare-condition-satisfiable, NOT strictly unsatisfiable** — identical structure firing 0 on MNQ/4h and 2 on MES/4h proves the conflated group is data-dependently satisfiable, not impossible. (2) Show G0's fires were bug-dependent (forced-bullish path or counter artifact — whichever the evidence says); account for each sibling's residual G4 fires (0 and 2) on its own data.
- **If verified:** classifies as a **fidelity artifact** — G4's zero is the honest reading of a mis-extracted spec — and becomes a named **H1 finding**: direction-conflated AND-groups are an extraction-defect class the Phase-1 fidelity instrument must catch at compile time (slots into the gradient work; a spec demanding both directions simultaneously is a compile-time absurdity a certificate should catch before an engine sees it).
- **If not verified:** it is an unexplained flip and the FULL STOP owns it.
The hypothesis does not become true by being convenient.

## §A — Activity-table boundary (steer call a, confirmed)

The pre-staged per-spec activity table is validity-tier ONLY while it carries **traded/not-traded per spec per generation + economic grounding** (nonzero-P&L days, fills) and **NO Mode-A-vs-Mode-B numbers** — activity is instrument evidence, overlay deltas are verdict. §C1 conforms (G0-side activity + trigger fields; no overlay-delta columns). §C7's "23/23" is a binary engagement count (Law 1), not overlay magnitudes. Line held.

---

## §C6 — Provenance (Law 2: generation × path × engaged-config)

**Engine (G4):** `backtester.py` — 8501 lines · sha256 `79570c4f8b088b90..` · mtime `2026-07-09T17:53:08` · git HEAD `00c26184`. Byte-stable since **before** the battery started (07-10 00:52) → no engine change mid-run.

**Engaged config:** `TF_ALLOW_FIXED_1=true` (inline at launch, Story-a parity) · `MAX_CONCURRENT_BACKTESTS` = 2 (phase-1 non-1m) / 1 (phase-2 1m solo) · overlay per-arm (A: `overlay_disabled=True`; B: `=False`) verified 50/50. **Four dormant default-ON features all OFF/absent common-mode across BOTH arms** (not a confound): `TF_OR_BRANCHES_ENABLED` (absent→OFF; so the OR-fix's *unconditional* direction-correctness half is what is live, not the flag-gated honoring), `VIX_TIERED_ATR_ENABLED` (absent), event_calendar (unfed), partial-fill (`request.fill_model` unpopulated).

**Dataset stamp** (battery stamped no `dataset_hash` — the Law-2 standing-equipment gap G0 also had; reconstructed here from filesystem content-hash). Symbol map: parquet `CL→MCL`, `ES→MES`, `NQ→MNQ`.

| symbol | tf | sha256(16) | bytes |
|---|---|---|---|
| CL | 1min | `8e357bbd2d956212..` | 22,236,104 |
| CL | 5min | `609808463579d768..` | 6,445,136 |
| CL | 15min | `fa131d808f8ad4b7..` | 2,998,714 |
| CL | 30min | `909e9ca0e2fd0b7a..` | 1,860,289 |
| CL | 1hour | `584e611f0f5c9565..` | 1,125,351 |
| CL | 4hour | `756c93ca4054672b..` | 357,527 |
| ES | 1min | `21a2931ba433e823..` | 24,286,815 |
| ES | 5min | `60aff2474adcd9c5..` | 6,528,042 |
| ES | 15min | `0bf3b820b8ef8b47..` | 2,930,671 |
| ES | 1hour | `607bd99deccf5e9c..` | 1,050,440 |
| NQ | 1min | `a1c194476a88eba6..` | 32,032,102 |
| NQ | 5min | `518dd4a974636a4f..` | 9,304,434 |
| NQ | 15min | `4069442e8daace5f..` | 4,079,996 |
| NQ | 1hour | `cad3eb7f646be28a..` | 1,301,878 |
| NQ | 4hour | `5a3293c710ab0d09..` | 377,787 |

---

## §C5 — Epoch / launch table (common-engine principle)

Battery spanned **2026-07-10 00:52 → 07-11 10:15 UTC (~34h wall)** across operational epochs (OOM deaths ×2, tower restart, split-by-weight reorg, phase-2 solo launch). **All epochs ran identical engine bytes** (mtime 07-09 17:53) **and identical engaged config** → epochs are OOM/restart/scheduling boundaries, **NOT engine or validity boundaries**. Common-engine principle holds; no engine-byte or env-semantics change occurred inside any stage.

| epoch | what | concurrency | note |
|---|---|---|---|
| 1 | phase-1 non-1m initial (15m/1h) | 2 | OOM death #1 (gap 04-07 UTC) |
| 2 | relaunch → tower restart + split-by-weight reorg | 2 | OOM death #2; partition by tf-weight |
| 3 | phase-1 non-1m steady (4h/5m) | 2 | 07-10 18 → 07-11 10:15, resumed PID 634 |
| 4 | phase-1 report written | — | 76→ report: 54 INDETERMINATE / 22 HELPS EDGE |
| 5 | phase-2 1m SOLO (stragglers) | 1 | PID 1608 launch → worker PID 4572, in flight |

*Watcher false-positive caught + logged (Law: verify the alarm instrument): the v1 4h-cap watcher wrote a DONE marker at 1m=7/9; recognized as a timeout artifact, not completion; deleted; replaced with v2 (writes DONE only on true 9/9, separate TIMEOUT flag).*

---

## §C4 — MCL data-gate exclusions (26, expected-abort with exact signature)

All 26 MCL (crude) specs INDETERMINATE on the data-quality gate (fires BEFORE strategy logic). Bad-bar counts are **monotonic with timeframe granularity** — the signature of one fixed ~19h calendar window sampled at increasing frequency, i.e. the **April-2020 WTI negative-settle event** (2020-04-20 14:00 → 04-21 09:15 ET), NOT corruption:

| tf | specs | zero/neg bars |
|---|---|---|
| 4h | 3 | 6 |
| 1h | 2 | 14 |
| 30m | 1 | 25 |
| 15m | 5 | 46 |
| 5m | 12 | 124 |
| 1m | 3 | 358 |

G0-parity (July baseline had identical MCL aborts) → not an A/B confound, but scopes **crude entirely OUT** of the effective read set. **NEVER clamp/floor/interpolate** — the negative prices are real.

---

## §C7 — Engagement + decision-variance (Law 1: overlay is not vacuously dead)

Overlay-flag correctness: **50/50** clean specs (Mode A `overlay_disabled=True`, Mode B `=False`). Decision-variance: **among all 25 TRADED specs, 25/25 show the overlay CHANGING the trade count** (Mode A ≠ Mode B). The overlay demonstrably engages on 100% of specs that trade — engagement evidence satisfied, not a vacuous-parity pass. The 26 `A==B` specs are all zero-trade (0==0, overlay has nothing to act on). One spec (`c029e162`, 1m) has a Mode-B error.

---

## §C1–C3 — Flip analysis (instrument-corrected). CLASSIFICATION HELD for advisor/evening read.

**Record discipline on the prior "7" (full sequence in §R).** The earlier "7 pairs, OR-fix, terminal" classification was ratified on the then-current instrument; it is NOT overwritten. Sequence: 7-classified → this block exposed the degenerate G0 counter → population revised to ~12 candidates → re-classification at the read. Mechanism (OR-fix direction components) STANDS as verified cause; population REOPENED. Every candidate earns its label per-pair, or is unexplained → FULL STOP (§R).

**§C3 — the G0 baseline `trade_count` is a DEGENERATE instrument.** Verified: **44 of 78** G0 clean specs report `mode_a` trade_count = **exactly 8** (= the WF window count; the "1-trade-per-window" broken-counter signature), ALL with `mode_a==mode_b==8` (overlay-invariant). Corroboration: `aaaad0f7` reports G0=8 vs **G4=609** (76× disagreement, identical input); `c029e162` reports 8 trades but **$1.6** total abs P&L (8 futures trades cannot net $1.6). G4 side: **0** specs at exactly-8, healthy spread (0:27, 848:2, 743:2, 609, 595…). → Cross-checking G4 zeros against G0 `trade_count` compares against a broken counter; the flip test is re-run on **actual activity (daily_pnls)**.

**§C2 — zero partition (27 G4 zero-trade specs):** 23 G0-`trade_count`>0→G4-zero "down-flips" + 4 G0-also-errored (no baseline) + 0 stable-zero. **0 upward anomalies** (G0-zero→G4-nonzero = 0 — no spec anomalously *started* trading in G4; 0.5 pre-reg ANOMALY criterion 1 is clean on the upside).

**§C1 — the 23 down-flips, instrument-corrected by G0 daily_pnls activity** (threshold ≥5 non-zero days & >$100 abs → 12 candidate-real / 11 negligible; threshold-dependent, reported as a bound). ALL 23 carry OR-branch/WAIT_BIAS/confirmation triggers (the OR-fix's blast-radius mechanisms):

| spec | sym/tf | name | G0 tc | G0 nz-days | G0 absP&L | wb | or | cf | class |
|---|---|---|---|---|---|---|---|---|---|
| `331fe15a` | MNQ/4h | long_opportunities_mnq_4h | 93 | 109 | 18117.9 | · | Y | Y | cand-REAL |
| `543874f8` | MES/4h | trade_era_scale_in_mes_4h | 8 | 10 | 2800.3 | Y | Y | Y | cand-REAL |
| `534ca8ea` | MES/4h | buy_trades_in_counter_tren | 8 | 10 | 2800.3 | Y | Y | Y | cand-REAL |
| `d3d2d55f` | MNQ/4h | trade_era_scale_in_mnq_4h | 8 | 9 | 885.3 | Y | Y | Y | cand-REAL |
| `0f3a1418` | MNQ/4h | buy_trades_in_counter_tren | 8 | 9 | 885.3 | Y | Y | Y | cand-REAL |
| `4be0db1d` | MES/15m | bos_and_fvg_or_fvg_mes_15m | 8 | 6 | 8553.6 | Y | Y | · | cand-REAL |
| `a18406a7` | MES/15m | long_entry_mes_15m | 8 | 6 | 8553.6 | · | Y | Y | cand-REAL |
| `fb2e92ab` | MES/1h | jump_in_downtrend_mes_1h | 8 | 6 | 3277.4 | Y | Y | Y | cand-REAL |
| `9b871b65` | MNQ/30m | discount_price_to_buy_from | 8 | 6 | 2396.0 | · | Y | Y | cand-REAL |
| `913f40c4` | MNQ/15m | bos_and_fvg_or_fvg_mnq_15m | 8 | 5 | 5902.9 | Y | Y | · | cand-REAL |
| `93534762` | MNQ/15m | long_entry_mnq_15m | 8 | 5 | 5902.9 | · | Y | Y | cand-REAL |
| `0dfd11ee` | MNQ/1h | jump_in_downtrend_mnq_1h | 8 | 5 | 2700.2 | Y | Y | Y | cand-REAL |
| `979ba21b` | MES/30m | discount_price_to_buy_from | 8 | 4 | 967.5 | · | Y | Y | negligible |
| `9955f721` | MNQ/5m | opening_range_breakout_orb | 8 | 2 | 333.0 | Y | Y | Y | negligible |
| `84928232` | MNQ/5m | new_high_acceptance_mnq_5m | 8 | 2 | 333.0 | Y | Y | Y | negligible |
| `ff718865` | MNQ/5m | breakout_capture_mnq_5m | 8 | 2 | 333.0 | Y | · | Y | negligible |
| `c1217b13` | MNQ/5m | hammer_candle_long_side_mn | 8 | 2 | 333.0 | Y | Y | Y | negligible |
| `fc4bf082` | MES/5m | opening_range_breakout_orb | 8 | 2 | 98.5 | Y | Y | Y | negligible |
| `85776068` | MES/5m | breakout_capture_mes_5m | 8 | 2 | 98.5 | Y | · | Y | negligible |
| `f6ff3004` | MES/5m | new_high_acceptance_mes_5m | 8 | 2 | 98.5 | Y | Y | Y | negligible |
| `710a9ed3` | MES/5m | hammer_candle_long_side_me | 8 | 2 | 98.5 | Y | Y | Y | negligible |
| `81002a32` | MES/1m | manipulation_trade_mes_1m | 8 | 1 | 11.2 | Y | Y | Y | negligible |
| `c029e162` | MNQ/1m | manipulation_trade_mnq_1m | 8 | 1 | 1.6 | Y | Y | Y | negligible |

**§C2b — SYMMETRIC gain-flip sweep (G0-clean-dead → G4-traded, ACTIVITY instrument).** The OR-fix predicts the opposite sign; the pre-reg anomaly criterion is symmetric. TRUE gain-flip candidates = G4-traded specs with a CLEAN-but-dead G0 baseline (≤1 non-zero P&L day). Classification held for the sitting under the closed taxonomy + the §R component-(ii) confirm:True prediction (**confirm** column is the pre-registered signature):

| spec | sym/tf | name | dir | G0 tc | G0 nz-days | G0 absP&L | G4 traded | wb | or | confirm |
|---|---|---|---|---|---|---|---|---|---|---|
| `67d67ba0` | MNQ/1m | bullish_candle_formati | long | 8 | 1 | 1.6 | 1230 | · | Y | **Y** |
| `f3babbdd` | MES/1m | bullish_candle_formati | long | 8 | 1 | 11.2 | 1551 | · | Y | **Y** |
| `ca5564d8` | MNQ/1m | avoiding_two_mistakes_ | long | 8 | 1 | 1.6 | 1214 | Y | Y | · |
| `589ec512` | MES/1m | avoiding_two_mistakes_ | long | 8 | 1 | 8.7 | 1538 | Y | Y | · |

TRUE gain-flip candidates: **4** (all 1m LONG). Staged signature read (routing at sitting): **2 carry confirm:True** → component-(ii) prediction holds for those; the remainder carry wait_bias-not-confirm → component-(i) structurally cannot explain a long gain → flagged AMBIGUOUS for per-pair read. The all-long direction mix does NOT fit forced-bullish-suppresses-shorts — the confirm signature is what discriminates, exactly as pre-registered.

**No-G0-baseline (exits the flip taxonomy — a G0-error has no side to flip from; forcing it in blends "changed" with "unmeasured"):**
| spec | sym/tf | name | G0 disposition | G4 |
|---|---|---|---|---|
| `ae7a2560` | MES/15m | long_entry_or_short_en | G0 ValueError: RECONCILIATION FAILED: equ | traded 705 |

Disposition (Law 7 per-read scoping): **EXCLUDED** from the G0→G4 shift read (no baseline to compare); **INCLUDED** in the within-G4 Mode-A-vs-B read IF its G4 run is clean. Cause stated (Defect-4 reconciliation INDETERMINATE). *Straggler spec-2 (`589ec512`, MES mirror of `ca5564d8`) may join the true-gain class on landing → the same confirm:True signature check applies identically, nothing assumed from the sibling.*

### §C2c — G0 baseline-validity precondition (door-1 evidence, pulled pre-number)

Per the ruling, before the 1m specs enter the flip taxonomy their G0 baseline is checked for run-validity. Result: **neither specified tell fires as hoped.**
- **Runtime tell — NEGATIVE.** G0 1m specs each ran **~2.7h** (589ec512 2.78h, ca5564d8 2.73h, bullish_candle pair 2.71h, manipulation pair ~2.70h) — real multi-hour runs, NOT truncated-to-minutes. G4 takes 5–9h (2–3×, explained by G4's added analytics). The truncation hypothesis does not hold.
- **Completeness tell (wfe/pbo/b14_ci) — NO DISCRIMINATING POWER.** wfe=None AND pbo=None for **all 47** G0 clean specs — the 44 exactly-8 AND the 3 genuinely-traded (`b2deddcb` tc=485/410 days, `331fe15a` tc=93/109, `5e5803d1` tc=82/94). A G0-wide reporting gap, not a valid/degenerate separator.
- **The exactly-8 degeneracy is CORPUS-WIDE, not 1m-specific.** All 44 exactly-8 specs (1m + non-1m) share: tc=8 (=WF window count), mode_a==mode_b (overlay-invariant), dsr∈{0.0,1.0}, sharpe∈{±0.5}, wfe/pbo None, 1–10 non-zero P&L days. The ONLY signal separating them from valid-G0 is the **activity instrument itself** (non-zero-days / tc-diversity) — not an independent run-validity tell.

**Door-1 RULING (operator, 2026-07-11 ~15:30 — (a)/(b) was a false dichotomy fusing two questions; separated):**
- **Flip taxonomy → (b):** door-1 reserved for HARD run-failures (ae7a2560's reconciliation error) ONLY. The exactly-8 fingerprint does NOT waive classification — (a) would be a bulk waiver lifting the engine-validation net off 94% of the corpus in one motion; if even one exactly-8 spec flipped for a reason unrelated to the verified mechanism (a 5th dormancy, an unknown fix side-effect), (a) guarantees we never look. Criterion-4 (fail toward suspicion) applied to the fork itself. Every exactly-8 spec earns a per-pair label; **neither-trigger-yet-flipped → FULL STOP** (the mesh (a) would have cut).
- **Cross-generation claims → (a) as SCOPE MARKER, not exclusion:** the degenerate-G0 fingerprint (tc=8 broken counter, quantized dsr∈{0,1}/sharpe∈{±0.5}, absent wfe/pbo) disqualifies those 44 pairs from before/after MAGNITUDE or overlay-agreement claims. For them the only cross-gen sentence allowed is the classification itself. Richer before/after reads live ONLY on valid-baseline pairs.

**Fingerprint refinement — arm-identity re-check (done, result-independent):** the `mode_a==mode_b` component was the BROKEN COUNTER, not behavioral identity. Re-judged on the activity instrument (P&L-day patterns, not counts): **44/44 exactly-8 specs have mode_a activity ≠ mode_b activity.** Zero truly overlay-uninformative. So 'overlay-invariant' DROPS from the fingerprint; G0's overlay carried real information the counter hid (fail-toward-more-information). The degenerate call now rests on tc=8 + quantized-stats + absent-analytics alone.

**Valid-baseline comparison surface (the 3 non-exactly-8 G0 specs — the only pairs that may carry richer cross-gen claims):**
| spec | sym/tf | strategy | dir | G0 (tc/nz-days) | G4 (tc/nz-days) | role |
|---|---|---|---|---|---|---|
| `b2deddcb` | MNQ/15m | long_entry_or_short_entry | both | 485 / 410 | 716 / 701 | **clean both-traded before/after pair** |
| `331fe15a` | MNQ/4h | long_opportunities | both | 93 / 109 | 0 / 0 | full flip; §V candidate |
| `5e5803d1` | MES/4h | long_opportunities | both | 82 / 94 | 2 / 2 | near-full flip; §V SIBLING of 331fe15a |

`331fe15a` is the exam's most load-bearing single spec: 1-of-3 valid baseline × real down-flip × §V type-specimen. Two pre-registrations on the valid surface (both NOW, pre-number — the surface is precious so its members get MORE scrutiny, not an exemption):

**PRE-REG (b2deddcb count-classification duty).** Its **485→716 (+231, +48%)** count change must classify BEFORE the directional read anchors on it — count-stability is not flips-only; an unexplained count change is **ANOMALY criterion 2 (unmodeled interaction) → FULL STOP**. Candidates (label at sitting, trade-level evidence): Defect-10 (b)-class occupancy-freed (removed look-ahead trades free slots — receipt documented "freed bigger losers"); OR-fix component-(ii) gain (**config carries confirm=True → candidate viable**); or (c) timing-shifted. One with evidence → it anchors the directional read with its delta explained; none → the pre-reg's own stop applies to the exam's best pair.

**PRE-REG (§V runs TWICE, per-pair — NOT inheritance).** `331fe15a`(→0) and `5e5803d1`(→2) have **BYTE-IDENTICAL compiled structure** (verified: same 6 and_groups, same conflated `and_group0` = 5-SMA-cross-above-50+long AND 5-SMA-cross-below-50+short). So the 0-vs-2 split is NOT structural — and it **falsifies strict-unsatisfiability** (an unsatisfiable group is exactly 0 in BOTH). Corrected §V type-specimen: **rare-condition-satisfiable bidirectional-confirmation conflation** (the rare long+short co-confirmation never aligns on MNQ/4h → 0, aligns twice on MES/4h → 2; data-driven, same fidelity defect). §V is run once per spec; 5e5803d1's 2 residual trades get their own account under the same method. "§V decides 2/3 of the surface" is the HYPOTHESIS the two runs confirm or split. *(This pre-reg's prior form — advisor-predicted "residual trades ⇒ structure differs" — was FALSIFIED by the byte-identical evidence; logged, corrected, sharper. Two-path rule's 3rd catch this week, this one falsifying the advisor seat.)*

**TWO-AXIS separation (each cratering sibling carries TWO independent per-pair questions; a spec can be OR-fix on one AND artifact on the other — the record holds both, no blend):**
1. **MECHANISM (flip axis):** a rare-satisfiable structure fired 93/82× in G0 — something made the rare group fire regularly (a bug bypassing part of the AND). Trigger fields present → OR-fix class; absent → the G0 firing is itself unexplained → the FULL-STOP mesh catches it.
2. **FIDELITY (§V axis):** is the long-cross-AND-short-cross conflation what the transcript actually demands, or an extraction artifact? Answered from compiled conditions vs the source, INDEPENDENT of why G0 fired.
Both land per-pair at the sitting; neither answer substitutes for the other.

**The one clean anomaly — `331fe15a` (MNQ/4h `long_opportunities`, G0=93 trades/109 days/$18.1k → G4 zero).** Not an exactly-8 artifact. CANDIDATE cause (hypothesis, verify at read): direction=BOTH; `and_group0` conflates `[5-SMA-cross-above-50→long]` AND `[5-SMA-cross-below-50→short]` into ONE **AND** group → **unsatisfiable** (5-SMA cannot be simultaneously above and below 50-SMA). G4's corrected confirmation-direction logic finds it unsatisfiable → 0 (arguably *correct*); G0's confirmation-direction-*discard* bug fired it anyway → 93. **This points at extraction fidelity (a bidirectional strategy compiled to an unsatisfiable AND group), not an engine-validity defect.**

**The interpretive fork (JUDGMENT — held for advisor/evening read, not resolved here):**
- **Reading A ("expected fix-working"):** G0's spurious signals came from the pre-fix direction bugs; G4 correctly zeroes them; flips are *expected*, not anomalies.
- **Reading B (strict 0.5 pre-reg):** every zero↔nonzero flip is an ANOMALY (criterion 1) needing per-spec adjudication before the read; ~12 candidate-real is a non-trivial population touching effective-N.

---

## §C8 — Effective-N (Law 7) — FINAL @ 78/78

| stage | N | cause |
|---|---|---|
| launched (strategy_list) | 78 | — |
| − stragglers pending (1m) | −0 | ca5564d8, 589ec512 (in flight; §0 branch if solo-death) |
| = done | 78 | — |
| − MCL data-gate | −26 | April-2020 negative-settle (crude untested) |
| − OOM / other errors | −0 | **0** (all 26 errors are MCL) |
| = clean-ran (effective-N) | **52** | MES/MNQ only |
| — of which TRADED (informative) | 25 | overlay engaged 23/23 |
| — of which zero-trade | 27 | 23 down-flips (classification held) + 4 G0-err |

**Effective-N (current) = 50 clean-ran** (MES/MNQ), traded-informative = 23. The 2 stragglers (both 1m, potentially traded-informative) append to this line when they land; if the §0 resource-infeasible branch fires, effective-N holds at what completed with the cause stated.

---

*Assembled 2026-07-11 while phase-2 1m stragglers complete. No directional number read. Next: append straggler rows → full-78 validity→direction→classifiability read, one evening sitting.*
