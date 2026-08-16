# AR-1244 — WORKER · G2-H POPULATION DRIFT IS PRE-EXISTING AT BOTH PINS; G2-A/B DID NOT MOVE THE GOVERNED INSTRUMENT · 2026-08-16

```text
AR-1244
RULING : AR-1243 §10.1 (governed-population drift attribution, READ-ONLY / BOUNDED).
         Fresh Worker-1 session seated per §10; resume head and pre-G2 base both matched.
PIN    : worker branch claude/worker1-h1-20260815
         start head  857b8f0d539983520d62de66eedba49d4c12f9fc
         this report a097d38e00cfa5194933393c9b98fca81fcbc3ae
         evidence    2dcc8efa (attribution + probe), a097d38e (SYSTEM-INVENTORY pre-push gate)
         pre-G2 base eaf205252230732274c20b8174ab942da856b45b
         trees       C:\Users\tonio\Projects\wt-claude-worker1-20260815 (head)
                     C:\Users\tonio\Projects\wt-w1-preG2-eaf20525 (clean detached, pinned to SHA)
CHANGED: docs/replay-results/g2h-population-drift-attribution-2026-08-16.md   (new)
         scripts/g2h_population_drift_probe.py                                (new, read-only probe)
         docs/designs/SYSTEM-INVENTORY.md                                     (regenerated, pre-push gate)
         MANIFEST NOT REGENERATED. No production/compiler/extraction file touched.
```

## VERDICT

**The membership drift is IDENTICAL at both pins ⇒ PRE-EXISTING population-governance debt. It does
NOT block G2-C/D**, per AR-1243 §10.1's final clause. Proceeding to G2-C.

## RED — the governed guard, run at both pins

```text
$ python -m pytest src/engine/tests/test_flag_off_parameterized_refusal.py \
      -k "population or manifest" -q -s --tb=short

PRE-G2 eaf20525 : [MANIFEST] committed=107 derived=127  -> 1 failed, 6 passed, 18 deselected in 17.17s
G2 HEAD 857b8f0d: [MANIFEST] committed=107 derived=127  -> 1 failed, 6 passed, 18 deselected in 14.89s
```

Same guard, same counts, RED at both. The six other selected tests pass at both pins — including the
derivation break-control and the manifest break-control — so the red is a real population
disagreement rather than a broken instrument.

## THE ATTRIBUTION — exact, not inferred from counts

Two facts make it exact rather than a count coincidence. **Both the committed manifest and the
derivation module are byte-identical across the pins:**

```text
$ git diff --stat eaf20525 857b8f0d -- src/engine/tests/canonical_regression_population.txt   -> (empty)
$ git diff --stat eaf20525 857b8f0d -- src/engine/tests/test_flag_off_parameterized_refusal.py -> (empty)
```

So the only thing that could move the population is the `src/` tree. It did not:

```text
derived_full  (n=127) : IDENTICAL across pins — members AND order
derived_only  (n=20)  : IDENTICAL across pins — members AND order
manifest_full (n=107) : IDENTICAL across pins — members AND order
manifest_only (n=0)   : nothing pinned by the manifest has disappeared

drift already present at the pre-G2 base : ALL 20
drift introduced by G2-A/B               : 0
```

Because the derived lists match member-for-member and in order, no member can have entered or left
within G2-A/B. The 20 members are listed by name and order in the committed artifact — not as
"20 files drifted", per §10.1(2).

Drift direction is **manifest-behind-derivation only**: 20 test files have grown an import path into
the compiler closure since the manifest was minted, and nothing the manifest pins has vanished. That
is accumulation debt, not erosion.

## CONTROL — the comparator can report a difference

An identity result is worthless until the comparator is shown to disagree with something. Against
the same pre-G2 list:

```text
PLANTED-ADD     control -> DIFFERENT (only-in-B: engine/tests/test_PLANTED_DOES_NOT_EXIST.py)
PLANTED-REORDER control -> DIFFERENT (SAME MEMBERS, DIFFERENT ORDER)
```

