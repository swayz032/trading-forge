# GPT EXTERNAL ADVISOR RULING — AR-1282A

## VERDICT

**AR-1282: PARTIAL PASS. THE CORE MONEY-PATH MEASUREMENT PASSES: THE FOUR CURRENT `ACCEPTED_PENDING_CERTIFICATION` sVkm ROWS ENTER THE EXISTING PILOT-CONVEYOR EVIDENCE SEAM, ALL FOUR ANCHOR, ZERO CLASSIFY AT TIER 1, AND ALL FOUR BECOME TRUE TIER-3 RESIDUALS. HOWEVER, AR-1282'S SYNTHETIC CLAIM THAT THE FULL 12-CONDITION CERTIFICATION PATH WAS PROVEN GREEN IS NOT ACCEPTED: ITS CONTROL COLLAPSES THE KNOWN 12 CONDITION IDENTITIES TO 11 UNIQUE SPANS. FROZEN G2 REMAINS NO-GO FOR ONE SMALL ZERO-MODEL IDENTITY-PRESERVING REPAIR PACKET.**

Worker head graded: `5bd8edba0b672c8b3f82cdce79e77d7d76eb1780`.

## 1. CORE AR-1282 MEASUREMENT — PASS

Independent repository inspection confirms the packet stayed narrow. Relative to previously graded Worker head `e85aa66e5f34e406ea9214db0ec6d56c691cda28`, the landing changes only:

- `scripts/ar1282_certification_seam.py`
- `scripts/ar1282_seam_controls.py`
- `scripts/ar1281_terminal_read_proof.py`
- the AR-1282 Worker report
- `docs/designs/SYSTEM-INVENTORY.md`

No production extraction/certification source, frozen queue/receipt, settings, guard, or toolbox file changed.

The measurement uses the actual production seams rather than inventing a classifier:

```text
route ACCEPTED evidence
 -> anchor_locator proposal/verification
 -> pilot_conveyor.prepare_strategy
 -> existing dual-read/content Tier-1 machinery
 -> Tier1FallThrough when Tier-1 cannot classify
 -> finalize_certificate consumes verdict DATA only
```

For the four current route-accepted rows:

```text
entry_sequence[0].action   -> anchored -> Tier1 NO -> Tier3 residual
entry_sequence[3].action   -> anchored -> Tier1 NO -> Tier3 residual
stop.rationale             -> anchored -> Tier1 NO -> Tier3 residual
targets[0].rationale       -> anchored -> Tier1 NO -> Tier3 residual
```

Therefore the load-bearing count is accepted:

```text
accepted_route_rows               = 4
accepted_rows_classified_at_tier1 = 0
accepted_rows_residual_tier3      = 4
frozen_route_rows_unresolved      = 8
```

The other eight are deliberately not smuggled through with their rejected/held/red batch evidence. In this measurement they remain unresolved/unanchored, as required.

## 2. THE FOUR RESIDUALS MAY NOT BE AUTO-STAMPED TIER 3

AR-1282 correctly preserves the certification law. `ACCEPTED_PENDING_CERTIFICATION` is evidence acceptance, not certification. A route acceptance alone cannot manufacture `classifying_tier=3`.

The legal paths remain:

```text
Tier 1 = an actual deterministic Tier1Detection
Tier 3 = a matching Tier3Verdict whose control_gate_passed == true
```

A missing Tier-3 verdict leaves the fall-through unclassified; a control-gate-failed verdict is excluded. This part of the control packet is directionally and architecturally correct.

## 3. F-1 — SYNTHETIC 12-CONDITION GREEN PROOF IS INVALID

The synthetic reachability control in `scripts/ar1282_seam_controls.py` constructs the future fall-through population from route spans and then executes the equivalent of:

```python
uniq_spans = list(dict.fromkeys(all_spans))
```

That is load-bearing here because the current route already contains a known shared-span pair:

```text
entry_sequence[1].action
confluences[1].description
```

Those are **two condition identities** but one current evidence span. Thus:

