# GPT EXTERNAL ADVISOR RULING — AR-1322A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Worker head verified:** `79b51eec4c353bd82c1271b720971658d3617026`  
**Implementation commit inspected:** `8cae5bc751e1a972d7a09c74f86858662709363d`  
**Inventory-only follow-up inspected:** `79b51eec4c353bd82c1271b720971658d3617026`  
**CI:** **NONE.** GitHub reports no combined-status checks and no workflow runs at the worker head. Test evidence in the packet is local-only.

**Disposition:** **AR-1321A IMPLEMENTATION PARTIAL PASS. THE ROLE-BOUNDED PROJECTION, 9+1+2 CONSERVATION, EXPLICIT F37 ALIAS, AND FVG-RANGE ANTECEDENT SEAM ARE REAL. THE COMMITTED `GREEN_PENDING_CERTIFICATION` CANDIDATE IS REJECTED: ITS DIRECTION NODE IS NOT SUPPORTED BY THE EVIDENCE PACKAGE IT ACTUALLY RECORDS; ITS METADATA GUARD CAN EXCLUDE STOP/TARGET REFS; ITS RECEIPT OMITS THE CERTIFIED CONDITION TEXTS, CORRECTION LEDGER, SPAN/HASH PROVENANCE, AND MOST GRAPH LINKS; TWO REQUIRED GREEN CHECKS ARE OPEN; AND THE REPORTED TEST COMMAND IS NOT GREEN. STAGE 1 REMAINS ACTIVE. STAGE 2 REMAINS LOCKED. ONE BOUNDED V2 REPAIR IS AUTHORIZED; NO NEW MODEL CALLS AND NO NEW MEASUREMENT LOOP.**

## 1. WHAT PASSES

The worker correctly moved beyond the AR-1320B comparator-only detour and implemented the architectural direction ordered by AR-1321A.

Verified positives:

1. The worker branch is exactly two commits ahead of the prior inspected head. The implementation commit adds the generic projection module, fixture driver, controls, report, and derived artifacts; the follow-up only regenerates `SYSTEM-INVENTORY.md`.
2. `evidence_relevance.py`, `term_equivalence.py`, the `0.10` floor, the pinned extraction, transcript, frozen queue, and historical receipts are not edited by these commits.
3. The committed projection conserves the 12 refs as `9 canonical + 1 alias + 2 preserved metadata`.
4. Same-role relevance is applied at the caller while the global relevance gate remains unchanged.
5. The committed artifact records `entry_sequence[2].action` at `0.509345794...` versus the action rival at `0.296856210...`, and binds `the range` to `entry_sequence[0].action` through the existing antecedent engine.
6. `entry_sequence[3].rationale` is source-corrected to the literal third-candle validity prerequisite and clears the mechanical gates.
7. The exact F37 duplicate is represented as `confluences[1].description -> entry_sequence[1].action`, rather than silently rescued by relevance.
8. The disclaimer and generic-quote controls report rejection under role-bounded comparison.
9. The packet correctly says `CI: NONE` and does not claim a certificate, compiler completion, backtest permission, PAPER permission, or live permission.

These are meaningful gains. The remaining defects are receipt, guard, and graph-completeness defects—not a reason to return to rival-set measurement.

## 2. FINDINGS AGAINST THE GREEN CANDIDATE

### F47 — GREEN IS SELF-CONTRADICTED BY THE REQUIRED CHECKLIST

AR-1321A §7 says the new route **must prove all 14 requirements** before its target output is accepted.

The worker's own report records:

- item 10, linked graph facts: **PARTIAL** at `G2D-AR1321A-SOURCE-GRAPH-PROJECTION.md:121`;
- item 13, neighboring suites green: `291 passed, 5 skipped, 3 failed` at line 124.

`PARTIAL` is not DONE, and a test command with three failures is not green. Calling item 13 `DONE, with ... exception` does not change its result. The failures may be pre-existing and unrelated to the new module, but AR-1321A granted no exception to the proof requirement.

Classification: **CERTIFICATION BLOCKER.** The internal 9/9 denominator may say green; the external certification candidate does not.

### F48 — THE DIRECTION SELECTOR'S RECORDED EVIDENCE DOES NOT CONTAIN THE CLAIMED SIDE-TO-ORDER MAPPING

The projected condition says:

```text
a downside break is taken short, an upside break is taken long
```

at `scripts/ar1321a_source_graph_projection_driver_tmp.py:75-78`.

But its governed evidence package contains only:

1. `That gives us an idea of the direction in which the market wants to go for the day.`
2. `...we have our break to the upside.`

See driver lines 98-104 and committed artifact lines 101-131. Neither span contains `short`, `long`, or `buy`. The source transcript does contain the needed mappings later—downside break through `we want to be taking a short`, and upside break through `get this one ready for a buy`—but those words are outside the spans the candidate certifies.

The source-fidelity guard returning no finding is not proof that an omitted semantic relation is present. This is exactly the onboarding law `literal quote != semantic truth`.

Classification: **MISSING LOAD-BEARING SOURCE EVIDENCE.** Use the existing transcript; no new model call is needed.

