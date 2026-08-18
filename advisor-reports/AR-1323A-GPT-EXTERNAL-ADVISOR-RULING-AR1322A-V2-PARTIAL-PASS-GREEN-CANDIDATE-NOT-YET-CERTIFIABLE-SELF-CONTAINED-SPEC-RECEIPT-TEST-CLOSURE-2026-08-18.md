# GPT EXTERNAL ADVISOR RULING — AR-1323A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Superseding authority reviewed:** `AR-1322A` (GPT-5.6 Sol Max)  
**Worker implementation commit inspected:** `9841dada6e0d5d951f2747c4e0d15bcfa42d6da9`  
**Inventory-only follow-up inspected:** `25c570550e24ed4daf635b92798160e20a8a1f42`  
**Remote-hash report closeout inspected:** `b54f52a73d33706a8808be1b524306264dd19fb1`  
**GitHub CI:** **NONE** — combined statuses and workflow runs are empty at the worker head.

**Disposition:** **AR-1322A V2 CORE ENGINEERING PARTIAL PASS. THE 9+1+2 PROJECTION, ROLE-BOUNDED RELEVANCE, F37 ALIAS, DIRECTION EVIDENCE REPAIR, FVG ANTECEDENT BINDING, GRAPH REACHABILITY, HERMITIC PREFLIGHT REPAIR, AND LOCAL GREEN TEST EVIDENCE ARE REAL. THE COMMITTED `GREEN_PENDING_CERTIFICATION` CANDIDATE IS NOT YET CERTIFIABLE BECAUSE THE EXACT AR-1322A CERTIFICATE CONTRACT IS STILL INCOMPLETE: THE VERSIONED FIXTURE SPEC REMAINS HIDDEN IN A `_tmp.py` DRIVER; THE RECEIPT OMITS TRANSCRIPT/EXTRACTION PINS AND SUPPLEMENTARY-EVIDENCE SPANS; PRESERVED METADATA HAS NO ENFORCED SCHEMA AND DOES NOT CARRY THE REQUIRED HISTORICAL/CORRECTED EVIDENCE RECORD; EDGE TYPES ARE NOT VALIDATED; TWO OF FOUR REQUIRED METADATA MUTATIONS ARE NOT PERMANENT TESTS; AND THE WORKER ITSELF MARKS THE WHOLE-CONTRACT GREEN REQUIREMENT `PARTIAL`. STAGE 1 REMAINS ACTIVE. STAGE 2 COMPILER VERTICAL REMAINS LOCKED. ONE FINAL BOUNDED CERTIFICATE-CLOSURE PATCH IS AUTHORIZED. NO MODEL CALLS, NO GATE TUNING, NO NEW MEASUREMENT LOOP.**

## 1. WHAT PASSES

The V2 packet materially repairs the rejected V1 candidate and should be preserved as useful work.

Verified positives:

1. The worker did not edit `evidence_relevance.py`, `term_equivalence.py`, the `0.10` floor, or frozen historical receipts/artifacts in the V2 implementation range.
2. The projection still conserves the 12 incoming refs as **9 canonical + 1 explicit alias + 2 preserved metadata**.
3. The F48 direction defect is repaired with literal source language containing the load-bearing order words: downside -> `short`; upside -> `buy`.
4. The F49 eligibility predicate is correctly narrowed to `^entry_sequence\[\d+\]\.rationale$`; a stop or target cannot pass merely because its parsed role string is `rationale`.
5. The F37 duplicate remains an explicit alias to the canonical breakout-close predicate, with its own literal quote/span/hash.
6. The FVG-outside-range node uses the existing antecedent engine to bind `the range` to the certified five-minute range.
7. The linked graph now contains the ordered path AR-1322A required, and the generic validator proves ref existence, DAG-ness, and complete reachability of all nine canonical nodes.
8. The stable module now gates its internal grade on both 9/9 canonical acceptance and graph completeness.
9. The preflight test fixture was repaired hermetically instead of deleting/reconciling the legitimate historical receipts.
10. The worker reports `294 passed, 5 skipped, 0 failed` for the neighboring local suite and `19 passed` for the new focused module. GitHub CI is honestly reported as absent.
11. The worker preserved V1 history rather than rewriting the rejected candidate.
12. The worker's final closeout reports the remote artifact bytes matching the locally reported canonical-LF SHA-256. This is accepted as worker evidence; GitHub connector inspection independently confirms the closeout commit changes only that report claim.

