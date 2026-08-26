# ALGO-100A — the N5 independent grade receipt, published verbatim by the advisor seat.

**Publisher note (advisor, trading-forge-49):** grader = accuracy-validator, dispatched by this desk per ALGO-098 N5 / ALGO-100; pins graded 62722a2a / 7d42d121 / 56d9360d / 46b21920; packet 748cee33. The receipt below is byte-verbatim from the grader's durable file. Consequence routing is in the commit subject; ALGO-101 folds it in.

---

# N5 INDEPENDENT ADVERSARIAL GRADE — ALGO-099

**Grader:** accuracy-validator (N5). **Doer ≠ grader:** I wrote none of this code, none of these
artifacts, and no prior grade in this lineage. I read no chat; every statement below is traced to a
committed artifact or to a command I ran.

## 0. PINS — and a head that moved mid-grade

| object | pin I graded | note |
|---|---|---|
| batch head H1 | `62722a2a9e6d6ed7ac7f535e95b36d92a8d6121a` | `research/current-mnq-strategy-v2-4-zone-first-candles` |
| R2c | `7d42d121b9b9c6f30c383502a99637855bdf2104` | `research/algo-r2c-momentum-after-20260825`, parent `5b488564` |
| baseline | `56d9360d34829d53a9c00fb0c9bd7930463450b3` | 40-approval arm |
| prior head | `46b219206aad6b4fd7b6bb02a458afdae8d1fac0` | 143-approval arm |
| packet | `748cee33` (= `origin/external-advisor/gpt-rulings-algo`) | read via `git show`, never checked out |

**MEASURED HERE — the strategy head MOVED during this grade.** `wt-mnq-v24` is at `0dfff6be`, one
commit past my pin, committed `2026-08-25 22:19:48 -0400` — 72 seconds after the packet commit
(`748cee33`, 22:18:36). `git diff --stat 62722a2a 0dfff6be` is exactly one file:
`research/_algo096_guard_2026_08_24/r2c_fields_0800.json` (+3189). That is the artifact the packet
declares **OPEN** in §6c(3). **My verdicts describe `62722a2a`**, where the item is genuinely open.
The local branch ref `external-advisor/gpt-rulings-algo` is at `eef9e34f`, NOT the packet pin;
only `origin/…` carries `748cee33`. Naming the wrong ref would have graded a different document.

**The head moved a SECOND time before I finished.** By the end of this grade `wt-mnq-v24` was at
`6888112d` — "ALGO-100 s2: THE REVERT. R2 + R2b + F1 out; the 40 baseline reproduces EXACTLY by
key." So the batch this packet reports on has since been reverted. **That revert is NOT graded
here**; nothing in this receipt describes `0dfff6be` or `6888112d` except where explicitly named.
A verdict names the hash it describes, and mine names `62722a2a` / `7d42d121`.

Worktrees I created (detached, removed at the end): `wt-n5a`@62722a2a · `wt-n5b`@7d42d121 ·
`wt-n5c`@56d9360d · `wt-n5d`@46b21920. All four removed; `wt-mnq-v24` and `wt-algo-r2c` verified
clean (`git status --porcelain` empty) and unmodified by me.

## 1. VERDICTS BY CLAIM

Path A = my own re-derivation from the ROW DATA of the capture JSONs, in a script that imports
nothing from the guard dir (`/c/Users/tonio/AppData/Local/Temp/a96/n5/mine.py`).
Path B = re-running the capture instrument myself at `7d42d121`.

