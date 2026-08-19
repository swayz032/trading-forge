# AR-1340

RULING : AR-1338A S3 (3-video deterministic pilot) / worker-execution S9 ("escalate uncertainty
         early... a test cannot distinguish two explanations, say so")
PIN    : working tree `claude/worker1-h1-20260815` @ `ba7206ce`
CHANGED: `scripts/fetch_source_transcript.mjs` (new); `scripts/strategy_factory_run_extraction.py`
         (new); `scripts/strategy_factory_probe_certification.py` (new, investigation-only);
         `src/engine/extraction/fixtures/source-evidence/{75DJN5UVQnw,FqxEKDxemtI,
         E8Wg6tFPYjo}.transcript.txt` (new, real fetched transcripts);
         `docs/replay-results/strategy-factory-census/extraction-vault/75DJN5UVQnw.json` (new,
         real extraction)

## PROGRESS SO FAR (mechanical, no judgment call needed)

1. Computed the frozen manifest's stable source-video ordering (40 unique videos, first-
   appearance order). Per AR-1338A S3 ("do not count sVkm as one of the 3"), skipping
   `sVkmZklJDHI` (position 2), the 3 pilot videos are: `75DJN5UVQnw`, `FqxEKDxemtI`,
   `E8Wg6tFPYjo`.
2. Fetched and pinned real source transcripts for all 3 (free `youtube-transcript` package, no
   API key needed, same convention `scripts/svkm_locator_benchmark.py` already uses --
   `src/engine/extraction/fixtures/source-evidence/<video_id>.transcript.txt`). Deliberately did
   NOT import `transcript-fetch-queue.ts` -- that module's `{logger} from "../index.js"` import
   executes the full server bootstrap as a side effect; reimplemented the fetch standalone.
3. Ran the REAL production extractor (`extractor_bridge.get_or_extract`, unchanged, real
   `gemma4:e4b-it-qat` call via Ollama) on `75DJN5UVQnw` -- one strategy extracted, full modern
   schema (`entry_sequence`/`stop`/`targets`/`confluences`/`speaker_concepts`).

## FINDING THAT STOPS ME HERE

**A extracted strategy carries NO `name` field.** sVkm's own committed extraction
(`docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json`) has `.extraction.strategies[0]
.name == "fvg_breakout_range_1m_5m"` -- I incorrectly treated that as part of the extractor's
standard output contract in Packets B/C. It is NOT: the fresh `75DJN5UVQnw` extraction has no
`name` key at all (confirmed: `.extraction.strategies[0] | keys` -> `confluences, direction,
entry_sequence, higher_timeframe, preferred_regime, speaker_concepts, stop, targets`). sVkm's
`name` was added during ITS OWN certification campaign, not produced by the extractor. **This
does not invalidate Packet B/C's results** (both correctly measured "no modern extraction file
exists at all" for 9/9 and 120/120 members via a file/video-id-level check, never by comparing
strategy names for a POSITIVE match) -- but it means row-to-extraction PROJECTION (AR-1338A S2:
"project disposition to the three linked manifest members") cannot use name-matching for the
40-video upgrade either. Noted, not blocking by itself.

**The actual blocker**: I ran `pilot_conveyor.prepare_strategy` (anchor-location + tier-1
classification -- the EXISTING, zero-new-campaign machinery: real `anchor_locator.py` gemma
calls per condition, then pure-regex tier-1) against the one extracted strategy above.

```
spine_condition_count: 13
unanchored_count: 0
tier1_classified_count: 0
tier1_fallthrough_count: 13   <-- ALL 13, zero classified
```

**Every single condition fell through to tier-3.** `prepare_strategy` never resolves a
fall-through itself -- it packages a blind adjudication packet (`tier3_packet`, 13 Set-B items)
for a rater to answer. Nothing in this video's conditions reaches a "certified" state from
extraction + anchor-location + tier-1 alone.

## WHY THIS IS A STOP, NOT A JUDGMENT CALL

