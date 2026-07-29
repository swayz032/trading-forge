# `C8` PROMPT CHANGE — STAGED 5-PART PACKET (proposal, NOT implemented)

**R-428 item (3) / R-427 item (3) · 2026-07-29 · the prompt is an INSTRUMENT → this packet is the
receipt an INDEPENDENT GRADER rules on. Staged and HELD; no file edited.**

> **Classification.** Not the irreversible / live-capital class — **[MEASURED] `backtests total = 0`,
> nothing live-trading, no frozen ref re-baselined by this edit** (it changes FUTURE extractions
> only; existing artifacts are immutable). Under the 2026-07-11 amendment that makes it the
> autonomous class: **stage packet → implement via scope-locked implementer → fresh-context
> independent grader.** ★ **I am nonetheless HOLDING implementation, because R-427/R-428 scoped my
> task to "proposal only" — the ruling is narrower than the standing amendment, and the narrower
> instruction governs.**

---

## 1 — WHAT & WHY NOW (receipts, not narrative)

**The defect: the extractor's own instructions order the largest blocking class in the library.**

**[MEASURED, `POP-120-LIVE`, per-video basis, 40 videos, deployed lane `wt-preflight-blockers-20260729`
@ `83efd34e` — sha256-identical to `runtime-production` @ `a6f92822`]**
`C8` (non-executable annotation mis-typed as a condition) = **233 of 456 refusals — 51.1%**, spanning
**37 of 40 videos**, and it is **the ONLY remediation class that unlocks any strategy on its own**
(6 strategies; the other eight classes unlock 0 alone).

**The three producer lines, quoted verbatim from `src/agents/transcript-extractor.md`:**

| line | text | what it produces |
|---|---|---|
| `:169` | *"The 2026 institutional standard is **≥3 factors per strategy**. Videos that describe fewer than 3 are usually mis-extractions of richer setups — **re-scan before accepting a 1-or-2-factor extraction**."* | a floor on a count the extractor itself controls, with a retry loop until the floor is met |
| `:171` | *"**Bias toward INCLUSION when in doubt.** The operator can prune later via re-extract."* | an explicit false-positive-cheap policy |
| `:616` | *"The chain **"wait for 4H FVG → drop to 15M for setup → enter on 1M IFVG close" IS confluence: emit each step as a confirming indicator**."* | chart NAVIGATION emitted as a trading condition |

**The exhibits — now resolved to the teacher's verbatim words** (pointer chain proven sound:
**[MEASURED, AR-397] 1458 of 1458 pointers resolve, 100.0%**; span byte-exact on 1218 of 1238):

| emitted condition | `role` | what the speaker actually said |
|---|---|---|
| `'timeframe'` | confluence | *"This strategy performs best on the 15minut, 1 hour, and 4hour charts."* |
| `'time frame'` | confluence | *"Okay. And this is going to be done on low time frame."* |
| `'timeframe selection'` | **spine** | *"And all you're really going to be doing is you're going to be using one of these three time frames, that 1-hour, 30-minute, or 15-minute."* |
| `'time frame'` | **spine** | `{"description": "Switch to 15-minute time frame"}` |

★★★ **Every one is the speaker naming which CHART to use — a strategy parameter the backtester
already receives explicitly — and every one became an entry condition. Two are `role=spine`, the
class the execution preflight treats as MANDATORY.**

★★ **Why it is a defect and not a preference:** a quota on a self-controlled count is
**optimizing the proxy and destroying the purpose** — the desk's own convicted law, currently
written into an instrument as policy.

---

## 2 — BLAST RADIUS

- **Future extractions only.** Existing `compiled_spec` artifacts are immutable and carry
  `spec_hash`; this edit cannot retroactively alter them. **No frozen ref is re-baselined.**
- **Any old-vs-new corpus comparison becomes cross-version** and must be labelled as such — a
  condition-count delta after this change is a PROMPT delta, not a corpus quality delta. ★★ **This is
  the trap to pre-empt: a drop in conditions-per-strategy will look like extraction getting worse.**
- **`confluence_factors` / `confirming_indicators` counts fall by construction.** Any gate, score or
  report keyed on "≥3 factors" inherits the change — **[UNENUMERATED] I have not enumerated those
  consumers, and that enumeration is a REQUIRED pre-implementation step, not an optional one.**