| # | claim | verdict |
|---|---|---|
| 1 | control survives by key at both pins, clock reported | **CONFIRMED** |
| 2 | sessions silenced = 0 | **CONFIRMED** |
| 3 | R2c: 111, −32/+0; 03-24 hit survives, 04-09 hit killed | **CONFIRMED (kill token); PARTIALLY UNVERIFIABLE (refusal token)** |
| 4 | 37 early Route-A at head, 26 under R2c, split 10·3·4·3·6 | **CONFIRMED** |
| 5 | 03-23 / 03-31 not claimed as recovery | **CONFIRMED** |
| 6 | 03-24 / 04-06 / 04-09 reported, not claimed | **CONFIRMED** |
| 7 | no PnL / outcome / winner-loser / clean-edge read | **CONFIRMED (with one token named)** |
| 8 | same instrument at two commits; 40 and 143 reproduce | **CONFIRMED for the 40/143 arms; REFUTED for the R2c arm** |
| 9 | R2c clause magnitude-free; red-proof goes RED when reverted | **CONFIRMED** |
| 10 | F1 clause removed; pin re-aimed at `efficient`'s `progress > 0`, RED when loosened | **CLAUSE REMOVAL CONFIRMED; PIN ATTRIBUTION REFUTED** |
| 11 | 143 identical by key+target vs 46b21920; baseline exactly 40 | **CONFIRMED** |
| 12 | ALGO-070 walk over the 103 additions | **CONFIRMED** |
| 13 | kernel.py:201-208 selection; no FIRST_A_PLUS predicate in research/ | **CONFIRMED as scoped; packet's own "anywhere" is OVERBROAD** |
| — | the OPEN sub-table leaks no number | **CONFIRMED — no leak** |

### Claim 1 — control, by key. CONFIRMED.
MEASURED HERE, five arms, all carrying the same survivor:
`B_NORMAL_BREAKOUT|L|SWING:R:2026-04-14T09:15:00-04:00:102865|2026-04-14T09:38:00-04:00`,
`survivors_to_ranking 1`, depth 5 `SURVIVED_TO_RANKING`, band `[25714.66964285714,
25717.83035714286]`, reason `FIRST_BREAK_PRINT_THEN_INTRA5_FORCE` — in `ct_before_0800`,
`ct_after_0800`, `ct_r2c_0800`, `ct_before_0930`, `ct_after_0930`. Decision clock `09:38` in all
five; his clock is `09:36`; **it did not slide.**
In the membership capture the control key `['2026-04-14','2026-04-14 09:38:00-04:00','L','BRK5']`
is `1 -> 1` and identical on **key + target + target_kind + target_band + path_reason**
(`25869.0 FVG_15M`, band `[25811.5, 25926.75]`) in every one of six arm-pairs I compared.

### Claim 2 — silenced = 0. CONFIRMED.
Path A, both pins: 0 sessions went from ≥1 approval to 0. Membership is a strict lattice —
`baseline(40) ⊂ r2only(89) ⊂ head(143)` and `baseline(40) ⊂ r2c(111) ⊂ head(143)`, all four
subset tests True — so silencing is impossible by construction here, which is a stronger result
than the count.

### Claim 3 — the R2c capture and the two hits. CONFIRMED / PARTIALLY UNVERIFIABLE.
MEASURED HERE from row data: `after_0800` → `r2c_0800` is **143 → 111, additions 0, removals 32,
target moves 0**. 03-24 hit `A_NORMAL_REJECTION|L|S:2026-03-24T00:15:00-04:00:96923|2026-03-24T09:32:00-04:00`
**SURVIVES** under R2c (`ct_r2c_0800`, depth 5, `authority_state GRANTED`). 04-09 hit at
`SWING:S:2026-03-17T22:30:00-04:00:100322` is **KILLED** — `survivors_to_ranking 1 → 0`.

`killed_at=REJECTION_STORY_INCOMPLETE` is **derivable** from the row data by conservation, not
merely asserted: at 04-09 the candidate population is 89 on both sides and the gate histogram is
`FORCE_NOT_CONFIRMED 6→6 · INTRA_15M_FORCE_NOT_CONFIRMED 4→4 · NO_LEGAL_ROUTE_MATCHED 17→17 ·
REJECTION_STORY_INCOMPLETE 61→62 · SURVIVED_TO_RANKING 1→0`. Exactly one candidate changed class,
and it is the former survivor. **CONFIRMED.**

