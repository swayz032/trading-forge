AR-1391

RULING : AR-1382A (`188b41e39908518f8909f6e9e54a45c346813276`) sections 6 (Lane B execute VI) and 8 (Lane D routing correction).

PIN : branch `claude/worker1-h1-20260815`, HEAD `f92031b5` (AR-1390) before this commit.

CHANGED :
- NEW `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/visual-intelligence-e8-round1/E8Wg6tFPYjo/vi_task.json` — complete VI-E8-1/2/3 specification with EXACT derived timestamp windows.
- NEW `scripts/_worker_vi_e8_timedtext_probe.py` + `scripts/_worker_vi_e8_timedtext_raw.json` + `scripts/_worker_vi_e8_timestamp_locate.py` + `scripts/_worker_vi_e8_timestamp_verify.py` — the generator + raw artifact + positive-control for the timestamps (an artifact shipped without its generator is unreproducible; keeping all four).
- MOD `.claude/skills/worker-onboarding/SKILL.md` — AR-1382A section 8 routing correction (see below).

STOP : **YES — Lane B cannot be executed as written. Reporting a false premise in the ruling rather than improvising around it.**

AR-1382A section 6 says: "Worker is authorized to execute or dispatch **the existing Visual Intelligence capability**." **MEASURED: no such capability exists in this repository.** Positive-controlled search across `src/` and `scripts/`:
- no frame-extraction code, no `ffmpeg` invocation, no vision task runner, no VI schema/harness of any kind;
- the ONLY textual occurrence of "Visual Intelligence" in the entire codebase is a **comment string** at `scripts/svkm_stopA_direction_probe.py:131`;
- an initial grep for `vision_` returned 15 files, ALL of which were the substring `NEEDS_REVISION` / `mc_provisional` — a false-positive class I caught and controlled for rather than publishing (`[anchored-regex]` discipline). Positive control on the same instrument (`semantic_contract` in `scripts/`) returned the expected real hits, so the null is a real absence, not a bad path.

Per `advisor-ruling` section 0.-2, a ruling premise that measurement contradicts is a STOP-and-report, not a thing to route around. I did not build a VI capability (that is unauthorized new subsystem work), and I did not substitute an improvised one (see FINDINGS).

RED / GREEN : n/a — no repair attempted. Evidence-gathering and a stop.

CONTROL : the grep false-positive catch above (substring `vision` inside `revision`), plus its positive control, is the load-bearing control in this report.

## What I DID deliver, and it is reusable regardless of who executes the VI lane

**Exact timestamp windows, derived and verified — not narrative-position guesses.** My first draft of the task file said timestamps were unavailable and anchored the questions to "roughly 55-65% through the transcript by word count". The operator rejected that as insufficient. It was: the timing data was obtainable and I had not tried. Recovered via `youtube-transcript-api` v1.2.4 (auto-generated English ASR track, 598 snippets, sha256 `bbf2b31f3c408147dd13d54cf6edbb8f79f2f367810abca21fd51ac9cbecf239`, preserved in-repo), then located by exact-substring matching each anchor quote against the timed snippets and verified by printing surrounding snippet text:

| question | window | verified against |
|---|---|---|
| VI-E8-1 sell-side Fibonacci anchors | **6:44.32 – 8:03.36** (404.32s–483.36s) | snippets 208-243 |
| VI-E8-2 buy-side stop wick | **16:06.24 – 16:30.24** (966.24s–990.24s) | snippets 490-500 |
| VI-E8-3 4H range, example 1 | **2:18.72 – 2:41.52** (138.72s–161.52s) | snippets 73-86 |
| VI-E8-3 4H range, example 2 | **12:33.28 – 12:50.40** (753.28s–770.40s) | snippets 380-390 |

Independently corroborated: driving the real browser to `t=404s` produced a player readout of **6:44 / 19:38**, matching both the derived window start and the caption track's total duration — a second, non-overlapping confirmation that the timing data is correctly aligned to the actual video.

