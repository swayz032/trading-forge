# AR-1343

RULING : ratify-packet (instrument-touching autonomous class, doer != grader) / worker-onboarding
         S3 "surface every load-bearing change... false green/red... changed test outcomes"
PIN    : working tree `claude/worker1-h1-20260815` (uncommitted at time of writing -- fix staged,
         independent grade in flight, committing once the grade lands)
CHANGED: `src/engine/extraction/anchor_locator.py` (one line: added `num_ctx: 32768` to
         `_default_propose_fn`'s Ollama call options)

## FINDING: A REAL MEASUREMENT-INSTRUMENT DEFECT CORRUPTED AN ALREADY-PUBLISHED FINDING

While running the 40-video upgrade-factory pilot's remaining videos (post AR-1342), 5/5
consecutive `prepare_strategy` calls crashed for video `N7uP9V0Iktc` with
`json.decoder.JSONDecodeError` inside `anchor_locator.py::_default_propose_fn` -- malformed or
truncated JSON coming back from the local Ollama gemma4 call.

Root cause, measured: `_default_propose_fn` never sets `num_ctx` in its Ollama request options.
`curl http://localhost:11434/api/ps` showed the currently-loaded model instance running at
`context_length: 4096` -- NOT the project's documented canonical `TRANSCRIPT_EXTRACTOR_NUM_CTX=
32768` (CLAUDE.md §15 / `model-router.ts`'s convention for the sibling extraction call on the
SAME model). Any transcript longer than ~4096 tokens (~16K chars) was silently truncated before
the model ever saw the condition it was asked to ground.

**This directly corrupted the video-3 (`E8Wg6tFPYjo`) finding already published in AR-1342
(pushed to this branch, GPT has not yet ruled on it).** `E8Wg6tFPYjo`'s transcript is 22,830
bytes (~5,700+ tokens) -- exceeds 4096 on its own, before the system prompt and condition text
are even added.

- **BEFORE the fix** (the number AR-1342 reported): 9/16 conditions `unanchored`
  (`proposed_quote_not_literal_substring`) -> certificate guaranteed unclean -> disposition
  `EXTRACTION_MISSING_REQUIRED_INFORMATION`.
- **AFTER the fix** (rerun of the identical command against the identical frozen transcript):
  0/16 unanchored, all 16 conditions anchored -> the video now genuinely NEEDS real Stage-1/
  Stage-2 dispatch to determine its outcome, exactly like video 1 (`75DJN5UVQnw`) did.

**AR-1342's video-3 conclusion is WITHDRAWN pending a correct re-measurement.** Video 1
(`75DJN5UVQnw`, 7,383-byte transcript, safely under 4096 tokens) and the external sVkm control
(zero anchor_locator calls -- replays a frozen spec) are UNAFFECTED; those two findings stand.

## THE FIX (ratify-packet, autonomous instrument class -- pre-live, no live default/frozen-ref
invalidation in the irreversible sense; independent grade in flight per that skill's mandatory
process)

One line, additive only: `"options": {"temperature": 0.1, "top_p": 0.95, "top_k": 64, "num_ctx":
32768}` (was missing `num_ctx` entirely). `32768` matches the project's own documented canonical
value for this exact model, not an invented number.

RED : 5/5 consecutive crashes on `N7uP9V0Iktc` prep, `JSONDecodeError` inside
      `_default_propose_fn`, pre-fix.
GREEN: identical command, post-fix, succeeds (`unanchored_count: 3` of 7 -- a normal, honest
       result, not a crash).
CONTROL: `E8Wg6tFPYjo` before/after comparison above -- the fix changes a real, measured outcome
       in the expected direction (fewer false "unanchored" verdicts), not merely "stops
       crashing."
GRADER: `accuracy-validator` dispatched (DISPROVE mandate, doer != grader), independently
       re-deriving both before/after numbers itself rather than trusting my transcript, checking
       for the same missing-`num_ctx` pattern elsewhere in the codebase, and sanity-checking the
       `32768` value against the model's true capability and the longest transcript on disk.
       **Full verdict not yet returned -- will land in a follow-up commit to this same report
       file, never summarized-only, per worker-onboarding S3's durable-grader-report rule.**

## OPEN QUESTION FROM THE OPERATOR -- RELAYED, NOT DECIDED BY ME

Mid-session the operator asked (paraphrased): *"We don't use Ollama, isn't Opus 5 supposed to be
the locator?"* -- questioning whether `anchor_locator.py`'s anchor-PROPOSAL step should be
calling an Opus model instead of local Ollama/gemma4 at all, which would be a different and more
fundamental change than the `num_ctx` fix above.

I checked the repo before answering: **`git log -- src/engine/extraction/anchor_locator.py`
shows exactly ONE commit ever touched this file** (`2b278757`, its original landing), whose own
message states the ratified, independently-graded design explicitly: *"gemma4:e4b-it-qat
proposes a grounding span (Python-direct ollama, tier2_discourse pattern)... Independent grade:
~15 own-construction adversarial inputs + 2-path span-map re-derivation."* I found no later
commit, ruling, or CLAUDE.md passage superseding that with an Opus-based locator. The one place
"Opus" DOES appear in this campaign's history is the sVkm certification's TIER-3 ADJUDICATION
step (`docs/replay-results/svkm-extraction-certified/grade/opus-v2/`) -- a DIFFERENT stage
(judging role/support after a quote is already anchored), not the anchor-location step itself.

I presented this measured finding to the operator with three options (keep gemma4/Ollama since
the num_ctx bug explains today's flakiness; switch the locator to Opus as a real architecture
change; or he was thinking of the sVkm adjudication step). **The operator's answer was: "Report
to gpt about this"** -- so I am relaying the open question rather than deciding it myself. This
is exactly the kind of standing-architecture question ratify-packet reserves for explicit
authorization before an instrument's MODEL CHOICE (not just a parameter) changes.

**My recommendation, for what it's worth:** the measured evidence today (5/5 crashes, a
9-unanchored finding that flips to 0-unanchored) is fully explained by the missing-`num_ctx` bug
and does not, by itself, indict the choice of gemma4/Ollama as the locator model -- the SAME bug
would have caused identical symptoms regardless of which model sat behind that HTTP call. But I
have not verified there is no SEPARATE, real reason (cost, reliability beyond this one bug,
recent operator/GPT conversation I lack visibility into) to move the locator to Opus, and I am
not deciding that here.

## STATE

Holding the 40-video upgrade-factory pipeline here -- no further `finalize`/dispatch calls --
until: (1) the independent grader's full verdict on the `num_ctx` fix lands, and (2) GPT rules on
the locator-model question. The already-committed transcripts and raw extractions for all 39
videos (pilot 3 + 36) remain valid regardless of this question (extraction itself does not go
through `anchor_locator.py`); only the CERTIFICATION-stage (anchor + tier-1/tier-3) results are
in question, and only for transcripts long enough to have been affected.

STOP   : yes -- awaiting grader verdict + GPT ruling on the locator-model question before
         resuming.
NEXT   : once both land, re-run certification prep for every video whose transcript exceeds
         ~4096 tokens under whichever locator config GPT authorizes, before trusting any further
         `unanchored` count.

## FOLLOW-UP: INDEPENDENT GRADER'S FULL VERDICT (landed 2026-08-19, agent `a7eff24beeef6d679`)

Per this report's own promise above and worker-onboarding S3's durable-grader-report rule: full
verdict, verbatim, not summarized-only.

**VERDICT: PASS (BOUNDED), band 8** for the `num_ctx` fix itself (`anchor_locator.py` blob
`af71f710ee15c18b9beaea506eca3db278bd550b`) -- the fix claim (diff scope, E8Wg6tFPYjo 9->0,
N7uP9V0Iktc crash causation, `32768` legitimacy) is CONFIRMED via 2+ non-overlapping paths each,
including a runtime witness (`/api/ps` `context_length` flipping 4096 <-> 32768 under a
seam-injected control). Band 8 not 9: independent re-scan done, but real open HIGH items remain
(below).

**AR-1344A Step C "long-input capacity proof" is graded band 3, UNVERIFIED -- FALSE GREEN.** The
grader ran `scripts/_ar1344a_step_c_capacity_proof.py` itself: all 3 attempts located the witness
quote at char 13269-13523, INSIDE the old ~16,384-char window the proof exists to test past (the
witness was pinned at char 30714). The script's only check is "is this string a literal span",
never "is it AT the witness offset", so it prints `all_located_and_verified: true` regardless of
where the match lands. **Long-input capacity beyond ~16K chars remains UNPROVEN**, contrary to
this report's earlier claim (`## THE FIX` section above, capacity proof reference). Commit
`547742e9` additionally claims "4/5 real calls" while the committed script runs 3 -- a second,
smaller discrepancy in the same artifact.

**NOVEL findings, beyond the graded claim (found by the grader's own hunting, not asked for):**

- **N-1 (HIGH):** the identical missing-`options.num_ctx` defect is live in ~10 other production
  call sites, most notably `src/engine/extraction/tier2_discourse.py:453` -- the EXACT file
  `anchor_locator.py`'s own docstring names as its template -- and
  `src/server/services/model-router.ts:1939`, which passes `options` as literal `undefined` for
  the `transcript_extractor` role (full transcript, higher exposure than anchor_locator's
  quote+8-rules payload). Also: `pattern-aggregator-service.ts`, `nightly-critique-service.ts`,
  `prompt-evolution-service.ts`, `trade-critique-service.ts`, `carter-research.ts`,
  `critic-optimizer-service.ts`, `agent-service.ts` (x3), `parameter_evolver.py`.
  `OllamaClient.embed()` has no `options` parameter at all.
- **N-2 (HIGH):** the pre-fix blast radius this report retracted was too narrow. Measured: 23 of
  25 cached preps were generated before the fix; 15 have transcripts over 16,384 chars, carrying
  **47 unanchored verdicts across 11 videos** -- qLtq73bTPBA 9/15, dHmOosYof48 8/14, oDLt9zh33LE
  6/15, lRMFcsqhYBU 5/16, FAKWJ-1NlLE 5/13, m-G1ag77aVc 4/16, nV9gknhy2Ew 3/16, aHLIE_TXjpo 3/11,
  dE4lPhAWke8 2/19, N7SM8a7Dc9s 1/15, KXWRtV2LOVc 1/15. All 11 are suspect (by the E8Wg6tFPYjo
  9->0 precedent) and need regeneration before any disposition on them is trusted. (4 other exposed
  preps showed 0 unanchored already -- exposure does not automatically mean corruption, but these
  11 are unresolved.)
- **N-3 (MEDIUM):** `32768` is hardcoded in `anchor_locator.py` with no env override reaching it
  (unlike `pilot_conveyor.py`, which does read env), against a documented OOM band --
  `transcript-chunker.ts` exists specifically to avoid a `GGML_ASSERT` OOM at exactly 32768 ctx on
  an RTX 5060 8GB for 24K-37K-char transcripts. 12 of 40 corpus transcripts sit in/above that band,
  including `gddYspvW0_w` (24,720 chars, a previously known-failing fixture). The grader's own 3
  sequential 32768-ctx calls on a 76,723-char transcript did NOT OOM, but 16 sequential calls per
  video across the long tail remains untested.
- **N-4 (closed during the grade):** at the original pin the changed line had zero test coverage;
  `test_anchor_locator.py`'s two new tests (already committed, both passing) closed this gap
  during the grade window.
- **N-5 (MEDIUM, process):** `proposed_quote_not_literal_substring` is NOT diagnostic of
  truncation specifically -- it fires for any non-literal proposal, including on
  N7uP9V0Iktc post-fix (a transcript that fits in 4096 tokens). Treat it only as "not a literal
  substring", never as truncation evidence on its own.
- **N-6 (MEDIUM, process hygiene):** a concurrent `auto-wip` safety commit and a separate
  concurrent process rewrote `E8Wg6tFPYjo__s0.pkl` while the grader's controls ran on the same
  Ollama instance. Verified confound-free for the RED/GREEN discrimination itself, but
  artifact-level attribution during concurrent runs is unreliable -- a process-hygiene note, not a
  defect in the fix.

**What the grader explicitly did NOT verify** (stated in its own coverage section, carried here
verbatim rather than dropped): the truncation MECHANISM (only the effect, not `prompt_eval_count`
or which end Ollama drops); whether 32768 lets the model ground beyond ~16,384 chars (Step C fails
to show this); OOM behavior on the 12 in-band transcripts under realistic sequential-call load;
whether the 11 N-2 videos are actually corrupted (only E8Wg6tFPYjo is a proven case, the other 11
are exposure, not proof); N7uP9V0Iktc's original "5/5" pre-fix crash count (reproduced 1/1, not
5/5); the ~10 sibling call sites' live runtime impact (read statically, never executed); any
live-capital or broker-path surface (none touched).

## RELATION TO AR-1345A (locator authority correction, landed same window)

AR-1345A subsequently ruled Opus, not Gemma, is the authorized load-bearing locator (recovering
AR-1234). Per AR-1345A this `num_ctx` fix is downgraded from "the certification-resume path" to a
**defensive fix for non-load-bearing Gemma utility paths** -- it stays committed and independently
graded (band 8, correctly scoped and real) but does not itself authorize resuming certification.

**N-2's 11-video list is folded into AR-1345A's step-12 regeneration obligation as-is**: every one
of those 11 videos was Gemma-path-generated during the authority-regression window regardless of
its `num_ctx` exposure status, so all 11 require full-unit regeneration under the newly-authorized
Opus batch locator path (`batch_locator.py` + `opus_phase1_route.py`, AR-1234 LANE O1) -- not a
Gemma rerun with the num_ctx fix applied. This closes the "await grader verdict" STOP condition
above; the remaining STOP condition (GPT ruling on locator-model authority) is already satisfied by
AR-1345A. Resuming the Opus-path recovery now.

**Carried forward, NOT closed by this note** (F-1, N-1, N-3 are real open findings independent of
the locator-authority question and must not be silently dropped per CLAUDE.md §11c zero
carry-forwards): F-1 (fix the false-green Step C assertion or retire the script) and N-1 (patch the
~10 sibling call sites, at minimum `tier2_discourse.py:453` and `model-router.ts:1939`) are
Gemma/Ollama-transport defects independent of which model is the load-bearing locator -- Gemma
remains in active use for non-load-bearing paths (tier2_discourse, other services), so these are
real production defects, not moot. Filing as immediate follow-on work this same session once the
Opus recovery driver is running, per the zero-carry-forward rule -- named owner: worker-1, same
session, not parked.
