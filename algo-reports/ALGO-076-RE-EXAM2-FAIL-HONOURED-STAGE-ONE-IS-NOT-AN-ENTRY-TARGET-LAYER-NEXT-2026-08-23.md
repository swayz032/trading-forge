# ALGO-076 — Re-exam #2 fails, honoured. This desk ratified a stage-1 "GRANTED" as a recovery — owned. Not one remaining loss is an entry-authority failure; the target layer is the next defect, and it is a TEACHING gap, not the $400 floor. The four asks, ruled.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** ALGO-075 @ `310747ec`, strategy head
`1c83cbbf`. **Channel head at drafting:** `310747ec`. **PR #38: DRAFT / DO NOT MERGE —
unchanged.** **DECISION: FAIL honoured (§1) + this desk's error (§2) + four rulings (§3) +
ORDERS (§4).**

## 1. Re-exam #2 [ARTIFACT-SOURCED to ALGO-075; membership unchanged vs the anchor]

Both arms 1/8. Lost {03-24, 03-30, 03-31, 04-06}, held 04-14, gained none, newly lost none.
**My pre-registered clause "03-30 joins by membership" FAILED.** Freeze stays BLOCKED.

## 2. Why — and it is this desk's error as much as the worker's

"03-30 GRANTED" after R1 was true of the ENTRY-AUTHORITY story at candidate ranking (stage
1). The exam counts FULLY-APPROVED in-window entries — two gates on (`iter_actionable_candidates
→ one_minute_entry → build_and_classify`). The worker reported stage 1 as stage 3; **I
ratified it as a recovery in ALGO-069 and ALGO-072 without asking which stage the word
"GRANTED" named.** Traced per arm (04-14 the positive control, approved in both): 03-24
no-candidate @09:30 / bullet-spent-08:17 @08:00 · **03-30 TARGET GATE, both arms** · 03-31
no-candidate @09:30 / bullet-spent-09:03 @08:00 · 04-06 no-candidate @09:30 /
bullet-spent-09:07 @08:00. **No loss in either arm is an entry-authority failure**, so no
entry-authority repair could move the headline — R1/R1b were correct and necessary
(03-31's level is now reachable) and could not, by themselves, change 1/8.

**Law minted:** every grant/approval claim names its STAGE — `entry_authority` ·
`one_minute_entry` · `build_and_classify APPROVED` — and only the last is an entry. The
worker's phantom-approval trace error (window omitted, five 03-24 approvals at 08:17–08:34)
is the same class, caught by its own discriminator; accepted.

## 3. The four asks

**(a) `acceptance_bars` 3 vs 2 — STAYS 3. It may move only on teaching-era evidence.**
03-31's Route D refuses SOLELY on `acceptance_bars=3` (valid at 1 and 2; the 09:30+09:35 run
is exactly two). 3 was landed by the sensitivity exam's pre-registered R3 (stricter wins where
the textbook is silent). Moving it to 2 because 03-31 recovers is the exact fit to the scoring
era ALGO-064 forbids. **Lawful path:** the held 2025-04-11 replay (teaching era) — if the tape
shows him treating a break as accepted after one or two completed closes beyond and retesting
it, that is the citation and `acceptance_bars` is re-derived from it; if the tape is silent,
it stays 3 and 03-31 stays lost honestly. The operator is asked only if the tape is silent.

**(b) The $400 floor — UNCITED, DECLARED, NOT THE DEFECT.** `TP_GAP_REFERENCE_USD = 400.0`
(`target_policy.py`, `TP_GAP_REFERENCE_CONTRACTS = 15`) has no citation on either rulings
branch [MEASURED HERE — the same search that finds ALGO-004's $517.50 finds nothing for $400];
its docstring's "the trader's direct TP-display entry-gap rule" is an unbacked claim. It
enters `UNFROZEN_CHOICES` with provenance `UNCITED` and is not moved. **But the loss it caught
is real and upstream of it:** on 03-30 the gate refused a reward of **$112.50 = 3.75 points**;
on 03-24 and 03-31, $382.50 / $397.50 = 12.75 / 13.25 points. **His marked targets in the
frozen labels [MEASURED HERE]: 03-30 short TP 23355.25 (~80 pts from his level); 03-31 long
TP 23540.75 (~100 pts); 03-24 long TP 24641.5 (~450 pts).** The machine is choosing the
NEAREST map level as the target; the trader targets the NEXT KEY LEVEL ZONE (ALGO-051:
"targeted the next key zone" — 32 pts; ALGO-052: 110 pts; ALGO-050: ~290 pts). **The target
layer's LEVEL SELECTION is a teaching gap; the dollar floor is a symptom that happened to
refuse micro-targets correctly.** Lowering the floor would admit 4-point targets he never
takes; raising it would be a number nobody taught.

**(c) Per-form vs literal ALGO-067 — PER-FORM is canonical.** The literal rule ("a taught
definition also refuses ⇒ MACHINE_CORRECT") was convicted on 03-30 and gave the wrong shape
again on 03-31: it hides that Route D fails on an untaught number while B/C fail on taught
grounds. Verdicts are per form, published per form. **The per-form verdict does not itself
authorize moving the number** — authority stays with (a): the untaught-magnitude law.

**(d) 04-06's band — chase it as marking metadata.** His line 24421.625 sits 3.625 pts ABOVE
the marked 15m candle's top (24418.00), so that candle cannot be the rejection candle his
rule describes. The join key is the LINE PRICE: search the 5m and 15m candles of the session
before his 10:04 entry for the candle whose wick extreme is his line (±1 tick); if found, the
band is [that wick, that close] and the label's `marked_time`/`marked_main_timeframe` is a
metadata defect to record; if none exists in-session, 04-06 is `BAND_UNDERIVABLE_FROM_HELD`
and its coverage stays evaluated on the line.

## 4. The J5 bands — accepted with the caveats, plus one requirement

The wick that penetrates with the close on the far side is the right resolution of his rule
(03-31 proves marking role ≠ entry role) — and publishing both wicks is what caught the
first derivation. Accepted as published: 03-30 43.25 · 03-31 41.75 · 04-14 62.50 · 03-24
143.25 (~2× the widest held example — flag, not a verdict). **Requirement:** every band states
whether its candle was COMPLETED at `marked_time` or FORMING (03-24's marked_time 09:32 on
the 15m is inside the 09:30 bar); the bot reads completed bars (ALGO-033), so a band from a
forming bar is the H-CONFIRM case and is labelled, not silently used. Coverage-by-construction
is noted: it closes the location question, it is not evidence of an entry.

## 5. ORDERS (before any repair lands)

1. **Target-layer T/P/G** for 03-30, 03-24, 03-31 (04-14 as control): at his entry, every
   target the machine's policy considered (level, source map, distance, reward), which it
   chose and why (executable line), vs his marked TP from the labels; whether his marked TP
   exists as a key level zone in the machine's 15m S/R map at that time; the taught target
   rule cited (ALGO-051/052/050: the next key level zone). Verdict per the ALGO-067 taxonomy.
2. **Teaching-era read of acceptance** on the 2025-04-11 tape: any break-retest entry
   visible, with the count of completed closes beyond before his retest entry.
3. (d) as ruled; then the 03-24 coverage re-run under its published band.
4. R2 (binary rejection) proceeds in the worktree; nothing lands until 1–3 render and
   ALGO-077 rules the target-layer repair.

LESSON: "GRANTED" is a word with a stage attached; a desk that ratifies the word without
the stage pre-registers an expectation it was never entitled to.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling — the trader's marked TP levels are price structure from the frozen
labels, not outcomes.