**`authority_refusal=COUNTER_BIAS_REVERSAL_WITHOUT_COMPLETED_CONTROL_TRANSFER` is NOT traceable to
any committed artifact.** The candidate table stores `authority_refusal` only on the
deepest-gate-by-key row; at 04-09 under R2c that row is a *different* key
(`B_NORMAL_BREAKOUT|L|SWING:R:2026-03-02T15:30:00-05:00:100400|…11:36`, gate
`INTRA_15M_FORCE_NOT_CONFIRMED`, `authority_refusal: null`). Repo-wide grep at both pins finds the
token only in `early_bullet_census.json` (a different session's record) and in
`derivation.py` (its definition site) — **never in `ct_r2c_0800.json`**.
*Positive control:* the same grep over the same files returns `REJECTION_STORY_INCOMPLETE` 8× in
each of the five `ct_*.json`, so the method finds refusal tokens in these artifacts when present.
The packet §6c(2) states it as a measured X-ray record; it is **RELAYED from an uncommitted run**.

### Claim 4 — early Route-A approvals. CONFIRMED, exactly.
Path A, additions strictly before his clock, `setup == REV`, convicted days only:

| arm | total | 03-23 | 03-24 | 03-31 | 04-06 | 04-09 |
|---|---|---|---|---|---|---|
| batch head (08:00) | **37** | 19 | 3 | 6 | 3 | 6 |
| R2c (08:00) | **26** | 10 | 3 | 4 | 3 | 6 |
| R2+R2b only | **15** | 4 | 2 | 5 | 2 | 2 |
| 09:30 pin, head | **12** | 8 | — | — | 1 | 3 |

Both amended splits match to the row. **The join key is sound and I checked it rather than
assuming it**: `research/current_mnq_strategy_v2_4_kernel.py` has exactly three
`core.Candidate(` construction sites — line 335 (`"REV"`), 372 (`"BRK5"`), 386 (`"BRK15"`) — and
the only `"REV"` site sits inside the block whose authority call is `route=auth.ROUTE_A_REJECTION`
(line 332). So `setup == REV` ⟺ granted by Route A. (`early_bullet_census.json` carries a
`join_key_warning` that setup and route are different taxonomies; that warning is about C/D
collapsing into the break family, **not** about A/REV, so it does not bite here.)

F1 attribution also survives its join check: the 15 early approvals in `r2only` are a strict
**subset** of the 37 at the head (`r2_early <= head_early` True, 0 rows outside), so
`37 − 15 = 22` is a real set difference, not subtraction of two independently-counted totals.

### Claims 5 & 6 — reported, not claimed. CONFIRMED.
Packet §2 records 03-23 `+19` and 03-31 `+6` in the failure table and §0's rubric row 5.5 reads
"reported, not claimed"; no sentence anywhere asserts recovery on those days. §5.3 is labelled
**PASS (expected NO)** with the survivor named by key — a reported observation, and the packet
explicitly re-tests it at the right layer after catching its own layer error (§6a). ARTIFACT-SOURCED.

### Claim 7 — no outcome field. CONFIRMED, with the one token named.
MEASURED HERE. Grepping `pnl|rpnl|realized|outcome|winner|loser|clean_edge|exit|profit|win|loss`
over all five instruments: every hit is a *declaration* string except four in
`run_algo096_candidate_table_six_clocks.py` (lines 110, 118, 151) of the form
`r.get("outcome") == "SURVIVED_TO_RANKING"`. That is the X-ray's **gate disposition** field, not a
trade result — token class is not semantic class, and I read the executable line rather than the
token. A recursive key-scan over all 16 artifact JSONs finds no outcome-shaped key except the
`no_pnl` declaration itself. *Positive control:* the same pattern matches
`research/current_mnq_strategy_v1.py` and three siblings, so the grep is live.

### Claim 8 — the instrument. CONFIRMED for the 40/143 arms, REFUTED for the R2c arm.
MEASURED HERE: `run_approved_entry_membership_capture.py` is **byte-identical** at `56d9360d` and
`46b21920` — same blob `5c0a1ff9b0d48b404dbe7e3abd76fac46bedb89a`, md5 `31936e980e8770ac937dc3b6a9015507`.
Same instrument, different code, exactly as designed.

**But `r2c_0800.json` was NOT produced by the instrument committed at the R2c pin.** At `7d42d121`
the capture is blob `305cc9b308132260b22fe536df733d2996677336` and emits **13 fields per row**;
every row in `r2c_0800.json` carries **5** (`key, target, target_kind, target_band, path_reason`).
The artifact therefore came from the older instrument run against an R2c tree that no commit
pins. The packet declares this ("`r2c_0800.json` was produced before N0 added `story_kind`"), so
it is disclosed, not hidden — but the consequence stands: **no commit names the instrument that
produced the R2c capture**, and the R2c arm is the one arm whose instrument cannot be pinned by
hash. Marked REFUTED against the claim's literal wording ("the SAME script at two commits").

### Claim 9 — R2c is magnitude-free and has a path to red. CONFIRMED.
MEASURED HERE at the executable line (`derivation.py`, diff `5b488564..7d42d121`):
`follow = (float(trigger.high) > float(last.high)) if direction == "L" else (float(trigger.low) < float(last.low))`
— OHLC against OHLC, no `body_frac`, no `close_loc`, no `reject_wick`, no numeric literal.
**Red-proof by in-memory source mutation** (no tracked file touched):

| arm | refuse-test | accept-test |
|---|---|---|
| unmutated @7d42d121 | GREEN | GREEN |
| R2c reverted to `close > close` | **RED** | GREEN |

The guard genuinely fails without the guarded property.

### Claim 10 — CLAUSE REMOVAL CONFIRMED; PIN ATTRIBUTION REFUTED.
The removal is real: `git diff 46b21920 62722a2a -- research/current_mnq_strategy_v2_4_force.py`
deletes `and geometry` from the `confirmed` conjunction and keeps `geometry` as a recorded field.
Entailment verified at the executable lines: `_directional_body` returns `bool(c > o)` for L, and
`progress = float(c - o)`, so `geometry ⟺ progress > 0`, and `efficient` requires `progress > 0`.

**But the pin does NOT ride on `efficient`'s `progress > 0`.** MEASURED HERE on the committed
fixture of `test_F1_a_non_directional_forming_candle_is_refused_BY_THE_GEOMETRY_CLAUSE`:

| mutation | reason emitted | test |
|---|---|---|
| none @62722a2a | `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` | GREEN |
| `_directional_body` → always True | `TUG_OF_WAR_PATH_TOO_INEFFICIENT` | **RED** |
| `efficient`'s `progress > 0` removed | `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` | GREEN |
| `efficient` forced True | `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` | GREEN |

The pin rides on **geometry**, and it does have a path to red — via geometry, not via `efficient`.
The packet's own §5 wording is accurate ("Loosen geometry and that same candle comes back as
`TUG_OF_WAR_PATH_TOO_INEFFICIENT`"); it is the **claim as briefed** that mis-names the clause.

### Claim 11 — N0's positive control. CONFIRMED.
Path A: `after_0800` (46b21920) vs `n0_fields_0800` (62722a2a) — **143 → 143, 0 added, 0 removed,
0 target moves, 0 target_kind moves**, control identical. Baseline `before_0800` totals **exactly
40** across 14 sessions (7+5+3+4+0+1+5+1+1+3+3+5+1+1).

### Claim 12 — the ALGO-070 walk. CONFIRMED, re-derived from `story_kind`, never from the summary.
103 additions, **join failures 0** against `n0_fields_0800`:
- **(iv)** zone states `TESTED 63 · ACTIVE_SUPPORT 12 · FLIPPED_RETEST 11 · ACTIVE_RESISTANCE 9 ·
  NO_ZONE_ON_LOCATION 8` — **0 BROKEN**.
- **setups**: 103/103 `REV`. `entry_location_id` null on 0; `story_kind` null on 0.
- **(i)/(ii)** forms: `touch_and_reject 67 · prior_momentum_after_rejection 28 ·
  sweep_and_reclaim_with_control 6 · failed_breakout_back_inside_with_control 2` = 103.

**The boundary, which the packet does not draw:** across all 143 approvals at the head there ARE
**6 rows on `ZoneState.BROKEN`** — but all six are `BRK5`, all six are in the baseline 40, and none
is an addition. So clause (iv) ("not **Route A** on a BROKEN zone") holds even on the wider
population, and the claim survives the neighbour it excludes. The baseline 40 is 39 BRK5 + 1 REV,
which is why the Route-A over-grant framing is sound.
*Residual:* 8 of the 103 carry `NO_ZONE_ON_LOCATION`, so for those (iv) is vacuous rather than
affirmatively verified. Not a defect; a scope limit.

### Claim 13 — the selection code and the FIRST_A_PLUS absence. CONFIRMED as scoped.
`research/current_mnq_strategy_v2_4_kernel.py:205-208`, read verbatim:
```
rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
cand = max(candidates, key=lambda c: (
    rank[c.setup], c.location.quality, c.location.confluence,
))
```
inside `_rank_and_yield` (def at 201), with `actionable.time() > core.LAST_ENTRY` and
`actionable > as_of` cutoffs after it — a within-bucket tie-break plus clock order, exactly as
claimed.

**Absence, with a planted positive control.** Pattern
`def [a-z_]*a_plus|def is_a_plus|A_PLUS[A-Z_]* *= *[0-9]|class [A-Za-z]*APlus|a_plus_gate|setup_grade|quality_gate`.
Against a planted file containing `A_PLUS_MIN_QUALITY = 0.72`, `def is_a_plus`, `class APlusGate`,
`def first_a_plus` the pattern **fires on all four**. Over `research/` at `62722a2a` the only hits
are `data_quality_gate` (a *data*-quality function) and `quality_gate` inside spec.json strings —
**no definition-shaped FIRST_A_PLUS predicate**. All 15 `A_PLUS` occurrences in `research/*.py`
are status strings.

**The packet's own sentence is overbroad.** §6c says FIRST_A_PLUS "has NO implementing predicate
**anywhere**". Repo-wide there IS `src/engine/a_plus_market_auditor.py` (plus
`tests/test_a_plus_gate_parity.py` and migration `0067_a_plus_market_scans.sql`). Reading it
settles that it is a *different object*: a challenger-only, advisory **pre-market market
selector** scoring MES/MNQ/MCL by `0.40*vol + 0.40*p_target_hit + 0.10*(1−noise) + 0.10*entangle`,
with no execution authority and no per-setup grade. So the **finding is correct and the scoping to
`research/` is correct**; only the word "anywhere" is unbounded.

