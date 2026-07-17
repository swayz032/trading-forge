# ADVISOR REPORT — H1 Claude rung v3.2 stop-point review

> **⚠ ANNOTATION (2026-07-17, later same day — see R-029 in `ADVISOR-RULINGS-full-R014-R032.md`):**
> Written before the AR/R file-relay record landed on this branch (commit `77ecc1e0`). The 2DX-s2
> residual analyzed below as an OPEN operator call was subsequently shown by that record to be
> ALREADY RULED — grader over-reach from source; normativity test minted as grader law with
> 2DX-s2 as its founding fixture; reader CERTIFIED as `h1-certified-reader-v3.2` @ `efa377d6`
> (standing state, rulings file). The analysis below is historical commentary on a CLOSED ruling
> and must not be read as reopening it — track-closure law governs. The operative thread is the
> sealed-12 terminal read (R-015 → R-028). Kept unedited below per house pattern (annotations,
> never silent rewrites).

**From:** Fable 5 (advisor seat — cloud session, branch `claude/agent-reports-review-ehn3ou`)
**To:** H1 extraction-campaign agent (Claude rung, `corpus-v3-gate3-cert-2026-07-06` line)
**Date:** 2026-07-17

**Reviewed set (provenance — cert branch @ `efa377d6` unless noted):**
`V32-RETEST-VERDICT.md`, `V32-DIAGNOSIS.md`, the v1 `JOINT-BAR-VERDICT.md`,
`PARALLEL-LANES-STATUS-2026-07-13.md`, `content_batch_v32_input.jsonl` (the 2DX-s2 record read
directly — transcript span, extraction, coverage_notes, grader-v2 contract), the Claude-rung
pre-registration + Amendment 1 (`h1-claude-rung-preregistration-2026-07-13.md`), the campaign
plan, the H2 pre-registration, the scoped mission doc, and `extraction-campaign-SKILL.md`.

**Housekeeping first:** `docs/agent reports/` did not exist on any pushed branch when I sat down
— if the frozen session had reports staged there, they never reached origin. This file
inaugurates `docs/agent-reports/` (see its README for the convention). The verdict docs above
were treated as the reports of record; nothing in this review depends on the lost session.

---

## 1. Verdict-quality assessment (what holds)

- **License discipline held.** The v3.2 retest ran inside its single licensed iteration, joint
  bar unmoved, sealed-12 untouched. Correct, and correctly recorded.
- **The grounding half's legitimate-fix signature is real and correctly argued.** Denominator
  GREW 238→250 while miss FELL 7.6%→4.40%: recovered Tier-A content grounds instead of
  silencing-by-shrinkage. That is the anti-goalpost direction check (Law 6) doing exactly its
  job, and the 0xyg 14/15→17/17 detail supports it.
- **Cross-vendor separation held where it bites.** The one surviving content flag came from the
  OpenAI grader on Claude's extraction — the pre-reg's correlated-priors defense working. The
  thing to protect now is that the doer's "leans grader over-reach" self-assessment does not
  become the ruling by momentum. The verdict marked it "surfaced-not-ruled," which is right;
  §2 is my independent read of the same evidence.
- **The budget overrun was disclosed the right way** — quantified (~$0.487 vs $0.25, ~$0.24
  over), cause identified (no mid-run hard-stop in the flex runner; estimate anchored to a
  cached lighter panel), and validity correctly separated from spend authorization. Process fix
  in §3.

## 2. The load-bearing residual (2DX-s2, spread-making) — independent evidence read

I pulled the actual grading record rather than relying on the verdict summary. What follows is
**advisory, not a ruling** — the ruling is the operator's stop-point, and per grading-integrity
the doer's lean, my lean, and the grader's flag are three inputs to it, not three votes.

### The evidence, sharpened both ways

**Strongest case that the grader's flag is defensible (a real Tier-A silencing):**

1. **The extraction promoted the ACTION half of the Facebook-IPO passage into Tier-A while
   stripping the same passage's WHEN.** `entry_sequence[1]` carries, verbatim, "immediately
   just slamming in huge bids… repeating it again and again before that spread compressed" —
   sourced from the trainer anecdote. The activating condition in the immediately preceding
   sentence — "when there was over a dollar spread and just absolutely incredible amounts of
   volume going off on both sides of the market" — was stripped as example-context. If the
   anecdote's mechanic is rule-content, its narrated activating condition arguably comes with
   it (qualitatively: *unusually wide spread + heavy two-sided volume*, with the "$1" number
   stripped as the example figure). Promoting the verb and dropping its when-clause is the
   asymmetry the grader is pointing at.
2. **The doer's cited coverage is base-strategy precondition text, and part of it describes the
   OPPOSITE regime.** "Scalping thrives on liquidity and volatility. You need both" is generic;
   "when a stock is in relative equilibrium, but thin" is the quiet-book regime of the BASE
   spread-capture mechanic — nearly the inverse of the variant's regime ("absolutely incredible
   amounts of volume going off on both sides"). So "the rule-level precondition IS captured" is
   fully true for the base mechanic, not obviously for the variant.

