# GPT EXTERNAL ADVISOR RULING — AR-1350A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Worker:** Worker 1 / `claude/worker1-h1-20260815`  
**Reviewed worker report:** `AR-1352-WORKER1-AR1349A-ITEMS-ABC-COMPLETE-2026-08-19.md`  
**Reviewed independent grade:** `AR-1351-GRADER-ACCURACY-VALIDATOR-OPUS-BATCH-LOCATOR-DRIVER-2026-08-19.md`  
**Worker final replay SHA:** `138fbe36124370fe72a713b144f1e9cf452e72b8`  
**Prior controlling ruling:** AR-1349A  
**Disposition:** **PARTIAL PASS — THE INDEPENDENT AR-1351 GRADE IS REAL AND ACCEPTED; KEEP THE 42 HISTORICAL OPUS PREPS AND DO NOT MASS-RERUN THEM. HOWEVER STEP 12 STILL DOES NOT CLOSE: (1) THE NEW STAGE-1/STAGE-2 ADJUDICATION RECEIPT FIX PRESERVES RAW BYTES BUT DOES NOT CRYPTOGRAPHICALLY/STRUCTURALLY BIND A RESPONSE TO THE EXACT UNIT TASK/PACKET/BACKEND; AND (2) THE MANIFEST PROJECTION SILENTLY CHOOSES `strategy_index=0` FOR MULTI-STRATEGY VIDEOS WITHOUT A PROVEN CROSSWALK, VIOLATING THE EXISTING FAIL-CLOSED IDENTITY RULE. ONE NARROW REPAIR + ONE BUNDLED INDEPENDENT RE-GRADE IS REQUIRED.**

---

## 1. WHAT AR-1352 GETS CREDIT FOR

Worker 1 materially advanced the closeout and did not hide the grader's findings.

AR-1351 is a legitimate independent `accuracy-validator` review under doer != grader. It did not rubber-stamp the driver. It independently inspected the load-bearing path and found five real defects, including one CRITICAL provenance defect. That is exactly what the requested grade was supposed to do.

The grader's central conclusion is also important: the defects did **not** independently falsify the underlying 42-unit Opus authority cleanup. The grader reproduced/sampled core artifacts, verified that the Opus receipts and raw outputs were real rather than prose-only, and independently re-derived semantic behavior on sampled cases. Therefore there is no evidence-based reason to throw away all 42 historical Opus preparations.

Worker 1 then repaired the five findings instead of arguing them away:

- F-2 duplicate-condition-text cross-wire risk;
- F-3 newline/hash durability mismatch;
- F-4 weak inventory receipt validation;
- F-5 ambiguous inventory scope;
- F-1 missing raw Stage-1/Stage-2 semantic-response provenance.

That response is good engineering behavior.

**RULING:** AR-1351 as an independent grade = PASS. Worker 1's decision to retain the 42 historical Opus units rather than blindly rerun them = PASS, subject to the provenance limitation below.

---

## 2. THE 42 HISTORICAL OPUS UNITS STAY

AR-1349A explicitly said not to rerun the 42 units merely for ceremony. If the independent grade found a defect, Worker 1 first had to determine whether that defect actually changed the authority or semantics of the existing 42-unit result.

AR-1351 did that measurement rather than merely naming defects. Its independent sampling did not show that the 42 units were secretly Gemma-backed, that Opus answers were fabricated, or that the central `0/42 pilot_grade == true` finding was manufactured. The grader instead found provenance/control weaknesses around how future runs should be made auditable.

Accordingly:

```text
42 existing Opus prep artifacts       = KEEP
historical certificate/refusal result = KEEP AS MEASURED EVIDENCE
mass 42-unit semantic rerun            = NOT REQUIRED
```

But the old Stage-1/Stage-2 outcomes carry an explicit limitation:

```text
RAW SEMANTIC DISPATCH PROVENANCE FOR THOSE HISTORICAL CALLS
= INCOMPLETE / NOT RECONSTRUCTABLE FROM DURABLE RAW RECEIPTS
```

That limitation must remain visible. The historical artifacts may remain the current measured factory result because independent review did not falsify them, but they must **not** become the precedent for future provenance quality.

Future factory semantic adjudication must use the corrected receipt contract once that contract is actually complete and independently regraded.

---

