# AR-1248 — WORKER · G2-C1 SAME-ENTITY REPAIR GREEN (AND IT EXPOSED A HOLLOW TEST); G2-D0 SELECTION LAW FROZEN · 2026-08-16

```text
AR-1248
RULING : AR-1247 §6 (G2-C1 narrow repair) + §9 (G2-D0 freeze the selection law). Both were
         marked AUTHORIZED NOW and neither needs the expensive model, so both are done.
PIN    : branch claude/worker1-h1-20260815
         G2-C1  f6eae6ad
         G2-D0  (committed in the same push)
         head   a5bbb84d  (SYSTEM-INVENTORY regenerate for the pre-push gate)
         base   0df39e3c (the AR-1247 worker SHA)
CHANGED: src/engine/extraction/evidence_antecedent.py        (+94/-?)   F-1 + F-2 repair
         src/engine/extraction/opus_phase1_route.py          (+30)      spec validation
         src/engine/tests/test_evidence_antecedent.py        (+135)
         src/engine/tests/test_route_antecedent_composition.py (+64)
         src/engine/extraction/isolated_fallback_law.py      (new)      G2-D0
         src/engine/tests/test_isolated_fallback_law.py      (new)      G2-D0
         docs/designs/SYSTEM-INVENTORY.md                    (regenerated)
         No compiler execution semantics, backtester, PAPER, broker, Topstep or live surface.
         No route artifact regenerated. No real sVkm composition spec authored.
```

## F-1 IS CONFIRMED AND THE MISS IS MINE

You are right. AR-1243 §11 named four requirements; the shared helper implemented three. I
verified the helper existed and that its stated contract matched the ruling's prose — I never
checked that it implemented **every clause** of it. That is a pre-flight question 5 failure, not
a subtle one.

Repair, in the existing helper, all three before any `BOUND` is reachable:

```text
E. entity term present in the ANTECEDENT   -> ENTITY_ABSENT_AT_ANTECEDENT
G. definitional marker in the ANTECEDENT   -> ANTECEDENT_DOES_NOT_DEFINE
F. entity term present in the REFERENCE    -> ENTITY_ABSENT_AT_REFERENCE
```

The `BOUND` receipt now names which entity was defined, by which marker, and that the reference
names the same one — so the link is auditable from the receipt instead of implied by it.

## F-2 IS CONFIRMED

```text
entity_terms == ()          -> VACUOUS_ENTITY_VOCABULARY        (helper refuses)
definitional_markers == ()  -> VACUOUS_DEFINITIONAL_VOCABULARY  (helper refuses)
span out of bounds          -> SPAN_OUT_OF_BOUNDS               (helper refuses)
```

Refused at the route's spec validator too, earlier and louder, for its own callers. The helper
keeps its own copy because it protects every caller, not just the route.

Your span point was exact: a negative or over-long offset does **not** raise in Python, it
silently slices different text — and that text would have become the provenance.

## 🛑 THE REPAIR EXPOSED A HOLLOW TEST — AND IT WAS IN THE SUITE THAT "PROVED" THE HELPER

This is the part worth your attention, because it is F-1 caught on real data by accident.

The helper's existing intervening-redefinition test used an antecedent span beginning
`"So again, 9:30 a.m. Eastern time, go on the 5-minute candle."`. **That span never contains the
word `range` at all.** So it was exercising check 4 — no intervening redefinition of the entity —
against an entity that had **never been established**. It went green because the binding refused,
not because the redefinition branch ran.

Once check 3 existed the test failed, at `ENTITY_ABSENT_AT_ANTECEDENT`.

I did **not** weaken it. The real source defines the range twice, so a genuine fixture exists:

```text
antecedent  : "And what that now gives me is a range on the five minute." … "that's how low it went."
intervening : "if I was to draw out the range with more of a structure like this"   <- @9512, real
reference   : "this range, it means that the price is going down"                   <- @10931, real
result      : INTERVENING_REDEFINITION, and r.intervening_redefinition contains "draw"
```

The old fixture is retained as a permanent negative
(`test_the_old_redefinition_fixture_never_established_the_entity`) which asserts the span really
does lack the entity, so the retarget cannot be quietly reverted and the hollowness cannot recur
silently.

★ **A test that goes green because the function refused for a DIFFERENT reason is not a test of
the branch it is named after.** I only found this because your repair made the earlier check fire
first.

## RED → GREEN AND THE CONTROLS

```text
$ python -m pytest test_evidence_antecedent.py test_route_antecedent_composition.py -q
45 passed

$ python -m pytest <the 8 G2 lane suites> -q
165 passed
```

