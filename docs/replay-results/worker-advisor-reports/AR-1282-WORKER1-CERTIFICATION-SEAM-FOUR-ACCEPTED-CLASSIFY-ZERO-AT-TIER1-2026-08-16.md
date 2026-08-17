# AR-1282 — WORKER-1 — CERTIFICATION-SEAM MEASUREMENT

**RULING:** AR-1281A §4 (zero-model certification-seam measurement + minimal wiring), 2026-08-16.
Executed clauses: §4.A reconstruct contract · §4.B exercise only the 4 accepted rows · §4.C six
negative controls · §4.D post-G2 continuation shape · §4.E repair stale AR-1281 headline · §4.F
report next authorization surface.

**PIN:** worker tree `C:\Users\tonio\Projects\wt-claude-worker1-20260815`, branch
`claude/worker1-h1-20260815`, parent head `e85aa66e5f34e406ea9214db0ec6d56c691cda28`.

**SPEND:** model calls **0**. design-pool **0**. frozen-G2 **0**. Agent/subagent **0**. Opus **0**.

---

## §F VERDICT — `FOUR_ACCEPTED_HAVE_TIER3_RESIDUALS`

```
accepted_route_rows               = 4
accepted_rows_classified_at_tier1 = 0
accepted_rows_residual_tier3      = 4
frozen_route_rows_unresolved      = 8
```

**All four already-accepted rows anchor cleanly and then classify ZERO at tier-1.**
This is stronger than AR-1281A §3 anticipated: resolving the frozen eight is not merely
"not proven sufficient" — it is **demonstrably insufficient**, because the four rows that
are already accepted still do not classify.

---

## CHANGED

```
scripts/ar1282_certification_seam.py   NEW  measurement harness (zero-model adapter)
scripts/ar1282_seam_controls.py        NEW  6 negative controls + synthetic reachability
scripts/ar1281_terminal_read_proof.py  EDIT §4.E stale-headline repair
docs/replay-results/worker-advisor-reports/AR-1282-...md  NEW this report
```

**No production source changed.** No certification policy, frozen queue, receipt, settings,
toolbox, or `cert_assembler.py` edit. The seam already exists in production (see §A) — this
packet measures it and adds no new production path.

---

## §A THE SEAM, RECONSTRUCTED FROM CODE (not prose)

```
opus_phase1_route outcome (disposition + verbatim quote + char_span)
  -> anchor_locator.locate_anchor(propose_fn=...)        anchor_locator.py:259-278
     PROPOSE is any callable; the mechanical literal-substring VERIFY owns truth
  -> pilot_conveyor.prepare_strategy(..., propose_fn=)   pilot_conveyor.py:1133
     extract_spine_condition_texts -> locate_condition_anchors -> run_tier1 dual read
  -> tier1_detections XOR tier1_fallthroughs             (non-drop invariant, asserted)
  -> pilot_conveyor.finalize_certificate(...)            pilot_conveyor.py:1502
  -> cert_assembler.assemble_certificate(...)            cert_assembler.py:299
     classifying_tier in {1,3} ONLY; every_condition_classified gates pilot_grade
```

**Why this needs no model call:** the route already carries a verbatim `quote` per condition, so
PROPOSE is a dict lookup; `run_tier1` is pure regex; `finalize_certificate` consumes tier-3
verdicts as DATA. The adapter proposes for the 4 accepted rows and **abstains** on the other 8,
so held/refused/red evidence is never treated as accepted (AR-1281A §4.B).

## PINS VERIFIED BEFORE MEASUREMENT (fail-closed)

```
transcript sha256  df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc  MATCH
extraction sha256  c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823  MATCH
route artifact     grade/opus-v2/opus_phase1_route_t1.json  grade=RED  12 conditions
route dispositions ACCEPTED 4 / REFUSED_RELEVANCE 5 / HELD_DUPLICATE 2 / RED_FIDELITY 1
all 4 accepted quotes resolve literally at their exact route spans (span_exact=True x4)
transcript located at src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt
```

---

## §B PER-ROW RESULT — `python scripts/ar1282_certification_seam.py`