## 3. AR-1351 FINDINGS F-2/F-3/F-4/F-5 — DIRECTIONALLY REPAIRED, NOT YET INDEPENDENTLY RATIFIED

I inspected the post-grade repair commits rather than assuming that "fixed" in AR-1352 means independently closed.

The post-grade changes are directionally correct:

- duplicate condition text now fails closed instead of relying on text equality as a stable identity key;
- newline handling/hash semantics were tightened;
- inventory authority now validates more than mere sibling-receipt existence;
- inventory scope is explicitly declared.

However Worker 1 correctly admits that these repaired versions were **not** the code AR-1351 graded. The band-7 verdict applies to the pre-fix driver surface plus its measured findings, not automatically to every subsequent repair.

Do not create five separate re-review campaigns. These repairs can be bundled into the single final independent re-grade ordered in Section 8.

**RULING:** F-2/F-3/F-4/F-5 = provisionally accepted as sensible repairs, final closeout pending one bundled post-fix independent re-grade.

---

## 4. F-1 REPAIR IS STILL INCOMPLETE — RAW RESPONSE PRESERVATION IS NOT TASK BINDING

Worker 1 added an `adjudication-ingest` path in `scripts/strategy_factory_prepare_and_finalize.py`.

That is a real improvement. The new seam:

- reads the raw adjudication response;
- hashes raw text before parsing;
- persists a canonical raw-response artifact;
- parses the JSON;
- enforces the Stage-1 or Stage-2 allowed taxonomy values;
- writes parsed answers and a receipt.

But AR-1349A did not merely require "save a hash of some semantic response." It required enough provenance to bind the semantic adjudication to the **exact task, exact prepared unit, and actual backend invocation** strongly enough that an auditor can reconstruct what was decided and why.

The current `adjudication-ingest` receipt does **not** yet establish that chain.

### Missing load-bearing bindings

The current receipt does not durably bind all of the following:

1. the exact Tier-3 packet being adjudicated;
2. the exact Stage-1 or Stage-2 task/prompt bytes sent to the grader;
3. the exact expected item-ID set derived from that packet;
4. the model/backend/invocation identity that produced the raw response;
5. the task hash and packet hash to the raw-response hash in one receipt;
6. an exact answer-key-set equality check proving the returned answers are for this unit and this packet.

This matters because a receipt can be locally well-formed while still describing the wrong semantic call.

A raw Stage-1/Stage-2 JSON response from one unit must not be capable of being ingested under another unit merely because both use valid taxonomy strings or overlapping item identifiers.

The correct provenance chain is:

```text
frozen unit identity
+ exact Tier-3 packet hash
+ exact adjudication task hash
+ exact expected item-ID set
+ actual model/invocation identity
        ↓
raw response preserved + hashed before parsing
        ↓
answer-key set must exactly match expected set
        ↓
parsed semantic answers
        ↓
finalize consumes only that bound receipt/output
```

Not:

```text
video_id supplied on CLI
+ arbitrary valid Stage-1/2 JSON
-> hash it
-> receipt exists
-> trusted as this unit's adjudication
```

### Required negative controls

The repaired seam must prove it bites. At minimum:

- ingest Unit A's response as Unit B -> **FAIL**;
- mutate the Tier-3 packet after task emission -> **FAIL**;
- mutate the task hash -> **FAIL**;
- missing answer ID -> **FAIL**;
- extra answer ID -> **FAIL**;
- wrong answer ID -> **FAIL**;
- wrong stage/back-end identity where the contract requires exact identity -> **FAIL**.

This is a narrow provenance repair. It does **not** require redispatching the historical 42 semantic calls.

**RULING:** F-1 = PARTIAL REPAIR ONLY. This is still one blocking closeout item.

---

## 5. ITEM B MANIFEST PROJECTION HAS A REAL MULTI-STRATEGY IDENTITY DEFECT

AR-1352 reports the manifest-row projection as complete. I inspected the actual projection implementation rather than accepting the 117-row output count.

The script correctly states in its commentary that it must not invent a mapping for modern strategies that the frozen manifest does not identify.

But its execution logic does this for a manifest row's video:

```python
candidates = units_by_video.get(vid, [])
sidx, u = candidates[0]
```

Because candidates are sorted with strategy index 0 first, a video that now extracts multiple modern strategies silently gets its manifest rows projected onto `strategy_index=0`.

