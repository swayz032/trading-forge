# AR-1112 (worker) — AR-1110 **STEPS B + C LANDED**. THE ROLES ARE PERSISTED AND CONSUMED, FAIL-CLOSED AND RED-PROOFED. 🛑 **`§7.A` AND `§7.B` COLLIDE WITH YOUR OWN `§8` PROHIBITION — THAT ONE IS YOURS.**

**Governing:** AR-1110 (GPT) §4, §5, §7, §11.B–C
**Commits:** `b316a0c010d1f3ecf1410ce2825b383ce2d2f92e` (B) ·
`5a5f632f` (C) · `365dfa0bfdff3b9a550c8e56da9f0cca1717ef4e` (inventory, = remote head)
**Verified fetchable from GitHub per-object.** Prior: AR-1111 (step A, `76212f65`).
**New/changed:** new `src/engine/source_timeframe_roles.py` · new
`src/engine/tests/test_source_timeframe_roles.py` · `src/engine/backtester.py` ·
`test_source_vertical_join.py` · `test_source_band_c_vertical.py`

---

## 1. STEP B — THE CARRIER (`§4`)

Four roles, each with **its own timeframe, evidence grade, source quote and condition id**.
Versioned schema `SOURCE_TIMEFRAME_ROLES/1`, canonical role-ordered payload, lossless round trip.

**Fail-closed at construction, per `§5`** — 18 tests, each refusing a thing the old scalar did:
a **missing role** refuses (parameterised over all four, so no role is silently exempt) · a
**double-bound role** refuses as a *conflict* rather than picking · **`for_role` refuses rather
than borrowing** a sibling's timeframe · an **absent carrier** refuses and names
`strategy.timeframe` / `trigger_tf` as the fallbacks it will not use · an **empty timeframe**,
an **ungradeable role** and a **graded claim with no quote** all refuse.

**`backfill_recovered_from_spec` is not an accepted evidence grade.** That is the whole point:
the persisted value was right and its provenance was a `confidence: 0.4` guess.

**Your `§3` grade instruction is enforced by a test, not by a promise:** `FVG_DETECTION` and
`BREAKOUT_CONFIRMATION` both carry `1m` and carry **different grades**, and the test asserts
the values are equal *and* the grades differ — the discrimination a single scalar cannot express.

## 2. STEP C — CONSUMED, NOT MERELY BUILT (`§11.C`)

**A carrier nobody consumes is `BUILT-UNREACHABLE` — this campaign's most-repeated species — so
B alone would have proved nothing.** `_resolve_source_timeframe_roles` is a deliberate sibling of
`_resolve_source_fixed_r`, called at the same runtime gate, **before any bar is evaluated**.
There is **no recovery branch**: `§5` forbids inferring roles from the scalars, so the OFF branch
refuses (`[never-flag]` — the OFF branch is where the defect lives).

**RED-PROOF, isolated worktree, shared tree never mutated (`MUTATION-HARNESS-ATOMICITY-1`):**

| tree | carrier | consumed | result |
|---|---|---|---|
| `wt-basetree-tmp` + copied-in carrier & fixtures | yes | **no** (`grep -c` = 0) | **4 failed / 1 passed** — every mutation `DID NOT RAISE` |
| working tree @ `5a5f632f` | yes | yes (`grep -c` = 2) | **5 passed** |

That isolates the **wiring** as the thing that bites — not the fixture, not the type.

**Mutations, against your `§7` list:**
- **C (scalar fallback restored)** ✅ — and built the way you asked it to bite: the config still
  carries `strategy.timeframe='5m'` and `timeframe='5m'`, **exactly what the `0.4` backfill would
  have produced**, and the route refuses anyway. *The old authority is present and no longer
  accepted as one.*
- **D (drop one role at persistence)** ✅ — over **all four** roles, because a guard that only
  notices one absence is satisfied by dropping a different one.
- **D2 (drop the whole carrier)** ✅ · **ungradeable-but-numerically-correct** ✅ (your `§4`
  "forbidden even when the selected number happens to be correct").
- **E (cross-source swap)** ✅ — landed in step A (`AR-1111 §3`).
- **F (existing-source preservation)** ✅ — `R-736`/`R-743` suites untouched and green.
- 🛑 **A and B — NOT DONE. See `§4` below.**
- **POSITIVE WITNESS** ✅ — the unmutated route still produces its trade with
  `stop_basis="source_exact"`. Without it, a resolver that refused *every* source run would pass
  all four mutations and look like success.

**The fixture now DECLARES all four roles as `5m`.** That was always true of its bars; it was an
**unwritten assumption** a reader had to infer from the bar generator. It is now typed and
visible — which is your `§6` "do not encode a hidden default" satisfied by *making it not
hidden*, and its quotes remain the synthetic marker so it still claims nothing about a teacher.

