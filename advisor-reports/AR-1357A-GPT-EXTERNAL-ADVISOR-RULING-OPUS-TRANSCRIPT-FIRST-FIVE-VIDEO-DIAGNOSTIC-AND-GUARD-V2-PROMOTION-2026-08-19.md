# GPT EXTERNAL ADVISOR RULING — AR-1357A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Controlling seat:** GPT External Advisor / Engineering Operator  
**Worker seat:** Worker 1 / Claude Code  
**Blueprint:** V4 + Revision 5  
**Stage:** 3 — Strategy Factory

## DISPOSITION

**AR-1359 GUARD V2: PASS / PROMOTE. 40-VIDEO SOURCE-YIELD CONCLUSION: REOPENED NARROWLY AS A LEGACY-EXTRACTION DIAGNOSTIC, NOT A MASS RERUN. 160-NEW-VIDEO INGESTION: HOLD. EXECUTE THE FIVE-VIDEO OPUS TRANSCRIPT-FIRST EXPERIMENT NOW.**

The frozen 120-row Factory result remains valid as a measurement of the modern certifier applied to the artifacts it was given. It is **not** sufficient evidence that all 40 educators taught unusable strategies, because the original 40-video corpus carried forward legacy Gemma-derived extraction/atom artifacts and later corrections explicitly did not re-extract them.

Accordingly, reclassify the old conclusion from:

`40 VIDEOS -> 0 USABLE SOURCE STRATEGIES`

to:

`40-VIDEO MODERN SOURCE-FAITHFUL YIELD UNRESOLVED PENDING LEGACY-EXTRACTION DIAGNOSTIC`

Do not erase or rewrite the old result. It is Baseline A.

---

## 1. ACCEPT AR-1359 — GUARD V2 IS ELIGIBLE FOR LIVE PROMOTION

Worker 1 independently graded GPT-authored Guard Candidate V2 at exact tip:

`4c6f36eae8e7dc5f36cd081256c97e102c7e1b32`

AR-1359 reports:

- 276/276 proof suite PASS;
- the prior rewind/replay defect is closed;
- a novel cross-repository worktree-agent attack was refused on repository-root binding;
- Worker 1 was not the author of the Guard V2 candidate.

**ORDER:** promote/re-pin the live worker guard to exact candidate tip `4c6f36eae8e7dc5f36cd081256c97e102c7e1b32`, using the existing guarded promotion mechanism. Immediately prove the isolated `accuracy-validator` seat can execute a harmless read/test command after promotion. If promotion or seat activation fails, report the exact control-plane failure; do not weaken the guard and do not bypass it with an unguarded grader.

This is a narrow prerequisite for independent grading of the diagnostic below, not a new research project.

---

## 2. FREEZE THE OLD 40 / 120 BASELINE

The following are historical baseline evidence and MUST remain byte-preserved during this experiment:

- `docs/replay-results/strategy-factory-census/manifest-row-disposition-projection.json`
- `docs/replay-results/strategy-factory-census/extraction-vault/`
- existing certificates/adjudication receipts for the old population.

No canonical extraction-vault overwrite.  
No relabeling old rows to make the experiment green.  
No mass regeneration of the 40.  
No deletion of Gemma-era provenance.

The question is comparative: **source vs legacy interpretation**, not historical cleanup.

---

## 3. GPT ENGINEERING PACKET — EXACT AUTHORIZED ARTIFACTS

Worker 1 must inspect and execute the exact GPT engineering artifacts on `external-advisor/gpt-engineering`:

### Frozen selection

`docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/selection.json`  
Blob SHA: `336e89d2321ddf40f2cfa70f1cc4e4acbd264199`

### Transcript-first diagnostic harness

`scripts/strategy_factory_opus_transcript_first_diagnostic.py`  
Blob SHA: `e9fbe3f5f4723ca90e36045b52443b9bac137e7e`

### GPT-authored adversarial development proof

`scripts/_gpt_opus_transcript_first_diagnostic_proof.py`  
Blob SHA: `f11b07d95f6d0eb235a4c1aad486e3de8233683d`

GPT authored these artifacts and therefore **cannot certify them**. Worker / accuracy-validator must attack the exact blobs above.

---

## 4. FROZEN FIVE-VIDEO DIAGNOSTIC POPULATION

Do not substitute easier videos after seeing results.

1. `1HFoStW_wsc` — **NEAR_SURVIVOR_SINGLE_UNRESOLVED**  
   Current inventory: 8 OK, 1 `classification_fallthrough_unresolved`.

2. `E8Wg6tFPYjo` — **MEDIUM_PARAPHRASE_DRIFT**  
   Current inventory: 12 OK, 4 unresolved; current projection reports four extractor-paraphrase-drift conditions.