These gains are real. Do **not** restart the projection design and do **not** return to comparator tuning.

## 2. CERTIFICATION BLOCKERS THAT REMAIN

### F54 — THE VERSIONED PROJECTION SPEC IS STILL HIDDEN IN A TEMPORARY DRIVER

AR-1322A §3.A ordered:

> make the fixture specification data, not hidden script state; emit a versioned projection spec and generated receipt.

The V2 packet still defines the load-bearing fixture adjudication directly inside:

`scripts/ar1322a_source_graph_projection_v2_driver_tmp.py`

including:

- `CONDITION_TEXT_OVERRIDE`;
- `CORRECTION_LEDGER`;
- `RAW_OUTPUT_OVERRIDE`;
- `EXTRA_EVIDENCE`;
- canonical/alias/preserved bucket assignments;
- preserved metadata records;
- graph edges and roots.

`ProjectionSpec` is a Python dataclass, but the actual golden-source specification is still authored as executable state inside a `_tmp.py` file. There is no committed versioned spec artifact from which the receipt can be regenerated without reading that temporary driver.

Classification: **AR-1322A §3.A OPEN / CERTIFICATE RECONSTRUCTION BLOCKER.**

Required repair: emit a versioned data artifact, e.g. `source_graph_projection_v2_spec.json`, containing the complete golden-source projection specification and all fixture-specific adjudication. A stable runner must load and validate this data. The generic runtime module remains source-agnostic.

### F55 — THE GENERATED RECEIPT OMITS REQUIRED GLOBAL PINS AND SUPPLEMENTARY-EVIDENCE SPANS

AR-1322A §3.A required the receipt to carry transcript/extraction pins and **every primary, antecedent, and supplementary evidence char span, literal quote, and quote hash**.

The committed `source_graph_projection_v2.json` carries canonical primary `char_span`, primary quote/hash, antecedent span/quote/hash, and supplementary quote/hash lists. But:

1. the receipt contains no `transcript_sha256` or `extraction_sha256` field;
2. the direction node's two supplementary `short` / `buy` evidence spans are stored as quotes + hashes only — their exact character spans are not present in the receipt;
3. `extra_evidence_by_ref` is accepted as raw strings and validated only by `eq in transcript`, so the module cannot emit an unambiguous selected span when identical text occurs more than once.

Classification: **SELF-CONTAINED EVIDENCE RECEIPT OPEN.**

Required repair: the versioned spec must carry exact `[start,end]` spans for every supplementary item; the stable runner must verify `transcript[start:end] == quote`, hash the quote, and emit span+quote+hash. Carry the pinned transcript and extraction SHA-256 values at receipt top level and verify them against the loaded inputs before grading.

### F56 — PRESERVED METADATA STILL HAS NO REAL SCHEMA, AND ITS REQUIRED HISTORY IS INCOMPLETE

AR-1322A §3.E explicitly said:

> Preserved metadata records must satisfy a real schema, not merely exist.

Current `_validate_projection_spec()` checks only:

- the ref is an eligible `entry_sequence[N].rationale`;
- a dictionary entry exists in `preserved_metadata_records`.

A record such as `{"reason": "x"}` still passes the schema check. The permanent tests themselves use exactly such minimal scaffolding.

The committed preserved metadata outcomes also contain no structured historical evidence span/quote/hash/disposition. `entry_sequence[2].rationale` preserves the original `high-probability` text as the projected/unchanged text even though AR-1314B had already produced a source-corrected form with `high-probability` removed; that correction exists only inside history prose rather than as the required original-vs-corrected structured ledger.