```
condition_ref              anchored  tier1_classified  outcome                              residual item
entry_sequence[0].action   True      False             fallthrough_pending_tier3            sVkmZklJDHI-S0-B000
entry_sequence[3].action   True      False             fallthrough_dual_read_disagreement   sVkmZklJDHI-S0-B001
stop.rationale             True      False             fallthrough_pending_tier3            sVkmZklJDHI-S0-B002
targets[0].rationale       True      False             fallthrough_pending_tier3            sVkmZklJDHI-S0-B003

adapter_calls: total 12, proposed 4, abstained 8   <- the 8 stay unresolved, as ordered
```

Certificate state after `finalize_certificate(prep, tier3_verdicts=[])`:

```
condition_count             12
classifying_tiers           [None] x12
tier1_count 0 · tier3_count 0 · unclassified_count 12
every_condition_classified  False
pilot_grade                 False
certificate_grade           False
terminal_read_grade         CLEAN     (conflation=PASS supplied as data)
terminal_read_clean         True
```

**Independent corroboration through a second, non-overlapping path:** the LANDED certificate
(`grade/certificate.json`, written before this packet) also records 12/12 unclassified. The live
harness run and the landed artifact agree without sharing a code path.

**Determinism:** two consecutive runs produce byte-identical JSON (`run1 == run2 : True`).

---

## §C CONTROLS — `python scripts/ar1282_seam_controls.py` → **7/7 PASS**

```
PASS C1  ACCEPTED_PENDING_CERTIFICATION alone cannot manufacture classifying_tier=3
         evidence: accepted row fed as fall-through, no verdict -> classifying_tiers=[None]
PASS C2  a held/refused/red route row cannot enter the accepted-proposal set
         evidence: withheld_rows=8, leaked_into_proposals=[], proposal_map_size=4
PASS C3  a quote/span mismatch refuses (mechanical VERIFY owns the truth)
         POSITIVE WITNESS: true quote located=True span=(8191,8701)   <- proves path RAN
         tampered quote  located=False reason=proposed_quote_not_literal_substring
PASS C4  a Tier-3 verdict with control_gate_passed=false cannot classify
         DISCRIMINATING: gate False -> [None]; gate True -> [3]  (same span, same verdict)
PASS C5  a missing Tier-3 verdict leaves the residual condition classifying_tier=None
PASS C6  only Tier-1/Tier-3 contracts satisfy every_condition_classified
         evidence: tier1+unresolved -> [1, None], pilot_grade=False
PASS D   SYNTHETIC reachability control — LABELED SYNTHETIC, NOT A REAL PASS
         all spans given control-gate-passing tier-3 -> pilot_grade=True,
         terminal_read_grade=CLEAN, certificate_grade=True
```

C4 carries both polarities on identical input, so it discriminates "catches breakage" from
"always red". C3 carries a positive witness, so its refusal is not satisfied by a dead path.

## REGRESSION

```
python -m pytest src/engine/tests/test_cert_assembler.py \
                 src/engine/tests/test_pilot_conveyor.py \
                 src/engine/tests/test_opus_phase1_route.py -q
108 passed in 0.43s
```

---

## §E STALE-HEADLINE REPAIR — DONE

`scripts/ar1281_terminal_read_proof.py` previously printed
`CONFLATION_PASS_ONLY_FROZEN_G2_REMAINS` and labelled `pilot_grade` the
"frozen-eight/anchoring axis". Both were over-broad. It now prints only
`CONFLATION_PASS_TERMINAL_READ_CLEAN` and **mechanically measures** the other conjunct:

```
OTHER LIVE CONJUNCT — measured, not assumed (AR-1282 §E)
  certificate conditions      : 12
  unclassified (tier not 1/3) : 12
  every_condition_classified  : False
CONCLUSION
  CONFLATION_PASS_TERMINAL_READ_CLEAN
  This is NOT 'only frozen G2 remains': 12/12 certificate conditions are still unclassified
```

The counterfactual control still discriminates (PASS→CLEAN / REJECT→REJECTED / None→INDETERMINATE)
and the harness still reproduces the landed certificate baseline.

---

## FINDINGS

