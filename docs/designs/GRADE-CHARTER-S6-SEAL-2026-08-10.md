# GRADE CHARTER — `S6` SEAL GRADE (grade #2, the seal grade)

**Authored by:** advisor desk `claude.exe 29864`, per `R-787 §9(b)`.
**Status:** AUTHORED, **NOT DISPATCHED** — it is dispatched against the REPAIRED SHA, which does not
exist yet. **The desk dispatches it, never the worker (`doer ≠ grader`).**
**Grader:** `accuracy-validator`, adversarial. **Isolated worktree. Durable receipt REQUIRED:**
`docs/designs/GRADE-S6-SEAL-2026-08-10.md`.

---

## §0 — WHY THIS CHARTER EXISTS, AND IT IS NOT A PROCESS FORMALITY

`[MEASURED, R-787 §7]` Grade #1 (`GRADE-S6-ACTIVATION-2026-08-10.md`, `365` lines) returned
`PASS_WITH_BOUNDED_FINDINGS`, **VERIFIED band 7**, against `a2527e61` — a commit in which
`DAILY-RESET-1` was **live and demonstrable from committed source**. A sweep of all `365` lines for
`daily.reset|trading_day_rule|multi-day|session_date|cross-day` returns **ZERO MATCHES**.

**The grader was not lax.** It ran four mutation arms with collection asserted `== 21` each, verified
`ACCEPT-5` through three non-overlapping paths, ran an AST assertion diff, broke production
deliberately, and independently produced a real structural finding (`F-3`). **It did not miss a claim
it was asked to check.**

> ★★★★★ **`A GRADE IS BOUNDED BY ITS CHARTER: IT CERTIFIES THE CLAIMS YOU LISTED AND IS SILENT ABOUT
> THE ONE YOU DID NOT THINK TO LIST — AND ITS SILENCE READS EXACTLY LIKE ABSENCE OF DEFECT.`**

Grade #1's charter asked *"are `AR-920`'s claims true?"*. Nobody asked *"does the executed behaviour
match what the source teaches?"* — **the only question that finds `DAILY-RESET-1`.** `§2` below is
that question, and it is the reason this charter exists.

⚠️ **HONEST LIMIT ON THIS DOCUMENT:** `R-786 §8` refers to *"the read's `§14` fifteen-point charter"*.
**This desk has not read that `§14`** — the external read available to this seat did not carry it.
`§2`–`§4` are therefore **this desk's own construction**, not a transcription. **If the external `§14`
is recovered, JOIN the two and carry anything it has that this lacks.** `[UNENUMERATED — OPEN]`

---

## §1 — WHAT CARRIES FORWARD FROM GRADE #1 (do NOT re-run these blind)

Grade #1's work on the following **transfers to the repaired SHA and should be re-confirmed cheaply,
not rebuilt**: the test-replica hunt (REFUTED — the spies delegate to production; the one-grep test
passes) · the four-arm mutation matrix · `ACCEPT-5`'s join arithmetic via the git object DB · the
no-defaults sweep · the `_MUST_STAY_REFUSED` byte-identity check.

🛑 **BUT RE-CONFIRM, DO NOT ASSUME:** the repair edits `_h_opening_range`, which **is** the subject of
mutation arm A. **Arm A must still redden.** `[red-path-decay]`: red paths decay; re-measure every run.

---

## §2 — 🛑 THE SOURCE-FIDELITY LIMB. THIS IS THE POINT OF THIS GRADE.

**Do not verify the worker's claims. Verify the SOURCE.**

1. **ENUMERATE** every source-owned semantic the golden record teaches about the opening range —
   from the golden extraction artifact and the lowering layer's own required fields, **not** from any
   AR, ruling, or test name. `opening_range_definition.py`'s typed fields are a starting population,
   **not** a closed one.
2. **For EACH enumerated semantic, name the EXECUTABLE LINE that reads it.** A field that is carried,
   typed, validated and refused-without — and then read by no executor — is the exact shape of
   `DAILY-RESET-1`.
   > ★★★★★ **`A FIELD CARRIED FAITHFULLY THROUGH EVERY LAYER AND READ BY NO CONSUMER IS NOT PRESERVED
   > SEMANTICS — IT IS A RECEIPT FOR A DECISION NOBODY EXECUTED.`**
3. **REPORT THE RESIDUAL EXPLICITLY** (`advisor-ruling §4`: every ordered taxonomy owes a residual
   category). Any taught semantic with **no** consuming executable line is a FINDING at the same
   class as `DAILY-RESET-1`, whether or not it is currently reachable.
4. **A POSITIVE CONTROL IS REQUIRED** (`[absence-claim]`): show at least one semantic that IS read,
   with its line, so that "no consumer found" is distinguishable from "my search does not work".

