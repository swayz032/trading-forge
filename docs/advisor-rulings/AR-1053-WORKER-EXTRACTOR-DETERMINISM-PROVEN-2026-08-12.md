# AR-1053 — WORKER — **DETERMINISM PROVEN: two independent extractor runs are BYTE-IDENTICAL.** §6.2 does not fire; the forward-authority receipt's anchor 3 is now measured-stable.

```
RULING : AR-1050 GPT ruling (gpt-rulings b3fb81d3) §3.D.5 / §6.2
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
```

## 1. THE MEASUREMENT — CLOSING A LIMITATION I DECLARED IN AR-1052 §6

AR-1052 §6 stated plainly: *"the extractor ran exactly once — a single LLM pass is not evidence
about its stability"*, and that seeding is **a claim until measured twice**. It is now measured.

Two independent full runs of `run_two_phase_extraction` over the committed transcript
(sha256 `df72444f...`, 25,071 ch), same pin, same model `gemma4:e4b-it-qat`:

```
run 1: 131s   record sha256 = 199d740b70b65f83ef3c4badb11af12cf405f741ef6e482701641f3ae11d1167
run 2: 137s   record sha256 = 199d740b70b65f83ef3c4badb11af12cf405f741ef6e482701641f3ae11d1167

FULL RECORD IDENTICAL                     : True
CORE (strategies + classification)        : True
  name / direction / stop / targets       : identical
  entry_sequence step count               : 4 = 4
```

★ **The FULL record hash matches, not merely the load-bearing subset** — that includes the
diagnostic `phase_a_enumeration` and `per_strategy_extractions` echo fields, so **both the Phase-A
enumerator call and every Phase-B extractor call reproduced exactly.** The two-phase orchestration
is deterministic end-to-end, not just its final assembly.

## 2. WHAT THIS SETTLES

- **§6.2 does NOT fire.** *"The current extraction path cannot be replayed deterministically for one
  committed transcript"* is **refuted by measurement**.
- **Receipt anchor 3 is upgraded** from a single observation to a reproduced value:
  `record sha256 = 199d740b...`. The forward-authority chain
  `committed transcript -> current extractor @ pin -> record` is now deterministic **at both ends
  I can currently reach**.
- **AR-1052's two producer defects are unaffected** — they remain the open blockers, and the
  producer still crashes before an artifact exists, so **anchor 6 (`spec_hash`) is still
  unobtainable**.

## 3. WHAT THIS DOES *NOT* SETTLE

- **Two runs on ONE transcript, on ONE machine, in one session.** This is evidence about *this*
  input on *this* host — **not** a general determinism guarantee for the extractor across videos,
  hosts, ollama versions, or model reloads. `UNENUMERATED`.
- It says nothing about **producer** determinism (§3.D.5's real target), which cannot be measured
  until the producer stops crashing.
- No negative control applies here: this is a reproduction test, and its own control is the
  second run.

## 4. STATE

Holding at AR-1052's STOP, awaiting the ruling on the two producer-side repairs. **No production
code mutated. Engineering branch untouched at `0bbcabc8`.**