Both fire, on the ordered comparison, in the same run that reported IDENTICAL.

The probe imports the repository's own `_regression_population`, `_read_manifest` and
`_manifest_mismatch` rather than reimplementing any of them — a probe exercising a different
comparator than the guard would prove nothing about the guard. The committed probe was re-run from
its committed path and its JSON is byte-identical to the pre-commit run (`PRE identical: True`,
`HEAD identical: True`), so the shipped instrument is the one that produced these numbers.

## FINDING AGAINST MY OWN PACKET — the governed population cannot witness the G2-A/B lane

The governed population contributes **zero** coverage of the code G2-A/B changed:

```text
src/engine/tests/test_term_equivalence.py      preG2_exists=False g2head_exists=True
  engine/tests/test_term_equivalence.py        in_derived_head=False in_manifest=False
src/engine/tests/test_source_fidelity_guard.py preG2_exists=True  g2head_exists=True
  engine/tests/test_source_fidelity_guard.py   in_derived_head=False in_manifest=False
```

Mechanism with its evidence in the same breath: the derivation admits a test file only when it
transitively imports `spec_condition_compiler` or `spec_family_bindings`, and
`grep -cE 'spec_condition_compiler|spec_family_bindings' src/engine/tests/test_term_equivalence.py`
returns **0** — its imports reach `term_equivalence`, `evidence_relevance` and
`source_fidelity_guard` only. Positive witness that the probe can see files at all: the same run
reports `engine/tests/test_opus_phase1_route.py` as `in_derived_head=True`, `in_derived_pre=True`.

⇒ **The governed population would report "no regression" for G2-A/B whether or not G2-A/B broke its
own code.** AR-1243 §9 already covers this — G2-H is the governed population *"plus the focused lane
tests/controls"* — and this measurement shows the second half is load-bearing, not decorative. On
this packet the focused lane tests are the **only** witness of the changed code. I am flagging it so
the final G2-H receipt is not read as coverage it does not have.

## FINDINGS — process

1. The onboarding skill pins a starting head (`5a82f6f5`) that is now ~40 commits behind. I did not
   treat the mismatch as a stop: `git merge-base --is-ancestor 5a82f6f5 HEAD` exits 0, so the pinned
   head is an **ancestor** of HEAD and worktree identity is proven rather than broken. Flagging the
   stale pin as a card-maintenance item, not a blocker.
2. The worktree carried one unrelated dirty file, `docs/wave25-exit-engine-ab-report.md` — a
   timestamp-only regeneration (`Run date: 2026-05-24 → 2026-08-16 06:36 UTC`) from some earlier
   run, not mine. **I did not commit it and did not revert it**; every commit here used explicit
   paths. It is the same unrelated-artifact class as `8ba4c35b`. Left in place as-is, reported
   rather than tidied.
3. The pre-push `inventory-freshness` hook blocked the first push as documented; remedied by its own
   published remedy (regenerate + `git commit -o docs/designs/SYSTEM-INVENTORY.md`), not routed around.

## SCOPE — what this does NOT prove

- It does not prove G2-A/B is regression-free. It proves G2-A/B did not move the **governed
  population's membership**, and (finding above) that population cannot speak to the changed code.
- It is not the G2-H receipt. Per AR-1243 §10.2 the governed population runs once at the final G2
  integration checkpoint, `eaf20525` vs the final G2 head, compared by node ID with a live
  comparator control. This is the §10.1 pre-check only.
- All evidence is LOCAL. No CI ran at this SHA.

```text
GRADER : not required by AR-1243 §10.1 (bounded read-only pre-check, no repair to grade)
STOP   : none — §10.1's stop ("drift appears or changes only at the G2 head") did NOT fire;
         the drift is identical at both pins, which is §10.1's explicit proceed case
NEXT   : G2-C (AR-1243 §11) — wire the existing evidence_antecedent.bind_qualifier_to_antecedent,
         preserving both literal spans, their exact character positions and the binding receipt;
         no new antecedent helper, no invented per-video aliases. Starting in this same turn.
```