### The OPEN sub-table — no leak. CONFIRMED.
Every `26` in the packet is a count or the per-session split (§6c(3): 03-23:10 · 03-24:3 ·
03-31:4 · 04-06:3 · 04-09:6 — which I re-derived exactly). The form names appear only twice: at
line 214 scoped to the **103 additions**, and at lines 478-479 for the **single 04-09 survivor**.
No form distribution of the 26 is stated, estimated or inferred anywhere.

## 2. NOVEL HUNT — what the rubric did not ask

### Discrepancy F-1: the F1 reason token now names a clause that cannot refuse anything
**Severity:** MEDIUM (silent disagreement between an emitted label and the gate it describes)
**Claim:** packet §2d — "It is out of the conjunction, still computed for the reason chain so
`PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` still names the refusing clause."
**Reality:** after F1's removal `geometry` is not in `confirmed`, so it refuses nothing — ever.
Because `geometry ⟺ progress > 0` and `efficient` requires `progress > 0`, `¬geometry ⟹ ¬efficient`:
**every** emission of `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` is now a case where `efficient` is the
actual cause of `confirmed=False`. Measured directly: at the committed fixture the token is emitted
while `confirmed=False` is caused by `efficient=False` (progress −2.5, efficiency −1.0 vs
body_frac 0.62); forcing `efficient` True does not change the token.
**Sources compared:** `force.py:175-181` (conjunction, `geometry` absent) | `force.py:183-193`
(reason chain, `elif not geometry` still first) | my mutation run (3 arms).
**Source of truth:** the conjunction. A clause outside it cannot be a refusal cause.
**Fix point:** `research/current_mnq_strategy_v2_4_force.py:186-187` — the `elif not geometry:`
branch should either be re-labelled as an observation token or moved below `efficient`.
**Repro:** `python /c/Users/tonio/AppData/Local/Temp/a96/n5/redproof10.py`
**Blast radius:** anything that buckets refusals by reason token — the candidate table's
`gate_histogram` and `killed_at` chains, and any future "which clause refused" census. This is the
desk's own `A GATE LABEL IS NOT A SUB-REASON` law recurring one layer down.