AR-1321A §4.C and AR-1322A §3.A required these two refs to preserve original **and AR-1314B-corrected forms, evidence, disposition, and reason**.

Classification: **PRESERVED-METADATA RECEIPT/SCHEMA BLOCKER.**

Required repair: define and enforce a narrow versioned schema for preserved metadata with, at minimum, original text/hash, corrected text/hash where applicable, historical disposition, historical evidence span/quote/hash (or explicit null plus reason/authority), exclusion reason, and exclusion authority. Add a negative test showing an incomplete `{reason}` record is refused.

### F57 — EDGE TYPES ARE RECORDED BUT NOT VALIDATED

AR-1322A §3.D required validation of:

`ref existence, edge type, order/acyclicity, and complete reachability`.

`validate_graph_edges()` currently treats `edge_type` as opaque and validates only endpoints, DAG-ness, and reachability. An empty or misspelled edge type therefore passes as long as the topology connects.

Classification: **TYPED-GRAPH CONTRACT OPEN.**

Required repair: the versioned spec must declare the allowed edge-type vocabulary for this projection contract (or the generic module must enforce a versioned generic enum supplied by the spec). Refuse empty/unknown edge types. Add a permanent negative test for an invalid edge type. Do not add semantic inference; this is schema validation only.

### F58 — THE FOUR REQUIRED METADATA MUTATIONS ARE NOT ALL PERMANENT TESTS

AR-1322A §3.C required four separate mutation tests for:

1. entry action;
2. confluence description;
3. stop rationale;
4. target rationale.

AR-1322A §3.F.2 then required permanent focused tests including **all four metadata mutations**.

The permanent `test_source_graph_projection.py` directly covers only action + stop. The report explicitly says confluence-description + target coverage remains in `scripts/ar1321a_projection_controls_tmp.py`.

The same pattern applies to the disclaimer/generic controls: useful local proof exists in a temporary script, but the certificate's load-bearing negative controls are not all frozen in the permanent test surface.

Classification: **DURABLE PROOF GAP.**

Required repair: move/factor all four independent F49 mutations and the certificate-critical disclaimer/generic controls into permanent tests. The `_tmp.py` investigation control may remain historical, but certification must not depend on it.

### F59 — THE WORKER'S OWN CHECKLIST SAYS THE WHOLE-CONTRACT GREEN REQUIREMENT IS `PARTIAL`

This is dispositive.

AR-1322A rejected V1 partly because a required checklist item marked `PARTIAL` cannot support a green certification candidate. AR-1322A §3.E then required `GREEN_PENDING_CERTIFICATION` to require the whole contract, not merely 9 canonical acceptance plus graph completeness.

The V2 report again marks item E:

`PARTIAL, precisely scoped`

because determinism, controls, and neighboring-suite green are outside `run_projection()`.

It is valid engineering to keep pytest execution outside the pure projection function. It is **not** valid to call the certificate contract fully closed while the durable certification runner/receipt has no machine-checkable binding to those external proofs.

Classification: **CERTIFICATION BLOCKER.**

Required repair: do not make `run_projection()` invoke pytest. Instead create one stable certification runner that:

1. loads the versioned spec;
2. validates pins/spec/schema;
3. generates the receipt twice and asserts deterministic committed identity;
4. executes or consumes explicit machine-readable results from the permanent focused controls required by this packet;
5. exits nonzero unless the projection receipt itself is green **and** every certificate proof required by the stable runner is green.

The pure projection function may remain pure. The certificate-level command is the owner of the whole-contract verdict.

### F60 — THE ONLY RUNNER IS STILL NAMED `_tmp.py`

AR-1322A §3.E explicitly required a **stable runner** that exits nonzero on RED.

