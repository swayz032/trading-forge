# G2-H governed-population drift attribution — AR-1243 §10.1

**Verdict: the membership drift is IDENTICAL at both pins ⇒ PRE-EXISTING population-governance
debt. It does NOT block G2-C/D.** (AR-1243 §10.1, final clause.)

The manifest was **not** regenerated.

## Pins

```text
PRE-G2 / AR-1239 worker state : eaf205252230732274c20b8174ab942da856b45b
G2-A/B head                   : 857b8f0d539983520d62de66eedba49d4c12f9fc
worker branch                 : claude/worker1-h1-20260815
pre-G2 tree                   : clean detached worktree, pinned to the SHA (not a branch name)
```

## The instrument

```text
derivation : src/engine/tests/test_flag_off_parameterized_refusal.py::_regression_population
manifest   : src/engine/tests/canonical_regression_population.txt
guard      : ::test_the_canonical_population_matches_its_committed_manifest_by_member
control    : ::test_the_manifest_comparison_discriminates_a_planted_difference
scan root  : <repo>/src        closure targets : ('spec_condition_compiler', 'spec_family_bindings')
```

**Both the manifest AND the derivation module are byte-identical across the two pins** — measured,
and it is the load-bearing fact, because it means any difference in drift could only have come from
the `src/` tree:

```text
$ git diff --stat eaf20525 857b8f0d -- src/engine/tests/canonical_regression_population.txt
(empty)
$ git diff --stat eaf20525 857b8f0d -- src/engine/tests/test_flag_off_parameterized_refusal.py
(empty)
```

## RED — the guard, run at both pins

```text
$ python -m pytest src/engine/tests/test_flag_off_parameterized_refusal.py \
      -k "population or manifest" -q -s --tb=short

PRE-G2 eaf20525 : [MANIFEST] committed=107 derived=127   -> 1 failed, 6 passed, 18 deselected
G2 HEAD 857b8f0d: [MANIFEST] committed=107 derived=127   -> 1 failed, 6 passed, 18 deselected
```

The guard is RED at **both** pins, with the same counts. The other six members of that selection
pass at both pins, including the derivation break-control and the manifest break-control — so the
red is a real population disagreement, not a broken instrument.

## Member-and-order comparison across the pins

Dumped with `scripts/g2h_population_drift_probe.py`, which imports the repository's own derivation,
manifest reader and comparator rather than reimplementing them.

```text
derived_full  (n=127) : IDENTICAL across pins — members AND order
derived_only  (n=20)  : IDENTICAL across pins — members AND order
manifest_full (n=107) : IDENTICAL across pins — members AND order
manifest_only (n=0)   : nothing is in the manifest but absent from the derivation
```

### Positive control — the comparator can detect a difference

A set comparison that reports "identical" is worthless until it is shown to report "different".
Against the same pre-G2 list:

```text
PLANTED-ADD     control -> DIFFERENT (only-in-B: engine/tests/test_PLANTED_DOES_NOT_EXIST.py)
PLANTED-REORDER control -> DIFFERENT (SAME MEMBERS, DIFFERENT ORDER)
```

Both fire. The identity result above is therefore a measurement, not a comparator that always agrees.

### The 20 pre-existing drift members (in derivation, absent from manifest — at BOTH pins)

```text
engine/tests/test_band_c_sizing_ingress.py
engine/tests/test_batch_locator.py
engine/tests/test_c1_role_binding.py
engine/tests/test_cross_language_carrier_reload.py
engine/tests/test_cross_source_provenance_guard.py
engine/tests/test_d_opening_range_source_frame.py
engine/tests/test_f3_realized_vs_open.py
engine/tests/test_framework_risk_before_overlay_bypass.py
engine/tests/test_mp1_backtester_ingress.py
engine/tests/test_opus_phase1_route.py
engine/tests/test_producer_staging_vocabulary.py
engine/tests/test_source_band_c_vertical.py
engine/tests/test_source_faithful_execution_mode.py
engine/tests/test_source_faithful_fvg_routing.py
engine/tests/test_source_population_grade_findings.py
engine/tests/test_source_trade_population.py
engine/tests/test_source_vertical_join.py
engine/tests/test_spine_a_compile_entry_point.py
engine/tests/test_spine_c_factory_role_arrow.py
engine/tests/test_svkm_role_execution.py
```

