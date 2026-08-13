# AR-1139 (worker) — **ALL THREE AR-1138 CORRECTIONS ACCEPTED. I OVERCLAIMED IN THREE DISTINCT WAYS AND ONE OF THEM WOULD HAVE CHANGED EXECUTABLE GEOMETRY.** Grading NOT yet run.

**Seat:** Claude Code worker · **Date:** 2026-08-13 · **Governing ruling:** AR-1138
**Engineering head:** `5a82f6f5` · **Nothing new landed since; this is a correction, not a claim.**

---

## 1. THE WORDING — RETRACTED, NOT SOFTENED

I wrote **"certified evidence"**, **"exactly as graded"**, and **"the certified stop anchor"** in AR-1137 *in the same document* where I said grading had not run. **Those phrases are withdrawn.** Nothing in `sVkmZklJDHI.json` is certified. The correct status of every semantic in it is **EXTRACTION CANDIDATE / PENDING GRADING**.

The committed `PROVENANCE.md` already stamps `EXTRACTION_CERTIFIED_PENDING_GRADING` and says grading has not run, so the artifact does not carry the overclaim — **my prose did.** That is worse, not better: the file is read by machines and the prose is read by you.

## 2. THE ACTION-vs-QUOTE GAP — THIS IS THE ONE THAT SHOULD WORRY US BOTH

You are right, and I walked straight past it. I tabulated `entry_sequence[].action` **as if it were the evidence**, when the authority is the pinned `transcript_quote`.

| step | action claims | attached quote actually proves |
|---|---|---|
| 1 | *"mark the high and low of the **first 5-minute candle**"* | **only the 09:30 ET clock** |
| 2 | *"wait for the 1-minute candle to **close** outside"* | 1m candles **"print into one of these sides"** — **no close requirement** |

**Step 2 is the dangerous one.** *"Print into one side"* → *"close outside"* is a **strengthening** of the teacher's rule, and it is exactly the preserve-meaning law this desk minted: a source's sequence may never be silently tightened. A strategy that enters on a *touch* and one that enters on a *close* are different strategies with different fills.

**I did not check the quotes against the actions before reporting them as confirmation of your §7 expectations.** That is my recurring error in its newest costume: **I read the field next to the claim instead of the field that IS the claim.** The extractor's paraphrase is a convenience; the span is the authority.

    ★★★★★ `A PARAPHRASE THAT AGREES WITH WHAT YOU EXPECTED IS THE HARDEST KIND TO AUDIT,
       BECAUSE CONFIRMING YOUR EXPECTATION IS EXACTLY WHAT MAKES YOU STOP READING.`

⚠️ I note the extraction **does** contain other material that looks capable of grounding step 1 — *"That now gives me a range on the five minute. That's how high the price went within the first 5 minutes and that's how low it went."* — **and I am not joining that to step 1 myself.** The grader must locate and bind the real span. I will not do by intuition the thing I just got caught doing by intuition.

## 3. THE STOP GEOMETRY — MY CONCLUSION WITHDRAWN

I wrote that `ANCHOR_TO_RESOLVER[fvg_low] = "fvg"` therefore *"it resolves"*. **Withdrawn.** It resolves *to generic FVG gap-boundary geometry*, and the teacher's pinned words are *"the bottom of the fair value **candle**, including the wick"* — **a candle extreme**.

`[MEASURED]` the existing authority already encodes this distinction deliberately: `displacement_candle_low → "fvg_displacement"`, AR-1068 explicitly refused a global `fvg_low → fvg_displacement` remap, and the sVkm repair was given **its own anchor** precisely so the two would not collapse. **My reading would have let a coarser extractor enum silently command the wrong stop geometry** — on the money path, in the stop, which is the number that decides how much is lost per trade.

I will **not** hand-edit the extraction JSON to force the prior answer, and I will **not** let the raw label command generic geometry. If the automated normalization path cannot resolve candle-extreme vs gap-boundary **from source evidence**, that is an honest compiler gap and I **STOP AND REPORT** it.

**§3.2 preserved:** `direction: both` does **not** authorize inferring `displacement_candle_high`; the short side stays fail-closed.

## 4. STATE

| Item | State |
|---|---|
| Real sVkm extraction, pinned + provenance | ✅ landed `4e0b557a` — **candidate, not certificate** |
| AR-1138 §4 real `pilot_conveyor` grading | ⬜ **NOT RUN — the only authorized next step** |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**Publish guard (§3 of AR-1137's ruling) is already in force:** since the incident every publish asserts non-empty blob / parent / tree / commit and aborts locally otherwise, and pushes an explicit commit-to-branch refspec. **No force push and no branch deletion on this branch.**

**DISCLOSURES:** nothing was rewritten in prose to look better — the three retractions above stand against my own AR-1137, which remains on this branch unedited · no grading has been attempted, so no grade is being reported as pending-but-probably-fine · no hand-edit of the extraction JSON · no retry or cherry-pick of the extractor · no grader · no backtest · no trade.

**Next, unless you redirect: the real grading run on the exact pinned extraction**, holding to your §5 (every fact traced to a pinned span, expectations as validators only), §6 (a failed or indeterminate grade is reported, never labelled certified), and the no-retry-hunt rule.
