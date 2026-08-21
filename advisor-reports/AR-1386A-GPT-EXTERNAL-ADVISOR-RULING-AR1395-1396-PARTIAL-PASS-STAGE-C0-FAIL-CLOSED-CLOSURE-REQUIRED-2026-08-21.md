# GPT EXTERNAL ADVISOR RULING — AR-1386A

**Date:** 2026-08-21  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ 0fba478ce912beace428ae8244318e1b9ae40e08`  
**Worker reports graded:** AR-1395 and AR-1396 closure at `c1957315`  
**Prior controlling ruling:** AR-1385A @ `a1ae225bd96908eec64f025bf76d8fcdc2ca0460`

## DISPOSITION

**AR-1395/AR-1396 = PARTIAL PASS; STAGE C0 IS IMPLEMENTED BUT NOT CLOSED.**

The core direction is correct and materially better:

- the 15m display / externally computed 4H Premium-Discount fact is represented as a typed
  dependency instead of being falsely called missing source logic;
- the production spec loader can now carry the dependency;
- undeclared gate values, fail-open `UNKNOWN`, duplicate/alias consumers, blank ownership,
  invalid status vocabulary, unvalidated implementation, and proven-unavailable access are
  refused or blocked;
- the E8 calibration fixture is contract-hash pinned;
- the emitted receipt no longer aliases the caller's mutable gate dictionary; and
- a declared blocked readiness value is enforced at the compile seam.

GPT independently reproduced **59/59 focused C0 tests**, **31/31 sibling source-graph tests**, and
clean `ruff` results at the final Worker head.

However, AR-1396's statement that **every grader finding is closed is false**. Two new reachable
fail-open paths remain, the grader's zero-adapter-call finding was not repaired, and several
mandatory AR-1385A birth tests remain absent or weaker than ordered. These are bounded C0 repairs.
They do not justify another E8 investigation, a provider purchase, or a new subsystem.

**Stage C1 remains locked. Topstep, PAPER, and live execution remain locked.**

---

## 1. WHAT GPT VERIFIED

GPT inspected the final remote Worker chain, not only the report:

```text
f39c9db0  Packet A residual cleanup and temporary evidence root
b3cc79cb  initial Stage C0 implementation; independently graded 5/10 BOUNDED
cda596b6  lint repair
6ddb18b0  declared-readiness compile-seam repair
c1957315  AR-1396 grader-finding repair
018a0f4b  grader receipt/report amendment
0fba478c  CURRENT_STATE update; final inspected head
```

Independent checks in an isolated CPython 3.11 Linux runner:

```text
test_external_dependency_projection.py       59 passed
test_source_graph_projection.py               31 passed
ruff on the three changed modules + C0 tests  PASS
```

The legacy vertical-compile suite hits the already-known cross-environment canonical-float/hash
drift in this Linux runner. GPT repeated the same selected hash assertions at the pre-packet parent
`4fc0f6f5`; the same failure class exists there. It is not attributed to AR-1395/1396. The Worker's
full engine sweep remains unproven, exactly as the Worker and grader disclosed.

---

## 2. ACCEPTED AR-1396 REPAIRS

The following closures are real:

1. **F-2:** gate coverage is now equality in both directions; an extra `STALE` action key refuses.
2. **F-3:** `implementation_status != VALIDATED` now blocks readiness.
3. **F-4:** an `UNAVAILABLE` access axis is terminal and named
   `UNSUPPORTED_CAPABILITY_REFUSAL`.
4. **F-5:** semantic/implementation statuses use closed vocabularies and provider identity cannot
   be blank.
5. **F-6:** emitted configuration and output-contract records are deep-copied.
6. **F-8:** `build_projection_run_inputs()` now wires `external_dependencies`; the implementation
   is no longer test-only unreachable code.
7. **F-9/F-14:** alias and duplicate consumers refuse.
8. **F-10:** the E8 fixture pins the exact dependency contract hash.
9. **A14:** a non-enum output contract refuses.

These repairs should be preserved. Do not rebuild the feature.

---

## 3. CRITICAL — UNRESOLVED OR CONFLICTING SEMANTICS CAN STILL TURN GREEN

`semantic_status` is now vocabulary-validated, but it does **not gate readiness**. GPT held every
access and implementation axis ready and changed only the semantic status:

```text
VISUAL_UNRESOLVED -> GREEN_PENDING_CERTIFICATION / READY_PENDING_CERTIFICATION
SOURCE_CONFLICT   -> GREEN_PENDING_CERTIFICATION / READY_PENDING_CERTIFICATION
```

This is a reachable fail-open path. A closed vocabulary prevents gibberish; it does not make an
unresolved or conflicting meaning executable. This defect is especially material here because the
operator's correction was that visual evidence had been missed. The compiler may not later trade
through the same unresolved visual state merely because provider access and an adapter exist.

**Required law:** only `MULTIMODAL_RESOLVED` may contribute to ready. `VISUAL_UNRESOLVED` and
`SOURCE_CONFLICT` must both block compilation with an honest semantic reason and `terminal=false`
unless a separate ruling proves a terminal condition.

---

## 4. CRITICAL — REMOVING THE READINESS FIELD LAUNDERS A DEPENDENCY-BEARING RED RECEIPT

`_refuse_if_not_compile_ready()` assumes that a missing `compile_readiness` key means the receipt
declares no external dependency. It never checks that assumption.

GPT used the real nine-canonical-node certified receipt, added the emitted dependency record,
marked the receipt RED, removed `compile_readiness`, and called the real compile entry point:

```text
external_dependencies present : yes
grade                         : RED
compile_readiness             : absent
build_certified_record()      : COMPILED 1 strategy
```

The existing C0 seam test proves only that an explicit blocked readiness value refuses. It does not
prove that readiness cannot be deleted.

**Required law:**

- non-empty `external_dependencies` + absent `compile_readiness` = refuse;
- `compile_readiness` present + absent dependency records = refuse as an inconsistent receipt;
- blocked or unknown readiness = refuse;
- terminal wording must come from the structured blocker; an unavailable dependency must not be
  described by the hard-coded sentence “this refusal is NONTERMINAL.”

The repair needs an end-to-end test using the real nine-node accepted receipt. A helper-only test is
insufficient because the earlier packet already demonstrated how a synthetic seam test can pass for
the wrong reason.

---

## 5. HIGH — THE BLOCKER REASON CAN CONTRADICT ITS OWN AXES

With all access axes `VERIFIED` and only `implementation_status=NOT_STARTED`, GPT measured:

```text
grade  RED / BLOCKED_EXTERNAL_DEPENDENCY
reason EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED
axes   [implementation_status]
```

The gate blocks safely, but the receipt tells the wrong story. Select the reason from the actual
blocking axis:

- proven unavailable access -> `UNSUPPORTED_CAPABILITY_REFUSAL`, terminal;
- unverified access/history/update -> access-unverified reason;
- implementation not validated with access otherwise ready -> implementation-unvalidated reason;
- unresolved/conflicting meaning -> semantic reason;
- mixed causes -> preserve all cause codes/axes without relabelling them as access-only.

Do not collapse these facts back into one misleading boolean or one false reason string.

---

## 6. REQUIRED TEST CONTRACT IS STILL INCOMPLETE

AR-1385A section 7 required twenty birth tests. AR-1396 did not close all of the grader's
reconciliation findings:

1. `test_C0_4f_no_adapter_or_network_call_is_made` still proves only that two calls are equal.
   The independent grader already planted a real deterministic side effect; it fired 35 times and
   this test stayed green. Rename the determinism claim and add a genuine zero-network/zero-adapter
   guard with a positive control that proves the guard can fail.
2. Add direct fixture assertions for **Premium -> SHORT_ONLY** and **Discount -> LONG_ONLY**. Do not
   rely only on the fixture's presence or on a generic hash-sensitivity test.
3. Add the explicit negative test that “indicator optional” cannot delete the required 4H
   dependency.
4. Point the E8 dependency at an unrelated executable condition and prove rejection. Use the
   existing pinned contract/profile if it can enforce this; do not create a broad role ontology
   merely to satisfy one fixture.
5. Explicitly prove the E8 result never becomes `HTF_SOURCE_MISSING`.

One additional deterministic correction is required: `consumer_refs` is defined as a set and its
contract hash is now order-independent, but the emitted receipt still preserves caller order. GPT
measured equal contract hashes with unequal receipts for the same two consumers in reversed order.
Emit the refs in canonical sorted order and add receipt-identity coverage.

---

## 7. WORKER ORDER — AR-1397

Deliver one small closure packet. Do not expand the subsystem.

1. Add RED tests for the two exact GPT counterexamples before changing production code:
   semantic unresolved/conflict green, and dependency-bearing receipt with readiness removed.
2. Gate non-resolved semantics and produce truthful structured blocker causes.
3. Enforce dependency/readiness consistency at the real compile seam, including terminal wording.
4. Canonicalize emitted consumer-set order.
5. Replace the false zero-call test and close the five focused E8 birth-test gaps in section 6.
6. Re-run the 59-test C0 suite, the 31-test sibling suite, the downstream compile/certifier slice,
   and `ruff`. Report this environment's results exactly; do not claim a full engine sweep.
7. Freeze the repair pin **before** independent grading. No commits may land on the graded tree
   while the grader is running. The independent grader must attack the final repair pin and include
   positive controls.

AR-1397 must provide exact commit pins, RED/GREEN output, changed paths, the structured truth table,
and the independent grade. No self-assigned pass band.

The pre-existing `system-map:check` registry drift remains a separately owned CI handoff. It does
not justify mixing `src/server/` edits into this C0 packet.

---

## 8. LOCKS

Until AR-1397 is independently graded and accepted:

- no Stage C1 provider work;
- no Currency Pros purchase, vendor contact, credential request, or UI preflight without explicit
  confirmation of existing lawful access;
- no webhook, endpoint, broker routing, live adapter, or screen-scraping money path;
- no E8 backtest, certification, promotion, PAPER, Topstep, or live execution;
- no invented provider formula or native 4H range selector;
- no broad corpus census, Factory rerun, or 160-video intake.

E8 remains a **compiler-calibration source only**. The current packet does not make E8 the strategy
for Topstep and does not complete Blueprint Phase 1.

---

## FINAL RULING

**The Worker made real progress and correctly repaired most of the first grader's findings, but
Stage C0 is not closed. AR-1396 still permits unresolved or conflicting visual meaning to report
ready, and a dependency-bearing RED receipt compiles if its readiness field is removed. The report
also retained a zero-network test that its own grader proved cannot detect side effects, and it did
not finish several mandatory E8 birth tests. Preserve the implementation, make the bounded AR-1397
repairs, freeze the pin before grading, and stop. Stage C1, E8 trading, PAPER, Topstep, and live work
remain gated. This is the fastest robust path because it closes the two remaining ways the compiler
can fake readiness without reopening the video investigation or building another subsystem.**
