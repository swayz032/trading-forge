# GPT EXTERNAL ADVISOR RULING — AR-1338A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker:** `worker-1` / `compiler-factory`  
**Reviewed report:** `AR-1338-WORKER1-AR1328A-PACKETC-FULL-RUN-COMPLETE-2026-08-19.md`

## DISPOSITION

**PASS — AR-1328A STRATEGY FACTORY CENSUS IS CERTIFIED. FACTORY INTEGRITY IS GREEN. LIBRARY INPUT READINESS IS RED. NEXT BOUNDED PACKET: MODERN EXTRACTION UPGRADE FACTORY OVER 40 UNIQUE SOURCE VIDEOS.**

The worker's headline is accepted exactly as scoped: the frozen live-library manifest contains 120 unique strategy IDs; the full conveyor emitted 120 dispositions with no missing/extra/duplicate output IDs; the external sVkm positive control reproduced the certified Stage-2 spec hash exactly; and all 120 live-library members currently refuse at the same upstream seam because no matching modern-schema certified extraction input exists for those source videos.

This is not evidence that the 120 strategies lack edge. It is not a compiler failure. It is a measured **input-generation/certification gap** between the legacy v2 library and the modern source-graph compiler path.

The current 120-row population resolves to **40 unique source videos, three market-materialized rows per video**. Therefore the next engineering unit is 40 source videos, not 120 independent extraction jobs.

---

## 1. ACCEPTED EVIDENCE

Accepted:

- immutable live-library manifest: 120 members / 120 unique IDs / 117 names;
- live population came from the current strategy API rather than an old test corpus;
- exact input/output identity conservation;
- all missing/extra/duplicate sets empty;
- sVkm external positive control reproduced spec hash `dc9d12a78be85c62c1ae02930b3d36ddd1214a40fe98abef2a52b70b4d619749`;
- 120/120 current manifest rows classified `EXTRACTION_MISSING_REQUIRED_INFORMATION`;
- 40 refusal clusters, each blocking exactly 3 manifest rows.

One bounded implementation note: `MATCHED_EXTRACTION_FOUND_COMPILE_NOT_ATTEMPTED_THIS_PACKET` exists as a script-only special case outside the frozen disposition vocabulary. It did not occur in this run, so it does not invalidate this census. It MUST NOT survive into the next conveyor: if a modern certified extraction exists, the factory must actually attempt the production compiler or emit one of the frozen refusal dispositions.

---

## 2. NEXT PACKET — 40-VIDEO MODERN EXTRACTION UPGRADE FACTORY

Worker 1 shall now convert the legacy-library source population into modern compiler inputs using the smallest source-faithful path.

### Unit of work

One unique source video is one extraction/certification unit.

A successfully certified source record may then be projected to its three manifest rows only where the row's market/timeframe materialization is authorized by source truth or an already-frozen framework-owned materialization rule. If a market/timeframe binding is not justified, emit `MARKET_OR_TIMEFRAME_UNRESOLVED`; do not invent it.

### Reuse law

Reuse existing assets first:

- already-downloaded/source-pinned transcripts;
- legacy v2 extraction as a locator/hint only, never as new source authority;
- current modern extraction schema;
- current source-graph certification machinery;
- existing production `compile_certified_record.py` / `spec_producer.py` path;
- current refusal vocabulary and evidence rules.

Do not re-download a video or re-transcribe it when an exact source-pinned transcript already exists.

Do not mechanically translate an old compiled spec into a new certified source graph. Legacy outputs may help locate source passages, but the modern record must remain grounded in source evidence.

---

## 3. DETERMINISTIC PILOT

Select the **first 3 unique source-video IDs under the frozen manifest's stable source ordering**. No hand-picking by expected outcome.

For each of those 3 videos:

1. resolve/reuse the existing source transcript;
2. produce one modern extraction record under the current schema;
3. run the current source-graph certification path;
4. if certified, invoke the existing production compiler path;
5. project disposition to the three linked manifest members;
6. preserve exact refusal evidence where certification or compilation cannot proceed.

Keep sVkm as an external positive control; do not count it as one of the 3 library videos.

Pilot integrity requires:

- source evidence remains attributable to the exact video/transcript;
- no legacy compiled output becomes source authority;
- no hidden condition loss;
- no invented market/timeframe/stop/target semantics;
- deterministic repeat output;
- production compiler, not a second compiler;
- every linked manifest member receives exactly one frozen disposition.

Low compile yield alone is not a pilot failure. Silent loss, nondeterminism, source invention, or false success is.

---

## 4. FAST CONTINUATION

If the 3-video pilot passes integrity, continue automatically through the remaining 37 unique source videos **without another GPT routing pause**.

Use bounded concurrency only. Maximum 4 source-video units in flight at once unless the existing canonical extractor imposes a lower limit.

Do not run an 8-Opus multi-agent campaign per video. Use the canonical extraction/certification path once per source unit, with caching/receipts. If a model call is part of the canonical extractor, use the minimum call count required by that existing contract; do not create a new ensemble merely to increase agreement.

A legitimate source ambiguity is a valid refusal and does not halt unrelated videos.

---

## 5. COMPILER CONTINUATION LAW

For any video that reaches a modern certified extraction, the factory MUST continue into the real production compiler during the same packet.

Allowed outcome per linked manifest row:

- `FAITHFUL_COMPILE_READY_FOR_BACKTEST`, or
- one of the already-frozen measured refusal dispositions.

Do not emit `MATCHED_EXTRACTION_FOUND_COMPILE_NOT_ATTEMPTED_THIS_PACKET` in the new run.

One video's refusal must not stop the other 39 videos.

---

## 6. REQUIRED FINAL RECEIPT

Return one machine census covering all 40 videos / 120 manifest rows:

1. frozen manifest hash;
2. source-video set and transcript/source pins;
3. per-video extraction artifact/hash/status;
4. per-video source-graph certification status;
5. per-manifest-row compiler disposition;
6. faithful compiled artifact/spec hashes;
7. refusal evidence and exact failed seam;
8. missing/extra/duplicate identity sets;
9. deterministic repeat proof;
10. compile-ready survivor count;
11. refusal clusters ranked by blocked manifest rows;
12. exact model/tool call count used by the upgrade conveyor;
13. final verdict `PASS` or `QUARANTINE`.

Do not hand-clean counts.

---

## 7. HARD BOUNDARIES

During this packet:

- no historical edge backtests yet;
- no PAPER qualification;
- no Context Observer expansion;
- no Topstep/live execution;
- no rewriting the 120-row manifest to improve yield;
- no deleting market variants because they refuse;
- no source semantics inferred from symmetry;
- no broad new extraction architecture if the existing extractor/certifier can be reused;
- no reopening sVkm F36/G2/short-stop visual work absent new primary source.

---

## 8. NEXT GATE

When the 40-video upgrade census is complete, faithful compiled survivors become eligible for the already-prepared **cheap source-faithful edge-screen** gate. GPT will inspect the survivor population and refusal clusters before deeper research or PAPER work is authorized.

**Final ruling:** AR-1328A is complete and PASS. Worker 1 shall immediately begin the modern extraction upgrade factory at the 40-source-video level: 3 deterministic source videos as the integrity pilot, then automatically the remaining 37 on pilot PASS, with each certified source continuing into the existing production compiler and each of the 120 manifest members ending in exactly one frozen disposition.