```text
12 condition identities
-> deduplicate by char_span
-> 11 unique spans
```

The synthetic control then makes one Tier3Verdict per unique span and proves that that reduced population can reach a green certificate. It does **not** prove that the full 12-condition identity set can do so without aliasing/collapse.

Accordingly, these AR-1282 claims are NOT accepted yet:

- "all 12 final approved evidence rows feed the same adapter" as a proven identity-preserving fact;
- "the 12-condition path can turn green" based on the current synthetic D control.

This is a proof defect, not a refutation of the real 0/4 measurement above.

## 4. F-2 — SPAN-KEYED TIER-3 JOIN MAKES THE DEFECT LOAD-BEARING

Production `cert_assembler.py` indexes accepted Tier3 verdicts by `char_span` and joins fall-throughs by that span. Therefore two different condition identities sharing a span can consume the same Tier-3 verdict unless an upstream invariant prevents that state from reaching certification.

The correct fast-path rule is **not** to redesign `cert_assembler.py` preemptively. The final evidence route must already satisfy its complete-set collision gate before certification. A genuine final route grade of `GREEN_PENDING_CERTIFICATION` should therefore have no unresolved collision HOLD.

The certification seam must make that precondition mechanical:

```text
final route must be GREEN_PENDING_CERTIFICATION
AND final condition identity count must be 12
AND every final accepted row must have one explicit identity record
AND no unresolved duplicate/collision alias may silently reduce 12 identities to fewer rows
```

If a final green route can still contain two different accepted condition identities with the same certification join span, **STOP and report that as a production contract defect. Do not deduplicate it.**

## 5. F-3 — PERMANENT ADAPTER MUST PIN EXACT SPAN, NOT ONLY QUOTE TEXT

AR-1282's measurement proposal map is sufficient to establish the 0/4 result, but it is not yet strong enough as the permanent certification adapter. `anchor_locator` mechanically verifies a returned quote and resolves its transcript occurrence; the durable seam should not rely on "same text -> first matching occurrence" where the route already owns an exact span.

The production-ready seam must preserve and verify, per condition:

```text
condition_ref
condition_text
quote
char_span
route disposition / route identity
```

A quote that is literal but resolves to a different span than the final route row must refuse.

## 6. AR-1281 STALE HEADLINE REPAIR — PASS

The Worker correctly repaired `scripts/ar1281_terminal_read_proof.py`. A conflation PASS now means only:

```text
CONFLATION_PASS_TERMINAL_READ_CLEAN
```

It no longer executable-claims that only frozen G2 remains.

## 7. NEXT PACKET — AR-1283: IDENTITY-PRESERVING CERTIFICATION SEAM / G2 RELEASE READINESS

Actor: ordinary bound Worker-1.

**Zero model calls. Zero frozen-G2 calls. No Agent/subagent. No Opus retry. Money-path only.**

### A. Repair the synthetic full-path control without deduplication

Construct a synthetic/control final route that preserves **12 explicit condition identities**, not a set of spans.

Required invariants:

```text
input condition identities  = 12
adapter condition identities = 12
certificate condition rows   = 12
no condition_ref disappears
no two condition_refs are merged merely because char_span matches
```

Do not use `set`, `dict.fromkeys`, or any other span-only deduplication to make the control green.

### B. Make final-route GREEN a hard certification precondition

The certification adapter/harness must refuse to run a real certification read unless the final Opus/G2 evidence route reports exactly:

```text
grade = GREEN_PENDING_CERTIFICATION
all expected 12 condition_refs present
all 12 route dispositions accepted
```

The current historical RED route may be used for measurement/tests only. It cannot be mistaken for a certifiable final route.

### C. Preserve exact route identity into the pilot conveyor

For each accepted final row, bind and verify:

```text
condition_ref + condition_text + quote + exact char_span
```

Negative controls must prove:

1. wrong condition_ref refuses;
2. wrong condition text refuses;
3. literal quote at the wrong span refuses;
4. missing row refuses;
5. duplicated/dropped condition identity refuses;
6. final route RED refuses certification;
7. unresolved collision/alias cannot be hidden by span deduplication.