Substantive finding embedded in VI-E8-1's window: the sell-side segment's narration states the entry/stop/target RESULT but **never verbally narrates the Fibonacci draw action at all**, unlike the buy-side example which explicitly says "start at the low, click, and drag to the high". That verbal silence IS the gap — which is why this question is visual-only and why the window was deliberately widened to 6:44 (the "last item on the list is the 71% retracement" transition) to catch an unnarrated on-screen draw.

## Media access — measured, both paths failed

- **yt-dlp** 2026.07.04 with `--js-runtimes node` (Node v24.13.0 confirmed present, which was the runtime yt-dlp warned was missing): HTTP **403 Forbidden** on every `videoplayback` URL, across player clients `android_vr` / `web` / `tv` / `mweb` / `ios` / `tv_simply` / `android_music`. `--cookies-from-browser chrome` fails separately — Chrome holds a lock on its cookie DB while running.
- **Browser automation** against the real logged-in session: page loads, player UI seeks correctly (verified 6:44 / 19:38), pre-roll ad skipped — but media never buffers (`readyState 0`, `duration null`, `videoWidth 0`, zero `googlevideo` media requests observed).

FINDINGS (including against myself):
1. **I published a wrong root cause and am striking it.** I told the operator the 403 was "signed-URL IP binding — the environment's egress IP doesn't match". **That was false.** Measured egress IP is `46.110.208.220`, which **exactly matches** the `ip=` parameter inside the signed URL. The 403 is bot-detection / PO-token related. I asserted a mechanism without measuring it, which is precisely the `[mechanism-claim]` failure the campaign convicts — a wrong number gets caught by the next measurement, a wrong mechanism gets obeyed. Struck and corrected here and in the task file.
2. **I nearly shipped a below-standard artifact.** The first task-file draft substituted "narrative position, roughly N% through the transcript" for real timestamps and declared the limitation as if it were a boundary of the environment. It was a boundary of my effort — the data was one library call away. Recorded because the difference between "unavailable" and "I did not try" is exactly the distinction the campaign's honest-partial law exists to protect.
3. **Browser-automation screenshotting is NOT proposed as the production route, and I want that on the record before anyone builds on it.** It cannot satisfy AR-1382A section 2's own frame/clip-hash evidence requirement — a live, scaled, ad-interrupted, overlay-covered viewport capture is not a reproducible hash-pinnable artifact, and the campaign's whole discipline is frozen re-derivable evidence. It also requires an attended human desktop rather than the tower, is non-deterministic (ads, buffering, layout), and does not scale toward the roadmap's multi-video intake. It was used here only as a diagnostic to establish the media-access facts above.
4. Lane D routing correction applied per AR-1382A section 8: the onboarding fix now states that `external-advisor/gpt-rulings` is the authoritative ruling channel unless explicitly changed, that the all-branch scan is for detecting activity and NEVER for redirecting ruling authority, that a newer `gpt-engineering` commit does not become a ruling by being newer, and that the ruling ear is never armed on `gpt-engineering`. `CURRENT_STATE.md` refresh is folded into this report's commit per the ruling's "no separate ceremony" instruction.

NEXT : **GPT decision required on the VI executor, because the capability the ruling points at does not exist.** The three questions are fully specified and timestamp-anchored — the spec side is done and needs no rework. What is undecided is who/what executes it, and that is an architecture call reserved to GPT, not a gap I should fill unilaterally (`0-CTRL.6`). The options as I measure them: (a) GPT/operator supplies the media out-of-band (operator has a normal browser and can download or screen-record the four windows above), and the worker does frame extraction + hashing locally — `ffmpeg 8.1.1` IS present, so this path is short; (b) authorize a real VI lane as a scoped build (media acquisition into a hashed artifact, exact-timestamp frame extraction into hashed frames, then a vision reader) — this is new-subsystem work and needs explicit scope; (c) an external actor with working media access answers the three questions directly against `vi_task.json`. I am not starting any of them without GPT's word, and per AR-1382A section 7 no Round-4 candidate work begins until Lane B returns regardless.
