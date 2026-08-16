# AR-1246 — WORKER · G2-C ANTECEDENT COMPOSITION WIRED, FAIL-CLOSED; AR-1245 §3 CORRECTION LANDED; G2-D BLOCKED ON SUBAGENT AUTHORIZATION · 2026-08-16

```text
AR-1246
RULING : AR-1243 §11 + AR-1245 §6 (G2-C — wire the existing antecedent helper, not another one).
         Your AR-1245 landed on the branch WHILE I was building this report and had already taken
         the number 1245, so this is 1246. I re-fetched before publishing and read it first.
PIN    : branch claude/worker1-h1-20260815
         G2-C code    15f25d7c
         inventory    b37e1f38 (pre-push gate)
         §3 correction 0df39e3c  <- landed BEFORE this report
         tree         C:\Users\tonio\Projects\wt-claude-worker1-20260815
CHANGED: src/engine/extraction/opus_phase1_route.py            (+168 / -7)
         src/engine/tests/test_route_antecedent_composition.py (new, 347 lines, 19 tests)
         docs/designs/SYSTEM-INVENTORY.md                      (regenerated, pre-push gate)
         No other production file. No compiler execution semantics, backtester, PAPER, broker,
         Topstep or live surface touched. The antecedent helper itself was NOT edited.
```

## AR-1245 §3 CORRECTION — ACCEPTED AND ALREADY LANDED (`0df39e3c`)

You are right, and it is a correction against me. AR-1244 said the 20 derived-only tests *"have
grown an import path into the compiler closure since the manifest was last minted."* That names a
**cause this packet never measured** — I never compared the current derivation against the
manifest's mint commit or its mint-time instrument, so later import-graph changes, later repairs to
the derivation rule, and older manifest blind spots all remain live explanations.

Struck and retained in the committed artifact rather than silently amended, and the wording you
specified — `PRE-EXISTING MANIFEST-BEHIND-CURRENT-DERIVATION DEBT` — is now what the artifact
carries. Per §3 I am **not** reconstructing the older history inside G2.

Also applied from §5: the artifact's disposition block now states **G2-H OVERALL = OPEN**, so
"attribution closed" cannot be read as "G2-H closed". §4's two-leg requirement is recorded there
too.

## AR-1245 §6 COMPLIANCE — MEASURED, NOT ASSERTED

| §6 required property | how this build satisfies it |
|---|---|
| both literal spans preserved | fidelity receives `[antecedent, referring]`; test asserts each is `in TRANSCRIPT` |
| exact character positions preserved | test asserts `TRANSCRIPT[start:end]` still equals each recorded quote |
| binding receipt/reason preserved | `composition.reason` is the helper's own string, not a paraphrase |
| no merged invented paraphrase | mutation B (concatenate the two spans) reddens 3 tests |
| composition failure remains RED | `RED_ANTECEDENT_UNBOUND`, never a fall-back; mutation A reddens 4 tests |
| no private sVkm synonym dictionary in generic route code | every domain term is caller-supplied; `_validate_composition_specs` refuses an unauthored spec. The route file contains no strategy, instrument, timeframe or teacher string |
| `evidence_antecedent.py` not rewritten | untouched in this packet — no interface defect was demonstrated, so none was claimed |

## WHAT WAS ACTUALLY BROKEN

`evidence_antecedent.bind_qualifier_to_antecedent` had **zero non-test callers** — built, tested
and unreachable. Measured before the change:

```text
$ grep -rn "bind_qualifier_to_antecedent" src/ --include=*.py | grep -v "/tests/"
src/engine/extraction/evidence_antecedent.py:32:__all__ = [...]      <- its own export
src/engine/extraction/evidence_antecedent.py:62:def bind_qualifier_to_antecedent(   <- its own def
```

Corroborated by the independently generated map (`docs/designs/SYSTEM-INVENTORY.md`), which is not
my grep: the row read `| bind_qualifier_to_antecedent | function | ...:62 | 1 | unique |` — one
caller, its own test. **After the change the same generated row reads `2`.**

## THE REPAIR

Composition is now a gate **between relevance and fidelity**, which is AR-1243 §12's stated order.
It calls the existing helper **by import**; order, grounding and the no-intervening-redefinition
check all stay owned by `evidence_antecedent`, so the route inherits its fixes and cannot drift a
second copy of the rule (AR-1239 §3.2: *"Reuse it. Do not write a second antecedent engine."*).

It fires **only** on an explicit caller spec that carries its own `authority`. The route never
infers that a condition needs earlier defining context — inferring it is how composition would
become a search for a greener grade instead of a fact about the source. An unauthored spec, an
empty qualifier, a spec for an unknown condition, or two specs for one condition are all refused
with a `ValueError` before any gate runs.

Both spans survive: the package handed to fidelity is a **list of two literal spans in source
order**, never a merged paraphrase. `check_condition_fidelity` already accepts a list natively, so
this required no change to the fidelity gate.

A failed antecedent check ends `RED_ANTECEDENT_UNBOUND` and does **not** fall back to the
uncomposed evidence. The fall-back is the real hazard: it would hand the weaker package the
acceptance the stronger one had just failed to earn, and it would look like a pass.

## RED → GREEN

The pair rides on a real defect, not a bent fixture. The condition names a number that appears
only in the earlier defining span; the referring span carries no number at all.

```text
RED   (no spec)   : disposition = RED_SOURCE_FIDELITY, findings include UNSUPPORTED_QUANTITY
GREEN (with spec) : disposition = ACCEPTED_PENDING_CERTIFICATION, fidelity_findings = []
```

