AR-1393

RULING : AR-1383A (`7d7fe29732e9b35dd68eb575fbdc109d363ff3bc`, 2026-08-21) sections 5, 6, 7, 8 and 9
— issue the AR-1392 correction packet, then the honest E8 source-completeness refusal. Received live
via the armed `gpt-rulings` ear mid-session (`188b41e3 -> 7d7fe297`), not by a cold re-read.

PIN : branch `claude/worker1-h1-20260815`, HEAD `4fc0f6f5` before this commit — the exact head
AR-1383A inspected.

CHANGED :
- MOD `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/visual-intelligence-e8-round1/E8Wg6tFPYjo/vi_findings.md`
  — correction banner; false finding struck in place and retained; corrected derivation section;
  artifact-integrity/reproducibility section.
- MOD `.../E8Wg6tFPYjo/vi_task.json` — struck buy-target finding retained; the action-frame law
  recorded; the stale active media-access blocker replaced by a struck historical record plus the
  current successful acquisition status.
- MOD `scripts/_worker_vi_e8_calibrate.py` — annotated in place as superseded for the buy-side
  target; numbers unchanged (strike-and-retain).
- NEW `.../E8Wg6tFPYjo/artifact-manifest.sha256` — all **32** committed artifacts.
- NEW `.../E8Wg6tFPYjo/frames/scan_legend_5s.png` + 5 magnifications (the pre/during/post triplet).
- NEW `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/E8-SOURCE-COMPLETENESS-REFUSAL.md`.
- NEW `scripts/_worker_vi_e8_final_frame_proof.py`, `_worker_vi_e8_contact_sheet.py`,
  `_worker_vi_e8_hash_manifest.py`, `_worker_vi_e8_manifest_redproof.py`,
  `_worker_vi_e8_measure_final.py`.
- MOD `docs/replay-results/CURRENT_STATE.md` — names AR-1383A, the new lane state, the new locks.

---

## THE CORRECTION — GPT IS RIGHT AND THE FINDING IS STRUCK

AR-1392's buy-side target `SOURCE_CONFLICT` is **false**. I re-derived it from the final stable
post-action frame and it closes exactly on the narrated rule.

RED (what AR-1392 published, from `vi2_00-16-21.png`, mid-drag):
```
fib 0 ("high of the Fibonacci range")  = 0.56073
target position at that instant        = 0.56020
difference                             = 0.00053   -> reported as SOURCE_CONFLICT
```

GREEN (`vi2_00-16-28.png`, sha256 `16bcf948748143064bbbd467054a1a7fc2dc6b05a753bb9de1c477909bfa7d8b`;
`python scripts/_worker_vi_e8_final_frame_proof.py`):
```
CLOSURE 1  entry + printed target distance = 0.55827 + 0.00071 + 0.00175 = 0.56073
           target line's own price-axis label                            = 0.56073   delta 0.00000
CLOSURE 2  0.00175 / 0.00071 = 2.4648 -> 2.46          position tool printed  2.46
CLOSURE 3  fib range 0.00246; 0.71 from fib 0 downward = 0.55898   entry 0.55898   delta 0.00000
CLOSURE 4  target-line axis row y=363.5; fib `0` row y=364 -> the same row
```

**The corrected derivation uses no pixel→price interpolation at all.** Every input is a value
TradingView itself rendered — a position-tool label or a price-axis label — and the four closures
cross-check those printed values against each other. That is a stronger instrument than the one
that produced the error, not a re-run of it.

CONTROL — media validation, three independent acquisitions:
```
python -m yt_dlp -f 137 -o "hi.%(ext)s" "https://www.youtube.com/watch?v=E8Wg6tFPYjo"
  sha256 06af188d3a226ca05ba9000097ec7a603ca6ca36563ed12926bf62a0da3e2841   MATCHES AR-1392
  35570757 bytes, 1177.60 s, 1920x1080                                      MATCHES AR-1392
```
Downloaded twice under AR-1392 and once again here — byte-identical every time.
`_worker_vi_e8_contact_sheet.py` validates type, size, duration and sha256 and **refuses** on any
mismatch, so no downstream measurement can be taken against unvalidated media.

CONTROL — the hash manifest is red-proofed, both arms
(`python scripts/_worker_vi_e8_manifest_redproof.py`):
```
POSITIVE  unmutated manifest         exit 0, 32 artifacts OK
NEGATIVE  one hex digit flipped      exit 1, frames/vi2_00-16-28.png: FAILED
BOTH ARMS DISCRIMINATE.
```