### F49 — THE PRESERVED-METADATA GUARD CAN SILENTLY EXCLUDE STOP OR TARGET REFS

`_claim_role()` deliberately maps both `stop.rationale` and `targets[N].rationale` to the string `rationale` at `source_graph_projection.py:106-115`. The exclusion guard then allows every ref whose returned role equals `rationale` at lines 183-200.

Therefore the implementation contradicts its own comment and AR-1321A §7.6: a caller can classify `stop.rationale` or `targets[0].rationale` as preserved non-executable metadata and pass this check.

The control at `scripts/ar1321a_projection_controls_tmp.py:72-94` does not catch this. It places an action first, so the function raises on that action and exits the loop; it never tests stop or target, and stop/target are not present in that mutation at all.

Classification: **FAIL-OPEN MUTATION GUARD.** Eligibility must be structural and narrow: only `entry_sequence[N].rationale` may enter this bucket for this contract. Action, confluence description, stop rationale, and target rationale need four independent refusal controls.

### F50 — THE COMMITTED PROJECTION ARTIFACT DOES NOT IDENTIFY WHAT WAS CERTIFIED

An exhaustive key inspection of `source_graph_projection_v1.json` finds:

- no `condition_text` on any canonical node;
- no original/new value ledger for corrected or retyped nodes;
- no SHA/hash key anywhere in the artifact;
- no structured per-ref correction authority;
- no exact spans or hashes for supplementary evidence;
- no evidence/span/hash receipt for either preserved metadata row;
- no hashes on the alias provenance.

The projected condition texts and most fixture adjudications live only in the temporary Python driver. `run_projection()` emits alias text/quote/span at lines 372-387, copies arbitrary metadata records at lines 389-394, and grades only the accepted canonical count at lines 396-423. A preserved record with only `{"reason": "x"}` satisfies its schema. An alias answer may be absent and still produce an alias outcome with null provenance.

This violates AR-1321A §§4.B, 4.C, 6.2, and 6.3. A downstream compiler cannot reconstruct the exact certified graph from this JSON, and an auditor cannot verify which corrected text each score belongs to.

Classification: **RECEIPT/SCHEMA BLOCKER.** Fixture adjudication must be a versioned data spec and its generated receipt must be self-contained; a temporary script is not the certificate record.

### F51 — THIS IS NOT YET THE REQUIRED LINKED SOURCE GRAPH

The artifact has one operational dependency record: `entry_sequence[2].action` binds `range` to `entry_sequence[0].action`. It also has the F37 `alias_of` relation. It does not emit a typed node/edge set expressing the remaining ordered dependencies among timing, range, breakout close, side selection, FVG outside range, third-candle validity, entry close, stop, and target.

The report accurately admits this at line 121. The one-minute qualifier and close-outside fact may remain supported by one co-located literal quote—no redundant antecedent composition is required—but the breakout predicate still needs a machine-readable dependency on the canonical five-minute range node. The full ordered trade path must be represented as graph facts, not inferred from array order or report prose.

Classification: **AR-1321A §7.10 OPEN.**

### F52 — THE REPORT AND COMMITTED RECEIPT DISAGREE

Two exact mismatches were independently checked:

1. The report says `entry_sequence[1].rationale` has own score `0.417` at line 74. The committed artifact records `0.2768166089965398` at `source_graph_projection_v1.json:113`.
2. The report cites artifact SHA-256 `0d2a41fd585e10bc0f07dcbe2fa35dca8a63974400b54ef39baa523dd6a0cfb9`. That is the CRLF worktree serialization. The LF bytes committed to GitHub hash to `ab85d642505c3932edfe405d1971225d6542fe100c01dfd760148cdc74d4ee9a`. The reported hash therefore does not identify the committed artifact.

The second mismatch is consistent with line-ending normalization, not proof that the two local runs differed. It is nevertheless an unusable repository receipt. Item 11 also has no executable assertion in the controls file; the controls JSON contains only items 5-8.

Classification: **REPORT/RECEIPT CORRECTION REQUIRED.** Use canonical LF JSON or a canonical serialization and record the hash of the exact committed bytes.

### F53 — THE REQUIRED RED WITNESS AND DURABLE REGRESSION ARE NOT FROZEN IN THIS PACKET

The changed-file set contains no focused RED-before witness asserting the exact four old relevance refusals and two old duplicate holds. It also adds no permanent test module under the repository test tree for the new 424-line production module; all new proof logic lives in `scripts/*_tmp.py`.

The generic module is currently called only by the temporary fixture driver and temporary controls. That is enough to generate a diagnostic artifact, but not enough to call the new route a durable production certification seam.

Classification: **PROOF/ACTIVATION OPEN.** Preserve the historical AR-1314B artifact, reference it by exact committed hash and outcome identities, and add a stable versioned runner plus focused permanent tests.

## 3. REQUIRED BOUNDED V2 REPAIR

Worker-1 is authorized to produce one `source-graph-projection-v2` correction packet. Do not rewrite the rejected v1 artifact as if it never existed.