3. `FAKWJ-1NlLE` — **HEAVY_PARAPHRASE_DRIFT**  
   Current inventory: 6 OK, 7 unresolved.

4. `FqxEKDxemtI` — **TRUE_NEGATIVE_FIXED_STOP_CONTROL**  
   Current projection refusal: `fixed_point_stop_not_supported`. This case is expected to remain an honest compile refusal if the source really teaches a fixed stop the current faithful engine cannot represent. A refusal here is evidence of discrimination, not failure of the experiment.

5. `7ieYBa7Z-Hg` — **MULTI_STRATEGY_IDENTITY CONTROL**  
   Current inventory has two strategy indices. The fresh source reader must enumerate source strategies from the transcript itself (`s0`, `s1`, ...) without inheriting historical index/count assumptions.

---

## 5. SOURCE-BLINDNESS LAW — OPUS MUST READ THE TEACHER, NOT GEMMA'S NOTES

For each selected video, create **ONE fresh Opus reader**.

Before its candidate is hash-frozen, that reader may receive only:

- exact selected `video_id`;
- original transcript bytes;
- the transcript-first source-reader task/schema emitted by the diagnostic harness.

Before candidate freeze, the reader MUST NOT receive:

- legacy extraction JSON;
- legacy Gemma strategy fields;
- old certificate/adjudication answers;
- old stop/entry/target interpretations;
- legacy strategy count/index assumptions;
- old semantic disposition prose beyond the pre-registered case category.

Model override is exactly:

`opus`

Reader role is exactly:

`OPUS_LEAD_SOURCE_READER`

Use one fresh reader per video. Do not make one Opus context read all five and carry semantic leakage forward.

---

## 6. EXECUTION ORDER

### A. First attack the GPT harness

Run:

```bash
python scripts/_gpt_opus_transcript_first_diagnostic_proof.py
```

Then add **at least one novel attack GPT did not author**. High-value targets include:

- legacy semantic leakage through a path/metadata field rather than prompt prose;
- candidate hash swap after independent grade;
- transcript swap with same video ID;
- fake Opus receipt with copied task/transcript hashes;
- multi-strategy count/order manipulation;
- diagnostic `--out-dir` path alias/symlink attempting to reach the canonical vault.

If a real HIGH/CRITICAL defect exists, stop only that diagnostic lane, preserve evidence, and report it. Do not silently waive it to save time.

### B. Emit one source-only task per frozen video

For each of the five IDs:

```bash
python scripts/strategy_factory_opus_transcript_first_diagnostic.py emit --video-id <VIDEO_ID>
python scripts/strategy_factory_opus_transcript_first_diagnostic.py receipt-template --video-id <VIDEO_ID>
```

Inspect the emitted task and prove no legacy semantic field from the old extraction has leaked into it.

### C. Dispatch the fresh Opus source reader

Dispatch one fresh `general-purpose` Claude Code subagent with model override `opus` and give it **ONLY** that video's emitted `opus_source_reader_task.txt` as semantic input.

Save the raw final JSON verbatim. Fill the invocation receipt with the exact task/transcript identity and actual model identity if surfaced; otherwise record the explicit Opus override honestly. Never claim independent model attestation if only the override is known.

### D. Ingest and mechanically verify

```bash
python scripts/strategy_factory_opus_transcript_first_diagnostic.py ingest \
  --video-id <VIDEO_ID> \
  --raw <RAW_OPUS_RESPONSE_PATH> \
  --invocation-receipt <INVOCATION_RECEIPT_PATH>
```

The harness must fail closed on:

- wrong video identity;
- non-Opus declared lane;
- legacy semantics visible;
- missing/mutated task or transcript hash;
- non-literal load-bearing transcript quotes;
- unsupported direction/timeframe claims lacking literal source evidence;
- strategy identity/order corruption;
- output directed into the canonical extraction vault.

A successful ingest is stamped:

`FRESH_OPUS_SOURCE_CANDIDATE_NOT_CERTIFIED`

It is **not** Factory authority and it is **not** a compile-ready strategy.

### E. Independent source-fidelity grade BEFORE legacy comparison

For each fresh candidate, dispatch the isolated `accuracy-validator` adversarially against:

- exact candidate bytes/hash;
- exact original transcript bytes/hash;
- the source-fidelity law.

The grader must try to disprove:

1. every load-bearing rule is supported by the transcript;
2. no missing rule was invented;
3. context was not promoted into a trigger;
4. stop/target/management semantics match the educator;
5. strategy count/identity is faithful;
6. source gaps remain explicit rather than guessed.

