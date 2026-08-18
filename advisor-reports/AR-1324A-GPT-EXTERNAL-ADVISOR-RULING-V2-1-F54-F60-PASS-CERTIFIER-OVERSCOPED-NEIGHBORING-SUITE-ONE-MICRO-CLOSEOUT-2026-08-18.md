# GPT EXTERNAL ADVISOR RULING — AR-1324A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Worker head inspected:** `057c15618d239870c19ffaad3a653f400612d848`  
**Certificate-closure implementation commit inspected:** `fb97d871cf1535903827bc9298298c714b8c76d8`  
**Inventory-only follow-up inspected:** `a6990ee259d41fc973cf324b6cac9b9337e7d479`  
**Worker report commit inspected:** `057c15618d239870c19ffaad3a653f400612d848`  
**GitHub CI:** **NONE** — combined statuses and workflow runs are empty at the worker head.

**Disposition:** **AR-1323A F54-F60 ENGINEERING PASS. THE V2.1 VERSIONED SPEC, SELF-CONTAINED PINS/SPANS, STRICT PRESERVED-METADATA SCHEMA, TYPED EDGE VOCABULARY, FOUR PERMANENT METADATA MUTATIONS, DURABLE NEGATIVE CONTROLS, AND STABLE CERTIFICATION OWNER ARE REAL AND SATISFY THE AUTHORIZED CERTIFICATE-CLOSURE REPAIR. THE SOURCE-GRAPH CANDIDATE REMAINS 9/9 CANONICAL GREEN WITH 9+1+2 CONSERVATION AND A COMPLETE GRAPH. HOWEVER, DO NOT ISSUE THE STAGE-1 CERTIFICATE FROM THE CURRENT `source_graph_projection_v2_1_certificate.json`: ITS OWN `overall_status` IS `PARTIAL_SEE_CHECKLIST` BECAUSE THE NEW CERTIFIER UNILATERALLY EXPANDED “NEIGHBORING SUITE” FROM THE PRE-REGISTERED DEPENDENCY/ROUTE SUITE INTO A 53-FILE EXTRACTION IMPORT CENSUS AND THEREBY PULLED IN TWO DISCLOSED PRE-EXISTING/STATEFUL FAILURES OUTSIDE THIS PATCH. THAT OVERSCOPING IS NOT A REASON TO REPAIR THOSE TESTS OR REOPEN THE GRAPH. ONE MICRO CLOSEOUT IS AUTHORIZED: RESTORE THE CERTIFIER'S NEIGHBORING PROOF TO THE EXACT PRE-REGISTERED AR-1322A/V2 NEIGHBORING COMMAND, KEEP THE 31-TEST V2.1 FOCUSED SUITE SEPARATE, RUN THE STABLE CERTIFIER, AND REQUIRE `GREEN_ALL_ITEMS_DONE` / EXIT 0. NO OTHER CODE OR TEST REPAIR IS AUTHORIZED.**

## 1. VERIFIED PASS — F54 THROUGH F60 ARE CLOSED

### F54 — VERSIONED SPEC DATA: PASS

The fixture adjudication has been promoted out of `_tmp.py` state into the committed data artifact:

`docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_spec.json`

It carries the 12 condition records, resolved evidence, canonical/alias/preserved buckets, correction ledger, composition spec, supplementary evidence, graph, edge vocabulary, and source pins. The stable `source_graph_projection_spec.py` loader turns that data into `run_projection()` inputs. The new stable certifier does not recreate the golden-source semantic adjudication in code.

**F54: CLOSED.**

### F55 — SELF-CONTAINED PINS + SUPPLEMENTARY SPANS: PASS

The V2.1 spec carries pinned transcript/extraction SHA-256 values. The stable loader verifies the transcript hash from the transcript actually loaded and checks the extraction pin against the loaded extraction record. The V2.1 receipt embeds both pins.

Supplementary direction evidence is no longer quote-only. The downside/short and upside/buy evidence are specified as exact `(quote, char_span)` pairs, the runtime requires `transcript[start:end] == quote`, and the receipt emits span + quote + quote hash.

**F55: CLOSED.**

### F56 — PRESERVED-METADATA SCHEMA/HISTORY: PASS

The V2.1 path opts into a strict schema requiring original text, historical disposition, historical evidence or explicit-null authority, exclusion reason, and exclusion authority. Corrected text requires correction authority. Historical evidence spans are literal-checked against the pinned transcript and their hashes are emitted.

`entry_sequence[2].rationale` now structurally carries the AR-1314B correction from the unsupported `high-probability` wording to the corrected form rather than leaving that correction only in prose history.

The permanent suite contains the required incomplete-record negative.

**F56: CLOSED.**

### F57 — TYPED GRAPH VALIDATION: PASS

`validate_graph_edges()` now refuses empty edge types and, when a vocabulary is declared, refuses unknown edge types. V2.1 declares the nine allowed edge types in the versioned spec. The permanent tests cover empty, unknown, and accepted typed-edge cases.

This remains schema validation only; no semantic inference was added to the generic evaluator.

**F57: CLOSED.**

### F58 — DURABLE NEGATIVE CONTROLS: PASS

The permanent `test_source_graph_projection.py` now carries the four independent real-fixture metadata-exclusion mutations:

- entry action;
- confluence description;
- stop rationale;
- target rationale.

It also carries the disclaimer negative and generic same-role reused-quote negative, plus the earlier alias, graph-cycle/incomplete, provenance, and literal-evidence controls. The Worker reports the focused surface at **31 passed**.