**Known instance, to be used as the calibration case, NOT as the answer:** `trading_day_rule` was
required by `opening_range_lowering.py:483-484` and read by no executor. **If your enumeration does
not independently rediscover that class, your enumeration is the thing under suspicion.**

---

## §3 — THE DAILY-RESET REPAIR ITSELF

5. **INDEPENDENTLY KILL THE DEFECT.** Force `session_date` back to a single first-session date in
   production, re-run, and show the multi-day controls **redden**. Revert; show byte-equality.
   🛑 **A mutation that fails to redden its control is a BLIND INSTRUMENT and outranks the repair.**
6. **`ONE ADAPTER CALL PER (candidate, session_date)`** (`R-786 §6`) — verify by membership over
   `(session_date, duration)` pairs, **never by count and never by ordering alone**.
7. **DISTINGUISH THE TWO CLAIMS** (`R-786 §11`): *"the adapter was called twice"* and *"two
   independent daily ranges were computed"* are different, and **only the second is the taught rule.**
   Require the observed per-day adapter inputs to differ by day.
8. **`:685` MUST PASS UNCHANGED.** If it reddens, that is a real regression, not a term to update.

---

## §4 — THE ACCEPTANCE APPARATUS (grade the instrument, not only the delivery)

9. **`ACCEPT-5`: `NEW = 0`, `GONE = 2` MATCHED BY NAME**, re-derived with your own instrument against
   the untouched immutable baseline. Re-run grade #1's git-object-DB path: the population must remain
   a **superset**, so `GONE` cannot be a population artifact.
10. **THE TWO `== 7` TRAP (`R-787 §3`).** `:412` (bindable conditions) and `:448` (defective firing
    bars) are different populations sharing a literal. **Verify `:412` was NOT touched** and that the
    activation's strengthening of its neighbours survives.
11. **THE MIGRATED `:448` MUST BE STRICTLY STRONGER, NOT MERELY GREEN.** Both halves must be present:
    the exact six-member tuple **and** the causal per-session-lock assertion. 🛑 **A bare
    `== 6` is a hand-copied value that embalms exactly as `== 7` did — if the causal clause is absent
    or vacuous, that is a FINDING** (`advisor-ruling §5`).
12. **RED-PROOF THE CAUSAL CLAUSE.** Construct an entry that precedes its own session's lock and show
    the new assertion catches it. **A clause that cannot go red is decoration.**
13. **`F-3` CARRIES FORWARD (grade #1's own finding, already banked):** `ACCEPT-5` compares failure
    membership only, so a **`PASS → SKIP` transition is invisible to it.** Report skip MEMBERSHIP at
    base and at pin. **A member that stops providing coverage must not read as `NEW = 0`.**

---

## §5 — SCOPE, AND WHAT YOU MAY NOT CERTIFY

14. 🛑 **DO NOT certify DST, exchange holidays, half-days, session transfer, futures overnight
    boundaries, or non-1m/5m timeframes.** They are **carried, not closed** (`R-780 §7`, `R-787 §6`),
    the fixtures sit deliberately before the `2026-03-08` US DST transition, and **a grade that is
    silent about them will be read as clearing them.** Say plainly that they are out of scope.
15. 🛑 **DO NOT certify money-path reachability.** The seam is `SEAM-COMPLETE, CONSUMER-UNWIRED`;
    `build_execution_instances` has no non-test production caller. **That is `MP-1`'s question.**
16. 🛑 **DO NOT rename anything.** The two `6B` node IDs **are** `ACCEPT-5`'s join keys
    (`[accept5-join-keys]`); renaming detonates the gate and reads as a regression.

---

## §6 — REQUIRED OF THE RECEIPT

- The **mandatory coverage section**: paths used · positive-control witnesses · join keys named ·
  **and what you did NOT verify.** A grade arriving without it is a stale-definition symptom.
- **The honest null is a COMPLETE ANSWER.** *"No refutation found; here is what I covered and what I
  could not"* is worth more than a manufactured finding.
- **State which acceptance terms you could NOT independently witness** (grade #1 could not witness
  `tsc`/term `D` — no `node_modules` in a fresh worktree — and correctly refused band 9 for it).
- **Grade #1 is NOT citable as a seal input** (`R-786 §8`). Cite it only where you re-confirmed it.

---

## §7 — BAND

Band `9` requires independent re-scan **plus** failure injection **plus** zero open HIGHs **plus**
`§2`'s enumeration returning a stated residual with a positive control. **Band 10 is unreachable by
construction.** **A band is not a summary of effort; it is a statement about what an independent
instrument witnessed.**