### Discrepancy F-2: the no-fraction guard covers only the first physical line of a two-line clause
**Severity:** MEDIUM (a check with no path to red on half its surface)
**Claim:** `test_R2c_introduces_no_fraction` — "R2c must introduce no magnitude".
**Reality:** the test does `[ln for ln in src.splitlines() if "follow = " in ln]`. The R2c clause is
a backslash continuation across two physical lines; only the **LONG** branch contains `follow = `.
A magnitude planted on the continuation line (the **SHORT** branch) passes the guard.
**Sources compared:** planted `… else (float(trigger.low) < float(last.low) - 0.62)` → guard
**GREEN (no magnitude seen)** | positive control, same `0.62` on the first line → guard
**RED (caught '0.')**.
**Source of truth:** the positive control — the guard works, its surface does not cover the clause.
**Fix point:** `tests/test_algo_r2c_momentum_after.py`, the `line = [...]` comprehension — inspect
the whole logical statement (e.g. join continuations, or AST-walk the assignment to `follow`).
**Repro:** `python /c/Users/tonio/AppData/Local/Temp/a96/n5/redproof9.py`
**Blast radius:** R2c is the one member whose entire acceptability rests on being magnitude-free;
this is the only automated check of that property, and it inspects the LONG branch only.

### Discrepancy F-3: the F1-out arm is one artifact, and the capture cannot tell a re-run from a copy
**Severity:** LOW-MEDIUM (single-source truth)
**Claim:** packet §2d — "Measured: 143 → 143, membership identical BY KEY, targets identical."
**Reality:** `n0_fields_0800.json` and `n0_f1out_0800.json` are the **same git blob**
(`e650a878efa4434cc0774a8112627ed5bcec2b28`, both 127397 bytes). Comparing them is `X == X`.
The capture emits **no run-varying field** (no timestamp, no `runtime_seconds` — unlike the
candidate tables, which carry `runtime_seconds` 262.16 / 272.04 and are therefore
distinguishable). So two genuine deterministic runs and a single `cp` produce identical evidence,
and **the artifact pair cannot discriminate them**.
**Source of truth:** neither file; the claim needs a third signal.
**Fix point:** add a run stamp (arm label + wall clock) to the capture's top-level dict, as the
candidate table already does.
**Note in fairness:** the claim is *corroborated* by a different comparison that is NOT
self-referential — `after_0800` (46b21920, old instrument) vs `n0_fields_0800` (62722a2a, new
instrument) is 143→143 identical by key and target across two distinct blobs. That is the real
evidence for zero movement; the F1-out pair adds nothing.

