# AR-1398 — WORKER 1 — AR-1387A STAGE C0 CLOSURE PACKET

**RULING:** AR-1387A (2026-08-21, `d84b8391` on `origin/external-advisor/gpt-rulings`), section 7
work order, clauses 7.1.1–7.1.4, 7.2.5–7.2.9, 7.3.10–7.3.12.

**PIN:** delivery `24a95641` + inventory `9b50bc6a`, branch `claude/worker1-h1-20260815`,
worktree `C:\Users\tonio\Projects\wt-claude-worker1-20260815`. Prior head `860525ce`.

**ENVIRONMENT:** CPython **3.13.0**, Windows-11-10.0.26200-SP0, `TF_MOCK_VBT=1`.
★ The interpreter version is load-bearing for section 4 below and is stated first for that reason.

**INSTRUMENT BLOB HASHES** (so drift between this report and what a grader reads is detectable):

```text
compile_authority.py                  08c679ee98b64dc8d607f054b7b77117f764b148
svkm_v2_1_compile.py                  19992f09e7ab4a1cb043ff2023ab4042e1793971
source_graph_projection.py            35a95b6b9001fbce4233e9a69105809bb877d6ce
evidence_relevance.py                 7abff914b734d2fb69abe0facf3cab66f7ac0f35
test_external_dependency_projection.py 93b56e50e0826408a6d0c6fdf9067f34626dac0b
ar1398_attack_replay.py               e92f517eeb6fa5ace1c72b87a4027bfd42fdc31e
receipt_seed_matrix_probe.py          3553911d005ccbd1ac6433e921e317d91bc50642
```

---

## CHANGED

```text
src/engine/extraction/compile_authority.py            NEW  -- the independent authority
src/engine/extraction/svkm_v2_1_compile.py            seam binding + required parameter
src/engine/extraction/source_graph_projection.py      GATING_AXES immutable
src/engine/extraction/evidence_relevance.py           _stable_sum (sorted + math.fsum)
src/engine/tests/test_external_dependency_projection.py  +18 tests (105 -> 123)
src/engine/tests/test_svkm_v2_1_compile.py            call sites updated to the new signature
scripts/ar1398_attack_replay.py                       NEW  -- the two-head red/green instrument
scripts/receipt_seed_matrix_probe.py                  NEW  -- subprocess seed matrix
scripts/receipt_order_sensitivity_probe.py            NEW  -- order-sensitivity diagnostic
docs/designs/SYSTEM-INVENTORY.md                      regenerated
.../source_graph_projection_v2_1_certificate.json     regenerated (deselected count only)
```

---

## RED — THE DEFECT REPRODUCED, ON THE PRE-REPAIR HEAD, WITH THE SHIPPED INSTRUMENT

The RED side was **not asserted from the ruling and not asserted from memory.** A read-only
worktree was created at `860525ce`, and the *same probe file* was executed with that tree as
`cwd` — no copy, no edit, so the instrument is provably identical on both sides.

```text
$ git worktree add --detach /c/tf-red-ar1398 860525ce757ed4aa6c03888ea552952ea19e6220
$ cd /c/tf-red-ar1398 && python <delivery-tree>/scripts/ar1398_attack_replay.py

ATTACK 1_delete_required_dependency_and_restamp : COMPILED 1 strategy
ATTACK 2_six_ready_words_as_a_record            : COMPILED 1 strategy
ATTACK 3_gating_axes_clear                      : CLEARED (len now 0) --
                                                  grade=GREEN_PENDING_CERTIFICATION
                                                  compile_readiness=READY_PENDING_CERTIFICATION
SUMMARY compiled_or_green=3 of 3
```

**All three of AR-1387A's executable counterexamples reproduce exactly, including the literal
strings the ruling reports.** Sections 2, 3 and 5 are confirmed against this tower.

---

## GREEN — THE SAME PROBE, THE SAME COMMANDS, ON THE DELIVERY HEAD

```text
ATTACK 1_delete_required_dependency_and_restamp : REFUSED: CanonicalNodeNotAcceptedError:
    REQUIRED_DEPENDENCY_ABSENT: the compile authority (compile-authority/v1) requires dependency
    'e8.htf_premium_discount', and this receipt does not declare it...
ATTACK 2_six_ready_words_as_a_record            : REFUSED: CanonicalNodeNotAcceptedError:
    DEPENDENCY_RECORD_INCOMPLETE: schema external-dependency-record/v1 requires exactly [...]
ATTACK 3_gating_axes_clear                      : REFUSED: AttributeError
SUMMARY compiled_or_green=0 of 3
```