**F-1 (primary).** The four ACCEPTED rows classify **0/4** at tier-1. Therefore the frozen eight
are **not** the sole remaining certification blocker, and a perfect 8/8 isolated-evidence outcome
would still leave `every_condition_classified=False`. AR-1281's withheld sole-blocker claim was
correct, and AR-1281A §3's "not by itself proof" is now measured as outright insufficiency.

**F-2.** The seam is **NOT missing.** `CERTIFICATION_SEAM_MISSING` does not apply: production
already exposes the full path (`propose_fn` → `prepare_strategy` → `finalize_certificate` →
`assemble_certificate`). No adapter needed to be added to production; the harness is measurement
only.

**F-3 (AGAINST MYSELF).** My first harness read `cert["terminal_read"]`, a key that does not
exist — it returned `None` and read as "axis absent", which would have contradicted AR-1281's
verified PASS. The certificate exposes three FLAT keys (`terminal_read_grade`,
`terminal_read_clean`, `terminal_read_disposition`). Caught by checking the field against
`cert_assembler.py:479-481` before publishing. This is the §2a "field next to the claim" shape.

**F-4.** `entry_sequence[3].action` did not fall through by plain non-detection — it fell through
via `fallthrough_dual_read_disagreement` (Addendum 4 Fix 1 veto: the located quote and the
condition's own text disagreed). Distinct mechanism from the other three; a tier-3 adjudication
for it answers a different question.

**F-5 (correction to AR-1281A §4.F wording).** §4.F asks for "exact **pre-existing** blind packet
items". There is **no pre-existing tier-3 classification packet** for these four. The existing
`grade/blind_support_packet.json` / `_v2.json` are a DIFFERENT task (Addendum-4 Fix-2 *support*
adjudication, keyed by `condition_ref`, items `entry_sequence[0].action` … / `C-1`). The tier-3
item IDs above are minted deterministically by production `_build_tier3_packet` at run time
(`B000`–`B003`, stable across runs), not read from a frozen artifact.

**F-6 (prior art, not a new defect).** Span `[9432,9512]` is shared by
`entry_sequence[1].action` and `confluences[1].description`. The route already flags this
`severity: HIGH` in its own `collisions` field and holds BOTH rows as
`HELD_DUPLICATE_ROLE_AMBIGUITY`. This is `span_collision.py` (AR-1226 §6 lane L1) working as
designed. Flagged only because `assemble_certificate` joins tier-3 verdicts BY `char_span`, so if
those two rows are ever accepted at the same span, one verdict would classify both.

---

## §D POST-G2 CONTINUATION — SHAPE PROVEN, COUNTS ESTIMATED

Proven (synthetic control D, labeled): once every residual carries a control-gate-passing
`Tier3Verdict`, `every_condition_classified` becomes True and `certificate_grade` becomes True
with `terminal_read_grade=CLEAN`. The pathway is reachable; nothing structural blocks it.

**What remains AFTER the frozen eight turn the route green:**

```
expected tier-1 classifications  ESTIMATE: low — 0/4 measured on the rows already accepted
residual tier-3 adjudications    ESTIMATE: up to 12 (bounded below by the 4 measured residuals)
```

These are **ESTIMATES and labelled as such.** Exact values for the other eight are NOT executable
today: measuring them would require treating held/refused/red evidence as accepted, which
AR-1281A §4.B forbids. The only executable fact is the four: **4 of 4 are tier-3 residuals.**

---

## STOP

None fired. All work stayed inside AR-1281A §4; every §5 detour (control-plane bootstrap,
PowerShell guard, CLAUDE.md/token-plan, frozen queue/receipts/manifest, Opus dispatch,
Agent/subagent, paid judgment, compiler implementation, backtest/PAPER/Topstep) untouched.

## NEXT

Not self-authorized. The measured result changes the decision surface: the frozen eight can no
longer be assumed sufficient, so the next question is whether the certification route intends
tier-3 adjudication for **all 12** conditions (making the frozen-eight isolated queue one input
among two) or whether tier-1 is expected to fire on rows like these and is under-firing. That is
an architecture/authorization call for GPT, not a worker call.

Recommendation: **GRADE_REQUESTED** — AR-1282 is complete and filed; no further authorized item
remains in AR-1281A.
