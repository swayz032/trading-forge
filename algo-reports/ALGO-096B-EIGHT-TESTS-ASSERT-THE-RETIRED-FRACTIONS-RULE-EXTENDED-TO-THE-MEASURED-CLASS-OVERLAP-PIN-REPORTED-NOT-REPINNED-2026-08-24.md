# ALGO-096B — Second scope amendment to ALGO-096 §5: the test-rewrite rule was written for the ONE test shown and the measured class is EIGHT. Rule extended to the eight by name, same three constraints. The pinned route-overlap set is REPORTED in the packet with its mechanism at the bar, and re-pinned only in the landing commit under ALGO-098's read — never silently.

**Advisor:** Claude (Fable 5), ALGO seat — session `trading-forge-cf`. **Amends:** ALGO-096 §5
as amended by ALGO-096A §3. **Raised by:** worker `trading-forge-99` (direct message, after
running the FULL v2.4 suite: 838 passed / 8 failed, all eight named). **Channel head at
drafting:** `9aedaae6`. **Strategy head on origin:** `6d22524c` — the R2/R2b/F1 code is LOCAL at
the worker; every code claim below is [RELAYED] until pushed and read here. **Main-channel head:**
`c62bb561e015`, untouched. **PR #38: DRAFT / DO NOT MERGE.**

## 1. Verified here [MEASURED at `6d22524c`]

- The two fixture bars exist where named: `(105, 110.0, 100.0, 105.2)` at
  `tests/test_..._derivation.py:224/:254/:263` and as `CONFLICTED` at
  `tests/test_..._entry_authority.py:42`; `(102, 102.4, 100.1, 102.1)` at `derivation.py:99`.
  Against band [100, 102] both TRADE INTO the band (low 100.0 / 100.1) and CLOSE BACK OUT on the
  near side (105.2 / 102.1 > hi) without a close beyond — **rejections under ALGO-071 §3**,
  chosen originally because their wick FRACTIONS trip `0.30/0.40` or fail `0.35`. The eight
  failures are therefore the expected consequence of R2/R2b, not a defect in them: the tests
  encoded the retired reasoning.
- `KNOWN_OVERLAPS = {(ROUTE_A_REJECTION, ROUTE_C_PREBREAK_DISPLACEMENT)}` at
  `entry_authority.py:203-204`, consumed by the matrix test (`:214`) and
  `test_every_pinned_overlap_is_REAL_and_none_has_gone_stale` (`:222`) — a self-certifying-
  collection guard, exactly the kind that must not be re-pinned by the hand that changed it.
- ALGO-096A §3's "only 256-257 … no other hunk in that file" was written on the instance the
  worker had shown at the time. The worker enumerated the class instead of obeying the instance —
  `[instance-not-condition]` applied by the worker to the desk's order. Correct.

## 2. Ruling — option (a), extended to the measured class, by name

The rule of ALGO-096A §3 applies to all eight:
`test_two_sided_wick_conflict_discriminates` · `test_a_touch_with_no_directional_control_is_refused` ·
`test_fixture_mixed_overlap_and_two_sided_wicks` · `test_a_refusal_always_names_itself` (derivation) ·
`test_an_incomplete_story_stops_before_force` · `test_blocking_step_increases_as_evidence_accumulates` ·
`test_every_refusal_is_legible_to_a_non_coder` (entry_authority) — and, separately, §3 below for
`test_every_pinned_overlap_is_REAL_and_none_has_gone_stale`.

Three constraints, unchanged in kind:
1. **Keep every taught negative.** Each test's docstring names the spec fixture it expresses
   (`mixed_overlap_and_two_sided_wicks`, `touch_without_directional_control`, …). The fixture
   bar moves to one HIS definition also refuses — closed INSIDE the band for indecision, closed
   BEYOND it for a break — and the test must still go RED if the new predicate is deleted
   (a moved fixture that passes under any predicate is not a guard).
2. **Change an assertion only where it names a fraction** (`0.30`, `0.40`, `0.35`, `0.62`,
   `0.78`, `lower_frac`, `upper_frac`, `body_frac` as a threshold) or the old signature.
   Refusal literals, step ordering, legibility asserts stay.
3. **Hunk discipline by test, not by file:** the diff in those two files touches the eight named
   tests and the fixture constants they share (`CONFLICTED`, the `:99` list) and nothing else.
   Before/after OHLC-vs-band for every moved bar, all eight, in the packet.

A negative that CANNOT be re-expressed with a bar his definition refuses — one that depended
on a fraction and nothing else — is not deleted: it is listed in the packet as RETIRED WITH
REASON and counts as a member ALGO-098 reads. Landing requires the full v2.4 suite GREEN
(838 + 8 → all), with the count of test hunks reported beside the code diff.

## 3. The pinned overlap — reported, mechanism at the bar, re-pinned only under a read

The worker is right not to touch `KNOWN_OVERLAPS` on its own reading. Ordered:
- **Report, before/after:** the full route-by-evidence grant matrix at `56d9360d` and at the
  landing commit; the OLD overlap set, the NEW set; and for the vanished pair (A, C) the fixture
  that produced it, at the bar (OHLC vs band, which clause now refuses A or C on it).
- **Acceptable mechanism, pre-registered:** the (A, C) overlap existed because the old fraction
  accepted as a rejection a bar his definition classes as indecision or a break, or because
  `_control` passed a bar that had closed beyond the band. **Any other mechanism** — a taught
  form lost, a fixture that is a rejection under his definition no longer granting A — fails the
  batch as a whole.
- **Re-pin only in the landing commit**, with the docstring citing this amendment and "pending
  ALGO-098"; ALGO-098 ratifies the new set or the batch reverts. A pin updated in any earlier
  commit, or without the matrix report, is a stop.

## 4. Unchanged

The §5 pre-registration (conjunctive, by key), the guard (approved-entry capture at both pins,
baseline in a separate worktree at `56d9360d` — same instrument, different code, ratified as the
right shape), the seals of ALGO-096A, re-exam #3 once after landing, code pushed before the
packet, ALGO-098 rules land-or-close.

LESSON: the desk wrote "no other hunk in that file" for the one test it had been shown; the
class was eight across two files. An order scoped to the instance shown is the same error as a
repair scoped to the instance shown — `[repair-closes-shown-instance]` binds the ruler too.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this amendment.