### A. Make the fixture specification data, not hidden script state

Emit a versioned projection spec and generated receipt. For every one of the 12 refs, carry as applicable:

- original condition text and SHA-256;
- projected condition text/status and SHA-256;
- exact authority for correction, retyping, aliasing, or metadata preservation;
- transcript/extraction pins;
- every primary, antecedent, and supplementary evidence char span, literal quote, and quote hash;
- claim/node type;
- disposition and gate result;
- `alias_of` / `depends_on` / ordering edges;
- original historical disposition/evidence for preserved metadata.

The receipt must be sufficient to reconstruct and audit the certified node text without reading a temporary Python driver.

### B. Repair the direction evidence exactly

Use literal spans that actually cover:

- lower-side break -> `we want to be taking a short`;
- upside break -> `get this one ready for a buy`.

Preserve the source words (`short`, `buy`) and record any typed normalization from `buy` to `long`. Both sides must enter the governed evidence package with exact spans/hashes.

### C. Make metadata exclusion fail closed

Only `entry_sequence[N].rationale` is eligible for preserved non-executable metadata under this versioned contract. Add separate mutation tests proving refusal for:

1. an entry action;
2. a confluence description;
3. `stop.rationale`;
4. `targets[N].rationale`.

Do not use one mutation that stops at the first exception to claim all four.

### D. Emit and validate the graph

At minimum, the machine artifact must make explicit:

- timing -> range-definition applicability;
- range definition -> breakout-close predicate;
- breakout side -> short/long direction selector;
- certified range -> FVG-outside-range predicate;
- FVG-outside -> third-candle-validity -> entry-on-close order;
- entry/trade node -> source stop and fixed-2R target attachments;
- F37 alias -> canonical breakout predicate.

Validate ref existence, edge type, order/acyclicity, and complete reachability of all nine canonical nodes. Co-located literal evidence is acceptable for the one-minute qualifier; it does not remove the graph dependency on the range node.

### E. Make green mean the whole contract passed

`GREEN_PENDING_CERTIFICATION` must require more than `9 canonical accepted`:

- 9+1+2 conservation;
- valid self-contained ledger;
- complete alias provenance;
- complete evidence spans/hashes;
- required graph edges/invariants;
- all negative/mutation controls;
- deterministic committed artifact identity;
- required focused and neighboring tests green.

The stable runner must exit nonzero on RED. Alias evidence must be mechanically literal and non-null before the alias can inherit. Preserved metadata records must satisfy a real schema, not merely exist.

### F. Close the proof gaps without touching frozen history

1. Freeze/reference the old 6/12 RED witness by exact committed artifact hash and exact refused/held ref identities.
2. Add permanent focused tests for projection validation, evidence packaging, graph edges, alias provenance, and all four metadata mutations.
3. Make `test_g2d_real_queue_preflight.py` hermetic against a fixture/temp receipt directory, or otherwise produce the required neighboring green suite without deleting, rewriting, or reconciling the legitimate historical receipts.
4. Run two zero-call V2 generations; hash canonical LF bytes; verify the reported hash equals the file fetched from the worker branch.
5. Correct the direction score table to the value in the generated receipt.
6. Report GitHub CI separately. `CI: NONE` remains acceptable as an honest status, but it is not CI green.

No new Agent/Task/model calls are authorized. No global floor change, term-equivalence addition, neighbor deletion, new semantic grader, or second compiler is authorized.

## 4. ROUTING / LOCKS

Authorized sequence:

```text
AR-1321A partial implementation
-> bounded source-graph-projection-v2 receipt/guard/evidence repair
-> deterministic GREEN_PENDING_CERTIFICATION candidate with every §7 proof closed
-> STOP FOR GPT CERTIFICATION REVIEW
-> only after GPT certification: production compiler vertical
```

Current stage map:

```text
STAGE 1 GRAPH ENGINEERING / CERTIFICATION PROJECTION — ACTIVE, NOT CERTIFIED
STAGE 2 COMPILER VERTICAL — NEXT, LOCKED
STAGES 3-6 — LOCKED
VISUAL INTELLIGENCE — NOT REQUIRED FOR THIS TEXT-SUFFICIENT SOURCE
```

Forbidden until a later GPT ruling:

- compiler implementation against this uncertified v1 receipt;
- broad/library backtests;
- PAPER activation;
- broker, Topstep, or live execution;
- another stand-alone comparator or evidence-search loop;
- deleting/reconciling historical receipts to make a mutable-state test green;
- calling v1 certified or calling the compiler breakthrough complete.

## 5. OPERATOR SUMMARY

The core idea is now right: stop making unlike rules fight, keep nine real rules, preserve one duplicate as an alias, and retain two non-executable notes. But the green paper cannot yet prove exactly what rule text was certified, the long/short rule's quoted evidence stops before the words that establish long/short, the guard can hide a stop or target, and the machine output is still mostly a list rather than the required linked graph.

This is a bounded repair, not a restart. Fix the receipt, use the already-pinned transcript spans, close the guard and graph tests, get the required suite genuinely green, then return for certification. Confidence: **99%**.