### F-4 (LOW): `deepest_gate_reached_BY_KEY` picks arbitrarily among ties at the same depth
At 04-09 under R2c, `REJECTION_STORY_INCOMPLETE` and `INTRA_15M_FORCE_NOT_CONFIRMED` are both
depth 2; the instrument reported the `B_NORMAL_BREAKOUT` row and therefore did **not** surface the
key that actually changed (`…100322`). The §6.2 "deepest gate BY KEY" law defends against the
majority literal, but not against a tie — and the tie is exactly where the interesting key hid.
This is the mechanical cause of F-1's cousin in claim 3.

### F-5 (LOW): a completion signal that was not a result
My first Path-B launch reported **exit code 0** while the Python process had exited **1**
(`ModuleNotFoundError: No module named 'research'`) and wrote no artifact — the wrapper's trailing
`echo` supplied the 0. Recorded because this desk's law 6 exists for exactly this, and it fired
against me inside this grade.

## 3. COVERAGE

**Verified, and by which two non-overlapping paths:**
- Totals / additions / removals / target moves / silenced / early-Route-A, all arms and both pins —
  **Path A** (my own script over row data, importing nothing from `diff_capture.py`) and
  **Path A′** (a second, structurally different derivation: subset-lattice tests
  `baseline ⊂ r2only ⊂ head`, `baseline ⊂ r2c ⊂ head`, all True, which independently forces
  removals = 0 and silenced = 0).
