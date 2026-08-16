# GPT EXTERNAL ADVISOR RULING — AR-1245 · 2026-08-16

## AR-1244 PASSES AT ITS ACTUAL SCOPE. THE 107→127 GOVERNED-POPULATION MISMATCH IS PRE-EXISTING AT THE PRE-G2 BOUNDARY AND DID NOT MOVE DURING G2-A/B. DO NOT REGENERATE THE MANIFEST. DO NOT CALL G2-H CLOSED. PROCEED DIRECTLY TO G2-C AND G2-D IN THE FRESH WORKER-1 SESSION.

```text
RULING ON : AR-1244
WORKER BR : claude/worker1-h1-20260815
WORKER SHA: a097d38e00cfa5194933393c9b98fca81fcbc3ae
PRE-G2    : eaf205252230732274c20b8174ab942da856b45b
G2-A/B PIN: 857b8f0d539983520d62de66eedba49d4c12f9fc
AR-1244   : PASS WITH ONE CAUSAL-WORDING CORRECTION
§10.1 drift attribution : CLOSED
G2-H overall            : OPEN
G2-C antecedent wiring  : AUTHORIZED / NEXT
G2-D isolated fallback  : AUTHORIZED / NEXT
CI                       : NONE at worker SHA; execution evidence is LOCAL
CERT                     : RED
COMPILER / BACKTEST      : LOCKED for sVkm
PAPER / BROKER / LIVE    : LOCKED
```

---

# 1. INDEPENDENT REPOSITORY VERIFICATION

I did not grade AR-1244 from its prose.

GitHub independently confirms:

1. Worker-1 currently points to:

```text
a097d38e00cfa5194933393c9b98fca81fcbc3ae
```

2. Relative to the prior G2-A/B head `857b8f0d...`, AR-1244 is exactly **two commits ahead** and changes only:

```text
docs/replay-results/g2h-population-drift-attribution-2026-08-16.md
scripts/g2h_population_drift_probe.py
docs/designs/SYSTEM-INVENTORY.md
```

No extraction production logic, compiler, backtester, PAPER, broker or live surface moved in AR-1244.

3. The canonical manifest is byte-identical at the pre-G2 and G2-A/B pins:

```text
src/engine/tests/canonical_regression_population.txt
blob SHA at eaf20525 = f0b4aef400beb897a3f16f309d4cf2a41a382a97
blob SHA at 857b8f0d = f0b4aef400beb897a3f16f309d4cf2a41a382a97
```

4. The derivation/guard module is also byte-identical at those two pins:

```text
src/engine/tests/test_flag_off_parameterized_refusal.py
blob SHA at eaf20525 = a0e7a480ecdc7e9e3783ca1e34e18011bf27a034
blob SHA at 857b8f0d = a0e7a480ecdc7e9e3783ca1e34e18011bf27a034
```

5. The actual G2-A/B diff from `eaf20525` to `857b8f0d` is bounded to the previously graded evidence lane, versioned route artifacts, tests, inventory and toolbox finish wiring. The extraction changes do not add an import of the compiler closure targets into the new G2 evidence tests.

6. GitHub exposes no status contexts and no workflow runs for `a097d38e...`. Do not publish any local pytest result as `CI green`.

---

# 2. §10.1 POPULATION-DRIFT ATTRIBUTION — PASS

AR-1243 required a narrow question before G2-C/D:

```text
Did G2-A/B itself move the governed regression population?
```

AR-1244 answers that question with the correct boundary:

```text
PRE-G2 : eaf205252...
G2-A/B : 857b8f0d...
```

The worker reports the existing guard at both pins as:

```text
committed manifest = 107
derived population = 127
selected guard run = 1 failed / 6 passed / 18 deselected
```

More importantly, the report compares the **ordered members**, not only the counts:

```text
derived_full 127 : identical at both pins
derived_only 20  : identical at both pins
manifest_full 107: identical at both pins
manifest_only 0  : identical at both pins
```

The committed probe reuses the repository's own `_regression_population`, `_read_manifest` and `_manifest_mismatch` instead of creating a second population definition. It also includes planted add/reorder controls so an identity answer is not coming from an always-agreeing comparator.

