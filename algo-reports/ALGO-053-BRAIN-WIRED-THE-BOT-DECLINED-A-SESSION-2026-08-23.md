# ALGO-053 — THE BRAIN IS WIRED. The bot declined a session for the first time, and the headline did not move.

**Strategy head:** `27b15970` (pushed, remote-verified by `ls-remote` with a negative control).
**Prior head:** `8dc9d7e2`. **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**Semantic files modified:** YES — `kernel.py` and `breakout_derivation.py`. This is the first
authorized kernel/entries change since `068bb24a`, ordered by ALGO-047 §2.
**Gate state:** ALGO lane suite **742 passed, 0 failed**. Full-tree failures unchanged at **7**,
compared by MEMBERSHIP not count, all pre-existing and all outside this lane
(`v2_2_engine_final` ×1, `deepscan_fixwave` ×2, `eligibility_gate_stop_ceiling` ×4).
**Rulings ingested this packet:** ALGO-047 (executed), 048, 049, 050, 051, 052 (obligations
recorded, no code taken from any screenshot).

---

## 1. Pre-flight, then execution [MEASURED HERE]

`advisor-ruling` §0.-2 against ALGO-047: **no contradiction.** Scope = kernel/entries authorized
by name. Measured state at the pin: head `8dc9d7e2` matched the remote, tree clean, the two
BUILD-ONLY guards live and asserting the opposite of the order (which is what they were for),
`entry_authority` imported only by runners and tests. Executed in the same turn, no round-trip.

**Ear:** armed at seat-time on the algo branch, red-proofed both directions (planted stale seed
FIRES / true head SILENT), then **stopped and killed** on the ALGO-048 operator order — mine was
PID 74180 plus two child shells, identity confirmed by CommandLine (`wt-mnq-v24`, unique to
mine) and birth time. Orphans left to the operator; the advisor reports killing the remainder.

---

## 2. What is wired [MEASURED HERE]

`iter_actionable_candidates` no longer carries its own copies of the four reads. Route A, the
B/C/D breakout family and the BRK15 variant each ask `entry_authority.decide` on the same frame.

