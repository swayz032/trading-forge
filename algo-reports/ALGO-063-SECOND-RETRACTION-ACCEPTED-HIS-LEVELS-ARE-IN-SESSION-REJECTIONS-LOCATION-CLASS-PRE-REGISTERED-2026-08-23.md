# ALGO-063 — Second retraction accepted (a text-rendering join, caught by a positive control). And the labels say what his "zone" IS: a one-tick VISIBLE_REJECTION level marked IN-SESSION — so the location class must name WHICH map rule excluded it. Sub-taxonomy and repair paths pre-registered before the table renders.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the worker's second retraction
message (strategy head `ff4cc67b`+; corrected diagnosis running). **Channel head at drafting:**
`195ce7fb` (ALGO-062, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: ACCEPT retraction (§1) + PRE-REGISTER taxonomy and repair map (§3–4) + HOLD (§5).**

## 1. The retraction, accepted

At-clock diagnosis returned NO_CANDIDATE_AT_ENTRY for all four — the ALGO-062 §3 "most
important answer" — and the worker ran the positive control I would have demanded: the same
join on 2026-04-14 (the AGREE session, where a candidate must exist) returned 0 too. The join
compared `bucket=ts.isoformat()` ("…T09:35:00-04:00") against `str(pd.Timestamp)`
("… 09:35:00-04:00") — a `T` against a space, two renderings of one instant compared as text.
Now joined on instants. Control passes (04-14: 293 in bucket, 3 overlapping his zone); the four
suspects have 66–269 banded candidates in his entry buckets [RELAYED; artifact pending].
**Two wrong answers in one packet, both caught by controls before publication — the controls
are doing the work review cannot.** The class split NO_CANDIDATE_AT_ENTRY (evaluated nothing)
vs LOCATION_NOT_IN_MAP (deciding, no location covering his level) with nearest band + gap in
points carried per row is adopted; the DISTANCE, not the boolean, is the evidence.

## 2. What the frozen labels say his level IS [MEASURED HERE — `…replay_v3_labels_FROZEN.json` @ `ff4cc67b`]

| session | trader | entry | his zone (lo–hi) | role | source_method | marked | tf |
|---|---|---|---|---|---|---|---|
| 03-24 (lost) | ENTER_LONG | 09:32 | 24192.00–24192.25 | SUPPORT | VISIBLE_REJECTION | 09:32 | 15m |
| 03-30 (lost) | ENTER_SHORT | 09:41 | 23609.00–23609.25 | RESISTANCE | VISIBLE_REJECTION | 09:35 | 5m |
| 03-31 (lost) | ENTER_LONG | 09:49 | 23311.75–23312.00 | SUPPORT | VISIBLE_REJECTION | 09:35 | 5m |
| 04-06 (lost) | ENTER_SHORT | 10:04 | 24421.50–24421.75 | RESISTANCE | VISIBLE_REJECTION | 09:52 | 15m |
| 04-14 (AGREE) | ENTER_LONG | 09:36 | 25620.50–25620.75 | SUPPORT | VISIBLE_REJECTION | 09:30 | 5m |

Three facts, all five sessions: **(a)** his "zone" in the labels is a ONE-TICK LEVEL, not a
drawn band (the pinned teaching screenshots show him drawing bands; the labels record the
exact level he acted on — join on the label, not the vocabulary); **(b)** every level's
`source_method` is VISIBLE_REJECTION; **(c)** every level was marked IN-SESSION (09:30–09:52),
on the 5m or 15m, never pre-open. **The agreeing day is not different in kind** — 04-14's level
was also an in-session rejection level. Whatever separates 04-14 from the four is therefore
not "his level type"; it is whether the machine's map happened to hold a band at his level.

The machine's map, per the coded fidelity notes, keeps "15m S/R pre-open frozen"
[ARTIFACT-SOURCED: string in `current_mnq_strategy_v2_1_fidelity.py:371`; executable reach at
the v2.4 kernel NOT verified here — the diagnosis must cite the executable line].
**HYPOTHESIS, UNPROVEN, labelled as such:** a pre-open-frozen map can only coincide with an
in-session rejection level by accident — which would make 04-14 the accident and the four the
rule. The table decides; this desk does not.

## 3. PRE-REGISTERED — LOCATION_NOT_IN_MAP must resolve to ONE of these, with the executable line

- **L1 MAP_FROZEN_PRE_OPEN** — his level formed/was marked in-session and the map's rule
  cannot admit in-session levels. Test: recompute the SAME map rule causally as of his
  `marked_time`; if the level appears only then, L1.
- **L2 MAP_RULE_EXCLUDES** — the level existed pre-open in the raw S/R candidates but
  clustering / selection / width dropped it. Name the rule and parameter.
- **L3 COVERED_BUT_UNAUTHORIZED** — a band covers his level; the location GATE refused. Name
  the gate reason.
- **L4 NEAR_MISS** — nearest band edge within the frozen 17.25-pt stop distance of his level
  (the worker's yardstick is RATIFIED: it is the frozen stop, not a tuned number); beyond
  17.25 = DIFFERENT_LEVEL and one of L1–L3 applies.
- **L0 residual** — none of the above; publish, do not force.
Every row carries: his level fields verbatim (§2) · nearest machine band + gap in points ·
the map rule + executable line that excluded it · and the 04-14 control row (which band
covered his level, and whether that band existed pre-open).

## 4. PRE-REGISTERED — how each class converts to a repair (ALGO-058 §4 refined)

- **L1** → a LOCATION-LAYER SEMANTIC change: the map's update rule (causal in-session S/R on
  the taught timeframes) — teaching citation = the labels' own `source_method` +
  `marked_time` + tf across all five sessions and the pinned screenshots (zones drawn, then
  traded on rejection). Kernel semantics ⇒ mutation arms green, its own red-proof, and the
  guard below.
- **L2** → the parameter resolves from HIS DEMONSTRATED LEVELS in the labels (exact levels,
  tick-wide) — never by agreement search.
- **L3** → gate repair, own grade. **L4** → the tolerance resolves from his demonstrated
  entry-distance-from-level in the labels, never by score.
- **GUARD ON ANY MAP CHANGE, pre-registered now:** widening what the map authorizes is how a
  WAIT-by-default brain becomes permissive again. The 08:00 arm's forbidden-in-window entries
  (24 → 6 at wiring) may not rise, and no new pre-window grant may appear — asserted by
  membership on the same corpus before and after. A location repair that buys 03-24 by
  re-opening the early-grant defect is a FAIL.

## 5. HOLD

No repair until the corrected committed table renders with §3 classes, the executable lines,
the 04-14 control row, and the `acceptance_bars=2` attribution arm — and this desk has checked
at least one session's row against its raw records. ALGO-064 rules the repair.

LESSON: read the label's field, not its name — "zone" here is a tick-wide rejection level
marked at 09:32, and that single fact reorders the whole repair space.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
