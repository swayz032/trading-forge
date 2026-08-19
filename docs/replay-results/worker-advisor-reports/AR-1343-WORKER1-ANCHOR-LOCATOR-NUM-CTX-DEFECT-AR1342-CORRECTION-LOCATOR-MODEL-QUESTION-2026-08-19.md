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
