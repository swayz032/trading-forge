# GPT EXTERNAL ADVISOR RULING — AR-1325A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**AR-1324A micro-closeout implementation commit inspected:** `98fe0112`  
**Worker report/head inspected:** `f3430723fc4fa0d67fd0aecf8f9656eea40da8f2`  
**GitHub CI:** **NONE** — combined statuses are empty and no workflow runs are attached to the inspected worker head.

**Disposition:** **PASS — STAGE 1 SOURCE-GRAPH ENGINEERING / CERTIFICATION PROJECTION IS CERTIFIED FOR THE sVkm GOLDEN SOURCE. THE V2.1 MACHINE CERTIFICATE IS `GREEN_ALL_ITEMS_DONE`. STAGE 2 COMPILER VERTICAL IS NOW UNLOCKED AND WORKER-1 SHALL PROCEED WITHOUT ANOTHER ROUTING PAUSE. THIS IS NOT CERTIFICATION OF THE FULL 120-STRATEGY LIBRARY, STRATEGY FACTORY, BACKTESTER, PAPER, BROKER, OR LIVE-MONEY PATH.**

## 1. CERTIFICATION BASIS

Independent GitHub inspection verifies the final AR-1324A micro-closeout is correctly bounded:

- the micro-closeout changes only the stable certifier and regenerated certificate;
- `run_projection()`, the V2.1 spec, stable loader, permanent tests, frozen V1/V2 historical artifacts, relevance gate, term-equivalence table, and 0.10 floor are unchanged in this final round;
- the stable certifier now executes the exact pre-registered AR-1322A/V2 neighboring command, not the broader 53-file census introduced in AR-1324;
- the current committed certificate reports `overall_status = GREEN_ALL_ITEMS_DONE`;
- deterministic receipt hashes are identical across the two zero-model-call projection runs: `fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f`;
- transcript pin is `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`;
- extraction pin is `c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`;
- conservation is exactly `12 = 9 canonical + 1 alias + 2 preserved metadata`;
- all 9 canonical nodes are accepted;
- the typed graph is complete: 9/9 required canonical nodes reachable, 0 unreachable;
- focused permanent projection suite is `31 passed`;
- exact pre-registered neighboring suite is `294 passed, 5 skipped, 0 failed`;
- GitHub combined statuses and workflow runs are both empty, so CI remains honestly reported as `NONE` rather than conflated with local pytest evidence.

The two unrelated failures disclosed in AR-1324 are not part of the pre-registered certification population and were not modified to manufacture this pass. That is the correct outcome.

## 2. STAGE-1 CERTIFICATE SCOPE

This certification means the golden sVkm source now has a deterministic, source-grounded, versioned certification projection that can be reconstructed from committed data and mechanically checked without new model calls.

Certified Stage-1 contract:

1. source-specific adjudication is versioned data, not hidden `_tmp.py` executable state;
2. all 12 incoming extraction refs are conserved into exactly 9 canonical gate nodes, 1 explicit provenance alias, and 2 preserved non-executable metadata refs;
3. every canonical node is backed by literal source evidence and passes the unchanged relevance/fidelity machinery under the versioned role-bounded caller contract;
4. source corrections/retypings carry explicit authorities and original/projected provenance;
5. supplementary direction evidence carries exact span + quote + hash;
6. preserved metadata carries the required historical/corrected/exclusion record under a strict schema;
7. the F37 duplicate is an explicit alias rather than silently deduplicated;
8. the dependency graph has declared edge types, endpoint validation, acyclicity, and complete reachability;
9. the certificate-critical mutation/negative controls are permanent tests;
10. the stable certifier owns the whole-contract verdict and exits nonzero unless its internal checklist is all-DONE.

This certificate is deliberately narrow. It certifies **the Stage-1 source graph for this golden source**, not a universal claim that every library source will project correctly.

## 3. STAGE 2 COMPILER VERTICAL — UNLOCKED NOW

Worker-1 remains the permanent `compiler-factory` owner. It shall proceed immediately to the Stage-2 compiler vertical using the certified V2.1 source graph as the input contract.

The shortest robust vertical is:

```text
certified V2.1 source graph
-> existing production compiler entry path
-> one deterministic executable strategy/spec artifact
-> compiler contract/lint checks
-> execution-semantics witness for every source-owned node
-> deterministic repeat compile
-> STOP for GPT review only after the vertical is proven end-to-end
```

### Required Stage-2 first vertical

Use this exact certified sVkm source as the golden compiler input. Do **not** switch to another strategy yet.

Prove that the existing compiler can consume the certified graph and preserve, at minimum, these source-owned mechanics in executable form:

1. 9:30 AM ET timing requirement;
2. first 5-minute candle high/low range definition;
3. 1-minute close outside that range;
4. breakout-side direction routing: downside -> short, upside -> buy/long;
5. FVG sequence outside the certified range;
6. FVG validity only after the third candle prints/completes;
7. entry on the third candle close;
8. stop at the direction-relative FVG candle extreme including wick;
9. fixed 2R target.

Alias and preserved metadata must remain provenance, not duplicate executable predicates.

### Stage-2 proof requirements

The first compiler vertical must return with repository evidence for:

- exact production compiler entry point used;
- exact mapping from each of the 9 certified canonical nodes to the compiled representation;
- explicit proof that the alias did not become a second executable trigger;
- explicit proof that the 2 preserved metadata refs did not enter executable logic;
- source-owned stop and 2R target preserved — no ATR/Style-C/framework replacement in `SOURCE_FAITHFUL` mode;
- direction is source-owned breakout-side routing — no EMA/framework proxy;
- range dependency and FVG dependency remain linked rather than flattened into unrelated prose;
- compile refuses or REDs if one load-bearing canonical node is removed/mutated;
- deterministic repeat compile produces byte-identical or canonically identical output;
- relevant compiler/lint/regression suites green;
- CI status reported separately.

If an existing compiler seam is missing, implement the **smallest missing production adapter** required to carry the certified graph into the existing compiler. Do not create a parallel compiler.

## 4. LOCKS THAT REMAIN

Still locked until the Stage-2 vertical passes:

- broad Strategy Factory expansion;
- compiling/running the whole ~120-strategy library;
- broad historical backtests;
- PAPER;
- Topstep/broker wiring;
- live execution or live-money activation;
- framework-overlay changes.

No new Opus/Agent/model call campaign is authorized merely to perform the compiler vertical. Reuse the certified source graph and existing repository artifacts first.

Do not reopen F36, AR-1320B comparator experiments, or the rejected V1/V2 certificate defects absent new contradictory evidence.

## 5. AUTHORITATIVE SIX-STAGE MAP

```text
STAGE 1 — GRAPH ENGINEERING / CERTIFICATION PROJECTION: CERTIFIED ✅
STAGE 2 — COMPILER VERTICAL: UNLOCKED / ACTIVE NOW
STAGE 3 — STRATEGY FACTORY: LOCKED
STAGE 4 — CONTEXT OBSERVER: LOCKED
STAGE 5 — QUALIFICATION: LOCKED
STAGE 6 — AUTONOMOUS RUNTIME: LOCKED
```

Worker-1 shall not ask whether compiler work belongs to its role. `compiler-factory` is its permanent lane. Temporary guard/certification assignments are closed. On completion of a temporary blocker, routing automatically returns to the permanent compiler-factory mission.

**Final Stage-1 ruling: CERTIFIED. Proceed directly to Stage 2 Compiler Vertical.**