## 3. BLAST RADIUS + REGRESSION

**Fail-closed is expensive and I measured the bill rather than estimating it:** before the shared
fixture declared its roles, **37 failed + 13 errors**; after, **1 failed / 169 passed**.

🛑 **THAT REMAINING 1 IS PRE-EXISTING AND NOT MINE — MEASURED, NOT ASSUMED.**
`test_source_population_grade_findings.py::…::test_the_unresolved_trade_still_COUNTS_toward_the_
reported_metrics` fails **identically at baseline `1c8f554f`** (`Obtained 1.0, Expected 0.6667`).
It pins the **pre-F-3 contaminated-metric behaviour** that AR-1108 accepted the repair of. **It is
an F-3 follow-up, it is outside my authorized scope, and I did not touch it.**

**Regression: `308 passed`** — source vertical join · band C vertical · role carrier ·
cross-source guard · source-faithful execution/FVG/stop/fixed-R · trade population · Band C
sizing ingress · MP1 ingress + persistence · opening-range definition/candidate/lowering · F-3.

## 4. 🛑 THE FORK — `§7.A` AND `§7.B` CANNOT BE BUILT UNDER `§8`, AND I STOPPED RATHER THAN PICK

**`§7.A`** wants the sVkm positive witness: *5m opening-range window · 1m breakout close · 1m FVG ·
1m third-candle entry*, on the real route. **`§7.B`** wants a role-divergence discriminator that
makes the scalar-minimum heuristic *visibly* wrong.

**Both require the engine to evaluate two timeframes in one run.** `[MEASURED]` the Band C route
loads ONE bar series (`load_ohlcv`, one `timeframe`), and the synthetic fixture is 5-minute bars
end to end. There is no path today that gives a 5-minute range and 1-minute execution in the same
backtest.

**`§8` forbids me from building one:** *"a generic multi-timeframe orchestration engine"* and
*"arbitrary resampling infrastructure"* are both on the do-not-build list.

⇒ **So the roles are now PERSISTED, PROVEN COMPLETE, and CONSUMED-AS-A-GATE — but they are not
yet USED TO SELECT BARS, because nothing can.** I am stating that boundary plainly rather than
letting `308 passed` imply otherwise. **What is closed: an artifact can no longer reach the money
path without honestly declaring which timeframe owns which decision. What is NOT closed: the
engine cannot yet ACT on a divergent role set.**

**Your call, and I recommend the first:**
1. **Authorize a NARROW two-timeframe read for this source only** — 1-minute bars with a 5-minute
   opening-range window derived from them — as the `§7.A` witness. That is a resampling *of one
   series for one declared role*, not the generic MTF engine `§8` bans, but **it is your line to
   draw, not mine.**
2. Accept `§7.A`/`§7.B` as **deferred**, and let the role gate stand as a fidelity guard until the
   execution vertical is reopened.

## 5. WHAT I HAVE NOT DONE, AND MY OWN ERRORS

1. **`§11.E` acceptance population and `§11.F` independent DISPROVE grade: NOT RUN.** I told you in
   AR-1111 I would dispatch the grader once `B`–`D` existed. **`D` is incomplete for the reason in
   §4**, and grading a half-built discriminator set wastes the pass. **The dispatch is
   pre-authorized and I will fire it the moment `§7.A`/`§7.B` are resolved either way.**
2. **My first version of the consumption test class inherited from another class's `__base__`** —
   a meaningless construct I wrote and immediately replaced. No behaviour depended on it.
3. **I have not proven the carrier reaches a REAL persisted strategy row.** Everything above runs
   through fixtures and the real Band C dispatch; **no `strategies` row in the live DB carries
   `source_timeframe_roles` yet**, and the `confidence: 0.4` scalar is still what those rows hold.
   **`THE GATE IS BUILT; THE LIBRARY HAS NOT WALKED THROUGH IT.`** That is the extraction/ingress
   half of `§11.C` and it is untouched.
4. **`[instance-not-condition]`:** one source's roles are representable and one route enforces
   them. **THAT IS NOT "the corpus is lifecycle-correct"** — I measured 3 DB rows for 1 video.

## 6. STATUS

**`§11.A`:** COMPLETE (AR-1111). **`§11.B`:** COMPLETE. **`§11.C`:** COMPLETE at the runtime gate;
**the persistence/extraction half is UNTOUCHED** (§5.3).
**`§11.D`:** C · D · D2 · E · F ✅ — **A and B BLOCKED on your `§8`** (§4).
**`§11.E` acceptance · `§11.F` independent grade:** NOT RUN.
**`R-736`/`R-743`:** preserved and green.
**Performance:** not run, not authorized, and `§9`'s gate is not met.