CONTROL — the magnification generator is deterministic: run, hash, re-run, re-hash → byte-identical
(`f85d22d3…` / `9f52aade…` unchanged across runs).

---

## ROOT CAUSE — STATED AS MECHANISM, NOT AS APOLOGY

Three things converged. Each is now a control rather than a lesson.

1. **A semantic conclusion was bound to a mid-action frame.** `vi2_00-16-24.png` — *already
   committed, already in the same directory* — shows the cursor **visibly gripping the target
   handle**. The evidence that the action was still in progress was in hand and was not consulted.
2. **At that frame's target row the price axis is occluded by the webcam overlay**, so the
   interpolated reading had **no TradingView-rendered label to check itself against**. Every other
   level in the packet had one. **That asymmetry was the tell.** A reading that is uniquely unable
   to be cross-checked is the one that most needs a second frame, and it got the least scrutiny.
3. **The instrument was sound, which is why the wrong answer was confident.** The fib anchors read
   off the mid-drag frame (0.56073 / 0.55826) agree with the final frame's rendered axis labels
   (0.56073 / 0.55827) to 1e-5. **Calibration was never the defect — frame selection was.** A
   correct instrument pointed at the wrong instant produces a precise falsehood, and precision reads
   as reliability.

Permanent control adopted (AR-1383A section 6), now written into `vi_task.json` as
`action_frame_law`: for any drag, click, resize or drawing action, capture **BEFORE → DURING →
AFTER-DROP → LAST STABLE** and bind the semantic answer **only** to the last stable post-action
frame. An intermediate frame is evidence that the action occurred; it may never control the
conclusion about the action's *result*. The committed triplet for this action is
`zoom_vi2_pre_16-21_target.png` / `zoom_vi2_during_16-24_drag.png` / `zoom_vi2_post_16-28_target.png`.

---

## PACKET ITEMS — AR-1383A SECTION 7, ALL SEVEN

| # | Required | Done |
|---|---|---|
| 1 | Strike the false buy-target `SOURCE_CONFLICT` | Struck in `vi_findings.md` (in place, retained), `vi_task.json`, and `_worker_vi_e8_calibrate.py`. AR-1392 itself not rewritten. |
| 2 | Record `vi2_00-16-21.png` as a temporary pre-final state | Recorded in all three, plus the committed pre/during/post triplet. |
| 3 | Recalibrate the final target from `vi2_00-16-28.png` | `_worker_vi_e8_final_frame_proof.py`, four closures, all exact. |
| 4 | Update `_worker_vi_e8_calibrate.py` so its semantic result uses the final stable frame | Annotated in place and pointed at the authoritative script; numbers retained unedited. |
| 5 | Replace the stale media-access-blocker field with a struck historical blocker + current status | `media_acquisition_status` with the full struck record; both historical paths marked STRUCK. |
| 6 | SHA-256 for all committed visual artifacts, or correct the claim | `artifact-manifest.sha256`, **32 artifacts** (the 26 + 6 added here), `sha256sum -c` verifies, red-proofed. |
| 7 | Commit the deterministic contact-sheet generation manifest, or lower the claim | Took the **stronger** branch: `_worker_vi_e8_contact_sheet.py` regenerates the scan from validated media. AR-1392's two sheets are retained but marked **SUPERSEDED** — their parameters were never committed and cannot be audited. |

**Item 7 note, since it changes an artifact rather than adding one:** the new
`scan_legend_5s.png` crops the chart legend line, which carries the symbol **and** the active
timeframe in one string — so the absence claim and its positive control now live in the same
artifact instead of two. **236 samples at 5 s across the full 1177.60 s; every tile reads `· 15 ·`;
the GBP/AUD → NZD/USD change is plainly visible at ~12:20.** VI-E8-3's conclusion is unchanged and
now independently re-derived by committed code.

---

## E8 SOURCE-COMPLETENESS REFUSAL — ISSUED

`docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/E8-SOURCE-COMPLETENESS-REFUSAL.md`

- **Sole remaining blocker: `VI-E8-3` — exact 4H premium/discount trading-range construction**
  (`COMPILE_BLOCKER_SOURCE_MISSING`). Not present in the transcript and not present in the pixels;
  the educator delegates it to a closed-source indicator that only ever renders a categorical badge.
- **Both accepted visual facts preserved for reuse**, with the unified direction-aware rule they
  establish: **stop = fib `1`, entry = `0.71`, target = fib `0`** — closing on both worked examples.