Each attack refuses with a **distinct, named cause** — not one blanket refusal absorbing all three,
which would be indistinguishable from a gate that refuses everything.

### Suites

```text
pytest src/engine/tests/test_external_dependency_projection.py   123 passed   (was 105)
pytest src/engine/tests/test_source_graph_projection.py           31 passed
pytest src/engine/tests/test_svkm_v2_1_compile.py                 24 passed
                                                        total    178 passed
ruff check <9 touched files>                                     All checks passed
python scripts/source_graph_projection_v2_1_certify.py            GREEN_ALL_ITEMS_DONE
python scripts/system_inventory.py --check                        FRESH
```

⚠️ **All 24 vertical compile tests pass here.** GPT measured 21 passed / 3 failed on its host, all
three being canonical-hash assertions. On this tower the receipt hashes to the pinned
`fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f` and the regenerated receipt file
is **byte-identical to the committed one** (it does not appear in `git status`). The three failures
are therefore environmental to the advisor's host, not latent in the tree.

---

## REPAIR

1. **`compile_authority.py` (new).** `CompileAuthority` is a frozen dataclass over a tuple of
   `RequiredDependency(dependency_id, contract_sha256)`, exposing `required` as a
   `MappingProxyType`. `build_certified_record(record, authority)` takes it as a **required
   positional parameter** — omission is a `TypeError`, which is the one guard with no branch to
   disarm. An explicit `EMPTY_COMPILE_AUTHORITY` remains legal for legacy strategies, per 7.2.6.
   The check iterates the **authority** and looks each id up in the receipt; iterating the receipt
   would never visit a deleted record, which is the same fail-open one layer up.
2. **Complete record validation before readiness.** `validate_dependency_record()` enforces a
   versioned, exhaustive field set and **recomputes** each record's contract hash before any
   readiness axis is read (7.2.7). Missing, extra, duplicate, malformed and hash-mismatched records
   refuse. Extra fields are refused rather than ignored.
3. **`GATING_AXES` immutable** (7.2.8) — `MappingProxyType` over a dict built inline and never
   bound to a module global, so no second name exists through which the underlying mapping could be
   reached. A proxy over a *reachable* dict is a lock with the key taped to the door. Both
   consumers still read the one shared object (asserted by identity, not by value).
4. **`_stable_sum`** replaces the two set-order float reductions (7.2.5). See the finding below.
5. **No HMAC, no secret surface** (section 6, honoured).

---

## 🛑 FINDING AGAINST THE RULING — SECTION 4's MEASUREMENT DOES NOT REPRODUCE HERE

AR-1387A section 4 states the receipt hash is *"actively nondeterministic"*, that this is
*"not latent"* and *"not primarily an operating-system issue"*, and reports four different hashes
from `PYTHONHASHSEED=0,1,2,42` on one host. Clause 7.1.1 requires that **the current code must fail
the seed-matrix test before the repair.**

**On this tower it does not, and I could not make it.** Measured on the unmodified pre-repair head
`860525ce`, four fresh subprocesses:

```text
seed 0  fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f
seed 1  fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f
seed 2  fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f
seed 42 fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f
```

**Root cause of the disagreement, measured:** CPython **3.12** changed `builtins.sum()` to use
Neumaier compensated summation for floats. This tower runs **3.13.0**, so `sum()` is order-
insensitive here; a naive left fold over the identical values is not:

```text
values [1e16, 1.0, -1e16]
builtin sum() over all 6 orderings   -> {1.0}          (one value)
naive left fold over all 6 orderings -> {0.0, 1.0}     (two values)
```

The advisor's host evidently predates 3.12. **The mechanism GPT identified is correct and the
located line is correct; the claim that the same machine yields four receipts is interpreter-
specific.** Positive controls proving this is not my instrument failing:

- `PYTHONHASHSEED` demonstrably varies set iteration order in these processes (printed, 4 seeds).
- `evaluate_evidence_relevance` is on the receipt path and ran **33 times** during the projection.
- An order-sensitivity probe replayed each of those 33 real reductions over 5040 full random
  shuffles: **0 / 33 order-sensitive** on this data.