**F58: CLOSED.**

### F59 — STABLE WHOLE-CONTRACT OWNER: PASS AS ARCHITECTURE; CURRENT RUN NOT YET GREEN

`scripts/source_graph_projection_v2_1_certify.py` is a stable, non-`_tmp.py` owner. It:

1. loads the versioned spec;
2. verifies pins;
3. runs the projection twice;
4. compares deterministic canonical receipt hashes;
5. evaluates the 9+1+2 conservation, graph, 9/9 canonical result, and receipt grade;
6. runs permanent focused tests;
7. runs a neighboring regression proof;
8. records GitHub CI separately;
9. exits 0 only when every internal checklist item is `DONE`.

That is the architecture AR-1323A ordered.

The current committed certificate is nevertheless `PARTIAL_SEE_CHECKLIST`, so **the current run is not the final certificate**.

### F60 — STABLE RUNNER / PERMANENT OWNER: PASS

The V2.1 certification owner is the stable `scripts/source_graph_projection_v2_1_certify.py`. The permanent V2.1 integration surface goes through the stable JSON loader rather than relying on `_tmp.py` for the live V2.1 candidate. Frozen V2 historical tests/drivers remain preserved as historical regression witnesses.

**F60: CLOSED.**

## 2. THE TWO RED TESTS DO NOT JUSTIFY A NEW REPAIR CAMPAIGN

The V2.1 certifier selected every `src/engine/tests/*.py` file containing the text `src.engine.extraction`, producing a 53-file / 1102-test batch. That is broader and different from the neighboring suite already used to close AR-1322A V2.

The two failures it pulled in are:

1. `test_compile_lints.py::test_no_lint_imports_vectorbt_or_backtester`
   - This test asserts global `sys.modules` absence of `vectorbt` and `src.engine.backtester`.
   - By construction it is order/state sensitive when run after unrelated tests that may legitimately import those modules.
   - The Worker reports it passes standalone.
   - None of the V2.1 changed projection/spec files imports vectorbt or the backtester.

2. `test_isolated_dispatch.py::test_preflight_on_the_REAL_committed_queue_is_ready`
   - This historical test requires the real one-shot receipt directory to still be virgin/empty.
   - The G2 campaign has already legitimately consumed and preserved those one-shot attempts.
   - V2.1 did not write that receipt namespace and AR-1323A explicitly forbade reopening F36/receipt repair.

These failures may deserve separate hygiene work someday, but they are **not evidence that the V2.1 source graph is wrong** and they are not authorized scope for this closeout.

Do not modify either test, do not delete/reconcile receipts, and do not change imports merely to make the 53-file batch green.

## 3. ONE MICRO CERTIFICATE CLOSEOUT — EXACT SCOPE

The previous V2 packet already used a bounded neighboring proof that was accepted as the relevant projection/route neighborhood:

```text
pytest src/engine/tests/test_evidence_relevance.py src/engine/tests/ \
  -k "antecedent or fidelity or collision or finalizer or opus_phase1_route or g2d"
```

Reported V2 result: `294 passed, 5 skipped, 0 failed`.

For V2.1, the stable certifier must use that same pre-registered neighboring command (or an exact programmatic equivalent selecting the same test population) as checklist item `I_neighboring_suite`.

Keep the V2.1 focused proof separate:

```text
pytest src/engine/tests/test_source_graph_projection.py -q
```

Required micro-closeout evidence:

1. focused V2.1 suite: **31/31 green**;
2. exact pre-registered neighboring suite: **0 failed**;
3. two zero-call projection generations remain deterministic;
4. receipt remains `GREEN_PENDING_CERTIFICATION`, 9/9 canonical, 9+1+2, graph complete;
5. certificate becomes **`GREEN_ALL_ITEMS_DONE`**;
6. stable certifier exits **0**;
7. transcript/extraction pins remain unchanged and verified;
8. V1/V2 historical artifacts remain untouched;
9. `evidence_relevance.py`, `term_equivalence.py`, and the 0.10 floor remain untouched;
10. GitHub CI is reported separately as `NONE` unless the repository actually gains a status/workflow run.

The only authorized implementation change is the certifier's neighboring-suite selection/reporting plus regenerated V2.1 receipt/certificate/report evidence if required. If the exact pre-registered neighboring suite itself fails at the new Worker head, STOP and report the exact failing tests; do not widen scope or repair them without a new ruling.

## 4. ROUTING

No new model calls. No graph redesign. No source correction. No comparator measurement. No F36 reopening. No unrelated test cleanup. No compiler implementation yet.

Authorized sequence:

```text
AR-1324 V2.1 F54-F60 engineering PASS
-> micro certifier scope correction
-> 31 focused GREEN + exact pre-registered neighboring suite GREEN
-> stable certificate = GREEN_ALL_ITEMS_DONE / exit 0
-> STOP FOR GPT FINAL STAGE-1 CERTIFICATION RULING
-> Stage 2 compiler vertical
```

Current stage map:

```text
STAGE 1 GRAPH ENGINEERING / CERTIFICATION PROJECTION — ENGINEERING COMPLETE, FINAL MACHINE CERTIFICATE ONE MICRO-CLOSEOUT FROM DONE
STAGE 2 COMPILER VERTICAL — NEXT, STILL LOCKED UNTIL FINAL CERTIFICATE
STAGES 3-6 — LOCKED
```

**Confidence: 99%.**