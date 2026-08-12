# AR-1086 (worker) — CORRECTING MY OWN REGRESSION INSTRUMENT: THE CAMPAIGN HAS A COMMITTED POPULATION AND I HAND-ROLLED ONE

**Pin:** `4936aae8` · **Baseline:** `b609f039` · Supersedes AR-1084 §2 as the acceptance measurement

---

## 1. THE CORRECTION

AR-1084 reported regression over a **63-file population I selected by grep**. That was not wrong, but it was not the campaign's instrument. **A committed, mechanically-derived acceptance population already exists** and I should have used it first:

- **Manifest:** `src/engine/tests/canonical_regression_population.txt` — tracked, **107 members**, header says COMPUTED NEVER HAND-EDITED.
- **Derivation:** `_regression_population(...)` in `test_flag_off_parameterized_refusal.py` — an AST import closure over `spec_condition_compiler` and `spec_family_bindings`.

★ `AN INSTRUMENT BUILT TO PREVENT A MISTAKE PREVENTS NOTHING WHILE IT SITS UNRUN.` I ran a hand-rolled population when the committed one was one command away.

---

## 2. THE MEASUREMENT, IN THE FORM THE POPULATION'S OWN LAW REQUIRES

The population is accepted **by frozen member-list diff, never by a total.** Both runs, same 107 members, `-p no:cacheprovider`:

```
AT 4936aae8 (mine)      32 failed, 2387 passed, 2 xfailed   134.70s
AT b609f039 (baseline)  32 failed
```

**Failure member sets diffed both directions:**

```
ONLY AT MY PIN (would be mine)      : <empty>
ONLY AT BASELINE (fixed or masked)  : <empty>
```

**Identical sets. Zero attributable regressions, and zero failures silently masked** — the second direction matters as much as the first, because a change that makes a pre-existing red disappear is also a change nobody asked for.

The baseline ran in a detached worktree at `b609f039`, verified by `git rev-parse HEAD` inside it, removed afterwards.

---

## 3. TWO INSTRUMENT TRAPS THAT FIRED ON ME, BOTH ALREADY KNOWN

**(a) The manifest's members are relative to `<repo>/src`, not the repo root — and a pytest invocation with no paths does not error, it runs EVERYTHING.** My first attempt handed a `/c/...` MSYS path into Python, which wrote nothing, leaving an empty argument list. **The guard I had written refused (`REFUSING: empty/short arg list would make pytest run EVERYTHING`) instead of silently launching a full-suite run.** That refusal is the only reason this did not become a second multi-hour hang reported as a regression result.

**(b) It also explains AR-1084's hang.** `pytest src/engine/tests/` — the whole directory — sat at 9% for fifteen minutes. The committed population, which is a *subset* selected by import closure, completes in **135 seconds**. The hang is in a member outside that closure; still `[UNENUMERATED]`, still not on this unit's path, and now bounded: it cannot affect the acceptance instrument.

---

## 4. ONE DISCLOSURE — THE MANIFEST IS STALE, AND IT WAS STALE BEFORE ME

`grep -c` over the manifest for my three new test files returns **0**. They import `spec_condition_compiler`, so a regeneration WOULD pull them into the closure and move the denominator from 107.

**I did not regenerate it.** Changing the acceptance denominator inside the unit being accepted is the wrong order of operations, and `test_the_canonical_population_matches_its_committed_manifest_by_member` — the guard that detects exactly this staleness — **is RED at `b609f039` as well as at my pin**, so the manifest was already out of date with its own generator before this seat existed. Flagging it as a standing condition rather than fixing it under cover of a different unit.

---

## 5. NET

**AR-1084's conclusion stands and is now better supported:** no regression is attributable to `001c1758`, `162e6fa1` or `4936aae8` — established on the campaign's own committed population, by member-list diff in both directions, against a baseline I ran rather than a number I carried.

Grader still running on `4936aae8`. **Pin `4936aae8`.**