`sVkmZklJDHI`'s own certification history (`docs/replay-results/svkm-extraction-certified/grade/
opus-v2/`) is NOT a single script run -- it is a multi-session, multi-AR campaign: an o1-batch
adjudication pass, THEN multiple G2D correction rounds (`G2D-AR1313B`, `G2D-AR1314B-SOURCE-TRUTH-
TEXT-CORRECTION-AND-REGRADE`, `G2D-AR1321A-SOURCE-GRAPH-PROJECTION`), each fixing a measured
defect the prior round's grading surfaced, before the frozen `source_graph_projection_v2_1_spec.
json` (which `compile_svkm_v2_1_vertical` deterministically replays, zero model calls) was ever
produced. That whole campaign is what "certified" meant for the golden vertical.

AR-1338A S2 says to reuse "current source-graph certification machinery" as an existing,
minimum-call-count PATH. The measured reality is that this "path", run honestly on a brand-new
video, produces a 100%-fall-through blind packet needing real adjudication -- and the ONLY
precedent this repo has for closing that adjudication (sVkm) took a multi-round correction
campaign per video, not one dispatch. Applying THAT full bar to 40 videos is a categorically
larger undertaking than a "3-video pilot, then fast-continue through 37 more, no routing pause"
packet reads as authorizing. Applying a LOWER bar (e.g., one single-pass tier-3 dispatch, accept
whatever `finalize_certificate`'s `pilot_grade`/`full_grade` says, no correction rounds) is a
real, load-bearing choice about what "certified" means for this factory tier -- and choosing it
myself risks exactly the failure mode this project's own laws exist to prevent: a compiler
milestone or `FAITHFUL_COMPILE_READY_FOR_BACKTEST` claim that looks rigorous but was not held to
the bar its label implies.

## BLOCKED DECISION

**Option A -- single-pass tier-3 adjudication is the factory-tier bar.** Dispatch each video's
blind tier-3 packet ONCE (self-dispatched grading agent, e.g. `accuracy-validator` or an
equivalent single-rater call -- "the minimum call count required by the existing contract," no
ensemble, no multiple rounds), accept `finalize_certificate`'s resulting `pilot_grade`/
`full_grade` as the certification verdict for that video's conditions, proceed to compile on
pass, refuse (with the actual measured failure) on fail. Distinct from, and explicitly NOT held
to, the exceptional multi-round rigor sVkm received as the one golden reference vertical.
**Impact:** ~13-20 real adjudication dispatches per video x 40 videos is a large but bounded,
namable cost; tractable in this packet if authorized explicitly.

**Option B -- full G2D-style multi-round certification, matching sVkm's own bar, is required.**
This is a categorically larger, multi-session undertaking per video and cannot be completed as
"a 3-video pilot then fast-continue through 37 more" in bounded time. Would require re-scoping
AR-1338A into a much longer campaign, likely video-by-video over many sessions.

**Option C -- some other defined bar** (e.g., tier-1-only with fall-throughs automatically
routed to an evidenced refusal disposition, never dispatched at all -- cheapest, most
mechanical, but then essentially every video in this library will refuse for the same reason
75DJN5UVQnw did, and the packet would mostly re-confirm Packet C's finding at a video-name-level
resolution rather than genuinely upgrading any strategy to `FAITHFUL_COMPILE_READY_FOR_BACKTEST`).

**Recommendation:** Option A, because it is the one that actually tests whether the modern
pipeline CAN certify new videos at bounded cost, while still requiring a real (not fabricated)
adjudication pass rather than silently downgrading to Option C's near-guaranteed mass refusal.
But this is a real choice about instrument-grade certification rigor, and I am not self-
authorizing it.

NEXT   : Holding. Awaiting GPT's disposition on Option A/B/C (or a different bar) before running
         the remaining 2 pilot-video extractions or any adjudication dispatch. The extraction and
         transcript-fetch work already done (fully mechanical, zero judgment) stands regardless
         of which bar is chosen.
STOP   : yes -- certification bar for the 40-video upgrade factory is undetermined and load-
         bearing; not self-authorized.
GRADER : not dispatched (nothing to grade yet -- no compile/certification claim has been made in
         this packet).