Seven mutations, each disabling ONE new check, run with a byte-snapshot + hash-verified restore:

```text
UNMUTATED CONTROL                           : 45 passed
F1a entity check at antecedent disabled     :  2 failed, 43 passed
F1b definitional marker check disabled      :  2 failed, 43 passed
F1c entity check at reference disabled      :  2 failed, 43 passed
F2a empty entity vocabulary allowed         :  1 failed, 44 passed
F2b empty marker vocabulary allowed         :  1 failed, 44 passed
F2c span bounds check disabled              :  5 failed, 40 passed
F2d route spec bounds validation disabled   :  2 failed, 43 passed
RESTORED CONTROL                            : 45 passed
```

Every new check bites. Unmutated and restored controls discriminate, and both files were verified
clean against the commit afterwards. Per §6 these are behavioural mutations, not source-text
assertions.

The positive control is retained and explicitly tested: the original valid range binding still
composes after the repair, so the new checks discriminate rather than merely refuse more.

## G2-D0 — THE SELECTION LAW IS FROZEN (`isolated_fallback_law.py`)

Every item §9 lists is pinned:

```text
input route version          copied from the route record
eligible dispositions        taken from the ROUTE's own published ESCALATES_TO_ISOLATED —
                             not a second copy that can drift
one attempt maximum          MAX_ATTEMPTS_PER_CONDITION = 1, enforced at the ledger
condition_ref -> hashes      task_input_sha256 over law version + route version + ref + text +
                             pinned transcript/extraction identities
no ACCEPTED escalation       refused, and the exclusion records why
no retry-after-failure       the attempt is claimed BEFORE the answer is known
no best-of cherry-pick       no compare/choose/rank API exists and the module never reads the
                             batch candidate at all
substitution rule first      module constant, hashed into the artifact so a later edit shows
raw preserved before parse   stored verbatim; nothing inspects or shortens it
```

Both controls you named:

- flipping one condition blocking → `ACCEPTED` removes it from the queue and records the reason;
- an unregistered blocking disposition **raises** rather than being dropped — plus a
  discriminating control proving that check is not always-red.

The selection derives from disposition: `freeze_isolated_queue` has no parameter through which a
caller can name conditions. A test pins the signature, and an extra `condition_texts` entry for a
ref the route never dispositioned does **not** create a queue entry.

★ The retry ban is closed at the **ledger**, not by policy — a disappointing answer has already
spent the budget. Policies get forgotten; a missing function cannot be called.

## §7 — ADJUDICATION ACCEPTED

Relevance stays on the primary span and is not re-run over the composed package. Recorded as
`relevance.evaluated_on = "primary_span_only"` with `evidence_is_composed` beside it. No second
relevance framework, and no disposition moved by concatenating context.

## §8 — THE G2-D BLOCK, STATED PRECISELY

You are right that "my seat says no" is not a measured blocker, and I am not offering it as one.
The precise fact: the block is **not** repository authority and not an API-key or spend question —
AR-1232's subscription path is understood and I am not requesting a key. It is a standing
instruction in this runtime's own operating configuration that I not dispatch subagents unless
the operator asks. Your §8 covers exactly this case and says do not bypass it and do not fake the
run, so I have done neither.

I have **not** attempted a dispatch to manufacture a failure receipt, because attempting it is
itself the prohibited act — the receipt would be produced by doing the thing I am told not to do.
That is a real limitation of the evidence I can offer here and I am stating it rather than
dressing it up. The operator has been asked directly, twice, in plain terms.

Meanwhile §9 was the correct instruction and it is done, so the block cost nothing this turn.

## SCOPE — WHAT THIS DOES NOT PROVE

- No real sVkm composition spec exists, so the real route is unchanged and no grade moved. Per
  §11 I have not invented one, and a non-blank `authority` string is not permission to.
- G2-D's actual isolated run has not happened. Nothing here claims otherwise.
- The frozen-queue module has never been run against the real route record — only synthetic ones.
  Its first real freeze belongs to G2-D.
- All evidence is LOCAL. GitHub shows no CI at this SHA; do not read 45/165 as CI green.

```text
GRADER : not dispatched (same §8 constraint). GPT is the grader.
STOP   : none fired on C1 or D0.
NEXT   : G2-D's isolated run is the only thing gated on the operator's word. If it stays gated,
         say so and I will take G2-E/F/G's deterministic parts — the complete final-set
         collision/relevance/composition/fidelity pass over the conditions that do NOT earn
         escalation — which needs no model call and no new authority.
```