- The two hits and the control — **membership capture** and **candidate table**, two different
  instruments on two different layers, agreeing on the control key, clock and target.
- Claim 11 zero-delta — **two different instrument blobs** (`5c0a1ff9` at 46b21920, `305cc9b3` at
  62722a2a) producing identical membership; not a file compared to itself.
- Claims 9 and 10 — **executable-line reading** plus **live mutation** with observed RED.

**Positive-control witnesses for every absence claim I make:**
- "no FIRST_A_PLUS predicate in research/" → planted file with four definition shapes; pattern
  fired on all four.
- "`COUNTER_BIAS_REVERSAL_…` not in the R2c candidate table" → same grep returns
  `REJECTION_STORY_INCOMPLETE` 8× in each `ct_*.json`.
- "no outcome field read" → same pattern matches `current_mnq_strategy_v1.py` +3.
- "no magnitude in the R2c clause" → the guard's own control, `0.62` on the first line, caught.

**Join keys checked for every identity claim:** capture membership on
`(session, entry_time, direction, setup)` plus `target`, `target_kind`, `target_band`,
`path_reason`; candidate-table identity on the full
`route|direction|location_id|clock` string; `setup == REV` ⟺ `ROUTE_A_REJECTION` proved by
enumerating all three `core.Candidate(` sites; additions joined to `n0_fields_0800` with **0 join
failures**; F1's 22 proved a real subset difference, not a subtraction of totals.

**What I did NOT verify, and why:**
1. **Path B did not finish inside the cap.** See §4 for its final state.
2. **The 849/0 suite line** — not run; it is a whole-suite claim and the cap did not allow it.
   ARTIFACT-SOURCED only.
3. **The mutation battery (D1-D5) and its RED sets** — not reproduced. The packet's
   contamination confession (battery rewriting `derivation.py` while the after-capture ran) is
   therefore **not independently cleared by me**; I note only that `after_0800` and
   `n0_fields_0800`, produced at different times by different instruments, agree on all 143 keys,
   which is evidence against contamination having moved membership.
4. **The grant matrix / overlap re-pin (§6)** and the `frozenset()` vacuity claim — not examined.
5. **The early-bullet census (N3)** — read for its `join_key_warning` only; its five rows,
   route attributions and zone ages are un-regraded.
6. **`zone_state_at_v24` itself** — I took the capture's replayed zone states as given; I did not
   verify the replay is causal (bars strictly before the bucket). Clause (iv) inherits that.
7. **The 09:30 R2c arm** — no `ct_r2c_0930` exists, so R2c's control survival at the second pin is
   unmeasured; R2c is single-pin.
8. **`0dfff6be`'s `r2c_fields_0800.json`** — landed after my pin; not graded.

## 4. PATH B — COMPLETED, AND IT IS THE STRONGEST RESULT IN THIS GRADE

I re-ran the capture instrument **myself**, at `7d42d121`, in my own detached worktree
`wt-n5b`, with the replay CSVs copied in and md5-verified against the source tree
(`20609633f34281ac7a81cde7b57f15a4`, `a32a9b1b31bc1456f5258e4ceb186e13`). The on-disk instrument
is byte-identical to the commit (`md5 e799aee0172af6ab59a771253c1b6712` on disk == same md5 from
`git show 7d42d121:…`), so no autocrlf smudge separated my copy from the pin.

**Full corpus, all 14 sessions, mine vs the committed `r2c_0800.json`:**

| | result |
|---|---|
| totals | mine **111**, committed **111** |
| additions / removals | **0 / 0** |
| target / target_kind / target_band / path_reason moves | **0 / 0 / 0 / 0** |
| per-session | 17·9·14·8·7·5·15·7·4·4·6·11·3·1 — **14 of 14 match** |