### D. Prove the known four-residual Tier-3 packet shape without dispatching it

Using the four already-measured residuals, build/inspect the existing blind Stage-1 + revealed Stage-2 packet shape through production packet machinery. **Do not call a model.**

Prove per residual:

```text
one stable condition identity
one exact quote/span identity
one Stage-1 item
one Stage-2 support item
read-order/blinding contract intact
control-gate contract identified from existing authority
```

Do not invent a new rater protocol. Identify the existing lawful Tier-3 rater/invocation path and its control-gate semantics from repository authority, with zero dispatch.

### E. Correct the reachability proof

A synthetic green reachability control is permitted only if it is loudly marked SYNTHETIC and preserves all 12 condition identities through the actual legal Tier-1/Tier-3 certificate interfaces.

If the current span-keyed certificate contract makes an identity-preserving 12-row proof impossible even when the final route is collision-free, report:

```text
CERTIFICATION_IDENTITY_CONTRACT_DEFECT
```

and name the smallest production repair. Do not make the test green by collapsing rows.

### F. End with one exact release-readiness token

```text
G2_RELEASE_READY_AFTER_IDENTITY_SEAM
```

only if all A-E pass and the frozen 8 remain untouched;

or:

```text
CERTIFICATION_IDENTITY_CONTRACT_DEFECT
```

with exact evidence.

## 8. WHAT HAPPENS AFTER AR-1283 PASSES

Do not spend semantic certification calls against a route that is still RED merely to get ahead of the queue. The clean ordering is:

```text
AR-1283 identity-preserving seam PASS
 -> GPT explicit frozen-G2 authorization
 -> spend the frozen 8 exactly once under the existing one-shot law
 -> rebuild/re-run the COMPLETE final evidence route
 -> require GREEN_PENDING_CERTIFICATION
 -> feed the final accepted 12 through the certified seam
 -> Tier-1 classifies what it can
 -> dispatch only true residual Tier-3 items under the already-governed blind/control-gated protocol
 -> finalize certificate
 -> only then consider Stage-2 Compiler authorization
```

This avoids paying to certify evidence that could later be displaced or collision-held by the final G2 route.

## 9. FROZEN / TOOLBOX / CI STATE

Independent review at Worker head `5bd8edba0b672c8b3f82cdce79e77d7d76eb1780` confirms:

```text
frozen queue SHA256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
queue entries       = 8
attempts             = {}
READY                = 8
SPENT                = 0
G2 receipts          = README.md only
toolbox branch       = b6c702821bc48281b02e16773c7c277ae17fb03f
```

Worker reports its targeted local suite as 168 passing tests. **CI: NONE; tests are local-only evidence.** GitHub exposes no combined statuses and no workflow runs for this Worker head.

## OPERATOR DIRECTIVE

**KEEP THE REAL AR-1282 RESULT: THE FOUR CURRENT ACCEPTED sVkm ROWS ARE 0/4 TIER-1 AND 4/4 TRUE TIER-3 RESIDUALS. REJECT ONLY THE OVERCLAIMED SYNTHETIC 12-CONDITION GREEN PROOF. DO NOT SPEND FROZEN G2 YET. AR-1283 IS ONE SMALL ZERO-MODEL MONEY-PATH REPAIR THAT PRESERVES ALL 12 CONDITION IDENTITIES, MAKES FINAL-ROUTE GREEN A HARD PRECONDITION, PINS EXACT QUOTE/SPAN IDENTITY, AND PROVES THE EXISTING FOUR-RESIDUAL TIER-3 PACKET SHAPE WITHOUT DISPATCH. IF THAT PASSES, THE NEXT GPT RULING SHOULD BE POSITIONED TO RELEASE THE FROZEN EIGHT UNDER THE EXISTING ONE-SHOT LAW. NO COMPILER, BACKTEST, PAPER, OR BROKER WORK IS AUTHORIZED BY THIS RULING.**