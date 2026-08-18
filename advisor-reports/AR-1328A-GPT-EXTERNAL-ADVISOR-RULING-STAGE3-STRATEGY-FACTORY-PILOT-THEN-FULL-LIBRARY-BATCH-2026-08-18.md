# GPT EXTERNAL ADVISOR RULING — AR-1328A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Governing chain:** AR-1153 V4 lane map → AR-1327A Stage-2 certification / AR-1138 closure → Worker AR-1328 session-boundary report  
**Worker permanent lane:** `compiler-factory` — Team Lead / Graph Engineering → Compiler → Strategy Factory

## DISPOSITION

**PASS — WORKER AR-1328 STOP WAS CORRECT. STAGE 3 STRATEGY FACTORY IS NOW GIVEN A BOUNDED EXECUTION PACKET.**

AR-1327A unlocked Strategy Factory but deliberately did not authorize a new model/subagent campaign. Worker AR-1328 correctly refused to self-invent a target manifest or batch. The missing work order is supplied here by activating the already-prepared AR-1153 P1-1 Strategy Factory batch-disposition contract and the existing `.claude/skills/batch-disposition-integrity/SKILL.md` law.

The objective is not to make every strategy compile. The objective is to process the existing strategy library faithfully and deterministically so every immutable input member receives exactly one machine disposition: a faithful executable compile or an evidence-backed refusal. **A measured refusal is a valid factory output and must not stop the batch.**

This packet uses a small pilot as a control, then proceeds directly to the full current authoritative library without another GPT routing pause if the factory-integrity controls pass.

---

## 1. AUTHORITATIVE CONTRACTS

Use, do not redesign:

1. AR-1327A — Stage 2 compiler vertical certified; sVkm remains the golden positive control.
2. AR-1153 §4 `GPT-P1-1 — Strategy Factory batch disposition contract`.
3. `.claude/skills/batch-disposition-integrity/SKILL.md`.
4. Existing production compiler / certified source-artifact paths already proven by Stage 2.

Do not build a parallel compiler, second source authority, second disposition vocabulary, or hand-maintained result ledger.

---

## 2. PACKET A — FREEZE THE AUTHORITATIVE LIBRARY MANIFEST

Worker 1 shall locate the current repository authority for the existing strategy-library input population. Do not infer membership from compiler outputs.

If no immutable V1.1 manifest exists, create the smallest versioned machine-readable manifest derived from the existing authoritative source inventory/corpus and content-pin it.

Required manifest receipt:

- manifest path + SHA256/content hash;
- ordered member identities;
- input count and unique-member count;
- duplicate/equivalent identities preserved as members pending explicit disposition, never silently dropped;
- source/corpus/version pins needed to reconstruct the membership;
- proof that no member was selected or removed because of whether it compiles.

If two repository surfaces disagree on library membership, STOP only the manifest-freeze step and report the exact set difference. Do not choose the convenient population.

---

## 3. PACKET B — DETERMINISTIC PILOT

Build a deterministic pilot consisting of:

- the certified sVkm golden source as the positive control; plus
- the first **9 additional unique library members** under a stable, documented source-identity ordering from the frozen manifest.

No manual cherry-picking by expected outcome.

Run all 10 through the same Strategy Factory conveyor.

For every member emit exactly one allowed `batch-disposition-integrity` disposition with machine evidence.

The sVkm control must reproduce the Stage-2 certified compiler identity/semantics expected from the current certified path; any unexpected sVkm drift QUARANTINES the pilot.

Pilot PASS requires:

- 10 manifest members in;
- 10 unique disposition rows out;
- no missing/extra/duplicate output identity;
- deterministic rerun equality over member identity, disposition, evidence identity, and compiler/capability version;
- faithful compiles preserve exact condition/parameter/temporal/source-vs-framework semantics;
- refusals name the failed handoff and evidence rather than generic prose;
- no silent success with missing artifact;
- no source mutation or gate weakening.

**Low faithful-compile count does not fail the pilot. Integrity defects do.**

---

## 4. PACKET C — AUTOMATIC FULL-LIBRARY RUN

**If and only if Packet B passes factory-integrity controls, proceed immediately without waiting for another GPT ruling.**