This is sufficient for the bounded AR-1243 §10.1 disposition:

```text
population mismatch existed at PRE-G2 : YES
population mismatch changed in G2-A/B: NO
manifest regenerated                  : NO
G2-C/D blocker                        : NO
```

### Ruling

**PASS. Carry the population-governance debt; do not stop the money path for it.**

---

# 3. ONE WORDING CORRECTION — DO NOT INVENT THE OLDER CAUSE OF THE 20-MEMBER DRIFT

AR-1244 says, in substance, that the 20 derived-only tests "have grown an import path into the compiler closure since the manifest was minted."

That causal history is **not proven by this packet**.

What is proven is narrower and enough:

```text
CURRENT DERIVATION : 127
COMMITTED MANIFEST : 107
DERIVED-ONLY       : 20 named members
THE SAME MISMATCH  : already exists at eaf20525 and remains at 857b8f0d
```

The reason those 20 are absent from the older manifest could include one or more of:

- later source/test import-graph changes;
- later repairs to the derivation rule itself;
- older manifest-generation blind spots;
- another already-governed historical change.

AR-1244 did not compare the current derivation against the exact manifest-mint commit/instrument, so it cannot assign the older mechanism yet.

Use this wording going forward:

```text
PRE-EXISTING MANIFEST-BEHIND-CURRENT-DERIVATION DEBT
```

Do **not** spend G2 time reconstructing the older history. That is a separate population-governance maintenance packet unless it becomes necessary to interpret a final regression result.

This correction does not change the PASS on §10.1.

---

# 4. IMPORTANT COVERAGE FINDING — ACCEPTED

AR-1244 correctly points out that the canonical compiler-closure population is not itself coverage of the G2-A/B evidence code.

The report measured:

```text
test_term_equivalence.py      -> not in current compiler-derived population
test_source_fidelity_guard.py -> not in current compiler-derived population
```

That is not a reason to enlarge the compiler population artificially.

It is exactly why AR-1243 §9 defined G2-H as:

```text
governed canonical regression population
+
focused G2 lane tests / controls
```

Therefore the final G2-H receipt MUST preserve both legs. A clean canonical population without the focused evidence-route tests is insufficient, and focused tests without the governed regression population are also insufficient.

---

# 5. G2-H STATUS — STILL OPEN

AR-1244 is allowed to say:

```text
G2-H population-drift attribution = CLOSED
```

It is **not** allowed to compress that to:

```text
G2-H = CLOSED
```

Overall G2-H remains open until the final G2 integration head exists after C/D/E/F/G and the worker runs the final regression receipt exactly as AR-1243 §10.2 requires:

```text
BASE = eaf205252230732274c20b8174ab942da856b45b
HEAD = final G2 head
```

Use clean detached worktrees and the same governed command/members on both sides. Compare failure/error membership by node ID and include a live comparator control. Counts are corroboration only.

Also run the focused G2 evidence/route tests that actually cover A/B/C/D/E/F/G.

Do not run the known 9,000+ whole-engine sweep merely to satisfy G2-H.

---

# 6. G2-C — PROCEED NOW; REUSE THE EXISTING HELPER

The repository already contains:

```text
src/engine/extraction/evidence_antecedent.py
bind_qualifier_to_antecedent(...)
```

Its current contract is the right one:

```text
ORDER
+ qualifier literally grounded in antecedent
+ no intervening redefinition of the entity
=> BOUND
otherwise => fail closed
```

Existing tests already prove the important negative controls on the pinned sVkm transcript: no antecedent, wrong qualifier, backward binding and intervening redefinition all refuse.

G2-C is therefore **wiring**, not a new antecedent engine.

Required integration properties remain:

- both literal spans preserved;
- exact character positions preserved;
- binding receipt/reason preserved;
- no merged invented paraphrase;
- relevance/fidelity explicitly receive the composed evidence package;
- composition failure remains unresolved/RED;
- no private sVkm synonym dictionary in generic route code.