**Strongest case for over-reach (the doer's lean):**

1. **The passage is a third-person war story** ("my trainer… one of the most impressive trades
   I've ever seen"), past tense, one historic day. Under the v3.1 taught-as-a-setup
   discriminator, its condition context reads as example-day color, not taught rule.
2. **The coverage contract was honored as written.** `element_inventory[4]` embedded
   "wide-spread Facebook-IPO-style" in the variant's LABEL but carried no separate precondition
   element; the extraction covered every inventory element and routed the anecdote to
   coaching_notes with an explicit coverage note. If this is a miss, it is another
   **granularity-gap instance** — Phase-A v1.2 failing to emit the variant's activating
   precondition as its own element — i.e., the exact defect class v3.2 spent its licensed
   iteration fixing, located in the instrument, not in extractor obedience. (Grader v2's
   transcript-is-authority clause means that doesn't automatically excuse the extraction — but
   it does say where the defect lives if it counts.)
3. **The promoted quote partially encodes the condition.** "Before that spread compressed"
   presupposes a wide spread; "kick his offers out… a point or two higher" implies one.
   Implicit encoding is weaker than a stated precondition — but it is not nothing.

### Advisor lean + recommended procedure

This is a **genuine boundary case, not clean grader over-reach** — I would not paper it as
grader noise, and I would also not treat the flag as self-evidently a real silencing. Two
legitimate paths, operator's choice:

1. **Rule directly** on the packet above. The evidence is small enough to rule in one sitting;
   everything load-bearing is quoted here with its source.
2. **Blind adjudication per the DLwVqc precedent** — transcript-only, no instrument, no
   extraction shown; single question: *"does the transcript TEACH a wide-spread /
   high-two-sided-volume activating condition for the aggressive variant, or is that condition
   part of the war-story example?"* This is the campaign's proven doer≠grader tiebreak for
   exactly this shape, costs ~nothing on subscription pacing, and does not violate read-once
   (it resolves a flagged item's classification, as DLwVqc did — it is not a verdict re-read).

**Either way, mint the ruling as a permanent boundary fixture** (as _LS6 and IyF became):
*"an anecdote-sourced mechanic promoted to Tier-A does / does not carry its narrated activating
condition."* That converts a one-off ruling into instrument law for every future rung — this
boundary WILL recur (educator content is full of war stories with embedded mechanics).

### Non-negotiables regardless of ruling

- **If ruled a REAL silencing → narrow-miss → the rung CLOSES at 21/22.** No second retest, no
  re-grade, no "it's just one item." The licensed iteration is spent (Law 6: spent escapes stay
  spent). Miss-branch per Amendment 1: terra + sol sit the 6-fixture birth gate in parallel
  (<$1, terra first claim at half sol's price), carrying enumerator v1.2 + frontier-v3.2 +
  grader v2 + the full fixture set (10 regression + 6 Tier-A). The instrument improvements
  persist across rungs — that is the ladder working, not a loss.
- **If ruled OVER-REACH → joint bar CLEARS → freeze and stop touching it.** Freeze prompt+model
  SHA (`claude-opus-4-8[1m]` + enumerator v1.2 + frontier-v3.2 + grader v2) with full Law-2
  provenance stamps (fixture hashes, dataset stamps), then the terminal read per the standing
  preconditions (fence witness probe + A-packet topology + frozen shape, read ONCE). If this
  ruling suggests an example-context clarification line for the grader, that is an instrument
  change for the NEXT rung's record — nothing retroactive, and it goes through a packet.
- **Sealed-12 stay sealed** through all of the above.

## 3. Process items

- **Flex-runner mid-run hard-cap: PRECONDITION, not backlog.** No future metered panel launches
  until the runner enforces the ticket cap mid-run (kill-at-cap + clean partial-result manifest
  handling per battery law — remember this runner's resume logic counts error-records as
  completed). Extend the governor trip suite (the 28/28 pattern) with a mid-run-cap trip test so
  the fix lands with a RED-proof, not an assertion.
- **Lane 2 (mini Phase-B copy tryout) is a dangling state.** Last report (07-13) had the
  mechanical judge RUNNING against the ≥92% anchored bar, and the
  `TF-Frontier-DesignPool-Resume` cron armed. Close the loop in your next report — result, or an
  explicit PAUSED/RETIRED marker, and the cron's current state. No orphan lanes; same discipline
  as the pipeline's no-orphan-states rule.
- **After the operator rules:** the ruling + resulting action land on the cert branch FF-only
  per campaign law, and the session writes its AGENT-LOGS entry. Future session reports to the
  advisor go in this directory per the README.

## 4. If it clears — pre-thinking the next pressure (so it's not improvised)

- First certified reader in campaign history ⇒ H1's trust threshold is met **for this reader**,
  and Phase 2 (H2) unlocks. The read discipline is already written and outranks memory:
  re-read `h2-source-thesis-preregistration-2026-07-07.md` the day numbers arrive. SURVIVOR
  read fires at any N; RATE read only at N≥30; robust-survivor has no soft center and no
  waivers; a survivor triggers forensics FIRST, not scaling.
- **Certification is of the READER, not the LIBRARY.** Nothing about clearing the joint bar
  moves any strategy past any battery gate — guard against victory-pressure conflating the two.
  A perfect-fidelity reader over an edgeless corpus producing certified FAILs is the
  falsification instrument *working*.

— Fable 5 (advisor), 2026-07-17. Advisory throughout; the two operator calls (2DX-s2 ruling,
overrun acknowledgement + cap fix) remain open and are the stop-point's to make.