- **The pinned Phase-1 figures are untouched** (`0/16 fully bound`, flags-off `0 of 155`) — they are
  computed over corpus_A artifacts that already exist.
- **No engine, binder, preflight or spec file changes.** Refusal classes are untouched.

---

## 3 — THE EXACT CHANGE, SCOPE-LOCKED

**IN SCOPE — `src/agents/transcript-extractor.md`, three edits:**

**(P1) `:169` — remove the quota and its retry loop.** Replace the `≥3 factors` floor and
*"re-scan before accepting a 1-or-2-factor extraction"* with: *"Emit exactly the factors the speaker
states. A 1-factor strategy is a valid extraction. Do not re-scan to reach a count."*

**(P2) `:171` — remove the inclusion bias.** Replace *"Bias toward INCLUSION when in doubt"* with:
*"When in doubt whether something is a trading condition or the speaker narrating his screen, it is
narration. Emit it to `annotations[]`, never to `entry_conditions`."*

**(P3) `:616` — split navigation from condition.** Amend the chain rule so *"drop to 15M for setup"*
sets the **execution timeframe field**, and only the market-state steps (`4H FVG`, `1M IFVG close`)
become conditions. Add explicitly: *chart resolution, instrument/symbol selection, and platform
workflow are NEVER `entry_conditions`.*

**(P4) a non-executable `annotations[]` array** so suppressed material is **emitted, never dropped** —
the record still shows what the teacher said.

**EXPLICITLY OUT OF SCOPE (and each would be a separate ruling):**
★★★ **any change to the `role` vocabulary or to `_MANDATORY_ROLES`** — R-427's stop condition bars
relaxing a refusal class before a type-keyed replacement is built and graded, and **AR-393's finding
that `spine` means "narrative backbone" is a correct premise with an unbuilt replacement, which is
exactly the configuration in which good desks ship regressions** · any binder/preflight/consumer-side
suppression of `C8` terms (would fabricate optionality) · any spec edit or re-typing · any
re-extraction run · the `confluence_factors` closed enum · framework-overlay fields.

---

## 4 — VERIFICATION PLAN (the ablation, now possible because the provenance chain resolves)

★★★ **The decisive test, which was impossible before AR-395/AR-397 and is cheap now:**

1. **Pre-register the metric** before running anything: `C8-rate` = fraction of emitted
   `entry_conditions` whose resolved source clause names only a chart resolution, instrument, or
   platform action. Classification by the published AR-391 classifier, doer ≠ grader.
2. **Arm A (control):** current prompt. **Arm B:** P1–P3. **Same N videos, same model, same seed
   discipline**, N ≥ 5 drawn from the 37 `C8`-bearing videos.
3. **Resolve every emitted condition to its transcript clause** via
   `clause-segmenter.ts:60 segmentTranscript` — **[MEASURED] 100% resolvable** — and diff `object`
   against the clause text.
4. **PASS:** Arm B's `C8-rate` falls materially **AND** ★★★ **the DISCRIMINATOR holds — the count of
   genuine market-state conditions does NOT fall.** Without that second arm the suite cannot tell
   "stopped emitting junk" from "stopped emitting."
5. **RED-PROOF AT BIRTH:** run the classifier against Arm A first and confirm it FIRES (it must
   reproduce ~51% `C8`). A classifier that reports clean on the known-bad arm is broken, not good news.
6. **Conservation check:** every clause that fed a removed condition must appear in `annotations[]`.
   ★★ **Nothing may be silently dropped — a suppressed annotation and a dropped taught rule must stay
   distinguishable in the record.**

★ **An extraction run is NOT authorized by this packet and is requested as part of it.**

---

## 5 — ROLLBACK

The prompt is a single tracked file: `git revert` restores it exactly. Artifacts produced under
either arm are immutable and carry `spec_hash`, so **arms are separable after the fact** — no
cleanup, no data migration. ★ **Recommended:** stamp the ablation's output specs with the prompt
revision so a later reader can tell which arm produced which artifact **without** relying on
timestamps.

---

## REQUIRED BEFORE IMPLEMENTATION

★★★ **(a) Enumerate every consumer keyed on the `≥3 factor` count** (§2's `[UNENUMERATED]`) — a floor
removed underneath a gate that still expects it is a regression waiting to happen.
★★ **(b) An independent grader, fresh context, doer ≠ grader** — mandatory and non-negotiable.
★ **(c) The advisor's word**, since R-427/R-428 scoped this to proposal-only.