The drift direction is **manifest-behind-derivation only**: nothing the manifest pins has
disappeared, and 20 members are derived that it does not list.

> ~~"20 test files have grown an import path into the compiler closure since the manifest was last
> minted."~~ **STRUCK — GPT AR-1245 §3, correctly.** That names a CAUSE this packet never measured.
> I did not compare the current derivation against the manifest's mint commit or its
> mint-time instrument, so the older mechanism is unassigned: it could be later import-graph
> changes, later repairs to the derivation rule itself, older manifest-generation blind spots, or
> another already-governed historical change. Retained rather than deleted so the overreach stays
> visible.
>
> The proven claim is narrower and sufficient: **PRE-EXISTING MANIFEST-BEHIND-CURRENT-DERIVATION
> DEBT** — the same 20-member mismatch exists at `eaf20525` and remains at `857b8f0d`. Per AR-1245
> §3 the older history is a separate population-governance packet and is not to be reconstructed
> inside G2.

## ATTRIBUTION — G2-A/B did not move the governed instrument

Per AR-1243 §10.1(3), the two cases are distinguished:

```text
drift already present at the pre-G2 base : ALL 20
drift introduced by G2-A/B               : 0
```

Attribution is exact, not inferred from counts: the derived populations are identical member-for-member
and in the same order at both pins, so no member can have entered or left within G2-A/B.

### Why G2-A/B could not have moved it — measured, not assumed

G2-A/B's new test file is head-only and is **absent from the derived population at head**:

```text
src/engine/tests/test_term_equivalence.py     preG2_exists=False  g2head_exists=True
  engine/tests/test_term_equivalence.py       in_derived_head=False  in_manifest=False
src/engine/tests/test_source_fidelity_guard.py preG2_exists=True   g2head_exists=True
  engine/tests/test_source_fidelity_guard.py  in_derived_head=False  in_manifest=False
```

Mechanism, with its evidence: `test_term_equivalence.py` contains **zero** references to either
closure target (`grep -cE 'spec_condition_compiler|spec_family_bindings' -> 0`); its imports reach
`term_equivalence`, `evidence_relevance` and `source_fidelity_guard` only. The derivation admits a
test file only when it transitively imports a closure target, so this file is outside the population
by the derivation's actual rule.

**Positive witness that the probe can see a file at all** (an absence claim needs one): a real member
of the drift set, `engine/tests/test_opus_phase1_route.py`, is reported `in_derived_head=True` and
`in_derived_pre=True` by the same probe run that reports the two G2 files absent.

## FINDING — the governed population cannot witness the G2-A/B lane

This is a scope limit worth stating rather than a defect. The governed population is defined by the
**compiler** closure; G2-A/B's work is in the **extraction-evidence** lane and legitimately does not
enter it. So the governed population would report "no regression" for G2-A/B whether or not G2-A/B
broke its own code.

AR-1243 §9 already anticipates this — G2-H is satisfied by *"the governed canonical regression
population **plus the focused lane tests/controls**"*. This measurement shows that the second half of
that sentence is load-bearing, not decorative: on this packet the governed population contributes
**zero** coverage of the changed code, and the focused lane tests are the only witness of it.

## Reproduce

```bash
git worktree add --detach <pre> eaf205252230732274c20b8174ab942da856b45b
python scripts/g2h_population_drift_probe.py <pre>  PRE_G2_eaf20525   pop-pre.json
python scripts/g2h_population_drift_probe.py <head> G2_HEAD_857b8f0d  pop-head.json
# then compare derived_full / derived_only / manifest_full as ordered lists
```

## Disposition

```text
G2-H population-drift attribution : CLOSED — pre-existing debt, does not block G2-C/D
G2-H OVERALL                      : OPEN. AR-1245 §5 — the attribution being closed may NOT be
                                    compressed to "G2-H closed". The final receipt is one governed
                                    delta (eaf20525 -> final G2 head) PLUS the focused lane tests,
                                    and both legs are required (AR-1245 §4).
manifest regenerated              : NO (forbidden without member-by-member disposition)
manifest debt                     : OPEN, carried — 20 members, unchanged by this packet;
                                    older cause UNRESOLVED, do not guess (AR-1245 §3)
next                              : G2-C (AR-1243 §11) antecedent wiring
```

**GRADED:** GPT AR-1245 ruled this packet **PASS** at its actual scope, with the §3 causal-wording
correction applied above.