Same route, same transcript, same quote — the only delta is the authored spec, so the change of
disposition is attributable to the wiring and nothing else. The RED row also shows
`relevance.grounded = True`, so it reached fidelity honestly rather than dying earlier.

```text
$ python -m pytest src/engine/tests/test_route_antecedent_composition.py -q
19 passed in 0.15s

$ python -m pytest test_opus_phase1_route.py test_evidence_antecedent.py \
      test_source_fidelity_guard.py test_term_equivalence.py test_batch_locator.py -q
98 passed in 0.38s
```

## CONTROL — five mutations, all of which bite

```text
PRISTINE sha=530c219b44049b26
UNMUTATED CONTROL                       : 19 passed
A_silent_fallback_on_failed_binding     :  4 failed, 15 passed
B_merged_paraphrase_instead_of_two_spans:  3 failed, 16 passed
C_composition_never_invoked             :  9 failed, 10 passed
D_relevance_scope_key_dropped           :  1 failed, 18 passed
E_not_reached_marker_dropped            :  1 failed, 18 passed
RESTORED sha=530c219b44049b26  matches_pristine=True
RESTORED CONTROL                        : 19 passed
```

The unmutated and restored controls discriminate: the suite is not always-red, and the restore is
verified by hash **and** by `git status` reporting the file clean against the commit.

## FINDINGS AGAINST MYSELF

1. **My first mutation harness destroyed the work it was measuring, and its output accused the
   code.** It restored with `git checkout -- <file>` while the change under test was still
   UNCOMMITTED, so the "restore" reverted the entire G2-C edit. Mutations B and C then found no
   anchor and did not run, and the suite reported `19 failed` — which I could have published as
   "the change is broken". The mutation that had genuinely bitten (A: 4 failed / 15 passed) was
   the only real datum in that run. Rebuilt as v2: byte snapshot, byte restore, hash-verified,
   and it refuses to report a result for a mutation whose anchor is absent. **Everything above is
   from the v2 run, after the work was committed.** `A SURPRISING RESULT IS AN ACCUSATION AGAINST
   YOUR INSTRUMENT FIRST` — and this time the instrument was the defect.
2. **One test failed first for a fixture reason, not a code reason.** I gave the off-topic
   condition a span that is a prefix of the stop quote, so the collision gate HELD it before
   relevance ever ran, and the test asserted `REFUSED_RELEVANCE`. The fixture was wrong, not the
   route. Replaced with a genuinely non-overlapping off-topic span, plus an in-test assertion
   that it does not overlap — so the next reader cannot reintroduce the same confusion silently.
3. I did **not** dispatch `accuracy-validator`. AR-1243 §11 requires no independent grade for
   G2-C, and this seat is under a standing harness restriction against dispatching subagents
   without the operator's word. GPT remains the grader for this packet. Flagging it rather than
   letting an ungraded repair look graded.

## A READING I MAY HAVE WRONG — please correct it if so

AR-1243 §11 says *"relevance/fidelity must be told explicitly that the evidence package is
composed"*, while §12 orders `relevance -> composition -> fidelity`. Under that order relevance
**cannot** see the composed package. I resolved it as: fidelity receives the composed package
explicitly as two distinct literal spans, and relevance's recorded verdict is stamped
`evaluated_on: "primary_span_only"` so nothing can read a composed row's green relevance as
though relevance had vetted both spans. **I did not re-run relevance on the composed package** —
that would change dispositions on a lane you have not authorized me to move. If you intended
relevance to be re-run over the composed evidence, say so and it is a small change.

## SCOPE — what this does NOT prove

- No route artifact was regenerated. The standing `opus-v2` history is untouched; that is G2-E/F.
- Composition changed **nothing** on the real sVkm slice, because no composition spec exists for
  it yet. The no-op is deliberate and red-proofed. Authoring the real sVkm specs is not something
  I have done, and I will not invent per-video aliases to create one (AR-1243 §11).
- All evidence is LOCAL. No CI ran at this SHA.
- The G2-A/B population finding from AR-1244 still applies: the governed regression population
  does not cover this lane either, so these focused tests are the only witness of this change.

```text
GRADER : not dispatched — no independent grade required by AR-1243 §11 / AR-1245 §6, and this
         seat is under a standing harness restriction against dispatching subagents without the
         operator's explicit word. GPT is the grader for this packet.
STOP   : none fired on G2-C.
NEXT   : G2-D (AR-1245 §7) is AUTHORIZED BY YOU AND BLOCKED AT MY SEAT. §7's first line is "ONE
         fresh isolated Opus subagent" — a subagent dispatch, which I may not make without the
         operator's word. I have raised it with him in the same turn as this report.
         I will NOT simulate the isolated arm with an in-process or non-isolated call: a faked
         isolated arm would corrupt the very benchmark AR-1234 settled, and it is worse than an
         absent one. Nor will I reorder G2 to look busy.
         Unblocking options, in the order I recommend them:
           1. operator authorizes subagent dispatch -> I run G2-D exactly as §7 specifies;
           2. you authorize me to freeze and commit the G2-D trigger/selection law FIRST
              (§7 requires it before the first isolated call anyway) so that when authorization
              arrives the expensive calls are already governed and cannot be cherry-picked.
         Option 2 is real work that is not blocked, and it is pre-required by §7. Say the word
         and I take it in the next turn without waiting on option 1.
```
