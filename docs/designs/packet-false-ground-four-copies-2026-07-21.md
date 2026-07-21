# PACKET — the four surviving copies of a withdrawn ground (R-231 §3)

**Status:** STAGED, then implemented in the same wave. Instrument surface, so the
5-part form is mandatory. Production flags OFF; no measurement is re-run by this
change and no number in any artifact moves.

---

## 1. WHAT & WHY NOW, WITH RECEIPTS

A **single false reason** — that swing stays `approximation=True` because its
population is below the `n>=2` de-approximation floor — propagated to **seven
sites across four files**. Three were corrected (R-219 4b, R-220 §3). **Four
remain**, each verified against `git show HEAD:<path>` rather than transcribed:

| site | line(s) at HEAD | surface |
|---|---|---|
| `src/engine/spec_condition_compiler.py` | 970–971 | instrument (docstring on the live resolver) |
| `src/engine/spec_family_bindings.py` | 2169–2170 | instrument (comment at the binding site) |
| `src/engine/tests/test_levelzone_population_a_resolver.py` | 21, 215 | test prose (module docstring + test docstring) |

**Why the reason is false, twice over:**

1. **The floor ground rests on a count that is numerically false.** The stated
   `n=1` is contradicted by the census, which holds **2** by two independent
   paths — so the population **MEETS** the floor rather than falling below it.
   The sentence therefore argues for the *opposite* of the disposition it is
   attached to.
2. **The grade-scope ground that replaced it was withdrawn in turn** — *a ground
   that depends on our own permission is not a ground.* It would evaporate the
   day the grade widened, leaving the disposition with none.

**THE CORRECT GROUND (AR-199 §1) — the anchor-vs-taught-object refusal:** a swing
is the **ANCHOR** of a fibonacci retracement; the **TAUGHT OBJECT** is the
50%/61.8% line, and the level/zone primitive **does not emit that object at all**.
There is nothing for the row to bind TO. This is a property of what the primitive
**EMITS**, so **no row count and no widening of the grade can move it.**

**Why now:** the remaining four are the tail of a class the last two waves
already worked. ★ **A sweep is a census, not an edit** — the grade-scope copy sat
**150 lines from its corrected sibling** and survived precisely because the
earlier passes fixed instances rather than enumerating the class.

**Why the corrected count is NOT the fix:** replacing `n=1` with `n=2` would keep
a ground that is structurally wrong. The refusal is not about how many rows there
are. A repaired numeral would be a *more accurate false reason*.

---

## 2. BLAST RADIUS

- **Behaviour: ZERO.** All four sites are **comments and docstrings**. No
  predicate, no branch, no assert condition, no emitted value is touched. The
  `swing` disposition (`approximation=True`) is **unchanged** — only the stated
  reason for it changes.
- **Not touched:** `POPULATION_A_DEAPPROXIMATED_KINDS` and every de-approximation
  grade; the resolver logic; the flags (both default OFF); any `.spec.json`.
- **Artifacts:** none regenerate. `dual_denominator_remeasure.py` and
  `population_a_flip_step_remeasure.py` already carry the corrected form; this
  packet does not re-enter them.
- **The 77 sealed corpus:** untouched.
- **Known adjacent risk:** `test_levelzone_population_a_resolver.py` is a test
  file. Only its **prose** changes; no assertion is added, removed, or weakened.
- **OUT OF SCOPE, other owners:** the `17` citation sweep and the
  `test_spec_family_bindings.py` test-suite packet.

---

## 3. SCOPE-LOCKED CHANGE

Exactly four sites in three files. Each rewritten to state the
anchor-vs-taught-object refusal, and — following the house form already landed in
the corrected siblings — to **name the withdrawn grounds as withdrawn**, so the
false reason cannot return by looking like a gap.

Each replacement must:
- give the refusal in terms of what the primitive **emits**;
- say explicitly that it is **NOT** the `n>=2` floor and **NOT** the grade scope,
  and why each was withdrawn;
- **not quote a population count as load-bearing.** Where a count is not computed
  at that site it is **ABSENT**, not typed — *every number COMPUTED or ABSENT.*

---

## 4. VERIFICATION PLAN

1. **Census, not spot-check.** Re-run the class sweep across the whole repo
   (`de-approximation` / floor phrasings, wrapped-line safe) and confirm the only
   surviving matches are inside **negations that withdraw the ground**.
   ★ The wrapped-line case is real here: the phrase spans a line break at three
   of the four sites, so a naive `"de-approximation floor"` grep **misses them
   and reports a clean sweep.** The census pattern must not assume the phrase is
   on one line.
2. **Behaviour unchanged:** run the Population-A resolver test module and confirm
   the same pass/fail set as before the edit.
3. **Diff discipline:** `git show --stat HEAD` must list exactly the three files.
4. **Quoted spans verified against `git show`**, never retyped from a brief.

---

## 5. ROLLBACK

`git revert <sha>` — the commit is comment/docstring-only across three files with
no schema, artifact, or migration component, so revert is complete and carries no
data consequence. No regeneration is required after a revert because no artifact
is produced by this change.