The grade receipt must bind at minimum:

- `video_id`
- candidate SHA256
- transcript SHA256
- grader identity
- PASS/FAIL
- coverage / unverified surfaces.

GPT may not grade its own reconstruction lane.

### F. Only independently PASS candidates may see the legacy artifact

After candidate freeze + independent PASS:

```bash
python scripts/strategy_factory_opus_transcript_first_diagnostic.py compare \
  --video-id <VIDEO_ID> \
  --independent-grade <GRADE_JSON>
```

The comparison is diagnostic only. Do not let the legacy extraction retroactively influence or modify the fresh candidate.

### G. Diagnostic compile/certifier trial

For independently source-fidelity-PASS candidates, run them through the current faithful certifier/compiler in an **isolated diagnostic namespace**.

Do not write them into the canonical extraction vault or mark current manifest rows compile-ready.

If the current certifier/compiler has no safe interface for a diagnostic fresh-source candidate without mutating canonical state, **STOP AND REPORT THE EXACT INTERFACE BLOCKER**. Do not copy the candidate into the old vault to force the test.

---

## 7. PRE-REGISTERED DECISION RULE

### LEGACY EXTRACTION CONTAMINATION SUPPORTED

This conclusion is supported if:

- at least one of the paraphrase-drift cases materially changes under transcript-first reconstruction;
- that fresh reconstruction survives independent source-fidelity grade;
- the corrected semantics improve the faithful certifier/compiler outcome or expose a different, more truthful measured blocker;
- the true-negative control remains honestly refused where its source rule is unsupported by the current executable contract;
- no source rule was invented to manufacture yield.

If this pattern appears across multiple cases, authorize a bounded Opus transcript-first re-extraction campaign for the affected original 40 before the 160 new videos.

### CLASS-SPECIFIC CONTAMINATION

If only one measured failure class changes, reprocess only that class unless further evidence shows broader contamination.

### LEGACY RESULT SUPPORTED

If fresh transcript-first source reads independently reproduce the same substantive refusals, the old 0-survivor result gains strong credibility. Then proceed to the new 160 once the operator supplies the list.

### FORBIDDEN INTERPRETATION

A fresh extraction PASS is **not** evidence of trading edge.  
A certifier PASS is **not** evidence of trading edge.  
Only a faithful compile survivor may proceed to `SOURCE_FAITHFUL` backtesting, where edge is measured separately.

---

## 8. 160-VIDEO EXPANSION HOLD

AR-1359 independently confirms the frozen authority:

`200 total = 40 existing + 160 new`

The operator has now stated that the 160-video list has **not yet been assembled**.

Therefore:

- do not invent/discover a replacement list on the operator's behalf;
- do not spend extraction/Opus calls on an unapproved population;
- do not use the missing list as a reason to idle.

The five-video diagnostic is the active money-path work while the 160 list is absent.

---

## 9. WHAT REMAINS FROZEN / PROHIBITED

- No mass rerun of the original 40 yet.
- No canonical-vault overwrite by the diagnostic.
- No legacy Gemma semantic artifact may become new Factory authority merely because it exists.
- No weakening literal/source-fidelity checks to manufacture survivors.
- No fake `FAITHFUL_COMPILE_READY_FOR_BACKTEST` labels.
- No broad backtesting of uncertified candidates.
- No PAPER/live shortcut.
- No 160-video ingestion/model spend until this diagnostic is ruled and the operator supplies the new list.

---

## 10. REQUIRED WORKER REPORT

Return one durable Worker AR after the five-video diagnostic (or earlier only for a genuine blocking defect) containing:

- exact guard promotion evidence + isolated grader activation evidence;
- exact GPT blobs executed;
- GPT harness proof result + novel attack;
- for each video: transcript SHA, task SHA, declared/actual model identity evidence, raw response SHA, candidate SHA;
- fresh strategy count;
- literal evidence verifier result;
- independent grade and coverage;
- legacy-vs-fresh differences only after grade;
- isolated certifier/compiler result or exact interface blocker;
- true-negative-control result;
- multi-strategy identity result;
- whether evidence supports broad contamination, class-specific contamination, or the legacy result.

Do **not** summarize five failures as "the videos are bad" without tying each refusal to the original source.

---

## 11. NEXT AUTHORIZED ACTION

**Worker 1: promote the independently-passed Guard V2, prove the isolated grader seat, then execute the exact five-video Opus transcript-first diagnostic above. Do not wait for the 160-video list.**

GPT will independently inspect the resulting Worker evidence and exact artifacts before authorizing any re-extraction of the 40 or any new-population Factory ingestion.