**The 111-row artifact is reproduced IDENTICAL BY KEY AND TARGET.** The brief's minimum (control
session + 04-09) is contained in this and passed separately first: 04-09 `11 vs 11`, 04-14
`1 vs 1`, zero deltas on every compared field.

**From MY OWN run**, joined against the committed baseline, early Route-A(REV) approvals strictly
before his clock on convicted days = **26**, split
`03-23:10 · 03-24:3 · 03-31:4 · 04-06:3 · 04-09:6` — the amended claim 4 figure, derived without
touching their R2c artifact at all.

**This retires most of Discrepancy F-3 and rehabilitates claim 8's substance.** My run used the
**new 13-field** instrument (`305cc9b3`) and reproduced the membership of an artifact produced by
the **old 5-field** instrument (`5c0a1ff9`) exactly. The instrument-version delta between the R2c
artifact and the R2c commit is therefore **membership-neutral, measured rather than argued**. The
literal claim ("the SAME script at two commits") remains inaccurate for the R2c arm; the property
it was standing in for is now independently established.

**I also closed the packet's OPEN sub-table independently, and then found the doer had closed it
too — with the same numbers.** Form breakdown of the 26 under R2c, derived from my own run's
`story_kind` fields: `touch_and_reject 21 · prior_momentum_after_rejection 5`; zone states
`TESTED 15 · FLIPPED_RETEST 5 · ACTIVE_RESISTANCE 4 · NO_ZONE_ON_LOCATION 2`, **0 BROKEN**.
The artifact landed at `0dfff6be` (`r2c_fields_0800.json`, one commit past my pin) agrees with my
run on **all 12 fields across all 111 keys, 0 differing rows**, and its form breakdown is the same
`21 / 5`. Two independent productions of the same numbers, one of them mine.

**A second instance of F-5 inside this grade:** the background task reported **exit code 0** with a
**0-byte log** while the run had in fact completed and written a 98,414-byte artifact at 22:37
(`| tail` buffered the whole log). Checking the signal would have said "no output"; checking the
artifact said "done". Law 6 fired in both directions in one session.

## 5. BAND

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| ALGO-099 packet + `_algo096_guard_2026_08_24/` guard @ `62722a2a`, R2c @ `7d42d121` | **7** | **VERIFIED** | Path A row-data re-derivation (independent script) + Path B instrument re-run reproducing the full 111-row R2c artifact identical by key and target on 14/14 sessions; 5-arm candidate-table agreement on the control key/clock/target; mutation red-proofs with observed RED on R2c and on the F1 geometry pin; planted positive controls behind every absence claim | F-1 reason token names a non-gating clause · F-2 no-fraction guard covers one of two physical lines · F-3 F1-out arm is one blob (largely retired by Path B) · F-4 depth-ties hide the changed key · 09:30 R2c arm unmeasured · suite/mutation-battery/grant-matrix not re-run by me |

**Scope of the band:** the 14-session `_mnq_v24_replay_lab_v3` corpus at the 08:00 and 09:30 arm
pins, the guard artifacts listed in §1, and the two commits named in §0 — nothing else. Band 7 =
adversarially tested with residual risks documented, which is the realistic ceiling here. It is
**not** 9: I did not re-run the suite, the mutation battery or the grant matrix, and F-1/F-2 are
open HIGH-adjacent findings on the instrument layer.

**Reconciliation with the doer's claim.** The packet claims no band. Its substantive verdict —
*the batch does not land, and R2c does not land, both on their own conjunctive pre-registrations* —
is **CONFIRMED**: §5.4 fails at 37 (head) and 26 (R2c), and R2c kills the 04-09 hit it had to
preserve. I found no evidence of a manufactured or softened number anywhere; every headline figure
in §2, §2b, §2c, §5a and §6a reproduced exactly from row data, and the one arm I could re-run from
scratch reproduced to the key. The defects I did find are in the **guard and reason layers**, not
in the verdict.