* **One frame builder.** `authority_bars` — completed history behind the trigger, forming bar
  last (ALGO-033's split) — built **once** instead of once per call site. A second copy of that
  two-line join is how the X-ray came to disagree with the kernel about what it was reading.
* **Gates supplied, never re-implemented.** `location_authorized` and `force_confirmed` come
  from the already-graded gates, exactly as the checkpoint runner supplied them. The premarket
  plan gate is untouched and still applies *after* the grant.
* **Route precedence preserved** from the kernel's own `elif` chain — C → D → B. The machine
  decides whether a route grants; it does not get to decide which is asked first, and inventing
  a new precedence would be a semantic change nobody ruled.

### 2.1 The variant was the laxer door, and closing it was not cosmetic

The hand-rolled `_intra15_confirmation` **never tested that the first break was WEAK**. A first
break already carrying momentum geometry — the NORMAL breakout, which owes the second-5m
extension test — could enter through the variant as well. It now goes through
`route=B, variant=BRK15`, which refuses exactly that, and the machine refuses the variant under
any other route. ALGO-038/039 ruled weakness a REQUIREMENT because a laxer second door to the
same trade is how four route families quietly become five.

### 2.2 Reasons are keyed on the FORM, not the route

Route D has two legal forms. The four pre-existing reason literals are **byte-identical** —
frozen custody artifacts pin them. `ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE` is **new**, because
accepted-break-retest is a grant path the kernel did not previously have; giving it the
repeat-test label would have put false evidence on a real entry.
`test_every_form_the_derivation_can_return_has_a_kernel_reason` derives that check from
`brk.FORMS` rather than listing it.

---

## 3. THE END-TO-END DIFF — the ALGO-046 §3 artifact, and the finding of this packet

Canonical `run_frozen_14_case_baseline`, re-run end to end at the **08:00** window (which
ALGO-049 made the standing configuration). Before = the same instrument at `8dc9d7e2`.

| | BEFORE (unwired) | AFTER (wired) |
|---|---|---|
| headline agreement, decided cases | **1/8** | **1/8** |
| bot traded at all in the session | 14 of 14 | **13 of 14** |
| bot GENUINELY DECLINED in-window | **0** | **1** |
| bot entered in window | 1 | 2 |
| bot unavailable in window | 13 | 11 |
| decisions through window end | 87 | 45 |
| in-window entries the budget forbids | 24 | 6 |
| symmetric-censoring diagnostic | 1/1 | **1/3** |
| mismatch census | AGREE 1 · CENSORED 6 · MISSED 6 · TRADER_DECLINED_BOT_TRADED_PRE_WINDOW 1 | AGREE 1 · CENSORED 6 · MISSED 6 · **BOT_ONLY_ENTRY_UNCENSORED_DECLINE 1** |

**What this shows.** The defect the whole semantics phase existed to kill — an entry decision
that is a CONSTANT, and therefore carries no information — **is gone.** The machine stands
aside for an entire session and genuinely declines in-window once. Decision volume through the
window end halves; entries the budget forbids drop 24 → 6.

**What this does NOT show, stated plainly.** It does not show the brain refuses on the RIGHT
sessions.

* The **headline did not move**: 1/8 before, 1/8 after.
* 2026-04-02 moved to `BOT_ONLY_ENTRY_UNCENSORED_DECLINE` — the wired brain now takes an
  in-window trade on a day the trader really declined. **That is a worse result on that case,
  not a better one.**
* The symmetric-censoring diagnostic moved 1/1 → **1/3**, i.e. the reading that *flatters* the
  bot got worse, because there are now more bot-side decisions to be judged. It stays visible
  and stays unadopted.

**5/8 is not claimed and is not comparable here.** It lives at 09:30, which ALGO-049 converted
from a committed constant into a run-configuration of the exam arm. `TRADE_START` was **not
touched** — the ALGO-043 revert is WITHDRAWN.

---

## 4. Eight tests went red. Seven were defect pins firing exactly as designed.

`test_the_bot_never_GENUINELY_declines`, `test_the_bot_trades_in_every_single_session` and
`test_the_bot_still_never_genuinely_declines` pinned the measured defect. Their own docstrings
record that the F-1 repair made them falsifiable **so that a genuinely declining session would
turn them red** — and ALGO-047 §1 named the bot-entry-rate test as now-falsifiable when the
advisor verified it. **They were convicted by the repair they were watching for.**

**They are RE-ANCHORED, and deliberately NOT re-pointed at the new number.** I am the party the
new number flatters; a count I pin today stops being a measurement. What is pinned instead:

1. **The summary flag cannot lie** — `bot_trades_every_session` must equal
   `bot_traded_at_all == sessions`, and `bot_never_declines` must equal `declined == 0`,
   witnessed in **both** directions on synthetic data so each has a path to red whichever way
   the real corpus goes.
2. **The published count must be RE-DERIVED FROM THE CASE ROWS.** A summary field checked
   against another summary field passes any internally consistent lie — a generous emitter
   updates every field it writes. **Red-proofed:** planting the flattering lie (declined
   `1 → 0`) turns it **RED**; restored byte-exact by SHA256; green again.
3. **The three-state partition** (ENTERED / DECLINED / ABSENT) is unchanged and still asserted —
   folding an absence into a decline is the conflation that once moved the headline 5/8 → 6/8
   in the bot's favour.

The `2026-04-02` case keeps its real pin: it must stay **decided and in the denominator**,
never scored as an agreement. Censoring it out would move a failing case out of the
denominator, which is the shape of a manufactured score.

⚠ **The doer re-wrote the tests that convicted the doer.** That is worth your own instruments.
The convicting artifacts are the scorecard rows themselves, which are re-derivable.

---

## 5. Red-proofs [MEASURED HERE]

**§7 mutation campaign: 19/19 KILLED** through the wiring, byte-exact restore verified by
SHA256, all named tests green after restore.

**New `run_wiring_red_proof.py` — 9/9 KILLED, three consecutive clean runs.** It plants nine
ways of *looking* wired while not being wired, because **the §7 campaign leaves every one of
them at 19/19**: ignore `granted` on Route A · ignore it on the breakout family · ignore it on
BRK15 · drop the variant tag · collapse Route D's two forms onto one label · reverse route
precedence · carry a story the authority did not produce · put the forming bar first · override
the verdict with force alone.

### 5.1 A defect in my own harness, reported rather than buried

Its **first** run reported arm W3's witness as "already RED" while the identical command passed
by hand seconds later, and the next full run killed all nine. Cause not proven; most likely a
test process spawned against a file whose bytes had not fully landed, which a bare return code
cannot tell apart from a real failure. **The harness now fsyncs, re-reads the SHA and parses
after every write, and keeps pytest's output**, so a witness failure is diagnosable instead of
mysterious. One of two runs was wrong and the instrument was hardened; I am not reporting a
clean sweep as if it had always been clean.

**Also caught by its own test on first run:** my substring assertion `"CENSORED" not in
mismatch_class` matched `BOT_ONLY_ENTRY_UNCENSORED_DECLINE` — the class whose name contains the
word meaning the opposite. Now a prefix test.

---

## 6. X-ray re-mirrored, and its guards did their job

The moment the kernel changed, `test_the_xray_consults_every_gate_the_kernel_consults` (an
**AST-derived** gate population, not a hand list) went red naming `authority_bars`. The X-ray
now asks the same authority on the same frame, and records the machine's state, its per-route
refusals and the granted form — strictly more information than the single old gate token, which
is kept so the earliest-gate census stays comparable across the wiring.

`_story_flags` is re-keyed to the derived vocabulary. Kept as `getattr` defaults, the old keys
(`takeover`, `rejection`, `momentum`) would have reported a confident `False` for three states
the object does not model at all — worse than not reporting them.

`test_the_predicate_CATCHES_a_mirror` was planting `reversal_story_v24` **by hand**; the wiring
stopped that being a kernel gate, so the control silently stopped controlling anything and went
red. It now **derives** the planted names from `kernel_gates()` — a hand-typed population
failing exactly the way that file's own docstring says a hand-typed population failed.

---

## 7. ONE OPEN QUESTION FOR YOU — the acceptance_bars exam population is now selected by the
parameter under test

**I have not run the acceptance_bars rerun, and I recommend the instrument be amended first.**

`run_exam_acceptance_sensitivity` measures Route D grants at `acceptance_bars ∈ {1,2,3}`, taking
its population from X-ray records whose outcome is `SURVIVED_TO_RANKING`. Before the wiring,
those survivors were selected by the kernel's hand-rolled predicates, which never read
`acceptance_bars`. **After the wiring they are selected by `decide(...)` at `acceptance_bars=2`
— the value under test.**

Consequence: at `acceptance_bars=1` (laxer) the run can only ever re-examine candidates that
already passed the stricter value. Grants cannot rise. **R3's monotonicity assertion would then
hold BY CONSTRUCTION rather than by measurement**, and R1's "identical ⇒ immaterial" reading
becomes unreachable in one direction. That is the self-selecting-population shape — the defect
picking its own evidence.

The mechanical fix is to widen the captured population to every Route D candidate the kernel
CONSIDERED rather than only those it granted (the `on_breakout_candidate` hook currently fires
only on the survivor branch). **That changes a pre-registered exam instrument, so I am not doing
it unilaterally — pre-registration is yours.** I hold landing authority on mechanics, not on
what the exam measures.

---

## 8. Queue as I hold it

1. ~~wire the brain~~ **DONE, this packet.**
2. ~~revert to 09:30~~ **WITHDRAWN by ALGO-049.** `TRADE_START` untouched.
3. **acceptance_bars rerun — BLOCKED on §7 above.**
4. Dual-window exam under full pre-registration: 09:30 baseline arm as a run-config, 08:00 arm,
   no-lost-agreement rule, censoring classes, window deltas. Rationale to cite the **six**
   teaching hashes (ALGO-050 ×1, 051 ×3, 052 ×2). 2026-08-21 and the 2025 sessions do **not**
   join the exam set; morphology claims render on 1m, zones on 5m.
5. FREEZE on a pass. 08:00–12:00 is unconditional; a failing 08:00 arm convicts the brain.

---

**Suite line, enumerated:** ALGO lane `742 passed / 0 failed`. Full tree: 7 failures, by
membership — `test_current_mnq_strategy_v2_2_engine_final.py::test_final_engine_installs_one_gold_lifecycle_everywhere`;
`test_deepscan_fixwave_2026_06_29.py::TestH6FreqMapAlias::test_bars_per_day_4hr_is_6`;
`…::test_4h_and_4hour_still_present`;
`test_eligibility_gate_stop_ceiling.py::TestBugProof::test_mnq_30pt_stop_clamped_to_6pt_with_old_hardcoded_args`;
`…::TestFixVerification::test_mnq_above_ceiling_is_clamped`; `…::test_mes_stop_above_14pt_ceiling_is_clamped`;
`…::test_mcl_stop_above_1pt_ceiling_is_clamped`. All pre-existing, none in this lane.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.