Run the SAME immutable manifest through the SAME conveyor for the full current authoritative library population.

Do not alter the compiler between pilot and full run merely to increase compile yield.

For every manifest member require exactly one disposition from the existing allowed vocabulary:

- `FAITHFUL_COMPILE_READY_FOR_BACKTEST`
- `SOURCE_INCOMPLETE`
- `SOURCE_AMBIGUOUS`
- `EXTRACTION_MISSING_REQUIRED_INFORMATION`
- `CANONICAL_TERM_UNRESOLVED`
- `PARAMETER_SCHEMA_MISMATCH`
- `MARKET_OR_TIMEFRAME_UNRESOLVED`
- `ENGINE_PRIMITIVE_MISSING`
- `ENGINE_PRIMITIVE_WRONG_IDENTITY`
- `TEMPORAL_STATE_MACHINE_MISSING`
- `DUPLICATE_OR_EQUIVALENT_STRATEGY`
- `OTHER_MEASURED_REFUSAL`

A single strategy refusal must not abort unrelated members. Resume/retry must be idempotent and must not duplicate disposition rows.

Required full-run receipt:

1. manifest pin;
2. input/output/unique identity sets;
3. missing/extra/duplicate sets;
4. per-disposition membership lists, not counts alone;
5. faithful-compile artifact hashes/provenance;
6. refusal evidence and exact failed seam;
7. deterministic repeat result;
8. reusable refusal-capability clusters ranked by number of blocked strategies;
9. final factory verdict `PASS` or `QUARANTINE`.

Machine artifacts are source of truth. Do not hand-clean the table to make totals look better.

---

## 5. REPAIR LAW DURING THIS PACKET

The purpose of this run is to MEASURE the library, not to enter an endless repair loop.

If the pilot exposes a **factory-integrity defect** — missing member, duplicate row, nondeterminism, silent condition loss, wrong primitive substitution, broken resume semantics — repair the smallest causal factory seam and rerun the pilot until PASS.

If an individual strategy produces a legitimate evidence-backed refusal, record it and continue. **Do not repair refusal clusters during this packet.** The full census exists precisely so later capability work can be ranked by measured value.

No new source extraction/model/Agent/Opus campaign is authorized merely because a library member refuses. Use existing source/extraction artifacts.

---

## 6. HARD BOUNDARIES

During AR-1328A:

- no broad historical backtests;
- no source-faithful edge screening yet;
- no Context Observer expansion;
- no PAPER qualification run;
- no Topstep/broker/live execution;
- no F36 reopening;
- no G2 reopening;
- no short-stop visual reinvestigation;
- no global relevance/fidelity threshold weakening;
- no compiler redesign merely to increase yield;
- no manual deletion of duplicates/refusals from the manifest.

The previously parked downstream AR-1142 through AR-1153 qualification/autonomy work remains reusable authority, but its PAPER/runtime engineering is not pulled ahead of the V4 stage order by this packet. The separate normal-Claude worker-team activation/setup may proceed without changing trading semantics or activating capital paths.

---

## 7. FAST CONTINUATION LAW

Worker 1 does **not** stop after the 10-member pilot just to report success.

```text
freeze manifest
-> run 10-member deterministic pilot
-> if integrity RED: repair smallest factory seam and rerun
-> if integrity PASS: immediately run full manifest
-> emit machine census + refusal clusters
-> commit/push
-> return one Worker report to GPT
```

No routing pause between pilot PASS and full-library execution.

---

## 8. NEXT GATE AFTER THIS REPORT

A full Strategy Factory PASS does not itself certify edge or trading quality. It produces the population for the next money-path gate:

```text
faithful compiles
-> cheap source-faithful edge screening
-> survivors
-> Context Observer / deeper research
-> finalist robustness
-> qualification / custom PAPER
```

GPT will inspect the full factory census and authorize the next bounded gate from repository evidence.

**Final ruling:** Worker 1 shall proceed now with the existing Stage-3 Strategy Factory contract: freeze the authoritative library manifest, prove a deterministic 10-member pilot including the sVkm golden control, then automatically process the full library if pilot integrity passes. Evidence-backed refusals are valid outputs; factory integrity failures are the only reason to halt/repair this packet.