⚠️ **TWO FINDINGS AGAINST MYSELF, both caught by controls rather than by luck:**
- My first order-sensitivity sampler used `itertools.permutations` capped at 5040, which varies the
  *rightmost* positions first — on a 12-member set that pins the first five elements and never
  moves a large weight across the sequence. It reported `0 / 33` for a partly wrong reason. Replaced
  with full random shuffles; the answer held.
- My first positive control for the naive fold compared a list against its reverse, and **both fold
  to 0.0** for those three values. The suite caught it. The control now compares two orderings that
  genuinely disagree (0.0 vs 1.0).

**A third exposure named in section 4's vicinity does not exist:** `shared_terms` is serialised
into the receipt as `list(<set>)`, which looks order-dependent — but all four construction sites in
`evidence_relevance.py` already emit `tuple(sorted(shared))`. Measured: 9 such lists in the
receipt, all with ≥2 members, all already sorted, under two different seeds.

### What I did about it

The repair is applied anyway, and made **stronger than ordered**: `math.fsum(... for t in sorted(terms))`.
Sorting alone satisfies 7.2.5's literal wording but **does not achieve its stated goal** — it fixes
the ORDER while leaving CPython 3.11 and 3.13 free to disagree on the SUM of that same order, and
this repo's tower and the advisor's host demonstrably straddle that boundary. `math.fsum` is exactly
rounded, so the value is interpreter-independent as well. `test_AR1398_4b` is the arm that goes RED
on *this* interpreter: it patches `builtins.sum` to a naive fold (simulating < 3.12) and asserts the
reduction is unmoved.

**Audit scope, bounded as 7.2.5 requires:** every other reduction in `src/engine/extraction/` is
`sum(1 for ...)` — integer, associative, exact. The two named lines are the only float reductions
over unordered collections that reach a certified artifact. No repository-wide numerical rewrite.

### Consequence for clause 7.3.10 — THE REBASELINE IS NOT WARRANTED

The receipt hash **did not move**: pre-repair and post-repair both produce `fd79f602…`, and the
regenerated receipt is byte-identical to the committed one. Clause 7.3.10 orders one atomic
rebaseline of the canonical receipt and all four pins. **There is nothing to rebaseline**, and
re-pinning to GPT's diagnostic `a890b406…` would move the pin *away* from what this repository
actually produces. AR-1387A itself calls that value "diagnostic evidence, not a pre-authorized
replacement pin", so I did not adopt it. **Deliberate non-execution of 7.3.10, with the measurement
above as the reason — flagged rather than silently skipped.**

---

## CONTROLS

- **Discriminating positives.** `test_AR1398_0` (legacy receipt + explicit empty authority still
  compiles) and `test_AR1398_0b` (a complete, pin-matched, READY required dependency compiles).
  Without these, every refusal in this packet is equally consistent with a gate that refuses all
  input.
- **Two-head symmetry.** One probe, two heads, 3-of-3 versus 0-of-3.
- **Whole-schema mutation.** Every field of the v1 record dropped in turn, each refused — preceded
  by a control asserting the unmutated record validates.
- **Anti-regression on the older suite.** The new contract-hash gate fires *before* the AR-1397 F-1
  readiness re-derivation, which silently changed what `test_AR1397_F1c/F1d` were proving. Rather
  than relax them, F1c now **re-seals** the record after mutating an axis (the stronger attack, and
  the state in which the re-derivation must actually work) and asserts it reaches
  `EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED`; F1d asserts both the new earlier refusal **and** the
  original property directly on `_derived_dependency_blockers`. No test was weakened to obtain green.
- **Schema pinned to the dataclass**, not hand-copied, so a new field goes RED instead of being
  tolerated as an "extra".

---

## FINDINGS

1. **Section 4's measurement is interpreter-specific** (above). Mechanism right, reproduction
   claim wrong on this tower. Clause 7.1.1's mandated RED could not be produced here.
2. **Clause 7.3.10 deliberately not executed** — the hash never moved; there is no rebaseline.
3. **GPT's 3 failing vertical tests do not reproduce** — all 24 pass, receipt byte-identical.
4. **Against myself:** a broken permutation sampler and a broken positive control, both caught by
   controls, both described above rather than presented as a clean first attempt.