- **VI-E8-2's stated residual carried, not buried:** agreement is at ~1-pip calibration precision;
  a sub-pip hand-placement offset is **not** claimed absent. AR-1383A section 3's caution honoured.
- Section 4 of the refusal scopes what it is **not** saying, so the headline is not read wider than
  the body supports.

---

FINDINGS :

- **Against myself, and it is the same class twice in three reports.** AR-1391 published a null
  without a positive control on the surface searched; AR-1392 published a semantic conclusion
  without checking the frame was final. **Both are "I did not verify the boundary of my own
  observation."** The first was caught by the operator, the second by GPT. Neither was caught by me,
  and that is the fact worth carrying: my self-checks are catching arithmetic, not framing.
- **HIGH B narrows.** With the conflict struck, AR-1380A HIGH B reduces to exactly what AR-1383A
  section 3 says it is — the invented cross-direction `priority:1`/`priority:2` ranking. The two
  worked-example targets are parallel **direction-scoped** exits from one consistent taught rule.
  AR-1392's claim that they were "not generated by one consistent stated rule" is **withdrawn**.
- **VI-E8-1 and VI-E8-2 are unaffected** by this correction. Both were derived from stable frames
  with no action in progress, and VI-E8-1 additionally carries a *discriminating* control (the
  opposite orientation predicts y≈655; observed y=455 — refuted, not merely disfavoured).
- **An instrument false positive, disclosed rather than tuned away.** The naive axis-highlight
  detector in `_worker_vi_e8_measure_final.py` also matches the **webcam picture-in-picture overlay**
  and reports a spurious "label" at y≈445 on both frames. The scan is now bounded to chart rows
  above the overlay, and the false positive is documented in the function's own docstring instead of
  being silently narrowed.
- **Scope fact, `[MEASURED 2026-08-21]`, surfaced not routed around:** AR-1383A section 8 item 5
  says "move to the next calibration source" — **no ordered calibration-source queue exists in this
  repository.** The phrase occurs in exactly three places (`CURRENT_STATE.md`, AR-1382A section 7,
  AR-1383A section 8) and in all three it is a procedural rule, never a pointer to a named successor.
  Searched: `docs/replay-results/` incl. `gpt-engineering/`, `worker-advisor-reports/`,
  `strategy-factory-census/`; `ADVISOR-RULINGS.md`; `ADVISOR-STATE.md`; `.claude/skills/`; and the
  JSON manifests `library-manifest-v1.1.json`, `raw-snapshot-v1.1.json`,
  `pilot-c-full-run-2026-08-19.json`, `source-videos-2026-07-02.json`. Terms: "calibration source /
  video / set", "next source", "source queue", "candidate source", "golden source", "tier-A",
  `E8Wg6tFPYjo`, `sVkmZklJDHI`. The census manifests are **flat inventories with no priority or
  ordering field**; the only comparable certified source is `sVkmZklJDHI`, but no document states a
  sequence. **Selecting the successor is a money-path priority decision reserved to GPT**
  (`worker-onboarding` 0-CTRL.6), so it is named as open rather than resolved by worker inference.
  The search is stated so it is not mistaken for an unstated one.
- **Media hygiene:** `hi.mp4` (34 MB) was re-acquired for the verification and then **removed, not
  committed**. `.gitignore` remains outside this packet's `edit_scope`, so no durable ignore rule was
  added — flagged again rather than self-widening scope.
- **Peer handshake NOT performed.** `worker-onboarding` section 2b requires a
  `WORKER_SESSION_START_HELLO`/`ACK` exchange before engineering. The operator stated in-session that
  **worker-2 is closed** and directed this seat to continue without it. Recorded because
  `messaging_startup_verified` is a gate and an unperformed gate is a disclosure, not an omission.

STOP : none fired. No Round-4 authoring started; no compiler/certifier promotion; no backtest; no
new auditor machinery (the four new scripts are the *existing* targeted-visual workflow's controls,
which AR-1383A section 9 explicitly requires be repaired **inside** that workflow); locks in
AR-1383A section 10 all observed.

GRADER : not dispatched. AR-1383A requires no grade, and its own section 1 records that GPT already
independently checked the frames, the scan, the captions, the hashes and the scripts. The corrective
claim here is arithmetic on values TradingView rendered, reproducible by one command.

NEXT : GPT's decision on **which calibration source succeeds E8** — the one thing AR-1383A section 8
directs that this repository cannot currently name, per the measured absence above. The correction
packet and the refusal are both complete and durable on this branch.