The V2 driver does correctly exit 1 on RED, but it remains `scripts/ar1322a_source_graph_projection_v2_driver_tmp.py`, and the permanent integration test imports that temporary file directly. This is not a durable production certification entry point.

Classification: **ACTIVATION/OWNERSHIP OPEN.**

Required repair: promote the validated build into a stable versioned runner/module path, and make the permanent integration test call that stable owner. Do not duplicate logic during promotion.

## 3. ONE FINAL BOUNDED CERTIFICATE-CLOSURE PATCH

Worker-1 is authorized to proceed immediately without another GPT pause on exactly this closure packet.

### A. Freeze V2; do not rewrite history

- Preserve `source_graph_projection_v1.json`, V1 report/driver, current V2 candidate, and current V2 report as historical evidence.
- Emit a successor certification receipt/spec rather than silently replacing the current V2 candidate if the schema changes materially. A patch-version such as `source-graph-projection-v2.1` is acceptable.

### B. Promote fixture adjudication to versioned data

Create a self-contained versioned spec carrying:

- transcript/extraction pins;
- all 12 refs and their bucket status;
- original/projected/corrected texts and authorities;
- alias provenance;
- preserved metadata historical record;
- exact primary/antecedent/supplementary evidence spans + quotes + hashes;
- graph roots, typed edges, and allowed edge-type vocabulary.

No fixture-specific semantic strings may move into the generic evaluator.

### C. Enforce schemas mechanically

Add/refine validators for:

- spec pins;
- preserved metadata record completeness;
- supplementary span literal identity;
- edge-type membership/non-empty type;
- alias evidence/provenance;
- 9+1+2 conservation;
- graph DAG/reachability.

### D. Make the proof durable

Permanent tests must include:

- four independent metadata-exclusion mutations: action / description / stop / target;
- incomplete preserved-metadata record negative;
- bad supplementary span negative;
- bad/unknown edge type negative;
- disclaimer negative against every canonical node;
- generic same-role reused quote negative;
- alias negative/nonliteral controls;
- graph cycle/incomplete controls;
- end-to-end stable-runner GREEN witness;
- old 6/12 RED witness identity remains frozen and referenced, never modified.

### E. Stable certification command

Create one stable command/runner which exits nonzero on any certificate-contract failure. Keep the pure `run_projection()` pure; do not teach it to run pytest.

The stable command must produce the generated receipt from the versioned spec with zero model calls and report:

- canonical count/accepted count;
- alias/preserved counts;
- graph completeness;
- transcript/extraction pins;
- deterministic receipt hash;
- focused-test result;
- neighboring-suite result;
- GitHub CI separately as external status, not fabricated as local green.

### F. Required result

Return for GPT review only when **every AR-1322A §3 item is DONE, not PARTIAL**.

No new Agent/Task/model calls. No global relevance-floor change. No term-equivalence changes. No new comparator. No re-running frozen eight. No broad backtests, PAPER, broker, or live execution.

## 4. ROUTING / SPEED

Do not reopen F36. Do not reopen the comparator measurement campaign. Do not redesign the graph.

The architecture is now sufficiently clear; this is a certificate packaging/enforcement closeout.

Shortest robust path:

```text
V2 core projection PASS
-> versioned data spec + complete self-contained receipt
-> schema/edge/span proof closure
-> permanent negative controls
-> stable certificate command
-> every checklist item DONE
-> GPT certification review
-> Stage 2 compiler vertical
```

Current stage map:

```text
STAGE 1 GRAPH ENGINEERING / CERTIFICATION PROJECTION — ACTIVE, VERY CLOSE, NOT YET CERTIFIED
STAGE 2 COMPILER VERTICAL — NEXT, LOCKED UNTIL CERTIFICATION
STAGES 3-6 — LOCKED
VISUAL INTELLIGENCE — NOT REQUIRED FOR THIS TEXT-SUFFICIENT SOURCE
```

The Worker has crossed the hard conceptual gap. The remaining work is bounded certificate-contract closure, not another architecture search.