5. **Against myself:** I wrote a `load_compile_authority(path)` JSON loader, and
   `scripts/system_inventory.py` classified it **BUILT-UNREACHABLE** — built, tested, called by
   nothing. It was **removed before delivery** rather than shipped. 7.2.6 says the compile entry
   must "receive/load" the authority, and `compile_svkm_v2_1_vertical` *receives* it.
6. **Lane-guard note:** the guard refused a new test module at
   `src/engine/tests/test_compile_authority_ar1398.py` as Worker-2-owned. I did not hunt for an
   accepted filename; the tests went into the C0 suite the ruling itself names, which is their
   correct home and is why that suite now reads 123 rather than 105.
7. **Certificate drift is cosmetic** — the only changed byte-range is a stored pytest tail's
   `deselected` count (9427 → 9493), a consequence of the suite growing. No status changed.
8. **`AGENT-LOGS.md` not written** — CLAUDE.md §10b mandates a session-log entry there, but the
   Worker-1 guard's `edit_scope` does not cover that path and rejected the edit. This is the
   already-ruled AR-1380A precedent ("widen nothing merely for logging ceremony"), so no guard
   widening was requested; the session-log content lives in this report and in `CURRENT_STATE.md`.

---

## ⭐ KNOWN FACT TO PIN — DO NOT RE-DIAGNOSE THIS THE EXPENSIVE WAY

**CPython 3.12 changed `builtins.sum()` to use Neumaier compensated summation for floats.**
A float reduction over a `set` is therefore order-sensitive on 3.11 and order-INSENSITIVE on 3.12+.
Two hosts running the same commit can disagree about whether a "nondeterministic receipt" exists at
all, and both are reporting honestly.

- **Before diagnosing any receipt-hash nondeterminism, print the interpreter version on BOTH hosts.**
- **Prefer `math.fsum(... for t in sorted(...))` for any float reduction entering a certified
  artifact.** Sorting fixes ORDER; only exact rounding fixes INTERPRETER. A pin that is reproducible
  on one host and not another is not a pin.

---

## SCOPE HONOURED

No Stage C1 work, no Currency Pros contact, no webhook/broker/live path, no E8 backtest or
promotion, no invented provider formula, no corpus census or Factory rerun, no HMAC. No
`src/server/` cleanup and no `system-map:check` work — 7.3 leaves both separately owned.

---

## GRADER

**NOT DISPATCHED — AND IT IS OWED.** Clause 7.3.12 requires one independent adversarial grade
against the frozen SHA, and `worker-execution` §11c would normally make that dispatch
pre-authorized. **This session carries an explicit operator instruction not to call the Agent tool
unless the operator requests it**, which outranks the skill. I am therefore not self-dispatching,
and I am not reporting the grade as blocked or unowned: `accuracy-validator` is available and one
word from the operator starts it.

Brief the grader with: frozen SHA `9b50bc6a` (or the report commit that supersedes it), the blob
hashes above, the four AR-1387A counterexamples to replay, a demand for **≥1 novel attack not
copied from this packet's control set**, and a durable committed receipt path. Claims to attack:

- the authority cannot be omitted, defaulted, emptied at runtime, or satisfied by a receipt-side value;
- a required dependency cannot be deleted, re-stamped, drifted, duplicated, or imitated;
- `GATING_AXES` cannot be mutated and is still one shared object;
- the two reductions are order- and interpreter-independent;
- **what I did NOT prove:** that no *other* unordered float reduction anywhere outside
  `src/engine/extraction/` reaches a certified artifact; that the receipt is reproducible on a
  CPython < 3.12 host (I have no such host); that an empty authority is *correct* for any strategy
  other than the legacy svkm receipt, which genuinely declares `external_dependencies: null`.

---

## STOP

None fired. Clause 7.1.1's RED could not be produced on this host — reported as a finding, not
treated as a stop, because sections 2/3/5 red-proved cleanly and the section 4 repair is applied
and independently tested.

## NEXT

Operator authorizes the `accuracy-validator` dispatch against the frozen pin; the grader replays the
four counterexamples plus a novel attack; its **full** verdict lands at a committed path beside this
report. Then GPT rules. No commits after the grade.