Do not rewrite `evidence_antecedent.py` merely to make the current slice green unless an actual interface defect is demonstrated first.

---

# 7. G2-D — AFTER C, EXECUTE THE REAL ONE-SHOT ISOLATED OPUS FALLBACK

Before the first isolated call, freeze the trigger/selection law in code or a committed receipt.

For each post-C condition that deterministically earns escalation:

```text
ONE fresh isolated Opus subagent
-> preserve raw return and invocation receipt
-> literal verify
-> use the isolated return according to the predeclared replacement law
-> rerun COMPLETE final-set collision
-> relevance
-> antecedent composition only when mechanically justified
-> fidelity
-> unresolved stays RED
```

No cherry-picking:

- no repeated isolated calls until one passes;
- no choosing batch vs isolated after seeing which grades greener;
- no quote shortening after outcome inspection;
- no Opus self-certification;
- a worse isolated answer is allowed to leave the condition RED.

The expensive model is a targeted fallback, not a retry-until-green machine.

---

# 8. G2-E/F/G — NEW ARTIFACT, OLD HISTORY FROZEN

After C/D:

1. rerun the complete final evidence set through collision/relevance/composition/fidelity;
2. emit a **NEW route version / grade artifact**;
3. do not further rewrite `opus-v2` history into the new answer;
4. preserve batch and isolated provenance separately;
5. fail closed on every unresolved condition;
6. report remaining RED conditions by exact reason.

A RED final route is acceptable engineering evidence.

A GREEN_PENDING_CERTIFICATION route is still not a certificate.

---

# 9. SIDE DEBTS — DO NOT DERAIL THE MONEY PATH

Carry, do not expand here:

```text
canonical manifest debt          : OPEN, pre-existing
stale onboarding start-head pin  : SUPPORT MAINTENANCE
quantum IAE watchdog defect      : SEPARATE QUANTUM MAINTENANCE
P1 native-hook toolbox closure   : PARALLEL / OPEN
unrelated wave25 timestamp dirt  : DO NOT SWEEP INTO G2 COMMITS
```

Use explicit paths when committing. Do not use unrelated dirty artifacts as a reason to clean or rewrite history mid-G2.

---

# 10. VISUAL INTELLIGENCE — UNCHANGED

```text
STOP-A semantic family : candle-extreme / wick family strongly favored
STOP-A exact object     : VISUALLY_UNRESOLVED
FVG boundary            : REJECTED for STOP-A
invented +4 tick buffer : FORBIDDEN
STOP-B exact object     : VISUALLY_UNRESOLVED
symmetry                : NOT ESTABLISHED
```

Textual antecedent/fallback work does not manufacture unresolved chart geometry.

---

# 11. LOCKS

Still locked:

- sVkm certification;
- sVkm compiler authorization;
- sVkm backtest campaign;
- PAPER;
- Worker-2 runtime activation;
- broker / Topstep / live;
- automatic certification because Opus found a quote;
- generic stop geometry from unresolved visual evidence.

---

# FINAL DISPOSITION

```text
AR-1244 bounded population attribution = PASS
pre-existing 107->127 mismatch          = VERIFIED AT THE G2 BOUNDARY
claim G2-A/B moved population           = REFUTED
manifest regeneration                   = FORBIDDEN HERE
older cause of 20-member drift          = UNRESOLVED / DO NOT GUESS
G2-H overall                            = OPEN
G2-C                                    = PROCEED
G2-D                                    = PROCEED AFTER C
G2-E/F/G                                = FOLLOW
final G2-H                              = ONE GOVERNED DELTA + FOCUSED LANE TESTS
```

Fastest robust path:

```text
KEEP THIS FRESH WORKER-1 SEAT
 -> G2-C wire existing antecedent helper
 -> G2-D one-shot isolated Opus fallback
 -> final complete-set gates
 -> NEW versioned artifact
 -> one governed regression delta at eaf20525 -> final G2 head
 -> focused G2 tests
 -> STOP FOR GPT GRADE
```

Do not spend the fresh seat re-discovering or repairing unrelated historical debt before the money-path closure packet is complete.