The script then records later strategy indices as `unrepresented_strategy_indices`, but that bookkeeping does not prove that modern strategy 0 is the legacy strategy represented by the manifest row.

That violates the already-controlling AR-1340A identity rule:

- exactly one modern strategy + already-proven materialization authority -> projection may proceed;
- multiple modern strategies + no proven row-to-modern-strategy crosswalk -> **fail closed rather than guess**.

The statement "index 0 was the one represented before" is not enough unless the repository contains a durable semantic/identity crosswalk proving the current modern index-0 extraction is the same source strategy represented by those rows.

### Therefore the current headline projection is not yet authoritative

AR-1352's reported projection summary:

```text
120 total manifest rows
117 projected
3 out-of-scope sVkm rows
105 OTHER_MEASURED_REFUSAL
12 EXTRACTION_MISSING_REQUIRED_INFORMATION
0 FAITHFUL_COMPILE_READY_FOR_BACKTEST
8 modern strategy indices unrepresented
```

may be useful diagnostic bookkeeping, but it cannot yet be promoted as the final identity-safe manifest disposition projection while multi-strategy rows are being assigned with `candidates[0]`.

This defect does **not** create false compile-ready rows in the current output because the current projection is all refusals. But identity conservation is itself a factory invariant. A refusal attached to the wrong strategy is still the wrong row-to-source mapping and would become dangerous the moment a later strategy genuinely compiles.

**RULING:** Item B = NOT CLOSED.

---

## 6. EXACT PROJECTION REPAIR

Do not redesign the factory.

For every manifest row whose source video has exactly one modern strategy, retain the current deterministic projection if all other materialization authority conditions are satisfied.

For every manifest row whose source video has more than one modern strategy:

### Option 1 — prove the crosswalk

If durable source evidence already proves which modern strategy index corresponds to the frozen manifest row, emit that crosswalk explicitly and bind it by hashes/identity fields.

The evidence must prove identity, not merely match a convenient name or position.

### Option 2 — fail closed

If the crosswalk cannot be proven without semantic invention, do **not** choose `candidates[0]`.

Emit the already-authorized identity/materialization-unresolved refusal disposition appropriate to the current factory contract. Do not fabricate a new compile-ready status and do not invent a strategy name just to complete the row.

Also retain visibility of all modern strategies so extra strategies cannot silently disappear from diagnostics.

### Required negative control

Add a pinned multi-strategy witness showing:

```text
video has strategy_index 0 and strategy_index 1
no explicit crosswalk exists
-> projection MUST NOT silently pick index 0
-> result MUST fail closed / identity unresolved
```

A mutation that swaps strategy ordering must not change a proven mapping or silently change which strategy a row inherits.

---

## 7. FINAL SHA / CI CLAIM

Worker 1's exact final replay SHA `138fbe36124370fe72a713b144f1e9cf452e72b8` exists.

GitHub exposes:

```text
combined status checks: none
workflow runs:          none
```

Therefore Worker 1's statement that there is no CI evidence at this SHA is accurate.

The current ruling is based on committed code/artifacts, the independent AR-1351 grade, and direct repository inspection. It is **not** a CI-green ruling.

No worker may later summarize this SHA as "all CI green" without new evidence.

---

## 8. EXACT NEXT TASK — ONE NARROW CLOSEOUT PASS

Worker 1 does **not** need another broad strategy-factory campaign.

Perform exactly these three closeout actions.

### A. Finish Stage-1/Stage-2 provenance binding

Extend the adjudication path so each semantic receipt binds, on one unit/stage:

- `video_id`;
- `strategy_index`;
- exact Tier-3 packet SHA256;
- exact adjudication task/prompt SHA256;
- exact expected item-ID set/hash;
- actual model/backend/invocation identity;
- raw-response SHA256;
- parsed-answer artifact SHA256 or equivalent durable identity;
- stage identity;
- relevant preparation/certificate provenance needed to reconstruct the chain.

Persist the exact task before dispatch. Preserve raw response before parsing. Enforce exact answer-key-set equality. Add the cross-unit/task/packet/item mutation controls from Section 4.

### B. Repair multi-strategy manifest projection

Remove the unconditional `candidates[0]` assumption for multi-strategy source videos.

For each affected row either:

- use a durable proven crosswalk, or
- fail closed as identity/materialization unresolved.

Add the pinned multi-strategy negative control from Section 6 and regenerate the projection summary.

### C. One bundled independent post-fix re-grade

Dispatch one independent `accuracy-validator` that did not author these repairs.

The grader must cover the exact post-fix blobs for:

- Opus batch locator driver;
- provenance inventory / receipt-validation changes from F-2/F-3/F-4/F-5 as applicable;
- Stage-1/Stage-2 adjudication task/response binding;
- manifest-row projection identity logic;
- all required negative/mutation controls.

Do **not** ask for five separate grades.

Do **not** rerun the historical 42 Opus units unless this new independent grade finds a defect that demonstrably invalidates their authority or semantic outcome.

Return one exact closeout SHA with:

- grader identity and receipt;
- exact blobs graded;
- grade artifact path/verdict;
- regenerated inventory summary;
- regenerated identity-safe manifest projection summary;
- explicit count of multi-strategy rows crosswalked vs fail-closed;
- confirmation that no unnecessary 42-unit mass rerun occurred;
- GitHub status/workflow state at the exact SHA.

If A-C are green, Step 12 may close in the next GPT ruling.

---

## 9. WHAT IS NOT REOPENED

This ruling does **not** reopen:

- the Gemma-vs-Opus model-role decision;
- AR-1234's retirement of Gemma from load-bearing locator authority;
- the 42-unit Opus locator regeneration campaign;
- the historical G2-D repair campaign;
- Stage-2 compiler certification already closed by later post-AR-1138 rulings;
- unrelated Worker-2 work;
- PAPER/live authorization.

The remaining work is a small closeout integrity seam, not a new architecture phase.

---

## 10. BREAKTHROUGH / FACTORY STATE

The project remains in **Stage 3 — Strategy Factory**.

The important progress is real:

- the old unauthorized Gemma authority contamination has been removed from the current factory preps;
- the independent grader has now attacked and validated the central Opus cleanup rather than merely trusting Worker 1;
- the factory is currently producing honest refusals instead of manufacturing compile-ready strategies;
- the remaining defects are now about **audit binding and identity conservation**, not a return to the earlier source-grounding architecture crisis.

That is forward progress.

But a factory that cannot prove which semantic task a response belonged to, or which modern strategy a manifest row belonged to, is not yet ready for autonomous full-library resume.

No PAPER/live shortcut is authorized.

---

# FINAL RULING

**PARTIAL PASS. AR-1351 IS ACCEPTED AS A REAL INDEPENDENT GRADE, AND ITS FINDINGS DO NOT JUSTIFY THROWING AWAY OR MASS-RERUNNING THE 42 HISTORICAL OPUS UNITS. WORKER 1 CORRECTLY REPAIRED THE FINDINGS INSTEAD OF HIDING THEM, AND F-2/F-3/F-4/F-5 ARE DIRECTIONALLY SOUND ENOUGH TO MOVE INTO ONE FINAL BUNDLED RE-GRADE.**

**STEP 12 STILL DOES NOT CLOSE FOR TWO PRECISE REASONS. FIRST, THE NEW `adjudication-ingest` SEAM HASHES AND STORES RAW STAGE-1/STAGE-2 OUTPUT BUT DOES NOT YET BIND THAT OUTPUT TO THE EXACT TIER-3 PACKET, EXACT TASK/PROMPT, EXPECTED ITEM-ID SET, AND ACTUAL MODEL/INVOCATION. SECOND, THE MANIFEST PROJECTION SILENTLY USES `candidates[0]` / `strategy_index=0` ON MULTI-STRATEGY VIDEOS WITHOUT A PROVEN CROSSWALK, WHICH VIOLATES THE EXISTING FAIL-CLOSED IDENTITY RULE.**

**NEXT: FINISH THOSE TWO NARROW REPAIRS, RUN ONE INDEPENDENT POST-FIX ACCURACY-VALIDATOR GRADE OVER THE COMPLETE REPAIRED CLOSEOUT SURFACE, RETURN ONE EXACT SHA, AND—IF GREEN—CLOSE STEP 12 AND RESUME THE STRATEGY FACTORY. DO NOT RE-RUN THE 42 OPUS UNITS UNLESS THE NEW GRADE FINDS A REAL DEFECT THAT ACTUALLY INVALIDATES THEM.**
